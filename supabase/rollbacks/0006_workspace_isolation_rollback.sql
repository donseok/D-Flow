-- 0006_workspace_isolation 롤백 — 0005 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: compare-catalog.mjs diff).
-- 새 컬럼의 값은 버린다(데이터 보존 절차 없음 — 원격이 생기기 전). 되돌린 상태는 0005 의 결함 그대로다: 개방 읽기 39,
-- app_role()(아무 워크스페이스의 관리자), anon 쓰기 권한, 명단 행 인물·프로젝트 변경, 명단 삭제 시 기록 연쇄 삭제.
-- 롤백 전 중복 정리 두 가지 — 아래 ⓪ 이 먼저 검사해 ROLLBACK_PRECONDITION 으로 멈춘다(중간에 23505 로 깨지기 전에 무엇을 고칠지 보여 준다):
--  (가) 같은 사용자의 user_preferences 가 워크스페이스별로 여러 행이면 PK (user_id) 복원이 23505 로 실패한다
--       — `delete from public.user_preferences` 로 사용자당 1행만 남긴 뒤 돌린다.
--  (나) 프로젝트 없는 루트 폴더 이름은 0006 뒤로 워크스페이스마다 유일하다 — 같은 팀 코드의 시드 루트가 두 워크스페이스에 있으면(정상 상태)
--       전역 유일 인덱스(name) 복원이 23505 로 실패한다. 찾기: `select name from public.minute_folders where parent_id is null and
--       project_id is null group by name having count(*) > 1`. 겹친 루트는 한 워크스페이스 것만 남기고 이름을 바꾼 뒤 돌린다(하위 폴더·회의록은
--       루트 id 를 따라가므로 그대로다).
-- 함수 본문·정책 본문·ACL 은 0005 카탈로그 캡처(pg_get_functiondef·pg_policies·proacl·relacl)에서 글자 그대로 옮겼다.
-- 순서는 마이그레이션의 역순(⑦ → ①): 새 컬럼을 읽는 정책·함수를 먼저 되돌린 뒤 컬럼을 지운다.

begin;

-- ⓪ 전제 확인(헤더 (가)·(나)) — 복원할 전역 유일 제약을 어길 행이 있으면 아무것도 바꾸기 전에 멈춘다 ----------------------------
do $$
declare v_prefs text; v_roots text;
begin
  select string_agg(format('%s(%s행)', user_id, n), ', ' order by user_id) into v_prefs
    from (select user_id, count(*) as n from public.user_preferences group by user_id having count(*) > 1) d;
  select string_agg(format('%s(%s개)', name, n), ', ' order by name) into v_roots
    from (select name, count(*) as n from public.minute_folders
           where parent_id is null and project_id is null group by name having count(*) > 1) d;
  if v_prefs is not null or v_roots is not null then
    raise exception 'ROLLBACK_PRECONDITION: 전역 유일 제약을 되살리기 전에 정리할 행이 있다 — user_preferences 사용자당 여러 행: %; 프로젝트 없는 루트 폴더 이름 중복: %',
      coalesce(v_prefs, '없음'), coalesce(v_roots, '없음');
  end if;
end $$;

