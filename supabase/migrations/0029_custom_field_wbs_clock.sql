-- Custom-only WBS writes must advance the clock used to order realtime snapshots.
create function public.touch_wbs_custom_fields() returns trigger
language plpgsql set search_path to '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
revoke all on function public.touch_wbs_custom_fields() from public, anon, authenticated;
grant execute on function public.touch_wbs_custom_fields() to service_role;
create trigger wbs_custom_touch before update of custom on public.wbs_items
for each row when (old.custom is distinct from new.custom)
execute function public.touch_wbs_custom_fields();

do $$
begin
  if has_function_privilege('anon', 'public.touch_wbs_custom_fields()', 'execute')
    or has_function_privilege('authenticated', 'public.touch_wbs_custom_fields()', 'execute') then
    raise exception 'CUSTOM_FIELD_WBS_CLOCK_ACL';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'wbs_custom_touch'
    and tgrelid = 'public.wbs_items'::regclass and not tgisinternal) then
    raise exception 'CUSTOM_FIELD_WBS_CLOCK_TRIGGER_MISSING';
  end if;
end;
$$;
