-- SP6 §4.6.3: preallocated destination, locked source snapshot, file proof and safe receipt recovery.
create or replace function public.create_project_with_settings(
  p_workspace_id uuid, p_name text, p_start_date date, p_end_date date, p_description text,
  p_values jsonb, p_copy_from uuid, p_actor uuid, p_command_id uuid, p_schema_version int)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_digest text;
  v_dup_project uuid;
  v_dup_digest text;
  v_project uuid;
  k text;
begin
  -- 둘 다 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null then
    raise exception using errcode = '22023', message = 'SETTINGS_ACTOR_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(v_values) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_values';
  end if;
  -- 같은 명령의 동시 재전송을 줄 세운다. 키는 접두 문자열로 기존 advisory 키와 겹치지 않는다
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('settings-create:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 뒤 이력을 읽어 중복을 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령 — 프로젝트가 둘 생긴다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('name', p_name, 'start_date', p_start_date, 'end_date', p_end_date,
      'description', p_description, 'values', v_values, 'copy_from', p_copy_from)::text, 'UTF8')), 'hex');
  select h.project_id, h.command_digest into v_dup_project, v_dup_digest
    from public.project_settings_history h
    join public.projects p on p.id = h.project_id
   where p.workspace_id = p_workspace_id and h.command_id = p_command_id and h.changed_by = p_actor
     and h.source in ('create', 'copy')
   limit 1;
  if v_dup_project is not null then
    if v_dup_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'project_id', v_dup_project, 'revision', 1);
  end if;
  if p_copy_from is not null then
    perform 1 from public.form_templates ft where ft.project_id = p_copy_from order by ft.id for update;
    perform 1 from public.project_settings s where s.project_id = p_copy_from for update;
  end if;
  -- Old clients cannot copy active metadata without first copying the bytes.
  if p_copy_from is not null and exists (
    select 1 from public.form_templates ft where ft.project_id = p_copy_from and ft.active
  ) then
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_COPY_REQUIRED';
  end if;
  foreach k in array array['core.level_labels', 'modules.enabled'] loop
    if not (v_values ? k) then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || k;
    end if;
  end loop;
  insert into public.projects (name, start_date, end_date, description, workspace_id)
  values (p_name, p_start_date, p_end_date, p_description, p_workspace_id)
  returning id into v_project;
  -- 행 생성 트리거(⑨-1)가 방금 빈 설정 행을 만들었다 — 그 행을 채운다
  update public.project_settings s
     set "values" = v_values, revision = 1, schema_version = p_schema_version,
         updated_at = pg_catalog.now(), updated_by = p_actor
   where s.project_id = v_project;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  insert into public.project_settings_history
    (project_id, revision, key, old_value, new_value, source, copied_from, command_id, command_digest, changed_by)
  select v_project, 1, e.key, null, e.value,
         case when p_copy_from is null then 'create' else 'copy' end, p_copy_from, p_command_id, v_digest, p_actor
    from pg_catalog.jsonb_each(v_values) as e(key, value);
  if p_copy_from is not null then
    perform public.copy_project_config(p_copy_from, v_project);
  end if;
  return pg_catalog.jsonb_build_object('status', 'applied', 'project_id', v_project, 'revision', 1);
end $$;