-- ⑦ 실행·쓰기 권한 복원 -------------------------------------------------------------------------------------------
-- anon 쓰기는 0005 에 그 권한이 있던 41개 관계에만(all tables 로 주면 0003 신설 표에 없던 권한이 생긴다)
grant insert, update, delete, truncate on public.agent_lead_leases to anon;
grant insert, update, delete, truncate on public.agent_watchers to anon;
grant insert, update, delete, truncate on public.announcement_seen to anon;
grant insert, update, delete, truncate on public.announcements to anon;
grant insert, update, delete, truncate on public.area_teams to anon;
grant insert, update, delete, truncate on public.attendance_records to anon;
grant insert, update, delete, truncate on public.change_logs to anon;
grant insert, update, delete, truncate on public.deliverable_attachments to anon;
grant insert, update, delete, truncate on public.holidays to anon;
grant insert, update, delete, truncate on public.issue_assignees to anon;
grant insert, update, delete, truncate on public.issues to anon;
grant insert, update, delete, truncate on public.item_owners to anon;
grant insert, update, delete, truncate on public.llm_config to anon;
grant insert, update, delete, truncate on public.llm_profiles to anon;
grant insert, update, delete, truncate on public.meeting_attendees to anon;
grant insert, update, delete, truncate on public.meeting_exceptions to anon;
grant insert, update, delete, truncate on public.meetings to anon;
grant insert, update, delete, truncate on public.minute_embeddings to anon;
grant insert, update, delete, truncate on public.minute_favorites to anon;
grant insert, update, delete, truncate on public.minute_folders to anon;
grant insert, update, delete, truncate on public.minute_highlights to anon;
grant insert, update, delete, truncate on public.minute_insights to anon;
grant insert, update, delete, truncate on public.people to anon;
grant insert, update, delete, truncate on public.platform_admins to anon;
grant insert, update, delete, truncate on public.profiles to anon;
grant insert, update, delete, truncate on public.project_ai_briefs to anon;
grant insert, update, delete, truncate on public.project_areas to anon;
grant insert, update, delete, truncate on public.project_member_teams to anon;
grant insert, update, delete, truncate on public.project_members to anon;
grant insert, update, delete, truncate on public.projects to anon;
grant insert, update, delete, truncate on public.task_dependencies to anon;
grant insert, update, delete, truncate on public.teams to anon;
grant insert, update, delete, truncate on public.user_preferences to anon;
grant insert, update, delete, truncate on public.user_wbs_state to anon;
grant insert, update, delete, truncate on public.wbs_embeddings to anon;
grant insert, update, delete, truncate on public.wbs_items to anon;
grant insert, update, delete, truncate on public.wbs_progress_snapshots to anon;
grant insert, update, delete, truncate on public.weekly_report_rows to anon;
grant insert, update, delete, truncate on public.weekly_reports to anon;
grant insert, update, delete, truncate on public.workspace_members to anon;
grant insert, update, delete, truncate on public.workspaces to anon;
alter default privileges for role postgres in schema public grant insert, update, delete, truncate on tables to anon;
alter default privileges for role postgres in schema public grant execute on functions to anon;
-- 헬퍼 15개 중 can_edit_issue 는 0005 에도 anon 권한이 없었다 — 14개만
grant execute on function public.is_superuser(), public.my_workspace_ids(), public.is_ws_member(uuid), public.is_ws_admin(uuid),
  public.project_ws(uuid), public.accessible_project_ids(), public.can_read_project(uuid), public.is_project_admin(uuid),
  public.is_project_member(uuid), public.is_project_admin_anywhere_in_ws(uuid), public.my_member_id(uuid),
  public.my_team_ids(uuid), public.can_attach(uuid), public.wbs_is_leaf(uuid) to anon;
grant execute on function public.project_ws(uuid) to authenticated;
grant execute on function public.import_wbs(uuid, jsonb, jsonb), public.import_wbs_upsert(uuid, jsonb, uuid),
  public.replace_wbs(uuid, jsonb, jsonb),
  public.match_minute_documents(vector, integer, text, date, date, uuid[]), public.match_wbs_documents(vector, integer, uuid, text[]),
  public.usage_daily_actives(date, date), public.usage_menu_ranking(date, date), public.usage_sessions(date, date, integer),
  public.usage_summary(date, date, date), public.usage_user_rollup(date, date), public.lead_lease_ttl() to public, anon;

-- ⑥ 회의록 생성 RPC — 0005 의 17인자 원본(ACL: postgres=X, service_role=X) -----------------------------------------
drop function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid);
CREATE OR REPLACE FUNCTION public.create_minute_with_version(p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text, p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text, p_actor_id uuid, p_actor_name text, p_file_name text DEFAULT NULL::text, p_file_path text DEFAULT NULL::text, p_file_size bigint DEFAULT NULL::bigint, p_file_mime text DEFAULT NULL::text)
 RETURNS TABLE(minute_id uuid, version_id uuid, version_no integer, body_hash text, created_at timestamp with time zone, updated_at timestamp with time zone, wiki_rebuild_required boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_minute_id uuid := coalesce(p_minute_id, gen_random_uuid());
  v_project_id uuid := p_project_id;
  v_occurrence_date date := p_meeting_occurrence_date;
  v_meeting_project_id uuid;
  v_created_at timestamptz;
  v_reset_required boolean := false;
  v_has_file boolean := num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) > 0;
  v_has_complete_file boolean :=
    num_nonnulls(p_file_name, p_file_path, p_file_size, p_file_mime) = 4;
