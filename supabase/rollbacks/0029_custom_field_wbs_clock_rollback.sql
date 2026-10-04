-- Roll back before 0028 and 0027. Preserve custom values and existing timestamps.
drop trigger if exists wbs_custom_touch on public.wbs_items;
drop function if exists public.touch_wbs_custom_fields();