create or replace function public.create_project_with_settings(
  p_workspace_id uuid, p_name text, p_start_date date, p_end_date date, p_description text,
  p_values jsonb, p_copy_from uuid, p_actor uuid, p_command_id uuid, p_schema_version int,
  p_destination_id uuid, p_source_revision bigint, p_form_manifest jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_digest text;
  v_dup_project uuid;
  v_dup_digest text;
  v_project uuid;
  k text;
  v_revision bigint;
  v_manifest jsonb;
  v_ft record;
  v_path text;
begin
  if not public.actor_is_workspace_admin(p_actor, p_workspace_id) then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  -- 둘 다 잠금보다 먼저다 — null 키의 advisory 잠금은 잠그지 않고 중복 조회도 맞지 않아 멱등이 조용히 사라진다
  if p_actor is null then
    raise exception using errcode = '22023', message = 'SETTINGS_ACTOR_REQUIRED';
  end if;
  if p_command_id is null then
    raise exception using errcode = '22023', message = 'COMMAND_ID_REQUIRED';
  end if;
  if pg_catalog.jsonb_typeof(v_values) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:p_values';
  end if;
  -- 같은 명령의 동시 재전송을 줄 세운다. 키는 접두 문자열로 기존 advisory 키와 겹치지 않는다
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('settings-create:' || p_actor::text || ':' || p_command_id::text, 0));
  -- 격리 수준 규칙(0011 공통, 스펙 D1): 잠금 뒤 이력을 읽어 중복을 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령 — 프로젝트가 둘 생긴다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('name', p_name, 'start_date', p_start_date, 'end_date', p_end_date,
      'description', p_description, 'values', v_values, 'copy_from', p_copy_from)::text, 'UTF8')), 'hex');
  select h.project_id, h.command_digest into v_dup_project, v_dup_digest
    from public.project_settings_history h
    join public.projects p on p.id = h.project_id
   where p.workspace_id = p_workspace_id and h.command_id = p_command_id and h.changed_by = p_actor
     and h.source in ('create', 'copy')
   limit 1;
  if v_dup_project is not null then
    if v_dup_digest is distinct from v_digest then
      raise exception using errcode = '23505', message = 'COMMAND_REUSED';
    end if;
    return pg_catalog.jsonb_build_object('status', 'duplicate', 'project_id', v_dup_project, 'revision', 1);
  end if;
  if p_copy_from is null or p_destination_id is null or p_source_revision is null
     or p_source_revision < 0 or pg_catalog.jsonb_typeof(p_form_manifest) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_COPY_INPUT';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_copy_from and p.workspace_id = p_workspace_id) then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  -- Same lock order as template activation: templates by id, then source settings.
  perform 1 from public.form_templates ft where ft.project_id = p_copy_from order by ft.id for update;
  select s.revision into v_revision from public.project_settings s where s.project_id = p_copy_from for update;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.id), '[]'::jsonb) into v_manifest
    from (select ft.id, ft.form_kind, ft.storage_path, ft.size_bytes, ft.version, ft.placeholders, ft.file_name
            from public.form_templates ft where ft.project_id = p_copy_from and ft.active) x;
  if v_revision is distinct from p_source_revision or v_manifest is distinct from p_form_manifest then
    raise exception using errcode = '40001', message = 'FORM_TEMPLATE_COPY_CHANGED';
  end if;
  for v_ft in select * from public.form_templates ft where ft.project_id = p_copy_from and ft.active loop
    if public.form_template_path_project(v_ft.storage_path, false) is distinct from p_copy_from
       or pg_catalog.split_part(v_ft.storage_path, '/', 6) = 'incoming'
       or pg_catalog.split_part(v_ft.storage_path, '/', 5) <> v_ft.form_kind
       or pg_catalog.split_part(v_ft.storage_path, '/', 2) <> p_workspace_id::text then
      raise exception using errcode = '22023', message = 'FORM_TEMPLATE_COPY_INPUT';
    end if;
    v_path := 'ws/' || p_workspace_id::text || '/p/' || p_destination_id::text || '/' || v_ft.form_kind || '/v1.' ||
      case when v_ft.form_kind like '%_pptx' then 'pptx' else 'xlsx' end;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'form-templates' and o.name = v_path
                    and (o.metadata ->> 'size')::bigint = v_ft.size_bytes) then
      raise exception using errcode = '22023', message = 'FORM_TEMPLATE_COPY_MISSING';
    end if;
    if (v_values -> ('forms.' || v_ft.form_kind) ->> 'template_id') is distinct from v_ft.id::text then
      raise exception using errcode = '22023', message = 'FORM_TEMPLATE_COPY_INPUT';
    end if;
  end loop;
  foreach k in array array['core.level_labels', 'modules.enabled'] loop
    if not (v_values ? k) then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || k;
    end if;
  end loop;
  insert into public.projects (id, name, start_date, end_date, description, workspace_id)
  values (p_destination_id, p_name, p_start_date, p_end_date, p_description, p_workspace_id)
  returning id into v_project;
  -- 행 생성 트리거(⑨-1)가 방금 빈 설정 행을 만들었다 — 그 행을 채운다
  update public.project_settings s
     set "values" = v_values, revision = 1, schema_version = p_schema_version,
         updated_at = pg_catalog.now(), updated_by = p_actor
   where s.project_id = v_project;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  insert into public.project_settings_history
    (project_id, revision, key, old_value, new_value, source, copied_from, command_id, command_digest, changed_by)
  select v_project, 1, e.key, null, e.value,
         case when p_copy_from is null then 'create' else 'copy' end, p_copy_from, p_command_id, v_digest, p_actor
    from pg_catalog.jsonb_each(v_values) as e(key, value)
   where e.key not like 'forms.%';
  if p_copy_from is not null then
    perform public.copy_project_config(p_copy_from, v_project);
    -- History is immutable. Insert form keys after their ids have been rewritten.
    insert into public.project_settings_history
      (project_id, revision, key, old_value, new_value, source, copied_from, command_id, command_digest, changed_by)
    select v_project, 1, e.key, null, e.value, 'copy', p_copy_from, p_command_id, v_digest, p_actor
      from public.project_settings s cross join lateral pg_catalog.jsonb_each(s."values") e
     where s.project_id = v_project and e.key like 'forms.%';
  end if;
  return pg_catalog.jsonb_build_object('status', 'applied', 'project_id', v_project, 'revision', 1);
