-- *_vocab_settings 적용 뒤(재적용 뒤에도) 실행한다. 어떤 DB 에서도 돈다(시드 불필요). 모든 변경은 rollback 된다.
-- ① 기존 행의 code 가 모두 그 프로젝트의 활성 어휘 안이다(check 삭제 뒤 트리거 판정과 같은 결과 — 데이터 변화 없음의 증거)
-- ② settings_ref_check 의 달력·어휘 두 분기가 살아 있다 ③ 트리거가 목록 밖 code 를 막는다
begin;
do $$
declare
  v text;
  p uuid;
begin
  select string_agg(x.what, ', ') into v from (
    select 'attendance:' || r.type as what from public.attendance_records r join public.project_settings s on s.project_id = r.project_id
     where not exists (select 1 from jsonb_array_elements(public.project_vocab_of(s."values", 'attendance.types')) e where e ->> 'code' = r.type)
    union select 'meetings:' || m.category from public.meetings m join public.project_settings s on s.project_id = m.project_id
     where not exists (select 1 from jsonb_array_elements(public.project_vocab_of(s."values", 'meetings.categories')) e where e ->> 'code' = m.category)
    union select 'severity:' || i.severity from public.issues i join public.project_settings s on s.project_id = i.project_id
     where not exists (select 1 from jsonb_array_elements(public.project_vocab_of(s."values", 'issues.severities')) e where e ->> 'code' = i.severity)
    union select 'source:' || i.source_type from public.issues i join public.project_settings s on s.project_id = i.project_id
     where i.source_type is not null
       and not exists (select 1 from jsonb_array_elements(public.project_vocab_of(s."values", 'issues.sources')) e where e ->> 'code' = i.source_type)) x;
  if v is not null then raise exception 'VOCAB_SMOKE: 어휘 밖 기존 행: %', left(v, 600); end if;

  -- ② 달력 분기: 주 시작 unset 은 문서가 없으면 통과. 어휘 분기: 참조가 있는 심각도를 지우면 SETTINGS_CODE_IN_USE
  select i.project_id into p from public.issues i group by i.project_id order by i.project_id limit 1;
  if p is not null then
    begin
      perform public.settings_ref_check(p, 'issues.severities', null,
        (select jsonb_agg(e) from jsonb_array_elements(public.project_vocab_default('issues.severities')) e
          where e ->> 'code' <> (select i.severity from public.issues i where i.project_id = p limit 1)));
      raise exception 'VOCAB_SMOKE: 참조 있는 심각도 삭제가 통과했다';
    exception when check_violation then
      if sqlerrm <> 'SETTINGS_CODE_IN_USE:issues.severities' then raise; end if;
    end;
    -- ③ 트리거: 목록 밖 심각도로 바꾸면 PROJECT_VOCAB_INACTIVE
    begin
      update public.issues set severity = 'vocab_smoke_x' where id = (select i.id from public.issues i where i.project_id = p limit 1);
      raise exception 'VOCAB_SMOKE: 목록 밖 심각도가 저장됐다';
    exception when check_violation then
      if sqlerrm not like 'PROJECT_VOCAB_INACTIVE:issues.severities:%' then raise; end if;
    end;
  end if;
  raise notice 'VOCAB_SMOKE: 기존 행 어휘 안·참조 검사·트리거 거부 통과';
end $$;
rollback;
