# SP2 service_role(admin) 클라이언트 감사 — 2026-09-26

기준은 `createAdminClient` 를 언급하는 src 파일이다. 정의 파일 `src/lib/supabase/admin.ts` 와 주석만 있는 `env.ts` 는 뺐다.
분류가 `경계 넘음` 인 파일은 표에 남아 있으면 안 된다. 그런 파일은 이 태스크에서 고쳤고, 아래 "수정한 파일" 절에 적었다.
`tests/invariants/admin-scope.test.ts` 가 이 표를 읽는다.

**이 표와 불변식이 보장하는 범위.** 불변식이 확인하는 것은 **문서화가 빠짐없는지**다. 쿼리의 스코프가 맞는지는 확인하지 않는다.
구체적으로 두 가지를 본다. 첫째, `createAdminClient` 를 쓰는 파일이 모두 이 표에 있는가. 둘째, 각 행에 허용된 분류 하나와
한 줄 근거가 있는가. 각 admin 체인이 정말 워크스페이스나 프로젝트 id 로 좁혀졌는지는 정적으로 판정할 수 없다.
근거 열은 감사자가 코드를 읽고 쓴 주장이고, 그 주장이 맞는지는 사람의 리뷰가 확인한다(최종 리뷰가 일부 행을 골라 대조한다).
새 파일은 둘 중 하나를 해야 한다. `adminFor({ workspaceId | projectId })` 로 스코프를 정하거나, 이 표에 분류와 근거를 적는다.

분류:
- `플랫폼`: 스코프가 필요 없다. 전역 표, cron, 슈퍼유저 전용 경로, 사용자에게 행을 돌려주지 않는 정리·색인 배치가 여기에 든다.
- `외부 API·서비스`: PAT, 공유 시크릿, 토큰 경로다. 먼저 주체를 판정하고, 그다음 대상 id 로 좁힌다.
- `세션 가드 뒤 id 스코프`: 가드가 대상 프로젝트나 행을 확정한 뒤, 그 id 로만 필터한다.
- `adminFor 정의`: `src/lib/supabase/adminFor.ts` 한 줄뿐이다.