end $$;
revoke all on function public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int, uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int, uuid, bigint, jsonb) to service_role;

create function public.get_project_creation_receipt(
  p_workspace_id uuid, p_actor uuid, p_command_id uuid, p_request jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_project uuid; v_digest text; v_expected text;
begin
  if not public.actor_is_workspace_admin(p_actor, p_workspace_id) then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  if p_command_id is null or pg_catalog.jsonb_typeof(p_request) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'FORM_TEMPLATE_COPY_INPUT';
  end if;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'SETTINGS_ISOLATION';
  end if;
  -- Wait out any create transaction before deciding whether its files are unreferenced.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('settings-create:' || p_actor::text || ':' || p_command_id::text, 0));
  select h.project_id, h.command_digest into v_project, v_digest
    from public.project_settings_history h join public.projects p on p.id = h.project_id
   where p.workspace_id = p_workspace_id and h.command_id = p_command_id and h.changed_by = p_actor
     and h.source in ('create', 'copy') limit 1;
  if v_project is null then return null; end if;
  v_expected := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_request::text, 'UTF8')), 'hex');
  if v_digest is distinct from v_expected then
    raise exception using errcode = '23505', message = 'COMMAND_REUSED';
  end if;
  return pg_catalog.jsonb_build_object('status', 'duplicate', 'project_id', v_project, 'revision', 1);
end $$;
revoke all on function public.get_project_creation_receipt(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.get_project_creation_receipt(uuid, uuid, uuid, jsonb) to service_role;

-- Fail installation if the new endpoints accidentally become session-callable.
do $$
begin
  if pg_catalog.has_function_privilege('authenticated', 'public.get_project_creation_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', 'public.get_project_creation_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', 'public.create_project_with_settings(uuid,text,date,date,text,jsonb,uuid,uuid,uuid,integer,uuid,bigint,jsonb)', 'EXECUTE')
     or not pg_catalog.has_function_privilege('service_role', 'public.get_project_creation_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'FORM_COPY_PRIVILEGES';
  end if;
end $$;
