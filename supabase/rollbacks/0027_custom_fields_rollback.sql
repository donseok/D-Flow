-- SP5c rollback; caller must run in a transaction. Refuse silent data/definition loss.
do $$
begin
  if exists(select 1 from public.wbs_items where custom <> '{}'::jsonb)
     or exists(select 1 from public.issues where custom <> '{}'::jsonb)
     or exists(select 1 from public.weekly_report_rows where custom <> '{}'::jsonb)
     or exists(select 1 from public.project_settings s cross join lateral jsonb_each(s."values") e where e.key in ('fields.wbs_item','fields.issue','fields.weekly_row') and e.value <> '[]'::jsonb) then
    raise exception using errcode='23514',message='CUSTOM_FIELDS_ROLLBACK_IN_USE';
  end if;
end $$;
create or replace function public.settings_ref_check(p_project_id uuid, p_key text, p_old jsonb, p_new jsonb)
returns void language plpgsql set search_path to '' as $$
declare
  v_rules jsonb;
  v_weeks jsonb;
  v_old jsonb;
  v_new jsonb;
  v_hit record;
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
  -- SP5b(스펙 §3.2 ⑧, 비평 반영 — S8): 이슈 표시 상태 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의 이슈 쓰기가
  -- 22023 으로 멈춘다 — DB 쪽 마지막 방어), 그다음 빠진 code(removed)·범주가 바뀐 code(category)의 참조 이슈 수. 비활성은 참조가 있어도 된다.
  if p_key = 'workflow.issue_statuses' then
    v_new := public.issue_statuses_of(case when p_new is null then '{}'::jsonb
                                           else pg_catalog.jsonb_build_object('workflow.issue_statuses', p_new) end);
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'category' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null or (n ->> 'category') is distinct from (o ->> 'category')) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  -- SP5b W1(스펙 §3.3 ⑨, 비평 반영 — S8·B-21): workflow.* 여섯 키 — 새 값의 SQL 모양 검사를 먼저(TS 만 통과한 값이 저장되면 그 프로젝트의
  -- 흐름 사건이 22023 으로 멈춘다 — DB 쪽 마지막 방어). workflow.approval_steps 는 대기 라운드의 스냅샷 단계 삭제(pending_round)와 대기 단계의
  -- 승인자 넓히기(approver_widen — admin → subtree_or_admin)를 거부한다. 대기 라운드 = im 이고 스냅샷에 미승인 단계가 있음, 또는 xx 이고 스냅샷이
  -- 있음(unapprove 가 마지막 단계를 되살린다). 좁히기(→ admin)는 언제나 허용 — 권한을 넓히지 않는다. 옛 값이 손상이면 승인자를 모두 admin 으로 본다.
  if p_key in ('workflow.stage_credits', 'workflow.credit_policy', 'workflow.approval_steps',
               'workflow.approval_distinct_approvers', 'workflow.predecessor_gate', 'workflow.wbs_stage_labels') then
    v_new := public.workflow_value_of(case when p_new is null then '{}'::jsonb else pg_catalog.jsonb_build_object(p_key, p_new) end, p_key);
    if p_key = 'workflow.approval_steps' then
      begin
        v_old := public.workflow_value_of(case when p_old is null then '{}'::jsonb else pg_catalog.jsonb_build_object(p_key, p_old) end, p_key);
      exception when sqlstate '22023' then
        v_old := '[]'::jsonb;
      end;
      select s.code, pg_catalog.count(*) as cnt into v_hit
        from public.wbs_items w
        cross join lateral pg_catalog.unnest(w.review_steps) as s(code)
       where w.project_id = p_project_id and w.review_steps is not null
         and (w.stage = 'xx'
              or (w.stage = 'im' and exists (select 1 from pg_catalog.unnest(w.review_steps) as u(code)
                                              where not exists (select 1 from public.wbs_stage_approvals a
                                                                 where a.wbs_item_id = w.id and a.round = w.review_round
                                                                   and a.step_code = u.code and a.revoked_at is null))))
         and not exists (select 1 from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = s.code)
       group by s.code
       order by s.code
       limit 1;
      if found then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
          detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', 'pending_round', 'count', v_hit.cnt)::text;
      end if;
      select p.code, pg_catalog.count(*) as cnt into v_hit
        from (select case when w.stage = 'xx' then w.review_steps[pg_catalog.cardinality(w.review_steps)]
                          else (select s.code from pg_catalog.unnest(w.review_steps) with ordinality as s(code, i)
                                 where not exists (select 1 from public.wbs_stage_approvals a
                                                    where a.wbs_item_id = w.id and a.round = w.review_round
                                                      and a.step_code = s.code and a.revoked_at is null)
                                 order by s.i limit 1) end as code
                from public.wbs_items w
               where w.project_id = p_project_id and w.stage in ('im', 'xx') and w.review_steps is not null) p
       where p.code is not null
         and exists (select 1 from pg_catalog.jsonb_array_elements(v_new) e
                      where e ->> 'code' = p.code and e ->> 'approver' = 'subtree_or_admin')
         and coalesce((select o ->> 'approver' from pg_catalog.jsonb_array_elements(v_old) o where o ->> 'code' = p.code limit 1), 'admin') = 'admin'
       group by p.code
       order by p.code
       limit 1;
      if found then
        raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
          detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', 'approver_widen', 'count', v_hit.cnt)::text;
      end if;
    end if;
    return;
  end if;
  -- 어휘 네 키(SP5 B4 — D29·D58, 개정 §2.4.2): 옛 목록에 있고 새 목록에서 빠진 code, 또는 의미 속성(attendance.types 의 counts_as)이
  -- 바뀐 code 의 참조 행이 있으면 거부한다. 비활성은 참조가 있어도 된다(새 행만 막힌다 — 트리거). unset·옛 키 없음 = 제품 기본값.
  -- 원인 분류는 분기가 없다(분석 실행 JSON 참조 — TS 가 삭제 금지).
  if p_key in ('attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources') then
    v_old := coalesce(p_old, public.project_vocab_default(p_key));
    v_new := coalesce(p_new, public.project_vocab_default(p_key));
    if pg_catalog.jsonb_typeof(v_new) is distinct from 'array' then
      raise exception using errcode = '22023', message = 'CONFIG_INVALID:' || p_key;
    end if;
    select x.code, x.reason, x.cnt into v_hit
      from (select o ->> 'code' as code,
                   case when n is null then 'removed' else 'counts_as' end as reason,
                   public.project_vocab_ref_count(p_project_id, p_key, o ->> 'code') as cnt
              from pg_catalog.jsonb_array_elements(v_old) o
              left join lateral (select e from pg_catalog.jsonb_array_elements(v_new) e where e ->> 'code' = o ->> 'code' limit 1) nn(n) on true
             where n is null
                or (p_key = 'attendance.types' and (n ->> 'counts_as') is distinct from (o ->> 'counts_as'))) x
     where x.cnt > 0
     order by x.code
     limit 1;
    if found then
      raise exception using errcode = '23514', message = 'SETTINGS_CODE_IN_USE:' || p_key,
        detail = pg_catalog.jsonb_build_object('key', p_key, 'code', v_hit.code, 'reason', v_hit.reason, 'count', v_hit.cnt)::text;
    end if;
    return;
  end if;
  return;
