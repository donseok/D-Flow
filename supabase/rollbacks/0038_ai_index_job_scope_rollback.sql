-- 0037 당시 RPC 정의로 복원. 잡과 workspace_id 데이터는 보존한다.
begin;
CREATE OR REPLACE FUNCTION public.upsert_ai_index_jobs(p_jobs jsonb) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_count integer;
begin
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'AI_INDEX_JOBS_INVALID' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs (
    job_key, operation, project_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  )
  select
    x.job_key, x.operation, x.project_id, x.domain, x.entity_type, x.entity_id,
    coalesce(x.payload, '{}'::jsonb), 'pending', 0, coalesce(x.run_after, now()),
    null, null, 0, now()
  from jsonb_to_recordset(p_jobs) as x(
    job_key text,
    operation text,
    project_id uuid,
    domain text,
    entity_type text,
    entity_id text,
    payload jsonb,
    run_after timestamptz
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    payload = excluded.payload,
    status = 'pending',
    attempts = 0,
    run_after = excluded.run_after,
    locked_at = null,
    last_error = null,
    generation = public.ai_index_jobs.generation + 1,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
commit;
