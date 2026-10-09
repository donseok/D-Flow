-- 0051_team_merge.sql
-- 팀 병합(팀 유연화 2단계 ②) — 한 팀이 가리키던 것을 같은 범위의 다른 팀으로 옮긴다.
-- 왜: 팀을 잘못 나눠 만들었거나 조직이 합쳐졌을 때 손쓸 길이 없었다. 옛 팀을 비활성화하면 담당·명단·회의록이 "목록 밖 팀"으로 남고,
--   하나씩 다시 지정하려면 작업·회의록마다 손으로 고쳐야 했다. 병합은 그 참조를 한 트랜잭션에 옮기고 원본을 비활성으로 남긴다.
-- 무엇:
--   ① team_reference_counts(p_team_id) — 그 팀을 가리키는 것의 건수(읽기 전용, 화면의 "영향 건수 미리보기"). service_role 전용.
--   ② merge_teams(p_actor, p_source_team_id, p_target_team_id) — DEFINER·service_role 전용. RPC 안에서 등급을 다시 판정한다
--      (공용 팀 = 워크스페이스 관리자, 전용 팀 = 프로젝트 관리자).
-- 범위: 같은 워크스페이스, 같은 project_id(둘 다 공용이거나 같은 프로젝트의 전용)만 — 범위가 다르면 TEAM_MERGE_SCOPE_MISMATCH.
--   대상은 활성 팀이어야 한다(비활성 팀으로 합치면 옮긴 것이 화면에서 통째로 사라진다 — TEAM_MERGE_TARGET_INACTIVE).
-- 충돌 규칙(같은 행이 원본·대상을 둘 다 가리킬 때 — 대상 쪽 한 행만 남긴다):
--   · 작업 담당(item_owners)·영역 담당(area_teams): **주관(primary)이 지원(support)을 이긴다** — 둘 중 하나라도 주관이면 남는 행이 주관이다.
--   · 명단의 팀(project_member_teams): 둘 중 하나라도 대표(is_primary)면 남는 행이 대표다(한 사람의 대표 팀은 하나 — 유일 인덱스를 지키려고
--     원본 행을 먼저 지운 뒤 대상 행을 대표로 올린다).
--   · 수락 전 초대(project_invites.team_ids): 원본을 대상으로 바꾸고 중복은 처음 나온 자리 하나만 남긴다. 수락·회수한 초대는 기록이라 그대로 둔다.
--   · 회의록: team_id 를 대상으로 — 메아리 트리거가 team_code 를 대상 code 로 적는다. minute_versions.team_code 는 작성 시점 스냅샷이라 그대로다.
--   · 회의록 팀 루트(minute_folders kind='team_root'): 같은 범위에 대상의 팀 루트가 없으면 원본 루트를 대상의 루트로 바꾼다(id 불변, 이름 = 대상 팀 이름).
--     있으면 원본 루트의 하위 폴더와 루트 바로 아래 회의록을 대상 루트 아래로 옮기고 원본 루트를 지운다. **이름이 겹치는 하위 폴더는 합치지 않는다**
--     — '이름 (원본 팀 이름)' 으로 바꿔 옮긴다(폴더를 합치면 누가 어느 팀 것이었는지 되찾을 수 없다. 60자를 넘으면 앞 이름을 줄인다).
--   · 연동 자격증명(integration_credentials): default_team_id·team_map 의 값이 원본이면 대상으로.
-- 원본 팀은 지우지 않고 비활성으로 남긴다(이 리포의 규칙: 비활성화 = 삭제). code·이름은 그대로라 같은 범위에서 그 code 는 계속 쓰인 것으로 본다.
-- M1 불변식(프로젝트는 자기 전용 팀과 같은 code 의 공용 팀을 가리키지 않는다): 공용 팀 병합이 어떤 프로젝트의 참조를 "그 프로젝트 전용 팀과
--   같은 code 의 공용 팀"으로 옮기게 되면 거절한다(TEAM_MERGE_SCOPE_CONFLICT) — 옮기는 UPDATE 에서 M1 가드가 어차피 막지만 고정 토큰으로 먼저 낸다.
-- 잠금: 전용 팀은 가져오기와 같은 프로젝트 잠금(wbs-import) + 프로젝트 행 FOR UPDATE, 공용 팀은 그 워크스페이스의 프로젝트 행 전부를 id 순으로
--   FOR UPDATE(새 공용 팀 참조를 쓰는 M1 가드의 FOR KEY SHARE 와 직렬화 — 병합 도중 원본을 새로 가리키는 행이 생기지 않게). 그 뒤 두 팀 행을 id 순으로.
-- 되돌리지 않는다 — 병합 뒤에는 어느 참조가 원본 것이었는지 남지 않는다(반환값의 건수만).

