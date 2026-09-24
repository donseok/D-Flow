# 운영 라이브 카탈로그 스냅샷 (2026-09-23T14:43:43.824Z, wbs-web@77cf6785)

SP2 스펙의 "라이브 정책 목록" 입력(상위 스펙 6.7). 생성: `node scripts/baseline-diff.mjs --snapshot`.
원문은 `docs/baseline/prod-catalog.json` 이다 — 표에서는 여러 줄 식을 한 줄로 이었다.

- policies: 123
- functions: 82
- triggers: 15
- buckets: 3
- rls_tables: 67
- publication_tables: 1
- `using (true)` 읽기 정책: 42

| 테이블 | 정책 | cmd | roles | using | with check |
|---|---|---|---|---|---|
| public.agent_projects | read_agent_projects | SELECT | authenticated | `is_project_member(project_id)` | — |
| public.agent_work_orders | read_agent_work_orders | SELECT | authenticated | `is_project_member(project_id)` | — |
| public.agent_work_reports | read_agent_work_reports | SELECT | authenticated | `(EXISTS ( SELECT 1 FROM agent_work_orders o WHERE ((o.id = agent_work_reports.work_order_id) AND is_project_member(o.project_id))))` | — |
| public.ai_documents | ai_documents_read | SELECT | authenticated | `true` | — |
| public.announcement_seen | own_seen_announcements | ALL | authenticated | `(user_id = auth.uid())` | `(user_id = auth.uid())` |
| public.announcements | admin_write_announcements | ALL | authenticated | `is_project_admin(project_id)` | `is_project_admin(project_id)` |
| public.announcements | read_all_announcements | SELECT | authenticated | `true` | — |
| public.attendance_records | member_write_attendance | ALL | authenticated | `is_project_member(project_id)` | `is_project_member(project_id)` |
| public.attendance_records | read_all_attendance | SELECT | authenticated | `true` | — |
| public.change_logs | insert_own_log | INSERT | authenticated | — | `(user_id = auth.uid())` |
| public.change_logs | read_all_logs | SELECT | authenticated | `true` | — |
| public.deliverable_attachments | attach_delete | DELETE | authenticated | `can_attach(wbs_item_id)` | — |
| public.deliverable_attachments | attach_insert | INSERT | authenticated | — | `can_attach(wbs_item_id)` |
| public.deliverable_attachments | read_all_attachments | SELECT | authenticated | `true` | — |
| public.holidays | admin_write_holidays | ALL | authenticated | `is_project_admin(project_id)` | `is_project_admin(project_id)` |
| public.holidays | read_all_holidays | SELECT | authenticated | `true` | — |
| public.issue_analysis_runs | issue_analysis_runs_select_project_members | SELECT | authenticated | `is_project_member(project_id)` | — |
| public.issue_assignees | member_delete_issue_assignees | DELETE | authenticated | `is_project_member(project_id)` | — |
| public.issue_assignees | member_insert_issue_assignees | INSERT | authenticated | — | `is_project_member(project_id)` |
| public.issue_assignees | read_all_issue_assignees | SELECT | authenticated | `true` | — |
| public.issue_attachments | delete_issue_attachments | DELETE | authenticated | `can_edit_issue(issue_id)` | — |
| public.issue_attachments | insert_issue_attachments | INSERT | authenticated | — | `can_edit_issue(issue_id)` |
| public.issue_attachments | read_issue_attachments | SELECT | authenticated | `true` | — |
| public.issue_links | read_all_issue_links | SELECT | authenticated | `true` | — |
| public.issue_major_processes | insert_issue_major_processes | INSERT | authenticated | — | `is_project_member(project_id)` |
| public.issue_major_processes | read_all_issue_major_processes | SELECT | authenticated | `true` | — |
| public.issue_mega_areas | read_all_issue_mega_areas | SELECT | authenticated | `true` | — |
| public.issue_updates | delete_issue_updates | DELETE | authenticated | `is_project_admin(project_id)` | — |
| public.issue_updates | insert_issue_updates | INSERT | authenticated | — | `(is_project_member(project_id) AND (author_user_id = auth.uid()) AND (kind = 'note'::text) AND (archived_at IS NULL) AND (archived_by IS NULL) AND (archived_by_name IS NULL))` |
| public.issue_updates | read_issue_updates | SELECT | authenticated | `true` | — |
| public.issue_updates | update_issue_updates | UPDATE | authenticated | `(((author_user_id = auth.uid()) OR is_project_admin(project_id)) AND (kind = 'note'::text))` | `((num_nonnulls(archived_at, archived_by, archived_by_name) = 0) OR ((archived_at IS NOT NULL) AND (archived_by = auth.uid())))` |
| public.issues | delete_own_issues | DELETE | authenticated | `((created_by = auth.uid()) OR is_project_admin(project_id))` | — |
| public.issues | insert_own_issues | INSERT | authenticated | — | `((created_by = auth.uid()) AND is_project_member(project_id))` |
| public.issues | member_update_issues | UPDATE | authenticated | `is_project_member(project_id)` | `is_project_member(project_id)` |
| public.issues | read_all_issues | SELECT | authenticated | `true` | — |
| public.item_owners | admin_write_owners | ALL | authenticated | `(EXISTS ( SELECT 1 FROM wbs_items w WHERE ((w.id = item_owners.wbs_item_id) AND is_project_admin(w.project_id))))` | `(EXISTS ( SELECT 1 FROM wbs_items w WHERE ((w.id = item_owners.wbs_item_id) AND is_project_admin(w.project_id))))` |
| public.item_owners | read_all_owners | SELECT | authenticated | `true` | — |
| public.llm_config | su_all_llm_config | ALL | authenticated | `is_superuser()` | `is_superuser()` |
| public.llm_profiles | su_all_llm_profiles | ALL | authenticated | `is_superuser()` | `is_superuser()` |
| public.meeting_attendees | own_write_meeting_attendees | ALL | authenticated | `(EXISTS ( SELECT 1 FROM meetings m WHERE ((m.id = meeting_attendees.meeting_id) AND ((m.created_by = auth.uid()) OR is_project_admin(m.project_id)))))` | `(EXISTS ( SELECT 1 FROM meetings m WHERE ((m.id = meeting_attendees.meeting_id) AND ((m.created_by = auth.uid()) OR is_project_admin(m.project_id)))))` |
| public.meeting_attendees | read_all_meeting_attendees | SELECT | authenticated | `true` | — |
| public.meeting_exceptions | own_write_meeting_exceptions | ALL | authenticated | `(EXISTS ( SELECT 1 FROM meetings m WHERE ((m.id = meeting_exceptions.meeting_id) AND ((m.created_by = auth.uid()) OR is_project_admin(m.project_id)))))` | `(EXISTS ( SELECT 1 FROM meetings m WHERE ((m.id = meeting_exceptions.meeting_id) AND ((m.created_by = auth.uid()) OR is_project_admin(m.project_id)))))` |
| public.meeting_exceptions | read_all_meeting_exceptions | SELECT | authenticated | `true` | — |
| public.meetings | delete_own_meetings | DELETE | authenticated | `((created_by = auth.uid()) OR is_project_admin(project_id))` | — |
| public.meetings | insert_own_meetings | INSERT | authenticated | — | `((created_by = auth.uid()) AND is_project_member(project_id))` |
| public.meetings | read_all_meetings | SELECT | authenticated | `true` | — |
| public.meetings | update_own_meetings | UPDATE | authenticated | `((created_by = auth.uid()) OR is_project_admin(project_id))` | `((created_by = auth.uid()) OR is_project_admin(project_id))` |
| public.memberships | read_all_memberships | SELECT | authenticated | `true` | — |
| public.memberships | su_write_memberships | ALL | authenticated | `is_superuser()` | `is_superuser()` |
| public.minute_embeddings | minute_embeddings_read | SELECT | authenticated | `true` | — |
| public.minute_favorites | own_minute_favorites | ALL | authenticated | `(user_id = auth.uid())` | `(user_id = auth.uid())` |
| public.minute_files | attachment_delete_minute_files | DELETE | authenticated | `((role = 'attachment'::text) AND (EXISTS ( SELECT 1 FROM minutes mi WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))))` | — |
| public.minute_files | attachment_insert_minute_files | INSERT | authenticated | — | `((role = 'attachment'::text) AND (uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1 FROM minutes mi WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))))` |
| public.minute_files | attachment_update_minute_files | UPDATE | authenticated | `((role = 'attachment'::text) AND (EXISTS ( SELECT 1 FROM minutes mi WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))))` | `((role = 'attachment'::text) AND (EXISTS ( SELECT 1 FROM minutes mi WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))))))` |
| public.minute_files | read_all_minute_files | SELECT | authenticated | `true` | — |
| public.minute_folders | delete_own_minute_folders | DELETE | authenticated | `((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))` | — |
| public.minute_folders | insert_own_minute_folders | INSERT | authenticated | — | `((created_by = auth.uid()) AND (app_role() IS NOT NULL))` |
| public.minute_folders | read_all_minute_folders | SELECT | authenticated | `true` | — |
| public.minute_folders | update_own_minute_folders | UPDATE | authenticated | `((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))` | `((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))` |
| public.minute_highlights | delete_own_minute_highlights | DELETE | authenticated | `((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text))` | — |
| public.minute_highlights | insert_own_minute_highlights | INSERT | authenticated | — | `((created_by = auth.uid()) AND (app_role() IS NOT NULL))` |
| public.minute_highlights | read_all_minute_highlights | SELECT | authenticated | `true` | — |
| public.minute_insights | minute_insights_read | SELECT | authenticated | `true` | — |
| public.minute_versions | minute_versions_read | SELECT | authenticated | `true` | — |
| public.minutes | read_all_minutes | SELECT | authenticated | `true` | — |
| public.notification_events | read_notification_events | SELECT | authenticated | `((EXISTS ( SELECT 1 FROM notification_recipients r WHERE ((r.event_id = notification_events.id) AND (r.user_id = auth.uid())))) OR ((audience = 'project'::text) AND is_project_member(project_id)) OR (audience = 'global'::text))` | — |
| public.notification_recipients | read_notification_recipients | SELECT | authenticated | `(user_id = auth.uid())` | — |
| public.project_ai_briefs | project_ai_briefs_read | SELECT | authenticated | `true` | — |
| public.project_members | admin_write_members | ALL | authenticated | `is_project_admin(project_id)` | `is_project_admin(project_id)` |
| public.project_members | read_all_members | SELECT | authenticated | `true` | — |
| public.project_roles | admin_write_member_roles | ALL | authenticated | `((role = 'member'::text) AND is_project_admin(project_id))` | `((role = 'member'::text) AND is_project_admin(project_id))` |
| public.project_roles | read_all_project_roles | SELECT | authenticated | `true` | — |
| public.project_roles | su_write_admin_roles | ALL | authenticated | `((role = 'admin'::text) AND is_superuser())` | `((role = 'admin'::text) AND is_superuser())` |
| public.project_settings | read_project_settings | SELECT | authenticated | `true` | — |
| public.projects | admin_update_projects | UPDATE | authenticated | `is_project_admin(id)` | `is_project_admin(id)` |
| public.projects | read_all_projects | SELECT | authenticated | `true` | — |
| public.projects | su_delete_projects | DELETE | authenticated | `is_superuser()` | — |
| public.projects | su_insert_projects | INSERT | authenticated | — | `is_superuser()` |
| public.task_dependencies | admin_write_task_dependencies | ALL | authenticated | `is_project_admin(project_id)` | `is_project_admin(project_id)` |
| public.task_dependencies | task_dependencies_select | SELECT | authenticated | `true` | — |
| public.teams | pa_insert_project_teams | INSERT | authenticated | — | `((project_id IS NOT NULL) AND is_project_admin(project_id))` |
| public.teams | pa_update_project_teams | UPDATE | authenticated | `((project_id IS NOT NULL) AND is_project_admin(project_id))` | `((project_id IS NOT NULL) AND is_project_admin(project_id))` |
| public.teams | read_all_teams | SELECT | authenticated | `true` | — |
| public.teams | su_insert_teams | INSERT | authenticated | — | `is_superuser()` |
| public.teams | su_update_teams | UPDATE | authenticated | `is_superuser()` | `is_superuser()` |
| public.usage_events | read_usage_events | SELECT | authenticated | `is_superuser()` | — |
| public.user_preferences | own_user_preferences | ALL | authenticated | `(user_id = auth.uid())` | `(user_id = auth.uid())` |
| public.user_wbs_state | own_user_wbs_state | ALL | authenticated | `(user_id = auth.uid())` | `(user_id = auth.uid())` |
| public.wbs_embeddings | wbs_embeddings_read | SELECT | authenticated | `true` | — |
| public.wbs_items | admin_write_items | ALL | authenticated | `is_project_admin(project_id)` | `is_project_admin(project_id)` |
| public.wbs_items | member_update_actual | UPDATE | authenticated | `(is_project_member(project_id) AND wbs_is_leaf(id) AND (EXISTS ( SELECT 1 FROM item_owners o WHERE ((o.wbs_item_id = wbs_items.id) AND ((o.team_id = ( SELECT m.team_id FROM memberships m WHERE (m.user_id = auth.uid()))) OR (o.team_id IN ( SELECT pm.team_id FROM project_members pm WHERE ((pm.project_id = wbs_items.project_id) AND (pm.user_id = auth.uid()) AND (pm.team_id IS NOT NULL)))))))))` | `(is_project_member(project_id) AND wbs_is_leaf(id) AND (EXISTS ( SELECT 1 FROM item_owners o WHERE ((o.wbs_item_id = wbs_items.id) AND ((o.team_id = ( SELECT m.team_id FROM memberships m WHERE (m.user_id = auth.uid()))) OR (o.team_id IN ( SELECT pm.team_id FROM project_members pm WHERE ((pm.project_id = wbs_items.project_id) AND (pm.user_id = auth.uid()) AND (pm.team_id IS NOT NULL)))))))))` |
| public.wbs_items | read_all_items | SELECT | authenticated | `true` | — |
| public.wbs_progress_snapshots | member_write_snapshots | ALL | authenticated | `is_project_member(project_id)` | `is_project_member(project_id)` |
| public.wbs_progress_snapshots | read_all_progress_snapshots | SELECT | authenticated | `true` | — |
| public.weekly_report_rows | weekly_report_rows_delete | DELETE | authenticated | `(EXISTS ( SELECT 1 FROM weekly_reports r WHERE ((r.id = weekly_report_rows.report_id) AND is_project_admin(r.project_id))))` | — |
| public.weekly_report_rows | weekly_report_rows_insert | INSERT | authenticated | — | `(EXISTS ( SELECT 1 FROM weekly_reports r WHERE ((r.id = weekly_report_rows.report_id) AND is_project_member(r.project_id))))` |
| public.weekly_report_rows | weekly_report_rows_select | SELECT | authenticated | `true` | — |
| public.weekly_report_rows | weekly_report_rows_update | UPDATE | authenticated | `(EXISTS ( SELECT 1 FROM weekly_reports r WHERE ((r.id = weekly_report_rows.report_id) AND is_project_member(r.project_id))))` | `(EXISTS ( SELECT 1 FROM weekly_reports r WHERE ((r.id = weekly_report_rows.report_id) AND is_project_member(r.project_id))))` |
| public.weekly_reports | weekly_reports_delete | DELETE | authenticated | `is_project_admin(project_id)` | — |
| public.weekly_reports | weekly_reports_insert | INSERT | authenticated | — | `is_project_admin(project_id)` |
| public.weekly_reports | weekly_reports_select | SELECT | authenticated | `true` | — |
| public.weekly_reports | weekly_reports_update | UPDATE | authenticated | `is_project_member(project_id)` | `is_project_member(project_id)` |
| public.wiki_change_events | wiki_change_events_read | SELECT | authenticated | `true` | — |
| public.wiki_feedback | wiki_feedback_member_insert | INSERT | authenticated | — | `((user_id = auth.uid()) AND is_project_member(project_id) AND (EXISTS ( SELECT 1 FROM wiki_topics topic WHERE ((topic.id = wiki_feedback.topic_id) AND (topic.project_id = wiki_feedback.project_id)))))` |
| public.wiki_feedback | wiki_feedback_read | SELECT | authenticated | `can_read_project(project_id)` | — |
| public.wiki_item_relations | wiki_item_relations_read | SELECT | authenticated | `true` | — |
| public.wiki_item_sources | wiki_item_sources_read | SELECT | authenticated | `true` | — |
| public.wiki_items | wiki_items_read | SELECT | authenticated | `true` | — |
| public.wiki_questions | wiki_questions_member_insert | INSERT | authenticated | — | `((asked_by = auth.uid()) AND is_project_member(project_id) AND ((topic_id IS NULL) OR (EXISTS ( SELECT 1 FROM wiki_topics topic WHERE ((topic.id = wiki_questions.topic_id) AND (topic.project_id = wiki_questions.project_id))))))` |
| public.wiki_questions | wiki_questions_read | SELECT | authenticated | `can_read_project(project_id)` | — |
| public.wiki_topic_revisions | wiki_topic_revisions_read | SELECT | authenticated | `can_read_project(project_id)` | — |
| public.wiki_topics | wiki_topics_read | SELECT | authenticated | `true` | — |
| realtime.messages | receive_own_notification_channel | SELECT | authenticated | `((realtime.topic() = (('user-'::text \|\| (( SELECT auth.uid() AS uid))::text) \|\| '-notifications'::text)) AND (extension = 'broadcast'::text))` | — |
| realtime.messages | receive_project_wbs_channel | SELECT | authenticated | `((extension = 'broadcast'::text) AND ("substring"(realtime.topic(), '^project-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-wbs$'::text) IS NOT NULL) AND is_project_member(("substring"(realtime.topic(), '^project-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})-wbs$'::text))::uuid))` | — |
| storage.objects | deliverables delete | DELETE | authenticated | `((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid))` | — |
| storage.objects | deliverables insert | INSERT | authenticated | — | `((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid))` |
| storage.objects | deliverables read | SELECT | authenticated | `((bucket_id = 'deliverables'::text) AND can_attach((split_part(name, '/'::text, 1))::uuid))` | — |
| storage.objects | issue-attachments delete | DELETE | authenticated | `((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid))` | — |
| storage.objects | issue-attachments insert | INSERT | authenticated | — | `((bucket_id = 'issue-attachments'::text) AND can_edit_issue((split_part(name, '/'::text, 1))::uuid))` |
| storage.objects | issue-attachments read | SELECT | authenticated | `(bucket_id = 'issue-attachments'::text)` | — |
| storage.objects | minutes bucket delete | DELETE | authenticated | `((bucket_id = 'minutes'::text) AND ((owner = auth.uid()) OR (app_role() = 'pmo_admin'::text)) AND (NOT (EXISTS ( SELECT 1 FROM minute_versions mv WHERE (mv.file_path = objects.name)))))` | — |
| storage.objects | minutes bucket insert | INSERT | authenticated | — | `(bucket_id = 'minutes'::text)` |
| storage.objects | minutes bucket read | SELECT | authenticated | `(bucket_id = 'minutes'::text)` | — |
