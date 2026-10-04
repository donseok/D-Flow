-- 0031_form_templates.sql — SP6 양식 병합 엔진 (Form Template Merging Engine)
-- 정본: docs/superpowers/specs/2026-09-23-generic-platform-design.md §4.6
-- 개정: docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §3.6.5, §4.5, §4.6.3
--
-- 무엇:
--   ① form_templates 테이블 생성 (프로젝트별 양식 템플릿 버전 관리, 활성 유일 인덱스, RLS)
--   ② Storage 버킷 form-templates 등록 및 RLS 정책 (read: project_admin, insert: incoming 경로만)
--   ③ FORM_MAPPING_IN_USE 가드: 활성 양식 매핑/플레이스홀더가 참조하는 사용자 정의 필드 삭제·purge 차단
--   ④ copy_project_config 연동: 프로젝트 복사 시 원본 활성 양식의 form_templates 메타 복사 (v1) 및 template_id 갱신
--   ⑤ 사후검사

-- ① form_templates 테이블 ---------------------------------------------------
create table if not exists public.form_templates (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  form_kind     text not null check (form_kind in
                  ('weekly_report_pptx','weekly_report_xlsx','issue_analysis_pptx','wbs_export_xlsx')),
  file_name     text not null,
  storage_path  text not null unique,
  size_bytes    integer not null check (size_bytes between 1 and 10485760),
  version       integer not null check (version >= 1),
  placeholders  jsonb not null,
  active        boolean not null default false,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (project_id, form_kind, version)
);

create unique index if not exists form_templates_one_active
  on public.form_templates (project_id, form_kind) where active;
create index if not exists form_templates_project on public.form_templates (project_id);

alter table public.form_templates enable row level security;

drop policy if exists form_templates_read on public.form_templates;
create policy form_templates_read on public.form_templates for select to authenticated
  using (project_id in (select public.accessible_project_ids()));

revoke all on table public.form_templates from public, anon;
grant select on table public.form_templates to authenticated;
grant all on table public.form_templates to service_role;

