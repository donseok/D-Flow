-- SP6: preserve SP5c validation and isolate form template storage/privileges.
revoke all on public.form_templates from authenticated;
grant select on public.form_templates to authenticated;
create or replace function public.form_template_key_in_use(p_project_id uuid,p_entity text,p_key text)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare v_kind text; v_form jsonb; v_scan jsonb; v_settings jsonb;
begin
  select s."values" into v_settings from public.project_settings s where s.project_id=p_project_id;
  for v_kind,v_scan in select ft.form_kind,ft.placeholders from public.form_templates ft
    where ft.project_id=p_project_id and ft.active and
      case p_entity when 'issue' then ft.form_kind='issue_analysis_pptx'
        when 'wbs_item' then ft.form_kind='wbs_export_xlsx'
        when 'weekly_row' then ft.form_kind in ('weekly_report_pptx','weekly_report_xlsx') else false end
  loop
    v_form := v_settings -> ('forms.' || v_kind);
    if exists(select 1 from jsonb_each_text(coalesce(v_form -> 'mapping','{}'::jsonb)) x
      where x.value ~ ('(^|\.)custom\.' || p_key || '$'))
      or exists(select 1 from jsonb_array_elements(coalesce(v_scan -> 'placeholders','[]'::jsonb)) x
        where x ->> 'path' ~ ('(^|\.)custom\.' || p_key || '$')) then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function public.form_template_key_in_use(uuid,text,text) from public,anon,authenticated;
grant execute on function public.form_template_key_in_use(uuid,text,text) to service_role;

create or replace function public.custom_fields_ref_check(p_project_id uuid,p_entity text,p_old jsonb,p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  old_defs jsonb := public.custom_field_defs_of(p_entity,p_old);
  new_defs jsonb := public.custom_field_defs_of(p_entity,p_new);
  tbl text := public.custom_field_table(p_entity); o jsonb; n jsonb; k text; cnt bigint; reason text;
begin
  for o in select jsonb_array_elements(old_defs) loop
    k := o ->> 'key';
    select e into n from jsonb_array_elements(new_defs) e where e ->> 'key'=k limit 1;
    if n is null and public.form_template_key_in_use(p_project_id,p_entity,k) then
      raise exception using errcode='23514',message='FORM_MAPPING_IN_USE',detail=jsonb_build_object('key','fields.' || p_entity,'code',k)::text;
    end if;
    reason := null;
    if n is null then reason := 'removed';
    elsif n ->> 'type' <> o ->> 'type' and not (o ->> 'type'='text' and n ->> 'type'='multiline') and not (o ->> 'type'='multiline' and n ->> 'type'='text') then reason := 'type'; end if;
    if reason is not null then
      execute format('select count(*) from public.%I where project_id=$1 and custom ? $2',tbl) into cnt using p_project_id,k;
    else
      execute format('select count(*) from public.%I where project_id=$1 and custom ? $2 and public.custom_value_error($3,custom -> $2,custom -> $2) is not null',tbl) into cnt using p_project_id,k,n;
      reason := 'invalid_values';
    end if;
    if cnt > 0 then raise exception using errcode='23514',message='SETTINGS_CODE_IN_USE:fields.' || p_entity,detail=jsonb_build_object('key','fields.' || p_entity,'code',k,'reason',reason,'count',cnt)::text; end if;
  end loop;
  for n in select jsonb_array_elements(new_defs) loop
    if (n ->> 'required')::boolean then
      k := n ->> 'key';
      execute format('select count(*) from public.%I where project_id=$1 and not custom ? $2',tbl) into cnt using p_project_id,k;
      if cnt > 0 then raise exception using errcode='23514',message='SETTINGS_CODE_IN_USE:fields.' || p_entity,detail=jsonb_build_object('key','fields.' || p_entity,'code',k,'reason','missing','count',cnt)::text; end if;
    end if;
  end loop;
end $$;
revoke all on function public.custom_fields_ref_check(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.custom_fields_ref_check(uuid,text,jsonb,jsonb) to service_role;


-- A form path differs from the frozen seven-part attachment paths. Never broaden
-- storage_ws/storage_project: their entity segment remains a UUID for other buckets.
create function public.form_template_path_project(p_name text,p_incoming_only boolean) returns uuid
language sql immutable set search_path to '' as $$
 select case when p_incoming_only is not null
   and split_part(p_name,'/',1)='ws' and split_part(p_name,'/',3)='p'
   and public.uuid_or_null(split_part(p_name,'/',2)) is not null
   and split_part(p_name,'/',5) in ('weekly_report_pptx','weekly_report_xlsx','issue_analysis_pptx','wbs_export_xlsx')
   and right(p_name,5)='.' || right(split_part(p_name,'/',5),4)
   and ((array_length(string_to_array(p_name,'/'),1)=7 and split_part(p_name,'/',6)='incoming'
         and public.uuid_or_null(split_part(split_part(p_name,'/',7),'.',1)) is not null
         and split_part(p_name,'/',7) ~ '^[0-9a-fA-F-]{36}\.(pptx|xlsx)$')
     or (not p_incoming_only and array_length(string_to_array(p_name,'/'),1)=6
         and split_part(p_name,'/',6) ~ '^v[1-9][0-9]*\.(pptx|xlsx)$'))
 then public.uuid_or_null(split_part(p_name,'/',4)) end
$$;
revoke all on function public.form_template_path_project(text,boolean) from public,anon,authenticated;
grant execute on function public.form_template_path_project(text,boolean) to authenticated,service_role;
drop policy "form-templates read" on storage.objects;
create policy "form-templates read" on storage.objects for select to authenticated
using (bucket_id='form-templates' and public.is_project_admin(public.form_template_path_project(name,false))
  and exists(select 1 from public.projects p where p.id=public.form_template_path_project(objects.name,false)
    and p.workspace_id=public.uuid_or_null(split_part(objects.name,'/',2))));
drop policy "form-templates insert" on storage.objects;
create policy "form-templates insert" on storage.objects for insert to authenticated
with check (bucket_id='form-templates' and public.is_project_admin(public.form_template_path_project(name,true))
  and exists(select 1 from public.projects p where p.id=public.form_template_path_project(objects.name,true)
    and p.workspace_id=public.uuid_or_null(split_part(objects.name,'/',2))));

do $$ begin
  if has_table_privilege('authenticated','public.form_templates','INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated','public.form_template_key_in_use(uuid,text,text)','EXECUTE') then
    raise exception 'FORM_GUARDS_POSTCHECK: excessive privileges';
  end if;
end $$;
