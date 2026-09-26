-- 0007_storage_realtime — SP2 Phase B1. 정본: docs/superpowers/specs/2026-09-26-sp2-workspace-isolation-design.md §3.
-- 경로 규약 ws/<wid>/p/<pid|_>/<entity>/<id>/<file>(src/lib/domain/storagePath.ts 와 짝), presence 토픽(presenceTopics.ts 와 짝).
-- 직접 ::uuid 캐스트 금지 — 형식이 틀린 객체 이름 하나가 버킷 목록 조회 전체를 22P02 로 실패시킨다(uuid_or_null 경유).
-- 순서: ① 순수 헬퍼 ② Storage 9정책 ③ presence 2정책 ④ minute_files 3정책의 술어를 헬퍼 하나로 ⑤ 회의록 RPC 2 의 경로 검사
--       ⑥ 실행 권한 ⑦ 사후검증. 롤백: supabase/rollbacks/0007_storage_realtime_rollback.sql. 스모크: supabase/rehearsal/0007_smoke.sql.

-- ① 순수 헬퍼(immutable, 표를 읽지 않는다) ------------------------------------------------------------------------
create function public.uuid_or_null(p text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return p::uuid; end if;
  return null;
end $$;
-- 경로 전체가 규약에 맞을 때만 워크스페이스를 낸다(parseStoragePath 와 같은 판정: 7 세그먼트, 프로젝트 '_'·uuid, 엔터티 4종,
-- 엔터티 id uuid, 파일 1~200자). 프로젝트 세그먼트가 'zz' 같은 쓰레기면 null — storage_project null 이 '_'(무프로젝트)로
-- 읽혀 워크스페이스 전원에게 열리는 일을 여기서 막는다. storage_project·storage_entity_id 는 이 판정 위에서만 값을 낸다.
create function public.storage_ws(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when array_length(string_to_array(p_name, '/'), 1) = 7
               and split_part(p_name, '/', 1) = 'ws' and split_part(p_name, '/', 3) = 'p'
               and (split_part(p_name, '/', 4) = '_' or public.uuid_or_null(split_part(p_name, '/', 4)) is not null)
               and split_part(p_name, '/', 5) in ('minutes', 'minute-files', 'deliverables', 'issue-attachments')
               and public.uuid_or_null(split_part(p_name, '/', 6)) is not null
               and char_length(split_part(p_name, '/', 7)) between 1 and 200
              then public.uuid_or_null(split_part(p_name, '/', 2)) end
$$;
create function public.storage_project(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when public.storage_ws(p_name) is not null then public.uuid_or_null(split_part(p_name, '/', 4)) end
$$;
create function public.storage_entity_id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select case when public.storage_ws(p_name) is not null then public.uuid_or_null(split_part(p_name, '/', 6)) end
$$;
-- 회의록 본문 파일 경로가 그 회의록의 것인가 — 두 RPC(생성·본문 교체)가 같은 판정을 쓴다. null 없이 true/false.
create function public.minute_body_path_ok(p_path text, p_workspace_id uuid, p_project_id uuid, p_minute_id uuid) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(public.storage_ws(p_path) = p_workspace_id
                  and public.storage_project(p_path) is not distinct from p_project_id
                  and split_part(p_path, '/', 5) = 'minutes'
                  and public.storage_entity_id(p_path) = p_minute_id, false)
$$;
-- presence 토픽 → pid. 정규식은 presenceTopics.ts PRESENCE_TOPIC_RE 와 글자 그대로 같다(tests/rls/storage-realtime.test.ts ⑧ 이 대조).
create function public.presence_topic_project(p_topic text) returns uuid
language sql immutable set search_path = '' as $$
  select public.uuid_or_null(substring(p_topic from '^project-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?:presence-[a-z0-9-]{1,40}|weekly-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-presence)$'))
$$;

-- ② Storage 9정책(이름 유지) ------------------------------------------------------------------------------------
-- minutes 버킷: 회의록 본문(minutes)·첨부(minute-files). 프로젝트 세그먼트는 '_' 또는 그 워크스페이스의 프로젝트.
drop policy "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects for select to authenticated using (
  bucket_id = 'minutes' and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null or public.can_read_project(public.storage_project(name))));
drop policy "minutes bucket insert" on storage.objects;
create policy "minutes bucket insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'minutes' and split_part(name, '/', 5) in ('minutes', 'minute-files')
  and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null
       or exists (select 1 from public.projects p
                   where p.id = public.storage_project(objects.name) and p.workspace_id = public.storage_ws(objects.name)
                     and public.is_project_member(p.id))));
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated using (
  bucket_id = 'minutes' and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (owner = auth.uid() or public.is_ws_admin(public.storage_ws(name)))
  and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));

