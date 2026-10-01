-- NNNN_copy_config_team_map — 프로젝트 복사(copy_project_config, *_settings ⑧-1)가 갈라진 원본을 복사할 때 영역 팀을 대상의 같은 code 전용 팀으로
-- 잇는다(SP4 A1 최종 리뷰 보안 P3 — A2 의 이월 수정 Z3). 정본: docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md §3.3(D4·D54). 번호를 참조하지 않는다.
-- 왜: 옛 본문은 영역 팀을 "원본의 전용 팀이면 복사된 팀, 공용 팀이면 같은 공용 팀"으로 이었다. 원본이 갈라진(D4 — 영역은 공용 X 를 가리키는데
--   같은 code 의 전용 X 가 있는) 프로젝트면 복사가 전용 X 를 대상에 만든 뒤 영역 팀을 공용 X 로 넣고, *_command_receipts 의 ⑤′ 트리거가
--   23514 TEAM_SCOPE_PROJECT_OWNED 로 거부해 create_project_with_settings 전체가 되돌아갔다(재시도로 풀리지 않는다).
-- 무엇: 영역 팀의 대응을 code 로 한다 — 대상에 같은 code 의 전용 팀이 있으면 그 팀, 없으면(원본에 그 code 의 전용 팀이 없는 공용 팀) 같은 공용 팀.
--   분열을 복사본으로 옮기지 않는다. 같은 영역의 공용 X·전용 X 링크는 대상에서 한 팀으로 겹치므로 하나만 남긴다(주관 primary 가 이긴다).
--   나머지 본문(원본·대상 검사·복사 이력 확인·팀·영역 복사)은 원문 그대로다. ACL 은 create or replace 가 그대로 둔다.
-- 롤백: supabase/rollbacks/*_copy_config_team_map_rollback.sql(0012 원문). 이 파일은 함수 하나만 바꾼다.

-- ① copy_project_config — 영역 팀을 대상의 같은 code 전용 팀으로
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
  -- 영역-팀: 대상에 같은 code 의 전용 팀이 있으면 그 팀(원본의 전용 팀 + 갈라진 원본이 공용으로 가리키던 같은 code 팀), 없으면 같은 공용 팀.
  -- 한 영역이 같은 code 의 공용·전용 팀을 함께 가리켰으면 대상에서 한 팀이 되므로 하나만 — 주관(primary)을 남긴다
  insert into public.area_teams (area_id, team_id, kind)
  select distinct on (na.id, coalesce(nt.id, ot.id)) na.id, coalesce(nt.id, ot.id), x.kind
    from public.area_teams x
    join public.project_areas oa on oa.id = x.area_id and oa.project_id = p_src
    join public.project_areas na on na.project_id = p_dst and na.kind = oa.kind and na.code = oa.code
    join public.teams ot on ot.id = x.team_id
    left join public.teams nt on nt.project_id = p_dst and nt.code = ot.code
   order by na.id, coalesce(nt.id, ot.id), (x.kind = 'primary') desc;
end $$;

-- ② 사후검사 — COPY_CONFIG_TEAM_MAP_POSTCHECK. 읽기만 한다(롤백 절 없음)
do $$
declare
  v_src text;
begin
  select p.prosrc into v_src from pg_proc p where p.oid = 'public.copy_project_config(uuid, uuid)'::regprocedure;
  if position('and ot.project_id = p_src' in v_src) > 0 or position('distinct on (na.id, coalesce(nt.id, ot.id))' in v_src) = 0 then
    raise exception 'COPY_CONFIG_TEAM_MAP_POSTCHECK: 영역 팀 대응이 code 기준이 아니다';
  end if;
  if not exists (select 1 from pg_proc p where p.oid = 'public.copy_project_config(uuid, uuid)'::regprocedure
                  and p.prosecdef and coalesce('search_path=""' = any (p.proconfig), false)) then
    raise exception 'COPY_CONFIG_TEAM_MAP_POSTCHECK: DEFINER·search_path 가 기대와 다르다';
  end if;
  if has_function_privilege('anon', 'public.copy_project_config(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.copy_project_config(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.copy_project_config(uuid, uuid)', 'EXECUTE') then
    raise exception 'COPY_CONFIG_TEAM_MAP_POSTCHECK: 함수 EXECUTE 가 기대와 다르다';
  end if;
end $$;
