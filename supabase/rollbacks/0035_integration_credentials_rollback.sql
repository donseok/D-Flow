-- 새 자격증명은 기존 PAT 한 프로젝트 모델로 손실 없이 돌아갈 수 없다.
-- 따라서 이관 이후 새 발급/편집/사용/회수 상태가 존재하면 되돌림을 명시적으로 거절한다.
do $$
begin
  if exists (select 1 from public.agent_watchers group by user_id, agent having count(*) > 1) then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED';
  end if;
  -- 새 저장소에서 삭제된 이관 토큰도 원본을 되살리는 롤백으로 복구하지 않는다.
  if exists (
    select 1 from public.agent_runners r
    where not exists (select 1 from public.integration_credentials c where c.id = r.id)
      and exists (select 1 from public.workspace_members m where m.user_id = r.owner_user_id
        and (case when r.project_id is null then
          (select count(*) from public.workspace_members x where x.user_id = r.owner_user_id) = 1
          else m.workspace_id = public.project_ws(r.project_id) end))
  ) then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED';
  end if;
  if exists (
    select 1 from public.integration_credentials c
    left join public.agent_runners r on r.id = c.id
    where r.id is null or c.kind <> 'agent_runner'
      or c.name is distinct from r.name or c.token_prefix is distinct from r.token_prefix
      or c.token_hash is distinct from r.token_hash or c.scopes is distinct from r.scopes
      or c.owner_user_id is distinct from r.owner_user_id or c.enabled is distinct from r.enabled
      or c.revoked_at is distinct from r.revoked_at or c.expires_at is distinct from r.expires_at
      or c.last_used_at is distinct from r.last_seen_at
      or c.created_by is distinct from r.created_by or c.created_at is distinct from r.created_at
      or (r.project_id is not null and c.workspace_id is distinct from public.project_ws(r.project_id))
      or (r.project_id is null and (select count(*) from public.workspace_members m where m.user_id = r.owner_user_id) <> 1)
      or c.default_project_id is distinct from r.project_id
      or c.project_ids is distinct from (case when r.project_id is null then null else array[r.project_id] end)
      or c.default_team_id is not null or c.team_map <> '{}'::jsonb
      or not exists (select 1 from public.workspace_members m where m.user_id = r.owner_user_id and m.workspace_id = c.workspace_id)
  ) then
    raise exception using errcode = '23514', message = 'INTEGRATION_CREDENTIALS_ROLLBACK_BLOCKED';
  end if;
end $$;

drop table public.integration_credentials;
drop function public.integration_credentials_guard();

alter table public.agent_watchers drop constraint agent_watchers_workspace_user_agent_key;
alter table public.agent_watchers add constraint agent_watchers_user_id_agent_key unique (user_id, agent);
