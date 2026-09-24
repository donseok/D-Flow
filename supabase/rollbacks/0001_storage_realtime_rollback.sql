-- 0001_storage_realtime 롤백

alter publication supabase_realtime drop table public.weekly_report_rows;
drop policy if exists "receive_own_notification_channel" on realtime.messages;
drop policy if exists "receive_project_wbs_channel" on realtime.messages;
drop policy if exists "deliverables delete" on storage.objects;
drop policy if exists "deliverables insert" on storage.objects;
drop policy if exists "deliverables read" on storage.objects;
drop policy if exists "issue-attachments delete" on storage.objects;
drop policy if exists "issue-attachments insert" on storage.objects;
drop policy if exists "issue-attachments read" on storage.objects;
drop policy if exists "minutes bucket delete" on storage.objects;
drop policy if exists "minutes bucket insert" on storage.objects;
drop policy if exists "minutes bucket read" on storage.objects;
set storage.allow_delete_query = 'true';
delete from storage.buckets where id in ('deliverables', 'issue-attachments', 'minutes');
reset storage.allow_delete_query;