-- ② Storage 버킷 form-templates 및 정책 -------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('form-templates', 'form-templates', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = excluded.public;

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


-- ③ FORM_MAPPING_IN_USE 가드 ------------------------------------------------
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

-- custom_fields_ref_check 업데이트: 정의 삭제 시 FORM_MAPPING_IN_USE 검사 추가
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

-- custom_field_command 업데이트: purge 시 FORM_MAPPING_IN_USE 검사 추가
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
  -- All entity rows in id order, then settings. A competing single UPDATE uses the same row→settings order.
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
    if public.form_template_key_in_use(p_project_id, p_entity, p_key) then
      raise exception using errcode = '23514', message = 'FORM_MAPPING_IN_USE',
        detail = pg_catalog.jsonb_build_object('key', 'fields.' || p_entity, 'code', p_key)::text;
    end if;
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

-- ④ copy_project_config 연동 ------------------------------------------------
create or replace function public.copy_project_config(p_src uuid, p_dst uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_src_ws uuid;
  v_dst_ws uuid;
  v_actor uuid;
  v_ft record;
  v_ext text;
  v_new_path text;
  v_new_ft_id uuid;
begin
  select p.workspace_id into v_src_ws from public.projects p where p.id = p_src;
  select p.workspace_id into v_dst_ws from public.projects p where p.id = p_dst;
  if v_src_ws is null or v_dst_ws is null or v_src_ws <> v_dst_ws or p_src = p_dst then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  if exists (select 1 from public.project_areas a where a.project_id = p_dst)
     or exists (select 1 from public.teams t where t.project_id = p_dst)
     or exists (select 1 from public.form_templates ft where ft.project_id = p_dst) then
    raise exception using errcode = '23514', message = 'COPY_TARGET_NOT_EMPTY';
  end if;

  select h.changed_by into v_actor
    from public.project_settings_history h
   where h.project_id = p_dst and h.revision = 1 and h.source = 'copy' and h.copied_from = p_src;
  if v_actor is null then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;

  -- 프로젝트 전용 팀: 코드가 (workspace, project, code) 로 유일하므로 코드로 옛 팀 ↔ 새 팀을 잇는다
  insert into public.teams (code, name, sort_order, active, progress_visible, project_id, workspace_id, color)
  select t.code, t.name, t.sort_order, t.active, t.progress_visible, p_dst, t.workspace_id, t.color
    from public.teams t where t.project_id = p_src;

  -- 영역: (project, kind, code) 로 유일 — 같은 방법
  insert into public.project_areas (project_id, kind, code, name, sort_order, active, meta)
  select p_dst, a.kind, a.code, a.name, a.sort_order, a.active, a.meta
    from public.project_areas a where a.project_id = p_src;

  -- 영역-팀: 대상에 같은 code 의 전용 팀이 있으면 그 팀, 없으면 같은 공용 팀
  insert into public.area_teams (area_id, team_id, kind)
  select distinct on (na.id, coalesce(nt.id, ot.id)) na.id, coalesce(nt.id, ot.id), x.kind
    from public.area_teams x
    join public.project_areas oa on oa.id = x.area_id and oa.project_id = p_src
    join public.project_areas na on na.project_id = p_dst and na.kind = oa.kind and na.code = oa.code
    join public.teams ot on ot.id = x.team_id
    left join public.teams nt on nt.project_id = p_dst and nt.code = ot.code
   order by na.id, coalesce(nt.id, ot.id), (x.kind = 'primary') desc;

  -- 양식 템플릿 메타 복사 (SP6 §4.6.3)
  for v_ft in
    select * from public.form_templates
     where project_id = p_src and active = true
  loop
    v_ext := substring(v_ft.storage_path from '\.[^.]+$');
    v_new_path := 'ws/' || v_dst_ws::text || '/p/' || p_dst::text || '/' || v_ft.form_kind || '/v1' || coalesce(v_ext, '');
    v_new_ft_id := gen_random_uuid();
    insert into public.form_templates (
      id, project_id, form_kind, file_name, storage_path, size_bytes, version, placeholders, active, uploaded_by, created_at
    ) values (
      v_new_ft_id, p_dst, v_ft.form_kind, v_ft.file_name, v_new_path, v_ft.size_bytes, 1, v_ft.placeholders, true, v_actor, pg_catalog.now()
    );
    -- update forms.<kind>.template_id in project_settings for p_dst
    update public.project_settings
       set "values" = jsonb_set(
         "values",
         array['forms.' || v_ft.form_kind],
         coalesce("values" -> ('forms.' || v_ft.form_kind), '{}'::jsonb) || jsonb_build_object('template_id', v_new_ft_id::text)
       )
     where project_id = p_dst;
  end loop;
end $$;
revoke all on function public.copy_project_config(uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_project_config(uuid, uuid) to service_role;

-- ⑤ 사후검사 ----------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='form_templates') then
    raise exception 'FORM_TEMPLATES_POSTCHECK: form_templates 테이블이 존재하지 않습니다';
  end if;

  if not exists (select 1 from storage.buckets where id='form-templates') then
    raise exception 'FORM_TEMPLATES_POSTCHECK: storage.buckets에 form-templates가 없습니다';
  end if;

  if not exists (select 1 from pg_proc where oid='public.form_template_key_in_use(uuid, text, text)'::regprocedure and prosecdef) then
    raise exception 'FORM_TEMPLATES_POSTCHECK: form_template_key_in_use 함수가 DEFINER가 아닙니다';
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='form_templates' and policyname='form_templates_read') then
    raise exception 'FORM_TEMPLATES_POSTCHECK: form_templates_read RLS 정책이 없습니다';
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='form-templates read') then
    raise exception 'FORM_TEMPLATES_POSTCHECK: storage form-templates read 정책이 없습니다';
  end if;

  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='form-templates insert') then
    raise exception 'FORM_TEMPLATES_POSTCHECK: storage form-templates insert 정책이 없습니다';
  end if;
end $$;
