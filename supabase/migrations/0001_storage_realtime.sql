-- 0001_storage_realtime — 운영 카탈로그에서 생성(scripts/baseline-dump.mjs). pg_dump --schema=public 이 담지 않는 두 스키마.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('deliverables', 'deliverables', false, null, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('issue-attachments', 'issue-attachments', false, 52428800, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('minutes', 'minutes', false, 20971520, null) on conflict (id) do nothing;

alter table realtime.messages enable row level security;

create policy "receive_own_notification_channel" on realtime.messages as permissive for select to authenticated using (((realtime.topic() = (('user-'::text || (( SELECT auth.uid() AS uid))::text) || '-notifications'::text)) AND (extension = 'broadcast'::text)));
create policy "receive_project_wbs_channel" on realtime.messages as permissive for select to authenticated using (((extension = 'broadcast'::text) AND ("substring"(realtime.topic(), '^project-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-wbs$'::text) IS NOT NULL) AND is_project_member(("substring"(realtime.topic(), '^project-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-wbs$'::text))::uuid)));
create policy "deliverables delete" on storage.objects as permissive for delete to authenticated using (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));
create policy "deliverables insert" on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));
create policy "deliverables read" on storage.objects as permissive for select to authenticated using (((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid)));
create policy "issue-attachments delete" on storage.objects as permissive for delete to authenticated using (((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid)));
create policy "issue-attachments insert" on storage.objects as permissive for insert to authenticated with check (((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid)));
create policy "issue-attachments read" on storage.objects as permissive for select to authenticated using ((bucket_id = 'issue-attachments'::text));
create policy "minutes bucket delete" on storage.objects as permissive for delete to authenticated using (((bucket_id = 'minutes'::text) AND ((owner = auth.uid()) OR (app_role() = 'pmo_admin'::text)) AND (NOT (EXISTS ( SELECT 1
   FROM minute_versions mv
  WHERE (mv.file_path = objects.name))))));
create policy "minutes bucket insert" on storage.objects as permissive for insert to authenticated with check ((bucket_id = 'minutes'::text));
create policy "minutes bucket read" on storage.objects as permissive for select to authenticated using ((bucket_id = 'minutes'::text));

alter publication supabase_realtime add table public.weekly_report_rows;
