-- Preserve copied projects and files; restore only the prior creation API.
drop function public.get_project_creation_receipt(uuid, uuid, uuid, jsonb);
drop function public.create_project_with_settings(uuid, text, date, date, text, jsonb, uuid, uuid, uuid, int, uuid, bigint, jsonb);
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
