-- SP5c: atomic linked-minute issue INSERT with custom values.
-- Keep the existing 24-argument service-only API intact. The new required
-- p_custom argument disambiguates PostgREST overloads; never add a default.
create function public.create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_area_id uuid, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text, p_custom jsonb) returns table(issue_id uuid, code text)
language plpgsql security definer set search_path to '' as $$
declare
  v_issue_id uuid;
  v_code text;
  v_major_id uuid;
  v_major_name text;
  v_version_body_hash text;
  v_version_project_id uuid;
  v_current_project_id uuid;
  v_minute_archived_at timestamptz;
  v_minute_title text;
  v_minute_date date;
  v_minute_version_no integer;
  v_assignee_input_count integer;
  v_assignee_unique_count integer;
  v_valid_assignee_count integer;
  v_related_systems text[];
  v_has_analysis boolean;
  v_module boolean;
  v_required boolean;
  v_ws uuid;
  v_ws_values jsonb;
  v_values jsonb;
  v_active boolean;
  v_defs jsonb;
  v_def jsonb;
  v_key text;
  v_admin boolean;
begin
  if p_project_id is null then
    raise exception 'ISSUE_PROJECT_REQUIRED' using errcode = '22023';
  end if;
  if p_actor_id is null then
    raise exception 'ISSUE_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ISSUE_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'ISSUE_TITLE_TOO_LONG' using errcode = '22023';
  end if;
  if p_body is null then
    raise exception 'ISSUE_BODY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(p_body) > 20000 then
    raise exception 'ISSUE_BODY_TOO_LONG' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not in ('high', 'medium', 'low') then
    raise exception 'ISSUE_SEVERITY_INVALID' using errcode = '22023';
  end if;
  if p_start_date is not null
     and p_due_date is not null
     and p_start_date > p_due_date then
    raise exception 'ISSUE_DATE_RANGE_INVALID' using errcode = '22023';
  end if;

  -- 분석 묶음(여섯): 모두 null 이면 분석 없음, 하나라도 있으면 아래 원문 검사 전부
  v_has_analysis := p_major_name is not null or p_sub_process is not null or p_owner_department is not null
                    or p_related_systems is not null or p_source_type is not null or p_source_detail is not null;
  -- 유효 모듈 = 워크스페이스 허용 ∧ 프로젝트 켜짐. 잠금 순서는 설정 RPC 와 같다(워크스페이스 → 프로젝트 FOR SHARE — K6)
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'ISSUE_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select ws."values" into v_ws_values from public.workspace_settings ws where ws.workspace_id = v_ws for share;
  select ps."values" into v_values from public.project_settings ps where ps.project_id = p_project_id for share;
  if v_ws_values is null or v_values is null then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- The action verifies source hashes; this service-only path must independently
  -- check the actual actor and supplied protected keys under the settings lock.
  v_admin := public.actor_is_project_admin(p_actor_id, p_project_id);
  if not v_admin and not exists (
    select 1 from public.project_members pm
    join public.people pe on pe.id = pm.person_id
    join public.workspace_members wm on wm.user_id = pe.user_id and wm.workspace_id = v_ws
    where pm.project_id = p_project_id and pe.user_id = p_actor_id and pm.active and pe.active
  ) then raise exception using errcode='42501', message='ISSUE_ACTOR_FORBIDDEN'; end if;
  if jsonb_typeof(p_custom) is distinct from 'object' then
    raise exception using errcode='23514', message='CUSTOM_FIELD_SHAPE';
  end if;
  v_defs := public.custom_field_defs_of('issue', v_values -> 'fields.issue');
  for v_key in select jsonb_object_keys(p_custom) loop
    select d into v_def from jsonb_array_elements(v_defs) d where d ->> 'key'=v_key;
    if v_def is null then raise exception using errcode='23514', message='CUSTOM_FIELD_UNKNOWN:' || v_key; end if;
    if not (v_def ->> 'active')::boolean then raise exception using errcode='23514', message='CUSTOM_FIELD_INACTIVE:' || v_key; end if;
    if v_def ->> 'editable_by'='admin' and not v_admin then
      raise exception using errcode='42501', message='CUSTOM_FIELD_ADMIN_ONLY:' || v_key;
    end if;
  end loop;
  -- Value shape, size, required defaults and option validation remain authoritative
  -- in the existing INSERT trigger. Omitted protected defaults are generated there.
  v_module := coalesce((v_ws_values -> 'modules.allowed') ? 'issue_analysis', false)
              and coalesce((v_values -> 'modules.enabled') ? 'issue_analysis', false);
  v_required := (v_values -> 'issues.analysis') is not null and (v_values -> 'issues.analysis') is distinct from '"optional"'::jsonb;
  if v_has_analysis and not v_module then
    raise exception using errcode = '22023', message = 'ISSUE_ANALYSIS_DISABLED';
  end if;
  if not v_has_analysis and v_module and v_required then
    raise exception using errcode = '22023', message = 'ISSUE_ANALYSIS_REQUIRED';
  end if;
  if p_area_id is not null then   -- 채번 트리거와 같은 문장(비활성화 커밋 뒤 값을 본다 — D15)
    select a.active into v_active from public.project_areas a
     where a.id = p_area_id and a.project_id = p_project_id and a.kind = 'issue_area' for key share;
    if not found then raise exception using errcode = '23514', message = 'ISSUE_AREA_NOT_FOUND'; end if;
    if not v_active then raise exception using errcode = '23514', message = 'ISSUE_AREA_INACTIVE'; end if;
  elsif v_has_analysis then
    raise exception using errcode = '23514', message = 'ISSUE_AREA_REQUIRED';
  end if;
  if v_has_analysis then
    if p_major_name is null
       or btrim(p_major_name) = ''
       or char_length(btrim(p_major_name)) > 100
       or btrim(p_major_name) ~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+' then
      raise exception 'ISSUE_MAJOR_NAME_INVALID' using errcode = '22023';
    end if;
    if p_sub_process is null
       or btrim(p_sub_process) = ''
       or char_length(btrim(p_sub_process)) > 200 then
      raise exception 'ISSUE_SUB_PROCESS_INVALID' using errcode = '22023';
    end if;
    if p_owner_department is null
       or btrim(p_owner_department) = ''
       or char_length(btrim(p_owner_department)) > 100 then
      raise exception 'ISSUE_OWNER_DEPARTMENT_INVALID' using errcode = '22023';
    end if;
    if p_related_systems is null
       or not public.issue_related_systems_valid(p_related_systems) then
      raise exception 'ISSUE_RELATED_SYSTEMS_INVALID' using errcode = '22023';
    end if;
    if p_source_type is distinct from 'minutes' then
      raise exception 'ISSUE_MINUTE_SOURCE_TYPE_REQUIRED' using errcode = '22023';
    end if;
    if p_source_detail is null or char_length(btrim(p_source_detail)) > 1000 then
      raise exception 'ISSUE_SOURCE_DETAIL_INVALID' using errcode = '22023';
    end if;

    select coalesce(array_agg(normalized.system_name order by normalized.first_ord), '{}'::text[])
      into v_related_systems
      from (
        select btrim(item.value) as system_name, min(item.ord) as first_ord
        from unnest(p_related_systems) with ordinality as item(value, ord)
        group by btrim(item.value)
      ) normalized;
  else
    v_related_systems := '{}'::text[];
  end if;

  if p_assignee_member_ids is null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;
  v_assignee_input_count := cardinality(p_assignee_member_ids);
  if v_assignee_input_count > 20 then
    raise exception 'ISSUE_ASSIGNEES_TOO_MANY' using errcode = '22023';
  end if;
  if array_position(p_assignee_member_ids, null) is not null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;

  if p_minute_id is null or p_minute_version_id is null then
    raise exception 'MINUTE_VERSION_REQUIRED' using errcode = '22023';
  end if;
  if p_body_hash is null or btrim(p_body_hash) = '' then
    raise exception 'MINUTE_BODY_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_block_index is null or p_block_index < 0 then
    raise exception 'MINUTE_BLOCK_INDEX_INVALID' using errcode = '22023';
  end if;
  if p_block_hash is null or btrim(p_block_hash) = '' then
    raise exception 'MINUTE_BLOCK_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_excerpt_snapshot is null or btrim(p_excerpt_snapshot) = '' then
    raise exception 'MINUTE_BLOCK_EXCERPT_REQUIRED' using errcode = '22023';
  end if;
  if p_source_kind is null
     or p_source_kind not in ('manual', 'action', 'risk') then
    raise exception 'MINUTE_SOURCE_KIND_INVALID' using errcode = '22023';
  end if;
  if p_source_key is not null and btrim(p_source_key) = '' then
    raise exception 'MINUTE_SOURCE_KEY_INVALID' using errcode = '22023';
  end if;

  select minute.project_id, minute.archived_at
    into v_current_project_id, v_minute_archived_at
    from public.minutes minute
   where minute.id = p_minute_id
   for share;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  if v_current_project_id is not null
     and v_current_project_id <> p_project_id then
    raise exception 'MINUTE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  select
    mv.body_hash,
    mv.project_id,
    mv.title,
    mv.minute_date,
    mv.version_no
  into
    v_version_body_hash,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_minute_version_no
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id;

  if not found then
    raise exception 'MINUTE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body_hash <> v_version_body_hash then
    raise exception 'MINUTE_BODY_STALE' using errcode = '22023';
  end if;

  select count(distinct member_id)
    into v_assignee_unique_count
    from unnest(p_assignee_member_ids) as assignee(member_id);

  select count(*)
    into v_valid_assignee_count
    from public.project_members pm
   where pm.project_id = p_project_id
     and pm.id in (
       select distinct member_id
       from unnest(p_assignee_member_ids) as assignee(member_id)
     );

  if v_valid_assignee_count <> v_assignee_unique_count then
    raise exception 'ISSUE_ASSIGNEE_PROJECT_MISMATCH' using errcode = '22023';
  end if;

  -- Major resolve-or-create(분석이 있을 때만 — 그 영역 안에서) — 같은 이름은 기존 체번 재사용, 새 이름은 트리거가
  -- advisory lock 아래 다음 번호를 발급한다. 경합으로 유니크 충돌이 나면 승자를 재조회.
  if v_has_analysis then
    v_major_name := btrim(p_major_name);
    select mp.id
      into v_major_id
      from public.issue_major_processes mp
     where mp.project_id = p_project_id
       and mp.area_id = p_area_id
       and mp.name = v_major_name;
    if not found then
      begin
        insert into public.issue_major_processes (project_id, area_id, name)
        values (p_project_id, p_area_id, v_major_name)
        returning id into v_major_id;
      exception when unique_violation then
        select mp.id
          into v_major_id
          from public.issue_major_processes mp
         where mp.project_id = p_project_id
           and mp.area_id = p_area_id
           and mp.name = v_major_name;
        if not found then
          raise exception 'ISSUE_MAJOR_RESOLVE_FAILED' using errcode = '55000';
        end if;
      end;
    end if;
  else
    v_major_id := null;
  end if;

  insert into public.issues as created_issue (
    project_id,
    title,
    body,
    severity,
    start_date,
    due_date,
    area_id,
    major_id,
    sub_process,
    owner_department,
    related_systems,
    source_type,
    source_detail,
    created_by,
    created_by_name,
    custom
  ) values (
    p_project_id,
    btrim(p_title),
    p_body,
    p_severity,
    p_start_date,
    p_due_date,
    p_area_id,
    v_major_id,
    case when v_has_analysis then btrim(p_sub_process) else '' end,
    case when v_has_analysis then btrim(p_owner_department) else '' end,
    v_related_systems,
    case when v_has_analysis then 'minutes' end,
    case when v_has_analysis then btrim(p_source_detail) else '' end,
    p_actor_id,
    nullif(btrim(p_created_by_name), ''),
    p_custom
  )
  returning
    created_issue.id,
    created_issue.code
  into v_issue_id, v_code;

  insert into public.issue_assignees (
    issue_id,
    member_id,
    project_id
  )
  select
    v_issue_id,
    assignee.member_id,
    p_project_id
  from (
    select distinct member_id
    from unnest(p_assignee_member_ids) as input(member_id)
  ) assignee;

  insert into public.issue_links (
    issue_id,
    project_id,
    link_type,
    minute_id,
    minute_version_id,
    minute_version_no,
    source_project_id,
    minute_title_snapshot,
    minute_date_snapshot,
    body_hash,
    block_index,
    block_hash,
    excerpt_snapshot,
    source_kind,
    source_key
  ) values (
    v_issue_id,
    p_project_id,
    'minute_block',
    p_minute_id,
    p_minute_version_id,
    v_minute_version_no,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_version_body_hash,
    p_block_index,
    p_block_hash,
    p_excerpt_snapshot,
    p_source_kind,
    p_source_key
  );

  issue_id := v_issue_id;
  code := v_code;
  return next;
end
$$;
revoke all on function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text, jsonb) to service_role;
do $$ begin
  if has_function_privilege('anon', 'public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text, jsonb)', 'EXECUTE') or has_function_privilege('authenticated', 'public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text, jsonb)', 'EXECUTE') or not has_function_privilege('service_role', 'public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text, jsonb)', 'EXECUTE') then
    raise exception 'MINUTE_CUSTOM_POSTCHECK: ACL';
  end if;
end $$;
