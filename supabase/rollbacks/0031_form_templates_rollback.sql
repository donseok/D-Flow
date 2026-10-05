-- 0031_form_templates_rollback.sql
-- 0031_form_templates.sql 의 역변환

-- ① Storage 정책 및 버킷 제거
drop policy if exists "form-templates read" on storage.objects;
drop policy if exists "form-templates insert" on storage.objects;
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'form-templates';
delete from storage.buckets where id = 'form-templates';
reset storage.allow_delete_query;

-- ② form_templates 테이블 제거
drop table if exists public.form_templates cascade;

-- ③ copy_project_config 0017 버전으로 복구
create or replace function public.copy_project_config(p_src uuid, p_dst uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_src_ws uuid;
  v_dst_ws uuid;
begin
  select p.workspace_id into v_src_ws from public.projects p where p.id = p_src;
  select p.workspace_id into v_dst_ws from public.projects p where p.id = p_dst;
  if v_src_ws is null or v_dst_ws is null or v_src_ws <> v_dst_ws or p_src = p_dst then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  if exists (select 1 from public.project_areas a where a.project_id = p_dst)
     or exists (select 1 from public.teams t where t.project_id = p_dst) then
    raise exception using errcode = '23514', message = 'COPY_TARGET_NOT_EMPTY';
  end if;
  if not exists (select 1 from public.project_settings_history h
                  where h.project_id = p_dst and h.revision = 1 and h.source = 'copy' and h.copied_from = p_src) then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  insert into public.teams (code, name, sort_order, active, progress_visible, project_id, workspace_id, color)
  select t.code, t.name, t.sort_order, t.active, t.progress_visible, p_dst, t.workspace_id, t.color
    from public.teams t where t.project_id = p_src;
  insert into public.project_areas (project_id, kind, code, name, sort_order, active, meta)
  select p_dst, a.kind, a.code, a.name, a.sort_order, a.active, a.meta
    from public.project_areas a where a.project_id = p_src;
  insert into public.area_teams (area_id, team_id, kind)
  select distinct on (na.id, coalesce(nt.id, ot.id)) na.id, coalesce(nt.id, ot.id), x.kind
    from public.area_teams x
    join public.project_areas oa on oa.id = x.area_id and oa.project_id = p_src
    join public.project_areas na on na.project_id = p_dst and na.kind = oa.kind and na.code = oa.code
    join public.teams ot on ot.id = x.team_id
    left join public.teams nt on nt.project_id = p_dst and nt.code = ot.code
   order by na.id, coalesce(nt.id, ot.id), (x.kind = 'primary') desc;
end $$;
revoke all on function public.copy_project_config(uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_project_config(uuid, uuid) to service_role;

-- ④ custom_fields_ref_check 0027 버전으로 복구
create or replace function public.custom_fields_ref_check(p_project_id uuid, p_entity text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  tbl text := public.custom_field_table(p_entity);
  old_defs jsonb := public.custom_field_defs_of(p_entity, p_old);
  new_defs jsonb := public.custom_field_defs_of(p_entity, p_new);
  o jsonb; n jsonb; k text; cnt bigint;
begin
  for o in select jsonb_array_elements(old_defs) loop
    k := o ->> 'key';
    select e into n from jsonb_array_elements(new_defs) e where e ->> 'key' = k limit 1;
    if n is null then
      execute format('select count(*) from public.%I where project_id=$1 and custom ? $2', tbl) into cnt using p_project_id, k;
      if cnt > 0 then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:fields.' || p_entity,
          detail = jsonb_build_object('key', 'fields.' || p_entity, 'code', k, 'reason', 'deleted', 'count', cnt)::text;
      end if;
    end if;
  end loop;

  for n in select jsonb_array_elements(new_defs) loop
    if (n ->> 'required')::boolean then
      k := n ->> 'key';
      execute format('select count(*) from public.%I where project_id=$1 and not custom ? $2', tbl) into cnt using p_project_id, k;
      if cnt > 0 then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:fields.' || p_entity,
          detail = jsonb_build_object('key', 'fields.' || p_entity, 'code', k, 'reason', 'missing', 'count', cnt)::text;
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.custom_fields_ref_check(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.custom_fields_ref_check(uuid, text, jsonb, jsonb) to service_role;

-- ⑤ custom_field_command 0027 버전으로 복구
create or replace function public.custom_field_command(p_kind text, p_project_id uuid, p_expected_revision bigint, p_command_id uuid, p_entity text, p_key text, p_value jsonb, p_expected_count bigint, p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  tbl text := public.custom_field_table(p_entity); ws uuid; digest text; dup public.command_receipts%rowtype;
  settings jsonb; defs jsonb; next_defs jsonb; d jsonb; rev bigint; ver int; row_id uuid; cnt bigint; result jsonb; old_flag text;
begin
  if p_kind is null or p_kind not in ('custom_field_backfill','custom_field_purge') or p_command_id is null or p_expected_revision is null
     or p_key is null or p_key !~ '^[a-z][a-z0-9_]{0,31}$' or p_actor is null
     or (p_kind='custom_field_purge' and (p_expected_count is null or p_expected_count < 0)) then raise exception using errcode='22023',message='CUSTOM_FIELD_COMMAND_INPUT'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then raise exception using errcode='25001',message='CUSTOM_FIELD_ISOLATION'; end if;
  if not public.actor_is_project_admin(p_actor,p_project_id) then raise exception using errcode='42501',message='CUSTOM_FIELD_COMMAND_FORBIDDEN'; end if;
  select workspace_id into ws from public.projects where id=p_project_id;
  if not found then raise exception using errcode='P0001',message='PROJECT_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('custom-command:' || p_actor::text || ':' || p_command_id::text || ':' || p_kind,0));
  digest := encode(sha256(convert_to(jsonb_build_object('project',p_project_id,'entity',p_entity,'key',p_key,'value',p_value,'count',p_expected_count)::text,'UTF8')),'hex');
  select * into dup from public.command_receipts where actor=p_actor and command_id=p_command_id and kind=p_kind;
  if found then
    if dup.command_digest is distinct from digest then raise exception using errcode='23505',message='COMMAND_REUSED'; end if;
    return dup.result || jsonb_build_object('status','duplicate');
  end if;
  for row_id in execute format('select id from public.%I where project_id=$1 order by id for update',tbl) using p_project_id loop null; end loop;
  select s."values",s.revision,s.schema_version into settings,rev,ver from public.project_settings s where s.project_id=p_project_id for update;
  if not found then raise exception using errcode='P0001',message='SETTINGS_ROW_MISSING'; end if;
  if rev is distinct from p_expected_revision then raise exception using errcode='P0001',message='SETTINGS_REVISION_CONFLICT',detail=rev::text; end if;
  defs := public.custom_field_defs_of(p_entity,settings -> ('fields.' || p_entity));
  select e into d from jsonb_array_elements(defs) e where e ->> 'key'=p_key limit 1;
  if d is null then raise exception using errcode='23514',message='CUSTOM_FIELD_UNKNOWN:' || p_key; end if;
  old_flag := coalesce(current_setting('dflow.custom_field_admin',true),'');
  if p_kind='custom_field_backfill' then
    d := d || jsonb_build_object('required',true,'default',coalesce(d -> 'default',p_value));
    if public.custom_value_error(d,p_value,null) is not null then raise exception using errcode='23514',message='CUSTOM_FIELD_INVALID:' || p_key || ':' || public.custom_value_error(d,p_value,null); end if;
    select jsonb_agg(case when e ->> 'key'=p_key then d else e end order by i) into next_defs from jsonb_array_elements(defs) with ordinality x(e,i);
    perform public.custom_field_defs_of(p_entity,next_defs);
    perform set_config('dflow.custom_field_admin','on',true);
    execute format('update public.%I set custom=custom || jsonb_build_object($2::text,$3::jsonb) where project_id=$1 and not custom ? $2',tbl) using p_project_id,p_key,p_value;
    get diagnostics cnt = row_count;
  else
    execute format('select count(*) from public.%I where project_id=$1 and custom ? $2',tbl) into cnt using p_project_id,p_key;
    if cnt is distinct from p_expected_count then raise exception using errcode='P0001',message='CUSTOM_FIELD_COUNT_CONFLICT',detail=cnt::text; end if;
    perform set_config('dflow.custom_field_admin','on',true);
    execute format('update public.%I set custom=custom - $2 where project_id=$1 and custom ? $2',tbl) using p_project_id,p_key;
    select coalesce(jsonb_agg(e order by i),'[]'::jsonb) into next_defs from jsonb_array_elements(defs) with ordinality x(e,i) where e ->> 'key' <> p_key;
  end if;
  perform set_config('dflow.custom_field_admin',old_flag,true);
  result := public.apply_project_settings(p_project_id,rev,p_command_id,jsonb_build_object('fields.' || p_entity,next_defs),'{}'::text[],p_actor,ver,'edit');
  result := result || jsonb_build_object('count',cnt);
  insert into public.command_receipts(actor,command_id,kind,workspace_id,project_id,command_digest,result) values(p_actor,p_command_id,p_kind,ws,p_project_id,digest,result);
  return result;
end $$;
revoke all on function public.custom_field_command(text,uuid,bigint,uuid,text,text,jsonb,bigint,uuid) from public,anon,authenticated,service_role;

-- ⑥ form_template_key_in_use 제거
drop function if exists public.form_template_key_in_use(uuid, text, text);
