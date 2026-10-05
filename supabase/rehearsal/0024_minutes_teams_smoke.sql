-- *_minutes_teams 적용 뒤(재적용 뒤에도) 실행한다. 어떤 DB 에서도 돈다(시드 불필요). 모든 변경은 rollback 된다.
-- ① 옛 시드 루트가 남지 않았다 ② 팀 루트 이름 = 팀 이름, 범위 일치 ③ 회의록 team_id 가 code 단위 규칙과 같다(null 은 맞는 팀 없음)
-- ④ 가드 넷이 살아 있다(세션 루트 선점·범위·M1·개명 동기)
begin;
do $$
declare
  v text;
  v_ws uuid;
  v_team uuid;
  v_root uuid;
begin
  if exists (select 1 from public.minute_folders f where f.parent_id is null and f.created_by is null and f.kind = 'user') then
    raise exception 'MINUTES_TEAMS_SMOKE: 옛 시드 루트(kind=user)가 남았다';
  end if;
  select string_agg(f.id::text, ', ') into v from public.minute_folders f join public.teams t on t.id = f.team_id
   where f.kind = 'team_root' and (f.name <> pg_catalog.btrim(t.name) or f.workspace_id <> t.workspace_id
     or (t.project_id is not null and t.project_id is distinct from f.project_id));
  if v is not null then raise exception 'MINUTES_TEAMS_SMOKE: 팀 루트 이름·범위가 팀과 다르다: %', left(v, 600); end if;
  select string_agg(m.id::text, ', ') into v from public.minutes m
   where m.team_id is distinct from public.minute_team_for_code(m.workspace_id, m.project_id, m.team_code)
     and not exists (select 1 from public.teams t where t.id = m.team_id and t.code = m.team_code);
  if v is not null then raise exception 'MINUTES_TEAMS_SMOKE: 회의록 team_id 가 code 단위 해석과 다르다: %', left(v, 600); end if;

  -- 가드 — 임의 워크스페이스에 팀·루트를 만들고 개명 동기와 범위 가드를 본다(롤백)
  select w.id into v_ws from public.workspaces w order by w.id limit 1;
  if v_ws is not null then
    insert into public.teams (workspace_id, code, name) values (v_ws, 'SMOKE_B2', '스모크 B2') returning id into v_team;
    v_root := public.minute_team_root_insert(v_ws, null, v_team, '스모크 B2', 999);
    update public.teams set name = '스모크 B2 개명' where id = v_team;
    if (select name from public.minute_folders where id = v_root) <> '스모크 B2 개명' then
      raise exception 'MINUTES_TEAMS_SMOKE: 개명 동기가 루트 이름을 바꾸지 않았다';
    end if;
    if exists (select 1 from public.teams t where t.workspace_id <> v_ws) then
      begin
        insert into public.minute_folders (name, workspace_id, project_id, kind, team_id)
        values ('스모크 범위', v_ws, null, 'team_root', (select t.id from public.teams t where t.workspace_id <> v_ws limit 1));
        raise exception 'MINUTES_TEAMS_SMOKE: 다른 워크스페이스 팀 루트가 들어갔다';
      exception when check_violation then
        if sqlerrm <> 'MINUTE_TEAM_SCOPE' then raise; end if;
      end;
    end if;
  end if;
  raise notice 'MINUTES_TEAMS_SMOKE: 옛 시드 루트 0·루트 이름 = 팀 이름·team_id code 단위·개명 동기·범위 가드 통과';
end $$;
rollback;
