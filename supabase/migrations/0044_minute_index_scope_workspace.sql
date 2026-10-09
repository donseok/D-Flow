-- 0044_minute_index_scope_workspace.sql
-- 회의록 색인 범위 변경 큐잉(queue_minute_ai_index_scope_change)이 ai_index_jobs.workspace_id 를 채우지 않았다.
-- 0036 이 그 열을 NOT NULL 로 만든 뒤로 이 함수는 다시 정의된 적이 없어, 이 함수를 부르는 갈래 — 회의록 제목·팀·일자·프로젝트 변경
-- (update_minute_metadata_with_wiki_retraction)과 색인 흔적이 있는 회의록의 보관 — 가 23502 로 통째 실패했다.
-- 워크스페이스는 인자로 받지 않고 여기서 해석한다(인자·반환·실행권·INVOKER 그대로): 프로젝트가 있으면 그 프로젝트의 워크스페이스
-- (프로젝트 이동 때 옛 프로젝트의 삭제 잡은 옛 프로젝트 쪽에 남아야 한다), 없으면 회의록 행의 워크스페이스. 어느 쪽도 못 구하면
-- 짐작하지 않고 거부한다(0038 upsert_ai_index_jobs 와 같은 문구).

begin;

create or replace function public.queue_minute_ai_index_scope_change(p_project_id uuid, p_minute_id uuid, p_operation text, p_run_after timestamp with time zone default now())
returns bigint language plpgsql set search_path to 'public', 'extensions' as $$
declare
  v_job_id bigint;
  v_workspace uuid;
  v_job_key text :=
    'v1:' || coalesce(p_project_id::text, 'global')
      || ':minutes:minute:' || p_minute_id::text;
begin
  if p_minute_id is null or p_operation not in ('upsert', 'delete') then
    raise exception 'MINUTE_INDEX_SCOPE_CHANGE_INVALID' using errcode = '22023';
  end if;

  if p_project_id is not null then
    select workspace_id into v_workspace from public.projects where id = p_project_id;
  else
    select workspace_id into v_workspace from public.minutes where id = p_minute_id;
  end if;
  if v_workspace is null then
    raise exception 'AI_INDEX_JOB_SCOPE_REQUIRED' using errcode = '22023';
  end if;

  insert into public.ai_index_jobs as job (
    job_key, operation, project_id, workspace_id, domain, entity_type, entity_id,
    payload, status, attempts, run_after, locked_at, last_error, generation, updated_at
  ) values (
    v_job_key, p_operation, p_project_id, v_workspace, 'minutes', 'minute', p_minute_id::text,
    '{}'::jsonb, 'pending', 0, coalesce(p_run_after, now()), null, null, 0, now()
  )
  on conflict (job_key) do update set
    operation = excluded.operation,
    project_id = excluded.project_id,
    workspace_id = excluded.workspace_id,
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
