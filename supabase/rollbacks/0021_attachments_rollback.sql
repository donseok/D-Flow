-- SP5 B3 첨부 롤백. 설정 값/이력은 되돌리지 않는다. 객체 purge만으로 톰스톤 행이 사라지지 않는다.
-- 톰스톤 행이 있으면 중단: 백업 복구 또는 객체 정리 뒤 톰스톤 메타 삭제(데이터 손실)를 별도 승인해 실행한 후 재시도.
do $$ begin
  if exists (select 1 from public.minute_files where deleted_at is not null) then
    raise exception using errcode = '23514', message = 'ATTACHMENTS_ROLLBACK_BLOCKED:톰스톤 행이 남아 있습니다. 백업 복구 또는 객체 정리 후 톰스톤 메타 삭제를 별도 확인하세요.';
  end if;
end $$;
drop trigger minute_files_mutation_guard on public.minute_files;
drop function public.minute_files_mutation_guard();
create or replace function public.minute_files_attachment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_project uuid;
  v_archived timestamptz;
  v_owner uuid;
  v_meta jsonb;
begin
  -- ① 관리할 수 없는 세션은 RLS(attachment_insert_minute_files)가 42501 로 거부한다 — 가드가 먼저 다른 오류를 내면 격리 탐침
  --    (tests/rls/isolation-map.ts OWN_INSERT_PROBES minute_files)이 RLS 거부를 보지 못한다. service_role(auth.uid() null)도 여기서 통과.
  if not public.can_manage_minute(new.minute_id) then
    return new;
  end if;
  -- ② 회의록 행을 잠근다 — 같은 회의록의 첨부 확정을 직렬화하고(개수 경합) 그사이의 보관을 본다
  select mi.workspace_id, mi.project_id, mi.archived_at into v_ws, v_project, v_archived
    from public.minutes mi where mi.id = new.minute_id for no key update;
  -- 격리 수준 규칙(0011 ①·⑧·⑨·⑩ 공통): 잠금 아래에서 다른 행을 읽어 판정하는 가드는 read committed 가 아니면 거절한다(fail-closed, 25001).
  -- read committed 는 문장마다 새 스냅샷이라 잠금을 얻은 뒤의 조회가 앞 연결의 커밋을 본다. repeatable read·serializable 은 트랜잭션 스냅샷
  -- 하나로 읽어 잠금을 기다리는 사이(또는 스냅샷 뒤에) 커밋된 변경을 못 본다. serializable 의 SSI 는 두 트랜잭션이 모두 serializable 일 때만
  -- 한쪽을 중단하는데 상대(PostgREST·서버 경로)는 read committed 로 들어온다. 이름으로 판정하므로 read uncommitted 도 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 넘겨준 앞 연결이 커밋한 첨부 행·권한 회수 — 11개째가 들어가거나 회수된 권한으로 확정된다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'MINUTE_ATTACHMENT_ISOLATION';
  end if;
  if v_archived is not null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_ARCHIVED';
  end if;
  -- 잠금을 기다리는 사이 커밋된 권한 회수(명단·소속·작성자)를 본다 — ① 과 RLS WITH CHECK 는 기다리기 전의 스냅샷으로 판정했다.
  -- 이 문장은 새 스냅샷이다(read committed). 앱이 사용자 문구로 옮기는 다섯 코드와 겹치지 않는 이름을 쓴다(모르는 코드 = 일반 문구 + 로그).
  if not public.can_manage_minute(new.minute_id) then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_FORBIDDEN';
  end if;
  -- ③ 경로 = ws/<회의록 ws>/p/<회의록 프로젝트|_>/minute-files/<회의록 id>/<파일>(프로젝트는 is not distinct from)
  if not coalesce(public.storage_ws(new.file_path) = v_ws
                  and public.storage_project(new.file_path) is not distinct from v_project
                  and split_part(new.file_path, '/', 5) = 'minute-files'
                  and public.storage_entity_id(new.file_path) = new.minute_id, false) then
    raise exception using errcode = '22023', message = 'MINUTE_ATTACHMENT_PATH';
  end if;
  -- ④ 객체는 이 세션이 올린 것이고, 크기·형식은 객체 메타데이터 값이다(클라이언트 선언값을 믿지 않는다)
  select o.owner, o.metadata into v_owner, v_meta
    from storage.objects o where o.bucket_id = 'minutes' and o.name = new.file_path;
  if not found or v_owner is distinct from auth.uid() or (v_meta ->> 'size') is null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_OBJECT';
  end if;
  new.size := (v_meta ->> 'size')::bigint;
  new.mime := coalesce(nullif(v_meta ->> 'mimetype', ''), 'application/octet-stream');
  -- ⑤ 같은 경로 재전송은 중복 — 개수 검사보다 먼저(10개째 재전송이 '한도 초과'로 보이지 않게)
  if exists (select 1 from public.minute_files f where f.role = 'attachment' and f.file_path = new.file_path) then
    raise exception using errcode = '23505', message = 'MINUTE_ATTACHMENT_DUPLICATE';
  end if;
  -- ⑥ 운영 상한 10개(domain/minutes.ts MINUTE_ATTACHMENTS_MAX_COUNT, 스펙 §2.9.2). SP5 0017 이 minutes.attachments 설정을 읽게 바꾼다
  if (select count(*) from public.minute_files f where f.minute_id = new.minute_id and f.role = 'attachment') >= 10 then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_LIMIT';
  end if;
  return new;
end
$$;
revoke all on function public.minute_files_attachment_guard() from public, anon, authenticated;
create policy attachment_delete_minute_files on public.minute_files for delete to authenticated using (role = 'attachment' and public.can_manage_minute(minute_id));
grant delete on public.minute_files to authenticated;
drop policy minute_files_ws_read on public.minute_files;
create policy minute_files_ws_read on public.minute_files for select to authenticated using (
  exists (select 1 from public.minutes m where m.id = minute_files.minute_id and m.workspace_id in (select public.my_workspace_ids())));
drop policy "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects for select to authenticated using (
  bucket_id = 'minutes' and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null or public.can_read_project(public.storage_project(name))));
drop function public.minute_attachment_path_active(text);
drop function public.minute_attachment_policy_of(jsonb);
drop policy attach_insert on public.deliverable_attachments;
create policy attach_insert on public.deliverable_attachments for insert to authenticated with check (public.can_attach(wbs_item_id));
drop policy insert_issue_attachments on public.issue_attachments;
create policy insert_issue_attachments on public.issue_attachments for insert to authenticated with check (public.can_edit_issue(issue_id));
alter table public.minute_files drop constraint minute_files_purge_requires_deleted, drop column deleted_at, drop column deleted_by, drop column purged_at;
