-- 0006_workspace_isolation — SP2 Phase A. 정본: docs/superpowers/specs/2026-09-26-sp2-workspace-isolation-design.md §2.
-- 순서: ⓪ 사전검증 ① workspace_id 컬럼·백필·not null·FK·인덱스·트리거 ② 헬퍼 보완(M3)·정책 순환 끊기 ③ 개방 읽기 39 교체 + 좁히기
--       ④ app_role 정책 9 → 명시 헬퍼, curate_wiki_item 주석, app_role drop ⑤ 명단 보호(M1·M2) ⑥ 회의록 생성 RPC
--       ⑦ 실행·쓰기 권한 회수 ⑧ 사후검증. 정책이 새 컬럼을 읽으므로 ① 이 ③④ 보다 먼저다.
-- 롤백: supabase/rollbacks/0006_workspace_isolation_rollback.sql. 리허설: supabase/rehearsal/0006_*.sql.

-- ⓪ 사전검증 — 교체할 옛 개방 읽기 정책 40개(D2 예외 issue_mega_areas 포함)가 전부 그 이름·그 본문으로 있어야 한다 ----
do $$
declare v_missing text;
begin
  select string_agg(e.t || '.' || e.p, ', ' order by e.t) into v_missing
    from (values
      ('ai_documents','ai_documents_read'), ('announcements','read_all_announcements'),
      ('attendance_records','read_all_attendance'), ('change_logs','read_all_logs'),
      ('deliverable_attachments','read_all_attachments'), ('holidays','read_all_holidays'),
      ('issue_assignees','read_all_issue_assignees'), ('issue_attachments','read_issue_attachments'),
      ('issue_links','read_all_issue_links'), ('issue_major_processes','read_all_issue_major_processes'),
      ('issue_mega_areas','read_all_issue_mega_areas'), ('issue_updates','read_issue_updates'),
      ('issues','read_all_issues'), ('item_owners','read_all_owners'),
      ('meeting_attendees','read_all_meeting_attendees'), ('meeting_exceptions','read_all_meeting_exceptions'),
      ('meetings','read_all_meetings'), ('minute_embeddings','minute_embeddings_read'),
      ('minute_files','read_all_minute_files'), ('minute_folders','read_all_minute_folders'),
      ('minute_highlights','read_all_minute_highlights'), ('minute_insights','minute_insights_read'),
      ('minute_versions','minute_versions_read'), ('minutes','read_all_minutes'),
      ('project_ai_briefs','project_ai_briefs_read'), ('project_members','read_all_members'),
      ('project_settings','read_project_settings'), ('projects','read_all_projects'),
      ('task_dependencies','task_dependencies_select'), ('teams','read_all_teams'),
      ('wbs_embeddings','wbs_embeddings_read'), ('wbs_items','read_all_items'),
      ('wbs_progress_snapshots','read_all_progress_snapshots'), ('weekly_report_rows','weekly_report_rows_select'),
      ('weekly_reports','weekly_reports_select'), ('wiki_change_events','wiki_change_events_read'),
      ('wiki_item_relations','wiki_item_relations_read'), ('wiki_item_sources','wiki_item_sources_read'),
      ('wiki_items','wiki_items_read'), ('wiki_topics','wiki_topics_read')
    ) as e(t, p)
   where not exists (select 1 from pg_policies pp
                      where pp.schemaname = 'public' and pp.tablename = e.t and pp.policyname = e.p
                        and pp.cmd = 'SELECT' and pp.qual = 'true');
  if v_missing is not null then
    raise exception 'SP2_0006_PRECHECK: 교체할 개방 읽기 정책이 없거나 달라졌다: %', v_missing;
  end if;
end $$;

-- ① workspace_id 다섯 컬럼(D3·D4) ----------------------------------------------------------------------------
alter table public.minutes             add column workspace_id uuid;
alter table public.minute_folders      add column workspace_id uuid;
alter table public.notification_events add column workspace_id uuid;
alter table public.user_preferences    add column workspace_id uuid;
alter table public.agent_watchers      add column workspace_id uuid;

