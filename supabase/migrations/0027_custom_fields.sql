-- 0027_custom_fields — SP5c DB contract (revision design §3.6).
-- Three row JSON columns, strict definition/value validation, settings-row serialization,
-- member/admin key checks, reference checks and atomic backfill/purge commands.
-- Migration and application code are committed separately. Original reserved 0023 was consumed by SP5 vocab.
-- All new functions have explicit ACLs; authenticated can only write through existing row RLS.
-- Rollback refuses to remove populated fields/definitions; immutable command receipts remain auditable.

-- Unregistered pre-existing values must be reviewed before activating this schema.
do $$
begin
  if exists(select 1 from public.project_settings s cross join lateral jsonb_each(s."values") e
            where e.key in ('fields.wbs_item','fields.issue','fields.weekly_row') and e.value <> '[]'::jsonb) then
    raise exception using errcode='23514',message='CUSTOM_FIELDS_PRECHECK:기존 미등록 필드 설정을 확인한 뒤 적용하세요';
  end if;
end $$;

-- SP5c: pure value/definition validation shared by triggers and definition commands.
create function public.custom_value_error(p_def jsonb, p_value jsonb, p_prev jsonb default null)
returns text language plpgsql immutable set search_path to '' as $$
declare
  t text := p_def ->> 'type'; l jsonb := coalesce(p_def -> 'limits', '{}'::jsonb);
  s text; n numeric; o jsonb; c text; d date;