begin;

-- ① 영향 건수(읽기 전용). 초대는 수락 전(회수 안 됨)만 — 병합이 옮기는 것과 같은 집합이다
create function public.team_reference_counts(p_team_id uuid) returns jsonb
language sql stable security definer set search_path to '' as $$
  select pg_catalog.jsonb_build_object(
    'item_owners', (select count(*) from public.item_owners io where io.team_id = p_team_id),
    'project_member_teams', (select count(*) from public.project_member_teams pmt where pmt.team_id = p_team_id),
    'area_teams', (select count(*) from public.area_teams art where art.team_id = p_team_id),
    'minutes', (select count(*) from public.minutes m where m.team_id = p_team_id),
    'minute_folders', (select count(*) from public.minute_folders f where f.team_id = p_team_id),
    'invites', (select count(*) from public.project_invites i
                 where i.redeemed_at is null and i.revoked_at is null and p_team_id = any(i.team_ids)),
    'credentials', (select count(*) from public.integration_credentials c
                     where c.default_team_id = p_team_id
                        or exists (select 1 from pg_catalog.jsonb_each_text(c.team_map) e where pg_catalog.lower(e.value) = p_team_id::text)))
$$;
revoke all on function public.team_reference_counts(uuid) from public, anon, authenticated;
grant execute on function public.team_reference_counts(uuid) to service_role;

-- ② 병합 한 길
create function public.merge_teams(p_actor uuid, p_source_team_id uuid, p_target_team_id uuid)
returns jsonb language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_src public.teams%rowtype;
  v_tgt public.teams%rowtype;
  v_ws uuid;
  v_project uuid;
  v_ids uuid[];
  v_owners integer; v_owners_dup integer;
  v_members integer; v_members_dup integer;
  v_areas integer; v_areas_dup integer;
  v_minutes integer;
  v_invites integer;
  v_credentials integer;
  v_roots_repointed integer := 0;
  v_roots_merged integer := 0;
  v_folders_moved integer := 0;
  v_folders_renamed integer := 0;
  v_folder_minutes integer := 0;
  v_root record;
  v_child record;
  v_target_root uuid;
  v_name text;
  v_suffix text;
  v_try integer;
  v_n integer;
