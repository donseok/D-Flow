-- *_issue_status_vocab 적용 뒤(재적용 뒤에도) 실행한다. 어떤 DB 에서도 돈다(이슈가 있으면 그 행으로 더 본다). 모든 변경은 rollback 된다.
-- ① 백필: 모든 이슈의 status_code = status(기본 4행 code = 범주 code) ② 키 없는 프로젝트의 등록은 첫 상태 open ③ 범주 전이표 밖(resolved→on_hold) 거부
-- ④ 표시 상태가 바뀌면 이력 한 행(같은 트랜잭션) ⑤ 참조 있는 상태 삭제는 SETTINGS_CODE_IN_USE ⑥ status 직접 쓰기 거부
begin;
do $$
declare
  p uuid;
  i uuid;
  n int;
begin
  if exists (select 1 from public.issues where status_code is distinct from status
                                          and not exists (select 1 from public.project_settings s where s.project_id = issues.project_id
                                                                                                    and s."values" ? 'workflow.issue_statuses')) then
    raise exception 'ISSUE_STATUS_SMOKE: 키 없는 프로젝트에서 status_code 와 status 가 다르다';
  end if;
  select s.project_id into p from public.project_settings s where not (s."values" ? 'workflow.issue_statuses') order by s.project_id limit 1;
  if p is null then raise notice 'ISSUE_STATUS_SMOKE: 프로젝트 없음 — 백필만 확인'; return; end if;
  insert into public.issues (project_id, title) values (p, 'ISSUE_STATUS_SMOKE') returning id into i;
  if (select status_code from public.issues where id = i) <> 'open' then raise exception 'ISSUE_STATUS_SMOKE: 첫 상태가 open 이 아니다'; end if;
  update public.issues set status_code = 'resolved' where id = i;
  if (select resolved_at from public.issues where id = i) is null then raise exception 'ISSUE_STATUS_SMOKE: 해결 진입에 resolved_at 이 없다'; end if;
  begin
    update public.issues set status_code = 'on_hold' where id = i;
    raise exception 'ISSUE_STATUS_SMOKE: resolved→on_hold 가 통과했다';
  exception when check_violation then
    if sqlerrm <> 'ISSUE_TRANSITION_DENIED:resolved>on_hold' then raise; end if;
  end;
  select count(*) into n from public.issue_updates where issue_id = i and kind = 'status' and body = 'open>resolved';
  if n <> 1 then raise exception 'ISSUE_STATUS_SMOKE: 이력이 % 행이다(1 기대)', n; end if;
  begin
    perform public.settings_ref_check(p, 'workflow.issue_statuses', null,
      (select jsonb_agg(e) from jsonb_array_elements(public.project_vocab_default('workflow.issue_statuses')) e where e ->> 'code' <> 'open')
        || '[{"code":"intake","label":"접수","category":"open","color":"delayed","sort":0,"active":true}]'::jsonb);
    raise exception 'ISSUE_STATUS_SMOKE: 참조 있는 open 삭제가 통과했다';
  exception when check_violation then
    if sqlerrm <> 'SETTINGS_CODE_IN_USE:workflow.issue_statuses' then raise; end if;
  end;
  begin
    update public.issues set status = 'open' where id = i;
    raise exception 'ISSUE_STATUS_SMOKE: status 직접 쓰기가 통과했다';
  exception when check_violation then
    if sqlerrm <> 'ISSUE_STATUS_DERIVED' then raise; end if;
  end;
  raise notice 'ISSUE_STATUS_SMOKE: 백필·첫 상태·전이표·이력·참조 검사·파생 열 통과';
end $$;
rollback;
