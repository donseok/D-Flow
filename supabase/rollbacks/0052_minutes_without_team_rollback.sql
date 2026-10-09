-- 0052 롤백 — 회의록 생성·메타 변경 RPC 를 이전 정의(0007·0000 본문)로 되돌린다. 팀 코드가 다시 필수가 된다.
-- 앱을 먼저 되돌린다 — 앱이 빈 팀 코드를 보내는 동안 되돌리면 "팀 없음" 등록·해제가 MINUTE_CREATE_INPUT_INVALID·MINUTE_METADATA_REQUIRED 로 실패한다.
-- 되돌리지 않는 데이터: 이미 만든 팀 없는 회의록(minutes.team_code = '' ∧ team_id null)과 그 버전 스냅샷은 그대로 남는다(행을 지우거나 팀을 지어내지 않는다).
--   롤백 뒤 그 행은 읽기·보관·삭제는 되지만 **메타 변경과 본문 새 버전이 거부된다** — 옛 메타 RPC 는 보내지 않은 키도 최종 값으로 검사하므로
--   team_code '' 인 채로는 제목·일자·프로젝트·폴더 변경과 본문 교체(commit_minute_body_version 이 같은 RPC 를 부른다)가 MINUTE_TEAM_INVALID 다.
--   같은 요청에 유효한 팀 코드를 함께 보내면(팀을 지정하면) 통과한다. 외부 API 의 replace 도 team 을 보내야 한다.
--   롤백 전에 몇 건인지 본다: select count(*) from public.minutes where team_code = '' and team_id is null;
--   0 이 아니면 롤백 전에 화면에서 팀을 지정해 두거나, 위 제약을 받아들이고 진행한다.
-- 메아리 트리거(minutes_team_code_echo)는 0052 가 손대지 않았다 — 여기서도 건드리지 않는다.
begin;

-- 0007 본문
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