update public.minutes m             set workspace_id = p.workspace_id from public.projects p where p.id = m.project_id;
update public.minute_folders f      set workspace_id = p.workspace_id from public.projects p where p.id = f.project_id;
update public.notification_events e set workspace_id = p.workspace_id from public.projects p where p.id = e.project_id;
update public.agent_watchers w      set workspace_id = p.workspace_id from public.projects p where p.id = w.project_id;

-- 프로젝트 없는 행(D3): 작성자가 속한 유일한 워크스페이스. 0개·2개 이상이면 전체 워크스페이스가 정확히 1개일 때 그것,
-- 아니면 멈춘다 — 추정으로 잘못 배정하느니 실패한다(에러 3원칙). 폴더 자식은 부모를 따른다(트리 불변식).
-- user_preferences 는 보안 경계가 아니므로 여러 소속이면 가장 먼저 가입한 것.
do $$
declare
  v_total int := (select count(*) from public.workspaces);
  v_only  uuid := (select w.id from public.workspaces w order by w.id limit 1);
  r record; v_ws uuid; v_n int;
begin
  for r in
    select 'minutes'::text as tbl, m.id, m.created_by as owner from public.minutes m where m.workspace_id is null
    union all
    select 'minute_folders', f.id, f.created_by from public.minute_folders f where f.workspace_id is null and f.parent_id is null
    union all
    select 'notification_events', e.id, e.actor_user_id from public.notification_events e where e.workspace_id is null
    union all
    select 'agent_watchers', w.id, w.user_id from public.agent_watchers w where w.workspace_id is null
  loop
    select count(*), min(wm.workspace_id::text)::uuid into v_n, v_ws from public.workspace_members wm where wm.user_id = r.owner;
    if v_n <> 1 then
      if v_total = 1 then v_ws := v_only;
      else
        raise exception 'SP2_0006_BACKFILL_AMBIGUOUS: %.% (작성자 %, 소속 %개, 전체 워크스페이스 %개)', r.tbl, r.id, r.owner, v_n, v_total;
      end if;
    end if;
    execute format('update public.%I set workspace_id = $1 where id = $2', r.tbl) using v_ws, r.id;
  end loop;

  loop
    update public.minute_folders c set workspace_id = p.workspace_id
      from public.minute_folders p
     where c.parent_id = p.id and c.workspace_id is null and p.workspace_id is not null;
    exit when not found;
  end loop;

  update public.user_preferences up set workspace_id = (
    select wm.workspace_id from public.workspace_members wm where wm.user_id = up.user_id
     order by wm.created_at, wm.workspace_id limit 1);
  if exists (select 1 from public.user_preferences where workspace_id is null) then
    if v_total = 1 then update public.user_preferences set workspace_id = v_only where workspace_id is null;
    else raise exception 'SP2_0006_BACKFILL_AMBIGUOUS: user_preferences — 소속 없는 사용자의 선호값(전체 워크스페이스 %개)', v_total;
    end if;
  end if;
end $$;

alter table public.minutes             alter column workspace_id set not null,
  add constraint minutes_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.minute_folders      alter column workspace_id set not null,
  add constraint minute_folders_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.notification_events alter column workspace_id set not null,
  add constraint notification_events_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.user_preferences    alter column workspace_id set not null,
  add constraint user_preferences_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
alter table public.agent_watchers      alter column workspace_id set not null,
  add constraint agent_watchers_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete cascade;
create index minutes_workspace_idx             on public.minutes (workspace_id);
create index minute_folders_workspace_idx      on public.minute_folders (workspace_id);
create index notification_events_workspace_idx on public.notification_events (workspace_id);
create index agent_watchers_workspace_idx      on public.agent_watchers (workspace_id);
alter table public.user_preferences drop constraint user_preferences_pkey,
  add constraint user_preferences_pkey primary key (user_id, workspace_id);
-- 프로젝트 없는 루트 폴더 이름은 워크스페이스마다 유일(전역 유일이면 두 번째 워크스페이스가 같은 팀 루트를 못 만든다)
drop index public.minute_folders_root_name_null_proj_uniq;
create unique index minute_folders_root_name_null_proj_uniq on public.minute_folders (workspace_id, name)
  where parent_id is null and project_id is null;