begin
  if p_value is null or p_value = 'null'::jsonb then return 'null'; end if;
  if t in ('text', 'multiline') then
    if jsonb_typeof(p_value) <> 'string' then return 'type'; end if;
    s := p_value #>> '{}';
    if s = '' and (t = 'text' or (p_def ->> 'required')::boolean) then return 'empty'; end if;
    if t = 'text' and (strpos(s, E'\n') > 0 or strpos(s, E'\r') > 0) then return 'newline'; end if;
    if char_length(s) > coalesce((l ->> 'maxLength')::int, case when t = 'text' then 200 else 2000 end) then return 'length'; end if;
  elsif t = 'number' then
    if jsonb_typeof(p_value) <> 'number' then return 'type'; end if;
    n := (p_value #>> '{}')::numeric;
    if abs(n) > 1e12 then return 'number'; end if;
    if scale(trim_scale(n)) > coalesce((l ->> 'decimals')::int, 0) then return 'decimals'; end if;
    if (l ? 'min' and n < (l ->> 'min')::numeric) or (l ? 'max' and n > (l ->> 'max')::numeric) then return 'range'; end if;
  elsif t = 'date' then
    if jsonb_typeof(p_value) <> 'string' then return 'type'; end if;
    s := p_value #>> '{}';
    if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(s, 5) = '0000-' then return 'date'; end if;
    begin
      d := s::date;
      if to_char(d, 'YYYY-MM-DD') <> s then return 'date'; end if;
    exception when datetime_field_overflow or invalid_datetime_format then return 'date'; end;
  elsif t = 'boolean' then
    if jsonb_typeof(p_value) <> 'boolean' then return 'type'; end if;
  elsif t = 'select' then
    if jsonb_typeof(p_value) <> 'string' then return 'type'; end if;
    select e into o from jsonb_array_elements(p_def -> 'options') e where e ->> 'code' = p_value #>> '{}' limit 1;
    if o is null then return 'option'; end if;
    if not (o ->> 'active')::boolean and p_value is distinct from p_prev then return 'inactive_option'; end if;
  elsif t = 'multiselect' then
    if jsonb_typeof(p_value) <> 'array' then return 'type'; end if;
    if exists(select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string') then return 'type'; end if;
    if (select count(distinct e) from jsonb_array_elements(p_value) e) <> jsonb_array_length(p_value) then return 'duplicate'; end if;
    if jsonb_array_length(p_value) > coalesce((l ->> 'maxItems')::int, 10) then return 'items'; end if;
    if (p_def ->> 'required')::boolean and jsonb_array_length(p_value) = 0 then return 'empty'; end if;
    for c in select jsonb_array_elements_text(p_value) loop
      select e into o from jsonb_array_elements(p_def -> 'options') e where e ->> 'code' = c limit 1;
      if o is null then return 'option'; end if;
      if not (o ->> 'active')::boolean and not (coalesce(jsonb_typeof(p_prev) = 'array' and p_prev @> to_jsonb(array[c]), false)) then return 'inactive_option'; end if;
    end loop;
  else return 'type'; end if;
  return null;
end $$;
revoke all on function public.custom_value_error(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.custom_value_error(jsonb, jsonb, jsonb) to service_role;

create function public.custom_field_defs_of(p_entity text, p_defs jsonb)
returns jsonb language plpgsql immutable set search_path to '' as $$
declare
  d jsonb; o jsonb; l jsonb; t text; k text; seen text[] := '{}'; opts text[]; allowed text[]; n int;
  required_attrs text[] := array['key','label','description','type','required','editable_by','show_in_list','searchable','sort','active'];
  ws constant text := E' \t\n\u000b\f\r\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
begin
  if p_entity is null or p_entity not in ('wbs_item','issue','weekly_row') then raise exception using errcode='22023', message='CUSTOM_FIELD_ENTITY'; end if;
  if p_defs is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_defs) <> 'array' or jsonb_array_length(p_defs) > 60 then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
  for d in select jsonb_array_elements(p_defs) loop
    if jsonb_typeof(d) <> 'object' or not d ?& required_attrs
       or exists(select 1 from jsonb_object_keys(d) x where x <> all(required_attrs || array['default','options','limits','carry_over'])) then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
    k := d ->> 'key'; t := d ->> 'type';
    if jsonb_typeof(d -> 'key') <> 'string' or k !~ '^[a-z][a-z0-9_]{0,31}$' or k = any(seen)
       or jsonb_typeof(d -> 'label') <> 'string' or char_length(btrim(d ->> 'label', ws)) not between 1 and 40
       or jsonb_typeof(d -> 'description') <> 'string' or char_length(d ->> 'description') > 300
       or jsonb_typeof(d -> 'type') <> 'string' or t not in ('text','multiline','number','date','boolean','select','multiselect')
       or exists(select 1 from unnest(array['required','show_in_list','searchable','active']) x where jsonb_typeof(d -> x) <> 'boolean')
       or jsonb_typeof(d -> 'editable_by') <> 'string' or d ->> 'editable_by' not in ('member','admin')
       or jsonb_typeof(d -> 'sort') <> 'number' or (d ->> 'sort')::numeric not between 0 and 9999 or trunc((d ->> 'sort')::numeric) <> (d ->> 'sort')::numeric
       or (d ? 'carry_over' and (p_entity <> 'weekly_row' or jsonb_typeof(d -> 'carry_over') <> 'boolean')) then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
    seen := array_append(seen,k);
    if d ? 'limits' then
      l := d -> 'limits';
      allowed := case t when 'text' then array['maxLength'] when 'multiline' then array['maxLength'] when 'number' then array['min','max','decimals','unit'] when 'multiselect' then array['maxItems'] else '{}'::text[] end;
      if jsonb_typeof(l) <> 'object' or exists(select 1 from jsonb_object_keys(l) x where x <> all(allowed)) then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
      for k in select jsonb_object_keys(l) loop
        if k = 'unit' then
          if jsonb_typeof(l -> k) <> 'string' or char_length(btrim(l ->> k, ws)) not between 1 and 10 then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
        else
          if jsonb_typeof(l -> k) <> 'number' then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
          if k in ('min','max') then
            if abs((l ->> k)::numeric) > 1e12 then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
          else
            n := case k when 'maxLength' then case when t='text' then 2000 else 4000 end when 'decimals' then 4 else 20 end;
            if (l ->> k)::numeric not between (case when k='decimals' then 0 else 1 end) and n or trunc((l ->> k)::numeric) <> (l ->> k)::numeric then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
          end if;
        end if;
      end loop;
      if l ?& array['min','max'] and (l ->> 'min')::numeric > (l ->> 'max')::numeric then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
    end if;
    if t in ('select','multiselect') then
      if jsonb_typeof(d -> 'options') is distinct from 'array' or jsonb_array_length(d -> 'options') not between 1 and 100 then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
      opts := '{}';
      for o in select jsonb_array_elements(d -> 'options') loop
        if jsonb_typeof(o) <> 'object' or not o ?& array['code','label','sort','active']
           or exists(select 1 from jsonb_object_keys(o) x where x not in ('code','label','sort','active','color')) then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
        if jsonb_typeof(o -> 'code') <> 'string' or o ->> 'code' !~ '^[a-z0-9][a-z0-9_-]{0,29}$' or o ->> 'code' = any(opts)
           or jsonb_typeof(o -> 'label') <> 'string' or char_length(btrim(o ->> 'label', ws)) not between 1 and 40
           or jsonb_typeof(o -> 'sort') <> 'number' or (o ->> 'sort')::numeric not between 0 and 9999 or trunc((o ->> 'sort')::numeric) <> (o ->> 'sort')::numeric
           or jsonb_typeof(o -> 'active') <> 'boolean'
           or (o ? 'color' and (jsonb_typeof(o -> 'color') <> 'string' or o ->> 'color' not in ('done','brand','progress','delayed','accent','pending','neutral'))) then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
        opts := array_append(opts,o ->> 'code');
      end loop;
    elsif d ? 'options' then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
    if ((d ->> 'required')::boolean and not d ? 'default') or (d ? 'default' and public.custom_value_error(d,d -> 'default',null) is not null) then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_defs) x where (x ->> 'active')::boolean) > 30
     or (select count(*) from jsonb_array_elements(p_defs) x where (x ->> 'show_in_list')::boolean) > 8 then raise exception using errcode='22023', message='CONFIG_INVALID:fields.' || p_entity; end if;
  return p_defs;
