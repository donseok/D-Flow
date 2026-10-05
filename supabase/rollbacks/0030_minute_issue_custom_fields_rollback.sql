-- Remove only the custom overload. Existing issues, links and the legacy RPC remain.
drop function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text, jsonb);
