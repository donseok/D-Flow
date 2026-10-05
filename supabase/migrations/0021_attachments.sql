-- SP5 B3(D22~26·D56). 롤백은 톰스톤 행이 남으면 거부한다.
-- 잠금 순서: 회의록 NO KEY UPDATE → 해당 설정 FOR SHARE. 설정 쓰기 RPC는 첨부/회의록을 잠그지 않아 순환 없음.
-- 이 파일의 데이터 변화는 톰스톤 열 기본값뿐. 기존 첨부·설정값은 이관/삭제하지 않는다.
alter table public.minute_files
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add column purged_at timestamptz,
  add constraint minute_files_purge_requires_deleted check (purged_at is null or deleted_at is not null);

create function public.minute_attachment_policy_of(p_values jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  p jsonb;
  file_bytes numeric;
  file_count numeric;
  total_bytes numeric;
begin
  if p_values is null or jsonb_typeof(p_values) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
  end if;
  if not (p_values ? 'minutes.attachments') then
    return '{"enabled":true,"maxFileBytes":20971520,"maxCount":10,"maxTotalBytes":209715200,"allowedExtensions":null,"previewEnabled":true}'::jsonb;
  end if;
  p := p_values -> 'minutes.attachments';
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
  end if;
  if not (p ?& array['enabled','maxFileBytes','maxCount','maxTotalBytes','allowedExtensions','previewEnabled'])
     or (select count(*) from jsonb_object_keys(p)) <> 6
     or jsonb_typeof(p -> 'enabled') is distinct from 'boolean'
     or jsonb_typeof(p -> 'previewEnabled') is distinct from 'boolean'
     or jsonb_typeof(p -> 'maxFileBytes') is distinct from 'number'
     or jsonb_typeof(p -> 'maxCount') is distinct from 'number'
     or jsonb_typeof(p -> 'maxTotalBytes') is distinct from 'number' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
  end if;
  file_bytes := (p ->> 'maxFileBytes')::numeric;
  file_count := (p ->> 'maxCount')::numeric;
  total_bytes := (p ->> 'maxTotalBytes')::numeric;
  if file_bytes <> trunc(file_bytes) or file_bytes < 1 or file_bytes > 20971520
     or file_count <> trunc(file_count) or file_count < 1 or file_count > 10
     or total_bytes <> trunc(total_bytes) or total_bytes < file_bytes or total_bytes > file_bytes * file_count then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
  end if;
  if p -> 'allowedExtensions' <> 'null'::jsonb then
    if jsonb_typeof(p -> 'allowedExtensions') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
    end if;
    if jsonb_array_length(p -> 'allowedExtensions') > 30
       or exists (select 1 from jsonb_array_elements(p -> 'allowedExtensions') e
                   where jsonb_typeof(e) is distinct from 'string' or (e #>> '{}') !~ '^[a-z0-9]{1,10}$')
       or (select count(*) from jsonb_array_elements(p -> 'allowedExtensions'))
          <> (select count(distinct e) from jsonb_array_elements(p -> 'allowedExtensions') e) then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
    end if;
  end if;
  return p;
end
$$;
revoke all on function public.minute_attachment_policy_of(jsonb) from public, anon, authenticated;
grant execute on function public.minute_attachment_policy_of(jsonb) to service_role;

create function public.minute_files_mutation_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 전이 a: 첨부 톰스톤. 파일/등록자/다른 열 동시 변경은 금지.
  if old.role = 'attachment' and old.deleted_at is null and new.deleted_at is not null and new.deleted_by is not null
     and (to_jsonb(new) - array['deleted_at','deleted_by']) = (to_jsonb(old) - array['deleted_at','deleted_by']) then
    return new;
  end if;
  -- 전이 b: 객체 삭제 완료. 삭제 시각/행위자는 바꾸지 않는다.
  if old.role = 'attachment' and old.deleted_at is not null and old.purged_at is null and new.purged_at is not null
     and (to_jsonb(new) - 'purged_at') = (to_jsonb(old) - 'purged_at') then
    return new;
  end if;
  -- 전이 c: auth.users 삭제의 두 FK SET NULL. 서비스 역할에도 나머지 불변식 적용.
  if (old.uploaded_by is not null and new.uploaded_by is null or old.deleted_by is not null and new.deleted_by is null)
     and (new.uploaded_by is not distinct from old.uploaded_by or old.uploaded_by is not null and new.uploaded_by is null)
     and (new.deleted_by is not distinct from old.deleted_by or old.deleted_by is not null and new.deleted_by is null)
     and (to_jsonb(new) - array['uploaded_by','deleted_by']) = (to_jsonb(old) - array['uploaded_by','deleted_by']) then
    return new;
  end if;
  raise exception using errcode = '23514', message = 'MINUTE_FILE_IMMUTABLE';
end
$$;
revoke all on function public.minute_files_mutation_guard() from public, anon, authenticated;
create trigger minute_files_mutation_guard before update on public.minute_files
  for each row execute function public.minute_files_mutation_guard();
drop policy attachment_delete_minute_files on public.minute_files;
revoke delete on public.minute_files from authenticated;

create or replace function public.minute_files_attachment_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_ws uuid;
  v_project uuid;
  v_archived timestamptz;
  v_owner uuid;
  v_meta jsonb;
  v_values jsonb;
  v_policy jsonb;
  v_extension text;
begin
  -- H2 ①: 판정 불가/관리 불가 세션은 RLS가 거부한다. service_role INSERT 길은 새로 만들지 않는다.
  if not public.can_manage_minute(new.minute_id) then return new; end if;
  -- ②: 개수 확정·권한 회수·보관을 직렬화한다.
  select mi.workspace_id, mi.project_id, mi.archived_at into v_ws, v_project, v_archived
    from public.minutes mi where mi.id = new.minute_id for no key update;
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'MINUTE_ATTACHMENT_ISOLATION';
  end if;
  if v_archived is not null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_ARCHIVED';
  end if;
  if not public.can_manage_minute(new.minute_id) then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_FORBIDDEN';
  end if;
  -- D24: 실제 회의록 행 범위. 없음/손상은 기본값으로 바꾸지 않는다. 프로젝트는 런타임 상속 없음.
  if v_project is not null then
    select s.values into v_values from public.project_settings s where s.project_id = v_project for share;
  else
    select s.values into v_values from public.workspace_settings s where s.workspace_id = v_ws for share;
  end if;
  if not found then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:minutes.attachments';
  end if;
  v_policy := public.minute_attachment_policy_of(v_values);
  -- ③: 객체 경로는 그 회의록의 실제 scope.
  if not coalesce(public.storage_ws(new.file_path) = v_ws
                  and public.storage_project(new.file_path) is not distinct from v_project
                  and split_part(new.file_path, '/', 5) = 'minute-files'
                  and public.storage_entity_id(new.file_path) = new.minute_id, false) then
    raise exception using errcode = '22023', message = 'MINUTE_ATTACHMENT_PATH';
  end if;
  -- ④: 세션이 올린 객체의 실제 크기·MIME. 선언한 행 메타는 버린다.
  select o.owner, o.metadata into v_owner, v_meta from storage.objects o where o.bucket_id = 'minutes' and o.name = new.file_path;
  if not found or v_owner is distinct from auth.uid() or (v_meta ->> 'size') is null then
    raise exception using errcode = '42501', message = 'MINUTE_ATTACHMENT_OBJECT';
  end if;
  new.size := (v_meta ->> 'size')::bigint;
  new.mime := coalesce(nullif(v_meta ->> 'mimetype', ''), 'application/octet-stream');
  -- ⑤: 중복은 톰스톤 포함 전체 행, 한도/disabled보다 먼저. 같은 경로는 다시 사용하지 않는다.
  if exists (select 1 from public.minute_files f where f.role = 'attachment' and f.file_path = new.file_path) then
    raise exception using errcode = '23505', message = 'MINUTE_ATTACHMENT_DUPLICATE';
  end if;
  -- 신규 INSERT로 톰스톤/정리 완료를 위장해 활성 첨부 한도를 우회하지 못한다.
  if new.deleted_at is not null or new.deleted_by is not null or new.purged_at is not null then
    raise exception using errcode = '23514', message = 'MINUTE_FILE_IMMUTABLE';
  end if;
  if not (v_policy ->> 'enabled')::boolean then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_DISABLED';
  end if;
  -- ⑥: 톰스톤만 제외한다. purged_at을 기다리지 않으며 설정의 현재 제한만 판정.
  if (select count(*) from public.minute_files f where f.minute_id = new.minute_id and f.role = 'attachment' and f.deleted_at is null)
       >= (v_policy ->> 'maxCount')::int then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_LIMIT';
  end if;
  if new.size > (v_policy ->> 'maxFileBytes')::bigint then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_TOO_LARGE';
  end if;
  if coalesce((select sum(f.size) from public.minute_files f where f.minute_id = new.minute_id and f.role = 'attachment' and f.deleted_at is null), 0) + new.size
       > (v_policy ->> 'maxTotalBytes')::bigint then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_TOTAL_EXCEEDED';
  end if;
  v_extension := lower(substring(new.file_name from '\.([a-zA-Z0-9]+)$'));
  if v_policy -> 'allowedExtensions' <> 'null'::jsonb
     and not ((v_policy -> 'allowedExtensions') ? coalesce(v_extension, '')) then
    raise exception using errcode = '23514', message = 'MINUTE_ATTACHMENT_EXTENSION';
  end if;
  return new;
end
$$;
revoke all on function public.minute_files_attachment_guard() from public, anon, authenticated;

-- 삭제가 객체 정리보다 먼저 완료된다. 직접 Storage 서명도 새로 발급하지 못하도록 톰스톤을 검사한다.
-- read 정책에서 가린 톰스톤을 확인하려고 DEFINER를 쓴다. 반환은 원래 Storage 읽기 범위 안에서의 boolean뿐.
create function public.minute_attachment_path_active(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.storage_ws(p_path) is not null
     and public.is_ws_member(public.storage_ws(p_path))
     and (public.storage_project(p_path) is null or public.can_read_project(public.storage_project(p_path)))
     and not exists (select 1 from public.minute_files f where f.file_path = p_path and f.deleted_at is not null)
$$;
revoke all on function public.minute_attachment_path_active(text) from public, anon;
grant execute on function public.minute_attachment_path_active(text) to authenticated, service_role;
drop policy minute_files_ws_read on public.minute_files;
create policy minute_files_ws_read on public.minute_files for select to authenticated using (
  deleted_at is null and exists (select 1 from public.minutes m where m.id = minute_files.minute_id and m.workspace_id in (select public.my_workspace_ids())));
drop policy "minutes bucket read" on storage.objects;
create policy "minutes bucket read" on storage.objects for select to authenticated using (
  bucket_id = 'minutes' and public.storage_ws(name) is not null and public.is_ws_member(public.storage_ws(name))
  and (public.storage_project(name) is null or public.can_read_project(public.storage_project(name)))
  and (split_part(name, '/', 5) <> 'minute-files' or public.minute_attachment_path_active(name)));

-- H2 이월: 첨부 행도 Storage 객체와 같은 실제 엔티티 scope 경로를 받는다. 기존 경로는 보고만 한다.
do $$
declare d bigint; i bigint;
begin
  select count(*) into d from public.deliverable_attachments a join public.wbs_items w on w.id = a.wbs_item_id join public.projects p on p.id = w.project_id
    where not coalesce(public.storage_ws(a.file_path) = p.workspace_id and public.storage_project(a.file_path) = w.project_id
                   and split_part(a.file_path, '/', 5) = 'deliverables' and public.storage_entity_id(a.file_path) = w.id, false);
  select count(*) into i from public.issue_attachments a join public.issues x on x.id = a.issue_id join public.projects p on p.id = x.project_id
    where not coalesce(public.storage_ws(a.file_path) = p.workspace_id and public.storage_project(a.file_path) = x.project_id
                   and split_part(a.file_path, '/', 5) = 'issue-attachments' and public.storage_entity_id(a.file_path) = x.id, false);
  raise notice 'ATTACHMENTS_LEGACY_PATHS deliverable=% issue=% (보고만, 삭제/이관 없음)', d, i;
end
$$;
drop policy attach_insert on public.deliverable_attachments;
create policy attach_insert on public.deliverable_attachments for insert to authenticated with check (
  public.can_attach(wbs_item_id) and exists (
    select 1 from public.wbs_items w join public.projects p on p.id = w.project_id where w.id = deliverable_attachments.wbs_item_id
      and public.storage_ws(deliverable_attachments.file_path) = p.workspace_id
      and public.storage_project(deliverable_attachments.file_path) = w.project_id
      and split_part(deliverable_attachments.file_path, '/', 5) = 'deliverables'
      and public.storage_entity_id(deliverable_attachments.file_path) = w.id));
drop policy insert_issue_attachments on public.issue_attachments;
create policy insert_issue_attachments on public.issue_attachments for insert to authenticated with check (
  public.can_edit_issue(issue_id) and exists (
    select 1 from public.issues i join public.projects p on p.id = i.project_id where i.id = issue_attachments.issue_id
      and public.storage_ws(issue_attachments.file_path) = p.workspace_id
      and public.storage_project(issue_attachments.file_path) = i.project_id
      and split_part(issue_attachments.file_path, '/', 5) = 'issue-attachments'
      and public.storage_entity_id(issue_attachments.file_path) = i.id));

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'minute_files' and policyname = 'attachment_delete_minute_files')
     or has_table_privilege('authenticated', 'public.minute_files', 'DELETE')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.minute_files'::regclass and tgname = 'minute_files_attachment_guard' and not tgisinternal)
     or not exists (select 1 from pg_trigger where tgrelid = 'public.minute_files'::regclass and tgname = 'minute_files_mutation_guard' and not tgisinternal)
     or (select position('25001' in prosrc) = 0 or position('deleted_at is null' in prosrc) = 0 or position('minutes.attachments' in prosrc) = 0
           from pg_proc where oid = 'public.minute_files_attachment_guard()'::regprocedure)
     or exists (select 1 from pg_policies where schemaname = 'public' and (tablename, policyname) in
                (('deliverable_attachments','attach_insert'),('issue_attachments','insert_issue_attachments')) and position('storage_entity_id' in with_check) = 0)
     or has_function_privilege('anon', 'public.minute_attachment_path_active(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.minute_files_mutation_guard()', 'EXECUTE') then
    raise exception using errcode = '23514', message = 'ATTACHMENTS_POSTCHECK';
  end if;
end
$$;
