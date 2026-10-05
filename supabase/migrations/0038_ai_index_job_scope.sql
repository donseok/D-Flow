-- SP9 수용: SP8의 필수 workspace_id를 색인 잡 등록 RPC에서도 확정한다.
begin;
create or replace function public.upsert_ai_index_jobs(p_jobs jsonb) returns integer
language plpgsql set search_path = '' set lock_timeout = '15s' as $$
declare
  v_job jsonb;
  v_project uuid;
  v_workspace uuid;
  v_requested_workspace uuid;
  v_affected integer;
  v_count integer := 0;
begin
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array'
     or jsonb_array_length(p_jobs) = 0 or jsonb_array_length(p_jobs) > 200 then
    raise exception 'AI_INDEX_JOBS_INVALID' using errcode = '22023';
  end if;
  for v_job in select value from jsonb_array_elements(p_jobs) loop
    v_project := (v_job->>'project_id')::uuid;
    v_requested_workspace := (v_job->>'workspace_id')::uuid;
    if v_project is not null then
      select workspace_id into v_workspace from public.projects where id = v_project;
      if not found or (v_requested_workspace is not null and v_requested_workspace <> v_workspace) then
        raise exception 'AI_INDEX_JOB_SCOPE_INVALID' using errcode = '22023';
      end if;
    else
      v_workspace := v_requested_workspace;
      if v_workspace is null or not exists (select 1 from public.workspaces where id = v_workspace) then
        raise exception 'AI_INDEX_JOB_SCOPE_REQUIRED' using errcode = '22023';
      end if;
    end if;
    insert into public.ai_index_jobs (
      job_key, operation, project_id, workspace_id, domain, entity_type, entity_id,
      payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
    ) values (
      v_job->>'job_key', v_job->>'operation', v_project, v_workspace,
      v_job->>'domain', v_job->>'entity_type', v_job->>'entity_id',
      coalesce(v_job->'payload', '{}'::jsonb), 'pending', 0,
      coalesce((v_job->>'run_after')::timestamptz, now()), null, null, 0, now()
    ) on conflict (job_key) do update set
      operation = excluded.operation, payload = excluded.payload, status = 'pending',
      attempts = 0, run_after = excluded.run_after, locked_at = null, last_error = null,
      generation = public.ai_index_jobs.generation + 1, updated_at = now()
      where public.ai_index_jobs.workspace_id = excluded.workspace_id
        and public.ai_index_jobs.project_id is not distinct from excluded.project_id;
    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception 'AI_INDEX_JOB_SCOPE_CONFLICT' using errcode = '22023';
    end if;
    v_count := v_count + v_affected;
  end loop;
  return v_count;
end;
$$;
-- CREATE OR REPLACE는 기존 service_role 전용 실행권을 보존한다.
revoke all on function public.upsert_ai_index_jobs(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_ai_index_jobs(jsonb) to service_role;
commit;
