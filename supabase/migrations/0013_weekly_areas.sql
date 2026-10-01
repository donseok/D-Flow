-- *_weekly_areas — 주간 행을 구분 문자열에서 영역 id 로(SP4 Phase A1). 정본: docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md
-- §3.1·§3.2, 개정 docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md §4.3.
-- 절 순서(확장 → 제약 → 축소 — D23): ①′ 공통 정의 ① 사전검사 ② 선행 유일 인덱스 ③ 열 추가 ④ project_id 백필 ⑤ 라벨 → 영역
--   ⑥ 머리표·중복 병합 ⑦ 전후 대조 ⑧ 제약 ⑨ 축소 ⑩ 정책·권한·영역 불변 ⑪ 함수·updated_at 트리거 ⑫ 사후검사.
-- 권한 원칙: 주간 문서 생성과 영역 쓰기는 DEFINER RPC 둘(create_weekly_report·upsert_project_area — service_role 만 실행)이 행위자의
--   등급을 다시 판정한다(actor_is_project_admin — D28). 세션의 구조 쓰기 길은 닫는다(D27): 주간 행은 네 칸, 주간 문서는 제목만 UPDATE 하고
--   updated_at 은 트리거가 매긴다. 새 함수는 revoke all … from public, anon, authenticated — authenticated 가 실행하는 새 함수는 없다.
-- 번호를 참조하지 않는다 — 토큰은 WEEKLY_AREAS_PRECHECK·WEEKLY_AREAS_POSTCHECK, 테스트·리허설은 이 파일을 접미로 찾는다(D12).
-- 보정하지 않는 것: ① 이 멈추면 고치지 않는다(그 문서의 해당 행 내용을 줄이고 다시 적용한다). 영역 순서는 근사다 — 옛 화면은 표준 구분을
--   이름 자리 순으로 놓았고 행 sort_order 는 주차마다 달랐다(편집기로 고친다). 모듈 이름에 [ 나 ] 가 들어 있으면 점검이 머리표 줄을 구획
--   머리글로 읽지 못한다(본문 줄로 남는다). 길이는 char_length(코드 포인트)다 — TS 상한은 UTF-16 단위라 보조 평면 문자가 든 경계 바로
--   아래 칸은 이관 뒤 저장 때 상한에 걸릴 수 있다(로컬 개발 데이터라 받아들인다).
-- CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 begin/commit 을 쓰지 않는다.
-- 롤백: supabase/rollbacks/*_weekly_areas_rollback.sql — *_command_receipts 가 적용돼 있으면 그 롤백이 먼저다(그 파일의 RPC 가 이 파일의
--   actor_is_project_admin 을 부른다). 리허설: supabase/rehearsal/*_weekly_areas_{precheck_violations,seed_wide,smoke,created_fixture,rollback_check}.sql.

-- ①′ 공통 정의 — ①·⑤·⑥·⑦ 이 같은 정의를 쓴다(스펙 §3.2 ①′) -------------------------------------------------------------------
-- 이 파일 안에서만 쓰는 세션 함수다: pg_temp 는 연결이 끝나면 사라지고 public 카탈로그·덤프에 남지 않는다(롤백할 것이 없다).
-- 공백 집합 = JS String.prototype.trim() 이 걷는 문자(WhiteSpace + LineTerminator — 탭·LF·VT·FF·CR·공백·NBSP·U+1680·U+2000~U+200A·
-- U+2028·U+2029·U+202F·U+205F·U+3000·BOM). 기본 btrim 은 반각 공백만 걷어 '설계 ' 와 '설계' 를 다른 영역으로 만든다(Review Focus 1).
-- 비어 있지 않음 = <> ''(다듬지 않는다 — 공백뿐인 칸도 내용으로 옮긴다. 이월·표시의 "내용 있음"(D32 — trim() !== '')과 다른 술어다).
create function pg_temp.sp4_trim(p text) returns text language sql immutable as $$
  select pg_catalog.btrim(p, E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
-- 라벨 = 다듬은 구분, 구분이 비면 다듬은 모듈, 둘 다 비면 '기타'(⑤ — 이름 목록을 원문에 넣지 않는다)
create function pg_temp.sp4_label(p_section text, p_module text) returns text language sql immutable as $$
  select coalesce(nullif(pg_temp.sp4_trim(p_section), ''), nullif(pg_temp.sp4_trim(p_module), ''), '기타')
$$;
-- 모듈 이름 = 다듬은 모듈. 비어 있지 않고 라벨과 다르면 그 이름(머리표를 붙일 행), 아니면 null
create function pg_temp.sp4_mark(p_section text, p_module text) returns text language sql immutable as $$
  select case when pg_temp.sp4_trim(p_module) <> '' and pg_temp.sp4_trim(p_module) <> pg_temp.sp4_label(p_section, p_module)
              then pg_temp.sp4_trim(p_module) end
$$;
-- 머리표가 붙은 값 — 모듈 이름이 있고 값이 공백뿐이 아니면(btrim(값, 위 집합) <> '') '[모듈]' 단독 줄 + 줄바꿈 + 값(T4·D29),
-- 아니면 값 그대로. 머리표 글자 수 = char_length(모듈 이름) + 3
create function pg_temp.sp4_marked(p_value text, p_mark text) returns text language sql immutable as $$
  select case when p_mark is not null and pg_temp.sp4_trim(p_value) <> '' then '[' || p_mark || ']' || E'\n' || p_value else p_value end
$$;

-- ① 사전검사 — ⑤·⑥ 의 규칙으로 셈한 병합 뒤 칸 길이가 20,000자(WEEKLY_CELL_MAX)를 넘는 (문서, 라벨) 이 있으면 멈춘다(D30) --------------
-- 병합 뒤 길이 = Σ(비어 있지 않은 값의 char_length, 머리표 포함) + (비어 있지 않은 값의 수 − 1)
do $$
declare
  v_n int;
  v_list text;
begin
  with cells as (
    select w.report_id, pg_temp.sp4_label(w.section, w.module) as label, c.cell,
           pg_temp.sp4_marked(c.val, pg_temp.sp4_mark(w.section, w.module)) as val
      from public.weekly_report_rows w
     cross join lateral (values ('this_content', w.this_content), ('this_issue', w.this_issue),
                                ('next_content', w.next_content), ('next_issue', w.next_issue)) as c(cell, val)
     where c.val <> ''
  ), merged as (
    select x.report_id, x.label, x.cell, sum(pg_catalog.char_length(x.val)) + count(*) - 1 as len
      from cells x group by x.report_id, x.label, x.cell
  )
  select count(*), string_agg(format('(문서 %s, 라벨 %L, 칸 %s, %s자)', m.report_id, m.label, m.cell, m.len), ', '
                               order by m.report_id, m.label, m.cell)
    into v_n, v_list
    from merged m where m.len > 20000;
  if v_n > 0 then
    raise exception using errcode = '23514', message = format(
      'WEEKLY_AREAS_PRECHECK: 이관하면 한 칸이 20,000자를 넘는 (문서, 라벨, 칸) %s건 — %s. '
      || '그 문서의 해당 행 내용을 줄이고 다시 적용한다(보정하지 않는다).', v_n, left(v_list, 600));
  end if;
end $$;

-- ② 선행 유일 인덱스 — ⑧ 의 복합 FK 대상 ----------------------------------------------------------------------------------------
create unique index project_areas_id_project_kind_uidx on public.project_areas (id, project_id, kind);
create unique index weekly_reports_id_project_uidx on public.weekly_reports (id, project_id);

-- ③ 열 추가(nullable — ⑧ 이 NOT NULL) ----------------------------------------------------------------------------------------------
alter table public.weekly_report_rows
  add column project_id uuid,
  add column area_id uuid,
  add column area_kind text not null default 'weekly_section' check (area_kind = 'weekly_section');

-- ④ project_id 백필 — 부모 문서의 project_id ----------------------------------------------------------------------------------------
update public.weekly_report_rows w set project_id = r.project_id
  from public.weekly_reports r where r.id = w.report_id;

-- ⑤ 라벨 → 영역(D29·D9) ---------------------------------------------------------------------------------------------------------
-- 이관 전 모습을 먼저 잰다(⑦ 의 '전'): (문서, 라벨, 칸)마다 비어 있지 않은 값의 수·글자 수, 머리표가 붙을 값의 수·머리표 글자 수
create temp table sp4_wa_before on commit drop as
select w.report_id, pg_temp.sp4_label(w.section, w.module) as label, c.cell,
       count(*) as k,
       sum(pg_catalog.char_length(c.val)) as chars,
       count(*) filter (where pg_temp.sp4_marked(c.val, pg_temp.sp4_mark(w.section, w.module)) <> c.val) as marks,
       coalesce(sum(pg_catalog.char_length(pg_temp.sp4_mark(w.section, w.module)) + 3)
                  filter (where pg_temp.sp4_marked(c.val, pg_temp.sp4_mark(w.section, w.module)) <> c.val), 0) as mark_chars
  from public.weekly_report_rows w
 cross join lateral (values ('this_content', w.this_content), ('this_issue', w.this_issue),
                            ('next_content', w.next_content), ('next_issue', w.next_issue)) as c(cell, val)
 where c.val <> ''
 group by w.report_id, pg_temp.sp4_label(w.section, w.module), c.cell;
-- 프로젝트마다 라벨 하나에 영역 하나 — 같은 (project, weekly_section, code = 라벨) 영역이 있으면 재사용(이름·순서·활성 유지 — D9)
create temp table sp4_wa_labels on commit drop as
select n.project_id, n.label, n.first_sort,
       (select a.id from public.project_areas a
         where a.project_id = n.project_id and a.kind = 'weekly_section' and a.code = n.label) as reused_id
  from (select w.project_id, pg_temp.sp4_label(w.section, w.module) as label, min(w.sort_order) as first_sort
          from public.weekly_report_rows w
         group by w.project_id, pg_temp.sp4_label(w.section, w.module)) n;
-- 없으면 만든다: code = name = 라벨, 활성, 순서 = 그 프로젝트 기존 weekly_section 의 최댓값(없으면 0) + 새 라벨의 순위(행 sort_order 의
-- 최솟값, 라벨의 코드 포인트 순). 주간행이 없는 프로젝트에는 만들지 않는다(행에서 라벨을 뽑으므로)
insert into public.project_areas (project_id, kind, code, name, sort_order, active)
select l.project_id, 'weekly_section', l.label, l.label,
       coalesce((select max(a.sort_order) from public.project_areas a
                  where a.project_id = l.project_id and a.kind = 'weekly_section'), 0)
         + dense_rank() over (partition by l.project_id order by l.first_sort, l.label collate "C"),
       true
  from pg_temp.sp4_wa_labels l
 where l.reused_id is null;
update public.weekly_report_rows w set area_id = a.id
  from public.project_areas a
 where a.project_id = w.project_id and a.kind = 'weekly_section' and a.code = pg_temp.sp4_label(w.section, w.module);

-- ⑥ 머리표·중복 병합(D29) ----------------------------------------------------------------------------------------------------------
-- 같은 (문서, 영역) 묶음(행 하나뿐인 묶음 포함)에서 (sort_order, id) 첫 행을 남긴다. 칸마다 비어 있지 않은 값을 그 순서로 E'\n' 로 잇는다 —
-- 머리표가 붙는 값은 '[모듈]' 단독 줄 + 줄바꿈 + 값(점검이 그 줄을 셀 안 구획 머리글로 읽는다 — weeklyLint.ts 의 BLOCK_HEADER).
-- 남는 행의 updated_at = 묶음의 최댓값(AI 색인 신선도가 행 updated_at 의 최댓값을 쓴다). ⑪ 의 updated_at 트리거보다 앞이라 덮이지 않는다
create temp table sp4_wa_merged on commit drop as
select x.report_id, x.area_id,
       (array_agg(x.id order by x.sort_order, x.id))[1] as keep_id,
       count(*) as n,
       coalesce(string_agg(pg_temp.sp4_marked(x.this_content, x.mark), E'\n' order by x.sort_order, x.id)
                  filter (where x.this_content <> ''), '') as this_content,
       coalesce(string_agg(pg_temp.sp4_marked(x.this_issue, x.mark), E'\n' order by x.sort_order, x.id)
                  filter (where x.this_issue <> ''), '') as this_issue,
       coalesce(string_agg(pg_temp.sp4_marked(x.next_content, x.mark), E'\n' order by x.sort_order, x.id)
                  filter (where x.next_content <> ''), '') as next_content,
       coalesce(string_agg(pg_temp.sp4_marked(x.next_issue, x.mark), E'\n' order by x.sort_order, x.id)
                  filter (where x.next_issue <> ''), '') as next_issue,
       max(x.updated_at) as updated_at
  from (select w.id, w.report_id, w.area_id, w.sort_order, w.this_content, w.this_issue, w.next_content, w.next_issue, w.updated_at,
               pg_temp.sp4_mark(w.section, w.module) as mark
          from public.weekly_report_rows w) x
 group by x.report_id, x.area_id;
update public.weekly_report_rows w
   set this_content = m.this_content, this_issue = m.this_issue, next_content = m.next_content, next_issue = m.next_issue,
       updated_at = m.updated_at
  from pg_temp.sp4_wa_merged m
 where w.id = m.keep_id;
delete from public.weekly_report_rows w
 using pg_temp.sp4_wa_merged m
 where w.report_id = m.report_id and w.area_id = m.area_id and w.id <> m.keep_id;

-- ⑦ 전후 대조(W19) — 이관 뒤 비어 있지 않은(<> '' — ①′) (문서, 영역, 칸)의 수와 '총 글자 수 − 병합 줄바꿈 수 − 머리표 글자 수'가 이관 전과
-- 같아야 한다. 줄바꿈 수 = Σ max(k − 1, 0). 같으면 건수를 notice 로 남긴다(리허설 스모크가 기대값으로 다시 잰다) -------------------------------
do $$
declare
  b record;
  a record;
  v_new bigint;
  v_reused bigint;
  v_merged bigint;
  v_rows bigint;
begin
  select count(*) as combos, coalesce(sum(s.chars), 0) as chars, coalesce(sum(greatest(s.k - 1, 0)), 0) as seps,
         coalesce(sum(s.marks), 0) as marks, coalesce(sum(s.mark_chars), 0) as mark_chars
    into b from pg_temp.sp4_wa_before s;
  select count(*) as combos, coalesce(sum(pg_catalog.char_length(c.val)), 0) as chars
    into a
    from public.weekly_report_rows w
   cross join lateral (values (w.this_content), (w.this_issue), (w.next_content), (w.next_issue)) as c(val)
   where c.val <> '';
  if a.combos <> b.combos or a.chars - b.seps - b.mark_chars <> b.chars then
    raise exception 'WEEKLY_AREAS_MIGRATION_MISMATCH: 비어 있지 않은 칸 전 % / 후 %, 글자 수 전 % / 후 %(병합 줄바꿈 %, 머리표 %개 %자)',
      b.combos, a.combos, b.chars, a.chars, b.seps, b.marks, b.mark_chars;
  end if;
  select count(*) filter (where l.reused_id is null), count(*) filter (where l.reused_id is not null)
    into v_new, v_reused from pg_temp.sp4_wa_labels l;
  select coalesce(sum(m.n - 1), 0) into v_merged from pg_temp.sp4_wa_merged m;
  select count(*) into v_rows from public.weekly_report_rows;
  raise notice 'WEEKLY_AREAS: 영역 신설 %, 재사용 %, 병합으로 지운 행 %, 머리표 %, 남은 행 %', v_new, v_reused, v_merged, b.marks, v_rows;
end $$;

-- ⑧ 제약(D23·Q10) — 한 문장 -----------------------------------------------------------------------------------------------------------
-- 프로젝트 삭제와 영역 restrict: 주간 행은 weekly_report_rows_project_id_fkey 로 projects 의 1단 캐스케이드에서 지워지고, 영역 검사는 영역 삭제가 낳는
-- 2단 사건이라 늘 그 뒤에 돈다. RI 트리거 이름(OID 문자열) 순서에 기대지 않는다 — 덤프·복원·FK 재생성에도 같다. 영역을 지우는 캐스케이드 길을
-- 새로 만들면(예: project_areas 에 workspace FK) 주간 행에도 같은 깊이의 길을 둔다.
-- 네 칸의 길이 상한(WEEKLY_CELL_MAX 20,000자)은 DB 에도 둔다 — 세션의 칸 update(⑩)가 서버 액션의 상한을 건너뛰지 못하게. ① 이 이관 뒤 칸이
-- 상한 안임을 보장한다. char_length 는 코드 포인트라 TS(UTF-16 길이)가 통과시키는 값을 거절하지 않는다
alter table public.weekly_report_rows
  alter column project_id set not null,
  alter column area_id set not null,
  drop constraint weekly_report_rows_report_id_fkey,
  add constraint weekly_report_rows_report_fk foreign key (report_id, project_id)
    references public.weekly_reports (id, project_id) on delete cascade,
  add constraint weekly_report_rows_area_fk foreign key (area_id, project_id, area_kind)
    references public.project_areas (id, project_id, kind) on delete restrict,
  add constraint weekly_report_rows_project_id_fkey foreign key (project_id)
    references public.projects (id) on delete cascade,
  add constraint weekly_report_rows_cells_len check (
    char_length(this_content) <= 20000 and char_length(this_issue) <= 20000
    and char_length(next_content) <= 20000 and char_length(next_issue) <= 20000);
create unique index weekly_report_rows_report_area_uidx on public.weekly_report_rows (report_id, area_id);
create index weekly_report_rows_project_idx on public.weekly_report_rows (project_id);   -- 직접 FK 의 캐스케이드를 받친다
create index weekly_report_rows_area_idx on public.weekly_report_rows (area_id);         -- 영역 삭제 검사용

-- ⑨ 축소 — 지운 열을 읽는 DB 함수는 없다. weekly_report_rows_report_idx(report_id, sort_order)는 열과 함께 사라지고 문서 조회는 ⑧ 의
-- 유일 인덱스가 앞 열 report_id 로 맡는다 ----------------------------------------------------------------------------------------------
alter table public.weekly_report_rows drop column section, drop column module, drop column sort_order;

-- ⑩ 정책·권한(D6·D27)·영역 불변(D46) — 세션의 구조 쓰기 길을 닫는다. 쓰기는 ⑪ 의 RPC 둘(service_role)뿐이다 ----------------------------
-- 주간 행: 읽기는 project_id 직접 술어(실시간 인가가 같은 정책을 쓴다), 갱신은 명단 멤버의 네 칸만(updated_at 은 ⑪ 의 트리거)
drop policy weekly_report_rows_ws_read on public.weekly_report_rows;
create policy weekly_report_rows_ws_read on public.weekly_report_rows for select to authenticated
  using (project_id in (select public.accessible_project_ids()));
drop policy weekly_report_rows_update on public.weekly_report_rows;
create policy weekly_report_rows_update on public.weekly_report_rows for update to authenticated
  using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));
drop policy weekly_report_rows_insert on public.weekly_report_rows;
drop policy weekly_report_rows_delete on public.weekly_report_rows;
revoke insert, update, delete on public.weekly_report_rows from authenticated;
grant update (this_content, this_issue, next_content, next_issue) on public.weekly_report_rows to authenticated;
-- 주간 문서: 생성은 create_weekly_report 뿐, 세션 삭제 길은 없다(앱의 마지막 사용처 — 보상 삭제 — 가 사라진다), 갱신은 제목만.
-- 읽기(weekly_reports_ws_read)·weekly_reports_update 정책은 그대로
drop policy weekly_reports_insert on public.weekly_reports;
drop policy weekly_reports_delete on public.weekly_reports;
revoke insert, update, delete on public.weekly_reports from authenticated;
grant update (title) on public.weekly_reports to authenticated;
-- 영역·영역-팀: 쓰기는 upsert_project_area 뿐(정본 §2.3.5 의 RLS 쓰기를 폐쇄로 바꾼다 — E26). 읽기 정책 그대로
drop policy project_areas_write on public.project_areas;
drop policy area_teams_write on public.area_teams;
revoke insert, update, delete on public.project_areas, public.area_teams from authenticated;
-- kind·project_id 불변(D46) — code 불변(0003)은 그대로. 3열 FK 는 행이 달린 영역의 kind 만 묶고, 행 없는 영역은 service_role 로 다른
-- 프로젝트로 옮길 수 있어 영역-팀이 프로젝트를 가로지른다(선례 PROJECT_MEMBER_PROJECT_IMMUTABLE — 0011)
create or replace function public.project_areas_guard() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
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

-- ⑪ 함수·트리거 — 도우미 하나, RPC 둘(service_role 만 실행), updated_at 트리거(Q13) -----------------------------------------------------
-- 행위자 등급 — upsert_project_member_cmd 의 판정과 같은 식(0012): 플랫폼 관리자 ∨ 그 프로젝트 워크스페이스의 관리자 ∨ (그 워크스페이스 멤버
-- ∧ 활성 명단 행·활성 인물의 access_role = 'admin'). 정책은 부르지 않는다 — DEFINER RPC 넷(주간 둘·가져오기·전환)이 RLS 가 빠진 자리의
-- 2차 방어선으로 쓴다(D17·D28·D54). 행위자·프로젝트가 null 이면 false
create function public.actor_is_project_admin(p_actor uuid, p_project_id uuid) returns boolean
language sql stable security definer set search_path to '' as $$
  select p_actor is not null and p_project_id is not null and (
    exists (select 1 from public.platform_admins a where a.user_id = p_actor)
    or exists (select 1 from public.projects p
                 join public.workspace_members m on m.workspace_id = p.workspace_id
                where p.id = p_project_id and m.user_id = p_actor and m.role = 'admin')
    or (exists (select 1 from public.projects p
                  join public.workspace_members m on m.workspace_id = p.workspace_id
                 where p.id = p_project_id and m.user_id = p_actor)
        and exists (select 1 from public.project_members pm join public.people pe on pe.id = pm.person_id
                     where pm.project_id = p_project_id and pe.user_id = p_actor
                       and pm.active and pe.active and pm.access_role = 'admin')))
$$;
revoke all on function public.actor_is_project_admin(uuid, uuid) from public, anon, authenticated;

-- 주간 문서 생성(D22·D33) — 잠금 아래에서 지금 활성인 주간 영역마다 1행(시드에 그 영역이 있으면 그 칸, 없으면 빈 칸) + 시드에만 있는
-- 영역(그새 끈 영역)의 행은 내용이 있을 때만 그 내용과 함께(D32 의 "내용 있음" — JS trim() 의 공백 집합). 같은 주 문서가 있으면 exists 로
-- 아무것도 바꾸지 않는다. 주 키 요일은 보지 않는다(액션이 mondayIso 로 정규화한다 — W30). 결과 rows = 넣은 행 수
create function public.create_weekly_report(p_actor uuid, p_project_id uuid, p_week_start date, p_seed jsonb) returns jsonb
language plpgsql security definer set search_path to '' set lock_timeout to '15s' as $$
declare
  v_space constant text := E'\t\n\x0B\f\r ' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
  v_report uuid;
  v_rows int;
  v_more int;
begin
  -- 1. 입력(잠금보다 먼저). 시드 원소는 객체이고 area_id(uuid 문자열)와 네 칸(문자열, 20,000자 이하)이 모두 있다. area_id 중복 없음
  if p_actor is null or p_project_id is null or p_week_start is null then
    raise exception using errcode = '22023', message = 'WEEKLY_INVALID_INPUT';
  end if;
  if p_seed is not null and pg_catalog.jsonb_typeof(p_seed) <> 'array' then
    raise exception using errcode = '22023', message = 'WEEKLY_SEED_INVALID';
  end if;
  if p_seed is not null and exists (
       select 1 from pg_catalog.jsonb_array_elements(p_seed) as s(e)
        where pg_catalog.jsonb_typeof(s.e) <> 'object'
           or pg_catalog.jsonb_typeof(s.e -> 'area_id') is distinct from 'string'
           or (s.e ->> 'area_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or exists (select 1 from pg_catalog.unnest(array['this_content', 'this_issue', 'next_content', 'next_issue']) as k(cell)
                       where pg_catalog.jsonb_typeof(s.e -> k.cell) is distinct from 'string'
                          or pg_catalog.char_length(s.e ->> k.cell) > 20000)) then
    raise exception using errcode = '22023', message = 'WEEKLY_SEED_INVALID';
  end if;
  if p_seed is not null and (select pg_catalog.count(*) <> pg_catalog.count(distinct (s.e ->> 'area_id')::uuid)
                               from pg_catalog.jsonb_array_elements(p_seed) as s(e)) then
    raise exception using errcode = '22023', message = 'WEEKLY_SEED_INVALID';
  end if;
  -- 2. 잠금(영역 쓰기와 같은 키) → 격리 가드
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('weekly:' || p_project_id, 0));
  -- 격리 수준 규칙(H2 규칙 ③): 잠금 뒤 같은 주 문서·활성 영역을 읽어 판정하므로 read committed 가 아니면 거절한다.
  -- 이 가드에서 놓치는 것: 잠금을 기다리는 사이 커밋된 같은 주 문서·영역 변경 — 스냅샷이 고정된 수준에서는 보지 못해 아래 4 를 지나 23505 가 나거나 새 영역의 행이 빠진다.
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using errcode = '25001', message = 'WEEKLY_ISOLATION';
  end if;
  -- 3. 등급(DEFINER 라 RLS 가 빠진 자리 — D28) → 프로젝트
  if not public.actor_is_project_admin(p_actor, p_project_id) then
    raise exception using errcode = '42501', message = 'WEEKLY_FORBIDDEN';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception using errcode = 'P0002', message = 'PROJECT_NOT_FOUND';
  end if;
  -- 4. 같은 주 문서(D33 — (project_id, week_start) 유일이 자연 멱등이다)
  select r.id into v_report from public.weekly_reports r where r.project_id = p_project_id and r.week_start = p_week_start;
  if v_report is not null then
    return pg_catalog.jsonb_build_object('status', 'exists', 'report_id', v_report);
  end if;
  -- 5. 활성 주간 영역이 없으면 거절(임의 구분을 만들지 않는다)
  if not exists (select 1 from public.project_areas a
                  where a.project_id = p_project_id and a.kind = 'weekly_section' and a.active) then
    raise exception using errcode = '23514', message = 'WEEKLY_AREAS_REQUIRED';
  end if;
  -- 6. 문서 → 활성 영역마다 1행 → 시드에만 있는 영역의 내용 있는 행(이 프로젝트의 주간 영역이 아니면 FK 23503)
  insert into public.weekly_reports (project_id, week_start) values (p_project_id, p_week_start) returning id into v_report;
  insert into public.weekly_report_rows (report_id, project_id, area_id, this_content, this_issue, next_content, next_issue)
  select v_report, p_project_id, a.id,
         coalesce(s.e ->> 'this_content', ''), coalesce(s.e ->> 'this_issue', ''),
         coalesce(s.e ->> 'next_content', ''), coalesce(s.e ->> 'next_issue', '')
    from public.project_areas a
    left join pg_catalog.jsonb_array_elements(coalesce(p_seed, '[]'::jsonb)) as s(e) on (s.e ->> 'area_id')::uuid = a.id
   where a.project_id = p_project_id and a.kind = 'weekly_section' and a.active;
  get diagnostics v_rows = row_count;
  insert into public.weekly_report_rows (report_id, project_id, area_id, this_content, this_issue, next_content, next_issue)
  select v_report, p_project_id, (s.e ->> 'area_id')::uuid,
         s.e ->> 'this_content', s.e ->> 'this_issue', s.e ->> 'next_content', s.e ->> 'next_issue'
    from pg_catalog.jsonb_array_elements(coalesce(p_seed, '[]'::jsonb)) as s(e)
   where not exists (select 1 from public.project_areas a
                      where a.id = (s.e ->> 'area_id')::uuid and a.project_id = p_project_id
                        and a.kind = 'weekly_section' and a.active)
     and (pg_catalog.btrim(s.e ->> 'this_content', v_space) <> '' or pg_catalog.btrim(s.e ->> 'this_issue', v_space) <> ''
          or pg_catalog.btrim(s.e ->> 'next_content', v_space) <> '' or pg_catalog.btrim(s.e ->> 'next_issue', v_space) <> '');
  get diagnostics v_more = row_count;
  -- 7. 결과
  return pg_catalog.jsonb_build_object('status', 'created', 'report_id', v_report, 'rows', v_rows + v_more);
end
$$;
revoke all on function public.create_weekly_report(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.create_weekly_report(uuid, uuid, date, jsonb) to service_role;

-- 영역 쓰기(D25·D26·D27) — 만들기·고치기, 영역-팀 맞추기, 활성 주간 영역의 행 백필(W17)을 한 트랜잭션으로. 클라이언트가 준 영역 id 를 그
-- 프로젝트로 묶는 것은 4 의 술어 하나다(DEFINER 라 RLS 가 빠지고 등급 판정은 p_project_id 만 본다 — Q11). 비활성화는 행을 지우지 않는다(D32 가
-- 화면에서 숨긴다). 마지막 활성 주간 영역의 비활성화는 막지 않는다 — 문서 생성만 WEEKLY_AREAS_REQUIRED(H2 규칙 ④ 해당 없음)
create function public.upsert_project_area(p_actor uuid, p_project_id uuid, p_area jsonb, p_teams jsonb, p_from_week date) returns jsonb
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
revoke all on function public.upsert_project_area(uuid, uuid, jsonb, jsonb, date) from public, anon, authenticated;
grant execute on function public.upsert_project_area(uuid, uuid, jsonb, jsonb, date) to service_role;

-- updated_at 트리거(Q13) — 두 표의 updated_at 은 세션 열 권한 밖이고 이 트리거가 매긴다. ⑥ 뒤에 만들어 병합의 max(updated_at)을 덮지 않는다
-- (선례 project_members_guard 의 new.updated_at := now() — 0011). INVOKER — 트리거 함수는 실행 권한을 보지 않는다
create function public.weekly_touch_updated_at() returns trigger
language plpgsql set search_path to '' as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;
revoke all on function public.weekly_touch_updated_at() from public, anon, authenticated;
create trigger weekly_reports_touch before update on public.weekly_reports
  for each row execute function public.weekly_touch_updated_at();
create trigger weekly_report_rows_touch before update on public.weekly_report_rows
  for each row execute function public.weekly_touch_updated_at();

-- ⑫ 사후검사 — 이 파일이 만든 모양을 카탈로그에서 다시 읽는다. 하나라도 어긋나면 WEEKLY_AREAS_POSTCHECK 로 멈추고 파일 전체가 되돌아간다.
-- 읽기만 한다(테스트가 이 블록을 원문에서 떠서 적용 뒤에 다시 돌린다 — tests/rls/weekly-areas.test.ts 의 민감도). 기대표의 근거는 ⑧~⑪ ------
do $$
declare
  v text;
begin
  -- 남은 열(⑨) — section·module·sort_order 없음, 새 열 셋은 ③ 의 순서
  select string_agg(a.attname::text, ',' order by a.attnum) into v
    from pg_attribute a where a.attrelid = 'public.weekly_report_rows'::regclass and a.attnum > 0 and not a.attisdropped;
  if v is distinct from 'id,report_id,this_content,this_issue,next_content,next_issue,updated_at,project_id,area_id,area_kind' then
    raise exception 'WEEKLY_AREAS_POSTCHECK: 주간 행의 열이 기대와 다르다: %', v;
  end if;
  if not (select bool_and(a.attnotnull) from pg_attribute a
           where a.attrelid = 'public.weekly_report_rows'::regclass and a.attname in ('project_id', 'area_id')) then
    raise exception 'WEEKLY_AREAS_POSTCHECK: project_id·area_id 가 NOT NULL 이 아니다';
  end if;

  -- FK(⑧) — 주간 행에서 나가는 FK 는 정확히 셋: 문서(복합, cascade)·영역(복합, restrict)·프로젝트(직접, cascade). 옛 단일 FK 없음
  select string_agg(format('%s>%s:%s', c.conname, c.confrelid::regclass, c.confdeltype), ', ' order by c.conname) into v
    from pg_constraint c where c.conrelid = 'public.weekly_report_rows'::regclass and c.contype = 'f';
  if v is distinct from 'weekly_report_rows_area_fk>project_areas:r, weekly_report_rows_project_id_fkey>projects:c, '
                        || 'weekly_report_rows_report_fk>weekly_reports:c' then
    raise exception 'WEEKLY_AREAS_POSTCHECK: 주간 행의 FK 가 기대와 다르다: %', v;
  end if;

  -- 유일 인덱스(②⑧) — 문서당 영역 하나, 복합 FK 의 대상 둘
  select string_agg(x.idx, ', ') into v
    from (values ('weekly_report_rows_report_area_uidx'), ('project_areas_id_project_kind_uidx'), ('weekly_reports_id_project_uidx')) as x(idx)
   where not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.' || x.idx) and i.indisunique and i.indisvalid);
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: 유일 인덱스가 없다: %', v; end if;

  -- 정책(⑩) — 표마다 명령 목록(authenticated). 주간 행·문서는 select·update, 영역·영역-팀은 select 뿐
  select string_agg(format('%s=%s', t.tbl, coalesce(p.cmds, '-')), ', ' order by t.tbl) into v
    from (values ('area_teams'), ('project_areas'), ('weekly_report_rows'), ('weekly_reports')) as t(tbl)
    left join lateral (select string_agg(q.cmd, '+' order by q.cmd) as cmds from pg_policies q
                        where q.schemaname = 'public' and q.tablename = t.tbl) p on true;
  if v is distinct from 'area_teams=SELECT, project_areas=SELECT, weekly_report_rows=SELECT+UPDATE, weekly_reports=SELECT+UPDATE' then
    raise exception 'WEEKLY_AREAS_POSTCHECK: 정책이 기대와 다르다: %', v;
  end if;

  -- 권한은 있는데 그 명령(또는 ALL)의 정책이 없는 DML — 0 이어야 한다(0011 ⑪·0012 ⑫ 와 같은 쿼리)
  select string_agg(format('%s:%s', t.relname, cmd.cmd), ', ') into v
    from pg_class t cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) as cmd(cmd)
   where t.relnamespace = 'public'::regnamespace and t.relkind in ('r', 'p')
     and (case when cmd.cmd = 'DELETE' then has_table_privilege('authenticated', t.oid, 'DELETE')
               else has_any_column_privilege('authenticated', t.oid, cmd.cmd) end)
     and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.relname
                      and p.cmd in (cmd.cmd, 'ALL') and p.roles && array['authenticated', 'public']::name[]);
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: 정책 없는 DML 권한: %', left(v, 800); end if;

  -- authenticated 의 쓰기 권한(⑩) — 주간 행은 네 칸 UPDATE, 주간 문서는 title UPDATE 뿐. INSERT·DELETE 없음, 영역·영역-팀은 쓰기 0
  select string_agg(format('%s.%s:%s', x.tbl, a.attname, x.priv), ', ' order by x.tbl, a.attnum, x.priv) into v
    from (values ('weekly_report_rows'), ('weekly_reports'), ('project_areas'), ('area_teams')) as t(tbl)
   cross join lateral (select t.tbl, p.priv from (values ('INSERT'), ('UPDATE')) as p(priv)) x
    join pg_attribute a on a.attrelid = ('public.' || x.tbl)::regclass and a.attnum > 0 and not a.attisdropped
   where has_column_privilege('authenticated', ('public.' || x.tbl)::regclass, a.attname, x.priv);
  if v is distinct from 'weekly_report_rows.this_content:UPDATE, weekly_report_rows.this_issue:UPDATE, '
                        || 'weekly_report_rows.next_content:UPDATE, weekly_report_rows.next_issue:UPDATE, weekly_reports.title:UPDATE' then
    raise exception 'WEEKLY_AREAS_POSTCHECK: authenticated 의 열 권한이 기대와 다르다: %', left(coalesce(v, '(없음)'), 800);
  end if;
  select string_agg(t.tbl, ', ') into v
    from (values ('weekly_report_rows'), ('weekly_reports'), ('project_areas'), ('area_teams')) as t(tbl)
   where has_table_privilege('authenticated', ('public.' || t.tbl)::regclass, 'DELETE')
      or has_table_privilege('authenticated', ('public.' || t.tbl)::regclass, 'TRUNCATE');
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: authenticated 가 지운다: %', v; end if;

  -- updated_at 트리거 둘 존재·활성(꺼짐 D, 복제 세션 전용 R 은 실패 — 0012 ⑫ 와 같은 기준)
  select string_agg(x.name, ', ') into v
    from (values ('weekly_reports', 'weekly_reports_touch'), ('weekly_report_rows', 'weekly_report_rows_touch')) as x(tbl, name)
   where not exists (select 1 from pg_trigger g
                      where g.tgrelid = ('public.' || x.tbl)::regclass and g.tgname = x.name
                        and not g.tgisinternal and g.tgenabled in ('O', 'A'));
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: 트리거가 없다: %', v; end if;

  -- 이 파일이 만든 함수의 EXECUTE 기대표(실효 권한 — 0012 ⑫ 꼴, Q40). anon·authenticated 는 전부 false, service_role 은 RPC 둘만 본다
  -- (도우미·트리거 함수는 기본 권한이 service_role 에 준 대로 둔다 — 거짓을 기대하면 거짓 실패한다)
  select string_agg(format('%s:%s=%s', e.fn, e.role, not e.want), ', ') into v
    from (
      select f.fn, r.role, (r.role = 'service_role' and f.service) as want
        from (values
          ('public.actor_is_project_admin(uuid, uuid)', false),
          ('public.create_weekly_report(uuid, uuid, date, jsonb)', true),
          ('public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)', true),
          ('public.weekly_touch_updated_at()', false),
          ('public.project_areas_guard()', false)) as f(fn, service)
       cross join unnest(array['anon', 'authenticated', 'service_role']) as r(role)) e
   where has_function_privilege(e.role, e.fn::regprocedure, 'EXECUTE') is distinct from e.want
     and not (e.role = 'service_role' and not e.want);
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: 함수 EXECUTE 가 기대와 다르다: %', v; end if;

  -- 잠금 상한(§3.1 — A F-8): 주간 RPC 둘의 proconfig 에 lock_timeout=15s(가져오기·전환 둘은 *_command_receipts ⑦ 이 본다)
  select string_agg(x.fn, ', ') into v
    from (values ('public.create_weekly_report(uuid, uuid, date, jsonb)'), ('public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where not coalesce('lock_timeout=15s' = any(p.proconfig), false);
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: lock_timeout 이 15s 가 아니다: %', v; end if;

  -- DEFINER·search_path ''(§3.1 함수 규칙): 도우미·RPC 둘. 본문이 public.·pg_catalog. 로 한정돼도 연산자 해석은 search_path 를 따른다
  select string_agg(x.fn, ', ') into v
    from (values ('public.actor_is_project_admin(uuid, uuid)'), ('public.create_weekly_report(uuid, uuid, date, jsonb)'),
                 ('public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where not p.prosecdef or not coalesce('search_path=""' = any(p.proconfig), false);
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: DEFINER·search_path 가 기대와 다르다: %', v; end if;

  -- 잠금 뒤 다른 행을 읽는 RPC 둘의 격리 검사 문자열(H2 ③ — 0012 ⑫ 와 같은 문장)
  select string_agg(x.fn, ', ') into v
    from (values ('public.create_weekly_report(uuid, uuid, date, jsonb)'), ('public.upsert_project_area(uuid, uuid, jsonb, jsonb, date)')) as x(fn)
    join pg_proc p on p.oid = x.fn::regprocedure
   where position('if pg_catalog.current_setting(''transaction_isolation'') is distinct from ''read committed'' then' in p.prosrc) = 0
      or position('WEEKLY_ISOLATION' in p.prosrc) = 0;
  if v is not null then raise exception 'WEEKLY_AREAS_POSTCHECK: 격리 수준 검사가 없다: %', v; end if;

  -- 영역 가드(⑩ — D46): code·kind·project_id 불변 셋이 본문에 있고 가드 트리거가 살아 있다
  select p.prosrc into v from pg_proc p where p.oid = 'public.project_areas_guard()'::regprocedure;
  if position('PROJECT_AREA_CODE_IMMUTABLE' in v) = 0 or position('PROJECT_AREA_KIND_IMMUTABLE' in v) = 0
     or position('PROJECT_AREA_PROJECT_IMMUTABLE' in v) = 0 then
    raise exception 'WEEKLY_AREAS_POSTCHECK: project_areas_guard 가 kind·project_id 를 보지 않는다';
  end if;
  if not exists (select 1 from pg_trigger g where g.tgrelid = 'public.project_areas'::regclass and not g.tgisinternal
                   and g.tgfoid = 'public.project_areas_guard()'::regprocedure and g.tgenabled in ('O', 'A')) then
    raise exception 'WEEKLY_AREAS_POSTCHECK: project_areas_guard 트리거가 없다';
  end if;

  -- 실시간 발행 — 주간 행이 그대로 supabase_realtime 에 있다(편집기의 갱신 구독 — RF2)
  if not exists (select 1 from pg_publication_tables t where t.pubname = 'supabase_realtime'
                   and t.schemaname = 'public' and t.tablename = 'weekly_report_rows') then
    raise exception 'WEEKLY_AREAS_POSTCHECK: weekly_report_rows 가 supabase_realtime 발행에 없다';
  end if;
end $$;