begin
  if p_minute_date is null
     or nullif(btrim(p_team_code), '') is null
     or nullif(btrim(p_title), '') is null
     or char_length(btrim(p_title)) > 200
     or p_body_md is null
     or char_length(p_body_md) > 100000
     or p_body_hash is null
     or p_body_hash is distinct from public.wiki_fnv1a64(p_body_md) then
    raise exception 'MINUTE_CREATE_INPUT_INVALID' using errcode = '22023';
  end if;
  if p_external_id is not null
     and (p_external_id = '' or char_length(p_external_id) > 128) then
    raise exception 'MINUTE_EXTERNAL_ID_INVALID' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = p_team_code and t.active
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
  end if;

  if v_has_file <> v_has_complete_file
     or (
       v_has_file and (
         nullif(btrim(p_file_name), '') is null
         or nullif(btrim(p_file_path), '') is null
         or p_file_size < 0
         or nullif(btrim(p_file_mime), '') is null
         or lower(p_file_name) !~ '\.(md|markdown)$'
         or p_file_path not like (v_minute_id::text || '/%')
         or strpos(p_file_path, '..') > 0
       )
     ) then
    raise exception 'MINUTE_FILE_INPUT_INVALID' using errcode = '22023';
  end if;

  if p_meeting_id is not null then
    select mt.project_id into v_meeting_project_id
    from public.meetings mt
    where mt.id = p_meeting_id;
    if not found then
      raise exception 'MEETING_NOT_FOUND' using errcode = '23503';
    end if;
    if v_project_id is null then
      v_project_id := v_meeting_project_id;
    elsif v_project_id <> v_meeting_project_id then
      raise exception 'MINUTE_MEETING_PROJECT_MISMATCH' using errcode = '23514';
    end if;
    v_occurrence_date := coalesce(v_occurrence_date, p_minute_date);
  else
    v_occurrence_date := null;
  end if;

  if v_project_id is not null then
    -- 같은 프로젝트의 동시 생성도 commit 순서와 시간축 판정을 일치시킨다.
    perform pg_advisory_xact_lock(
      pg_catalog.hashtextextended('wiki-project-chronology:' || v_project_id::text, 0)
    );
  end if;
  -- advisory lock을 얻은 뒤 시각을 고정해 같은 프로젝트 동시 생성의 observed_sort와
  -- commit 순서가 어긋나지 않게 한다.
  v_created_at := clock_timestamp();

  -- 프로젝트 회의록은 생성 순서와 after()/cron 실행 순서가 다를 수 있다. 개별 job을
  -- 즉시 적용하지 않고 durable project keyset queue로 보낸다. 기존 시간축 끝보다 앞에
  -- 삽입되는 경우만 full reset하고, 정상 forward append는 완료 cursor 뒤에 이어 붙인다.
  wiki_rebuild_required := v_project_id is not null;
  if v_project_id is not null then
    v_reset_required := exists (
      select 1
      from public.minutes existing
      where existing.project_id = v_project_id
        and existing.archived_at is null
        and (
          (
            coalesce(existing.meeting_occurrence_date, existing.minute_date)::timestamp
            + (existing.created_at at time zone 'UTC')::time
          ),
          existing.id
        ) > (
          (
            coalesce(v_occurrence_date, p_minute_date)::timestamp
            + (v_created_at at time zone 'UTC')::time
          ),
          v_minute_id
        )
    );
  end if;

  insert into public.minutes as new_minute (
    id, minute_date, team_code, title, body_md,
    meeting_id, project_id, meeting_occurrence_date, folder_id, external_id,
    created_by, created_by_name, created_at, updated_at
  ) values (
    v_minute_id, p_minute_date, p_team_code, btrim(p_title), p_body_md,
    p_meeting_id, v_project_id, v_occurrence_date, p_folder_id, p_external_id,
    p_actor_id, p_actor_name, v_created_at, v_created_at
  )
  returning new_minute.id, new_minute.created_at, new_minute.updated_at
  into minute_id, created_at, updated_at;

  insert into public.minute_versions as new_version (
    minute_id, version_no, body_md, body_hash,
    title, minute_date, team_code, project_id, meeting_id, meeting_occurrence_date,
    file_name, file_path, file_size, file_mime,
    created_by, created_by_name, created_at
  ) values (
    v_minute_id, 1, p_body_md, p_body_hash,
    btrim(p_title), p_minute_date, p_team_code, v_project_id, p_meeting_id, v_occurrence_date,
    p_file_name, p_file_path, p_file_size, p_file_mime,
    p_actor_id, p_actor_name, v_created_at
  )
  returning new_version.id into version_id;

  if v_has_file then
    insert into public.minute_files (
      minute_id, role, file_name, file_path, size, mime, uploaded_by
    ) values (
      v_minute_id, 'body', p_file_name, p_file_path, p_file_size, p_file_mime, p_actor_id
    );
  end if;

  if wiki_rebuild_required then
    if v_reset_required then
      perform public.request_wiki_project_rebuild(
        v_project_id,
        '과거 시점 회의록 추가 후 프로젝트 Wiki 전체 재구성'
      );
    else
      perform public.request_wiki_project_append(
        v_project_id,
        '새 회의록 프로젝트 Wiki 시간순 추가'
      );
    end if;
  end if;

  version_no := 1;
  body_hash := p_body_hash;
  return next;
