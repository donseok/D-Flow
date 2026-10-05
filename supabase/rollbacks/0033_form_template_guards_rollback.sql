-- Restore the preceding schema boundary without removing data or objects.
drop policy if exists "form-templates read" on storage.objects;
create policy "form-templates read" on storage.objects for select to authenticated
  using (bucket_id = 'form-templates'
         and public.storage_project(name) is not null
         and public.is_project_admin(public.storage_project(name)));

drop policy if exists "form-templates insert" on storage.objects;
create policy "form-templates insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'form-templates'
              and public.storage_project(name) is not null
              and exists (
                select 1 from public.projects p
                 where p.id = public.storage_project(objects.name)
                   and p.workspace_id = public.storage_ws(objects.name)
              )
              and split_part(name, '/', 5) <> ''
              and split_part(name, '/', 6) = 'incoming'
              and public.is_project_admin(public.storage_project(name)));



drop function public.form_template_path_project(text,boolean);
grant all on public.form_templates to authenticated;
create or replace function public.form_template_key_in_use(p_project_id uuid, p_entity text, p_key text)
returns boolean language plpgsql stable security definer set search_path to '' as $$
declare
  v_settings jsonb;
  v_form jsonb;
  v_kind text;
  v_path text;
  v_ph jsonb;
begin
  select s."values" into v_settings
    from public.project_settings s
   where s.project_id = p_project_id;

  if v_settings is not null then
    for v_kind in select * from (values ('weekly_report_pptx'),('weekly_report_xlsx'),('issue_analysis_pptx'),('wbs_export_xlsx')) as k(kind) loop
      v_form := v_settings -> ('forms.' || v_kind);
      if v_form is not null and v_form ->> 'template_id' is not null then
        if v_form -> 'mapping' is not null then
          for v_path in select jsonb_each_text.value from pg_catalog.jsonb_each_text(v_form -> 'mapping') loop
            if v_path ~ ('(^|\.)custom\.' || p_key || '$') then
              return true;
            end if;
          end loop;
        end if;
      end if;
    end loop;
  end if;

  for v_ph in
    select ft.placeholders
      from public.form_templates ft
     where ft.project_id = p_project_id and ft.active = true
  loop
    if exists (
      select 1
        from pg_catalog.jsonb_array_elements(coalesce(v_ph -> 'placeholders', '[]'::jsonb)) elem
       where (elem ->> 'path') ~ ('(^|\.)custom\.' || p_key || '$')
    ) then
      return true;
    end if;
  end loop;

  return false;
end $$;

revoke all on function public.form_template_key_in_use(uuid, text, text) from public, anon;
grant execute on function public.form_template_key_in_use(uuid, text, text) to authenticated, service_role;

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
      if public.form_template_key_in_use(p_project_id, p_entity, k) then
        raise exception using errcode = '23514', message = 'FORM_MAPPING_IN_USE',
          detail = pg_catalog.jsonb_build_object('key', 'fields.' || p_entity, 'code', k)::text;
      end if;
      execute format('select count(*) from public.%I where project_id=$1 and custom ? $2', tbl) into cnt using p_project_id, k;
      if cnt > 0 then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:fields.' || p_entity,
          detail = pg_catalog.jsonb_build_object('key', 'fields.' || p_entity, 'code', k, 'reason', 'deleted', 'count', cnt)::text;
      end if;
    end if;
  end loop;

  for n in select jsonb_array_elements(new_defs) loop
    if (n ->> 'required')::boolean then
      k := n ->> 'key';
      execute format('select count(*) from public.%I where project_id=$1 and not custom ? $2', tbl) into cnt using p_project_id, k;
      if cnt > 0 then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:fields.' || p_entity,
          detail = pg_catalog.jsonb_build_object('key', 'fields.' || p_entity, 'code', k, 'reason', 'missing', 'count', cnt)::text;
      end if;
    end if;
  end loop;
end $$;
revoke all on function public.custom_fields_ref_check(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.custom_fields_ref_check(uuid, text, jsonb, jsonb) to service_role;