-- project_id 가 있는 행은 workspace_id = 그 프로젝트의 워크스페이스. 비어 있으면 채우고, 다르면 거부한다(SP1 projects_guard 결).
create function public.workspace_scope_from_project() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  if new.project_id is null then return new; end if;
  select p.workspace_id into v_ws from public.projects p where p.id = new.project_id;
  if not found then return new; end if;   -- 없는 프로젝트는 FK 가 23503 으로 거부한다
  if new.workspace_id is null then
    new.workspace_id := v_ws;
  elsif new.workspace_id <> v_ws then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;
create function public.minute_folders_workspace_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ws uuid;
begin
  if new.project_id is not null then
    select p.workspace_id into v_ws from public.projects p where p.id = new.project_id;
  elsif new.parent_id is not null then
    select f.workspace_id into v_ws from public.minute_folders f where f.id = new.parent_id;
  end if;
  if v_ws is null then return new; end if;
  if new.workspace_id is null then
    new.workspace_id := v_ws;
  elsif new.workspace_id <> v_ws then
    raise exception using errcode = '23514', message = 'WORKSPACE_SCOPE_MISMATCH';
  end if;
  return new;
end $$;
revoke all on function public.workspace_scope_from_project() from public, anon, authenticated;
revoke all on function public.minute_folders_workspace_scope() from public, anon, authenticated;
create trigger minutes_workspace_scope before insert or update of project_id, workspace_id on public.minutes
  for each row execute function public.workspace_scope_from_project();
create trigger notification_events_workspace_scope before insert or update of project_id, workspace_id on public.notification_events
  for each row execute function public.workspace_scope_from_project();
create trigger agent_watchers_workspace_scope before insert or update of project_id, workspace_id on public.agent_watchers
  for each row execute function public.workspace_scope_from_project();
create trigger minute_folders_workspace_scope before insert or update of project_id, parent_id, workspace_id on public.minute_folders
  for each row execute function public.minute_folders_workspace_scope();