end $$;
revoke all on function public.custom_field_defs_of(text,jsonb) from public, anon, authenticated;
grant execute on function public.custom_field_defs_of(text,jsonb) to service_role;

create function public.custom_field_table(p_entity text) returns text
language plpgsql immutable set search_path to '' as $$
begin
  case p_entity when 'wbs_item' then return 'wbs_items'; when 'issue' then return 'issues'; when 'weekly_row' then return 'weekly_report_rows'; else raise exception using errcode='22023', message='CUSTOM_FIELD_ENTITY'; end case;
end $$;
revoke all on function public.custom_field_table(text) from public,anon,authenticated;
grant execute on function public.custom_field_table(text) to service_role;

create function public.enforce_custom_fields() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  entity text := tg_argv[0]; defs jsonb; settings jsonb; d jsonb; k text; v jsonb; err text;
  prev jsonb := '{}'::jsonb; generated jsonb := '{}'::jsonb;
  bulk boolean := auth.uid() is null and coalesce(current_setting('dflow.custom_field_admin',true)='on',false);
begin
  if jsonb_typeof(new.custom) is distinct from 'object' then raise exception using errcode='23514', message='CUSTOM_FIELD_SHAPE'; end if;
  select s."values" into settings from public.project_settings s where s.project_id = new.project_id for share;
  if not found then raise exception using errcode='P0001', message='SETTINGS_ROW_MISSING'; end if;
  defs := public.custom_field_defs_of(entity,settings -> ('fields.' || entity));
  -- Empty/default projects keep their original isolation behavior. FOR SHARE still prevents
  -- enabling a required field between the configuration read and this row's commit.
  if current_setting('transaction_isolation') <> 'read committed'
     and (jsonb_array_length(defs) > 0 or new.custom <> '{}'::jsonb) then
    raise exception using errcode='25001',message='CUSTOM_FIELD_ISOLATION';
  end if;
  if tg_op='UPDATE' and old.project_id = new.project_id then prev := old.custom; end if;
  if tg_op='INSERT' then
    for d in select jsonb_array_elements(defs) loop
      k := d ->> 'key';
      if (d ->> 'required')::boolean and not new.custom ? k then
        new.custom := new.custom || jsonb_build_object(k,d -> 'default');
        generated := generated || jsonb_build_object(k,true);
      end if;
    end loop;
  elsif not bulk then
    for d in select jsonb_array_elements(defs) loop
      k := d ->> 'key';
      if (d ->> 'required')::boolean and not new.custom ? k then raise exception using errcode='23514', message='CUSTOM_FIELD_REQUIRED:' || k; end if;
    end loop;
  end if;
  for k,v in select key,value from jsonb_each(new.custom) loop
    select e into d from jsonb_array_elements(defs) e where e ->> 'key'=k limit 1;
    if d is null then raise exception using errcode='23514', message='CUSTOM_FIELD_UNKNOWN:' || k; end if;
    if v='null'::jsonb then raise exception using errcode='23514', message='CUSTOM_FIELD_NULL:' || k; end if;
    if not bulk and not (d ->> 'active')::boolean and v is distinct from prev -> k and not generated ? k then raise exception using errcode='23514', message='CUSTOM_FIELD_INACTIVE:' || k; end if;
    err := public.custom_value_error(d,v,prev -> k);
    if err is not null then raise exception using errcode='23514', message='CUSTOM_FIELD_INVALID:' || k || ':' || err; end if;
  end loop;
  -- Inactive fields are read-only, including removal of an optional key.
  if not bulk then
    for d in select jsonb_array_elements(defs) loop
      k := d ->> 'key';
      if not (d ->> 'active')::boolean and (new.custom -> k) is distinct from (prev -> k) and not generated ? k then raise exception using errcode='23514', message='CUSTOM_FIELD_INACTIVE:' || k; end if;
    end loop;
  end if;
  -- Changed/removed admin keys, including INSERT; server paths are checked again at their action guard.
  if auth.uid() is not null and not public.is_project_admin(new.project_id) then
    for d in select jsonb_array_elements(defs) loop
      k := d ->> 'key';
      if d ->> 'editable_by'='admin' and (new.custom -> k) is distinct from (prev -> k) and not generated ? k then raise exception using errcode='42501', message='CUSTOM_FIELD_ADMIN_ONLY:' || k; end if;
    end loop;
  end if;
  if pg_column_size(new.custom) > 16384 then raise exception using errcode='23514', message='CUSTOM_FIELD_SIZE'; end if;
  return new;
