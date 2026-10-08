-- 0041_drop_agent_legacy.sql
-- SP7(개정 스펙 "SP7 — 외부 연동 패키지화" 범위 추가 ②, §2.2.2 "에이전트 사용 여부의 이중 원천") — 옛 두 표를 지운다.
--   · public.agent_projects — 에이전트 사용 여부의 옛 원천. 정본은 SP3a(0012)부터 프로젝트 설정 modules.enabled ∋ 'agents' 이고,
--     앱은 이제 그 설정만 읽는다(두 원천 AND → 모듈 하나).
--   · public.agent_runners  — 옛 PAT 저장소. 0035 가 integration_credentials(kind='agent_runner')로 같은 id·prefix·hash 로 옮겼고,
--     앱의 인증 원천은 그 표 하나다.
-- 두 표를 가리키는 FK·뷰·함수·트리거·publication 은 없다(0000~0040 전수 — 두 표에서 나가는 FK 와 read_agent_projects 정책뿐).
-- 그래서 cascade 를 쓰지 않는다: 모르는 의존 객체가 있으면 drop 이 실패해 멈춘다(fail-closed).
-- 행을 조용히 버리지 않는다 — 아래 사전 검사가 새 구조로 옮겨지지 않은 행을 찾으면 AGENT_LEGACY_DROP_PRECHECK 로 멈춘다.
-- 롤백(supabase/rollbacks/0041_drop_agent_legacy_rollback.sql)은 표의 구조만 되만든다. 지운 행은 돌아오지 않는다.

begin;

-- 검사와 drop 사이에 행이 끼어들지 않게 먼저 잠근다
lock table public.agent_projects, public.agent_runners in access exclusive mode;

-- 1. 사전 검사 (AGENT_LEGACY_DROP_PRECHECK)
do $$
declare
  v_projects bigint;
  v_runners  bigint;
begin
  -- ① 꺼 둔 등록 행(enabled=false)인데 그 프로젝트의 설정 modules.enabled 에 'agents' 가 있다. 지금까지는 두 원천의 AND 라 이 프로젝트의
  --    에이전트 API·주문 발행이 닫혀 있었다 — 표를 지우면 판정이 모듈 하나가 되어 **다시 열린다**(관리자가 멈춰 둔 것이 조용히 풀린다).
  --    반대 방향(켜진 행인데 설정에 agents 없음)은 막지 않는다: 모듈을 끄면 행은 켜진 채 남는 것이 기존 동작이고, 닫힌 것은 닫힌 채다.
  --    행이 없고 모듈만 켜진 프로젝트도 막지 않는다 — 정본(SP3a·0012)이 모듈이고 행은 첫 사용 때 자동으로 생기던 것이다.
  --    정리: 계속 멈춰 둘 프로젝트면 프로젝트 설정에서 에이전트 모듈을 끄고, 다시 쓸 프로젝트면 그 행을 지운 뒤 다시 적용한다.
  select count(*) into v_projects
    from public.agent_projects a
   where not a.enabled
     and exists (
       select 1 from public.project_settings s
        where s.project_id = a.project_id
          and jsonb_typeof(s."values" -> 'modules.enabled') = 'array'
          and (s."values" -> 'modules.enabled') ? 'agents');
  if v_projects > 0 then
    raise exception 'AGENT_LEGACY_DROP_PRECHECK: 꺼 둔 agent_projects 행 %건의 프로젝트 설정 modules.enabled 에 agents 가 있다 — 표를 지우면 다시 열린다', v_projects
      using errcode = 'P0001';
  end if;

  -- ② 살아 있는(enabled·미회수·미만료 — 0035 의 판정과 같다) 토큰인데 integration_credentials 에 없다. 0035 는 id·token_prefix·token_hash 를
  --    그대로 옮겼으므로 그 셋으로 대조한다. 표를 지우면 그 토큰은 흔적 없이 사라진다.
  --    정리: 토큰을 회수(enabled=false, revoked_at)하고 소유자가 새로 발급받은 뒤 다시 적용한다.
  select count(*) into v_runners
    from public.agent_runners r
   where r.enabled and r.revoked_at is null and r.expires_at > now()
     and not exists (
       select 1 from public.integration_credentials c
        where c.id = r.id and c.kind = 'agent_runner'
          and c.token_prefix = r.token_prefix and c.token_hash = r.token_hash);
  if v_runners > 0 then
    raise exception 'AGENT_LEGACY_DROP_PRECHECK: 살아 있는 agent_runners 토큰 %건이 integration_credentials 로 이관되지 않았다', v_runners
      using errcode = 'P0001';
  end if;
end $$;

-- 2. drop — 정책·권한·제약·인덱스는 표와 함께 사라진다(정책은 이름을 적어 먼저 지운다 — 무엇을 지우는지 남긴다)
drop policy read_agent_projects on public.agent_projects;
drop table public.agent_projects;
drop table public.agent_runners;

-- 3. 사후 검증 (AGENT_LEGACY_DROP_POSTCHECK)
do $$
begin
  if to_regclass('public.agent_projects') is not null or to_regclass('public.agent_runners') is not null then
    raise exception 'AGENT_LEGACY_DROP_POSTCHECK: 옛 표가 남아 있다' using errcode = 'P0001';
  end if;
  if to_regclass('public.integration_credentials') is null then
    raise exception 'AGENT_LEGACY_DROP_POSTCHECK: integration_credentials 가 없다' using errcode = 'P0001';
  end if;
end $$;

commit;
