-- 0044 롤백 — queue_minute_ai_index_scope_change 를 기준선 정의(workspace_id 를 채우지 않는다)로 되돌린다.
-- 되돌리면 회의록 메타 변경·보관의 색인 큐잉이 다시 23502 로 실패한다 — 0044 가 넣은 큐 행은 지우지 않는다.
begin;

create or replace function public.queue_minute_ai_index_scope_change(p_project_id uuid, p_minute_id uuid, p_operation text, p_run_after timestamp with time zone default now())
returns bigint language plpgsql set search_path to 'public', 'extensions' as $$
declare
  v_job_id bigint;
  v_job_key text :=
    'v1:' || coalesce(p_project_id::text, 'global')
      || ':minutes:minute:' || p_minute_id::text;
begin
  if p_minute_id is null or p_operation not in ('upsert', 'delete') then
    raise exception 'MINUTE_INDEX_SCOPE_CHANGE_INVALID' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs as job (
    job_key, operation, project_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  ) values (
    v_job_key, p_operation, p_project_id, 'minutes', 'minute', p_minute_id::text,
    '{}'::jsonb, 'pending', 0, coalesce(p_run_after, now()), null, null, 0, now()
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    project_id = excluded.project_id,
    domain = excluded.domain,
    entity_type = excluded.entity_type,
    entity_id = excluded.entity_id,
    payload = excluded.payload,
    status = case when job.status = 'running' then 'running' else 'pending' end,
    attempts = case when job.status = 'running' then job.attempts else 0 end,
    run_after = case
      when job.status = 'running' then job.run_after
      else excluded.run_after
    end,
    locked_at = case when job.status = 'running' then job.locked_at else null end,
    last_error = null,
    generation = job.generation + 1,
    updated_at = now()
  returning job.id into v_job_id;

  return v_job_id;
end
$$;

commit;