end
$function$
;
revoke all on function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text) to service_role;

-- ⑤ 명단 보호 복원 ------------------------------------------------------------------------------------------------
drop policy project_member_teams_write on public.project_member_teams;
create policy project_member_teams_write on public.project_member_teams as permissive for all to authenticated
  using ((EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.id = project_member_teams.member_id) AND is_project_admin(pm.project_id)))))
  with check ((EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.id = project_member_teams.member_id) AND is_project_admin(pm.project_id)))));
drop policy wsadmin_write_admin_rows on public.project_members;
create policy wsadmin_write_admin_rows on public.project_members as permissive for all to authenticated
  using (is_ws_admin(project_ws(project_id)))
  with check (is_ws_admin(project_ws(project_id)));
revoke update (access_role, role_label, title, active, sort_order, access_granted_by, access_granted_at, updated_at)
  on public.project_members from authenticated;
grant update on public.project_members to authenticated;
alter table public.attendance_records drop constraint attendance_member_project_fk,
  add constraint attendance_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id) on delete cascade;
alter table public.issue_assignees drop constraint issue_assignees_member_project_fk,
  add constraint issue_assignees_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id) on delete cascade;
alter table public.meeting_attendees drop constraint meeting_attendees_member_project_fk,
  add constraint meeting_attendees_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id) on delete cascade;
alter table public.issues drop constraint issues_assignee_project_fk,
  add constraint issues_assignee_project_fk foreign key (assignee_member_id, project_id) references public.project_members(id, project_id) on delete set null (assignee_member_id);
alter table public.wbs_items drop constraint wbs_items_assignee_member_fk,
  add constraint wbs_items_assignee_member_fk foreign key (assignee_member_id, project_id) references public.project_members(id, project_id) on delete set null (assignee_member_id);
alter table public.wiki_items drop constraint wiki_items_owner_project_fk,
  add constraint wiki_items_owner_project_fk foreign key (owner_member_id, project_id) references public.project_members(id, project_id) on delete set null (owner_member_id);

-- ④ app_role() 복원(ACL: =X postgres anon authenticated service_role) ---------------------------------------------
CREATE FUNCTION public.app_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case
    when public.is_superuser() then 'pmo_admin'
    when exists (select 1 from public.workspace_members wm
                  where wm.user_id = auth.uid() and wm.role = 'admin') then 'pmo_admin'
    when exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                  where pe.user_id = auth.uid() and pm.active and pe.active and pm.access_role = 'admin') then 'pmo_admin'
    when exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                  where pe.user_id = auth.uid() and pm.active and pe.active and pm.access_role is not null) then 'team_editor'
    else null end
