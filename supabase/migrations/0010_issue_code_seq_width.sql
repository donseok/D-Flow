-- 0010_issue_code_seq_width — 이슈 분석 코드(PI-I-<영역>-<일련번호>)의 일련번호가 100 이상이면 잘리던 결함을 고친다.
--
-- 0000 의 assign_issue_analysis_code() 는 pg_catalog.lpad(v_seq::text, 2, '0') 로 코드를 만든다. lpad 는 목표 길이보다 긴
-- 문자열을 잘라 100 이 '10' 이 된다 — 같은 (프로젝트, 영역)의 10번과 코드가 겹쳐 issues_project_pi_code_uidx 가 23505 로 막고,
-- 카운터 증가도 같은 문장에서 롤백돼 그 영역은 더 분류할 수 없다(10번을 지웠다면 100번이 조용히 '-10' 을 재사용한다).
-- CHECK issues_analysis_code_consistency_check 도 같은 식이라 잘린 코드를 통과시켰다. TS(formatPiIssueCode)는 자르지 않는다.
--
-- 바꾼 것: 함수 본문의 한 줄(0000_baseline.sql:1106)과 CHECK 식을 greatest(2, length) 폭으로. 나머지 본문은 0000 그대로다
-- (0001~0009 는 이 함수·제약을 다시 정의하지 않았다).
-- CREATE OR REPLACE 는 proconfig 를 바꾸므로 SET search_path TO '' 를 다시 적는다(소유자·ACL·트리거 바인딩은 유지된다).
-- 가드: mega_seq >= 100 인 행이 있으면 멈춘다 — 그 행의 코드는 이미 잘려 있고 ISSUE_CODE_IMMUTABLE 때문에 백필할 수 없다.
-- 롤백: supabase/rollbacks/0010_issue_code_seq_width_rollback.sql.

do $$
begin
  if exists (select 1 from public.issues where mega_seq >= 100) then
    raise exception 'ISSUE_SEQ_WIDTH_PRECONDITION: mega_seq >= 100 인 이슈가 있다 — 잘린 코드를 먼저 수동으로 정리한다'
      using errcode = '23514';
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public.assign_issue_analysis_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  v_active boolean;
  v_seq bigint;
begin
  if tg_op = 'UPDATE' then
    if old.mega_code is not null
       or old.mega_seq is not null
       or old.pi_issue_code is not null then
      if old.mega_code is null
         or old.mega_seq is null
         or old.pi_issue_code is null then
        raise exception 'ISSUE_CODE_INCONSISTENT' using errcode = '23514';
      end if;
      if new.project_id is distinct from old.project_id
         or new.mega_code is distinct from old.mega_code
         or new.mega_seq is distinct from old.mega_seq
         or new.pi_issue_code is distinct from old.pi_issue_code then
        raise exception 'ISSUE_CODE_IMMUTABLE' using errcode = '23514';
      end if;
      -- 0062: 체번된 이슈의 major 연결을 도로 끊는 것은 금지한다(헤더 계약 4항).
      -- 백필(null→값)과 교정(값→값)은 그대로 허용된다.
      if old.major_id is not null and new.major_id is null then
        raise exception 'ISSUE_MAJOR_UNSET_FORBIDDEN' using errcode = '23514';
      end if;
      return new;
    end if;
  end if;

  if new.mega_code is null then
    if new.mega_seq is not null or new.pi_issue_code is not null then
      raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
    end if;
    return new;
  end if;

  -- insert와 기존 미분류 이슈의 최초 분류 모두 seq/code 직접 주입을 허용하지 않는다.
  if new.mega_seq is not null or new.pi_issue_code is not null then
    raise exception 'ISSUE_CODE_MANAGED' using errcode = '23514';
  end if;

  -- 0062: pi 코드가 새로 체번되는 행은 Major Process 분류를 함께 갖춰야 한다.
  -- (레거시 분류 이슈의 기존 행 갱신은 위 UPDATE 불변 분기에서 이미 반환됐다.)
  if new.major_id is null then
    raise exception 'ISSUE_MAJOR_REQUIRED' using errcode = '23514';
  end if;

  select area.active
    into v_active
    from public.issue_mega_areas area
   where area.code = new.mega_code;
  if not found or not v_active then
    raise exception 'ISSUE_MEGA_INACTIVE_OR_UNKNOWN' using errcode = '23514';
  end if;

  insert into public.issue_number_counters as counter (
    project_id, mega_code, last_no, updated_at
  ) values (
    new.project_id, new.mega_code, 1, now()
  )
  on conflict (project_id, mega_code) do update
    set last_no = counter.last_no + 1,
        updated_at = now()
  returning last_no into v_seq;

  new.mega_seq := v_seq;
  new.pi_issue_code :=
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, greatest(2, pg_catalog.length(v_seq::text)), '0');
  return new;
end
$$;

-- 제약은 한 ALTER TABLE 에서 지우고 같은 이름으로 다시 건다(검증은 기존 행 전부에 대해 돈다 — 위 가드로 위반 행이 없다).
alter table public.issues
  drop constraint issues_analysis_code_consistency_check,
  add constraint issues_analysis_code_consistency_check check (
    ((mega_code is null) and (mega_seq is null) and (pi_issue_code is null))
    or ((mega_code is not null) and (mega_seq is not null) and (mega_seq > 0)
        and (pi_issue_code = (('PI-I-'::text || mega_code) || '-'::text
             || pg_catalog.lpad((mega_seq)::text, greatest(2, pg_catalog.length((mega_seq)::text)), '0'::text))))
  );
