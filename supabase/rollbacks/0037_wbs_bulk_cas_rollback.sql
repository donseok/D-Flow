begin;
drop function if exists public.apply_workflow_event_cas(uuid,uuid,uuid,timestamptz,text,text);
drop function if exists public.apply_wbs_bulk_item(uuid,uuid,uuid,timestamptz,jsonb);
commit;
