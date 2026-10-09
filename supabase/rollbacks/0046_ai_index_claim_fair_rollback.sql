-- 0046 롤백 — claim_ai_index_jobs 를 기준선 정의(전역 run_after 순)로 되돌린다. 큐 행은 건드리지 않는다.
begin;

create or replace function public.claim_ai_index_jobs(p_limit integer, p_lease_seconds integer)
returns setof public.ai_index_jobs language sql set search_path to 'public', 'extensions' as $$
  update public.ai_index_jobs j
  set status = 'running', locked_at = now(), updated_at = now()
  where j.id in (
    select c.id
    from public.ai_index_jobs c
    where (c.status = 'pending' and c.run_after <= now())
       or (
         c.status = 'running'
         and c.locked_at < now() - make_interval(secs => greatest(1, coalesce(p_lease_seconds, 300)))
       )
    order by c.run_after, c.id
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update skip locked
  )
  returning j.*;
$$;

commit;
