-- *_weekly_areas 롤백 — 이 파일 직전 마이그레이션까지 적용한 카탈로그로 돌아간다(카탈로그 불일치 0: supabase/rehearsal/compare-catalog.mjs diff,
-- pg_default_acl 대조 — SP4 Phase A1 계획의 리허설 R). 절은 정방향의 역순이다. 함수 본문은 원문 바이트 그대로 붙인다(sed — 손으로 옮기지 않는다).
-- 먼저: *_command_receipts 가 적용돼 있으면 그 롤백(supabase/rollbacks/*_command_receipts_rollback.sql)을 먼저 한다 — 그 파일의 두 RPC
--   (import_wbs_cmd·convert_inherited_teams)가 이 파일의 도우미 actor_is_project_admin 을 부르는데, plpgsql 본문은 의존이 추적되지 않아
--   도우미 drop 이 성공하고 두 RPC 가 실행 때 42883 으로 깨진다. 아래 첫 문장이 그 상태를 보면 멈춘다(스펙 §3.2 롤백 — A F-6).
-- 되돌리지 않는 데이터:
--   · 이관(⑤)이 만든 영역 행 — 남는다(이전 스키마도 받아들인다)
--   · 병합(⑥)된 중복 행 — 다시 나뉘지 않는다. 내용은 남은 행의 칸에 이어 붙은 채다
--   · module — 열은 '' 로 돌아온다. 모듈 이름은 칸 내용 첫 줄의 머리표 [모듈] 로만 남는다(롤백은 머리표를 지우지 않는다 — T4)
--   · 이관 뒤 바꾼 영역 이름 — section 은 영역 code 로 돌아간다(이름이 아니다: code 는 트리거로 불변이라 롤백 → 재적용 왕복에서 ⑤ 가 같은
--     영역을 재사용한다 — Q33)
--   · SP4 경로로 만든 행의 원래 순서 — sort_order 는 그 문서 안 영역 순서(sort_order, code, id — D32)의 순위로 매긴다
--   · 트리거(⑪)가 매긴 updated_at — 그 값 그대로 옮긴다
--   · 기존 영역 code 의 비반각 앞뒤 공백(NBSP·U+3000·탭 — 0003 의 code 검사는 반각만 본다. SQL·service_role 로 만든 영역만 해당) —
--     section 은 그 code 그대로 돌아가고 재적용의 ⑤ 는 다듬은 라벨로 찾으므로 그 행은 다른 영역(신설·재사용)으로 간다. 내용 손실은 없다(⑦)
--   · modules.* 를 건드리지 않는다 — CR-4 해당 없음(이월은 스펙 §9). 0006·0012 소유 함수는 지우지 않는다
-- 재생성하는 표의 이전 모양(0012 적용 뒤 — 2026-10-01 main 81deae9 실측): weekly_report_rows 10열 id uuid default gen_random_uuid(),
--   report_id uuid, section text default '', module text default '', sort_order integer default 1, this_content·this_issue·next_content·next_issue
--   text default '', updated_at timestamptz default now()(전부 NOT NULL — 0000_baseline.sql 의 CREATE TABLE), PK weekly_report_rows_pkey(id),
--   FK weekly_report_rows_report_id_fkey(report_id) → weekly_reports(id) on delete cascade, 인덱스 weekly_report_rows_report_idx
--   (report_id, sort_order), RLS 켜짐, 정책 넷(weekly_report_rows_ws_read 는 0006 본문, _insert·_update·_delete 는 0000 본문), 권한
--   anon=r · authenticated=arwd · service_role=arwdDxtm, supabase_realtime 발행 표.

begin;
-- 순서 정지 — *_command_receipts 의 두 RPC 가 남아 있으면 그 롤백을 먼저 한다(머리 주석 '먼저'). 카탈로그를 바꾸지 않는다
do $$
begin
  if pg_catalog.to_regprocedure('public.import_wbs_cmd(uuid,uuid,text,jsonb,jsonb,uuid)') is not null
     or pg_catalog.to_regprocedure('public.convert_inherited_teams(uuid,uuid)') is not null then
    raise exception 'WEEKLY_AREAS_ROLLBACK_ORDER: *_command_receipts 롤백을 먼저 한다';
  end if;
end $$;

-- ⑪ 함수·트리거 — 트리거 둘을 먼저 지우고 함수 넷(트리거 함수·RPC 둘·도우미)
drop trigger weekly_report_rows_touch on public.weekly_report_rows;
drop trigger weekly_reports_touch on public.weekly_reports;
drop function public.weekly_touch_updated_at();
drop function public.upsert_project_area(uuid, uuid, jsonb, jsonb, date);
drop function public.create_weekly_report(uuid, uuid, date, jsonb);
drop function public.actor_is_project_admin(uuid, uuid);

-- ⑩ 정책·권한·영역 불변 — 영역 가드는 0003 원문 바이트 그대로(본문은 sed 로 옮긴다 — 계획 과제 12 Step 4 의 대조), 영역·영역-팀 쓰기는
--   0003 의 정책 본문과 0011 뒤의 권한(authenticated arwd). 주간 문서는 열 권한을 먼저 걷고(표 권한을 되돌려도 열 권한은 남아 R 에 한 줄
--   차이로 잡힌다 — A F-9) 표 권한·정책(0000 본문)을 되살린다
create or replace function public.project_areas_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.code is distinct from old.code then
    raise exception using errcode = '23514', message = 'PROJECT_AREA_CODE_IMMUTABLE';
  end if;
  return new;
end
$$;
grant insert, update, delete on public.project_areas, public.area_teams to authenticated;
create policy project_areas_write on public.project_areas to authenticated
  using (public.is_project_admin(project_id)) with check (public.is_project_admin(project_id));
create policy area_teams_write on public.area_teams to authenticated
  using (exists (select 1 from public.project_areas a
                  where a.id = area_teams.area_id and public.is_project_admin(a.project_id)))
  with check (exists (select 1 from public.project_areas a
                  where a.id = area_teams.area_id and public.is_project_admin(a.project_id)));
revoke update (title) on public.weekly_reports from authenticated;
grant insert, update, delete on public.weekly_reports to authenticated;
create policy weekly_reports_insert on public.weekly_reports for insert to authenticated
  with check (public.is_project_admin(project_id));
create policy weekly_reports_delete on public.weekly_reports for delete to authenticated
  using (public.is_project_admin(project_id));

-- ⑨⑧③ weekly_report_rows 재생성 — 열 drop·add 가 아니라 이전 모양으로 다시 만든다(머리의 '재생성하는 표의 이전 모양'). 데이터는 같은 id 로
--   옮긴다: section = 영역 code(트리거로 불변 — 롤백 → 재적용 왕복에서 ⑤ 가 같은 영역을 재사용한다, Q33), module = '', sort_order = 그 문서
--   안에서 영역 순서(sort_order, code, id — D32)의 순위. 칸·updated_at 은 그대로. 주간 행의 projects 직접 FK 는 이전 모양에 없어 따로 지울 것이 없다
create temp table sp4_wa_keep on commit drop as
select w.id, w.report_id, a.code as section, ''::text as module,
       (row_number() over (partition by w.report_id order by a.sort_order, a.code collate "C", a.id))::int as sort_order,
       w.this_content, w.this_issue, w.next_content, w.next_issue, w.updated_at
  from public.weekly_report_rows w join public.project_areas a on a.id = w.area_id;
drop table public.weekly_report_rows;
create table public.weekly_report_rows (
  id uuid default gen_random_uuid() not null,
  report_id uuid not null,
  section text default ''::text not null,
  module text default ''::text not null,
  sort_order integer default 1 not null,
  this_content text default ''::text not null,
  this_issue text default ''::text not null,
  next_content text default ''::text not null,
  next_issue text default ''::text not null,
  updated_at timestamp with time zone default now() not null
);
alter table only public.weekly_report_rows add constraint weekly_report_rows_pkey primary key (id);
create index weekly_report_rows_report_idx on public.weekly_report_rows using btree (report_id, sort_order);
alter table only public.weekly_report_rows add constraint weekly_report_rows_report_id_fkey
  foreign key (report_id) references public.weekly_reports(id) on delete cascade;
alter table public.weekly_report_rows enable row level security;
create policy weekly_report_rows_ws_read on public.weekly_report_rows for select to authenticated
  using (exists (select 1 from public.weekly_reports r where r.id = weekly_report_rows.report_id
                   and r.project_id in (select public.accessible_project_ids())));
create policy weekly_report_rows_insert on public.weekly_report_rows for insert to authenticated
  with check (exists (select 1 from public.weekly_reports r
                       where r.id = weekly_report_rows.report_id and public.is_project_member(r.project_id)));
create policy weekly_report_rows_update on public.weekly_report_rows for update to authenticated
  using (exists (select 1 from public.weekly_reports r
                  where r.id = weekly_report_rows.report_id and public.is_project_member(r.project_id)))
  with check (exists (select 1 from public.weekly_reports r
                       where r.id = weekly_report_rows.report_id and public.is_project_member(r.project_id)));
create policy weekly_report_rows_delete on public.weekly_report_rows for delete to authenticated
  using (exists (select 1 from public.weekly_reports r
                  where r.id = weekly_report_rows.report_id and public.is_project_admin(r.project_id)));
revoke all on public.weekly_report_rows from anon, authenticated;
grant select on public.weekly_report_rows to anon;
grant select, insert, update, delete on public.weekly_report_rows to authenticated;
grant all on public.weekly_report_rows to service_role;
alter publication supabase_realtime add table public.weekly_report_rows;
insert into public.weekly_report_rows (id, report_id, section, module, sort_order, this_content, this_issue, next_content, next_issue, updated_at)
select k.id, k.report_id, k.section, k.module, k.sort_order, k.this_content, k.this_issue, k.next_content, k.next_issue, k.updated_at
  from pg_temp.sp4_wa_keep k;

-- ⑦⑥⑤ 라벨 → 영역·머리표·병합·전후 대조 — 데이터만 바꾼다(카탈로그 변화 없음 — 임시 표는 커밋에, 세션 함수는 연결 끝에 사라진다).
--      되돌리지 않는다(머리의 '되돌리지 않는 데이터'): 영역 행은 남고, section 은 재생성 블록(⑨⑧③)이 영역 code 로 되살린다
-- ② 선행 유일 인덱스 — ③④ 의 열은 위 재생성(⑨⑧③)이 없앴고, 이 인덱스에 기대던 복합 FK 도 표와 함께 사라졌다
drop index public.weekly_reports_id_project_uidx;
drop index public.project_areas_id_project_kind_uidx;

commit;