-- ② 헬퍼 보완(M3) — 비활성 인물(pe.active=false)의 명단 행이 권한·팀으로 새지 않게 ---------------------------
create or replace function public.my_member_id(pid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select pm.id from public.project_members pm
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pe.user_id = auth.uid() and pm.active and pe.active
   limit 1
$$;
create or replace function public.my_team_ids(pid uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select pmt.team_id from public.project_member_teams pmt
    join public.project_members pm on pm.id = pmt.member_id
    join public.people pe on pe.id = pm.person_id
   where pm.project_id = pid and pm.active and pe.active and pe.user_id = auth.uid()
$$;
create or replace function public.is_project_admin_anywhere_in_ws(wid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_ws_admin(wid)
      or exists (select 1 from public.project_members pm
                   join public.people pe on pe.id = pm.person_id
                   join public.projects p on p.id = pm.project_id
                  where p.workspace_id = wid and pe.user_id = auth.uid()
                    and pm.active and pe.active and pm.access_role = 'admin')
$$;
-- wbs_items ↔ item_owners 정책 순환 끊기. SP1 의 member_update_actual(wbs_items, UPDATE)이 item_owners 를 RLS 아래에서 읽고,
-- item_owners 의 admin_write_owners(FOR ALL — SELECT 에도 붙는다)는 다시 wbs_items 를 읽는다. 0005 까지는 wbs_items 읽기 정책이
-- true(서브쿼리 없음)라 재진입해도 넘어갔지만, ③ 의 wbs_items_ws_read 는 (select …) 서브쿼리를 가지므로 재진입이
-- 42P17(infinite recursion detected in policy for relation "wbs_items")이 된다. 팀 소유 검사를 SECURITY DEFINER 로 옮겨
-- wbs_items → item_owners 간선을 없앤다(판정은 같다 — 그 항목의 담당 팀이 그 프로젝트에서 내 팀인가).
create function public.item_owned_by_my_team(p_item uuid, p_project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.item_owners o
                  where o.wbs_item_id = p_item and o.team_id in (select public.my_team_ids(p_project)))
$$;
drop policy member_update_actual on public.wbs_items;
create policy member_update_actual on public.wbs_items for update to authenticated
  using (public.is_project_member(project_id) and public.wbs_is_leaf(id) and public.item_owned_by_my_team(id, project_id))
  with check (public.is_project_member(project_id) and public.wbs_is_leaf(id) and public.item_owned_by_my_team(id, project_id));

-- ③ 개방 읽기 39 교체(§2.1) — 표 주도. (select …) 로 감싸 initplan 1회 평가(R1). 부모 조인은 부모의 스코프 컬럼만 본다(R2).
do $$
declare r record;
begin
  for r in select * from (values
    ('announcements','read_all_announcements',                'project_id in (select public.accessible_project_ids())'),
    ('attendance_records','read_all_attendance',              'project_id in (select public.accessible_project_ids())'),
    ('holidays','read_all_holidays',                          'project_id in (select public.accessible_project_ids())'),
    ('issue_assignees','read_all_issue_assignees',            'project_id in (select public.accessible_project_ids())'),
    ('issue_attachments','read_issue_attachments',            'project_id in (select public.accessible_project_ids())'),
    ('issue_links','read_all_issue_links',                    'project_id in (select public.accessible_project_ids())'),
    ('issue_major_processes','read_all_issue_major_processes','project_id in (select public.accessible_project_ids())'),
    ('issue_updates','read_issue_updates',                    'project_id in (select public.accessible_project_ids())'),
    ('issues','read_all_issues',                              'project_id in (select public.accessible_project_ids())'),
    ('meeting_attendees','read_all_meeting_attendees',        'project_id in (select public.accessible_project_ids())'),
    ('meetings','read_all_meetings',                          'project_id in (select public.accessible_project_ids())'),
    ('project_ai_briefs','project_ai_briefs_read',            'project_id in (select public.accessible_project_ids())'),
    ('project_members','read_all_members',                    'project_id in (select public.accessible_project_ids())'),
    ('project_settings','read_project_settings',              'project_id in (select public.accessible_project_ids())'),
    ('task_dependencies','task_dependencies_select',          'project_id in (select public.accessible_project_ids())'),
    ('wbs_embeddings','wbs_embeddings_read',                  'project_id in (select public.accessible_project_ids())'),
    ('wbs_items','read_all_items',                            'project_id in (select public.accessible_project_ids())'),
    ('wbs_progress_snapshots','read_all_progress_snapshots',  'project_id in (select public.accessible_project_ids())'),
    ('weekly_reports','weekly_reports_select',                'project_id in (select public.accessible_project_ids())'),
    ('wiki_change_events','wiki_change_events_read',          'project_id in (select public.accessible_project_ids())'),
    ('wiki_items','wiki_items_read',                          'project_id in (select public.accessible_project_ids())'),
    ('wiki_topics','wiki_topics_read',                        'project_id in (select public.accessible_project_ids())'),
    ('ai_documents','ai_documents_read',                      'project_id in (select public.accessible_project_ids())'),
    ('projects','read_all_projects',                          'workspace_id in (select public.my_workspace_ids())'),
    ('teams','read_all_teams',                                'workspace_id in (select public.my_workspace_ids())'),
    ('minutes','read_all_minutes',                            'workspace_id in (select public.my_workspace_ids())'),
    ('minute_folders','read_all_minute_folders',              'workspace_id in (select public.my_workspace_ids())'),
    ('minute_versions','minute_versions_read',
      'exists (select 1 from public.minutes m where m.id = minute_versions.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_embeddings','minute_embeddings_read',
      'exists (select 1 from public.minutes m where m.id = minute_embeddings.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_files','read_all_minute_files',
      'exists (select 1 from public.minutes m where m.id = minute_files.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_highlights','read_all_minute_highlights',
      'exists (select 1 from public.minutes m where m.id = minute_highlights.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('minute_insights','minute_insights_read',
      'exists (select 1 from public.minutes m where m.id = minute_insights.minute_id and m.workspace_id in (select public.my_workspace_ids()))'),
    ('change_logs','read_all_logs',
      'exists (select 1 from public.wbs_items w where w.id = change_logs.wbs_item_id and w.project_id in (select public.accessible_project_ids()))'),
    ('deliverable_attachments','read_all_attachments',
      'exists (select 1 from public.wbs_items w where w.id = deliverable_attachments.wbs_item_id and w.project_id in (select public.accessible_project_ids()))'),
    ('item_owners','read_all_owners',
      'exists (select 1 from public.wbs_items w where w.id = item_owners.wbs_item_id and w.project_id in (select public.accessible_project_ids()))'),
    ('meeting_exceptions','read_all_meeting_exceptions',
      'exists (select 1 from public.meetings m where m.id = meeting_exceptions.meeting_id and m.project_id in (select public.accessible_project_ids()))'),
    ('weekly_report_rows','weekly_report_rows_select',
      'exists (select 1 from public.weekly_reports r where r.id = weekly_report_rows.report_id and r.project_id in (select public.accessible_project_ids()))'),
    ('wiki_item_relations','wiki_item_relations_read',
      'exists (select 1 from public.wiki_items i where i.id = wiki_item_relations.from_item_id and i.project_id in (select public.accessible_project_ids()))'),
    ('wiki_item_sources','wiki_item_sources_read',
      'exists (select 1 from public.wiki_items i where i.id = wiki_item_sources.wiki_item_id and i.project_id in (select public.accessible_project_ids()))')
  ) as v(tbl, old_pol, pred)
  loop
    execute format('drop policy %I on public.%I', r.old_pol, r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', r.tbl || '_ws_read', r.tbl, r.pred);
  end loop;
end $$;

-- true 는 아니지만 좁혀지지 않은 것(§2.1 하단 + 자기 이름 쓰기)
drop policy read_notification_events on public.notification_events;
create policy read_notification_events on public.notification_events for select to authenticated using (
  workspace_id in (select public.my_workspace_ids())
  and (exists (select 1 from public.notification_recipients r where r.event_id = notification_events.id and r.user_id = auth.uid())
       or (audience = 'project' and public.is_project_member(project_id))));
drop policy own_minute_favorites on public.minute_favorites;
create policy own_minute_favorites on public.minute_favorites for all to authenticated
  using (user_id = auth.uid() and exists (select 1 from public.minutes m where m.id = minute_favorites.minute_id
                                            and m.workspace_id in (select public.my_workspace_ids())))
  with check (user_id = auth.uid() and exists (select 1 from public.minutes m where m.id = minute_favorites.minute_id
                                                 and m.workspace_id in (select public.my_workspace_ids())));
drop policy insert_own_log on public.change_logs;
create policy insert_own_log on public.change_logs for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.wbs_items w where w.id = change_logs.wbs_item_id
                                                 and public.can_read_project(w.project_id)));
drop policy own_seen_announcements on public.announcement_seen;
create policy own_seen_announcements on public.announcement_seen for all to authenticated
  using (user_id = auth.uid() and project_id in (select public.accessible_project_ids()))
  with check (user_id = auth.uid() and project_id in (select public.accessible_project_ids()));
drop policy own_user_wbs_state on public.user_wbs_state;
create policy own_user_wbs_state on public.user_wbs_state for all to authenticated
  using (user_id = auth.uid() and project_id in (select public.accessible_project_ids()))
  with check (user_id = auth.uid() and project_id in (select public.accessible_project_ids()));
drop policy own_user_preferences on public.user_preferences;
create policy own_user_preferences on public.user_preferences for all to authenticated
  using (user_id = auth.uid() and public.is_ws_member(workspace_id))
  with check (user_id = auth.uid() and public.is_ws_member(workspace_id));

-- ④ app_role() 폐기(§2.2) --------------------------------------------------------------------------------------
-- minute_files 3 — 작성자 ∨ 그 워크스페이스 관리자 ∨ 그 프로젝트 관리자. minutes 조회는 minutes RLS(워크스페이스)를 탄다.
drop policy attachment_insert_minute_files on public.minute_files;
create policy attachment_insert_minute_files on public.minute_files for insert to authenticated
  with check (role = 'attachment' and uploaded_by = auth.uid() and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop policy attachment_update_minute_files on public.minute_files;
create policy attachment_update_minute_files on public.minute_files for update to authenticated
  using (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))))
  with check (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
drop policy attachment_delete_minute_files on public.minute_files;
create policy attachment_delete_minute_files on public.minute_files for delete to authenticated
  using (role = 'attachment' and exists (
    select 1 from public.minutes mi where mi.id = minute_files.minute_id and mi.archived_at is null
       and (mi.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id)
            or (mi.project_id is not null and public.is_project_admin(mi.project_id)))));
