-- 0013_account_preferences 롤백 — 계정 설정을 첫 소속 행의 prefs 에 되써 병합하고, 워크스페이스 행들로 나뉜 notifRead 를 첫 소속 행에
-- 합친 뒤 표를 지운다(옛 코드는 둘 다 첫 소속 행에서만 읽는다).
-- 순서: 이 SQL 을 **먼저**, 옛 코드 되돌림을 바로 이어서(정방향 머리 참고) — 반대 순서면 그 사이 옛 코드가 첫 소속 행에 쓴 계정 키를
--   여기의 `||` 가 account_preferences 의 옛 값으로 덮는다.
-- 되돌리지 않는 것: recentProjects(옛 코드가 무시한다 — 남긴다), lastProjectId·heroCollapsed(표시용 문맥 — 잃어도 기능 손실 없음),
-- 첫 소속이 없는 사용자(탈퇴)의 계정 설정(되쓸 행이 없다 — 표와 함께 사라진다), 정방향이 버린 고아 notifRead 키(없는 프로젝트·소속 밖).
-- 첫 소속이 아닌 행의 notifRead 는 지우지 않는다(옛 코드가 읽지 않는 행 — 재적용 때 정방향 3-2b 가 다시 나눈다).
begin;
insert into public.user_preferences (user_id, workspace_id, prefs, updated_at)
select a.user_id, fw.workspace_id, jsonb_build_object('notifRead', a.nr), now()
  from (select up.user_id, jsonb_object_agg(e.key, e.value) as nr
          from public.user_preferences up
         cross join lateral jsonb_each(case when jsonb_typeof(up.prefs -> 'notifRead') = 'object' then up.prefs -> 'notifRead' else '{}'::jsonb end) e
         group by up.user_id) a
  join lateral (select wm.workspace_id from public.workspace_members wm where wm.user_id = a.user_id
                 order by wm.created_at, wm.workspace_id limit 1) fw on true
on conflict (user_id, workspace_id) do update
  set prefs = public.user_preferences.prefs
    || jsonb_build_object('notifRead', coalesce(public.user_preferences.prefs -> 'notifRead', '{}'::jsonb) || (excluded.prefs -> 'notifRead'));
insert into public.user_preferences (user_id, workspace_id, prefs, updated_at)
select ap.user_id, fw.workspace_id, ap.prefs, now()
  from public.account_preferences ap
  join lateral (select wm.workspace_id from public.workspace_members wm where wm.user_id = ap.user_id
                 order by wm.created_at, wm.workspace_id limit 1) fw on true
 where ap.prefs <> '{}'::jsonb
on conflict (user_id, workspace_id) do update set prefs = public.user_preferences.prefs || excluded.prefs;
drop table public.account_preferences;
commit;
