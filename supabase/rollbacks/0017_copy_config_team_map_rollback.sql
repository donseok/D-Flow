-- NNNN_copy_config_team_map 롤백 — copy_project_config 를 *_settings 원문 그대로(0012_settings.sql:666-703 — 첫 줄만 create or replace,
-- ACL 은 그대로 남아 있다). 되돌리지 않는 데이터 없음(함수 하나 — 이미 만든 복사본은 그대로). 롤백 뒤에는 갈라진 원본의 복사가 다시
-- TEAM_SCOPE_PROJECT_OWNED 로 실패한다.
begin;

create or replace function public.copy_project_config(p_src uuid, p_dst uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_src_ws uuid;
  v_dst_ws uuid;
begin
  select p.workspace_id into v_src_ws from public.projects p where p.id = p_src;
  select p.workspace_id into v_dst_ws from public.projects p where p.id = p_dst;
  if v_src_ws is null or v_dst_ws is null or v_src_ws <> v_dst_ws or p_src = p_dst then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  if exists (select 1 from public.project_areas a where a.project_id = p_dst)
     or exists (select 1 from public.teams t where t.project_id = p_dst) then
    raise exception using errcode = '23514', message = 'COPY_TARGET_NOT_EMPTY';
  end if;
  -- 복사는 생성 RPC 안에서만 — 생성 RPC 가 먼저 남긴 복사 이력(revision 1·copy·copied_from = 원본)이 있어야 한다.
  -- 없으면 service_role 의 단독 호출이 기존의 빈 프로젝트에 이력 없이 팀·영역을 덧붙일 수 있다
  if not exists (select 1 from public.project_settings_history h
                  where h.project_id = p_dst and h.revision = 1 and h.source = 'copy' and h.copied_from = p_src) then
    raise exception using errcode = '42501', message = 'COPY_SOURCE_FORBIDDEN';
  end if;
  -- 프로젝트 전용 팀: 코드가 (workspace, project, code) 로 유일하므로 코드로 옛 팀 ↔ 새 팀을 잇는다
  insert into public.teams (code, name, sort_order, active, progress_visible, project_id, workspace_id, color)
  select t.code, t.name, t.sort_order, t.active, t.progress_visible, p_dst, t.workspace_id, t.color
    from public.teams t where t.project_id = p_src;
  -- 영역: (project, kind, code) 로 유일 — 같은 방법
  insert into public.project_areas (project_id, kind, code, name, sort_order, active, meta)
  select p_dst, a.kind, a.code, a.name, a.sort_order, a.active, a.meta
    from public.project_areas a where a.project_id = p_src;
  -- 영역-팀: 프로젝트 전용 팀은 복사된 팀으로, 워크스페이스 공용 팀(project_id null)은 같은 팀으로 잇는다
  insert into public.area_teams (area_id, team_id, kind)
  select na.id, coalesce(nt.id, ot.id), x.kind
    from public.area_teams x
    join public.project_areas oa on oa.id = x.area_id and oa.project_id = p_src
    join public.project_areas na on na.project_id = p_dst and na.kind = oa.kind and na.code = oa.code
    join public.teams ot on ot.id = x.team_id
    left join public.teams nt on nt.project_id = p_dst and nt.code = ot.code and ot.project_id = p_src;
end $$;

commit;
