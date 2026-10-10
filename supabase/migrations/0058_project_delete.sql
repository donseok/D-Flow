-- 0058_project_delete.sql
-- 프로젝트 삭제 — 지금까지 프로젝트는 만들 수만 있었다(사용자 테스트 BUG-18).
-- 왜:
--   · projects 행 하나를 지우는 것으로는 끝나지 않는다. projects 를 캐스케이드로 따라가는 표 57개 안에 서로를 CASCADE 가 아닌 것으로 붙든
--     참조가 21개 있고(RESTRICT 3·NO ACTION 11·SET NULL 7), 그 순서를 잘못 밟으면 FK 가 막거나(area_teams → teams) SET NULL 이 딸린 행의
--     갱신 가드를 건드린다. 지우는 순서를 한 함수가 정하고, 그 함수가 모르는 참조·삭제 트리거가 생기면 조용히 막히지 않고 고정 토큰으로 드러나게 한다.
--   · 되돌릴 수 없는 조작이라 등급 재판정·이름 대조·잠금·삭제·기록을 한 트랜잭션에 넣는다(RPC 한 길).
--   · 그런데 세션에는 이미 지우는 길이 열려 있었다 — 0003 의 정책 wsadmin_delete_projects 와 authenticated 의 projects DELETE 권한.
--     앱은 그 길을 쓰지 않지만 워크스페이스 관리자의 세션이 PostgREST 로 직접 지우면 이름 대조·기록 없이 지워지고, 회의록은 SET NULL 로
--     연결이 풀려 비공개 프로젝트의 회의록이 워크스페이스에 드러난다(딸린 행이 적은 프로젝트는 FK 에도 막히지 않는다). 그 길을 닫는다.
-- 무엇:
--   ⓪ 세션(authenticated)의 projects DELETE 권한을 회수하고 정책 wsadmin_delete_projects 를 지운다(0054 가 workspace_members 에 한 것과 같다).
--      읽기·수정(SELECT·UPDATE)은 그대로다.
--   ① authz_events 의 kind 에 'project_deleted' 를 더한다(kind·scope 두 check 를 같은 이름으로 다시 만든다 — 0053 과 같은 방식).
--      범위는 project_access 와 같고(workspace_id·project_id 있음) before 에 지운 프로젝트의 이름과 건수를 싣는다. authz_events 는 projects 를
--      FK 로 참조하지 않는다 — 프로젝트가 사라져도 이 표의 기록(그 프로젝트의 과거 권한 변경 포함)은 그대로 남는다.
--   ② integration_credentials_guard 에 "닫힌 토큰의 참조 좁히기" 갈래 하나를 더한다(본문은 0035 그대로). 닫힌 토큰에서 프로젝트·팀 참조를 떼기만
--      하는 갱신을 통과시킨다 — 소유자가 워크스페이스를 떠난 닫힌 토큰은 소속 검사에 걸려 어떤 갱신도 못 했고, 그 토큰이 가리키던 프로젝트는
--      FK 의 SET NULL 이 그 가드에 막혀 지울 수 없었다. 열린 토큰의 규칙과 넓히는 변경의 규칙은 그대로다.
--   ③ project_delete_unknown_references() — projects 를 캐스케이드로 따라가는 표를 가리키는 비-CASCADE 참조와 그 표들의 삭제 트리거 가운데
--      delete_project 가 모르는 것의 목록(없으면 null). 사후검사·RPC·테스트가 같은 함수를 쓴다.
--   ④ project_delete_summary(p_project_id) — 지워질 것의 건수와 삭제를 막는 회의록 수(읽기 전용). 화면의 사전 조회와 RPC 가 같은 식을 쓴다.
--   ⑤ delete_project(p_actor, p_project_id, p_expected_name) — DEFINER·service_role 전용. 등급을 함수 안에서 다시 판정한다
--      (actor_is_workspace_admin — 그 프로젝트의 워크스페이스의 관리자 또는 플랫폼 관리자. 보관된 워크스페이스는 false. 프로젝트 관리자는 지우지 못한다).
--      순서: 가져오기 잠금(wbs-import) → projects 행 FOR UPDATE → 이름 대조(양끝 공백을 뗀 비교) → 모르는 참조 검사 →
--      **회의록이 하나라도 있으면 지우지 않고 status blocked 와 건수를 돌려준다**(보관된 회의록 포함 — 아래) →
--      연동 토큰의 참조 정리 → 비-CASCADE 참조의 자식 쪽을 먼저 지움 → projects 행 삭제(나머지는 캐스케이드) → 삭제 기록 1행.
-- 회의록: 이 제품은 회의록을 지우지 않는다(보관만 한다 — 원본·버전·저장소 객체·위키 근거를 남긴다). minutes.project_id 는 SET NULL 이라 그대로
--   지우면 연결만 풀려 워크스페이스 회의록이 되는데, 회의록의 가시성이 project_id 에 걸려 있어 **비공개 프로젝트의 회의록이 워크스페이스 전체에
--   드러난다**. 그래서 회의록이 남아 있으면 거부한다. 세는 범위는 그 프로젝트에 닿은 회의록 전부다 — project_id 가 그 프로젝트이거나,
--   그 프로젝트의 회의·폴더·전용 팀을 가리키는 것(뒤 셋은 SET NULL 로 연결이 풀릴 행이다).
-- 보호 트리거(삭제를 막는 것 여섯)와 통과시키는 길 — 트리거를 끄지 않는다:
--   · command_receipts_worm · project_settings_history_worm · project_settings_keep_row: 세 함수 모두 "부모 프로젝트가 이미 보이지 않으면 통과"다.
--     그래서 이 세 표는 손으로 지우지 않고 projects 삭제의 캐스케이드에 맡긴다.
--   · wiki_topic_revisions_immutable_trg: 트랜잭션 설정 app.wiki_purge = 'on' 일 때만 삭제를 통과시킨다(그 함수 주석이 프로젝트 삭제를 용도로 적었다).
--     삭제 구간에서만 켜고 끝나면 비운다.
--   · minute_folders_kind_guard: 세션(authenticated·anon)만 본다 — DEFINER 함수 안에서는 통과한다.
--   · authz_events_record(project_members): 막지 않고 기록한다. 명단 행을 캐스케이드에 맡겨 원인이 parent_deleted 로 남게 하고, 행위자는
--     app.authz_actor 로 넘긴다(권한 RPC 들과 같은 관용구).
--   이 RPC 가 지우는 감사 성격의 행: 그 프로젝트의 명령 영수증(command_receipts)·설정 이력(project_settings_history)·위키 주제 개정
--   (wiki_topic_revisions)·작업 변경 이력(change_logs)·단계 승인(wbs_stage_approvals) — 전부 그 프로젝트에 딸린 것이라 프로젝트와 함께 사라진다.
--   남는 것: authz_events(위 ①)와 usage_events(project_id 만 null).
-- 그대로 두는 것: usage_events.project_id·integration_credentials.default_project_id 의 SET NULL. 다만 토큰의 project_ids(배열)·team_map(값)에는
--   FK 가 없어 지운 프로젝트·전용 팀의 id 가 남고, 그러면 가드가 그 토큰의 다음 갱신을 전부 거부한다 — 그래서 삭제 전에 그 id 들을 뗀다.
--   project_ids 는 빈 배열로 남는다(null 로 바꾸면 "전체 허용"으로 넓어진다).
-- 저장소: 파일은 DB 삭제로 지워지지 않는다. 함수는 그 프로젝트의 접두(ws/<wid>/p/<pid>/)와, 삭제 뒤에도 그 접두 아래 경로를 가리키는 행의 수를
--   버킷별로 돌려준다(referenced) — 다른 프로젝트로 옮긴 회의록의 첨부는 경로가 옛 프로젝트 접두에 남는다. 앱은 0건인 버킷만 정리한다.
-- 사유 코드(앱이 문구로 바꾼다): AUTHZ_FORBIDDEN(42501) · PROJECT_NOT_FOUND(P0002) · PROJECT_DELETE_INVALID·PROJECT_NAME_MISMATCH(22023) ·
--   PROJECT_DELETE_ISOLATION(25001) · PROJECT_DELETE_UNKNOWN_REFERENCE(0A000) · PROJECT_DELETE_REFERENCED(23503) ·
--   PROJECT_DELETE_CREDENTIAL_BLOCKED(23514 — 열린 토큰의 정리가 가드에 걸렸다).
-- 하지 않는 것: 보관(비활성 플래그), 회의록이 있는 프로젝트의 강제 삭제, 회의록의 삭제·연결 해제.
-- 데이터: 적용만으로 바뀌는 행은 없다(세션의 삭제 권한·정책 하나를 거두고 제약 둘을 넓히고 함수 하나를 다시 정의하고 함수 셋을 만든다). 기존 authz_events 행은 새 check 를 그대로 통과한다.
-- 롤백: supabase/rollbacks/*_project_delete_rollback.sql.

begin;

-- ⓪ 세션의 삭제 길을 닫는다 — 프로젝트를 지우는 길은 delete_project 하나다
revoke delete on public.projects from authenticated;
drop policy wsadmin_delete_projects on public.projects;

-- ① 기록 종류 — 같은 이름으로 다시 만든다(넓히기만 한다)
alter table public.authz_events drop constraint authz_events_kind_check;
alter table public.authz_events add constraint authz_events_kind_check
  check (kind in ('platform_admin', 'workspace_role', 'project_access', 'password_reset', 'project_deleted'));
alter table public.authz_events drop constraint authz_events_scope_check;
alter table public.authz_events add constraint authz_events_scope_check check (
     (kind = 'platform_admin' and workspace_id is null and project_id is null)
  or (kind = 'workspace_role' and workspace_id is not null and project_id is null)
  or (kind = 'project_access' and project_id is not null and workspace_id is not null)
  or (kind = 'password_reset' and workspace_id is not null and project_id is null and target_user_id is not null)
  or (kind = 'project_deleted' and workspace_id is not null and project_id is not null and before is not null));

-- ② 연동 토큰 가드 — 닫힌 토큰의 참조 좁히기 갈래(나머지 본문은 0035 그대로)
create or replace function public.integration_credentials_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_pid uuid;
  v_t_ws uuid;
  v_t_pid uuid;
  v_team_id_txt text;
  v_team_id uuid;
begin
  -- 닫힌 토큰의 참조 좁히기(0058 프로젝트 삭제) — 닫힌(enabled false·revoked_at 있음) 토큰에서 프로젝트·팀 참조를 **떼기만** 하는 갱신은 통과시킨다.
  -- 소유자가 워크스페이스를 떠난 닫힌 토큰은 아래 ② 소속 검사에 걸려 어떤 갱신도 못 한다 — 그 토큰이 가리키던 프로젝트를 지우면 FK 의 SET NULL 과
  -- delete_project 의 참조 정리가 여기서 막혀 프로젝트를 영영 지울 수 없었다. 넓히는 변경(원소 추가·null 로 되돌려 전체 허용·다른 값)과
  -- 네 열 밖의 변경, 닫힘을 푸는 변경은 이 갈래를 지나지 못한다
  if tg_op = 'UPDATE' and old.enabled = false and old.revoked_at is not null
     and (to_jsonb(new) - 'project_ids' - 'default_project_id' - 'default_team_id' - 'team_map')
       = (to_jsonb(old) - 'project_ids' - 'default_project_id' - 'default_team_id' - 'team_map')
     and (new.project_ids is not distinct from old.project_ids
          or (old.project_ids is not null and new.project_ids is not null and new.project_ids <@ old.project_ids))
     and (new.default_project_id is null or new.default_project_id is not distinct from old.default_project_id)
     and (new.default_team_id is null or new.default_team_id is not distinct from old.default_team_id)
     and pg_catalog.jsonb_typeof(new.team_map) = 'object' and new.team_map <@ old.team_map then
    return new;
  end if;
  -- 소속 회수 후에도 자기 토큰을 닫을 수 있다. 구조/해시/만료를 바꾸는 우회는 허용하지 않는다.
  if tg_op = 'UPDATE' and new.enabled = false and new.revoked_at is not null
     and (to_jsonb(new) - 'enabled' - 'revoked_at') = (to_jsonb(old) - 'enabled' - 'revoked_at') then
    return new;
  end if;
  -- 1. kind='agent_runner' 면 default_team_id is null and team_map = '{}'
  if new.kind = 'agent_runner' then
    if new.default_team_id is not null or (new.team_map is distinct from '{}'::jsonb and new.team_map is not null) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_RUNNER_TEAM_FORBIDDEN';
    end if;
  end if;

  -- 2. owner_user_id is not null 면 workspace_members 소속이어야 한다
  if new.owner_user_id is not null then
    if not exists (
      select 1 from public.workspace_members m
       where m.workspace_id = new.workspace_id
         and m.user_id = new.owner_user_id
    ) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_OWNER_NOT_MEMBER';
    end if;
  end if;

  -- 3. project_ids 원소들이 모두 workspace_id 의 프로젝트여야 한다
  if new.project_ids is not null then
    foreach v_pid in array new.project_ids loop
      if public.project_ws(v_pid) is distinct from new.workspace_id then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_PROJECT_NOT_IN_WORKSPACE';
      end if;
    end loop;
  end if;

  -- 4. default_project_id 검증: workspace_id 의 프로젝트여야 하고, project_ids 가 null 이거나 그 안에 있어야 한다
  if new.default_project_id is not null then
    if public.project_ws(new.default_project_id) is distinct from new.workspace_id then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_PROJECT_NOT_IN_WORKSPACE';
    end if;
    if new.project_ids is not null and not (new.default_project_id = any(new.project_ids)) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_PROJECT_NOT_IN_ALLOWED';
    end if;
  end if;

  -- 5. default_team_id 검증: teams.workspace_id = workspace_id 이어야 하고, 프로젝트 전용 팀이면 project_ids 범위 안이어야 한다
  if new.default_team_id is not null then
    select t.workspace_id, t.project_id into v_t_ws, v_t_pid
      from public.teams t where t.id = new.default_team_id;
    if v_t_ws is null or v_t_ws is distinct from new.workspace_id then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_TEAM_NOT_IN_WORKSPACE';
    end if;
    if v_t_pid is not null and (new.project_ids is not null and not (v_t_pid = any(new.project_ids))) then
      raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_DEFAULT_TEAM_PROJECT_NOT_IN_ALLOWED';
    end if;
  end if;

  -- 객체/문자열만 허용한다. JSON null/배열을 문자열로 변환해 해석하지 않는다.
  if pg_catalog.jsonb_typeof(new.team_map) is distinct from 'object' then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_OBJECT_REQUIRED';
  end if;
  if exists (select 1 from pg_catalog.jsonb_each(new.team_map) e where pg_catalog.jsonb_typeof(e.value) is distinct from 'string') then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_STRING_REQUIRED';
  end if;
  -- 6. team_map 검증: jsonb_each_text 로 전개, uuid 형식 검사 후 teams 조회
  if new.team_map is not null and new.team_map is distinct from '{}'::jsonb then
    for v_team_id_txt in select value from pg_catalog.jsonb_each_text(new.team_map) loop
      begin
        v_team_id := v_team_id_txt::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_INVALID_UUID';
      end;
      select t.workspace_id, t.project_id into v_t_ws, v_t_pid
        from public.teams t where t.id = v_team_id;
      if v_t_ws is null or v_t_ws is distinct from new.workspace_id then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_NOT_IN_WORKSPACE';
      end if;
      if v_t_pid is not null and (new.project_ids is not null and not (v_t_pid = any(new.project_ids))) then
        raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_TEAM_MAP_PROJECT_NOT_IN_ALLOWED';
      end if;
    end loop;
  end if;

  return new;
end;
$$;
revoke all on function public.integration_credentials_guard() from public, anon, authenticated;

-- ③ delete_project 가 모르는 참조·삭제 트리거(없으면 null) --------------------------------------------------------------
create function public.project_delete_unknown_references() returns text
language sql stable security definer set search_path to '' as $$
  with recursive reach(rel) as (
    select 'public.projects'::pg_catalog.regclass::oid
    union
    select c.conrelid from pg_catalog.pg_constraint c join reach r on c.confrelid = r.rel
     where c.contype = 'f' and c.confdeltype = 'c'
  ),
  found(kind, ident) as (
    -- projects 를 캐스케이드로 따라가는 표(와 projects)를 가리키는 비-CASCADE 참조 — 자식 표.제약 이름
    select 'fk', cl.relname || '.' || c.conname
      from pg_catalog.pg_constraint c join pg_catalog.pg_class cl on cl.oid = c.conrelid
     where c.contype = 'f' and c.confdeltype <> 'c' and c.confrelid in (select rel from reach)
    union all
    -- 그 표들의 행 삭제 트리거(켜져 있는 것) — 표.트리거 이름
    select 'trigger', cl.relname || '.' || g.tgname
      from pg_catalog.pg_trigger g join pg_catalog.pg_class cl on cl.oid = g.tgrelid
     where not g.tgisinternal and g.tgenabled <> 'D' and (g.tgtype & 8) <> 0 and g.tgrelid in (select rel from reach)
  )
  select pg_catalog.string_agg(f.kind || ':' || f.ident, ', ' order by f.kind, f.ident)
    from found f
   where (f.kind, f.ident) not in (values
     -- delete_project 가 자식 쪽을 먼저 지우는 참조(RESTRICT·NO ACTION 14)
     ('fk', 'area_teams.area_teams_team_id_fkey'), ('fk', 'project_member_teams.project_member_teams_team_id_fkey'),
     ('fk', 'weekly_report_rows.weekly_report_rows_area_fk'), ('fk', 'minute_folders.minute_folders_team_id_fkey'),
     ('fk', 'attendance_records.attendance_member_project_fk'), ('fk', 'issue_assignees.issue_assignees_member_project_fk'),
     ('fk', 'meeting_attendees.meeting_attendees_member_project_fk'), ('fk', 'issues.issues_assignee_project_fk'),
     ('fk', 'wbs_items.wbs_items_assignee_member_fk'), ('fk', 'wiki_items.wiki_items_owner_project_fk'),
     ('fk', 'issues.issues_area_fk'), ('fk', 'issue_major_processes.issue_major_processes_area_fk'),
     ('fk', 'issues.issues_major_process_fk'), ('fk', 'wiki_items.wiki_items_topic_project_fk'),
     -- 같은 프로젝트 안의 SET NULL 7 — 자식 쪽을 먼저 지워 갱신이 일어나지 않게 한다(주제의 자기 참조는 같은 문장에서 함께 지워진다)
     ('fk', 'wbs_stage_approvals.wbs_stage_approvals_order_id_fkey'), ('fk', 'wbs_stage_approvals.wbs_stage_approvals_report_id_fkey'),
     ('fk', 'agent_work_orders.agent_work_orders_wbs_item_id_fkey'), ('fk', 'wiki_change_events.wiki_change_events_source_fk'),
     ('fk', 'wiki_change_events.wiki_change_events_wiki_item_id_fkey'), ('fk', 'wiki_questions.wiki_questions_topic_project_fk'),
     ('fk', 'wiki_topics.wiki_topics_parent_project_fk'),
     -- 회의록의 네 참조 — 그 프로젝트에 닿은 회의록이 있으면 삭제를 거부하므로 SET NULL 이 일어나지 않는다
     ('fk', 'minutes.minutes_project_fk'), ('fk', 'minutes.minutes_meeting_id_fkey'), ('fk', 'minutes.minutes_folder_id_fkey'),
     ('fk', 'minutes.minutes_team_id_fkey'),
     -- 프로젝트 밖에 남는 행의 SET NULL — 사용 기록은 그대로 두고, 토큰은 삭제 전에 참조를 뗀다
     ('fk', 'usage_events.usage_events_project_id_fkey'),
     ('fk', 'integration_credentials.integration_credentials_default_project_id_fkey'),
     ('fk', 'integration_credentials.integration_credentials_default_team_id_fkey'),
     -- 삭제 트리거 여섯 — 통과시키는 길은 이 파일 머리의 "보호 트리거" 문단
     ('trigger', 'command_receipts.command_receipts_worm'), ('trigger', 'project_settings_history.project_settings_history_worm'),
     ('trigger', 'project_settings.project_settings_keep_row'), ('trigger', 'wiki_topic_revisions.wiki_topic_revisions_immutable_trg'),
     ('trigger', 'minute_folders.minute_folders_kind_guard'), ('trigger', 'project_members.authz_events_record'))
$$;
revoke all on function public.project_delete_unknown_references() from public, anon, authenticated;
grant execute on function public.project_delete_unknown_references() to service_role;

-- ④ 지워질 것의 건수 + 삭제를 막는 회의록 수(읽기 전용) ------------------------------------------------------------------
create function public.project_delete_summary(p_project_id uuid) returns jsonb
language sql stable security definer set search_path to '' as $$
  select pg_catalog.jsonb_build_object(
    -- 그 프로젝트에 닿은 회의록 — 보관된 것도 센다. project_id 가 아니어도 그 프로젝트의 회의·폴더·전용 팀을 가리키면 삭제가 그 연결을 풀게 된다
    'minutes', (select count(*) from public.minutes m
                 where m.project_id = p_project_id
                    or m.meeting_id in (select g.id from public.meetings g where g.project_id = p_project_id)
                    or m.team_id in (select t.id from public.teams t where t.project_id = p_project_id)
                    or m.folder_id in (select f.id from public.minute_folders f
                                        where f.project_id = p_project_id
                                           or f.team_id in (select t.id from public.teams t where t.project_id = p_project_id))),
    -- 그 가운데 보관된 것 — 화면이 "보관된 회의록은 옮길 수 없다"를 건수와 함께 알린다(같은 조건 + archived_at)
    'minutes_archived', (select count(*) from public.minutes m
                 where m.archived_at is not null
                   and (m.project_id = p_project_id
                    or m.meeting_id in (select g.id from public.meetings g where g.project_id = p_project_id)
                    or m.team_id in (select t.id from public.teams t where t.project_id = p_project_id)
                    or m.folder_id in (select f.id from public.minute_folders f
                                        where f.project_id = p_project_id
                                           or f.team_id in (select t.id from public.teams t where t.project_id = p_project_id)))),
    'removed', pg_catalog.jsonb_build_object(
      'wbs_items', (select count(*) from public.wbs_items w where w.project_id = p_project_id),
      'issues', (select count(*) from public.issues i where i.project_id = p_project_id),
      'weekly_reports', (select count(*) from public.weekly_reports r where r.project_id = p_project_id),
      'meetings', (select count(*) from public.meetings g where g.project_id = p_project_id),
      'wiki_items', (select count(*) from public.wiki_items k where k.project_id = p_project_id),
      'wiki_topics', (select count(*) from public.wiki_topics k where k.project_id = p_project_id),
      'announcements', (select count(*) from public.announcements a where a.project_id = p_project_id),
      'attendance_records', (select count(*) from public.attendance_records a where a.project_id = p_project_id),
      'project_members', (select count(*) from public.project_members pm where pm.project_id = p_project_id),
      'teams', (select count(*) from public.teams t where t.project_id = p_project_id),
      'form_templates', (select count(*) from public.form_templates ft where ft.project_id = p_project_id),
      'attachments', (select count(*) from public.deliverable_attachments d join public.wbs_items w on w.id = d.wbs_item_id
                       where w.project_id = p_project_id)
                   + (select count(*) from public.issue_attachments ia where ia.project_id = p_project_id)))
$$;
revoke all on function public.project_delete_summary(uuid) from public, anon, authenticated;
grant execute on function public.project_delete_summary(uuid) to service_role;

-- ⑤ 프로젝트 삭제 한 길 ---------------------------------------------------------------------------------------------
create function public.delete_project(p_actor uuid, p_project_id uuid, p_expected_name text)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_ws uuid;
  v_name text;
  v_unknown text;
  v_summary jsonb;
  v_minutes bigint;
  v_teams uuid[];
  v_team_texts text[];
  v_credentials integer := 0;
  v_prefix text;
  v_referenced jsonb;
begin
  if p_actor is null or p_project_id is null or p_expected_name is null then
    raise exception using errcode = '22023', message = 'PROJECT_DELETE_INVALID';
  end if;
  -- 격리 수준 규칙(0011 공통): 잠근 뒤 회의록을 세고 지우므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'PROJECT_DELETE_ISOLATION';
  end if;
  -- 범위는 잠금 없이 먼저 읽는다(프로젝트의 워크스페이스는 바뀌지 않는다)
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id;
  -- 등급 재판정(액션 가드 requireWorkspaceAdmin 과 두 관문) — 그 워크스페이스의 관리자 또는 플랫폼 관리자. 프로젝트 관리자는 지우지 못한다.
  -- 보관된 워크스페이스는 false(0056). 없는 프로젝트도 여기서 같은 거부다(존재를 알려 주지 않는다)
  if v_ws is null or not public.actor_is_workspace_admin(p_actor, v_ws) then
    raise exception using errcode = '42501', message = 'AUTHZ_FORBIDDEN';
  end if;
  -- 잠금 — 가져오기와 같은 프로젝트 잠금(0051 과 같은 순서) 뒤 프로젝트 행. 이 행을 가리키는 새 행의 FK 검사(FOR KEY SHARE)가 여기서 기다린다 —
  -- 아래에서 회의록을 세고 지울 때까지 새 회의록·새 작업이 끼어들지 못한다
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wbs-import:' || p_project_id::text, 0));
  select p.name into v_name from public.projects p where p.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  -- 사람이 직접 적은 이름과 대조한다(양끝 공백만 뗀다) — 엉뚱한 프로젝트를 지우지 않는다
  if pg_catalog.btrim(v_name) is distinct from pg_catalog.btrim(p_expected_name) then
    raise exception using errcode = '22023', message = 'PROJECT_NAME_MISMATCH';
  end if;
  -- 이 함수가 모르는 참조·삭제 트리거가 생겼으면 지우지 않는다(모르는 채 지우면 FK 가 막거나, 남아야 할 행의 연결이 조용히 풀린다)
  v_unknown := public.project_delete_unknown_references();
  if v_unknown is not null then
    raise exception using errcode = '0A000', message = 'PROJECT_DELETE_UNKNOWN_REFERENCE', detail = v_unknown;
  end if;

  v_summary := public.project_delete_summary(p_project_id);
  v_minutes := (v_summary ->> 'minutes')::bigint;
  -- 회의록이 하나라도 있으면(보관된 것 포함) 아무것도 지우지 않는다 — 회의록은 지우지도, 연결을 풀지도 않는다
  if v_minutes > 0 then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'reason', 'minutes', 'minutes', v_minutes,
                                         'minutes_archived', (v_summary ->> 'minutes_archived')::bigint, 'name', v_name);
  end if;

  select coalesce(pg_catalog.array_agg(t.id), '{}'::uuid[]), coalesce(pg_catalog.array_agg(t.id::text), '{}'::text[])
    into v_teams, v_team_texts from public.teams t where t.project_id = p_project_id;

  -- 연동 토큰 — 지울 프로젝트·전용 팀을 가리키는 값을 뗀다. project_ids 는 빈 배열로 남긴다(null 은 "전체 허용"이다).
  -- 닫힌 토큰은 가드의 좁히기 갈래(②)로 통과한다. 열린 토큰이 가드에 걸리면(소유자가 소속이 아닌 열린 토큰 등) 고정 토큰으로 알리고 멈춘다
  begin
    update public.integration_credentials c
       set project_ids = case when c.project_ids is null then null else pg_catalog.array_remove(c.project_ids, p_project_id) end,
           default_project_id = case when c.default_project_id = p_project_id then null else c.default_project_id end,
           default_team_id = case when c.default_team_id = any (v_teams) then null else c.default_team_id end,
           team_map = coalesce((select pg_catalog.jsonb_object_agg(e.key, e.value)
                                  from pg_catalog.jsonb_each_text(c.team_map) e
                                 where not (pg_catalog.lower(e.value) = any (v_team_texts))), '{}'::jsonb)
     where c.workspace_id = v_ws
       and (p_project_id = any (c.project_ids) or c.default_project_id = p_project_id or c.default_team_id = any (v_teams)
            or exists (select 1 from pg_catalog.jsonb_each_text(c.team_map) e where pg_catalog.lower(e.value) = any (v_team_texts)));
    get diagnostics v_credentials = row_count;
  exception when check_violation then
    raise exception using errcode = '23514', message = 'PROJECT_DELETE_CREDENTIAL_BLOCKED', detail = sqlerrm;
  end;

  -- 삭제 구간 — 행위자를 권한 이력 트리거에 넘기고(명단 행의 회수 기록), 위키 주제 개정의 파기 스위치를 이 구간에서만 켠다
  perform pg_catalog.set_config('app.authz_actor', p_actor::text, true);
  perform pg_catalog.set_config('app.wiki_purge', 'on', true);
  begin
    -- 비-CASCADE 참조의 자식 쪽을 먼저 — 부모(팀·영역·명단·주제·대공정·작업·주문)가 캐스케이드로 지워질 때 붙든 행이 없게 한다
    delete from public.wbs_stage_approvals a where a.project_id = p_project_id;           -- → agent_work_orders·reports(SET NULL)
    delete from public.agent_work_orders o where o.project_id = p_project_id;             -- → wbs_items(SET NULL)
    delete from public.area_teams art using public.project_areas pa
     where pa.id = art.area_id and pa.project_id = p_project_id;                          -- → teams(RESTRICT)
    delete from public.project_member_teams pmt using public.project_members pm
     where pm.id = pmt.member_id and pm.project_id = p_project_id;                        -- → teams(RESTRICT)
    delete from public.weekly_report_rows r where r.project_id = p_project_id;            -- → project_areas(RESTRICT)
    delete from public.issue_assignees ia where ia.project_id = p_project_id;             -- → project_members
    delete from public.issues i where i.project_id = p_project_id;                        -- → project_members·project_areas·issue_major_processes
    delete from public.issue_major_processes mp where mp.project_id = p_project_id;       -- → project_areas
    delete from public.attendance_records ar where ar.project_id = p_project_id;          -- → project_members
    delete from public.meeting_attendees ma where ma.project_id = p_project_id;           -- → project_members
    delete from public.wiki_change_events ce where ce.project_id = p_project_id;          -- → wiki_items·wiki_item_sources(SET NULL)
    delete from public.wiki_questions q where q.project_id = p_project_id;                -- → wiki_topics(SET NULL)
    delete from public.wiki_items k where k.project_id = p_project_id;                    -- → wiki_topics·project_members
    delete from public.wbs_items w where w.project_id = p_project_id;                     -- → project_members
    delete from public.minute_folders f
     where f.project_id = p_project_id or f.team_id = any (v_teams);                      -- → teams (회의록은 위에서 0건을 확인했다)
    -- 프로젝트 행 — 나머지(팀·영역·명단·주제와 개정·설정과 이력·명령 영수증·공지·색인 …)는 FK 캐스케이드가 지운다.
    -- 설정 행·설정 이력·명령 영수증의 보호 트리거는 부모 프로젝트가 사라진 캐스케이드만 통과시킨다 — 그래서 손으로 지우지 않는다
    delete from public.projects p where p.id = p_project_id;
  exception when foreign_key_violation then
    -- 모르는 붙듦 — 전부 없던 일로 하고 사유만 알린다(위 검사가 잡지 못한 경우의 마지막 그물)
    raise exception using errcode = '23503', message = 'PROJECT_DELETE_REFERENCED', detail = sqlerrm;
  end;
  perform pg_catalog.set_config('app.wiki_purge', '', true);
  perform pg_catalog.set_config('app.authz_actor', '', true);

  -- 삭제 기록 — 누가·언제·어느 프로젝트(이름)·건수. authz_events 는 projects 를 FK 로 참조하지 않아 이 행과 그 프로젝트의 옛 기록이 남는다
  insert into public.authz_events (kind, workspace_id, project_id, before, cause, actor_user_id)
  values ('project_deleted', v_ws, p_project_id,
          pg_catalog.jsonb_build_object('name', v_name, 'removed', v_summary -> 'removed'), 'direct', p_actor);

  -- 저장소 — 파일은 앱이 지운다. 삭제 뒤에도 이 접두 아래 경로를 가리키는 행이 남은 버킷은 앱이 건드리지 않는다(다른 프로젝트로 옮긴 회의록의 첨부)
  v_prefix := 'ws/' || v_ws::text || '/p/' || p_project_id::text || '/';
  v_referenced := pg_catalog.jsonb_build_object(
    'deliverables', (select count(*) from public.deliverable_attachments d where pg_catalog.starts_with(pg_catalog.lower(d.file_path), v_prefix)),
    'issue-attachments', (select count(*) from public.issue_attachments ia where pg_catalog.starts_with(pg_catalog.lower(ia.file_path), v_prefix)),
    'minutes', (select count(*) from public.minute_files mf where pg_catalog.starts_with(pg_catalog.lower(mf.file_path), v_prefix))
             + (select count(*) from public.minute_versions mv where pg_catalog.starts_with(pg_catalog.lower(mv.file_path), v_prefix)),
    'form-templates', (select count(*) from public.form_templates ft where pg_catalog.starts_with(pg_catalog.lower(ft.storage_path), v_prefix)));

  return pg_catalog.jsonb_build_object(
    'status', 'deleted', 'project_id', p_project_id, 'workspace_id', v_ws, 'name', v_name,
    'removed', v_summary -> 'removed', 'credentials', v_credentials,
    'storage_prefix', v_prefix, 'referenced', v_referenced);
end $$;
revoke all on function public.delete_project(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_project(uuid, uuid, text) to service_role;

-- 사후검사 PROJECT_DELETE_POSTCHECK — 읽기만 한다. 워크스페이스·프로젝트가 몇 개든(0개여도) 같은 검사다(행을 보지 않고 카탈로그만 본다)
do $$
declare
  v text;
begin
  -- 세 함수는 service_role 전용
  select string_agg(f, ', ') into v from unnest(array[
    'public.delete_project(uuid, uuid, text)', 'public.project_delete_summary(uuid)', 'public.project_delete_unknown_references()']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: 실행권이 어긋났다(세션 불가·service_role 가능이어야 한다): %', v; end if;
  -- 세션은 projects 를 지우지 못한다 — 권한도 정책도 없다
  if has_table_privilege('authenticated', 'public.projects', 'DELETE') or has_table_privilege('anon', 'public.projects', 'DELETE')
     or exists (select 1 from pg_policy p where p.polrelid = 'public.projects'::regclass and p.polcmd in ('d', '*')) then
    raise exception 'PROJECT_DELETE_POSTCHECK: 세션에 projects 를 지우는 길이 남아 있다(권한 또는 정책)';
  end if;
  -- DEFINER·빈 search_path
  select string_agg(p.proname, ', ') into v from pg_proc p
   where p.oid in ('public.delete_project(uuid, uuid, text)'::regprocedure, 'public.project_delete_summary(uuid)'::regprocedure,
                   'public.project_delete_unknown_references()'::regprocedure, 'public.integration_credentials_guard()'::regprocedure)
     and (not p.prosecdef or not coalesce(p.proconfig, '{}') @> array['search_path=""']);
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: DEFINER·search_path 가 어긋났다: %', v; end if;
  -- 삭제 RPC 가 지닌 것 — 등급 재판정·잠금·이름 대조·회의록 거부·모르는 참조 검사·파기 스위치·기록
  select string_agg(x.token, ', ') into v
    from (values ('public.actor_is_workspace_admin('), ('AUTHZ_FORBIDDEN'), ('for update'), ('PROJECT_NAME_MISMATCH'), ('''blocked'''),
                 ('public.project_delete_unknown_references()'), ('public.project_delete_summary('), ('app.wiki_purge'), ('app.authz_actor'),
                 ('''project_deleted''')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = 'public.delete_project(uuid, uuid, text)'::regprocedure)) = 0;
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: 삭제 RPC 에 빠진 것이 있다: %', v; end if;
  -- 프로젝트 관리자 등급으로 판정하지 않는다(워크스페이스 관리자만)
  if position('actor_is_project_admin' in (select p.prosrc from pg_proc p where p.oid = 'public.delete_project(uuid, uuid, text)'::regprocedure)) > 0 then
    raise exception 'PROJECT_DELETE_POSTCHECK: 삭제 RPC 가 프로젝트 관리자 등급을 본다';
  end if;
  -- projects 를 따라가는 참조·삭제 트리거 가운데 이 RPC 가 모르는 것이 없다 — 새 표·새 참조가 생기면 여기서(그리고 RPC 호출 때) 드러난다
  v := public.project_delete_unknown_references();
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: delete_project 가 모르는 참조·삭제 트리거가 있다: %', v; end if;
  -- 손으로 지우는 표는 전부 projects 를 캐스케이드로 따라가는 표다(아니면 다른 프로젝트의 행에 손대는 것이다)
  select string_agg(x.name, ', ') into v
    from (values ('wbs_stage_approvals'), ('agent_work_orders'), ('area_teams'), ('project_member_teams'), ('weekly_report_rows'),
                 ('issue_assignees'), ('issues'), ('issue_major_processes'), ('attendance_records'), ('meeting_attendees'),
                 ('wiki_change_events'), ('wiki_questions'), ('wiki_items'), ('wbs_items'), ('minute_folders')) as x(name)
   where not exists (
     with recursive reach(rel) as (
       select 'public.projects'::regclass::oid
       union
       select c.conrelid from pg_constraint c join reach r on c.confrelid = r.rel where c.contype = 'f' and c.confdeltype = 'c')
     select 1 from reach where rel = ('public.' || x.name)::regclass::oid);
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: 손으로 지우는 표가 projects 를 캐스케이드로 따라가지 않는다: %', v; end if;
  -- 보호 트리거의 통과 길이 그대로다 — 부모가 사라진 캐스케이드(세 함수)와 파기 스위치(주제 개정)
  select string_agg(x.fn, ', ') into v
    from (values ('public.command_receipts_reject_mutation()', 'public.projects p where p.id = old.project_id'),
                 ('public.settings_history_reject_mutation()', 'public.projects p where p.id = old.project_id'),
                 ('public.settings_row_keep()', 'public.projects p where p.id = old.project_id'),
                 ('public.wiki_topic_revisions_reject_mutation()', 'app.wiki_purge')) as x(fn, token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = x.fn::regprocedure)) = 0;
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: 보호 트리거의 통과 길이 달라졌다: %', v; end if;
  -- 삭제 기록의 표는 projects 를 FK 로 참조하지 않는다(참조하면 기록이 프로젝트와 함께 지워지거나 삭제를 막는다)
  if exists (select 1 from pg_constraint c where c.contype = 'f' and c.conrelid = 'public.authz_events'::regclass
                                             and c.confrelid = 'public.projects'::regclass) then
    raise exception 'PROJECT_DELETE_POSTCHECK: authz_events 가 projects 를 FK 로 참조한다';
  end if;
  if (select pg_get_constraintdef(c.oid) from pg_constraint c
       where c.conrelid = 'public.authz_events'::regclass and c.conname = 'authz_events_kind_check') !~ 'project_deleted' then
    raise exception 'PROJECT_DELETE_POSTCHECK: authz_events 가 project_deleted 를 받지 않는다';
  end if;
  -- 저장소 경로를 읽는 열
  select string_agg(x.tbl || '.' || x.col, ', ') into v
    from (values ('deliverable_attachments', 'file_path'), ('issue_attachments', 'file_path'), ('minute_files', 'file_path'),
                 ('minute_versions', 'file_path'), ('form_templates', 'storage_path')) as x(tbl, col)
   where not exists (select 1 from pg_attribute a
                      where a.attrelid = ('public.' || x.tbl)::regclass and a.attname = x.col and not a.attisdropped);
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: 저장소 경로 열이 없다: %', v; end if;
  -- 가드의 좁히기 갈래와 기존 갈래가 함께 있다
  select string_agg(x.token, ', ') into v
    from (values ('new.project_ids <@ old.project_ids'), ('new.team_map <@ old.team_map'), ('INTEGRATION_CREDENTIALS_OWNER_NOT_MEMBER'),
                 ('INTEGRATION_CREDENTIALS_PROJECT_NOT_IN_WORKSPACE')) as x(token)
   where position(x.token in (select p.prosrc from pg_proc p where p.oid = 'public.integration_credentials_guard()'::regprocedure)) = 0;
  if v is not null then raise exception 'PROJECT_DELETE_POSTCHECK: 연동 토큰 가드에 빠진 것이 있다: %', v; end if;
end $$;

commit;