-- issue-attachments: 읽기 = 그 프로젝트를 읽을 수 있음, 쓰기·삭제 = can_edit_issue + 이슈가 그 프로젝트·워크스페이스의 것
drop policy "issue-attachments read" on storage.objects;
create policy "issue-attachments read" on storage.objects for select to authenticated using (
  bucket_id = 'issue-attachments' and public.storage_project(name) is not null
  and public.can_read_project(public.storage_project(name)));
drop policy "issue-attachments insert" on storage.objects;
create policy "issue-attachments insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'issue-attachments' and split_part(name, '/', 5) = 'issue-attachments'
  and public.can_edit_issue(public.storage_entity_id(name))
  and exists (select 1 from public.issues i join public.projects p on p.id = i.project_id
               where i.id = public.storage_entity_id(objects.name) and i.project_id = public.storage_project(objects.name)
                 and p.workspace_id = public.storage_ws(objects.name)));
drop policy "issue-attachments delete" on storage.objects;
create policy "issue-attachments delete" on storage.objects for delete to authenticated using (
  bucket_id = 'issue-attachments' and public.can_edit_issue(public.storage_entity_id(name)));

-- deliverables: 세 동작 모두 can_attach(항목), insert 는 항목이 그 프로젝트·워크스페이스의 것(읽기도 can_attach — 현행 의미 유지)
drop policy "deliverables read" on storage.objects;
create policy "deliverables read" on storage.objects for select to authenticated using (
  bucket_id = 'deliverables' and public.can_attach(public.storage_entity_id(name)));
drop policy "deliverables insert" on storage.objects;
create policy "deliverables insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'deliverables' and split_part(name, '/', 5) = 'deliverables'
  and public.can_attach(public.storage_entity_id(name))
  and exists (select 1 from public.wbs_items w join public.projects p on p.id = w.project_id
               where w.id = public.storage_entity_id(objects.name) and w.project_id = public.storage_project(objects.name)
                 and p.workspace_id = public.storage_ws(objects.name)));
drop policy "deliverables delete" on storage.objects;
create policy "deliverables delete" on storage.objects for delete to authenticated using (
  bucket_id = 'deliverables' and public.can_attach(public.storage_entity_id(name)));

-- ③ presence(private) — 토픽의 pid 를 읽을 수 있는 사람만 join(SELECT)·track(INSERT). 형식이 틀린 토픽은 pid null → 거부(오류 없음).
create policy read_project_presence on realtime.messages for select to authenticated using (
  extension = 'presence' and public.presence_topic_project(realtime.topic()) is not null
  and public.can_read_project(public.presence_topic_project(realtime.topic())));
create policy track_project_presence on realtime.messages for insert to authenticated with check (
  extension = 'presence' and public.presence_topic_project(realtime.topic()) is not null
  and public.can_read_project(public.presence_topic_project(realtime.topic())));

-- ④ minute_files 3정책 — 0006 이 네 번 반복한 "작성자 ∨ 그 워크스페이스 관리자 ∨ 그 프로젝트 관리자" 술어를 헬퍼 하나로.
--    0006 의 서브쿼리는 minutes 를 RLS(minutes_ws_read) 아래에서 읽었다 — DEFINER 로 옮기며 그 읽기 조건을 명시해 판정을 같게 둔다.
create function public.can_manage_minute(p_minute uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.minutes mi
                  where mi.id = p_minute and mi.archived_at is null
                    and mi.workspace_id in (select public.my_workspace_ids())
                    and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
                         or (mi.project_id is not null and public.is_project_admin(mi.project_id))))