end $$;
CREATE OR REPLACE FUNCTION public.guard_non_admin_column_scope() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  -- 서버·임포트 경로(service_role: auth.uid() is null)는 그대로 통과
  if auth.uid() is null then return new; end if;
  -- 판정 기준은 **old.project_id** 다. new 로 보면 "A 의 멤버이자 B 의 관리자"가
  -- project_id 를 B 로 바꾸는 UPDATE 한 번으로 컬럼 제한을 통째로 건너뛰고
  -- 이름·일정·가중치까지 재작성할 수 있다(B 관리자로 판정되므로).
  -- old 기준이면 project_id 변경 자체가 아래 diff 검사에 걸려 막힌다.
  if public.is_project_admin(old.project_id) then return new; end if;

  -- 그 외 전원(멤버·조회 전용·미상): 실적%·산출물만 허용
  if (to_jsonb(new) - 'actual_pct' - 'deliverable' - 'updated_at')
     is distinct from (to_jsonb(old) - 'actual_pct' - 'deliverable' - 'updated_at') then
    raise exception '실적%%·산출물만 수정할 수 있습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger wbs_items_custom_fields_trg on public.wbs_items;
drop trigger issues_custom_fields_trg on public.issues;
drop trigger weekly_report_rows_custom_fields_trg on public.weekly_report_rows;
alter table public.wbs_items drop column custom;
alter table public.issues drop column custom;
alter table public.weekly_report_rows drop column custom;
drop function public.backfill_custom_field(uuid,bigint,uuid,text,text,jsonb,uuid);
drop function public.purge_custom_field(uuid,bigint,uuid,text,text,bigint,uuid);
drop function public.custom_field_command(text,uuid,bigint,uuid,text,text,jsonb,bigint,uuid);
drop function public.enforce_custom_fields();
drop function public.custom_fields_ref_check(uuid,text,jsonb,jsonb);
drop function public.custom_field_table(text);
drop function public.custom_field_defs_of(text,jsonb);
drop function public.custom_value_error(jsonb,jsonb,jsonb);
-- Retain expanded receipt kinds when immutable historical receipts exist; do not delete audit data.
do $$
begin
  if not exists(select 1 from public.command_receipts where kind in ('custom_field_backfill','custom_field_purge')) then
    alter table public.command_receipts drop constraint command_receipts_kind_check;
    alter table public.command_receipts add constraint command_receipts_kind_check check(kind in ('wbs_import'));
    alter table public.command_receipts drop constraint command_receipts_project_required;
    alter table public.command_receipts add constraint command_receipts_project_required check(kind <> 'wbs_import' or project_id is not null);
  end if;
end $$;