-- minute_folders 3 — 옛 'app_role() is not null'(어느 프로젝트든 역할) → 그 워크스페이스에 역할(명단 권한 또는 워크스페이스 관리자)
drop policy insert_own_minute_folders on public.minute_folders;
create policy insert_own_minute_folders on public.minute_folders for insert to authenticated
  with check (created_by = auth.uid() and (public.is_ws_admin(workspace_id)
    or exists (select 1 from public.projects p where p.workspace_id = minute_folders.workspace_id and public.is_project_member(p.id))));
drop policy update_own_minute_folders on public.minute_folders;
create policy update_own_minute_folders on public.minute_folders for update to authenticated
  using (public.is_ws_member(workspace_id) and (created_by = auth.uid() or public.is_ws_admin(workspace_id)))
  with check (public.is_ws_member(workspace_id) and (created_by = auth.uid() or public.is_ws_admin(workspace_id)));
drop policy delete_own_minute_folders on public.minute_folders;
create policy delete_own_minute_folders on public.minute_folders for delete to authenticated
  using (public.is_ws_member(workspace_id) and (created_by = auth.uid() or public.is_ws_admin(workspace_id)));
-- minute_highlights 2
drop policy insert_own_minute_highlights on public.minute_highlights;
create policy insert_own_minute_highlights on public.minute_highlights for insert to authenticated
  with check (created_by = auth.uid() and exists (
    select 1 from public.minutes mi where mi.id = minute_highlights.minute_id
       and (public.is_ws_admin(mi.workspace_id)
            or exists (select 1 from public.projects p where p.workspace_id = mi.workspace_id and public.is_project_member(p.id)))));
