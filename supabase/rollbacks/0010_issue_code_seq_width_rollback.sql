-- 0010_issue_code_seq_width 롤백 — 0009 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: compare-catalog.mjs diff).
-- 되돌린 상태는 결함 그대로다: 일련번호 100 이상이면 코드가 잘려 그 영역의 분류가 23505 로 막힌다.
-- 가드: mega_seq >= 100 인 행이 있으면 멈춘다 — 그 행의 'PI-I-xx-100' 코드는 원래의 lpad(…, 2) CHECK 를 어긴다.
-- 본문 출처: 0000_baseline.sql:1036-1109 원문(0001~0009 에서 바뀐 적 없음).

begin;

do $$
begin
  if exists (select 1 from public.issues where mega_seq >= 100) then
    raise exception 'ISSUE_SEQ_WIDTH_ROLLBACK_BLOCKED: mega_seq >= 100 인 이슈가 있어 원래 CHECK 로 돌아갈 수 없다'
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
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, 2, '0');
  return new;
end
$$;

alter table public.issues
  drop constraint issues_analysis_code_consistency_check,
  add constraint issues_analysis_code_consistency_check check (
    ((mega_code is null) and (mega_seq is null) and (pi_issue_code is null))
    or ((mega_code is not null) and (mega_seq is not null) and (mega_seq > 0)
        and (pi_issue_code = (('PI-I-'::text || mega_code) || '-'::text || lpad((mega_seq)::text, 2, '0'::text))))
  );

commit;