<!-- audit:start -->
| 파일 | 분류 | 근거 |
|---|---|---|
| src/app/actions/accounts.ts | 세션 가드 뒤 id 스코프 | create·bulk·setWorkspaceRole·listAccounts 는 requireWorkspaceAdmin(wid) 뒤에 그 wid(listAccounts 는 pid)로 좁힌다. resetPassword·setPlatformAdmin 은 requireSuperuser(플랫폼 11곳)이다. assertCanTouchAccount 는 전역으로 둔다(D1 계정 전역, 컨트롤러 판정 a35) |
| src/app/actions/agentHub.ts | 세션 가드 뒤 id 스코프 | requireProjectMember(pid) 뒤. 항목·주문은 id 로 읽고 project_id === pid 인지 다시 확인한 뒤에 쓴다 |
| src/app/actions/agentTokens.ts | 세션 가드 뒤 id 스코프 | 세션 사용자 = owner_user_id 로만 발급·폐기·목록 처리한다. PAT 의 project_id 는 쓰는 시점에 라우트가 멤버십으로 판정한다 |
| src/app/actions/agentWork.ts | 세션 가드 뒤 id 스코프 | 주문 행의 project_id 로 requireProjectAdmin 또는 서브트리 관리자를 판정한 뒤, 그 주문·항목 id 로만 쓴다 |
| src/app/actions/inbox.ts | 세션 가드 뒤 id 스코프 | getSession 사용자의 notification_recipients(user_id 필터)만 읽음 표시한다 |
| src/app/actions/inviteRedeem.ts | 외부 API·서비스 | 초대 토큰의 해시로 초대 1건을 찾는다. 그 초대가 가리키는 워크스페이스(허용 도메인 설정)·프로젝트·팀 id 와 이메일로만 조회하고 쓴다 |
| src/app/actions/issues.ts | 세션 가드 뒤 id 스코프 | requireProjectMember(pid) 뒤에 그 pid 로 RPC 를 부르고, 이슈 id 로 issue_updates 에 insert 한다 |
| src/app/actions/minutes.ts | 세션 가드 뒤 id 스코프 | requireActor 와 소유자 확인 뒤, 회의록·폴더 id 로 하이라이트·폴더 이동·공유를 쓴다. 가드를 워크스페이스로 옮기는 일은 Task 16 이 한다 |
| src/app/actions/project.ts | 세션 가드 뒤 id 스코프 | createProject 는 requireWorkspaceAdmin(wid), 설정·비공개는 requireProjectAdmin(pid) 뒤에 그 pid 로 project_settings·projects 를 쓴다 |
| src/app/actions/projectAreas.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤에 project_areas 를 eq('project_id', pid) 로 읽고 쓴다 |
| src/app/actions/projectInvites.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid)(관리자 슬롯이면 requireWorkspaceAdmin 도) 뒤에 project_invites 를 pid 로, workspace_settings 를 그 프로젝트의 워크스페이스 id 로 읽고 쓴다 |
| src/app/actions/projectTeams.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤에 teams 를 project_id=pid 로 쓴다. copyGlobalTeams 의 원본은 teamsForWorkspaceSync(프로젝트의 wid)다(이번에 고침) |
| src/app/actions/roster.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin 또는 Member(pid) 뒤에 project_members 를 pid·memberId 로 읽고, upsert RPC 에 pid 를 넘긴다 |
| src/app/actions/teams.ts | 세션 가드 뒤 id 스코프 | addTeam 은 requireWorkspaceAdmin(wid) 뒤에 wid 로 필터한다. updateTeam 은 행의 workspace_id 로 가드한 뒤 eq(workspace_id) 로 쓴다. listTeamsAdmin 은 adminFor({ workspaceId }) 를 쓴다 |
| src/app/actions/wbsAssign.ts | 세션 가드 뒤 id 스코프 | resolveItemProjectId 로 항목의 pid 를 구해 가드한 뒤, 항목 id 와 멤버의 project_id 일치를 확인하고 쓴다 |
| src/app/actions/wbsMarkdown.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤에 부착점·import 를 pid 로 한다 |
| src/app/actions/wbsSpec.ts | 세션 가드 뒤 id 스코프 | 항목의 pid 로 requireProjectAdmin 또는 위임 자격을 판정한 뒤, 그 항목 id 로만 update 한다 |
| src/app/api/chat/index/worker/route.ts | 플랫폼 | cron 시크릿(x-cron-secret)으로만 들어온다. 전 프로젝트 색인 작업 큐이고 사용자에게 행을 돌려주지 않는다 |
| src/app/api/cron/ai-index/route.ts | 플랫폼 | CRON_SECRET 으로만 들어온다. 전역 색인 큐 배치다 |
| src/app/api/cron/inbox-retention/route.ts | 플랫폼 | CRON_SECRET 으로만 들어온다. 읽은 알림 90일 정리 RPC(전역)다 |
| src/app/api/import/execute/route.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤에 그 pid 로 import 한다. 전역 팀 등록은 requireWorkspaceAdmin(프로젝트의 wid) 뒤에 한다 |
| src/app/api/track/route.ts | 플랫폼 | 세션 사용자 본인의 usage_events 에 insert 만 한다. 읽기는 슈퍼유저 전용 /usage 다 |
| src/app/api/v1/agent/me/route.ts | 외부 API·서비스 | PAT 소유자의 actorFromUser 스냅샷 키로 agent_projects 를 in(project_id) 로 조회한다(이번에 고침) |
| src/app/api/v1/agent/watch/route.ts | 외부 API·서비스 | PAT 의 user_id·agent 로 upsert·stop 한다. upsert 전에 PAT 소유자의 actorFromUser 스냅샷으로 isProjectMember(감시 project_id)를 본다 — 조회 전용·다른 워크스페이스면 404(Task 13 에서 고침, 프로젝트 한정 PAT 포함). 7일 GC 는 내용을 읽지 않는 전역 정리 |
| src/app/api/v1/agent/work/[id]/claim/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 쓴다 |
| src/app/api/v1/agent/work/[id]/heartbeat/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 쓴다 |
| src/app/api/v1/agent/work/[id]/release/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 쓴다 |
| src/app/api/v1/agent/work/[id]/report/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 보고한다 |
| src/app/api/v1/agent/work/[id]/route.ts | 외부 API·서비스 | patProjectAllowed·requireAgentProject·isAgentProjectMember(주문의 pid) 를 통과한 뒤 주문 id 로 조회한다 |
| src/app/api/v1/agent/work/mine/route.ts | 외부 API·서비스 | PAT 이다. accessibleProjectIds(principal) 를 in(project_id) 로 모든 조회에 건다 |
| src/app/api/v1/agent/work/route.ts | 외부 API·서비스 | patProjectAllowed·requireAgentProject·isAgentProjectMember(pid) 를 통과한 뒤 그 pid 로 조회한다 |
| src/app/api/v1/minutes/folder/route.ts | 외부 API·서비스 | 공유 시크릿과 user_email 로 actorFromUser 스냅샷을 만들고 isAnyProjectAdmin 으로 프로브를 거른다. external_id 들로 조회한 뒤 호출자 워크스페이스 밖 행은 not_found 로 빼고, 남은 대상마다 isBatchAuthorized(프로젝트 관리자·무프로젝트는 워크스페이스 관리자)를 요구한다(Task 13) |
| src/app/api/v1/minutes/link/route.ts | 외부 API·서비스 | 공유 시크릿과 user_email 로 actorFromUser 스냅샷을 만들고, minute_id 로 찾은 회의록에 canEditMinute(작성자 또는 그 프로젝트 관리자 — 세션 checkOwner 와 같은 판정)를 요구한다. 아니면 없는 회의록과 같은 404 다(Task 13) |
| src/app/api/v1/minutes/meta/route.ts | 외부 API·서비스 | 공유 시크릿과 user_email(필수)로 actorFromUser 를 만들고, 스냅샷 키 ∩ canSeeProject 로 프로젝트를, 소속 워크스페이스로 팀을 좁힌다(이번에 고침) |
| src/app/api/v1/minutes/route.ts | 외부 API·서비스 | 두 메서드 모두 user_email 의 actorFromUser 스냅샷으로 좁힌다(Task 13). POST: meeting_id 의 프로젝트에 isProjectMember, external_id 로 찾은 기존 회의록(경합 재조회 포함)에 canEditMinute — 아니면 404. GET 목록: user_email 필수, 호출자 워크스페이스로 in 을 걸고 볼 수 없는 비공개 프로젝트(canSeeProject 거짓)의 회의록을 뺀다(플랫폼 관리자는 전부) |
| src/app/api/v1/wbs/import/route.ts | 외부 API·서비스 | PAT 이다. patProjectAllowed·requireAgentProject·멤버·관리자(pid) 판정 뒤 그 pid 로 import 한다 |
| src/app/api/v1/wbs/structure/route.ts | 외부 API·서비스 | PAT 이다. patProjectAllowed·requireAgentProject·isAgentProjectMember(pid) 판정 뒤 그 pid 로 조회한다 |
| src/app/api/wiki/reindex/route.ts | 플랫폼 | requireSuperuser(플랫폼 11곳)다. 전역 색인 큐·문서 수 통계를 다룬다 |
| src/app/api/wiki/search/route.ts | 세션 가드 뒤 id 스코프 | getActorViewState 뒤 accessScope(내 워크스페이스 프로젝트 ∩ 비공개 판정)의 projectIds 로 in 을 건다 |
| src/app/api/wiki/summarize/route.ts | 세션 가드 뒤 id 스코프 | getActorViewState 뒤 accessScope 판정(decideSearchAccess)을 통과한 projectId 로만 조회한다 |
| src/app/share/minutes/[token]/page.tsx | 외부 API·서비스 | 공유 토큰 경로다. share_enabled 인 행 1건에서 화이트리스트 컬럼만 읽는다 |
| src/lib/agent/delegation.ts | 세션 가드 뒤 id 스코프 | requireProjectMember 또는 Admin(항목의 pid) 뒤에 그 항목 id 로 위임 여부를 읽고 쓴다 |
| src/lib/agent/subtreeManager.ts | 세션 가드 뒤 id 스코프 | requireProjectMember(pid) 뒤에 myMemberIds·isSubtreeManager 를 pid·itemId 로 판정한다 |
| src/lib/ai/brief.ts | 세션 가드 뒤 id 스코프 | 호출부(프로젝트 화면·가드된 액션)의 projectId 로 project_ai_briefs 를 읽고 쓴다. RLS 쓰기 정책이 없어 가드가 유일한 관문이다 |
| src/lib/ai/ensure-index.ts | 세션 가드 뒤 id 스코프 | 호출부가 가드한 projectId 로 wbs_embeddings 수를 세고 색인한다 |
| src/lib/ai/health.ts | 플랫폼 | assistantHealth 는 전역 스키마·RPC 프로빙이라 행을 노출하지 않는다. assistantIndexStatus 는 projectId 로 카운트만 한다 |
| src/lib/ai/ingest.ts | 세션 가드 뒤 id 스코프 | 호출부가 가드한 projectId 로 wbs_embeddings 를 upsert 하고 stale 을 삭제한다 |
| src/lib/ai/issue-analysis.ts | 세션 가드 뒤 id 스코프 | 호출부가 가드한 projectId 로 issue_analysis_runs 를 읽고 쓴다 |
| src/lib/ai/llm-override.ts | 플랫폼 | 플랫폼 LLM 설정(llm_profiles·llm_config, 전역 표)의 읽기 전용 캐시다 |
| src/lib/ai/minutes-ingest.ts | 플랫폼 | ingestMinute 는 회의록 id 1건의 임베딩을 교체한다. self-heal 은 전 회의록 배치이고 응답 행이 없다 |
| src/lib/ai/minutes-insights.ts | 세션 가드 뒤 id 스코프 | 회의록 액션의 가드 뒤, 그 minuteId 로 minute_insights 를 교체한다 |
| src/lib/ai/wiki-ingest.ts | 세션 가드 뒤 id 스코프 | 회의록 후처리 또는 색인 작업의 projectId·jobId 로 위키 행을 읽고 쓴다 |
| src/lib/ai/wiki-saturation.ts | 세션 가드 뒤 id 스코프 | 형(type)만 import 한다. 넘겨받은 admin 으로 projectId 의 위키 토픽을 읽는다 |
| src/lib/data/accounts.ts | 세션 가드 뒤 id 스코프 | 형만 import 한다. listProfiles 는 전 profiles 를 읽고, 호출부 listAccounts(requireWorkspaceAdmin)가 명단으로 거른다 |
| src/lib/data/agentApprovals.ts | 세션 가드 뒤 id 스코프 | getActorForView 뒤에 projectId 의 reported 주문 수를 센다. 판정은 isProjectAdmin·서브트리다 |
| src/lib/data/agentSeatmap.ts | 세션 가드 뒤 id 스코프 | seatmapFloorIds(actor) 로 project_id 에 in 을 건다. 감시자는 층 프로젝트의 workspace_id 로 in 을 건다(이번에 고침) |
| src/lib/data/minutes.ts | 세션 가드 뒤 id 스코프 | 회의록 상세 화면의 가드 뒤, minuteId·projectId 로 위키 영향 카드를 조회한다 |
| src/lib/data/usage.ts | 플랫폼 | canViewUsage(슈퍼유저)를 다시 검사한 뒤 전역 계정 디렉터리를 만들고 usage_events 보존기간을 정리한다 |
| src/lib/minutes/externalApi.ts | 외부 API·서비스 | 외부 회의록 API 공용부다(AdminClient 형, 게이트, 순수 판정 isBatchAuthorized). 후처리는 minuteId 로 하이라이트를 재매칭한다 |
| src/lib/minutes/folders.ts | 세션 가드 뒤 id 스코프 | 형만 import 한다. 호출부가 넘긴 클라이언트로 teamCode·projectId·workspaceId 필터를 건다 |
| src/lib/notify/emit.ts | 세션 가드 뒤 id 스코프 | 발행 액션(가드 뒤)이 넘긴 recipientMemberIds·UserIds 로만 수신자 행을 만든다 |
| src/lib/supabase/adminFor.ts | adminFor 정의 | uuid 스코프(workspaceId 또는 projectId)를 검사한 뒤 createAdminClient 로 service_role 클라이언트를 돌려준다 |
| src/lib/teams/master.ts | 플랫폼 | 전 워크스페이스 팀의 읽기 전용 캐시다. 워크스페이스 접근자(teamsForWorkspaceSync)가 좁히고, 옛 전역 접근자는 검증 전용이다 |
<!-- audit:end -->