drop policy delete_own_minute_highlights on public.minute_highlights;
create policy delete_own_minute_highlights on public.minute_highlights for delete to authenticated
  using (exists (select 1 from public.minutes mi where mi.id = minute_highlights.minute_id
                   and (minute_highlights.created_by = auth.uid() or public.is_ws_admin(mi.workspace_id))));
-- storage minutes delete 1 — 경로 규약은 B1(0007)에서 바뀐다. 여기서는 app_role() 만 동형 술어로(첫 세그먼트 = 회의록 id, 텍스트 비교라 22P02 없음)
drop policy "minutes bucket delete" on storage.objects;
create policy "minutes bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'minutes'
    and (owner = auth.uid() or exists (select 1 from public.minutes mi
          where mi.id::text = split_part(objects.name, '/', 1) and public.is_ws_admin(mi.workspace_id)))
    and not exists (select 1 from public.minute_versions mv where mv.file_path = objects.name));

-- curate_wiki_item — 판정은 이미 is_project_admin(대상 항목의 프로젝트)다. 본문의 app_role( 은 주석 한 줄뿐이라 그 줄만 바꾼다
-- (⑧ 사후검증이 prosrc 의 app_role( 를 찾는다). 나머지 본문·SECURITY DEFINER·search_path 는 0005 그대로.
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

  -- 권한 판정은 **대상 항목의 프로젝트** 기준이다(0053). 옛 검사(전역 역할 함수의 not null 판정)는
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

drop function public.app_role();   -- 남은 정책이 있으면 의존성 오류로 여기서 멈춘다

-- ⑤ 명단 보호(M1·M2) ---------------------------------------------------------------------------------------------
-- 앱 removeRosterMember 의 MEMBER_DEPENDANTS 6개와 같은 FK — CASCADE·SET NULL → NO ACTION(R4 분기 A).
alter table public.attendance_records drop constraint attendance_member_project_fk,
  add constraint attendance_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id);
alter table public.issue_assignees drop constraint issue_assignees_member_project_fk,
  add constraint issue_assignees_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id);
alter table public.meeting_attendees drop constraint meeting_attendees_member_project_fk,
  add constraint meeting_attendees_member_project_fk foreign key (member_id, project_id) references public.project_members(id, project_id);
alter table public.issues drop constraint issues_assignee_project_fk,
  add constraint issues_assignee_project_fk foreign key (assignee_member_id, project_id) references public.project_members(id, project_id);
alter table public.wbs_items drop constraint wbs_items_assignee_member_fk,
  add constraint wbs_items_assignee_member_fk foreign key (assignee_member_id, project_id) references public.project_members(id, project_id);
