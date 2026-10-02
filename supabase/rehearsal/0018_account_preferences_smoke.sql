-- *_account_preferences 리허설 스모크 — seed 를 심고 이 마이그레이션을 적용한 DB 에서. 결과 열이 전부 t 여야 한다. begin…rollback.
begin;
select
  -- u1: 첫 소속(A) 행의 계정 키만 계정 행으로(B 행의 light 는 버려짐), notifRead 의 형식 밖 키 "p" 는 고아라 버림(3-2b)
  (select prefs = '{"theme":"dark","locale":"en","sidebarCollapsed":true,"notif":{"x":false}}'::jsonb
     from public.account_preferences where user_id = '00000000-0000-0000-7e57-0000000016a1') as u1_account,
  (select prefs = '{}'::jsonb from public.user_preferences
    where user_id = '00000000-0000-0000-7e57-0000000016a1' and workspace_id = '00000000-0000-0000-7e57-0000000016b1') as u1_ws_a,
  -- u1: lastProjectId(B 프로젝트) → B 행 recentProjects
  (select prefs -> 'recentProjects' -> 0 ->> 'id' = '00000000-0000-0000-7e57-0000000016c2' and not (prefs ? 'theme') and not (prefs ? 'lastProjectId')
     from public.user_preferences where user_id = '00000000-0000-0000-7e57-0000000016a1' and workspace_id = '00000000-0000-0000-7e57-0000000016b2') as u1_recent,
  -- u2: 없는 프로젝트 → 버림, 계정 키 이동, 은퇴 키 삭제
  (select prefs = '{"wbsGanttScale":24}'::jsonb from public.account_preferences where user_id = '00000000-0000-0000-7e57-0000000016a2') as u2_account,
  (select prefs = '{}'::jsonb from public.user_preferences where user_id = '00000000-0000-0000-7e57-0000000016a2') as u2_ws,
  -- u3: 탈퇴한 A 의 행은 첫 소속이 아니라 계정 행이 없고, A 프로젝트 lastProjectId 는 버림(소속 아님)
  (select count(*) = 0 from public.account_preferences where user_id = '00000000-0000-0000-7e57-0000000016a3') as u3_no_account,
  (select prefs = '{}'::jsonb from public.user_preferences
    where user_id = '00000000-0000-0000-7e57-0000000016a3' and workspace_id = '00000000-0000-0000-7e57-0000000016b1') as u3_dropped,
  -- u4(Y2): A 행에는 A 프로젝트 읽음만, 없던 B 행이 생겨 B 프로젝트 읽음 + recentProjects(삽입 갈래). 없는 프로젝트·형식 밖 키는 버림
  (select prefs = '{"theme":"dark"}'::jsonb from public.account_preferences where user_id = '00000000-0000-0000-7e57-0000000016a4') as u4_account,
  (select prefs = '{"notifRead":{"00000000-0000-0000-7e57-0000000016c1":["n1"]}}'::jsonb from public.user_preferences
    where user_id = '00000000-0000-0000-7e57-0000000016a4' and workspace_id = '00000000-0000-0000-7e57-0000000016b1') as u4_ws_a,
  (select prefs -> 'notifRead' = '{"00000000-0000-0000-7e57-0000000016c2":["n2"]}'::jsonb
      and prefs -> 'recentProjects' -> 0 ->> 'id' = '00000000-0000-0000-7e57-0000000016c2'
     from public.user_preferences
    where user_id = '00000000-0000-0000-7e57-0000000016a4' and workspace_id = '00000000-0000-0000-7e57-0000000016b2') as u4_ws_b_inserted,
  -- u5·u6(Y3): 형식 밖·빈 lastProjectId 는 캐스트 전에 걸러 이행이 멈추지 않고 버린다. u6 은 계정 키가 없어 빈 계정 행
  (select prefs = '{"locale":"en"}'::jsonb from public.account_preferences where user_id = '00000000-0000-0000-7e57-0000000016a7') as u5_account,
  (select prefs = '{}'::jsonb from public.user_preferences where user_id = '00000000-0000-0000-7e57-0000000016a7') as u5_ws,
  (select prefs = '{}'::jsonb from public.account_preferences where user_id = '00000000-0000-0000-7e57-0000000016a8') as u6_empty_account,
  (select prefs = '{}'::jsonb from public.user_preferences where user_id = '00000000-0000-0000-7e57-0000000016a8') as u6_ws;
rollback;
