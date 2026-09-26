-- 0007_storage_realtime 롤백 — 0006 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: compare-catalog.mjs diff).
-- 되돌린 상태는 0006 의 결함 그대로다: minutes 버킷 읽기·쓰기가 로그인 누구에게나 열림, 나머지 두 버킷은 첫 세그먼트를 직접
-- ::uuid 캐스트(형식 틀린 객체 하나가 목록 조회를 22P02 로 깨뜨림), presence 정책 없음, 회의록 RPC 는 옛 '<minute_id>/' 경로만.
-- ws/… 경로로 올라간 객체·minute_files 행은 남는다 — 되돌린 정책 아래에서 minutes 버킷 외에는 읽히지 않으니, 롤백 전에
-- 옛 경로로 옮기거나 지운다(원격이 생기기 전이라 이전 스크립트는 없다).
-- 본문 출처: Storage 8정책 = 0001, minutes bucket delete·minute_files 3정책·create_minute_with_version = 0006,
-- commit_minute_body_version = 0000 기준선(0006 까지 바뀐 적 없음). 순서는 마이그레이션의 역순(⑤ → ①).

begin;

-- ⑤ 회의록 RPC 2 — 옛 '<minute_id>/' 경로 검사로(create or replace 라 ACL 은 그대로)
create or replace function public.create_minute_with_version(
  p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text,
  p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text,
  p_actor_id uuid, p_actor_name text, p_file_name text default null, p_file_path text default null,
  p_file_size bigint default null, p_file_mime text default null, p_workspace_id uuid default null)
returns table(minute_id uuid, version_id uuid, version_no integer, body_hash text, created_at timestamptz, updated_at timestamptz, wiki_rebuild_required boolean)
language plpgsql set search_path to 'public', 'extensions' as $function$
declare
  v_minute_id uuid := coalesce(p_minute_id, gen_random_uuid());
  v_project_id uuid := p_project_id;
  v_occurrence_date date := p_meeting_occurrence_date;
  v_meeting_project_id uuid;
  v_created_at timestamptz;
  v_reset_required boolean := false;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
  v_workspace_id uuid;
begin
  if p_minute_date is null
     or nullif(btrim(p_team_code), '') is null
     or nullif(btrim(p_title), '') is null
     or char_length(btrim(p_title)) > 200
     or p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_CREATE_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_external_id is not null
     and (p_external_id = '' or char_length(p_external_id) > 128) then
    raise exception 'MINUTE_EXTERNAL_ID_INVALID' using errcode = '22023';
  end if;
  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (v_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  if p_meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = p_meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_project_id is null then
      v_project_id := v_meeting_project_id;
    elsif v_project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    v_occurrence_date := coalesce(v_occurrence_date, p_minute_date);
  else
    v_occurrence_date := null;
  end if;

  if v_project_id is not null then
    select p.workspace_id into v_workspace_id from public.projects p where p.id = v_project_id;
    if not found then
      raise exception 'MINUTE_PROJECT_NOT_FOUND' using errcode = '23503';
    end if;
    if p_workspace_id is not null and p_workspace_id <> v_workspace_id then
      raise exception 'MINUTE_WORKSPACE_MISMATCH' using errcode = '23514';
    end if;
  else
    v_workspace_id := p_workspace_id;
    if v_workspace_id is null then
      raise exception 'MINUTE_WORKSPACE_REQUIRED' using errcode = '22023';
    end if;
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.minute_folders f where f.id = p_folder_id and f.workspace_id = v_workspace_id) then
    raise exception 'MINUTE_FOLDER_WORKSPACE_MISMATCH' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = p_team_code and t.active and t.workspace_id = v_workspace_id
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_project_id is not null then
    -- 같은 프로젝트의 동시 생성도 commit 순서와 시간축 판정을 일치시킨다.
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wiki-project-chronology:' || v_project_id::text, 0)
    );
  end if;
  -- advisory lock을 얻은 뒤 시각을 고정해 같은 프로젝트 동시 생성의 observed_sort와
  -- commit 순서가 어긋나지 않게 한다.
  v_created_at := clock_timestamp();

  -- 프로젝트 회의록은 생성 순서와 after()/cron 실행 순서가 다를 수 있다. 개별 job을
  -- 즉시 적용하지 않고 durable project keyset queue로 보낸다. 기존 시간축 끝보다 앞에
  -- 삽입되는 경우만 full reset하고, 정상 forward append는 완료 cursor 뒤에 이어 붙인다.
  wiki_rebuild_required := v_project_id is not null;
  if v_project_id is not null then
    v_reset_required := exists (
      select 1
      from public.minutes existing
      where existing.project_id = v_project_id
        and existing.archived_at is null
        and (
          (
            coalesce(existing.meeting_occurrence_date, existing.minute_date)::timestamp
            + (existing.created_at at time zone 'UTC')::time
          ),
          existing.id
        ) > (
          (
            coalesce(v_occurrence_date, p_minute_date)::timestamp
            + (v_created_at at time zone 'UTC')::time
          ),
          v_minute_id
        )
    );
  end if;

  insert into public.minutes as new_minute (
    id, minute_date, team_code, title, body_md,
    meeting_id, project_id, meeting_occurrence_date, folder_id, external_id,
    created_by, created_by_name, created_at, updated_at, workspace_id
  ) values (
    v_minute_id, p_minute_date, p_team_code, btrim(p_title), p_body_md,
    p_meeting_id, v_project_id, v_occurrence_date, p_folder_id, p_external_id,
    p_actor_id, p_actor_name, v_created_at, v_created_at, v_workspace_id
  )
  returning new_minute.id, new_minute.created_at, new_minute.updated_at
  into minute_id, created_at, updated_at;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name, created_at
  ) values (
    v_minute_id, 1, p_body_md, p_body_hash,
    btrim(p_title), p_minute_date, p_team_code, v_project_id, p_meeting_id, v_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name, v_created_at
  )
  returning new_version.id into version_id;

  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      v_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  if wiki_rebuild_required then
    if v_reset_required then
      perform public.request_wiki_project_rebuild(
        v_project_id,
        '과거 시점 회의록 추가 후 프로젝트 Wiki 전체 재구성'
      );
    else
      perform public.request_wiki_project_append(
        v_project_id,
        '새 회의록 프로젝트 Wiki 시간순 추가'
      );
    end if;
  end if;

  version_no := 1;
  body_hash := p_body_hash;
  return next;