end $$;
revoke all on function public.enforce_custom_fields() from public,anon,authenticated;
grant execute on function public.enforce_custom_fields() to service_role;

alter table public.wbs_items add column custom jsonb not null default '{}'::jsonb,
  add constraint wbs_items_custom_shape check(jsonb_typeof(custom)='object' and pg_column_size(custom)<=16384);
alter table public.issues add column custom jsonb not null default '{}'::jsonb,
  add constraint issues_custom_shape check(jsonb_typeof(custom)='object' and pg_column_size(custom)<=16384);
alter table public.weekly_report_rows add column custom jsonb not null default '{}'::jsonb,
  add constraint weekly_report_rows_custom_shape check(jsonb_typeof(custom)='object' and pg_column_size(custom)<=16384);
grant update (custom) on public.weekly_report_rows to authenticated;
create index wbs_items_custom_gin on public.wbs_items using gin(custom jsonb_path_ops);
create index issues_custom_gin on public.issues using gin(custom jsonb_path_ops);
create index weekly_report_rows_custom_gin on public.weekly_report_rows using gin(custom jsonb_path_ops);
create trigger wbs_items_custom_fields_trg before insert or update of custom,project_id on public.wbs_items for each row execute function public.enforce_custom_fields('wbs_item');
create trigger issues_custom_fields_trg before insert or update of custom,project_id on public.issues for each row execute function public.enforce_custom_fields('issue');
create trigger weekly_report_rows_custom_fields_trg before insert or update of custom,project_id on public.weekly_report_rows for each row execute function public.enforce_custom_fields('weekly_row');

create or replace function public.guard_non_admin_column_scope() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then return new; end if;
  if public.is_project_admin(old.project_id) then return new; end if;
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at' - 'custom')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at' - 'custom') then
    raise exception '실적%%·산출물·허용된 추가 필드만 수정할 수 있습니다' using errcode='42501';
  end if;
  return new;
end $$;