$function$
;
grant execute on function public.app_role() to public, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.curate_wiki_item(p_item_id uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(item_id uuid, lifecycle_state text, decision_state text, auto_update_locked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor   uuid := auth.uid();
  v_item    public.wiki_items%rowtype;
  v_before  jsonb;
  v_after   jsonb;
  v_reason  text := left(coalesce(btrim(p_reason), ''), 500);
begin
  if v_actor is null then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;
  if p_action not in ('resolve','reopen','archive','restore','lock','unlock','confirm') then
    raise exception 'WIKI_CURATE_UNKNOWN_ACTION' using errcode = '22023';
  end if;

  select * into v_item from public.wiki_items where id = p_item_id for update;
  if not found then
    raise exception 'WIKI_ITEM_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- 권한 판정은 **대상 항목의 프로젝트** 기준이다(0053). 옛 검사(app_role() is not null)는
  -- 0052 shim 이후 '아무 프로젝트든 역할 보유'로 넓어져, 이 RPC 가 authenticated 에
  -- grant 돼 있는 탓에 멤버 누구나 PostgREST 로 남의 프로젝트 위키를 정리할 수 있었다.
  -- 위키는 RLS 쓰기 정책이 0개라 이 검사가 유일한 방어선이다(스펙 D11).
  if not public.is_project_admin(v_item.project_id) then
    raise exception 'WIKI_CURATE_FORBIDDEN' using errcode = '42501';
  end if;

  v_before := to_jsonb(v_item);

  if p_action = 'resolve' then
    if v_item.lifecycle_state not in ('active','open','conflicted') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = 'resolved', updated_at = now()
      where id = p_item_id;

  elsif p_action = 'reopen' then
    if v_item.lifecycle_state not in ('resolved','archived') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    if v_item.lifecycle_state = 'archived' and not public.wiki_item_has_live_source(p_item_id) then
      raise exception 'WIKI_CURATE_NO_LIVE_SOURCE' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          updated_at = now()
      where id = p_item_id;

  elsif p_action = 'archive' then
    if v_item.lifecycle_state = 'archived' then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    -- 근거(wiki_item_sources)는 지우지 않는다. 숨긴 뒤에도 감사 추적이 남아야 한다.
    update public.wiki_items
      set lifecycle_state = 'archived', updated_at = now()
      where id = p_item_id;

  elsif p_action = 'restore' then
    if v_item.lifecycle_state <> 'archived' then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    -- archived는 사람의 '숨김'만이 아니라 시스템 철회(회의록 보관·프로젝트 이동으로 근거가
    -- 회수된 경우)로도 붙는다. 근거가 하나도 살아있지 않은 항목을 되살리면 원문으로 추적되지
    -- 않는 지식이 현재값이 된다 — Wiki의 근본 계약이 깨지므로 막는다.
    if not public.wiki_item_has_live_source(p_item_id) then
      raise exception 'WIKI_CURATE_NO_LIVE_SOURCE' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          updated_at = now()
      where id = p_item_id;

  elsif p_action in ('lock','unlock') then
    update public.wiki_items
      set auto_update_locked = (p_action = 'lock'), updated_at = now()
      where id = p_item_id;

  elsif p_action = 'confirm' then
    -- 충돌·논의 중 항목을 사람이 현재 정본으로 확정한다. 이후 AI가 다시 덮지 못하도록
    -- 함께 고정한다(canAutoApplyWikiChange가 auto_update_locked에서 멈춘다).
    -- 이미 끝난 항목(대체·완료·숨김)에서는 확정할 수 없다. 그걸 허용하면 폐기된 문장이
    -- 현재값으로 되살아난 뒤 고정까지 돼 그 knowledge_key가 영구 동결된다.
    if v_item.lifecycle_state not in ('active','open','conflicted') then
      raise exception 'WIKI_CURATE_INVALID_TRANSITION' using errcode = '22023';
    end if;
    update public.wiki_items
      set lifecycle_state = case
            when v_item.kind in ('action','question','risk') then 'open'
            else 'active'
          end,
          certainty = 'explicit',
          decision_state = case
            when v_item.kind = 'decision' then 'confirmed' else v_item.decision_state
          end,
          auto_update_locked = true,
          updated_at = now()
      where id = p_item_id;
  end if;

  select to_jsonb(w) into v_after from public.wiki_items w where w.id = p_item_id;

  insert into public.wiki_change_events (
    project_id, wiki_item_id, change_type, before_snapshot, after_snapshot, reason, actor_id
  ) values (
    v_item.project_id,
    p_item_id,
    'curate',
    v_before,
    v_after,
    case when v_reason = '' then p_action else p_action || ': ' || v_reason end,
    v_actor
  );

  update public.wiki_topics
    set last_changed_at = now(), updated_at = now()
    where id = v_item.topic_id;

  return query
    select w.id, w.lifecycle_state, w.decision_state, w.auto_update_locked
    from public.wiki_items w where w.id = p_item_id;
end $function$
;
drop policy attachment_insert_minute_files on public.minute_files;
create policy attachment_insert_minute_files on public.minute_files as permissive for insert to authenticated
  with check (((role = 'attachment'::text) AND (uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)))))));
