-- 0013_account_preferences 롤백 — 계정 설정을 첫 소속 행의 prefs 에 되써 병합하고 표를 지운다.
-- 되돌리지 않는 것: recentProjects(옛 코드가 무시한다 — 남긴다), lastProjectId·heroCollapsed(표시용 문맥 — 잃어도 기능 손실 없음),
-- 첫 소속이 없는 사용자(탈퇴)의 계정 설정(되쓸 행이 없다 — 표와 함께 사라진다).
begin;
insert into public.user_preferences (user_id, workspace_id, prefs, updated_at)
select ap.user_id, fw.workspace_id, ap.prefs, now()
  from public.account_preferences ap
  join lateral (select wm.workspace_id from public.workspace_members wm where wm.user_id = ap.user_id
                 order by wm.created_at, wm.workspace_id limit 1) fw on true
 where ap.prefs <> '{}'::jsonb
on conflict (user_id, workspace_id) do update set prefs = public.user_preferences.prefs || excluded.prefs;
drop table public.account_preferences;
commit;