alter table public.wiki_items drop constraint wiki_items_owner_project_fk,
  add constraint wiki_items_owner_project_fk foreign key (owner_member_id, project_id) references public.project_members(id, project_id);
-- project_member_teams(팀 소속)·notification_recipients(알림 수신)는 명단 행과 함께 사라지는 게 맞다 — CASCADE 유지.

-- 세션은 명단 행의 인물·프로젝트를 바꾸지 못한다(사람 바꿔치기·프로젝트 이동 차단)
revoke update on public.project_members from authenticated;
grant update (access_role, role_label, title, active, sort_order, access_granted_by, access_granted_at, updated_at)
  on public.project_members to authenticated;
-- R3 분기 A 의 전제: 정책이 project_ws() 를 직접 부르지 않게 한다(유일한 직접 호출 정책)
drop policy wsadmin_write_admin_rows on public.project_members;
create policy wsadmin_write_admin_rows on public.project_members to authenticated
  using (exists (select 1 from public.projects p where p.id = project_members.project_id and public.is_ws_admin(p.workspace_id)))
  with check (exists (select 1 from public.projects p where p.id = project_members.project_id and public.is_ws_admin(p.workspace_id)));
-- M2: 관리자 명단 행의 팀 편집은 워크스페이스 관리자만(RPC 의 ADMIN_SLOT 과 동형)
drop policy project_member_teams_write on public.project_member_teams;
create policy project_member_teams_write on public.project_member_teams to authenticated
  using (exists (select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
                  where pm.id = project_member_teams.member_id and public.is_project_admin(pm.project_id)
                    and (pm.access_role is distinct from 'admin' or public.is_ws_admin(p.workspace_id))))
  with check (exists (select 1 from public.project_members pm join public.projects p on p.id = pm.project_id
                       where pm.id = project_member_teams.member_id and public.is_project_admin(pm.project_id)
                         and (pm.access_role is distinct from 'admin' or public.is_ws_admin(p.workspace_id))));

-- ⑥ 회의록 생성 RPC — 워크스페이스를 확정한 뒤 폴더·팀을 그 워크스페이스 안에서만 받는다. 프로젝트 없는 회의록은
--    p_workspace_id 가 필수다(workspace_id 로만 스코프되므로). 나머지 본문(파일 검사·advisory lock·위키 재구성 요청)은 0005 그대로.
drop function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text);
create function public.create_minute_with_version(
  p_minute_id uuid, p_minute_date date, p_team_code text, p_title text, p_body_md text, p_body_hash text,
  p_meeting_id uuid, p_project_id uuid, p_meeting_occurrence_date date, p_folder_id uuid, p_external_id text,
  p_actor_id uuid, p_actor_name text, p_file_name text default null, p_file_path text default null,
  p_file_size bigint default null, p_file_mime text default null, p_workspace_id uuid default null)