-- 0000 본문
create or replace function public.update_minute_metadata_with_wiki_retraction(p_minute_id uuid, p_metadata jsonb)
returns table(old_project_id uuid, new_project_id uuid, updated_at timestamptz, wiki_rebuild_required boolean)
language plpgsql set search_path to 'public', 'extensions' as $function$
declare
  v_minute public.minutes%rowtype;
  v_original_minute public.minutes%rowtype;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_meeting_project_id uuid;
  v_index_project_id uuid;
  v_lock_project_id uuid;
  v_chronology_changed boolean := false;
  v_index_content_changed boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'MINUTE_METADATA_INVALID' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(v_metadata) as metadata_key(key_name)
    where key_name not in (
      'minute_date', 'team_code', 'title', 'meeting_id',
      'project_id', 'meeting_occurrence_date', 'folder_id'
    )
  ) then
    raise exception 'MINUTE_METADATA_KEY_NOT_ALLOWED' using errcode = '22023';
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

  old_project_id := v_minute.project_id;

  if v_metadata ? 'minute_date' then
    v_minute.minute_date := nullif(v_metadata->>'minute_date', '')::date;
  end if;
  if v_metadata ? 'team_code' then
    v_minute.team_code := nullif(btrim(v_metadata->>'team_code'), '');
  end if;
  if v_metadata ? 'title' then
    v_minute.title := nullif(btrim(v_metadata->>'title'), '');
  end if;
  if v_metadata ? 'meeting_id' then
    v_minute.meeting_id := nullif(v_metadata->>'meeting_id', '')::uuid;
  end if;
  if v_metadata ? 'project_id' then
    v_minute.project_id := nullif(v_metadata->>'project_id', '')::uuid;
  end if;
  if v_metadata ? 'meeting_occurrence_date' then
    v_minute.meeting_occurrence_date :=
      nullif(v_metadata->>'meeting_occurrence_date', '')::date;
  end if;
  if v_metadata ? 'folder_id' then
    v_minute.folder_id := nullif(v_metadata->>'folder_id', '')::uuid;
  end if;

  if v_minute.minute_date is null
     or v_minute.team_code is null
     or v_minute.title is null
     or char_length(v_minute.title) > 200 then
    raise exception 'MINUTE_METADATA_REQUIRED' using errcode = '23502';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = v_minute.team_code and t.active
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_minute.meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = v_minute.meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_minute.project_id is null then
      v_minute.project_id := v_meeting_project_id;
    elsif v_minute.project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    if (v_metadata ? 'meeting_id') and not (v_metadata ? 'meeting_occurrence_date') then
      v_minute.meeting_occurrence_date := v_minute.minute_date;
    end if;
  else
    v_minute.meeting_occurrence_date := null;
  end if;

  new_project_id := v_minute.project_id;
  v_chronology_changed :=
    old_project_id is not distinct from new_project_id
    and (
      v_original_minute.minute_date is distinct from v_minute.minute_date
      or v_original_minute.meeting_occurrence_date
         is distinct from v_minute.meeting_occurrence_date
    );
  v_index_content_changed :=
    v_original_minute.title is distinct from v_minute.title
    or v_original_minute.team_code is distinct from v_minute.team_code
    or v_original_minute.minute_date is distinct from v_minute.minute_date
    or v_original_minute.meeting_occurrence_date
       is distinct from v_minute.meeting_occurrence_date
    or old_project_id is distinct from new_project_id;

  if old_project_id is distinct from new_project_id or v_chronology_changed then
    -- A→B와 B→A 이동이 동시에 실행돼도 두 project rebuild row를 항상 UUID 오름차순으로
    -- 먼저 확보한다. 이후 retract(old)→request(new)가 역순 row lock cycle을 만들지 않는다.
    for v_lock_project_id in
      select scope.project_id
      from (
        select old_project_id as project_id
        union
        select new_project_id as project_id
      ) scope
      where scope.project_id is not null
      order by scope.project_id
    loop
      insert into public.wiki_project_rebuild_jobs (
        project_id, status, generation, reason
      ) values (
        v_lock_project_id, 'pending', 1, '회의록 메타데이터 변경 준비'
      )
      on conflict (project_id) do nothing;

      perform 1
      from public.wiki_project_rebuild_jobs rebuild
      where rebuild.project_id = v_lock_project_id
      for update;
    end loop;

    perform 1
    from public.retract_minute_wiki_sources(
      p_minute_id,
      case
        when old_project_id is distinct from new_project_id
          then '회의록 프로젝트 재귀속으로 기존 Wiki 근거를 철회했습니다.'
        else '회의록 시간축 변경으로 기존 Wiki 근거를 철회했습니다.'
      end
    );
    update public.wiki_processing_jobs job
    set status = 'done',
        locked_at = null,
        locked_by = null,
        last_error = null,
        payload = job.payload || jsonb_build_object(
          'retracted',
          true,
          'reason',
          case
            when old_project_id is distinct from new_project_id
              then 'project_reassigned'
            else 'chronology_changed'
          end
        ),
        updated_at = v_now
    where job.minute_id = p_minute_id
      and job.project_id is not distinct from old_project_id
      and job.status <> 'done';
  end if;

  update public.minutes mi
  set minute_date = v_minute.minute_date,
      team_code = v_minute.team_code,
      title = v_minute.title,
      meeting_id = v_minute.meeting_id,
      project_id = v_minute.project_id,
      meeting_occurrence_date = v_minute.meeting_occurrence_date,
      folder_id = v_minute.folder_id,
      updated_at = v_now
  where mi.id = p_minute_id;

  if old_project_id is distinct from new_project_id then
    -- 검색 문서도 현재 scope와 함께 움직인다. 모든 기존 scope의 파생 문서를 먼저
    -- 제거하고, 과거 scope에는 CAS-safe delete tombstone을, 새 scope에는 upsert를
    -- 남겨 실행 중이던 구세대 worker가 뒤늦게 끝나도 최종 상태가 다시 수렴하게 한다.
    delete from public.ai_documents
    where domain = 'minutes'
      and entity_type = 'minute'
      and entity_id = p_minute_id::text;

    for v_index_project_id in
      select distinct scope.project_id
      from (
        select job.project_id
        from public.ai_index_jobs job
        where job.domain = 'minutes'
          and job.entity_type = 'minute'
          and job.entity_id = p_minute_id::text
        union all
        select old_project_id
      ) scope
    loop
      perform public.queue_minute_ai_index_scope_change(
        v_index_project_id,
        p_minute_id,
        'delete',
        v_now
      );
    end loop;

    -- project_id NULL도 검색 계층의 명시적 global scope다.
    perform public.queue_minute_ai_index_scope_change(
      new_project_id,
      p_minute_id,
      'upsert',
      v_now
    );

    -- old 프로젝트 요청은 위 retract가 이미 같은 트랜잭션에 남겼다. update 뒤에는
    -- 새 scope도 별도 generation으로 요청해 이동한 회의록을 최신 버전으로 포함한다.
    perform public.request_wiki_project_rebuild(
      new_project_id,
      '회의록 프로젝트 재귀속 후 새 프로젝트 Wiki 재구성'
    );
  elsif v_index_content_changed then
    -- 같은 scope의 제목/팀/일자 변경은 stable key를 유지한 채 검색 문서를 교체한다.
    perform public.queue_minute_ai_index_scope_change(
      new_project_id,
      p_minute_id,
      'upsert',
      v_now
    );
  end if;

  updated_at := v_now;
  wiki_rebuild_required :=
    old_project_id is distinct from new_project_id or v_chronology_changed;
  return next;
end
$function$;

commit;