drop policy attachment_update_minute_files on public.minute_files;
create policy attachment_update_minute_files on public.minute_files as permissive for update to authenticated
  using (((role = 'attachment'::text) AND (EXISTS ( SELECT 1
   FROM minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)))))))
  with check (((role = 'attachment'::text) AND (EXISTS ( SELECT 1
   FROM minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)))))));
drop policy attachment_delete_minute_files on public.minute_files;
create policy attachment_delete_minute_files on public.minute_files as permissive for delete to authenticated
  using (((role = 'attachment'::text) AND (EXISTS ( SELECT 1
   FROM minutes mi
  WHERE ((mi.id = minute_files.minute_id) AND (mi.archived_at IS NULL) AND ((mi.created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)))))));
drop policy insert_own_minute_folders on public.minute_folders;
create policy insert_own_minute_folders on public.minute_folders as permissive for insert to authenticated
  with check (((created_by = auth.uid()) AND (app_role() IS NOT NULL)));
drop policy update_own_minute_folders on public.minute_folders;
create policy update_own_minute_folders on public.minute_folders as permissive for update to authenticated
  using (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)))
  with check (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)));
drop policy delete_own_minute_folders on public.minute_folders;
create policy delete_own_minute_folders on public.minute_folders as permissive for delete to authenticated
  using (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)));
drop policy insert_own_minute_highlights on public.minute_highlights;
create policy insert_own_minute_highlights on public.minute_highlights as permissive for insert to authenticated
  with check (((created_by = auth.uid()) AND (app_role() IS NOT NULL)));
drop policy delete_own_minute_highlights on public.minute_highlights;
create policy delete_own_minute_highlights on public.minute_highlights as permissive for delete to authenticated
  using (((created_by = auth.uid()) OR (app_role() = 'pmo_admin'::text)));
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'minutes'::text) AND ((owner = auth.uid()) OR (app_role() = 'pmo_admin'::text)) AND (NOT (EXISTS ( SELECT 1
   FROM minute_versions mv
  WHERE (mv.file_path = objects.name))))));

-- ③ 좁힌 정책 6개 + 개방 읽기 39 복원 -------------------------------------------------------------------------------
drop policy read_notification_events on public.notification_events;
create policy read_notification_events on public.notification_events as permissive for select to authenticated
  using (((EXISTS ( SELECT 1
   FROM notification_recipients r
  WHERE ((r.event_id = notification_events.id) AND (r.user_id = auth.uid())))) OR ((audience = 'project'::text) AND is_project_member(project_id)) OR (audience = 'global'::text)));
drop policy own_minute_favorites on public.minute_favorites;
create policy own_minute_favorites on public.minute_favorites as permissive for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
drop policy insert_own_log on public.change_logs;
create policy insert_own_log on public.change_logs as permissive for insert to authenticated
  with check ((user_id = auth.uid()));
drop policy own_seen_announcements on public.announcement_seen;
create policy own_seen_announcements on public.announcement_seen as permissive for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
drop policy own_user_wbs_state on public.user_wbs_state;
create policy own_user_wbs_state on public.user_wbs_state as permissive for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
drop policy own_user_preferences on public.user_preferences;
create policy own_user_preferences on public.user_preferences as permissive for all to authenticated
  using ((user_id = auth.uid()))
  with check ((user_id = auth.uid()));