## 수정한 파일(경계 넘음 → 고침)

| 파일 | 이전 | 이후 |
|---|---|---|
| src/lib/data/agentHub.ts | 감시자 조회에 필터가 없었다. 프로젝트 없는 다른 워크스페이스 감시자가 이 허브에 "떠 있는 팀장"으로 보였다 | 감시자를 프로젝트의 `workspace_id` 로 eq 한다. 프로젝트 행이 없으면 조회하지 않는다. `getAgentHub` 는 `adminFor({ projectId })` 를 쓰므로 **표에서 뺐다** |
| src/lib/data/agentSeatmap.ts | 감시자 조회에 필터가 없었다(층마다 같은 누설) | 층 프로젝트들의 `workspace_id` 로 in 을 건다. 워크스페이스를 모르면 조회하지 않는다 |
| src/app/api/v1/minutes/meta/route.ts | 시크릿만 확인하고 **전 워크스페이스 프로젝트**와 전역 팀을 돌려줬다 | `user_email` 이 필수다. 없으면 400, 모르는 계정이면 403 `unknown_user` 다. 프로젝트는 스냅샷 키 ∩ canSeeProject 로, 팀은 소속 워크스페이스들의 합집합으로 좁힌다. 볼 수 없는 `project_id` 의 회의 목록은 404 다 |
| src/app/api/v1/agent/me/route.ts | enabled 인 `agent_projects` 를 전 워크스페이스에서 훑었다 | PAT 소유자 스냅샷 키로 in 을 건다. 응답 행도 그 키로 다시 거른다 |
| src/app/actions/projectTeams.ts | `copyGlobalTeams` 가 `teamsSync()`(전 워크스페이스의 공용 팀)를 복사했다 | `teamsForWorkspaceSync(프로젝트의 wid)` 에서 복사한다. 팀 마스터를 한 번도 읽지 못했으면 오류를 낸다("복사할 팀 없음"으로 위장하지 않는다) |
| src/app/actions/teams.ts | `listTeamsAdmin` 의 workspace_id 필터는 Task 11 이 넣었다 | admin 클라이언트 생성을 `adminFor({ workspaceId })` 로 바꿨다. addTeam·updateTeam 이 아직 직접 만들기 때문에 파일은 표에 남는다 |
| src/lib/teams/master.ts | 캐시에 워크스페이스가 없었다(`Team` 에 `workspaceId` 가 없었다) | `workspace_id` 를 select 하고 `Team.workspaceId` 에 싣는다. `teamsForWorkspaceSync`·`activeTeamCodesForWorkspaceSync` 를 추가했다(한 번도 로드하지 못했으면 throw) |

