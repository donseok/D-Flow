-- *_attachments 이전 스키마에 합성 데이터만 만든다. psql -1 -v ON_ERROR_STOP=1로 실행.
-- 적용/롤백 왕복에서 본문·버전·활성 첨부·설정값/이력·옛 잘못된 경로가 보존되는지 확인한다.
insert into auth.users (id, email) values ('00000000-0000-0000-5c05-0000000b3001', 'sp5-b3-rh@example.com');
insert into public.workspaces (id, slug, name) values ('00000000-0000-0000-5c05-0000000b3011', 'sp5-b3-rh', 'SP5 B3 리허설');
insert into public.workspace_members (workspace_id, user_id, role) values
 ('00000000-0000-0000-5c05-0000000b3011', '00000000-0000-0000-5c05-0000000b3001', 'admin');
insert into public.projects (id, workspace_id, name) values
 ('00000000-0000-0000-5c05-0000000b3021', '00000000-0000-0000-5c05-0000000b3011', 'SP5 B3 프로젝트');
-- 아직 DB validator에 새 키가 없더라도 저장 정책을 이관이 건드리지 않는다는 계약을 검사한다.
update public.workspace_settings set values = values || '{"minutes.attachments":{"enabled":false,"maxFileBytes":100,"maxCount":2,"maxTotalBytes":150,"allowedExtensions":[],"previewEnabled":false}}'
 where workspace_id = '00000000-0000-0000-5c05-0000000b3011';
update public.project_settings set values = values || '{"minutes.attachments":{"enabled":true,"maxFileBytes":100,"maxCount":2,"maxTotalBytes":150,"allowedExtensions":["pdf"],"previewEnabled":true}}'
 where project_id = '00000000-0000-0000-5c05-0000000b3021';
insert into public.minutes (id, workspace_id, project_id, title, body_md, minute_date, team_code, created_by) values
 ('00000000-0000-0000-5c05-0000000b3031', '00000000-0000-0000-5c05-0000000b3011', '00000000-0000-0000-5c05-0000000b3021', '리허설 회의록', '# 원문 보존', '2026-10-04', 'ERP', '00000000-0000-0000-5c05-0000000b3001');
insert into public.minute_files (id, minute_id, role, file_name, file_path, size, mime, uploaded_by) values
 ('00000000-0000-0000-5c05-0000000b3041', '00000000-0000-0000-5c05-0000000b3031', 'body', 'body.md', 'ws/00000000-0000-0000-5c05-0000000b3011/p/00000000-0000-0000-5c05-0000000b3021/minutes/00000000-0000-0000-5c05-0000000b3031/body.md', 1000, 'text/markdown', '00000000-0000-0000-5c05-0000000b3001'),
 ('00000000-0000-0000-5c05-0000000b3042', '00000000-0000-0000-5c05-0000000b3031', 'attachment', 'old.pdf', 'ws/00000000-0000-0000-5c05-0000000b3011/p/00000000-0000-0000-5c05-0000000b3021/minute-files/00000000-0000-0000-5c05-0000000b3031/old.pdf', 1000, 'application/pdf', '00000000-0000-0000-5c05-0000000b3001');
insert into public.minute_versions (id, minute_id, version_no, body_md, body_hash, title, minute_date, team_code, project_id, file_path, file_name, file_size, file_mime) values
 ('00000000-0000-0000-5c05-0000000b3051', '00000000-0000-0000-5c05-0000000b3031', 1, '# 과거 원문', 'rh-body-hash', '과거 제목', '2026-10-03', 'ERP', '00000000-0000-0000-5c05-0000000b3021', 'ws/00000000-0000-0000-5c05-0000000b3011/p/00000000-0000-0000-5c05-0000000b3021/minutes/00000000-0000-0000-5c05-0000000b3031/version.md', 'version.md', 900, 'text/markdown');
insert into public.wbs_items (id, project_id, code, name) values
 ('00000000-0000-0000-5c05-0000000b3061', '00000000-0000-0000-5c05-0000000b3021', '1', '합성 산출물');
insert into public.issues (id, project_id, title) values
 ('00000000-0000-0000-5c05-0000000b3071', '00000000-0000-0000-5c05-0000000b3021', '합성 이슈');
-- 새 INSERT 정책은 옛 범위 밖 경로를 고치거나 지우지 않는다. 적용 NOTICE가 각각 1건을 보고해야 한다.
insert into public.deliverable_attachments (id, wbs_item_id, file_name, file_path) values
 ('00000000-0000-0000-5c05-0000000b3081', '00000000-0000-0000-5c05-0000000b3061', 'legacy.pdf', 'legacy/deliverable.pdf');
insert into public.issue_attachments (id, issue_id, project_id, file_name, file_path) values
 ('00000000-0000-0000-5c05-0000000b3082', '00000000-0000-0000-5c05-0000000b3071', '00000000-0000-0000-5c05-0000000b3021', 'legacy.pdf', 'legacy/issue.pdf');
insert into public.project_settings_history (project_id, revision, key, new_value, source, command_id, changed_by)
 select project_id, revision, 'minutes.attachments', values -> 'minutes.attachments', 'edit', '00000000-0000-0000-5c05-0000000b3091', '00000000-0000-0000-5c05-0000000b3001'
 from public.project_settings where project_id = '00000000-0000-0000-5c05-0000000b3021';
insert into public.workspace_settings_history (workspace_id, revision, key, new_value, source, command_id, changed_by)
 select workspace_id, revision, 'minutes.attachments', values -> 'minutes.attachments', 'edit', '00000000-0000-0000-5c05-0000000b3092', '00000000-0000-0000-5c05-0000000b3001'
 from public.workspace_settings where workspace_id = '00000000-0000-0000-5c05-0000000b3011';
