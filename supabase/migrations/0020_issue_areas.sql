-- NNNN_issue_areas — 이슈 영역·채번의 DB 계약(SP5 Phase B1). 이슈 영역을 배포 전역 issue_mega_areas 대신 프로젝트 영역(project_areas
-- kind 'issue_area')으로 옮기고, 이슈 코드를 등록 때 프로젝트 정책(issues.id_policy)으로 매긴다. 스펙:
-- docs/superpowers/specs/2026-10-02-sp5-calendar-issues-minutes-design.md §3.3·D15·D16·D17·D55, 상위 정본
-- docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §4.4.2~§4.4.4·§2.6.2 R2·R6. 계획 P2~P12.
-- 절 순서(실행 순서) ↔ 스펙 §3.3:
--   S1 사전검사 ISSUE_AREAS_PRECHECK(①) · S2 구조 — 새 열·복합 FK·project_areas_guard(insert·update)·upsert_project_area 입력 검사(②, D17)
--   S3 옛 채번 트리거 삭제 · S4 이관 — 영역 → 이슈 → 대분류 → 카운터 → 레거시·ISS 발번 → 설정 기록(⑥, D55·D57)
--   S5 대조 ISSUE_AREAS_RECONCILE(⑦ 앞) · S6 옛 열·인덱스·CHECK·FK·issue_mega_areas·assign_issue_analysis_code 삭제(⑦)
--   S7 채번 함수·트리거(③) · S8 제약(③④) · S9 create_issue_from_minute_block 교체(⑤) · S10 settings_ref_check 의 issues.id_policy 분기
--   S11 사후검사 ISSUE_AREAS_POSTCHECK(⑧). D55 의 "레거시 발번은 채번 트리거를 만들기 전에" 는 S4 < S7 로 지킨다.
-- 되돌릴 수 없는 이관(K1·D48): 모든 기존 이슈에 code 를 매기고(코드 없던 이슈 = 새 발번), 전역 영역을 프로젝트 영역 행으로 복사하고,
--   설정 값(modules.enabled·modules.allowed 편입·issues.analysis·issues.id_policy)과 이력을 기록한다. 롤백은 조건부(모든 issue_area
--   code 가 숫자 2자리)이고 일부만 되돌린다 — supabase/rollbacks/*_issue_areas_rollback.sql 머리 주석. 사용자 DB 의 되돌림 수단은 덤프뿐이다.
-- 이관 리터럴('PI' 정책·"required"·'issue_analysis')은 이 파일에만 있다(런타임 코드 0 — 계획 G1).
-- 권한: 새 함수는 EXECUTE 를 누구에게도 주지 않는다(revoke all … from public, anon, authenticated) — create_issue_from_minute_block 만
--   service_role 에 준다. 트리거 함수·RPC 는 DEFINER·search_path ''(설정 행 FOR SHARE 에 UPDATE 권한이 필요하다), 순수 헬퍼 셋
--   (issue_id_policy_of·render_issue_code·issue_code_year)은 immutable·INVOKER·search_path ''. create or replace 로 다시 쓰는 기존
--   함수(project_areas_guard·upsert_project_area·assign_issue_major_seq·settings_ref_check)는 ACL·보안 속성 그대로.
-- 세션 쓰기(계획 X3·P4): issues 는 세션이 PostgREST 로 쓰는 표다(insert_own_issues·member_update_issues). 새 열(area_id·area_kind·code·
--   code_seq·code_scope·code_area_id)의 범위는 채번 트리거가 정한다 — code 계열은 트리거만 쓰고(ISSUE_CODE_MANAGED·ISSUE_CODE_IMMUTABLE),
--   영역은 그 프로젝트의 활성 issue_area 만, 영역으로 코드가 매겨진 이슈는 영역을 못 바꾼다(ISSUE_AREA_IMMUTABLE).
-- 잠금 순서(K6 — 순환 없음): 이슈 등록 = 설정 행 FOR SHARE → 영역 행 FOR KEY SHARE → 카운터 행(upsert). 회의록 RPC 는 그 앞에 워크스페이스
--   설정 행 → 프로젝트 설정 행 FOR SHARE(설정 RPC 와 같은 순서). 설정 RPC 는 설정 행 FOR UPDATE 만 잡고 영역·카운터를 읽지 않는다.
--   upsert_project_area 는 advisory 'weekly:' → 영역 FOR UPDATE 이고 설정 행을 읽지 않는다.
-- 채번 트리거는 프로젝트 calendar.timezone 을 읽는다({yyyy}·{yy} — 키 없음 = 'UTC', TS DEFAULT_TIMEZONE 과 같다).
-- CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 begin/commit 을 쓰지 않는다. 롤백: supabase/rollbacks/*_issue_areas_rollback.sql.
-- 리허설: supabase/rehearsal/*_issue_areas_seed.sql · *_issue_areas_smoke.sql · *_issue_areas_rollback_guard.sql.

-- S1 사전검사 -----------------------------------------------------------------------------------------------------------
-- 이관이 기대는 옛 불변식을 한 번 더 본다(FK·CHECK 가 막았어야 하는 것 포함 — 트리거를 끄고 넣은 행·손으로 고친 행). 위반이면 목록과
-- 조치를 적고 멈춘다(아무것도 바꾸지 않는다). 이미 기록된 issues.id_policy(롤백 → 재적용 때 남아 있다)는 여기서 보지 않는다 — 검증 함수가
-- S7 에 생기므로 사후검사(S11)가 모든 값을 issue_id_policy_of 로 판정한다.
create temp table sp5_issue_count on commit drop as
select (select pg_catalog.count(*) from public.issues) as n,
       (select pg_catalog.count(*) from public.project_areas a where a.kind = 'issue_area') as areas_before;

do $$
declare
  v text;
  v_bad text := '';
begin
  -- ① mega_code 가 issue_mega_areas 에 없다(FK 가 막았어야 한다) — 세 표
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s:%s', x.t, x.project_id, x.code), ', ' order by x.t, x.project_id, x.code), 600) into v
    from (select 'issues' as t, i.project_id, i.mega_code as code from public.issues i where i.mega_code is not null
          union select 'issue_major_processes', p.project_id, p.mega_code from public.issue_major_processes p
          union select 'issue_number_counters', c.project_id, c.mega_code from public.issue_number_counters c) x
   where not exists (select 1 from public.issue_mega_areas m where m.code = x.code);
  if v is not null then v_bad := v_bad || ' ① 전역 영역에 없는 mega_code(표:프로젝트:code) ' || v || ' — 그 행의 mega_code 를 고친다;'; end if;

  -- ② (프로젝트, pi_issue_code) 중복
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s', d.project_id, d.pi_issue_code), ', ' order by d.project_id, d.pi_issue_code), 600) into v
    from (select i.project_id, i.pi_issue_code from public.issues i where i.pi_issue_code is not null
           group by i.project_id, i.pi_issue_code having pg_catalog.count(*) > 1) d;
  if v is not null then v_bad := v_bad || ' ② 같은 프로젝트의 중복 PI 코드 ' || v || ' — 한쪽 이슈를 정리한다;'; end if;

  -- ③ 범위(프로젝트, mega)마다 카운터 last_no >= max(mega_seq) — 카운터 행이 없는 것도 위반(이관 뒤 그 영역의 다음 번호가 1 로 되돌아간다)
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s(max %s, last_no %s)', s.project_id, s.mega_code, s.max_seq,
                                                                  coalesce(c.last_no::text, '없음')), ', ' order by s.project_id, s.mega_code), 600) into v
    from (select i.project_id, i.mega_code, pg_catalog.max(i.mega_seq) as max_seq from public.issues i
           where i.mega_code is not null group by i.project_id, i.mega_code) s
    left join public.issue_number_counters c on c.project_id = s.project_id and c.mega_code = s.mega_code
   where c.last_no is null or c.last_no < s.max_seq;
  if v is not null then v_bad := v_bad || ' ③ 카운터가 기존 번호보다 작거나 없다 ' || v || ' — 카운터를 max(mega_seq) 이상으로 올린다;'; end if;

  -- ④ 이미 있는 issue_area 의 code 가 새 규칙(D17 — 영문 대문자·숫자 1~8자) 밖 — 이슈 코드 {area} 에 들어간다
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s', a.project_id, a.code), ', ' order by a.project_id, a.code), 600) into v
    from public.project_areas a where a.kind = 'issue_area' and a.code !~ '^[A-Z0-9]{1,8}$';
  if v is not null then v_bad := v_bad || ' ④ 규칙 밖 이슈 영역 code ' || v || ' — 그 영역을 지우거나(이슈가 없을 때) code 를 바꾼 새 영역으로 옮긴다;'; end if;

  -- ⑤ 모듈 목록이 배열이 아니다(없음 포함 — 0012 이후 모든 행이 명시한다. 없거나 손상이면 편입할 수 없다)
  select pg_catalog.left(pg_catalog.string_agg(s.project_id::text, ', ' order by s.project_id), 600) into v
    from public.project_settings s where pg_catalog.jsonb_typeof(s."values" -> 'modules.enabled') is distinct from 'array';
  if v is not null then v_bad := v_bad || ' ⑤ modules.enabled 가 배열이 아닌 프로젝트 설정 ' || v || ' — 설정 화면(또는 settings:verify)으로 고친다;'; end if;
  select pg_catalog.left(pg_catalog.string_agg(s.workspace_id::text, ', ' order by s.workspace_id), 600) into v
    from public.workspace_settings s where pg_catalog.jsonb_typeof(s."values" -> 'modules.allowed') is distinct from 'array';
  if v is not null then v_bad := v_bad || ' ⑤ modules.allowed 가 배열이 아닌 워크스페이스 설정 ' || v || ' — 설정 화면(또는 settings:verify)으로 고친다;'; end if;

  -- ⑥ 미분류인데 대분류가 있는 이슈(기준선 CHECK issues_major_requires_mega_check 가 막았어야 한다)
  select pg_catalog.left(pg_catalog.string_agg(i.id::text, ', ' order by i.id), 600) into v
    from public.issues i where i.mega_code is null and i.major_id is not null;
  if v is not null then v_bad := v_bad || ' ⑥ 영역 없이 대분류가 있는 이슈 ' || v || ' — major_id 를 비우거나 영역을 매긴다;'; end if;

  if v_bad <> '' then
    raise exception using errcode = '23514', message = pg_catalog.format('ISSUE_AREAS_PRECHECK:%s', v_bad);
  end if;
end $$;

-- S2 구조 ---------------------------------------------------------------------------------------------------------------
-- 새 열은 nullable 로 붙이고(이관이 채운다) S6·S8 이 NOT NULL·CHECK 를 건다. area_kind 는 복합 FK 의 상수 열(영역 표의 kind 와 맞춘다).
alter table public.issues
  add column area_id uuid, add column area_kind text not null default 'issue_area' check (area_kind = 'issue_area'),
  add column code text, add column code_seq bigint, add column code_scope text, add column code_area_id uuid;
alter table public.issue_major_processes
  add column area_id uuid, add column area_kind text not null default 'issue_area' check (area_kind = 'issue_area');
alter table public.issue_number_counters add column scope_key text;
-- 복합 FK 는 NO ACTION(계획 P3 — 프로젝트 삭제 cascade 가 영역과 이슈를 한 문장에서 지운다. RESTRICT 는 즉시 검사라 순서에 따라 거부된다).
-- issues → project_areas 의 FK 는 area_id 하나다(개정 §4.4.3 의 열 정의). code_area_id 는 FK 대신 S8 의 CHECK(null 이거나 area_id 와 같다)로
-- 묶는다 — 같은 표 쌍에 FK 가 둘이면 PostgREST 임베드가 PGRST201 로 실패한다(tests/rls/schema-invariants.test.ts 의 쌍 불변식).
alter table public.issues
  add constraint issues_area_fk foreign key (area_id, project_id, area_kind) references public.project_areas (id, project_id, kind);
alter table public.issue_major_processes
  add constraint issue_major_processes_area_fk foreign key (area_id, project_id, area_kind) references public.project_areas (id, project_id, kind);
create index issues_project_area_idx on public.issues (project_id, area_id);

-- project_areas_guard — 바탕은 *_weekly_areas 의 본문(SP4 D12 승계: kind·project_id 불변). insert 분기와 issue_area code 규칙을 더하고
-- 트리거를 insert·update 로 다시 만든다(계획 X10 — 이전 트리거는 update 만 봤다). S4 의 영역 insert 도 이 트리거를 지난다(전역 영역 code
-- '00'~'07' 은 규칙 안 — 기존 행은 S1 ④ 가 본다).
create or replace function public.project_areas_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  -- SP5 B1(D17): 이슈 영역 code 는 이슈 코드 {area} 에 들어간다 — 영문 대문자·숫자 1~8자. 만들 때도 판정한다(이전 본문은 update 만 봤다)
  if new.kind = 'issue_area' and new.code !~ '^[A-Z0-9]{1,8}$' then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_INVALID';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;
  if new.code is distinct from old.code then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_IMMUTABLE';
  end if;
  if new.kind is distinct from old.kind then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_KIND_IMMUTABLE';
  end if;
  if new.project_id is distinct from old.project_id then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_PROJECT_IMMUTABLE';
  end if;
  return new;
end
$$;
drop trigger project_areas_guard on public.project_areas;
create trigger project_areas_guard before insert or update on public.project_areas
  for each row execute function public.project_areas_guard();

-- upsert_project_area — *_weekly_areas 본문 그대로(시그니처·lock_timeout·등급 판정·잠금·격리 가드 — SP4 D12 승계) + 1. 의 끝에 issue_area
-- code 규칙 한 덩어리(D17). create or replace 라 ACL(service_role 만)은 그대로다.
create or replace function public.upsert_project_area(p_actor uuid, p_project_id uuid, p_area jsonb, p_teams jsonb, p_from_week date) returns jsonb
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  -- code·name 은 이 집합(JS trim())의 앞뒤 공백이 없어야 한다 — 롤백·재적용 왕복에서 code 가 이관 라벨과 같게(①′)
  v_space constant text := E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_kind text;
  v_code text;
  v_name text;
  v_id uuid;
  v_area uuid;
  v_old_kind text;
  v_old_code text;
  v_status text;
  v_added int := 0;
begin
  -- 1. null·모양(잠금보다 먼저)
  if p_actor is null or p_project_id is null or p_area is null or pg_catalog.jsonb_typeof(p_area) <> 'object'
     or p_teams is null or pg_catalog.jsonb_typeof(p_teams) <> 'array' then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  v_kind := p_area ->> 'kind';
  v_code := p_area ->> 'code';
  v_name := p_area ->> 'name';
  if coalesce(
       v_kind is null or v_kind not in ('weekly_section', 'issue_area')
       or pg_catalog.jsonb_typeof(p_area -> 'code') is distinct from 'string'
       or pg_catalog.jsonb_typeof(p_area -> 'name') is distinct from 'string'
       or v_code = '' or v_code <> pg_catalog.btrim(v_code, v_space)
       or v_name = '' or v_name <> pg_catalog.btrim(v_name, v_space)
       or pg_catalog.jsonb_typeof(p_area -> 'sort_order') is distinct from 'number'
       or (p_area ->> 'sort_order') !~ '^-?[0-9]{1,9}$'
       or pg_catalog.jsonb_typeof(p_area -> 'active') is distinct from 'boolean'
       or coalesce(pg_catalog.jsonb_typeof(p_area -> 'id'), 'null') not in ('string', 'null')
       or (coalesce(pg_catalog.jsonb_typeof(p_area -> 'id'), 'null') = 'string' and (p_area ->> 'id') !~* v_uuid)
       or (v_kind = 'weekly_section' and p_from_week is null), true) then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_teams) as t(e)
              where pg_catalog.jsonb_typeof(t.e) <> 'object'
                 or pg_catalog.jsonb_typeof(t.e -> 'team_id') is distinct from 'string'
                 or (t.e ->> 'team_id') !~* v_uuid
                 or pg_catalog.jsonb_typeof(t.e -> 'kind') is distinct from 'string'
                 or (t.e ->> 'kind') not in ('primary', 'support')) then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  if (select pg_catalog.count(*) <> pg_catalog.count(distinct (t.e ->> 'team_id')::uuid)
        from pg_catalog.jsonb_array_elements(p_teams) as t(e)) then
    raise exception using errcode = '22023', message = 'AREA_INVALID_INPUT';
  end if;
  -- SP5 B1(D17): 이슈 영역 code 규칙 — 트리거(project_areas_guard)와 같은 식. 입력 단계 문구를 따로 둔다(액션이 매핑)
  if v_kind = 'issue_area' and v_code !~ '^[A-Z0-9]{1,8}$' then
    raise exception using errcode = '22023', message = 'AREA_CODE_INVALID';
  end if;
  v_id := case when pg_catalog.jsonb_typeof(p_area -> 'id') = 'string' then (p_area ->> 'id')::uuid end;
  -- 2. 잠금(문서 생성과 같은 키) → 격리 가드
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('weekly:' || p_project_id, 0));
  -- 격리 수준 규칙(H2 규칙 ③): 잠금 뒤 영역·문서를 읽어 판정·백필하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 새 문서 — 스냅샷이 고정된 수준에서는 아래 6 이 그 문서를 못 봐 이 영역의 행이 빠진다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WEEKLY_ISOLATION';
  end if;
  -- 3. 등급 → 프로젝트
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'AREA_FORBIDDEN';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  -- 4. 고치기는 그 프로젝트의 영역만(다른 프로젝트의 영역 id 도 여기서 끝나고 아무것도 바꾸지 않는다), id 가 없으면 만들기
  if v_id is not null then
    select a.id, a.kind, a.code into v_area, v_old_kind, v_old_code
      from public.project_areas a where a.id = v_id and a.project_id = p_project_id for update;
    if v_area is null then
      raise exception using errcode = 'P0002', message = 'AREA_NOT_FOUND';
    end if;
    if v_old_kind is distinct from v_kind then
      raise exception using errcode = '23514', message = 'PROJECT_AREA_KIND_IMMUTABLE';
    end if;
    if v_old_code is distinct from v_code then
      raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_IMMUTABLE';
    end if;
    update public.project_areas
       set name = v_name, sort_order = (p_area ->> 'sort_order')::int, active = (p_area ->> 'active')::boolean
     where id = v_area and project_id = p_project_id;
    v_status := 'updated';
  else
    insert into public.project_areas (project_id, kind, code, name, sort_order, active)
    values (p_project_id, v_kind, v_code, v_name, (p_area ->> 'sort_order')::int, (p_area ->> 'active')::boolean)
    returning id into v_area;
    v_status := 'created';
  end if;
  -- 5. 영역-팀을 목록으로 — v_area 의 행만(범위 위반은 area_teams_guard 의 23514 AREA_TEAM_SCOPE). 한 트랜잭션이라 지금 액션의 두 문장 비원자가 사라진다
  delete from public.area_teams x
   where x.area_id = v_area
     and x.team_id not in (select (t.e ->> 'team_id')::uuid from pg_catalog.jsonb_array_elements(p_teams) as t(e));
  insert into public.area_teams (area_id, team_id, kind)
  select v_area, (t.e ->> 'team_id')::uuid, t.e ->> 'kind' from pg_catalog.jsonb_array_elements(p_teams) as t(e)
  on conflict (area_id, team_id) do update set kind = excluded.kind;
  -- 6. 활성 주간 영역 — p_from_week 이후 문서에 빈 행(과거 주차는 그대로 — W17)
  if v_kind = 'weekly_section' and (p_area ->> 'active')::boolean then
    insert into public.weekly_report_rows (report_id, project_id, area_id)
    select r.id, r.project_id, v_area from public.weekly_reports r
     where r.project_id = p_project_id and r.week_start >= p_from_week
    on conflict (report_id, area_id) do nothing;
    get diagnostics v_added = row_count;
  end if;
  -- 7. 결과
  return pg_catalog.jsonb_build_object('status', v_status, 'area_id', v_area, 'rows_added', v_added);
end
$$;

-- S3 옛 채번 트리거 삭제 --------------------------------------------------------------------------------------------------
-- 옛 트리거가 S4 의 백필 update 를 판정하지 않게 먼저 지운다(코드 불변 판정이 백필을 막는다). 함수 삭제는 S6.
drop trigger trg_assign_issue_analysis_code on public.issues;

-- S4 이관 ---------------------------------------------------------------------------------------------------------------
-- ① 영역: 프로젝트마다 쓰인 전역 영역 code(이슈·대분류·카운터의 합집합)로 issue_area 행을 만든다 — 이름·활성은 전역 영역에서, 정렬은 그
--    프로젝트 안 code 순서. 같은 (프로젝트, issue_area, code) 행이 이미 있으면 그 행을 쓴다(이름·정렬·활성 유지 — do nothing 뒤 재조회).
with used as (
  select i.project_id, i.mega_code as code from public.issues i where i.mega_code is not null
  union select p.project_id, p.mega_code from public.issue_major_processes p
  union select c.project_id, c.mega_code from public.issue_number_counters c
), ranked as (
  select u.project_id, u.code, m.name, m.active,
         pg_catalog.row_number() over (partition by u.project_id order by u.code) as rn
    from used u join public.issue_mega_areas m on m.code = u.code
)
insert into public.project_areas (project_id, kind, code, name, sort_order, active)
select r.project_id, 'issue_area', r.code, r.name, r.rn, r.active from ranked r
on conflict (project_id, kind, code) do nothing;
create temp table sp5_area_map on commit drop as
select a.project_id, a.code, a.id as area_id from public.project_areas a where a.kind = 'issue_area';

-- ② 이슈 — 분류 이슈는 영역 코드를 그대로 code 로(현 PI 코드 = 영역별 템플릿 PI-I-{area}-{seq:2} 의 렌더 — 같은 영역 카운터 범위 a:<영역>)
update public.issues i
   set area_id = m.area_id, code_area_id = m.area_id, code = i.pi_issue_code, code_seq = i.mega_seq,
       code_scope = 'a:' || m.area_id
  from sp5_area_map m
 where m.project_id = i.project_id and m.code = i.mega_code;
--    PI 프로젝트(분류 이슈가 하나라도 있는 프로젝트)의 미분류 이슈 → 이관 전용 레거시 코드 PI-U-NNN(범위 'legacy' — 채번 트리거는 이 범위를
--    만들지 않는다). (created_at, issue_no) 순, 1000 이상은 자르지 않는다. 영역은 없다(나중 분류 자유 — D55 ②)
with pi as (select distinct i.project_id from public.issues i where i.pi_issue_code is not null),
seqd as (
  select i.id, pg_catalog.row_number() over (partition by i.project_id order by i.created_at, i.issue_no) as n
    from public.issues i join pi on pi.project_id = i.project_id where i.mega_code is null
)
update public.issues i
   set code = 'PI-U-' || pg_catalog.lpad(s.n::text, greatest(3, pg_catalog.length(s.n::text)), '0'),
       code_seq = s.n, code_scope = 'legacy'
  from seqd s where s.id = i.id;
--    그 밖 프로젝트의 이슈 → 제품 기본 정책의 렌더 ISS-NNN(범위 '' — 프로젝트 하나, 이관 뒤 트리거가 이 카운터를 잇는다)
with pi as (select distinct i.project_id from public.issues i where i.pi_issue_code is not null),
seqd as (
  select i.id, pg_catalog.row_number() over (partition by i.project_id order by i.created_at, i.issue_no) as n
    from public.issues i where i.project_id not in (select pi.project_id from pi)
)
update public.issues i
   set code = 'ISS-' || pg_catalog.lpad(s.n::text, greatest(3, pg_catalog.length(s.n::text)), '0'),
       code_seq = s.n, code_scope = ''
  from seqd s where s.id = i.id;

-- ③ 대분류 — 같은 영역 매핑
update public.issue_major_processes p set area_id = m.area_id
  from sp5_area_map m where m.project_id = p.project_id and m.code = p.mega_code;

-- ④ 카운터 — 기존 행(프로젝트, mega)은 범위 a:<영역> 으로 다시 키를 달고, 키를 (project_id, scope_key) 로 바꾼 뒤 레거시·ISS 범위 행을
--    그 범위의 발번 수로 넣는다(0건이면 행 없음). mega_code 열 자체는 S6 이 지운다
update public.issue_number_counters c set scope_key = 'a:' || m.area_id
  from sp5_area_map m where m.project_id = c.project_id and m.code = c.mega_code;
alter table public.issue_number_counters
  drop constraint issue_number_counters_pkey,
  drop constraint issue_number_counters_mega_code_fkey,
  alter column mega_code drop not null,
  alter column scope_key set not null,
  add constraint issue_number_counters_pkey primary key (project_id, scope_key);
insert into public.issue_number_counters (project_id, scope_key, last_no)
select i.project_id, i.code_scope, pg_catalog.max(i.code_seq) from public.issues i
 where i.code_scope in ('legacy', '') group by i.project_id, i.code_scope;

-- ⑤ 설정(D57 — 0012 ⑤·*_calendar ⑨⑩ 의 기록 꼴): RPC 를 거치지 않고 직접 쓴다 — 범위 행마다 바뀐 키가 있을 때만 revision + 1·
--    updated_at = now()·updated_by = null, schema_version 은 건드리지 않는다, 이력은 바뀐 키마다(old_value = 이전 값(없으면 null),
--    source = 'migration', command_id = 범위 행마다 gen_random_uuid(), changed_by null). 세 키를 한 revision 으로 묶는다.
--    프로젝트: modules.enabled 에 'issue_analysis' 편입(R6 — 이미 있으면 그대로), issues.analysis = "required"(R2 — 현행 동작: 분석 분류가
--    있으면 메타 필수. 키가 있으면 그대로), PI 프로젝트에 issues.id_policy = 현 동작 재현 템플릿(키가 있으면 그대로 — 롤백 뒤 재적용).
--    워크스페이스: modules.allowed 에 'issue_analysis' 편입(R6). issues 모듈이 꺼진·허용 안 된 행에도 편입한다(스펙 ⑧ "전부" — 앱은
--    requires 닫힘으로 issue_analysis 를 뺀다).
with pi as (select distinct i.project_id from public.issues i where i.code_scope like 'a:%'),
proj_new as (
  select s.project_id, s."values" as v0,
         s."values"
         || case when (s."values" -> 'modules.enabled') @> '["issue_analysis"]'::jsonb then '{}'::jsonb
                 else pg_catalog.jsonb_build_object('modules.enabled', (s."values" -> 'modules.enabled') || '["issue_analysis"]'::jsonb) end
         || case when s."values" ? 'issues.analysis' then '{}'::jsonb
                 else '{"issues.analysis": "required"}'::jsonb end
         || case when s."values" ? 'issues.id_policy' or s.project_id not in (select pi.project_id from pi) then '{}'::jsonb
                 else '{"issues.id_policy": {"prefix": "PI", "pattern": "{prefix}-I-{area}-{seq:2}", "counter_scope": "area", "reset": "never"}}'::jsonb end
           as v1
    from public.project_settings s
), upd as (
  update public.project_settings s
     set "values" = n.v1, revision = s.revision + 1, updated_at = pg_catalog.now(), updated_by = null
    from proj_new n
   where s.project_id = n.project_id and n.v1 <> n.v0
  returning s.project_id, s.revision as new_rev
), cmd as (
  select u.project_id, u.new_rev, pg_catalog.gen_random_uuid() as command_id from upd u
)
insert into public.project_settings_history (project_id, revision, key, old_value, new_value, source, command_id, changed_by)
select c.project_id, c.new_rev, e.key, n.v0 -> e.key, e.value, 'migration', c.command_id, null
  from cmd c
  join proj_new n on n.project_id = c.project_id
 cross join lateral pg_catalog.jsonb_each(n.v1) as e(key, value)
 where (n.v0 -> e.key) is distinct from e.value;

with ws_new as (
  select s.workspace_id, s."values" as v0,
         s."values" || pg_catalog.jsonb_build_object('modules.allowed', (s."values" -> 'modules.allowed') || '["issue_analysis"]'::jsonb) as v1
    from public.workspace_settings s
   where not ((s."values" -> 'modules.allowed') @> '["issue_analysis"]'::jsonb)
), upd as (
  update public.workspace_settings s
     set "values" = n.v1, revision = s.revision + 1, updated_at = pg_catalog.now(), updated_by = null
    from ws_new n
   where s.workspace_id = n.workspace_id
  returning s.workspace_id, s.revision as new_rev
), cmd as (
  select u.workspace_id, u.new_rev, pg_catalog.gen_random_uuid() as command_id from upd u
)
insert into public.workspace_settings_history (workspace_id, revision, key, old_value, new_value, source, command_id, changed_by)
select c.workspace_id, c.new_rev, 'modules.allowed', n.v0 -> 'modules.allowed', n.v1 -> 'modules.allowed', 'migration', c.command_id, null
  from cmd c join ws_new n on n.workspace_id = c.workspace_id;

-- S5 대조 ---------------------------------------------------------------------------------------------------------------
-- 이관 전후 수를 맞대고 어긋나면 멈춘다(트랜잭션째 되돌아간다). 기존 영역 범위(a:)는 지운 이슈 때문에 last_no > max 가 정상이다(계획 X7 —
-- 카운터는 줄지 않는다), 이관이 새로 만든 범위(legacy·'')는 last_no = max = 건수.
do $$
declare
  v text;
  v_bad text := '';
  r record;
begin
  if (select pg_catalog.count(*) from public.issues) <> (select n from sp5_issue_count) then
    v_bad := v_bad || ' ① 이슈 수가 바뀌었다;';
  end if;
  select pg_catalog.left(pg_catalog.string_agg(i.id::text, ', ' order by i.id), 600) into v
    from public.issues i where i.code is null or i.code_seq is null or i.code_scope is null;
  if v is not null then v_bad := v_bad || ' ② 코드가 없는 이슈 ' || v || ';'; end if;
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s', s.project_id, s.code_scope), ', ' order by s.project_id, s.code_scope), 600) into v
    from (select i.project_id, i.code_scope, pg_catalog.max(i.code_seq) as mx, pg_catalog.count(*) as n
            from public.issues i group by i.project_id, i.code_scope) s
    left join public.issue_number_counters c on c.project_id = s.project_id and c.scope_key = s.code_scope
   where c.last_no is null
      or (s.code_scope like 'a:%' and c.last_no < s.mx)
      or (s.code_scope in ('legacy', '') and not (c.last_no = s.mx and s.mx = s.n));
  if v is not null then v_bad := v_bad || ' ③④ 범위 카운터가 발번과 어긋난다(프로젝트:범위) ' || v || ';'; end if;
  select pg_catalog.left(pg_catalog.string_agg(i.id::text, ', ' order by i.id), 600) into v
    from public.issues i where i.code_scope = 'legacy' and i.code ~ '^PI-I-';
  if v is not null then v_bad := v_bad || ' ⑤ 레거시 코드가 PI 템플릿과 겹친다 ' || v || ';'; end if;
  select pg_catalog.left(pg_catalog.string_agg(i.id::text, ', ' order by i.id), 600) into v
    from public.issues i where i.mega_code is not null and i.area_id is null;
  if v is not null then v_bad := v_bad || ' ⑥ 영역을 잃은 분류 이슈 ' || v || ';'; end if;
  select pg_catalog.left(pg_catalog.string_agg(p.id::text, ', ' order by p.id), 600) into v
    from public.issue_major_processes p where p.area_id is null;
  if v is not null then v_bad := v_bad || ' ⑥ 영역을 잃은 대분류 ' || v || ';'; end if;
  select pg_catalog.left(pg_catalog.string_agg(pg_catalog.format('%s:%s', c.project_id, c.mega_code), ', ' order by c.project_id, c.mega_code), 600) into v
    from public.issue_number_counters c where c.scope_key is null;
  if v is not null then v_bad := v_bad || ' ⑥ 범위를 잃은 카운터 ' || v || ';'; end if;
  if v_bad <> '' then
    raise exception using errcode = '23514', message = pg_catalog.format('ISSUE_AREAS_RECONCILE:%s', v_bad);
  end if;
  select (select pg_catalog.count(*) from public.project_areas a where a.kind = 'issue_area') - (select areas_before from sp5_issue_count) as areas,
         (select pg_catalog.count(*) from public.issues i where i.code_scope like 'a:%') as classified,
         (select pg_catalog.count(*) from public.issues i where i.code_scope = 'legacy') as legacy,
         (select pg_catalog.count(*) from public.issues i where i.code_scope = '') as iss,
         (select pg_catalog.count(distinct h.project_id) from public.project_settings_history h
           where h.source = 'migration' and h.changed_at = pg_catalog.now()
             and h.key in ('modules.enabled', 'issues.analysis', 'issues.id_policy')) as proj,
         (select pg_catalog.count(distinct h.workspace_id) from public.workspace_settings_history h
           where h.source = 'migration' and h.changed_at = pg_catalog.now() and h.key = 'modules.allowed') as ws
    into r;
  raise notice 'ISSUE_AREAS: 영역 % · 분류 % · 레거시 % · ISS % · 프로젝트 설정 % · 워크스페이스 설정 %',
    r.areas, r.classified, r.legacy, r.iss, r.proj, r.ws;
end $$;

-- S6 옛 객체 삭제 ---------------------------------------------------------------------------------------------------------
-- 의존 순서대로(FK → 키 → 열 → 함수 → 표). 대분류의 식별 키는 (id, project_id, area_id) 로 바꾸고 이슈의 대분류 FK 를 그 키로 다시 건다
-- (NO ACTION — 계획 P3). issues_analysis_metadata_check 는 mega_code 를 참조해 지우고 S8 이 새 식(기준 major_id)으로 다시 건다.
alter table public.issues
  drop constraint issues_major_process_fk,
  drop constraint issues_mega_area_fk,
  drop constraint issues_analysis_code_consistency_check,
  drop constraint issues_major_requires_mega_check,
  drop constraint issues_analysis_metadata_check;
drop index public.issues_project_mega_seq_uidx;
drop index public.issues_project_pi_code_uidx;
drop index public.issues_project_mega_idx;
alter table public.issue_major_processes
  drop constraint issue_major_processes_identity_key,
  drop constraint issue_major_processes_project_mega_name_key,
  drop constraint issue_major_processes_project_mega_seq_key,
  drop constraint issue_major_processes_mega_code_fkey;
drop index public.issue_major_processes_project_idx;
alter table public.issue_major_processes
  alter column area_id set not null,
  add constraint issue_major_processes_identity_key unique (id, project_id, area_id),
  add constraint issue_major_processes_project_area_name_key unique (project_id, area_id, name),
  add constraint issue_major_processes_project_area_seq_key unique (project_id, area_id, major_seq);
create index issue_major_processes_project_idx on public.issue_major_processes (project_id, area_id, major_seq);
alter table public.issues
  add constraint issues_major_process_fk foreign key (major_id, project_id, area_id)
    references public.issue_major_processes (id, project_id, area_id);
alter table public.issues drop column mega_code, drop column mega_seq, drop column pi_issue_code;
alter table public.issue_major_processes drop column mega_code;
alter table public.issue_number_counters drop column mega_code;
drop function public.assign_issue_analysis_code();
drop table public.issue_mega_areas;   -- 정책 read_all_issue_mega_areas·ACL 이 같이 사라진다

-- S7 채번 --------------------------------------------------------------------------------------------------------------
-- 정책 검증·렌더는 TS src/lib/issues/idPolicy.ts 와 같은 규칙(개정 §4.4.3 — 골든 표 tests/fixtures/issue-id-policy-cases.ts 를 두 쪽이 돈다:
-- tests/issues/id-policy·tests/rls/issue-code-policy). 한쪽만 고치지 않는다.
-- render_issue_code: 토큰 치환. 자리 규칙 {seq:n} = lpad(seq, greatest(n, 자릿수)) — lpad 는 목표보다 긴 문자열을 자르므로 greatest 가 절단
--   금지의 핵심이다(0010 의 교훈). {yyyy} = 4자리, {yy} = 끝 두 자리. 영역·연도가 필요한데 없으면 거부(트리거는 늘 넘긴다 — 내부 불변식).
create function public.render_issue_code(p_policy jsonb, p_area_code text, p_year int, p_seq bigint) returns text
language plpgsql immutable set search_path to '' as $$
declare
  v_pattern text := p_policy ->> 'pattern';
  v_n int := pg_catalog.substring(v_pattern, '\{seq:([2-6])\}')::int;
  v_s text := p_seq::text;
  v_y int := coalesce(p_year, 0);
begin
  if pg_catalog.strpos(v_pattern, '{area}') > 0 and coalesce(p_area_code, '') = '' then
    raise exception using errcode = '23514', message = 'ISSUE_AREA_REQUIRED';
  end if;
  if (pg_catalog.strpos(v_pattern, '{yyyy}') > 0 or pg_catalog.strpos(v_pattern, '{yy}') > 0) and p_year is null then
    raise exception using errcode = '22023', message = 'ISSUE_YEAR_REQUIRED';
  end if;
  return pg_catalog.regexp_replace(
    pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_pattern,
      '{prefix}', p_policy ->> 'prefix'), '{area}', coalesce(p_area_code, '')),
      '{yyyy}', pg_catalog.lpad(v_y::text, 4, '0')), '{yy}', pg_catalog.lpad((v_y % 100)::text, 2, '0')),
    '\{seq:[2-6]\}', pg_catalog.lpad(v_s, greatest(v_n, pg_catalog.length(v_s)), '0'));
end $$;

-- issue_id_policy_of: 설정 문서(values 객체)에서 issues.id_policy 를 꺼내 검증한다. 키 없음(SQL NULL) = 제품 기본값(TS DEFAULT_ID_POLICY),
--   손상(JSON null·객체 아님 포함) = 22023 CONFIG_INVALID:issues.id_policy(기본값으로 풀지 않는다 — fail-closed). 토큰은 **한 번에**(단일 정규식)
--   지운다 — 순차 치환은 앞 토큰을 지운 자리에서 중첩 토큰({{prefix}yy} 등)이 새로 생겨 리터럴 규칙을 우회한다(B1-1 리뷰 P1-1).
--   {seq:n} 개수·{area}·{yyyy}/{yy} 판정은 원본 패턴을 본다. 판정을 단계로 나눠 jsonb_object_keys 가 객체 아닌 값에 닿지 않게 한다.
create function public.issue_id_policy_of(p_values jsonb) returns jsonb
language plpgsql immutable set search_path to '' as $$
declare
  v jsonb := p_values -> 'issues.id_policy';
  v_pattern text;
  v_n int;
begin
  if v is null then
    return '{"prefix": "ISS", "pattern": "{prefix}-{seq:3}", "counter_scope": "project", "reset": "never"}'::jsonb;
  end if;
  if pg_catalog.jsonb_typeof(v) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:issues.id_policy';
  end if;
  if (select pg_catalog.array_agg(k.k order by k.k collate "C") from pg_catalog.jsonb_object_keys(v) as k(k))
       is distinct from array['counter_scope', 'pattern', 'prefix', 'reset']
     or pg_catalog.jsonb_typeof(v -> 'prefix') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v -> 'pattern') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v -> 'counter_scope') is distinct from 'string'
     or pg_catalog.jsonb_typeof(v -> 'reset') is distinct from 'string' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:issues.id_policy';
  end if;
  v_pattern := v ->> 'pattern';
  if (v ->> 'prefix') !~ '^[A-Z0-9-]{0,8}$' or v_pattern = ''
     or (v ->> 'counter_scope') not in ('project', 'area') or (v ->> 'reset') not in ('never', 'yearly')
     or (select pg_catalog.count(*) from pg_catalog.regexp_matches(v_pattern, '\{seq:[2-6]\}', 'g')) <> 1
     or pg_catalog.regexp_replace(v_pattern, '\{(prefix|area|yyyy|yy|seq:[2-6])\}', '', 'g') !~ '^[A-Za-z0-9._#/-]*$'
     or ((v ->> 'counter_scope') = 'area' and pg_catalog.strpos(v_pattern, '{area}') = 0)
     or ((v ->> 'reset') = 'yearly' and pg_catalog.strpos(v_pattern, '{yyyy}') = 0 and pg_catalog.strpos(v_pattern, '{yy}') = 0) then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:issues.id_policy';
  end if;
  -- 최대 렌더(영역 code 8자 ZZZZZZZZ·연도 9999·seq n자리 최대) ≤ 40자(TS ID_POLICY_MAX_LENGTH — seq 가 n자리 이내일 때의 최대다. 절단 금지라
  -- 자리 올림 뒤에는 더 길어질 수 있어 issues.code 에는 길이 CHECK 를 걸지 않는다)
  v_n := pg_catalog.substring(v_pattern, '\{seq:([2-6])\}')::int;
  if pg_catalog.length(public.render_issue_code(v, 'ZZZZZZZZ', 9999, (pg_catalog.power(10::numeric, v_n))::bigint - 1)) > 40 then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:issues.id_policy';
  end if;
  return v;
end $$;

-- issue_code_year: 프로젝트 tz 의 달력 연도(§9.1 D54 정본). tz 규칙은 *_calendar ⑦ settings_ref_check 의 calendar.timezone 분기와 같다 —
--   null·빈 문자열 거부, '/' 없는 이름은 닫힌 목록만(TS NO_SLASH_TIMEZONES — PG 는 IST·EST 같은 약어를 ICU 와 다른 오프셋으로 읽는다),
--   at time zone 이 모르는 이름이면 22023. 모두 CONFIG_INVALID:calendar.timezone. lower()·btrim() 하지 않는다(쓰기 길이 정규 표기만 저장한다 —
--   직접 기록된 다른 표기는 닫히는 쪽이 안전하다).
create function public.issue_code_year(p_tz text, p_at timestamptz) returns int
language plpgsql immutable set search_path to '' as $$
begin
  if coalesce(p_tz, '') = '' then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
  end if;
  if pg_catalog.strpos(p_tz, '/') = 0 and p_tz not in ('UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT') then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
  end if;
  begin
    return pg_catalog.date_part('year', p_at at time zone p_tz)::int;
  exception when invalid_parameter_value then
    raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
  end;
end $$;

-- assign_issue_code — 이슈 등록 때 발번(계획 P4·P5), 갱신 때 code 계열·영역 범위를 지킨다(X3 — 세션이 PostgREST 로 쓰는 표).
-- 잠금 순서(K6): 설정 행 FOR SHARE → 영역 행 FOR KEY SHARE → 카운터 행(upsert). 설정 RPC 는 설정 행 FOR UPDATE 만 잡고 영역·카운터를 읽지
-- 않는다. upsert_project_area 는 advisory 'weekly:' → 영역 FOR UPDATE 이고 설정 행을 읽지 않는다 — 순환 없음.
-- 같은 범위의 동시 등록은 카운터 행 잠금이 직렬화한다. 렌더한 코드가 이미 있으면(정책 변경 뒤 다른 범위의 코드와 겹침) 같은 카운터를 +1 해
-- 다시 렌더한다(건너뛴 번호는 다시 쓰지 않는다, 1,000번이면 ISSUE_CODE_EXHAUSTED). 아직 커밋 전인 다른 범위의 같은 문자열은 exists 가 못 봐
-- issues_project_code_uidx 가 23505 로 막는다(계획 Review Focus 1 — 액션이 "다시 시도" 로 매핑). 범위 'legacy' 는 이 식에서 나올 수 없다.
-- 연도는 프로젝트 calendar.timezone(키 없음 = 'UTC') 의 트랜잭션 시각 now() 기준.
create function public.assign_issue_code() returns trigger
language plpgsql security definer set search_path to '' as $$
declare
  v_values jsonb; v_policy jsonb; v_pattern text; v_area_code text; v_active boolean;
  v_year int; v_scope text; v_seq bigint; v_code text; v_tries int := 0;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id or new.code is distinct from old.code or new.code_seq is distinct from old.code_seq
       or new.code_scope is distinct from old.code_scope or new.code_area_id is distinct from old.code_area_id then
      raise exception using errcode = '23514', message = 'ISSUE_CODE_IMMUTABLE';
    end if;
    -- 영역으로 코드가 매겨진 이슈는 영역을 못 바꾼다(D55 ② — 코드가 영역 code 를 품는다). 영역 없이 매겨진 이슈(ISS·레거시)는 자유
    if old.code_area_id is not null and new.area_id is distinct from old.code_area_id then
      raise exception using errcode = '23514', message = 'ISSUE_AREA_IMMUTABLE';
    end if;
    if old.major_id is not null and new.major_id is null then   -- 0000 의 0062 계약(분류 이슈의 major 연결을 끊지 않는다)
      raise exception using errcode = '23514', message = 'ISSUE_MAJOR_UNSET_FORBIDDEN';
    end if;
    if new.area_id is not null and new.area_id is distinct from old.area_id then
      select a.active into v_active from public.project_areas a
       where a.id = new.area_id and a.project_id = new.project_id and a.kind = 'issue_area' for key share;
      if not found then raise exception using errcode = '23514', message = 'ISSUE_AREA_NOT_FOUND'; end if;
      if not v_active then raise exception using errcode = '23514', message = 'ISSUE_AREA_INACTIVE'; end if;
    end if;
    return new;
  end if;
  if new.code is not null or new.code_seq is not null or new.code_scope is not null or new.code_area_id is not null then
    raise exception using errcode = '23514', message = 'ISSUE_CODE_MANAGED';
  end if;
  select s."values" into v_values from public.project_settings s where s.project_id = new.project_id for share;
  if not found then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  -- 격리 수준 규칙(H2 규칙 ③): 잠금 뒤 설정·영역·기존 코드를 읽어 판정·발번하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 문자열의 코드 — 스냅샷이 고정된 수준에서는 아래 exists 가 그 행을 못 봐 23505 로 끝난다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'ISSUE_CODE_ISOLATION';
  end if;
  v_policy := public.issue_id_policy_of(v_values);
  v_pattern := v_policy ->> 'pattern';
  if new.area_id is not null then
    select a.active, a.code into v_active, v_area_code from public.project_areas a
     where a.id = new.area_id and a.project_id = new.project_id and a.kind = 'issue_area' for key share;
    if not found then raise exception using errcode = '23514', message = 'ISSUE_AREA_NOT_FOUND'; end if;
    if not v_active then raise exception using errcode = '23514', message = 'ISSUE_AREA_INACTIVE'; end if;
  end if;
  if pg_catalog.strpos(v_pattern, '{area}') > 0 and new.area_id is null then
    raise exception using errcode = '23514', message = 'ISSUE_AREA_REQUIRED';
  end if;
  if pg_catalog.strpos(v_pattern, '{yyyy}') > 0 or pg_catalog.strpos(v_pattern, '{yy}') > 0 then
    v_year := public.issue_code_year(coalesce(v_values ->> 'calendar.timezone', 'UTC'), pg_catalog.now());
  end if;
  v_scope := pg_catalog.concat_ws('|',
    case when v_policy ->> 'counter_scope' = 'area' then 'a:' || new.area_id end,
    case when v_policy ->> 'reset' = 'yearly' then 'y:' || pg_catalog.lpad(v_year::text, 4, '0') end);
  loop
    insert into public.issue_number_counters as ctr (project_id, scope_key, last_no, updated_at)
    values (new.project_id, v_scope, 1, pg_catalog.now())
    on conflict (project_id, scope_key) do update set last_no = ctr.last_no + 1, updated_at = pg_catalog.now()
    returning ctr.last_no into v_seq;
    v_code := public.render_issue_code(v_policy, v_area_code, v_year, v_seq);
    exit when not exists (select 1 from public.issues i where i.project_id = new.project_id and i.code = v_code);
    v_tries := v_tries + 1;
    if v_tries >= 1000 then
      raise exception using errcode = '23514', message = 'ISSUE_CODE_EXHAUSTED';
    end if;
  end loop;
  new.code := v_code;
  new.code_seq := v_seq;
  new.code_scope := v_scope;
  new.code_area_id := case when pg_catalog.strpos(v_pattern, '{area}') > 0 then new.area_id end;
  return new;
end $$;

-- assign_issue_major_seq — 0000 본문에서 mega_code 판독만 area_id 로 바꾼다(불변 판정·영역 활성 판정·advisory 키·max 조건). 영역 판정은 채번
-- 트리거와 같은 문장(for key share)이고 오류 토큰도 같다(ISSUE_AREA_NOT_FOUND·ISSUE_AREA_INACTIVE — 앱이 이미 아는 토큰).
-- create or replace 라 트리거 trg_assign_issue_major_seq·ACL·보안 속성은 그대로다.
CREATE OR REPLACE FUNCTION public.assign_issue_major_seq() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
       or new.area_id is distinct from old.area_id
       or new.major_seq is distinct from old.major_seq then
      raise exception 'ISSUE_MAJOR_IMMUTABLE' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.major_seq is not null then
    raise exception 'ISSUE_MAJOR_SEQ_MANAGED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.project_areas area
   where area.id = new.area_id
     and area.project_id = new.project_id
     and area.kind = 'issue_area'
   for key share;
  if not found then
    raise exception 'ISSUE_AREA_NOT_FOUND' using errcode = '23514';
  end if;
  if not v_active then
    raise exception 'ISSUE_AREA_INACTIVE' using errcode = '23514';
  end if;

  -- 유니크 키·dedupe 비교의 기준을 저장 전에 한 곳에서 고정한다.
  new.name := btrim(new.name);

  -- (project, area) 단위 직렬화 후 MAX+1 — 트랜잭션 종료까지 잠금이 유지되어
  -- 동시 등록에도 안전하고, 유니크 충돌로 번호만 소모되는 결번이 없다(헤더 2항).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'issue_major:' || new.project_id::text || ':' || new.area_id::text, 0
    )
  );
  select coalesce(max(mp.major_seq), 0) + 1
    into v_seq
    from public.issue_major_processes mp
   where mp.project_id = new.project_id
     and mp.area_id = new.area_id;

  new.major_seq := v_seq;
  return new;
end
$$;

revoke all on function public.render_issue_code(jsonb, text, int, bigint) from public, anon, authenticated;
revoke all on function public.issue_id_policy_of(jsonb) from public, anon, authenticated;
revoke all on function public.issue_code_year(text, timestamptz) from public, anon, authenticated;
revoke all on function public.assign_issue_code() from public, anon, authenticated;

-- S8 제약·트리거 ---------------------------------------------------------------------------------------------------------
-- code 계열은 S4 가 모두 채웠다(S5 ②). code 에 길이 CHECK 는 걸지 않는다(절단 금지 — 자리 올림 뒤 정책 최대 40자를 넘을 수 있다).
-- 분석 메타 CHECK 는 0000 의 식에서 마지막 절의 기준만 mega_code → major_id(개정 §4.4.2 — 분석 분류 = 대분류 부여). source_type 목록은 0000
-- 원문 그대로(B4 가 어휘로 바꾼다 — 여기서 넓히거나 좁히지 않는다). 대분류가 있으면 영역이 있어야 한다 — 그래야 복합 FK
-- (major_id, project_id, area_id) 가 MATCH SIMPLE 로 건너뛰지 않는다.
alter table public.issues
  alter column code set not null, alter column code_seq set not null, alter column code_scope set not null,
  add constraint issues_code_check check (code = pg_catalog.btrim(code) and code <> '' and code_seq > 0),
  add constraint issues_major_requires_area_check check (major_id is null or area_id is not null),
  -- 코드 영역은 이슈 영역과 같다(D55 ② — 트리거가 ISSUE_AREA_IMMUTABLE 로 먼저 막는다. 이 CHECK 가 area_id 의 FK 로 code_area_id 를 묶는다)
  add constraint issues_code_area_check check (code_area_id is null or (area_id is not null and code_area_id = area_id)),
  add constraint issues_analysis_metadata_check check (
    char_length(sub_process) <= 200 and char_length(owner_department) <= 100 and public.issue_related_systems_valid(related_systems)
    and char_length(source_detail) <= 1000
    and (source_type is null or source_type = any (array['minutes', 'interview', 'deliverable', 'as_is_analysis', 'data_analysis', 'other']))
    and (major_id is null or (btrim(sub_process) <> '' and btrim(owner_department) <> '' and source_type is not null)));
create unique index issues_project_code_uidx on public.issues (project_id, code);
create unique index issues_project_scope_seq_uidx on public.issues (project_id, code_scope, code_seq);
create trigger trg_assign_issue_code before insert or update on public.issues
  for each row execute function public.assign_issue_code();

-- S9 create_issue_from_minute_block 교체 ---------------------------------------------------------------------------------
-- 스펙 §3.3 ⑤·D15·E15: 인자 p_mega_code → p_area_id, 분석 인자 null 허용, 반환 (issue_id, code). 시그니처째 바뀌어 drop + create + EXECUTE 재부여
-- (service_role 만). 본문은 0000 원문을 바탕으로 영역·분석 판정만 바꾼다 — 나머지 문장·오류 토큰은 원문 그대로. 기준선은 INVOKER·
-- search_path 'public','extensions' 였다(계획 X6) — 새 시그니처는 DEFINER·search_path ''(본문은 이미 public. 한정, 내장 함수는 pg_catalog 암묵 검색).
-- 분석 묶음(계획 P9·X9 — 여섯: p_major_name·p_sub_process·p_owner_department·p_related_systems·p_source_type·p_source_detail): 모두 null 이면 분석
--   없음, 하나라도 있으면 원문의 검사 전부. 분석 인자를 받으려면 유효 모듈(워크스페이스 modules.allowed ∋ ∧ 프로젝트 modules.enabled ∋
--   'issue_analysis')이어야 하고(아니면 ISSUE_ANALYSIS_DISABLED), 켜짐 ∧ issues.analysis = 'required' 면 분석 없는 등록을 거부한다
--   (ISSUE_ANALYSIS_REQUIRED). issues.analysis 는 키 없음·"optional" 만 선택으로 읽는다(그 밖 값은 손상 — 닫히는 쪽인 필수로 본다).
-- 모듈 판정은 의도적으로 좁게 둔다: 앱 effectiveModules 의 requires 닫힘(issue_analysis → issues)은 DB 가 보지 않는다 — issues 가 꺼진 프로젝트는
--   서버 액션의 모듈 관문이 이슈 insert 자체를 닫는다(D15 의 DB 방어는 "분석 인자" 판정만 맡는다).
-- 잠금: 워크스페이스 설정 행 → 프로젝트 설정 행 FOR SHARE(설정 RPC 와 같은 순서 — K6) → 영역 행 FOR KEY SHARE(채번 트리거와 같은 문장 —
--   비활성화 커밋 뒤 값을 본다) → 회의록 FOR SHARE(원문) → 이슈 insert 의 채번 트리거(설정 행 FOR SHARE 재진입·카운터).
drop function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, text, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text);
create function public.create_issue_from_minute_block(p_project_id uuid, p_title text, p_body text, p_severity text, p_assignee_member_ids uuid[], p_start_date date, p_due_date date, p_area_id uuid, p_major_name text, p_sub_process text, p_owner_department text, p_related_systems text[], p_source_type text, p_source_detail text, p_actor_id uuid, p_created_by_name text, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_block_index integer, p_block_hash text, p_excerpt_snapshot text, p_source_kind text, p_source_key text) returns table(issue_id uuid, code text)
language plpgsql security definer set search_path to '' as $$
declare
  v_issue_id uuid;
  v_code text;
  v_major_id uuid;
  v_major_name text;
  v_version_body_hash text;
  v_version_project_id uuid;
  v_current_project_id uuid;
  v_minute_archived_at timestamptz;
  v_minute_title text;
  v_minute_date date;
  v_minute_version_no integer;
  v_assignee_input_count integer;
  v_assignee_unique_count integer;
  v_valid_assignee_count integer;
  v_related_systems text[];
  v_has_analysis boolean;
  v_module boolean;
  v_required boolean;
  v_ws uuid;
  v_ws_values jsonb;
  v_values jsonb;
  v_active boolean;
begin
  if p_project_id is null then
    raise exception 'ISSUE_PROJECT_REQUIRED' using errcode = '22023';
  end if;
  if p_actor_id is null then
    raise exception 'ISSUE_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'ISSUE_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if char_length(btrim(p_title)) > 200 then
    raise exception 'ISSUE_TITLE_TOO_LONG' using errcode = '22023';
  end if;
  if p_body is null then
    raise exception 'ISSUE_BODY_REQUIRED' using errcode = '22023';
  end if;
  if char_length(p_body) > 20000 then
    raise exception 'ISSUE_BODY_TOO_LONG' using errcode = '22023';
  end if;
  if p_severity is null or p_severity not in ('high', 'medium', 'low') then
    raise exception 'ISSUE_SEVERITY_INVALID' using errcode = '22023';
  end if;
  if p_start_date is not null
     and p_due_date is not null
     and p_start_date > p_due_date then
    raise exception 'ISSUE_DATE_RANGE_INVALID' using errcode = '22023';
  end if;

  -- 분석 묶음(여섯): 모두 null 이면 분석 없음, 하나라도 있으면 아래 원문 검사 전부
  v_has_analysis := p_major_name is not null or p_sub_process is not null or p_owner_department is not null
                    or p_related_systems is not null or p_source_type is not null or p_source_detail is not null;
  -- 유효 모듈 = 워크스페이스 허용 ∧ 프로젝트 켜짐. 잠금 순서는 설정 RPC 와 같다(워크스페이스 → 프로젝트 FOR SHARE — K6)
  select p.workspace_id into v_ws from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'ISSUE_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select ws."values" into v_ws_values from public.workspace_settings ws where ws.workspace_id = v_ws for share;
  select ps."values" into v_values from public.project_settings ps where ps.project_id = p_project_id for share;
  if v_ws_values is null or v_values is null then
    raise exception using errcode = 'P0001', message = 'SETTINGS_ROW_MISSING';
  end if;
  v_module := coalesce((v_ws_values -> 'modules.allowed') ? 'issue_analysis', false)
              and coalesce((v_values -> 'modules.enabled') ? 'issue_analysis', false);
  v_required := (v_values -> 'issues.analysis') is not null and (v_values -> 'issues.analysis') is distinct from '"optional"'::jsonb;
  if v_has_analysis and not v_module then
    raise exception using errcode = '22023', message = 'ISSUE_ANALYSIS_DISABLED';
  end if;
  if not v_has_analysis and v_module and v_required then
    raise exception using errcode = '22023', message = 'ISSUE_ANALYSIS_REQUIRED';
  end if;
  if p_area_id is not null then   -- 채번 트리거와 같은 문장(비활성화 커밋 뒤 값을 본다 — D15)
    select a.active into v_active from public.project_areas a
     where a.id = p_area_id and a.project_id = p_project_id and a.kind = 'issue_area' for key share;
    if not found then raise exception using errcode = '23514', message = 'ISSUE_AREA_NOT_FOUND'; end if;
    if not v_active then raise exception using errcode = '23514', message = 'ISSUE_AREA_INACTIVE'; end if;
  elsif v_has_analysis then
    raise exception using errcode = '23514', message = 'ISSUE_AREA_REQUIRED';
  end if;
  if v_has_analysis then
    if p_major_name is null
       or btrim(p_major_name) = ''
       or char_length(btrim(p_major_name)) > 100
       or btrim(p_major_name) ~ '^[[({（【]?[[:space:]]*[0-9]{2}(\.[0-9]{2})+' then
      raise exception 'ISSUE_MAJOR_NAME_INVALID' using errcode = '22023';
    end if;
    if p_sub_process is null
       or btrim(p_sub_process) = ''
       or char_length(btrim(p_sub_process)) > 200 then
      raise exception 'ISSUE_SUB_PROCESS_INVALID' using errcode = '22023';
    end if;
    if p_owner_department is null
       or btrim(p_owner_department) = ''
       or char_length(btrim(p_owner_department)) > 100 then
      raise exception 'ISSUE_OWNER_DEPARTMENT_INVALID' using errcode = '22023';
    end if;
    if p_related_systems is null
       or not public.issue_related_systems_valid(p_related_systems) then
      raise exception 'ISSUE_RELATED_SYSTEMS_INVALID' using errcode = '22023';
    end if;
    if p_source_type is distinct from 'minutes' then
      raise exception 'ISSUE_MINUTE_SOURCE_TYPE_REQUIRED' using errcode = '22023';
    end if;
    if p_source_detail is null or char_length(btrim(p_source_detail)) > 1000 then
      raise exception 'ISSUE_SOURCE_DETAIL_INVALID' using errcode = '22023';
    end if;

    select coalesce(array_agg(normalized.system_name order by normalized.first_ord), '{}'::text[])
      into v_related_systems
      from (
        select btrim(item.value) as system_name, min(item.ord) as first_ord
        from unnest(p_related_systems) with ordinality as item(value, ord)
        group by btrim(item.value)
      ) normalized;
  else
    v_related_systems := '{}'::text[];
  end if;

  if p_assignee_member_ids is null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;
  v_assignee_input_count := cardinality(p_assignee_member_ids);
  if v_assignee_input_count > 20 then
    raise exception 'ISSUE_ASSIGNEES_TOO_MANY' using errcode = '22023';
  end if;
  if array_position(p_assignee_member_ids, null) is not null then
    raise exception 'ISSUE_ASSIGNEES_INVALID' using errcode = '22023';
  end if;

  if p_minute_id is null or p_minute_version_id is null then
    raise exception 'MINUTE_VERSION_REQUIRED' using errcode = '22023';
  end if;
  if p_body_hash is null or btrim(p_body_hash) = '' then
    raise exception 'MINUTE_BODY_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_block_index is null or p_block_index < 0 then
    raise exception 'MINUTE_BLOCK_INDEX_INVALID' using errcode = '22023';
  end if;
  if p_block_hash is null or btrim(p_block_hash) = '' then
    raise exception 'MINUTE_BLOCK_HASH_REQUIRED' using errcode = '22023';
  end if;
  if p_excerpt_snapshot is null or btrim(p_excerpt_snapshot) = '' then
    raise exception 'MINUTE_BLOCK_EXCERPT_REQUIRED' using errcode = '22023';
  end if;
  if p_source_kind is null
     or p_source_kind not in ('manual', 'action', 'risk') then
    raise exception 'MINUTE_SOURCE_KIND_INVALID' using errcode = '22023';
  end if;
  if p_source_key is not null and btrim(p_source_key) = '' then
    raise exception 'MINUTE_SOURCE_KEY_INVALID' using errcode = '22023';
  end if;

  select minute.project_id, minute.archived_at
    into v_current_project_id, v_minute_archived_at
    from public.minutes minute
   where minute.id = p_minute_id
   for share;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_minute_archived_at is not null then
    raise exception 'MINUTE_ARCHIVED' using errcode = '55000';
  end if;
  if v_current_project_id is not null
     and v_current_project_id <> p_project_id then
    raise exception 'MINUTE_PROJECT_MISMATCH' using errcode = '23514';
  end if;

  select
    mv.body_hash,
    mv.project_id,
    mv.title,
    mv.minute_date,
    mv.version_no
  into
    v_version_body_hash,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_minute_version_no
  from public.minute_versions mv
  where mv.id = p_minute_version_id
    and mv.minute_id = p_minute_id;

  if not found then
    raise exception 'MINUTE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_body_hash <> v_version_body_hash then
    raise exception 'MINUTE_BODY_STALE' using errcode = '22023';
  end if;

  select count(distinct member_id)
    into v_assignee_unique_count
    from unnest(p_assignee_member_ids) as assignee(member_id);

  select count(*)
    into v_valid_assignee_count
    from public.project_members pm
   where pm.project_id = p_project_id
     and pm.id in (
       select distinct member_id
       from unnest(p_assignee_member_ids) as assignee(member_id)
     );

  if v_valid_assignee_count <> v_assignee_unique_count then
    raise exception 'ISSUE_ASSIGNEE_PROJECT_MISMATCH' using errcode = '22023';
  end if;

  -- Major resolve-or-create(분석이 있을 때만 — 그 영역 안에서) — 같은 이름은 기존 체번 재사용, 새 이름은 트리거가
  -- advisory lock 아래 다음 번호를 발급한다. 경합으로 유니크 충돌이 나면 승자를 재조회.
  if v_has_analysis then
    v_major_name := btrim(p_major_name);
    select mp.id
      into v_major_id
      from public.issue_major_processes mp
     where mp.project_id = p_project_id
       and mp.area_id = p_area_id
       and mp.name = v_major_name;
    if not found then
      begin
        insert into public.issue_major_processes (project_id, area_id, name)
        values (p_project_id, p_area_id, v_major_name)
        returning id into v_major_id;
      exception when unique_violation then
        select mp.id
          into v_major_id
          from public.issue_major_processes mp
         where mp.project_id = p_project_id
           and mp.area_id = p_area_id
           and mp.name = v_major_name;
        if not found then
          raise exception 'ISSUE_MAJOR_RESOLVE_FAILED' using errcode = '55000';
        end if;
      end;
    end if;
  else
    v_major_id := null;
  end if;

  insert into public.issues as created_issue (
    project_id,
    title,
    body,
    severity,
    start_date,
    due_date,
    area_id,
    major_id,
    sub_process,
    owner_department,
    related_systems,
    source_type,
    source_detail,
    created_by,
    created_by_name
  ) values (
    p_project_id,
    btrim(p_title),
    p_body,
    p_severity,
    p_start_date,
    p_due_date,
    p_area_id,
    v_major_id,
    case when v_has_analysis then btrim(p_sub_process) else '' end,
    case when v_has_analysis then btrim(p_owner_department) else '' end,
    v_related_systems,
    case when v_has_analysis then 'minutes' end,
    case when v_has_analysis then btrim(p_source_detail) else '' end,
    p_actor_id,
    nullif(btrim(p_created_by_name), '')
  )
  returning
    created_issue.id,
    created_issue.code
  into v_issue_id, v_code;

  insert into public.issue_assignees (
    issue_id,
    member_id,
    project_id
  )
  select
    v_issue_id,
    assignee.member_id,
    p_project_id
  from (
    select distinct member_id
    from unnest(p_assignee_member_ids) as input(member_id)
  ) assignee;

  insert into public.issue_links (
    issue_id,
    project_id,
    link_type,
    minute_id,
    minute_version_id,
    minute_version_no,
    source_project_id,
    minute_title_snapshot,
    minute_date_snapshot,
    body_hash,
    block_index,
    block_hash,
    excerpt_snapshot,
    source_kind,
    source_key
  ) values (
    v_issue_id,
    p_project_id,
    'minute_block',
    p_minute_id,
    p_minute_version_id,
    v_minute_version_no,
    v_version_project_id,
    v_minute_title,
    v_minute_date,
    v_version_body_hash,
    p_block_index,
    p_block_hash,
    p_excerpt_snapshot,
    p_source_kind,
    p_source_key
  );

  issue_id := v_issue_id;
  code := v_code;
  return next;
end
$$;
revoke all on function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text) to service_role;

-- S10 settings_ref_check 의 issues.id_policy 분기 ----------------------------------------------------------------------------
-- *_calendar ⑦ 의 본문 그대로(시그니처·INVOKER·search_path·ACL — create or replace 는 ACL 을 유지한다) + 마지막 return 앞에 한 분기(계획 P7).
-- INVOKER 지만 부르는 쪽(apply_project_settings·create_project_with_settings)이 DEFINER 라 EXECUTE 를 회수한 issue_id_policy_of 를 부를 수 있다.
-- 뒤 SP 는 이 본문 위에 분기를 더한다(B4 *_vocab_settings — 앞 분기를 지우지 않음을 그 사후검사가 'issues.id_policy' 문자열로도 본다).
create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  v_rules jsonb;
  v_weeks jsonb;
begin
  -- calendar.week_start — 정확 판정(D53, 비평 반영 — S2): 새 규칙에서 키가 바뀌는 문서가 하나라도 있으면 거부한다. "첫 차이 위치"만 세면
  -- 미적용 전환을 더 늦은 날로 교체할 때 [E1, E2) 의 일요일 키 문서를 놓친다. unset(p_new null) = 제품 기본값 일요일.
  -- 과거 원소 수정 금지(from ≤ T)는 TS toStored 가 판정한다 — 여기는 문서 키 유효성만 본다(미리보기 previewWeekStart 와 같은 정의).
  -- 주간 문서는 프로젝트당 연 52건 수준이라 전수가 싸다(K28).
  if p_key = 'calendar.week_start' then
    v_rules := public.week_rules_of(case when p_new is null then '{}'::jsonb
                                         else pg_catalog.jsonb_build_object('calendar.week_start', p_new) end);
    select pg_catalog.jsonb_agg(x.w order by x.w) into v_weeks
      from (select r.week_start as w
              from public.weekly_reports r
             where r.project_id = p_project_id
               and public.week_key_from_rules(v_rules, r.week_start) <> r.week_start
             order by r.week_start
             limit 20) x;
    if v_weeks is not null then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:calendar.week_start',
        detail = pg_catalog.jsonb_build_object('key', 'calendar.week_start', 'weeks', v_weeks)::text;
    end if;
    return;
  end if;
  -- calendar.timezone — TS(Intl)만 통과한 값이 PG 에 없으면 그 프로젝트의 SQL(이슈 코드 {yyyy} — B1)이 막힌다. DB 쪽 마지막 방어(D54).
  -- 워크스페이스 tz 를 읽는 SQL 은 없다(사용현황 RPC 는 TS 가 tz 를 넘긴다) — 프로젝트만 본다.
  if p_key = 'calendar.timezone' then
    if p_new is null then
      return;
    end if;
    if pg_catalog.jsonb_typeof(p_new) is distinct from 'string' or (p_new #>> '{}') = '' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    -- '/' 없는 이름은 닫힌 허용 목록만(L1 — TS NO_SLASH_TIMEZONES 와 같다): PG 는 IST·NST·PST·CET·EST 같은 이름을 약어 표에서 먼저 읽어
    -- ICU(TS)와 다른 오프셋이 된다 — 받으면 TS·SQL 이 다른 날짜를 낸다
    if pg_catalog.strpos(p_new #>> '{}', '/') = 0
       and (p_new #>> '{}') not in ('UTC', 'GMT', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT') then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end if;
    begin
      perform pg_catalog.now() at time zone (p_new #>> '{}');
    exception when invalid_parameter_value then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:calendar.timezone';
    end;
    return;
  end if;
  -- issues.id_policy(SP5 B1 — 계획 P7): TS(parseIdPolicy)만 통과한 값이 SQL 검증(issue_id_policy_of)에 걸리면 그 프로젝트의 모든 이슈 등록이 멈춘다.
  -- DB 쪽 마지막 방어. unset(p_new null) = 제품 기본값이라 통과
  if p_key = 'issues.id_policy' then
    if p_new is not null then
      perform public.issue_id_policy_of(pg_catalog.jsonb_build_object('issues.id_policy', p_new));
    end if;
    return;
  end if;
  return;
end $$;

-- S11 사후검사 — ISSUE_AREAS_POSTCHECK. 읽기만 한다. ⑪-a 는 카탈로그, ⑪-b 는 이 적용 시점의 데이터(*_calendar ⑪ 꼴).
do $$
-- ⑪-a 카탈로그 블록
declare
  v text;
begin
  -- ① EXECUTE 기대표 — 새 헬퍼 셋·트리거 함수 셋: 누구에게도(PUBLIC·anon·authenticated) 없음(service_role 은 보지 않는다 — SP4 Q40)
  select string_agg(x.fn, ', ') into v
    from (values ('public.render_issue_code(jsonb, text, int, bigint)'), ('public.issue_id_policy_of(jsonb)'),
                 ('public.issue_code_year(text, timestamptz)'), ('public.assign_issue_code()'), ('public.assign_issue_major_seq()'),
                 ('public.project_areas_guard()')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0);
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: 헬퍼·트리거 함수의 EXECUTE 가 열려 있다: %', v; end if;
  --    RPC 둘: anon·authenticated·PUBLIC 거짓, service_role 참(create_issue_from_minute_block 새 시그니처·upsert_project_area 는 *_weekly_areas 그대로)
  select string_agg(x.fn, ', ') into v
    from (values ('public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)'),
                 ('public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)')) as x(fn)
    left join pg_proc p on p.oid = to_regprocedure(x.fn)
   where p.oid is null
      or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
      or not has_function_privilege('service_role', p.oid, 'EXECUTE');
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: RPC 의 EXECUTE 가 기대와 다르다: %', v; end if;

  -- ② 보안 속성·변동성·search_path: 트리거 함수·RPC 는 DEFINER, 헬퍼 셋은 INVOKER·immutable, 전부 search_path=""
  select string_agg(x.fn, ', ') into v
    from (values ('public.render_issue_code(jsonb, text, int, bigint)', false, 'i'), ('public.issue_id_policy_of(jsonb)', false, 'i'),
                 ('public.issue_code_year(text, timestamptz)', false, 'i'), ('public.assign_issue_code()', true, 'v'),
                 ('public.assign_issue_major_seq()', true, 'v'), ('public.project_areas_guard()', true, 'v'),
                 ('public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)', true, 'v'))
         as x(fn, secdef, vol)
    join pg_proc p on p.oid = x.fn::regprocedure
   where p.prosecdef <> x.secdef or p.provolatile <> x.vol
      or not coalesce('search_path=""' = any(p.proconfig), false);
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: 함수의 보안 속성·변동성·search_path 가 기대와 다르다: %', v; end if;

  -- ③ 옛 객체 부재
  if pg_catalog.to_regclass('public.issue_mega_areas') is not null
     or pg_catalog.to_regprocedure('public.assign_issue_analysis_code()') is not null
     or pg_catalog.to_regprocedure('public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, text, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)') is not null
     or exists (select 1 from information_schema.columns c
                 where c.table_schema = 'public' and c.column_name = 'mega_code'
                   and c.table_name in ('issues', 'issue_major_processes', 'issue_number_counters')) then
    raise exception 'ISSUE_AREAS_POSTCHECK: 옛 전역 영역 객체(issue_mega_areas·assign_issue_analysis_code·옛 회의록 RPC·mega_code 열)가 남았다';
  end if;

  -- ④ 트리거: project_areas_guard 는 insert·update(tgtype 의 INSERT 4 | UPDATE 16), trg_assign_issue_code·trg_assign_issue_major_seq 연결·활성
  if not exists (select 1 from pg_trigger g
                  where g.tgrelid = 'public.project_areas'::regclass and g.tgname = 'project_areas_guard' and not g.tgisinternal
                    and g.tgfoid = 'public.project_areas_guard()'::regprocedure and g.tgtype & 20 = 20 and g.tgenabled in ('O', 'A')) then
    raise exception 'ISSUE_AREAS_POSTCHECK: project_areas_guard 트리거가 insert·update 가 아니다';
  end if;
  select string_agg(format('%s.%s', x.tbl, x.name), ', ') into v
    from (values ('issues', 'trg_assign_issue_code', 'public.assign_issue_code()'),
                 ('issue_major_processes', 'trg_assign_issue_major_seq', 'public.assign_issue_major_seq()')) as x(tbl, name, fn)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name and g.tgfoid = x.fn::regprocedure
                        and not g.tgisinternal and g.tgenabled in ('O', 'A') and g.tgtype & 20 = 20);
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: 채번 트리거가 없거나 꺼졌다: %', v; end if;

  -- ⑤ 본문 토큰 — 채번 트리거의 격리 가드·잠금, SP4 본문 승계(D12 — project_areas_guard·upsert_project_area), settings_ref_check 의 세 분기
  if (select position('ISSUE_CODE_ISOLATION' in p.prosrc) = 0 or position('transaction_isolation' in p.prosrc) = 0
             or position('for key share' in p.prosrc) = 0 or position('for share' in p.prosrc) = 0
        from pg_proc p where p.oid = 'public.assign_issue_code()'::regprocedure) then
    raise exception 'ISSUE_AREAS_POSTCHECK: 채번 트리거의 격리 가드·잠금 문장이 없다';
  end if;
  if (select position('PROJECT_AREA_CODE_IMMUTABLE' in p.prosrc) = 0 or position('PROJECT_AREA_KIND_IMMUTABLE' in p.prosrc) = 0
             or position('PROJECT_AREA_PROJECT_IMMUTABLE' in p.prosrc) = 0 or position('PROJECT_AREA_CODE_INVALID' in p.prosrc) = 0
        from pg_proc p where p.oid = 'public.project_areas_guard()'::regprocedure) then
    raise exception 'ISSUE_AREAS_POSTCHECK: project_areas_guard 가 SP4 의 불변 판정(code·kind·project_id) 또는 code 규칙을 잃었다';
  end if;
  if (select position('AREA_FORBIDDEN' in p.prosrc) = 0 or position('''weekly:''' in p.prosrc) = 0
             or position('WEEKLY_ISOLATION' in p.prosrc) = 0 or position('p_from_week' in p.prosrc) = 0
             or position('AREA_CODE_INVALID' in p.prosrc) = 0 or position('actor_is_project_admin' in p.prosrc) = 0
        from pg_proc p where p.oid = 'public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)'::regprocedure) then
    raise exception 'ISSUE_AREAS_POSTCHECK: upsert_project_area 가 SP4 의 등급·잠금·격리 문장 또는 code 규칙을 잃었다';
  end if;
  if (select position('''calendar.week_start''' in p.prosrc) = 0 or position('''calendar.timezone''' in p.prosrc) = 0
             or position('''issues.id_policy''' in p.prosrc) = 0 or position('public.issue_id_policy_of(' in p.prosrc) = 0
             or p.prosecdef
        from pg_proc p where p.oid = 'public.settings_ref_check(uuid, text, jsonb, jsonb)'::regprocedure) then
    raise exception 'ISSUE_AREAS_POSTCHECK: settings_ref_check 의 분기가 기대와 다르다';
  end if;
  if (select position('ISSUE_ANALYSIS_DISABLED' in p.prosrc) = 0 or position('ISSUE_ANALYSIS_REQUIRED' in p.prosrc) = 0
             or position('for key share' in p.prosrc) = 0 or position('''modules.allowed''' in p.prosrc) = 0
             or position('''modules.enabled''' in p.prosrc) = 0
        from pg_proc p where p.oid = 'public.create_issue_from_minute_block(uuid, text, text, text, uuid[], date, date, uuid, text, text, text, text[], text, text, uuid, text, uuid, uuid, text, integer, text, text, text, text)'::regprocedure) then
    raise exception 'ISSUE_AREAS_POSTCHECK: 회의록 RPC 의 유효 모듈·영역 판정 문장이 없다';
  end if;

  -- ⑥ 제약: code 계열 NOT NULL, 유일 인덱스 둘, issues → project_areas FK 는 하나(PGRST201 방지 — code_area_id 는 CHECK)
  if exists (select 1 from information_schema.columns c
              where c.table_schema = 'public' and c.table_name = 'issues' and c.column_name in ('code', 'code_seq', 'code_scope') and c.is_nullable <> 'NO')
     or pg_catalog.to_regclass('public.issues_project_code_uidx') is null or pg_catalog.to_regclass('public.issues_project_scope_seq_uidx') is null
     or (select pg_catalog.count(*) from pg_constraint k
          where k.conrelid = 'public.issues'::regclass and k.confrelid = 'public.project_areas'::regclass and k.contype = 'f') <> 1
     or not exists (select 1 from pg_constraint k where k.conrelid = 'public.issues'::regclass and k.conname = 'issues_code_area_check') then
    raise exception 'ISSUE_AREAS_POSTCHECK: issues 의 code 제약·유일 인덱스·영역 FK 가 기대와 다르다';
  end if;
end $$;

do $$
-- ⑪-b 데이터 블록 — 이 적용 시점에만 참이어야 하는 것(리허설이 본다)
declare
  v text;
  r record;
begin
  -- ⑥ 모듈 편입(R6): 모든 프로젝트 modules.enabled·모든 워크스페이스 modules.allowed 에 issue_analysis
  select pg_catalog.left(string_agg(s.project_id::text, ', '), 600) into v
    from public.project_settings s where not coalesce((s."values" -> 'modules.enabled') ? 'issue_analysis', false);
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: modules.enabled 에 issue_analysis 가 없는 프로젝트: %', v; end if;
  select pg_catalog.left(string_agg(s.workspace_id::text, ', '), 600) into v
    from public.workspace_settings s where not coalesce((s."values" -> 'modules.allowed') ? 'issue_analysis', false);
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: modules.allowed 에 issue_analysis 가 없는 워크스페이스: %', v; end if;
  --    레거시 범위 코드는 PI 템플릿과 겹치지 않는다(D55 ①)
  select pg_catalog.left(string_agg(i.id::text, ', '), 600) into v
    from public.issues i where i.code_scope = 'legacy' and i.code ~ '^PI-I-';
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: 레거시 코드가 PI 템플릿과 겹친다: %', v; end if;
  -- ⑦ 기록된 issues.id_policy 가 모두 SQL 검증을 통과한다(이관 값·롤백 뒤 남은 값 — 손상이면 그 프로젝트의 등록이 막힌다)
  v := null;
  for r in select s.project_id, s."values" from public.project_settings s where s."values" ? 'issues.id_policy' order by s.project_id loop
    begin
      perform public.issue_id_policy_of(r."values");
    exception when invalid_parameter_value then
      v := coalesce(v || ', ', '') || r.project_id::text;
    end;
  end loop;
  if v is not null then raise exception 'ISSUE_AREAS_POSTCHECK: issues.id_policy 가 손상인 프로젝트: % — 설정을 고친 뒤 다시 적용한다', pg_catalog.left(v, 600); end if;
end $$;
