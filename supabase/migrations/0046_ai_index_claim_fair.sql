-- 0046_ai_index_claim_fair.sql
-- 색인 큐 선점(claim_ai_index_jobs)이 전역 run_after 순이라, 큐가 깊거나 실패가 쌓인 워크스페이스 하나가 매 실행의 몫을 독차지하고
-- 다른 워크스페이스의 변경은 그 뒤에서 기다렸다(정본 §5.4.4 — 워커는 워크스페이스끼리 번갈아 돈다).
-- 워크스페이스마다 자기 줄(run_after, id)에서의 차례(turn)를 매기고 차례 → run_after → id 순으로 집는다: 모든 워크스페이스의 첫 잡,
-- 그다음 모든 워크스페이스의 둘째 잡 … 워크스페이스가 하나면 예전과 같은 순서다. 워크스페이스 안의 순서는 바뀌지 않는다.
-- 인자·반환·실행권(service_role)·INVOKER·lease 만료 재선점·상한 50 은 그대로다.

begin;

create or replace function public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer)
returns setof public.ai_index_jobs language sql set search_path to 'public', 'extensions' as $$
  update public.ai_index_jobs j
  set status = 'running', locked_at = now(), updated_at = now()
  where j.id in (
    select c.id
    from public.ai_index_jobs c
    where c.id in (
      select r.id
      from (
        select e.id, e.run_after,
               row_number() over (partition by e.workspace_id order by e.run_after, e.id) as turn
        from public.ai_index_jobs e
        where (e.status = 'pending' and e.run_after <= now())
       or (
         e.status = 'running'
         and e.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       )
      ) r
      order by r.turn, r.run_after, r.id
      limit greatest(1, least(coalesce(p_limit, 10), 50))
    )
      -- 고른 뒤 잠그는 사이 다른 워커가 집어 갔을 수 있다 — 조건을 다시 보고, 잠긴 행은 건너뛴다(이번 실행이 덜 받을 뿐 잃지 않는다)
      and ((c.status = 'pending' and c.run_after <= now())
       or (
         c.status = 'running'
         and c.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       ))
    for update skip locked
  )
  returning j.*;
$$;

commit;
