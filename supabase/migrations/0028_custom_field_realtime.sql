-- SP5c value propagation. Preserve the existing private WBS topic/policy and emit one full snapshot per changed row.
create or replace function public.wbs_items_broadcast() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('id',new.id,'project_id',new.project_id,
      'stage',new.stage,'actual_pct',new.actual_pct,'updated_at',new.updated_at,'custom',new.custom),
      'wbs_changed','project-' || new.project_id::text || '-wbs',true);
  exception when others then
    null; -- Existing policy: transport failure must not abort the value write.
  end;
  return new;
end $$;
-- Existing function ACL is unchanged; it is invoked as a trigger, never as an RPC.
drop trigger wbs_items_broadcast on public.wbs_items;
create trigger wbs_items_broadcast after update of stage,actual_pct,custom on public.wbs_items
for each row when (old.stage is distinct from new.stage or old.actual_pct is distinct from new.actual_pct or old.custom is distinct from new.custom)
execute function public.wbs_items_broadcast();

-- Issues have no generic updated_at trigger. Cover JWT direct writes and service bulk commands as well as UI actions.
create function public.touch_issue_custom_fields() returns trigger
language plpgsql set search_path to '' as $$
begin
  new.updated_at := greatest(clock_timestamp(),old.updated_at + interval '1 microsecond');
  return new;
end $$;
revoke all on function public.touch_issue_custom_fields() from public,anon,authenticated;
grant execute on function public.touch_issue_custom_fields() to service_role;
create trigger issues_custom_touch before update of custom on public.issues
for each row when (old.custom is distinct from new.custom) execute function public.touch_issue_custom_fields();

do $$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.wbs_items'::regclass and tgname='wbs_items_broadcast'
    and not tgisinternal and position('custom' in pg_get_triggerdef(oid)) > 0) then
    raise exception 'CUSTOM_FIELD_REALTIME_TRIGGER_MISSING';
  end if;
  if has_function_privilege('anon','public.touch_issue_custom_fields()','execute')
    or has_function_privilege('authenticated','public.touch_issue_custom_fields()','execute') then
    raise exception 'CUSTOM_FIELD_TOUCH_ACL';
  end if;
end $$;