begin
  if p_actor is null or p_source_team_id is null or p_target_team_id is null then
    raise exception using errcode = '22023', message = 'TEAM_MERGE_INVALID_INPUT';
  end if;
  if p_source_team_id = p_target_team_id then
    raise exception using errcode = '22023', message = 'TEAM_MERGE_SAME_TEAM';
  end if;
  -- 격리 수준 규칙(H2 ③): 잠금 뒤 참조를 읽어 옮기므로 read committed 가 아니면 거절한다
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'TEAM_MERGE_ISOLATION';
  end if;
  -- 범위는 잠금 없이 먼저 읽는다(프로젝트 → 팀 순으로 잠근다). 팀의 범위(project_id·workspace_id)는 바뀌지 않는다
  select t.workspace_id, t.project_id into v_ws, v_project from public.teams t where t.id = p_source_team_id;
  if not found or not exists (select 1 from public.teams t where t.id = p_target_team_id) then
    raise exception using errcode = 'P0002', message = 'TEAM_NOT_FOUND';
  end if;
  if not exists (select 1 from public.teams t
                  where t.id = p_target_team_id and t.workspace_id = v_ws and t.project_id is not distinct from v_project) then
    raise exception using errcode = '23514', message = 'TEAM_MERGE_SCOPE_MISMATCH';
  end if;
  if v_project is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('wbs-import:' || v_project::text, 0));
    perform 1 from public.projects p where p.id = v_project for update;
  else
    perform 1 from public.projects p where p.workspace_id = v_ws order by p.id for update;
  end if;
  perform 1 from public.teams t where t.id in (p_source_team_id, p_target_team_id) order by t.id for update;
  select t.* into v_src from public.teams t where t.id = p_source_team_id;
  select t.* into v_tgt from public.teams t where t.id = p_target_team_id;
  if v_src.id is null or v_tgt.id is null then
    raise exception using errcode = 'P0002', message = 'TEAM_NOT_FOUND';
  end if;
  -- 등급 재판정(액션 가드와 두 관문)
  if not (case when v_project is null then public.actor_is_workspace_admin(p_actor, v_ws)
               else public.actor_is_project_admin(p_actor, v_project) end) then
    raise exception using errcode = '42501', message = 'TEAM_MERGE_FORBIDDEN';
  end if;
  if not v_tgt.active then
    raise exception using errcode = '23514', message = 'TEAM_MERGE_TARGET_INACTIVE';
  end if;
  -- M1 불변식 — 원본(공용)을 가리키는 프로젝트가 대상과 같은 code 의 전용 팀을 갖고 있으면 옮길 수 없다
  if v_project is null and exists (
       select 1 from public.teams o
        where o.workspace_id = v_ws and o.project_id is not null and o.code = v_tgt.code
          and public.team_referenced_in_project(p_source_team_id, o.project_id)) then
    raise exception using errcode = '23514', message = 'TEAM_MERGE_SCOPE_CONFLICT';
  end if;

  -- 작업 담당 — 주관이 지원을 이긴다. 둘 다 있는 항목은 대상 행만 남긴다
  update public.item_owners t set kind = 'primary'
    from public.item_owners s
   where s.team_id = p_source_team_id and t.team_id = p_target_team_id and t.wbs_item_id = s.wbs_item_id
     and s.kind = 'primary' and t.kind <> 'primary';
  delete from public.item_owners s
   where s.team_id = p_source_team_id
     and exists (select 1 from public.item_owners t where t.wbs_item_id = s.wbs_item_id and t.team_id = p_target_team_id);
  get diagnostics v_owners_dup = row_count;
  update public.item_owners io set team_id = p_target_team_id where io.team_id = p_source_team_id;
  get diagnostics v_owners = row_count;

  -- 명단의 팀 — 대표가 이긴다. 한 사람의 대표 팀은 하나(유일 인덱스)라 원본 행을 먼저 지우고 대상 행을 올린다
  v_ids := array(select s.member_id from public.project_member_teams s
                   join public.project_member_teams t on t.member_id = s.member_id and t.team_id = p_target_team_id
                  where s.team_id = p_source_team_id and s.is_primary and not t.is_primary);
  delete from public.project_member_teams s
   where s.team_id = p_source_team_id
     and exists (select 1 from public.project_member_teams t where t.member_id = s.member_id and t.team_id = p_target_team_id);
  get diagnostics v_members_dup = row_count;
  update public.project_member_teams t set is_primary = true
   where t.team_id = p_target_team_id and t.member_id = any (v_ids);
  update public.project_member_teams pmt set team_id = p_target_team_id where pmt.team_id = p_source_team_id;
  get diagnostics v_members = row_count;

  -- 영역 담당 — 작업 담당과 같은 규칙
  update public.area_teams t set kind = 'primary'
    from public.area_teams s
   where s.team_id = p_source_team_id and t.team_id = p_target_team_id and t.area_id = s.area_id
     and s.kind = 'primary' and t.kind <> 'primary';
  delete from public.area_teams s
   where s.team_id = p_source_team_id
     and exists (select 1 from public.area_teams t where t.area_id = s.area_id and t.team_id = p_target_team_id);
  get diagnostics v_areas_dup = row_count;
  update public.area_teams art set team_id = p_target_team_id where art.team_id = p_source_team_id;
  get diagnostics v_areas = row_count;

  -- 수락 전 초대 — 값 치환 + 중복 제거(처음 나온 자리를 지킨다)
  update public.project_invites i
     set team_ids = array(select m.team_id
                            from (select case when x.team_id = p_source_team_id then p_target_team_id else x.team_id end as team_id,
                                         min(x.ord) as ord
                                    from pg_catalog.unnest(i.team_ids) with ordinality as x(team_id, ord) group by 1) m
                           order by m.ord)
   where i.redeemed_at is null and i.revoked_at is null and p_source_team_id = any (i.team_ids);
  get diagnostics v_invites = row_count;

  -- 회의록 — 메아리 트리거가 team_code 를 대상 code 로 적는다. 버전 스냅샷(minute_versions)은 그대로다
  update public.minutes m set team_id = p_target_team_id where m.team_id = p_source_team_id;
  get diagnostics v_minutes = row_count;

  -- 회의록 팀 루트 — 범위(워크스페이스 루트·프로젝트 루트)마다 따로 본다
  for v_root in
    select f.id, f.project_id from public.minute_folders f
     where f.kind = 'team_root' and f.team_id = p_source_team_id order by f.id
  loop
    select f.id into v_target_root from public.minute_folders f
     where f.kind = 'team_root' and f.team_id = p_target_team_id and f.workspace_id = v_ws
       and f.project_id is not distinct from v_root.project_id;
    if v_target_root is null then
      -- 대상의 루트가 없다 — 원본 루트가 대상의 루트가 된다(폴더 id·하위 구조 그대로, 이름 = 대상 팀 이름)
      begin
        update public.minute_folders f set team_id = p_target_team_id, name = pg_catalog.btrim(v_tgt.name), updated_at = now()
         where f.id = v_root.id;
      exception when unique_violation then
        raise exception using errcode = '23505', message = 'TEAM_ROOT_NAME_CONFLICT';
      end;
      v_roots_repointed := v_roots_repointed + 1;
    else
      for v_child in
        select f.id, f.name from public.minute_folders f where f.parent_id = v_root.id order by f.sort, f.name, f.id
      loop
        v_name := v_child.name;
        v_try := 1;
        -- 이름이 겹치면 합치지 않는다 — '이름 (원본 팀 이름)', 그래도 겹치면 번호를 붙인다
        while exists (select 1 from public.minute_folders x where x.parent_id = v_target_root and x.name = v_name) loop
          v_try := v_try + 1;
          if v_try > 50 then
            raise exception using errcode = '23505', message = 'TEAM_MERGE_FOLDER_CONFLICT';
          end if;
          v_suffix := ' (' || pg_catalog.btrim(v_src.name) || case when v_try > 2 then ' ' || (v_try - 1)::text else '' end || ')';
          v_name := pg_catalog.btrim(pg_catalog.left(v_child.name, greatest(1, 60 - pg_catalog.char_length(v_suffix)))) || v_suffix;
        end loop;
        update public.minute_folders f set parent_id = v_target_root, name = v_name, updated_at = now() where f.id = v_child.id;
        v_folders_moved := v_folders_moved + 1;
        if v_name <> v_child.name then v_folders_renamed := v_folders_renamed + 1; end if;
      end loop;
      update public.minutes m set folder_id = v_target_root where m.folder_id = v_root.id;
      get diagnostics v_n = row_count;
      v_folder_minutes := v_folder_minutes + v_n;
      delete from public.minute_folders f where f.id = v_root.id;
      v_roots_merged := v_roots_merged + 1;
    end if;
  end loop;

  -- 연동 자격증명 — 기본 팀·팀 매핑의 값(팀 id 문자열)
  update public.integration_credentials c
     set default_team_id = case when c.default_team_id = p_source_team_id then p_target_team_id else c.default_team_id end,
         team_map = coalesce((select pg_catalog.jsonb_object_agg(
                                e.key, case when pg_catalog.lower(e.value) = p_source_team_id::text then p_target_team_id::text else e.value end)
                                from pg_catalog.jsonb_each_text(c.team_map) e), '{}'::jsonb)
   where c.workspace_id = v_ws
     and (c.default_team_id = p_source_team_id
          or exists (select 1 from pg_catalog.jsonb_each_text(c.team_map) e where pg_catalog.lower(e.value) = p_source_team_id::text));
  get diagnostics v_credentials = row_count;

  -- 원본은 지우지 않는다 — 비활성화가 삭제다. 이미 비활성이면 그대로다
  update public.teams t set active = false where t.id = p_source_team_id and t.active;

  return pg_catalog.jsonb_build_object(
    'status', 'merged',
    'source', pg_catalog.jsonb_build_object('id', v_src.id, 'code', v_src.code, 'name', v_src.name),
    'target', pg_catalog.jsonb_build_object('id', v_tgt.id, 'code', v_tgt.code, 'name', v_tgt.name),
    'moved', pg_catalog.jsonb_build_object(
      'item_owners', v_owners, 'project_member_teams', v_members, 'area_teams', v_areas, 'minutes', v_minutes,
      'invites', v_invites, 'credentials', v_credentials),
    -- 원본·대상을 둘 다 가리켜 한 행으로 줄인 건수(옮긴 건수에 들지 않는다)
    'deduped', pg_catalog.jsonb_build_object(
      'item_owners', v_owners_dup, 'project_member_teams', v_members_dup, 'area_teams', v_areas_dup),
    'folders', pg_catalog.jsonb_build_object(
      'roots_repointed', v_roots_repointed, 'roots_merged', v_roots_merged, 'moved', v_folders_moved,
      'renamed', v_folders_renamed, 'minutes_moved', v_folder_minutes),
    -- 병합 뒤 원본을 아직 가리키는 것 — 0 이어야 한다(0 이 아니면 병합 도중 새 참조가 생긴 것이다)
    'source_references', public.team_reference_counts(p_source_team_id));