returns table(minute_id uuid, version_id uuid, version_no integer, body_hash text, created_at timestamptz, updated_at timestamptz, wiki_rebuild_required boolean)
language plpgsql set search_path to 'public', 'extensions' as $function$
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
  v_workspace_id uuid;
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
    select p.workspace_id into v_workspace_id from public.projects p where p.id = v_project_id;
    if not found then
      raise exception 'MINUTE_PROJECT_NOT_FOUND' using errcode = '23503';
    end if;
    if p_workspace_id is not null and p_workspace_id <> v_workspace_id then
      raise exception 'MINUTE_WORKSPACE_MISMATCH' using errcode = '23514';
    end if;
  else
    v_workspace_id := p_workspace_id;
    if v_workspace_id is null then
      raise exception 'MINUTE_WORKSPACE_REQUIRED' using errcode = '22023';
    end if;
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.minute_folders f where f.id = p_folder_id and f.workspace_id = v_workspace_id) then
    raise exception 'MINUTE_FOLDER_WORKSPACE_MISMATCH' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.code = p_team_code and t.active and t.workspace_id = v_workspace_id
  ) then
    raise exception 'MINUTE_TEAM_INVALID' using errcode = '23503';
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
    created_by, created_by_name, created_at, updated_at, workspace_id
  ) values (
    v_minute_id, p_minute_date, p_team_code, btrim(p_title), p_body_md,
    p_meeting_id, v_project_id, v_occurrence_date, p_folder_id, p_external_id,
    p_actor_id, p_actor_name, v_created_at, v_created_at, v_workspace_id
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
$function$;
revoke all on function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.create_minute_with_version(uuid, date, text, text, text, text, uuid, uuid, date, uuid, text, uuid, text, text, text, bigint, text, uuid) to service_role;

-- ⑦ 실행·쓰기 권한 회수(security-5) -------------------------------------------------------------------------------
revoke execute on function public.is_superuser(), public.my_workspace_ids(), public.is_ws_member(uuid), public.is_ws_admin(uuid),
  public.project_ws(uuid), public.accessible_project_ids(), public.can_read_project(uuid), public.is_project_admin(uuid),
  public.is_project_member(uuid), public.is_project_admin_anywhere_in_ws(uuid), public.my_member_id(uuid),
  public.my_team_ids(uuid), public.can_attach(uuid), public.can_edit_issue(uuid), public.wbs_is_leaf(uuid),
  public.item_owned_by_my_team(uuid, uuid) from public, anon;
-- R3 분기 A: project_ws 는 정책·SECURITY DEFINER 헬퍼 안에서만 쓴다(PostgREST rpc/project_ws 오라클 제거)
revoke execute on function public.project_ws(uuid) from authenticated;
revoke execute on function public.import_wbs(uuid, jsonb, jsonb), public.import_wbs_upsert(uuid, jsonb, uuid),
  public.replace_wbs(uuid, jsonb, jsonb),
  public.match_minute_documents(vector, integer, text, date, date, uuid[]), public.match_wbs_documents(vector, integer, uuid, text[]),
  public.usage_daily_actives(date, date), public.usage_menu_ranking(date, date), public.usage_sessions(date, date, integer),
  public.usage_summary(date, date, date), public.usage_user_rollup(date, date), public.lead_lease_ttl() from public, anon;
revoke insert, update, delete, truncate on all tables in schema public from anon;
alter default privileges for role postgres in schema public revoke insert, update, delete, truncate on tables from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ⑧ 사후검증 ------------------------------------------------------------------------------------------------------
do $$
declare v text;
begin
  select string_agg(p.proname, ', ') into v from pg_proc p where p.prosrc ilike '%app_role(%';
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 함수 본문에 app_role( 가 남았다: %', v; end if;
  select string_agg(pp.schemaname || '.' || pp.tablename || '.' || pp.policyname, ', ') into v
    from pg_policies pp where coalesce(pp.qual, '') || coalesce(pp.with_check, '') ilike '%app_role%';
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 정책에 app_role 이 남았다: %', v; end if;
  select string_agg(pp.tablename || '.' || pp.policyname, ', ') into v
    from pg_policies pp where pp.schemaname = 'public' and pp.cmd in ('SELECT', 'ALL') and pp.qual = 'true'
     and pp.tablename <> 'issue_mega_areas';
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 개방 읽기 정책이 남았다: %', v; end if;
  select string_agg(c.relname, ', ') into v from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
     and exists (select 1 from aclexplode(c.relacl) a where a.grantee = 'anon'::regrole
                  and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'));
  if v is not null then raise exception 'SP2_0006_POSTCHECK: anon 쓰기 권한이 남았다: %', v; end if;
  -- 정책이 서로의 표를 RLS 아래에서 읽는 순환(42P17 은 그 경로의 쿼리가 돌 때에야 난다 — 여기서 미리 잡는다)
  with recursive e as (
    select distinct pol.polrelid as src, d.refobjid as dst
      from pg_policy pol join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid
     where d.refclassid = 'pg_class'::regclass and d.refobjid <> pol.polrelid
  ), walk(start, cur, path) as (
    select src, dst, array[src, dst] from e
    union all
    select w.start, e.dst, w.path || e.dst from walk w join e on e.src = w.cur
     where not (e.dst = any(w.path[2:])) and cardinality(w.path) < 12
  )
  select string_agg(distinct w.start::regclass::text, ', ') into v from walk w where w.cur = w.start;
  if v is not null then raise exception 'SP2_0006_POSTCHECK: 정책 참조 순환: %', v; end if;
end $$;