-- Called while apply_project_settings owns the settings row FOR UPDATE.
create function public.custom_fields_ref_check(p_project_id uuid,p_entity text,p_old jsonb,p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  old_defs jsonb := public.custom_field_defs_of(p_entity,p_old);
  new_defs jsonb := public.custom_field_defs_of(p_entity,p_new);
  tbl text := public.custom_field_table(p_entity); o jsonb; n jsonb; k text; cnt bigint; reason text;
begin
  for o in select jsonb_array_elements(old_defs) loop
    k := o ->> 'key';
    select e into n from jsonb_array_elements(new_defs) e where e ->> 'key'=k limit 1;
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

-- Existing immutable receipts retain actor/command identity; no new writable table.
alter table public.command_receipts drop constraint command_receipts_kind_check;
alter table public.command_receipts add constraint command_receipts_kind_check check(kind in ('wbs_import','custom_field_backfill','custom_field_purge'));
alter table public.command_receipts drop constraint command_receipts_project_required;
alter table public.command_receipts add constraint command_receipts_project_required check(project_id is not null);

-- Owner-only implementation. Only the two service_role wrappers are API commands.
create function public.custom_field_command(p_kind text,p_project_id uuid,p_expected_revision bigint,p_command_id uuid,p_entity text,p_key text,p_value jsonb,p_expected_count bigint,p_actor uuid)
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

create function public.backfill_custom_field(p_project_id uuid,p_expected_revision bigint,p_command_id uuid,p_entity text,p_key text,p_value jsonb,p_actor uuid)
returns jsonb language sql security definer set search_path to '' as $$
  select public.custom_field_command('custom_field_backfill',p_project_id,p_expected_revision,p_command_id,p_entity,p_key,p_value,null,p_actor);
$$;
revoke all on function public.backfill_custom_field(uuid,bigint,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.backfill_custom_field(uuid,bigint,uuid,text,text,jsonb,uuid) to service_role;
create function public.purge_custom_field(p_project_id uuid,p_expected_revision bigint,p_command_id uuid,p_entity text,p_key text,p_expected_count bigint,p_actor uuid)
returns jsonb language sql security definer set search_path to '' as $$
  select public.custom_field_command('custom_field_purge',p_project_id,p_expected_revision,p_command_id,p_entity,p_key,null,p_expected_count,p_actor);
$$;
revoke all on function public.purge_custom_field(uuid,bigint,uuid,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.purge_custom_field(uuid,bigint,uuid,text,text,bigint,uuid) to service_role;

create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  v_rules jsonb;
  v_weeks jsonb;
  v_old jsonb;
  v_new jsonb;
  v_hit record;
begin
  if p_key in ('fields.wbs_item','fields.issue','fields.weekly_row') then
    perform public.custom_fields_ref_check(p_project_id,substring(p_key from 8),p_old,p_new);
    return;
  end if;
  -- calendar.week_start — 정확 판정(D53, 비평 반영 — S2): 새 규칙에서 키가 바뀌는 문서가 하나라도 있으면 거부한다. "첫 차이 위치"만 세면
  -- 미적용 전환을 더 늦은 날로 교체할 때 [E1, E2) 의 일요일 키 문서를 놓친다. unset(p_new null) = 제품 기본값 일요일.
  -- 과거 원소 수정 금지(from ≤ T)는 TS toStored 가 판정한다 — 여기는 문서 키 유효성만 본다(미리보기 previewWeekStart 와 같은 정의).
  -- 주간 문서는 프로젝트당 연 52건 수준이라 전수가 싸다(K28).
  if p_key = 'calendar.week_start' then
    v_rules := public.week_rules_of(case when p_new is null then '{}'::jsonb
                                         else pg_catalog.jsonb_build_object('calendar.week_start', p_new) end);
    select pg_catalog.jsonb_agg(x.w order by x.w) into v_weeks
      from (select r.week_start as w
              from public.weekly_reports r
             where r.project_id = p_project_id
               and public.week_key_from_rules(v_rules, r.week_start) <> r.week_start
             order by r.week_start
             limit 20) x;
    if v_weeks is not null then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:calendar.week_start',
        detail = pg_catalog.jsonb_build_object('key', 'calendar.week_start', 'weeks', v_weeks)::text;
    end if;
    return;
  end if;
  -- calendar.timezone — TS(Intl)만 통과한 값이 PG 에 없으면 그 프로젝트의 SQL(이슈 코드 {yyyy} — B1)이 막힌다. DB 쪽 마지막 방어(D54).
  -- 워크스페이스 tz 를 읽는 SQL 은 없다(사용현황 RPC 는 TS 가 tz 를 넘긴다) — 프로젝트만 본다.
  if p_key = 'calendar.timezone' then
    if p_new is null then
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_new) is distinct from 'string' or (p_new #>> '{}') = '' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    -- '/' 없는 이름은 닫힌 허용 목록만(L1 — TS NO_SLASH_TIMEZONES 와 같다): PG 는 IST·NST·PST·CET·EST 같은 이름을 약어 표에서 먼저 읽어
    -- ICU(TS)와 다른 오프셋이 된다 — 받으면 TS·SQL 이 다른 날짜를 낸다
    if pg_catalog.strpos(p_new #>> '{}', '/') = 0
       and (p_new #>> '{}') not in ('UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT') then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    begin
      perform pg_catalog.now() at time zone (p_new #>> '{}');
    exception when invalid_parameter_value then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end;
    return;
  end if;
  -- issues.id_policy(SP5 B1 — 계획 P7): TS(parseIdPolicy)만 통과한 값이 SQL 검증(issue_id_policy_of)에 걸리면 그 프로젝트의 모든 이슈 등록이 멈춘다.
  -- DB 쪽 마지막 방어. unset(p_new null) = 제품 기본값이라 통과
  if p_key = 'issues.id_policy' then
    if p_new is not null then
      perform public.issue_id_policy_of(pg_catalog.jsonb_build_object('issues.id_policy', p_new));
    end if;
    return;
  end if;
  -- SP5b(스펙 §3.2 ⑧, 비평 반영 — S8): 이슈 표시 상태 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의 이슈 쓰기가
  -- 22023 으로 멈춘다 — DB 쪽 마지막 방어), 그다음 빠진 code(removed)·범주가 바뀐 code(category)의 참조 이슈 수. 비활성은 참조가 있어도 된다.
  if p_key = 'workflow.issue_statuses' then
    v_new := public.issue_statuses_of(case when p_new is null then '{}'::jsonb
                                           else pg_catalog.jsonb_build_object('workflow.issue_statuses', p_new) end);
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'category' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null or (n ->> 'category') is distinct from (o ->> 'category')) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  -- SP5b W1(스펙 §3.3 ⑨, 비평 반영 — S8·B-21): workflow.* 여섯 키 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의
  -- 흐름 사건이 22023 으로 멈춘다 — DB 쪽 마지막 방어). workflow.approval_steps 는 대기 라운드의 스냅샷 단계 삭제(pending_round)와 대기 단계의
  -- 승인자 넓히기(approver_widen — admin → subtree_or_admin)를 거부한다. 대기 라운드 = im 이고 스냅샷에 미승인 단계가 있음, 또는 xx 이고 스냅샷이
  -- 있음(unapprove 가 마지막 단계를 되살린다). 좁히기(→ admin)는 언제나 허용 — 권한을 넓히지 않는다. 옛 값이 손상이면 승인자를 모두 admin 으로 본다.
  if p_key in ('workflow.stage_credits', 'workflow.credit_policy', 'workflow.approval_steps',
               'workflow.approval_distinct_approvers', 'workflow.predecessor_gate', 'workflow.wbs_stage_labels') then
    v_new := public.workflow_value_of(case when p_new is null then '{}'::jsonb else pg_catalog.jsonb_build_object(p_key, p_new) end, p_key);
    if p_key = 'workflow.approval_steps' then
      begin
        v_old := public.workflow_value_of(case when p_old is null then '{}'::jsonb else pg_catalog.jsonb_build_object(p_key, p_old) end, p_key);
      exception when sqlstate '22023' then
        v_old := '[]'::jsonb;
      end;
      select s.code, pg_catalog.count(*) as cnt into v_hit
        from public.wbs_items w
        cross join lateral pg_catalog.unnest(w.review_steps) as s(code)
       where w.project_id = p_project_id and w.review_steps is not null
         and (w.stage = 'xx'
              or (w.stage = 'im' and exists (select 1 from pg_catalog.unnest(w.review_steps) as u(code)
                                              where not exists (select 1 from public.wbs_stage_approvals a
                                                                 where a.wbs_item_id = w.id and a.round = w.review_round
                                                                   and a.step_code = u.code and a.revoked_at is null))))
         and not exists (select 1 from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = s.code)
       group by s.code
       order by s.code
       limit 1;
      if found then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
          detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', 'pending_round', 'count', v_hit.cnt)::text;
      end if;
      select p.code, pg_catalog.count(*) as cnt into v_hit
        from (select case when w.stage = 'xx' then w.review_steps[pg_catalog.cardinality(w.review_steps)]
                          else (select s.code from pg_catalog.unnest(w.review_steps) with ordinality as s(code, i)
                                 where not exists (select 1 from public.wbs_stage_approvals a
                                                    where a.wbs_item_id = w.id and a.round = w.review_round
                                                      and a.step_code = s.code and a.revoked_at is null)
                                 order by s.i limit 1) end as code
                from public.wbs_items w
               where w.project_id = p_project_id and w.stage in ('im', 'xx') and w.review_steps is not null) p
       where p.code is not null
         and exists (select 1 from pg_catalog.jsonb_array_elements(v_new) e
                      where e ->> 'code' = p.code and e ->> 'approver' = 'subtree_or_admin')
         and coalesce((select o ->> 'approver' from pg_catalog.jsonb_array_elements(v_old) o where o ->> 'code' = p.code limit 1), 'admin') = 'admin'
       group by p.code
       order by p.code
       limit 1;
      if found then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
          detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', 'approver_widen', 'count', v_hit.cnt)::text;
      end if;
    end if;
    return;
  end if;
  -- 어휘 네 키(SP5 B4 — D29·D58, 개정 §2.4.2): 옛 목록에 있고 새 목록에서 빠진 code, 또는 의미 속성(attendance.types 의 counts_as)이
  -- 바뀐 code 의 참조 행이 있으면 거부한다. 비활성은 참조가 있어도 된다(새 행만 막힌다 — 트리거). unset·옛 키 없음 = 제품 기본값.
  -- 원인 분류는 분기가 없다(분석 실행 JSON 참조 — TS 가 삭제 금지).
  if p_key in ('attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources') then
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    v_new := coalesce(p_new, public.project_vocab_default(p_key));
    if pg_catalog.jsonb_typeof(v_new) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || p_key;
    end if;
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'counts_as' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null
                or (p_key = 'attendance.types' and (n ->> 'counts_as') is distinct from (o ->> 'counts_as'))) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  return;
end $$;

-- Catalog postcheck: exactly three columns / GIN indexes / row triggers and closed function ACLs.
do $$
declare sig text;
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name in ('wbs_items','issues','weekly_report_rows') and column_name='custom' and data_type='jsonb' and is_nullable='NO') <> 3
     or (select count(*) from pg_indexes where schemaname='public' and indexname in ('wbs_items_custom_gin','issues_custom_gin','weekly_report_rows_custom_gin') and indexdef like '%jsonb_path_ops%') <> 3
     or (select count(*) from pg_trigger where tgname in ('wbs_items_custom_fields_trg','issues_custom_fields_trg','weekly_report_rows_custom_fields_trg') and not tgisinternal) <> 3 then raise exception 'CUSTOM_FIELDS_POSTCHECK: columns/indexes/triggers'; end if;
  for sig in select unnest(array[
    'public.custom_value_error(jsonb,jsonb,jsonb)','public.custom_field_defs_of(text,jsonb)','public.custom_field_table(text)',
    'public.enforce_custom_fields()','public.custom_fields_ref_check(uuid,text,jsonb,jsonb)',
    'public.backfill_custom_field(uuid,bigint,uuid,text,text,jsonb,uuid)','public.purge_custom_field(uuid,bigint,uuid,text,text,bigint,uuid)']) loop
    if has_function_privilege('anon',sig,'EXECUTE') or has_function_privilege('authenticated',sig,'EXECUTE') or not has_function_privilege('service_role',sig,'EXECUTE') then raise exception 'CUSTOM_FIELDS_POSTCHECK: ACL %',sig; end if;
  end loop;
  sig := 'public.custom_field_command(text,uuid,bigint,uuid,text,text,jsonb,bigint,uuid)';
  if has_function_privilege('anon',sig,'EXECUTE') or has_function_privilege('authenticated',sig,'EXECUTE') or has_function_privilege('service_role',sig,'EXECUTE') then raise exception 'CUSTOM_FIELDS_POSTCHECK: private implementation ACL'; end if;
  if not has_column_privilege('authenticated','public.weekly_report_rows','custom','UPDATE') then raise exception 'CUSTOM_FIELDS_POSTCHECK: weekly custom column'; end if;
end $$;