do $$
declare r record;
begin
  for r in select * from (values
    ('announcements','read_all_announcements'), ('attendance_records','read_all_attendance'),
    ('holidays','read_all_holidays'), ('issue_assignees','read_all_issue_assignees'),
    ('issue_attachments','read_issue_attachments'), ('issue_links','read_all_issue_links'),
    ('issue_major_processes','read_all_issue_major_processes'), ('issue_updates','read_issue_updates'),
    ('issues','read_all_issues'), ('meeting_attendees','read_all_meeting_attendees'),
    ('meetings','read_all_meetings'), ('project_ai_briefs','project_ai_briefs_read'),
    ('project_members','read_all_members'), ('project_settings','read_project_settings'),
    ('task_dependencies','task_dependencies_select'), ('wbs_embeddings','wbs_embeddings_read'),
    ('wbs_items','read_all_items'), ('wbs_progress_snapshots','read_all_progress_snapshots'),
    ('weekly_reports','weekly_reports_select'), ('wiki_change_events','wiki_change_events_read'),
    ('wiki_items','wiki_items_read'), ('wiki_topics','wiki_topics_read'),
    ('ai_documents','ai_documents_read'), ('projects','read_all_projects'),
    ('teams','read_all_teams'), ('minutes','read_all_minutes'),
    ('minute_folders','read_all_minute_folders'), ('minute_versions','minute_versions_read'),
    ('minute_embeddings','minute_embeddings_read'), ('minute_files','read_all_minute_files'),
    ('minute_highlights','read_all_minute_highlights'), ('minute_insights','minute_insights_read'),
    ('change_logs','read_all_logs'), ('deliverable_attachments','read_all_attachments'),
    ('item_owners','read_all_owners'), ('meeting_exceptions','read_all_meeting_exceptions'),
    ('weekly_report_rows','weekly_report_rows_select'), ('wiki_item_relations','wiki_item_relations_read'),
    ('wiki_item_sources','wiki_item_sources_read')
  ) as v(tbl, old_pol)
  loop
    execute format('drop policy %I on public.%I', r.tbl || '_ws_read', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (true)', r.old_pol, r.tbl);
  end loop;
end $$;

-- ② 헬퍼 3개 원본(M3 이전 — 비활성 인물 검사 없음) + member_update_actual 원본(item_owners 를 직접 읽는다) → 순환 끊기 헬퍼 제거 ----
drop policy member_update_actual on public.wbs_items;
create policy member_update_actual on public.wbs_items as permissive for update to authenticated
  using ((is_project_member(project_id) AND wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND (o.team_id IN ( SELECT my_team_ids(wbs_items.project_id) AS my_team_ids)))))))
  with check ((is_project_member(project_id) AND wbs_is_leaf(id) AND (EXISTS ( SELECT 1
   FROM item_owners o
  WHERE ((o.wbs_item_id = wbs_items.id) AND (o.team_id IN ( SELECT my_team_ids(wbs_items.project_id) AS my_team_ids)))))));
drop function public.item_owned_by_my_team(uuid, uuid);
CREATE OR REPLACE FUNCTION public.my_member_id(pid uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pm.id from public.project_members pm
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pe.user_id = auth.uid() and pm.active
   limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.my_team_ids(pid uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select pmt.team_id from public.project_member_teams pmt
    join public.project_members pm on pm.id = pmt.member_id
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pm.active and pe.user_id = auth.uid()
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_admin_anywhere_in_ws(wid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.is_ws_admin(wid)
      or exists (select 1 from public.project_members pm
                   join public.people pe on pe.id = pm.person_id
                   join public.projects p on p.id = pm.project_id
                  where p.workspace_id = wid and pe.user_id = auth.uid()
                    and pm.active and pm.access_role = 'admin')
$function$
;

-- ① workspace_id 다섯 컬럼 제거 -----------------------------------------------------------------------------------
drop trigger minutes_workspace_scope on public.minutes;
drop trigger notification_events_workspace_scope on public.notification_events;
drop trigger agent_watchers_workspace_scope on public.agent_watchers;
drop trigger minute_folders_workspace_scope on public.minute_folders;
drop function public.workspace_scope_from_project();
drop function public.minute_folders_workspace_scope();
drop index public.minute_folders_root_name_null_proj_uniq;
create unique index minute_folders_root_name_null_proj_uniq on public.minute_folders (name)
  where parent_id is null and project_id is null;
alter table public.user_preferences drop constraint user_preferences_pkey,
  add constraint user_preferences_pkey primary key (user_id);
drop index public.minutes_workspace_idx;
drop index public.minute_folders_workspace_idx;
drop index public.notification_events_workspace_idx;
drop index public.agent_watchers_workspace_idx;
alter table public.minutes             drop constraint minutes_workspace_id_fkey,             drop column workspace_id;
alter table public.minute_folders      drop constraint minute_folders_workspace_id_fkey,      drop column workspace_id;
alter table public.notification_events drop constraint notification_events_workspace_id_fkey, drop column workspace_id;
alter table public.user_preferences    drop constraint user_preferences_workspace_id_fkey,    drop column workspace_id;
alter table public.agent_watchers      drop constraint agent_watchers_workspace_id_fkey,      drop column workspace_id;

commit;
