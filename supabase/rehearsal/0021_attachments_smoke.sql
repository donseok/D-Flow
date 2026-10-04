-- *_attachments_seed.sql → 적용/재적용 뒤 두 번 실행. 모든 변경은 rollback된다.
begin;
do $$
begin
  if (select body_md from public.minutes where id = '00000000-0000-0000-5c05-0000000b3031') is distinct from '# 원문 보존'
     or (select body_md from public.minute_versions where id = '00000000-0000-0000-5c05-0000000b3051') is distinct from '# 과거 원문'
     or (select count(*) <> 2 from public.minute_files where minute_id = '00000000-0000-0000-5c05-0000000b3031' and deleted_at is null and purged_at is null)
     or (select count(*) <> 1 from public.deliverable_attachments where id = '00000000-0000-0000-5c05-0000000b3081' and file_path = 'legacy/deliverable.pdf')
     or (select count(*) <> 1 from public.issue_attachments where id = '00000000-0000-0000-5c05-0000000b3082' and file_path = 'legacy/issue.pdf')
     or has_table_privilege('authenticated', 'public.minute_files', 'DELETE')
     or has_table_privilege('authenticated', 'public.minute_files', 'UPDATE')
     or has_function_privilege('anon', 'public.minute_attachment_path_active(text)', 'EXECUTE') then
    raise exception 'ATTACHMENTS_SMOKE: 데이터/권한';
  end if;
  if (select public.minute_attachment_policy_of(values) ->> 'maxFileBytes' from public.project_settings where project_id = '00000000-0000-0000-5c05-0000000b3021') is distinct from '100'
     or (select public.minute_attachment_policy_of(values) ->> 'enabled' from public.workspace_settings where workspace_id = '00000000-0000-0000-5c05-0000000b3011') is distinct from 'false' then
    raise exception 'ATTACHMENTS_SMOKE: 설정 보존';
  end if;
  -- 과거 파일은 현재 제한보다 커도 보존한다. 본문 교체 경로가 쓰는 delete/insert는 계속 허용한다.
  delete from public.minute_files where id = '00000000-0000-0000-5c05-0000000b3041';
  insert into public.minute_files (minute_id, role, file_name, file_path, size, mime)
    values ('00000000-0000-0000-5c05-0000000b3031', 'body', 'new.md', 'synthetic/new.md', 20, 'text/markdown');
  update public.minute_files set deleted_at = now(), deleted_by = '00000000-0000-0000-5c05-0000000b3001' where id = '00000000-0000-0000-5c05-0000000b3042';
  update public.minute_files set purged_at = now() where id = '00000000-0000-0000-5c05-0000000b3042';
  begin
    update public.minute_files set deleted_at = null, purged_at = null, deleted_by = null where id = '00000000-0000-0000-5c05-0000000b3042';
    raise exception 'ATTACHMENTS_SMOKE: 되살리기가 허용됨';
  exception when check_violation then
    if sqlerrm <> 'MINUTE_FILE_IMMUTABLE' then raise; end if;
  end;
  raise notice 'ATTACHMENTS_SMOKE: 데이터/설정/권한/본문 교체/톰스톤 전이 통과';
end $$;
rollback;