end
$function$;

create or replace function public.commit_minute_body_version(p_minute_id uuid, p_body_md text, p_body_hash text, p_file_name text, p_file_path text, p_file_size bigint, p_file_mime text, p_actor_id uuid, p_actor_name text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(version_id uuid, version_no integer, body_hash text, wiki_rebuild_required boolean)
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $_$
declare
  v_minute public.minutes%rowtype;
  v_original_minute public.minutes%rowtype;
  v_latest_hash text;
  v_current_hash text;
  v_body_changed boolean := false;
  v_next_version integer;
  v_metadata_rebuild_required boolean := false;
  v_snapshot_created_at timestamptz;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
  v_current_file public.minute_files%rowtype;
begin
  if p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_VERSION_INPUT_INVALID' using errcode = '22023';
  end if;
  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (p_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  select mi.* into v_minute
  from public.minutes mi
  where mi.id = p_minute_id
  for update;
  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute.archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  v_original_minute := v_minute;
  v_snapshot_created_at := v_minute.updated_at;

  -- 메타 갱신(프로젝트 변경 시 Wiki 철회 포함)은 같은 outer transaction 안에서 실행된다.
  if coalesce(p_metadata, '{}'::jsonb) <> '{}'::jsonb then
    select metadata_result.wiki_rebuild_required
    into v_metadata_rebuild_required
    from public.update_minute_metadata_with_wiki_retraction(
      p_minute_id,
      p_metadata
    ) metadata_result;
    select mi.* into v_minute
    from public.minutes mi
    where mi.id = p_minute_id;
  elsif p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'MINUTE_METADATA_INVALID' using errcode = '22023';
  end if;

  v_current_hash := public.wiki_fnv1a64(v_original_minute.body_md);
  v_body_changed := v_current_hash is distinct from p_body_hash;
  wiki_rebuild_required :=
    v_metadata_rebuild_required
    or v_body_changed;
  if v_body_changed then
    -- 새 본문에서 삭제된 문장이 과거 source 때문에 현재 지식으로 남지 않도록,
    -- 이전 버전의 활성 근거를 새 버전 append와 같은 트랜잭션에서 먼저 철회한다.
    -- 공유 근거/변경 관계를 섣불리 역산하지 않고 영향 항목을 보수적으로 archive한 뒤,
    -- 호출자가 프로젝트의 활성 최신 버전을 시간순으로 재처리해 current를 복원한다.
    perform 1
    from public.retract_minute_wiki_sources(
      p_minute_id,
      '회의록 본문 새 버전으로 이전 Wiki 근거를 철회했습니다.'
    );
  end if;

  select mv.body_hash
  into v_latest_hash
  from public.minute_versions mv
  where mv.minute_id = p_minute_id
  order by mv.version_no desc
  limit 1;

  select coalesce(max(mv.version_no), 0) + 1
  into v_next_version
  from public.minute_versions mv
  where mv.minute_id = p_minute_id;

  -- 버전이 있더라도 current body가 latest와 다르면 과거 직접 UPDATE/부분 실패 흔적이다.
  -- 새 본문을 쓰기 전에 현재 포인터의 파일 메타와 함께 별도 snapshot으로 먼저 보존한다.
  if v_latest_hash is null or v_latest_hash is distinct from v_current_hash then
    select mf.* into v_current_file
    from public.minute_files mf
    where mf.minute_id = p_minute_id and mf.role = 'body'
    order by mf.created_at desc, mf.id desc
    limit 1;

    insert into public.minute_versions (
      minute_id, version_no, body_md, body_hash,
      title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
      file_name, file_path, file_size, file_mime,
      created_by, created_by_name, created_at
    ) values (
      p_minute_id, v_next_version, v_original_minute.body_md, v_current_hash,
      v_original_minute.title, v_original_minute.minute_date, v_original_minute.team_code,
      v_original_minute.project_id, v_original_minute.meeting_id,
      v_original_minute.meeting_occurrence_date,
      v_current_file.file_name, v_current_file.file_path, v_current_file.size, v_current_file.mime,
      v_original_minute.created_by, v_original_minute.created_by_name,
      coalesce(v_snapshot_created_at, now())
    );
    v_next_version := v_next_version + 1;
  end if;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name
  ) values (
    p_minute_id, v_next_version, p_body_md, p_body_hash,
    v_minute.title, v_minute.minute_date, v_minute.team_code,
    v_minute.project_id, v_minute.meeting_id, v_minute.meeting_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name
  )
  returning new_version.id into version_id;

  -- minute_files.body는 current pointer다. 파일 없는 external replace도 이전 포인터를 명시적으로 뺀다.
  delete from public.minute_files
  where minute_id = p_minute_id and role = 'body';
  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      p_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  update public.minutes
  set body_md = p_body_md, updated_at = clock_timestamp()
  where id = p_minute_id;

  version_no := v_next_version;
  body_hash := p_body_hash;
  return next;
end
$_$;

-- ④ minute_files 3정책 — 0006 본문(술어 네 번 반복)으로, 헬퍼 drop
drop policy attachment_insert_minute_files on public.minute_files;
create policy attachment_insert_minute_files on public.minute_files for insert to authenticated
  with check (role = 'attachment' and uploaded_by = auth.uid() and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop policy attachment_update_minute_files on public.minute_files;
create policy attachment_update_minute_files on public.minute_files for update to authenticated
  using (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))))
  with check (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop policy attachment_delete_minute_files on public.minute_files;
create policy attachment_delete_minute_files on public.minute_files for delete to authenticated
  using (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop function public.can_manage_minute(uuid);

-- ③ presence 정책
drop policy join_project_presence on realtime.messages;
drop policy read_project_presence on realtime.messages;
drop policy track_project_presence on realtime.messages;

-- ② Storage 9정책 — 0001(8)·0006(minutes bucket delete) 본문으로
drop policy "deliverables delete" on storage.objects;
create policy "deliverables delete" on storage.objects as permissive for delete to authenticated using (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));
drop policy "deliverables insert" on storage.objects;
create policy "deliverables insert" on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));
drop policy "deliverables read" on storage.objects;
create policy "deliverables read" on storage.objects as permissive for select to authenticated using (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));
drop policy "issue-attachments delete" on storage.objects;
create policy "issue-attachments delete" on storage.objects as permissive for delete to authenticated using (((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid)));
drop policy "issue-attachments insert" on storage.objects;
create policy "issue-attachments insert" on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid)));
drop policy "issue-attachments read" on storage.objects;
create policy "issue-attachments read" on storage.objects as permissive for select to authenticated using ((bucket_id = 'issue-attachments'::text));
drop policy "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'minutes'::text));
drop policy "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects as permissive for select to authenticated using ((bucket_id = 'minutes'::text));
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'minutes'
    and (owner = auth.uid() or exists (select 1 from public.minutes mi
          where mi.id::text = split_part(objects.name, '/', 1) and public.is_ws_admin(mi.workspace_id)))
    and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));

-- ① 헬퍼 — 의존 순서(storage_project·storage_entity_id·minute_body_path_ok 가 storage_ws 를, 전부가 uuid_or_null 을 부른다)
drop function public.minute_body_path_ok(text, uuid, uuid, uuid);
drop function public.presence_topic_project(text);
drop function public.storage_project(text);
drop function public.storage_entity_id(text);
drop function public.storage_ws(text);
drop function public.uuid_or_null(text);

commit;