$$;
drop policy attachment_insert_minute_files on public.minute_files;
create policy attachment_insert_minute_files on public.minute_files for insert to authenticated
  with check (role = 'attachment' and uploaded_by = auth.uid() and public.can_manage_minute(minute_id));
drop policy attachment_update_minute_files on public.minute_files;
create policy attachment_update_minute_files on public.minute_files for update to authenticated
  using (role = 'attachment' and public.can_manage_minute(minute_id))
  with check (role = 'attachment' and public.can_manage_minute(minute_id));
drop policy attachment_delete_minute_files on public.minute_files;
create policy attachment_delete_minute_files on public.minute_files for delete to authenticated
  using (role = 'attachment' and public.can_manage_minute(minute_id));

-- ⑤ 회의록 RPC 파일 경로 — 옛 '<minute_id>/' 접두 → ws/<wid>/p/<pid|_>/minutes/<minute_id>/<file>(minute_body_path_ok).
--    둘 다 워크스페이스·프로젝트가 확정된 뒤에 검사한다(생성은 워크스페이스 확정 블록 뒤, 교체는 회의록 행 잠금 뒤 — 파일이 올라간
--    그 회의록의 스코프). 나머지 본문·시그니처·ACL 은 그대로(create or replace).
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
  if v_has_file and not public.minute_body_path_ok(p_file_path, v_workspace_id, v_project_id, v_minute_id) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
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
  if v_has_file and not public.minute_body_path_ok(p_file_path, v_minute.workspace_id, v_minute.project_id, p_minute_id) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
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

-- ⑥ 실행 권한 — 정책이 authenticated 세션에서 부르므로 authenticated 에 EXECUTE. anon·PUBLIC 은 없다(0006 ⑦ 과 같은 표면).
revoke all on function public.uuid_or_null(text), public.storage_ws(text), public.storage_project(text), public.storage_entity_id(text),
  public.minute_body_path_ok(text, uuid, uuid, uuid), public.presence_topic_project(text), public.can_manage_minute(uuid) from public, anon;
grant execute on function public.uuid_or_null(text), public.storage_ws(text), public.storage_project(text), public.storage_entity_id(text),
  public.minute_body_path_ok(text, uuid, uuid, uuid), public.presence_topic_project(text), public.can_manage_minute(uuid) to authenticated, service_role;

-- ⑦ 사후검증 ------------------------------------------------------------------------------------------------------
do $$
declare v text;
begin
  -- 객체 이름 세그먼트를 uuid 로 직접 캐스트하는 정책이 남으면 형식 틀린 객체 하나가 목록 조회를 22P02 로 깨뜨린다
  -- (realtime 의 SP1 receive_project_wbs_channel 캐스트는 uuid 모양 정규식이 뽑은 값만 받아 여기서 보지 않는다)
  select string_agg(pp.tablename || '.' || pp.policyname, ', ') into v from pg_policies pp
   where pp.schemaname = 'storage' and coalesce(pp.qual, '') || coalesce(pp.with_check, '') ~ '\)\)?::uuid';
  if v is not null then raise exception 'SP2_0007_POSTCHECK: 직접 ::uuid 캐스트 정책이 남았다: %', v; end if;
  select string_agg(p.proname, ', ') into v from pg_proc p
   where p.proname in ('create_minute_with_version', 'commit_minute_body_version') and p.prosrc like '%''/\%''%';
  if v is not null then raise exception 'SP2_0007_POSTCHECK: 옛 <minute_id>/ 경로 검사가 남았다: %', v; end if;
  if (select count(*) from pg_policies where schemaname = 'realtime' and tablename = 'messages'
        and policyname in ('read_project_presence', 'track_project_presence')) <> 2 then
    raise exception 'SP2_0007_POSTCHECK: presence 정책 2개가 없다';
  end if;
end $$;