end $$;
revoke all on function public.merge_teams(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.merge_teams(uuid, uuid, uuid) to service_role;

-- 사후검사 TEAM_MERGE_POSTCHECK — 읽기만 한다
do $$
declare
  v text;
begin
  select string_agg(f, ', ') into v from unnest(array[
    'public.merge_teams(uuid, uuid, uuid)', 'public.team_reference_counts(uuid)']) as f
   where has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE');
  if v is not null then raise exception 'TEAM_MERGE_POSTCHECK: 실행권이 어긋났다(세션 불가·service_role 가능이어야 한다): %', v; end if;
  -- 병합이 팀을 가리키는 표를 빠짐없이 옮긴다 — teams 를 참조하는 FK 가 늘면 여기서 멈춰 병합 본문을 같이 고치게 한다
  select string_agg(c.conrelid::regclass::text, ', ') into v
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.teams'::regclass
     and c.conrelid::regclass::text not in ('item_owners', 'project_member_teams', 'area_teams', 'minutes', 'minute_folders', 'integration_credentials',
                                             'public.item_owners', 'public.project_member_teams', 'public.area_teams', 'public.minutes',
                                             'public.minute_folders', 'public.integration_credentials');
  if v is not null then raise exception 'TEAM_MERGE_POSTCHECK: 병합이 옮기지 않는 팀 참조 표가 있다: %', v; end if;
end $$;

commit;