바꾸지 않은 것:
- `api/v1/agent/watch`: 스펙이 짚은 누설은 `agent_watchers.workspace_id` 가 없다는 것이었고, 0006·Task 3 이 채웠다. 필터 없는 쿼리로는 7일 GC 하나가 남는데, 행 내용을 읽지 않는 전역 정리라서 그대로 둔다. 본문 project_id 의 멤버십 판정 누락은 별개 문제로 "남은 경계" 3 에 적었고 Task 13 이 닫았다.
- `actions/accounts.ts` `assertCanTouchAccount`: 컨트롤러 판정 a35 에 따라 워크스페이스로 좁히지 않았다. 유일한 호출부가 플랫폼 전용 `resetPassword` 이고, 계정은 전역이다(D1).

## 남은 경계(이 태스크 범위 밖 — 후속)

1~4 는 외부 API 판정을 actorFromUser + roleIn 으로 통합한 **Task 13** 이 닫았다(외부 계약은 회의록 API v2.7). 5~7 은 남아 있다.

1. ~~**`GET /api/v1/minutes`(목록)**~~ — **닫힘(Task 13)**: 종전엔 공유 시크릿만 확인해 전 워크스페이스의 회의록 목록(제목·external_id·작성자명)을 돌려줬다. 이제 `user_email` 이 필수다(없으면 400, 모르는 계정이면 403 `unknown_user`). 호출자 워크스페이스로 `in('workspace_id')` 를 걸고, 그 안에서 볼 수 없는 비공개 프로젝트(canSeeProject 거짓)의 회의록을 뺀다. 무프로젝트 회의록은 워크스페이스 멤버에게 보인다. 플랫폼 관리자는 전부다. 권한·프로젝트 조회 실패는 500 이다.
2. ~~**`POST /api/v1/minutes/link`**~~ — **닫힘(Task 13)**: minute_id 로 찾은 회의록에 `canEditMinute`(작성자 또는 그 프로젝트 관리자 — 세션 `checkOwner` 와 같은 판정으로 옮겼다)를 요구한다. 자격이 없으면 없는 회의록과 같은 404 `not_found` 라 다른 워크스페이스 회의록의 존재·보관 여부가 드러나지 않는다.
3. ~~**`POST /api/v1/agent/watch`**~~ — **닫힘(Task 13)**: upsert 전에 PAT 소유자 스냅샷으로 그 프로젝트의 멤버 이상(`isProjectMember` — 명단 권한·워크스페이스 관리자·플랫폼 관리자)인지 본다. 감시자는 허브·좌석표에 보이는 쓰기라 조회 전용도 막는다. 아니면 404 다. 프로젝트 한정 PAT 도 같은 판정을 거친다 — 아래 7 의 "쓸 수 없는 토큰" 이 watch 에서도 404 가 된다. stop 은 자기 행만 지우므로 판정하지 않는다.
4. ~~**`POST /api/v1/minutes`**~~ — **닫힘(Task 13)**: `meeting_id` 는 그 회의 프로젝트의 멤버 이상(`isProjectMember`)만 연결한다. 없는 회의와 남의 회의를 같은 404 로 답한다(종전 없는 회의는 400). external_id 는 전역 유일이라 조회는 전역이지만, 찾은 행(동시 전송 경합의 재조회 포함)에 `canEditMinute` 를 요구하고 아니면 404 다 — replace 뿐 아니라 skip·error·보관 분기도 같은 404 라 남의 external_id 존재를 드러내지 않는다. 판정은 inline `meeting` 확보보다 먼저라 고아 회의가 생기지 않는다. `actorFromUser` 는 모든 POST 에서 한 번 돈다.
5. **`teamsForProjectSync` 의 전역 폴백**: 프로젝트 팀이 없으면 `resolveTeamsForProject` 가 전 워크스페이스의 공용 팀을 섞어서 돌려준다. 이렇게 되는 이유는 캐시가 프로젝트→워크스페이스를 모르기 때문이다. 캐시 구조를 바꾸는 일이라 SP4 R10 몫이다.
6. **`teamsSync()`·`activeTeamCodesSync()` 호출처**(회의록 액션·AI 도구 등): 전 워크스페이스 공용 팀으로 검증한다. 회의록 계열은 Task 16 이 워크스페이스판으로 옮긴다.
7. **`agentTokens.createAgentToken`**: `project_id` 가 발급자의 워크스페이스에 속하는지 검사하지 않는다. 쓰는 시점에 라우트가 판정하므로 데이터가 새지는 않는다(watch 도 Task 13 부터 판정한다 — 위 3). 다만 쓸 수 없는 토큰이 만들어질 수 있다.
