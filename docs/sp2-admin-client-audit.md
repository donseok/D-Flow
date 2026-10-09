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
| src/app/(app)/w/[slug]/settings/integrations/page.tsx | 세션 가드 뒤 id 스코프 | workspacePageAccess(wid) 로 워크스페이스 관리자 이상을 확인한 뒤 그 wid 로 연동 자격증명을 조회한다 |
| src/app/actions/accounts.ts | 세션 가드 뒤 id 스코프 | create·bulk·setWorkspaceRole·listAccounts·removeWorkspaceMember·previewWorkspaceMemberRemoval 는 requireWorkspaceAdmin(wid) 뒤에 그 wid(listAccounts 는 pid)로 좁힌다. resetPassword 도 requireWorkspaceAdmin(wid) 뒤 — 대상의 등급 축만은 전역으로 읽는다(loadAccountTargets: 다른 워크스페이스 소속까지 봐야 경계를 가른다, D1 계정 전역). setPlatformAdmin 은 requireSuperuser 다 |
| src/lib/authz/accountsAccess.ts | 세션 가드 뒤 id 스코프 | 형만 import 한다. loadAccountTargets 는 넘겨받은 계정 id 들의 platform_admins·workspace_members 를 전 워크스페이스에서 읽는다(계정 조작 판정의 입력 — 값은 서버 안에서만 쓰고 판정 결과만 내린다). 호출부는 requireWorkspaceAdmin 뒤의 resetPassword·listAccounts 둘 |
| src/app/actions/agentHub.ts | 세션 가드 뒤 id 스코프 | requireProjectMember(pid) 뒤. 항목·주문은 id 로 읽고 project_id === pid 인지 다시 확인한 뒤에 쓴다 |
| src/app/actions/agentTokens.ts | 세션 가드 뒤 id 스코프 | 세션 사용자 = owner_user_id 로만 발급·폐기·목록 처리한다. PAT 의 project_id 는 쓰는 시점에 라우트가 멤버십으로 판정한다 |
| src/app/actions/agentWork.ts | 세션 가드 뒤 id 스코프 | 주문 행의 project_id 로 requireProjectAdmin 또는 서브트리 관리자를 판정한 뒤, 그 주문·항목 id 로만 쓴다 · 옛 토글의 modules.enabled 내부 쓰기(D41, SP3a Phase B — Phase C 가 지운다) |
| src/app/actions/inbox.ts | 세션 가드 뒤 id 스코프 | getSession 사용자의 notification_recipients(user_id 필터)만 읽음 표시한다 |
| src/app/actions/integrations.ts | 세션 가드 뒤 id 스코프 | requireWorkspaceAdmin(wid) 뒤에 그 wid 로 integration_credentials 를 조회·저장·회수한다 |
| src/app/actions/inviteRedeem.ts | 외부 API·서비스 | 초대 토큰의 해시로 초대 1건을 찾는다. 그 초대가 가리키는 워크스페이스(허용 도메인 설정)·프로젝트·팀 id 와 이메일로만 조회하고 쓴다 |
| src/app/actions/issues.ts | 세션 가드 뒤 id 스코프 | requireProjectMember(pid) 뒤에 그 pid 로 RPC 를 부르고, 이슈 id 로 issue_updates 에 insert 한다. 회의록 블록 이슈의 원문은 그 회의록의 프로젝트가 pid 이거나, 프로젝트가 없으면 그 워크스페이스가 pid 의 워크스페이스일 때만 받는다(최종 리뷰 F10 — 0009 issue_links 트리거가 DB 에서도 막는다) |
| src/app/actions/minutes.ts | 세션 가드 뒤 id 스코프 | 회의록 id 를 받는 액션은 resolveScope('minutes', id) 로 대상 행의 프로젝트·워크스페이스를 확정한 뒤 그 범위의 isMinuteMember(requireMinuteMember) 또는 canEditMinute(checkOwner)로 판정하고(Task 16a), 그 회의록·폴더 id 로 하이라이트·폴더 이동·공유 토큰을 읽고 쓴다(0011 뒤 세션은 share_token 열을 읽지 못한다). SP5 B3: removeMinuteFile 은 세션이 읽은 첨부 행의 회의록에 checkOwner(canEditMinute) 뒤, 그 id·minute_id·role='attachment'·활성 행에만 톰스톤(deleted_at/by)을 찍고 그 행의 경로 객체를 지운 뒤 purged_at 을 기록한다 — 세션 DELETE 는 0021 에서 회수, 행 변경 범위는 mutation guard 가 막는다 |
| src/app/actions/platformWorkspaces.ts | 플랫폼 | 목록·생성은 requireSuperuser(플랫폼 가드 닫힌 목록) 뒤다. 목록은 전 워크스페이스·멤버십·프로젝트의 workspace_id 만 읽어 수를 세고, 생성은 첫 관리자 프로필 한 행을 읽은 뒤 create_workspace_with_admin RPC 한 번이다(0054 — 워크스페이스·멤버십·인물·설정이 한 트랜잭션, RPC 가 플랫폼 관리자를 다시 판정한다). 워크스페이스가 아직 없거나 전부를 보는 화면이라 스코프를 정할 id 가 없다. 삭제(deletePlatformWorkspace)도 requireSuperuser 뒤의 delete_empty_workspace RPC 한 번이다(0055 — RPC 가 플랫폼 관리자를 다시 판정하고, workspaces 를 참조하는 표 전부가 비었을 때만 지운다). 이름 변경(renameWorkspace)만 requireWorkspaceAdmin(wid) 뒤다 — 가드가 판정한 그 wid 로 rename_workspace RPC 한 번(RPC 가 워크스페이스 관리자를 다시 판정한다), 표를 직접 읽거나 쓰지 않는다 |
| src/app/actions/project.ts | 세션 가드 뒤 id 스코프 | createProject 는 requireWorkspaceAdmin(wid) 뒤 adminFor({ workspaceId }) 로 create_project_with_settings 를 부른다(복사 원본은 그 wid 소속인지 먼저 확인). 비공개는 requireProjectAdmin(pid) 뒤 그 pid 로 projects 를 쓴다. 설정 쓰기는 이 파일에 없다(SP3a — settings.ts·write.ts 로 옮겼다) |
| src/app/actions/projectInvites.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid)(관리자 슬롯이면 requireWorkspaceAdmin 도) 뒤에 project_invites 를 pid 로 읽고 쓴다. 허용 도메인은 해석기(getWorkspaceConfig)로 그 프로젝트의 워크스페이스 설정을 읽기만 한다(설정 표를 직접 만지지 않는다 — SP3a) |
| src/app/actions/projectTeams.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤에 teams 를 project_id=pid 로 쓴다. copyGlobalTeams 는 전환 RPC convert_inherited_teams 를 부른다 — 행위자 등급을 RPC 가 다시 판정한다(아래 'DEFINER RPC 가 등급을 다시 판정하는 경로'). addProjectTeam 은 그 pid 가 이미 쓰는 공용 팀과 code·이름 키(NFKC·소문자)가 같은지 referencedCommonTeamCodes(adminFor({ projectId }) — 그 pid 의 담당·명단 팀·영역 팀·수락 전 초대, 후보는 그 워크스페이스 공용 팀만 — workspaceTeams)로 본 뒤에만 만든다(SP4 A2-1·A2-2 리뷰). changeProjectTeamCode·previewProjectTeamMerge·mergeProjectTeams 는 requireProjectAdmin(pid) 뒤에 그 pid 의 전용 팀인지 읽은 뒤에만 RPC 를 부른다(팀 유연화 2단계) |
| src/app/actions/roster.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin 또는 Member(pid) 뒤에 project_members 를 pid·memberId 로 읽고, upsert RPC 에 pid 를 넘긴다 |
| src/app/actions/teams.ts | 세션 가드 뒤 id 스코프 | addTeam 은 requireWorkspaceAdmin(wid) 뒤에 wid 로 필터한다. updateTeam 은 행의 workspace_id 로 가드한 뒤 eq(workspace_id) 로 쓴다. listTeamsAdmin 은 adminFor({ workspaceId }) 를 쓴다. changeTeamCode·previewTeamMerge·mergeTeams 는 requireWorkspaceAdmin(wid) 뒤에 그 wid 의 공용 팀(project_id is null)인지 읽은 뒤에만 RPC(change_team_code·team_reference_counts·merge_teams)를 부른다 — 쓰기 RPC 는 행위자 등급을 다시 판정한다 |
| src/app/actions/wbsBulk.ts | 세션 가드 뒤 id 스코프 | projectMember 및 isProjectAdmin 판정 뒤 RPC의 project/item/revision과 DB의 actor 관리자 재판정으로 쓴다 |
| src/app/actions/wbsAssign.ts | 세션 가드 뒤 id 스코프 | resolveItemProjectId 로 항목의 pid 를 구해 가드한 뒤, 항목 id 와 멤버의 project_id 일치를 확인하고 쓴다 |
| src/app/actions/wbsMarkdown.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤에 부착점·import 를 pid 로 한다. 골격 단계 이름 시드는 가드한 그 pid 로 writeProjectSettingsInternal(runWbsImport 안), PL 대조는 그 pid 로 해석기(getProjectConfig) 판독이다 |
| src/app/actions/wbsSpec.ts | 세션 가드 뒤 id 스코프 | 항목의 pid 로 requireProjectAdmin 또는 위임 자격을 판정한 뒤, 그 항목 id 로만 update 한다 |
| src/app/api/cron/ai-index/route.ts | 플랫폼 | CRON_SECRET 으로만 들어온다(잡 ai-index — 스케줄 GET·수동 POST, 옛 chat/index/worker 흡수). 전 프로젝트 색인 작업 큐이고 사용자에게 행을 돌려주지 않는다(수량 요약만) |
| src/app/api/cron/form-templates-gc/route.ts | 플랫폼 | CRON_SECRET 으로만 들어온다(잡 form-templates-gc). form-templates 버킷의 incoming 폴더만 나열해 24시간 넘은 고아 객체를 지우는 정리 배치다. 등록된 양식(v<n>)은 읽지 않고 응답은 수량뿐이다 |
| src/app/api/cron/minutes-attachments-gc/route.ts | 플랫폼 | CRON_SECRET 으로만 들어온다(잡 minutes-attachments-gc). minutes 버킷의 minute-files 세그먼트만 나열해 어느 행도 가리키지 않는 24시간 넘은 고아 객체와 미정리 톰스톤(지운 첨부)의 객체를 지우고 `purged_at` 을 적는 정리 배치다(수동 스크립트 `npm run minutes:sweep` 과 같은 함수). 본문(minutes 세그먼트)·과거 버전 원본은 읽지 않고 응답은 수량뿐이다 |
| src/app/api/cron/inbox-retention/route.ts | 플랫폼 | CRON_SECRET 으로만 들어온다. 읽은 알림 90일 정리 RPC(전역)다 |
| src/app/api/health/route.ts | 플랫폼 | 헬스체크의 깊은 점검(?deep=1)만 쓴다. CRON_SECRET Bearer 가 맞을 때만 workspaces 한 줄을 읽어 DB 생존을 확인하고, 행 내용·오류 문구는 응답에 싣지 않는다(상태 낱말만). 시크릿이 없거나 틀리면 클라이언트를 만들지 않는다 |
| src/app/api/import/execute/route.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤 그 pid 로만 쓴다(SP4 §4.4). ① 미등록 팀은 그 pid 의 전용 팀만 만든다(ensureProjectTeams — adminFor, 워크스페이스는 가드 결과, teams_guard 가 일치 강제) ② 상속 공용 팀 전환은 convert_inherited_teams 가 행위자 등급을 다시 판정한다 ③ 공용 팀은 그 pid 의 워크스페이스 것만 읽는다(요청 범위 원천 — 세션) ④ 항목·담당·휴일·영수증은 import_wbs_cmd 가 한 트랜잭션에 쓰고 행위자 등급을 다시 판정한다(p_actor = 가드 결과) ⑤ 양식 저장은 가드한 pid 로 writeProjectSettingsInternal(설정 RPC)을 부른다 ⑥ 전용 팀이 있는 프로젝트의 미등록 code 는 등록 전에 referencedCommonTeamCodes(adminFor({ projectId }) — 그 pid 의 담당·명단 팀·영역 팀·수락 전 초대를 읽고, 후보는 그 pid 워크스페이스의 공용 팀뿐)로 그 pid 가 이미 쓰는 공용 팀인지 본다(SP4 Z4) |
| src/app/api/track/route.ts | 플랫폼 | 세션 사용자 본인의 usage_events 에 insert 만 한다. 읽기는 슈퍼유저 전용 /usage 다 |
| src/app/api/v1/agent/me/route.ts | 외부 API·서비스 | 자격증명 행의 워크스페이스로 projects 를 좁혀(플랫폼 관리자 승격 없음) 이름까지 읽고, 응답 행은 자격증명 범위로 좁힌 소유자 스냅샷 키·project_ids 로 다시 거른 뒤 agents 모듈이 켜진 프로젝트만 싣는다(SP7 — 옛 등록 표 없음, 모듈은 워크스페이스 단위로 한 번에 판정) — 프로젝트 id 목록을 URL 에 싣지 않는다(최종 리뷰 F12, 414 방지) |
| src/app/api/v1/agent/watch/route.ts | 외부 API·서비스 | PAT 의 user_id·agent 로 upsert·stop 한다. upsert 전에 PAT 소유자의 actorFromUser 스냅샷으로 isProjectMember(감시 project_id)를 본다 — 조회 전용·다른 워크스페이스면 404(Task 13 에서 고침, 프로젝트 한정 PAT 포함). 프로젝트 없는 감시자는 자격증명 행의 워크스페이스에 역할(hasProjectRoleInWorkspace)이 있어야 하고 아니면 404(최종 리뷰 F13 — SP7: 소속 개수로 워크스페이스를 짐작하지 않는다). 7일 GC 는 내용을 읽지 않는 전역 정리 |
| src/app/api/v1/agent/work/[id]/claim/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 쓴다 |
| src/app/api/v1/agent/work/[id]/heartbeat/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 쓴다 |
| src/app/api/v1/agent/work/[id]/release/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 쓴다 |
| src/app/api/v1/agent/work/[id]/report/route.ts | 외부 API·서비스 | PAT 또는 레거시 신원을 확인하고, loadGatedOrder(ForUser) 로 주문의 pid 에 대한 멤버 판정을 마친 뒤 그 주문 id 로 보고한다 |
| src/app/api/v1/agent/work/[id]/route.ts | 외부 API·서비스 | 먼저 신원을 정한다(resolveReader — PAT 소유자, 레거시 시크릿은 user_email 필수: 없으면 400 identity_required, 모르면 403). 그 신원으로 patProjectAllowed·requireAgentProject·isAgentProjectMember(주문의 pid)를 통과한 뒤 주문 id 로 조회하고, 비멤버는 404 다(최종 리뷰 F8 — 종전 레거시는 멤버십 판정을 건너뛰었다) |
| src/app/api/v1/agent/work/mine/route.ts | 외부 API·서비스 | PAT 이다. accessibleProjectIds(principal) 를 in(project_id) 로 모든 조회에 건다 |
| src/app/api/v1/agent/work/route.ts | 외부 API·서비스 | resolveReader 로 신원(PAT 소유자, 레거시는 user_email 필수)을 정한 뒤 patProjectAllowed·requireAgentProject·isAgentProjectMember(pid)를 통과해야 그 pid 로 조회한다. 레거시도 비멤버는 404(최종 리뷰 F8) |
| src/app/api/v1/minutes/folder/route.ts | 외부 API·서비스 | 공유 시크릿과 user_email 로 actorFromUser 스냅샷을 만들고 isAnyProjectAdmin 으로 프로브를 거른다. external_id 들로 조회한 뒤 호출자 워크스페이스 밖 행은 not_found 로 빼고, 남은 대상마다 isBatchAuthorized(프로젝트 관리자·무프로젝트는 워크스페이스 관리자)를 요구한다(Task 13) |
| src/app/api/v1/minutes/link/route.ts | 외부 API·서비스 | 공유 시크릿과 user_email 로 actorFromUser 스냅샷을 만들고, minute_id 로 찾은 회의록에 canEditMinute(그 회의록 범위의 멤버 이상이면서 작성자 또는 그 프로젝트 관리자 — 세션 checkOwner 와 같은 판정, v2.8 Z3)를 요구한다. 아니면 없는 회의록과 같은 404 다(Task 13·16a) |
| src/app/api/v1/minutes/meta/route.ts | 외부 API·서비스 | 공유 시크릿과 user_email(필수)로 actorFromUser 를 만든다. 프로젝트는 호출자 워크스페이스로 in(workspace_id)(플랫폼 관리자는 전부)을 걸어 페이지로 읽고 스냅샷 키 ∩ canSeeProject 로 거른다 — id 목록을 URL 에 싣지 않는다(최종 리뷰 F12). 팀은 소속 워크스페이스로 좁힌다 |
| src/app/api/v1/minutes/route.ts | 외부 API·서비스 | 두 메서드 모두 user_email 의 actorFromUser 스냅샷으로 좁힌다(Task 13). POST: meeting_id 의 프로젝트에 isProjectMember, external_id 로 찾은 기존 회의록(경합 재조회 포함)에 canEditMinute — 아니면 404. 프로젝트 없는 신규 등록은 그 유일 워크스페이스에 역할(hasProjectRoleInWorkspace — 세션 createMinute 과 같다)이 있어야 하고 아니면 404(최종 리뷰 F14). GET 목록: user_email 필수, 호출자 워크스페이스로 in 을 걸고 볼 수 없는 비공개 프로젝트(canSeeProject 거짓)의 회의록을 뺀다(플랫폼 관리자는 전부). 담당 필터의 팀은 그 스냅샷의 가시 범위(소속 워크스페이스의 공용 ∪ 볼 수 있는 프로젝트의 전용)다 — 질의는 소속 워크스페이스로 좁히고 숨김 프로젝트의 전용 팀은 메모리에서 거른다(visibleTeams — 프로젝트 id 를 URL 에 싣지 않는다, 플랫폼 관리자는 전부, SP4 A2-1·A2-2 리뷰) |
| src/app/api/v1/wbs/import/route.ts | 외부 API·서비스 | PAT 이다. patProjectAllowed·requireAgentProject·멤버·관리자(pid) 판정 뒤 그 pid 로 import 한다. 골격의 단계 이름 시드는 가드한 pid 로 writeProjectSettingsInternal(설정 RPC)을 부른다 |
| src/app/api/v1/wbs/structure/route.ts | 외부 API·서비스 | PAT 또는 레거시 시크릿이다 — 레거시는 user_email 필수(resolveReader, 최종 리뷰 F8). 그 신원으로 patProjectAllowed·requireAgentProject·isAgentProjectMember(pid) 판정 뒤 그 pid 로 조회하고, 비멤버는 404 다 |
| src/app/api/wiki/reindex/route.ts | 플랫폼 | requireSuperuser(플랫폼 11곳)다. 전역 색인 큐·문서 수 통계를 다룬다 |
| src/app/api/wiki/search/route.ts | 세션 가드 뒤 id 스코프 | getActorViewState 뒤 accessScope(내 워크스페이스 프로젝트 ∩ 비공개 판정)의 projectIds 로 in 을 건다 |
| src/app/api/wiki/summarize/route.ts | 세션 가드 뒤 id 스코프 | getActorViewState 뒤 accessScope 판정(decideSearchAccess)을 통과한 projectId 로만 조회한다 |
| src/app/share/minutes/[token]/page.tsx | 외부 API·서비스 | 공유 토큰 경로다. share_enabled·미보관 행 1건의 workspace_id 로 minutes 모듈 관문(admin 으로 workspace_settings 1행)을 지난 뒤, 같은 행에서 화이트리스트 컬럼만 읽는다 |
| src/lib/agent/delegation.ts | 세션 가드 뒤 id 스코프 | requireProjectMember 또는 Admin(항목의 pid) 뒤에 그 항목 id 로 위임 여부를 읽고 쓴다 |
| src/lib/agent/subtreeManager.ts | 세션 가드 뒤 id 스코프 | requireProjectMember(pid) 뒤에 myMemberIds·isSubtreeManager 를 pid·itemId 로 판정한다 |
| src/lib/ai/brief.ts | 세션 가드 뒤 id 스코프 | 호출부(프로젝트 화면·가드된 액션)의 projectId 로 project_ai_briefs 를 읽고 쓴다. RLS 쓰기 정책이 없어 가드가 유일한 관문이다 |
| src/lib/ai/ensure-index.ts | 세션 가드 뒤 id 스코프 | 호출부(레거시 챗 /api/chat·/api/chat/stream — legacyChatProjectGate 가 볼 수 있는 프로젝트만 통과시킨다, 최종 리뷰 F7)가 가드한 projectId 로 wbs_embeddings 수를 세고 색인한다. 색인 자체는 ingestProject 의 RLS 관문 뒤에만 쓴다 |
| src/lib/ai/index/enqueueChange.ts | 세션 가드 뒤 id 스코프 | 증분 색인 등록(SP8). 색인 대상을 쓰는 액션·라우트가 가드·모듈 관문·쓰기 성공 뒤에 넘긴 projectId·엔티티 id 로 ai_index_jobs 에 잡을 넣는다(등록 RPC upsert_ai_index_jobs — service_role 전용). 넣기 전에 그 프로젝트·워크스페이스의 chatbot 모듈을 판정하고(꺼짐·모름은 넣지 않는다), 회의록은 id 로 범위(project_id·workspace_id)만 읽는다. 배포에서 챗봇을 쓸 수 없으면 클라이언트를 만들지 않는다. 사용자에게 행을 돌려주지 않는다 |
| src/lib/ai/health.ts | 플랫폼 | assistantHealth 는 전역 스키마·RPC 프로빙이라 행을 노출하지 않는다. assistantIndexStatus 는 projectId 로 카운트만 한다 |
| src/lib/ai/ingest.ts | 세션 가드 뒤 id 스코프 | 호출부(reindex·import/execute·reindexProjectAction 은 requireProjectAdmin, 자가 치유는 레거시 챗 관문)가 가드한 projectId 로 쓴다. 쓰기 전에 RLS 로 프로젝트 행을 확인한다(getProjectName — 볼 수 없으면 throw, 최종 리뷰 F7 심층 방어). 그 뒤에만 그 프로젝트의 팀(요청 범위 원천 projectTeams — 세션)을 읽고 wbs_embeddings 를 upsert·stale 삭제한다 |
| src/lib/ai/issue-analysis.ts | 세션 가드 뒤 id 스코프 | 호출부가 가드한 projectId 로 issue_analysis_runs 를 읽고 쓴다 |
| src/lib/ai/llm-override.ts | 플랫폼 | 플랫폼 LLM 설정(llm_profiles·llm_config, 전역 표)의 읽기 전용 캐시다 |
| src/lib/ai/minutes-ingest.ts | 플랫폼 | ingestMinute 는 회의록 id 1건의 임베딩을 교체한다. self-heal 은 전 회의록 배치이고 응답 행이 없다 |
| src/lib/ai/minutes-insights.ts | 세션 가드 뒤 id 스코프 | 회의록 액션의 가드 뒤, 그 minuteId 로 minute_insights 를 교체한다 |
| src/lib/ai/wiki-ingest.ts | 세션 가드 뒤 id 스코프 | 회의록 후처리 또는 색인 작업의 projectId·jobId 로 위키 행을 읽고 쓴다 |
| src/lib/ai/wiki-saturation.ts | 세션 가드 뒤 id 스코프 | 형(type)만 import 한다. 넘겨받은 admin 으로 projectId 의 위키 토픽을 읽는다 |
| src/lib/data/accounts.ts | 세션 가드 뒤 id 스코프 | 형만 import 한다. listProfiles 는 전 profiles 를 페이지로 읽고(fetchAllPages — count 총합 대조, 최종 리뷰 F11), 호출부 listAccounts(requireWorkspaceAdmin)가 명단으로 거른다 |
| src/lib/data/agentApprovals.ts | 세션 가드 뒤 id 스코프 | getActorForView 뒤에 projectId 의 reported 주문 수를 센다. 판정은 isProjectAdmin·서브트리다 |
| src/lib/data/agentSeatmap.ts | 세션 가드 뒤 id 스코프 | seatmapFloorIds(actor) 로 project_id 에 in 을 건다. 감시자는 층 프로젝트의 workspace_id 로 in 을 건다(이번에 고침). 층은 admin 으로 agents 모듈 관문(projectsWithModule — 층마다 프로젝트·워크스페이스 설정 표)을 지난 것만 싣는다. 전체(플랫폼 관리자) 조회는 꺼진 층을 not in 으로 빼고 다시 읽는다(SP3a Phase B) |
| src/lib/data/minutes.ts | 세션 가드 뒤 id 스코프 | 회의록 상세 화면의 가드 뒤, minuteId·projectId 로 위키 영향 카드를 조회한다 |
| src/lib/data/usage.ts | 플랫폼 | canViewUsage(슈퍼유저)를 다시 검사한 뒤 전역 계정 디렉터리를 만들고 usage_events 보존기간을 정리한다 |
| src/lib/minutes/externalApi.ts | 외부 API·서비스 | 외부 회의록 API 공용부다(AdminClient 형, 게이트, 순수 판정 isBatchAuthorized). 후처리는 minuteId 로 하이라이트를 재매칭한다 |
| src/lib/minutes/folders.ts | 세션 가드 뒤 id 스코프 | 형만 import 한다. 호출부가 넘긴 클라이언트로 teamCode·projectId·workspaceId 필터를 건다 |
| src/lib/notify/emit.ts | 세션 가드 뒤 id 스코프 | 발행 액션(가드 뒤)이 넘긴 recipientMemberIds·UserIds 로만 수신자 행을 만든다 |
| src/lib/supabase/adminFor.ts | adminFor 정의 | uuid 스코프(workspaceId 또는 projectId)를 검사한 뒤 createAdminClient 로 service_role 클라이언트를 돌려준다 |
<!-- audit:end -->

표 밖의 service_role 설정 쓰기(SP3a): `src/app/actions/settings.ts` 는 requireProjectAdmin(pid)·requireWorkspaceAdmin(wid) 뒤
`adminFor({ projectId | workspaceId })` 로 apply_project_settings·apply_workspace_settings 를 부르고, `src/lib/settings/write.ts`
(writeProjectSettingsInternal)는 호출부가 가드한 뒤 넘긴 클라이언트로 revision 을 읽고 RPC 를 부른다. 둘 다 `createAdminClient` 를
직접 부르지 않아 표에 오르지 않는다(불변식은 그 이름을 언급하는 파일 = 표 행을 요구한다). 설정 표 직접 접근은
`tests/invariants/settings-writes.test.ts` 가 막는다.

## 수정한 파일(경계 넘음 → 고침)

| 파일 | 이전 | 이후 |
|---|---|---|
| src/lib/data/agentHub.ts | 감시자 조회에 필터가 없었다. 프로젝트 없는 다른 워크스페이스 감시자가 이 허브에 "떠 있는 팀장"으로 보였다 | 감시자를 프로젝트의 `workspace_id` 로 eq 한다. 프로젝트 행이 없으면 조회하지 않는다. `getAgentHub` 는 `adminFor({ projectId })` 를 쓰므로 **표에서 뺐다** |
| src/lib/data/agentSeatmap.ts | 감시자 조회에 필터가 없었다(층마다 같은 누설) | 층 프로젝트들의 `workspace_id` 로 in 을 건다. 워크스페이스를 모르면 조회하지 않는다 |
| src/app/api/v1/minutes/meta/route.ts | 시크릿만 확인하고 **전 워크스페이스 프로젝트**와 전역 팀을 돌려줬다 | `user_email` 이 필수다. 없으면 400, 모르는 계정이면 403 `unknown_user` 다. 프로젝트는 스냅샷 키 ∩ canSeeProject 로, 팀은 소속 워크스페이스들의 합집합으로 좁힌다. 볼 수 없는 `project_id` 의 회의 목록은 404 다 |
| src/app/api/v1/agent/me/route.ts | enabled 인 `agent_projects` 를 전 워크스페이스에서 훑었다 | PAT 소유자 스냅샷 키로 in 을 건다. 응답 행도 그 키로 다시 거른다 |
| src/app/actions/projectTeams.ts | `copyGlobalTeams` 가 `teamsSync()`(전 워크스페이스의 공용 팀)를 복사했다 | `teamsForWorkspaceSync(프로젝트의 wid)` 에서 복사한다. 팀 마스터를 한 번도 읽지 못했으면 오류를 낸다("복사할 팀 없음"으로 위장하지 않는다) |
| src/app/actions/teams.ts | `listTeamsAdmin` 의 workspace_id 필터는 Task 11 이 넣었다 | admin 클라이언트 생성을 `adminFor({ workspaceId })` 로 바꿨다. addTeam·updateTeam 이 아직 직접 만들기 때문에 파일은 표에 남는다 |
| src/lib/teams/master.ts | 캐시에 워크스페이스가 없었다(`Team` 에 `workspaceId` 가 없었다) | `workspace_id` 를 select 하고 `Team.workspaceId` 에 싣는다. `teamsForWorkspaceSync`·`activeTeamCodesForWorkspaceSync` 를 추가했다(한 번도 로드하지 못했으면 throw) — SP4 B 가 파일을 지웠다(요청 범위 원천 `src/lib/teams/source.ts`) |

바꾸지 않은 것:
- `api/v1/agent/watch`: 스펙이 짚은 누설은 `agent_watchers.workspace_id` 가 없다는 것이었고, 0006·Task 3 이 채웠다. 필터 없는 쿼리로는 7일 GC 하나가 남는데, 행 내용을 읽지 않는 전역 정리라서 그대로 둔다. 본문 project_id 의 멤버십 판정 누락은 별개 문제로 "남은 경계" 3 에 적었고 Task 13 이 닫았다.
- `actions/accounts.ts` `assertCanTouchAccount`: 컨트롤러 판정 a35 에 따라 워크스페이스로 좁히지 않았다. 유일한 호출부가 플랫폼 전용 `resetPassword` 이고, 계정은 전역이다(D1). (계정 수명주기 작업에서 `resetPassword` 가 워크스페이스 관리자에게 열리며 이 함수는 `loadAccountTargets` + 순수 판정 `passwordResetVerdict` 로 바뀌었다 — 대상의 등급 축을 전역으로 읽는 것은 같다.)

## 남은 경계(이 태스크 범위 밖 — 후속)

1~4 는 외부 API 판정을 actorFromUser + roleIn 으로 통합한 **Task 13** 이 닫았다(외부 계약은 회의록 API v2.7). 5·6 은 Task 16a·16b 가 닫았다. 7 은 남아 있다.

1. ~~**`GET /api/v1/minutes`(목록)**~~ — **닫힘(Task 13)**: 종전엔 공유 시크릿만 확인해 전 워크스페이스의 회의록 목록(제목·external_id·작성자명)을 돌려줬다. 이제 `user_email` 이 필수다(없으면 400, 모르는 계정이면 403 `unknown_user`). 호출자 워크스페이스로 `in('workspace_id')` 를 걸고, 그 안에서 볼 수 없는 비공개 프로젝트(canSeeProject 거짓)의 회의록을 뺀다. 무프로젝트 회의록은 워크스페이스 멤버에게 보인다. 플랫폼 관리자는 전부다. 권한·프로젝트 조회 실패는 500 이다.
2. ~~**`POST /api/v1/minutes/link`**~~ — **닫힘(Task 13)**: minute_id 로 찾은 회의록에 `canEditMinute`(작성자 또는 그 프로젝트 관리자 — 세션 `checkOwner` 와 같은 판정으로 옮겼다)를 요구한다. 자격이 없으면 없는 회의록과 같은 404 `not_found` 라 다른 워크스페이스 회의록의 존재·보관 여부가 드러나지 않는다.
3. ~~**`POST /api/v1/agent/watch`**~~ — **닫힘(Task 13)**: upsert 전에 PAT 소유자 스냅샷으로 그 프로젝트의 멤버 이상(`isProjectMember` — 명단 권한·워크스페이스 관리자·플랫폼 관리자)인지 본다. 감시자는 허브·좌석표에 보이는 쓰기라 조회 전용도 막는다. 아니면 404 다. 프로젝트 한정 PAT 도 같은 판정을 거친다 — 아래 7 의 "쓸 수 없는 토큰" 이 watch 에서도 404 가 된다. stop 은 자기 행만 지우므로 판정하지 않는다.
4. ~~**`POST /api/v1/minutes`**~~ — **닫힘(Task 13)**: `meeting_id` 는 그 회의 프로젝트의 멤버 이상(`isProjectMember`)만 연결한다. 없는 회의와 남의 회의를 같은 404 로 답한다(종전 없는 회의는 400). external_id 는 전역 유일이라 조회는 전역이지만, 찾은 행(동시 전송 경합의 재조회 포함)에 `canEditMinute` 를 요구하고 아니면 404 다 — replace 뿐 아니라 skip·error·보관 분기도 같은 404 라 남의 external_id 존재를 드러내지 않는다. 판정은 inline `meeting` 확보보다 먼저라 고아 회의가 생기지 않는다. `actorFromUser` 는 모든 POST 에서 한 번 돈다.
5. ~~**`teamsForProjectSync` 의 전역 폴백**~~ — **닫힘(Task 16b)**: 캐시가 같은 로드에서 `projects(id, workspace_id)` 를 싣고, 전용 팀이 없는 프로젝트는 그 프로젝트 워크스페이스의 공용 팀으로만 폴백한다. 캐시를 한 번도 못 채웠으면 프로젝트 접근자도 throw 하고, 로드 뒤 모르는 pid 는 빈 목록이다(새 프로젝트는 `createProject` 가 캐시를 갱신한다).
6. ~~**`teamsSync()`·`activeTeamCodesSync()` 호출처**~~ — **닫힘(Task 16a·16b)**: 회의록 계열은 16a 가, 앱 레이아웃·AI 컨텍스트(knowledge·ingest·브리핑·위키)·주간 도구·설정 화면은 16b 가 워크스페이스·프로젝트 범위로 옮겼고, 전역 접근자 네 개(`teamsSync`·`activeTeamCodesSync`·`isRegisteredTeamCode`·`isActiveTeamCode`)를 export 에서 지웠다. 호출자 쪽 담당 필터(채팅·외부 GET·봇)는 `teamCodesVisibleTo`(소속 워크스페이스 공용 팀 + 볼 수 있는 프로젝트의 전용 팀, 플랫폼 관리자는 전부) 하나를 쓴다.
7. **`agentTokens.createAgentToken`**: `project_id` 가 발급자의 워크스페이스에 속하는지 검사하지 않는다. 쓰는 시점에 라우트가 판정하므로 데이터가 새지는 않는다(watch 도 Task 13 부터 판정한다 — 위 3). 다만 쓸 수 없는 토큰이 만들어질 수 있다.

## 최종 리뷰 fix wave(2026-09-26) — 이 표의 근거가 틀렸던 행

최종 리뷰가 표를 표본 대조해 근거가 코드와 다른 행을 찾았다. 코드를 고쳐 근거를 사실로 만들었다(위 표에 반영).
- `ensure-index.ts`·`ingest.ts` 의 "호출부가 가드한 projectId" 는 레거시 챗 라우트(`/api/chat`·`/api/chat/stream`)에서 거짓이었다 —
  세션만 확인해 B 사용자가 A 의 pid 로 자가 치유 색인(service_role upsert)을 일으켰다. 세 레거시 챗 라우트에 `legacyChatProjectGate`
  (볼 수 없으면 404, 목록 실패면 500)를 두고, `ingestProject`·`loadProjectAnalysis` 가 RLS 로 프로젝트 행을 먼저 확인한다(F7).
- `agent/work`·`agent/work/[id]`·`wbs/structure` 의 멤버십 판정은 PAT 에만 걸려 있었다 — 레거시 시크릿은 신원 없이 모든 워크스페이스를
  읽었다. 레거시 읽기에 `user_email` 을 요구하고 같은 판정을 건다(F8, 레거시 v1 계약 변경 — `docs/design/dflow-agent-work-api-spec.md`·
  `.claude/skills/dflow-work/references/api-contract.md` 반영. PAT 계약 버전 2.4 는 그대로다).
- `minutes/meta`·`agent/me` 의 `.in('id', …)` 은 프로젝트 약 205개부터 414 로 거절됐다 — 워크스페이스로 좁히고 메모리에서 거른다(F12).
- `agent/watch`·`minutes` POST 의 프로젝트 없는 분기는 워크스페이스 역할을 보지 않았다(F13·F14).

## DEFINER RPC 가 등급을 다시 판정하는 경로(SP4 — D28·D51)

위 표는 service_role 클라이언트를 직접 만드는 파일만 담는다(`tests/invariants/admin-scope.test.ts`). 아래 경로는 `adminFor(scope).admin` 으로
service_role DEFINER RPC 를 부르므로 표에 행이 없다. 세션 RLS(2차 방어선)가 빠지는 대신, RPC 가 `p_actor`(액션 가드 결과의 `actor.userId` —
`tests/invariants/rpc-actor-source.test.ts` 가 출처를 본다)로 그 프로젝트의 관리자 등급을 `actor_is_project_admin` 으로 다시 판정한다.

| 호출부 | RPC | 액션 가드 | RPC 안의 판정 |
|---|---|---|---|
| `src/app/actions/weekly.ts#createWeeklyReport` | `create_weekly_report` | `requireProjectAdmin(pid)` → `requireModule weekly` | 관리자 아님 `42501 WEEKLY_FORBIDDEN`, 프로젝트 없음 `P0002 PROJECT_NOT_FOUND` |
| `src/app/actions/projectAreas.ts#upsertArea` | `upsert_project_area` | `requireProjectAdmin(pid)`(모듈 관문 없음 — D25) | 관리자 아님 `42501 AREA_FORBIDDEN`, 영역은 `project_id = p_project_id` 로만 찾아 다른 프로젝트의 영역 id 는 `P0002 AREA_NOT_FOUND`(아무것도 바꾸지 않는다) |
| `src/app/api/import/execute/route.ts#POST` | `import_wbs_cmd` | `requireProjectAdmin(pid)` | 관리자 아님 `42501 IMPORT_FORBIDDEN`, 프로젝트 없음 `P0002 PROJECT_NOT_FOUND`, 같은 명령 id·다른 요약 `23505 COMMAND_REUSED` |
| `src/app/api/import/execute/route.ts#POST`(상속 프로젝트의 미등록 팀 등록 앞) | `convert_inherited_teams` | `requireProjectAdmin(pid)` | 관리자 아님 `42501 TEAM_CONVERT_FORBIDDEN`, 프로젝트 없음 `P0002 PROJECT_NOT_FOUND` |
| `src/app/actions/projectTeams.ts#copyGlobalTeams`('공용 팀 전환으로 시작' — SP4 B, T14) | `convert_inherited_teams` | `requireProjectAdmin(pid)` | 관리자 아님 `42501 TEAM_CONVERT_FORBIDDEN`, 프로젝트 없음 `P0002 PROJECT_NOT_FOUND` |
| `src/app/actions/teams.ts#changeTeamCode`·`src/app/actions/projectTeams.ts#changeProjectTeamCode`(팀 코드 바꾸기 — 팀 유연화 2단계) | `change_team_code` | `requireWorkspaceAdmin(wid)`(공용 팀) / `requireProjectAdmin(pid)`(전용 팀) — 그 범위의 팀인지 먼저 읽는다 | 공용 팀은 `actor_is_workspace_admin`, 전용 팀은 `actor_is_project_admin` — 아니면 `42501 TEAM_CODE_CHANGE_FORBIDDEN`. 팀 없음 `P0002 TEAM_NOT_FOUND`, 형식 `22023 TEAM_CODE_INVALID`, 같은 범위 중복 `23505 TEAM_CODE_TAKEN`, M1 불변식 `23514 TEAM_CODE_SCOPE_CONFLICT`. code 불변(teams_guard)은 이 RPC 안에서만 풀린다 |
| `src/app/actions/teams.ts#mergeTeams`·`src/app/actions/projectTeams.ts#mergeProjectTeams`(다른 팀으로 합치기 — 팀 유연화 2단계) | `merge_teams` | `requireWorkspaceAdmin(wid)`(공용 팀) / `requireProjectAdmin(pid)`(전용 팀) — 두 팀이 그 범위의 팀인지 먼저 읽는다 | 등급은 위와 같다 — 아니면 `42501 TEAM_MERGE_FORBIDDEN`. 범위 불일치 `23514 TEAM_MERGE_SCOPE_MISMATCH`, 자기 자신 `22023 TEAM_MERGE_SAME_TEAM`, 대상 비활성 `23514 TEAM_MERGE_TARGET_INACTIVE`, M1 불변식 `23514 TEAM_MERGE_SCOPE_CONFLICT`. 미리보기 `team_reference_counts`(읽기 전용, 행위자 인자 없음)는 같은 액션 가드 뒤에서만 부른다 |
| `src/app/actions/vocab.ts#migrateVocabCode`(어휘 code 이관 — SP5 B4) | `migrate_setting_code` | `requireProjectAdmin(pid)` → 키의 모듈 관문 | 관리자 아님 `42501 VOCAB_MIGRATE_FORBIDDEN`, 같은 code·모르는 키 `22023 VOCAB_MIGRATE_INPUT`, 설정 행 없음 `P0001 SETTINGS_ROW_MISSING`, 격리 수준 `25001 VOCAB_MIGRATE_ISOLATION`, 대상 비활성 `23514 PROJECT_VOCAB_INACTIVE`. advisory 잠금 대신 설정 행 `FOR UPDATE`(어휘 쓰기·다른 이관과 줄 세움) |

가져오기 라우트는 `createAdminClient` 를 직접 부르므로 위 감사표에도 행이 있다(이 절은 클라이언트와 무관하게 RPC 쪽 판정을 적는다).
넷 모두 실행권은 service_role 만이고(anon·authenticated 는 EXECUTE 가 없다 — 각 마이그레이션의 사후검사), 등급은 도우미
`public.actor_is_project_admin(p_actor, p_project_id)`(플랫폼 관리자 ∨ 그 프로젝트 워크스페이스 관리자 ∨ 활성 명단 행·인물의
`access_role = 'admin'`) 하나로 판정하고 거짓이면 쓰기 전에 42501 이다. 넷 다 advisory 잠금을 잡고 함수 속성 `lock_timeout = 15s` 를
둔다(55P03 은 호출부가 503 재시도로 바꾼다).

SP5c `src/app/actions/customFields.ts`는 `adminFor({ projectId })`를 사용한다. 관리자·해당 엔티티 모듈 가드 뒤 프로젝트에 한정한 사용 건수를 키셋으로 읽고, 일괄 채움·삭제는 가드의 actor를 RPC에 전달하여 DB에서 관리자 권한을 다시 검사한다. 직접 클라이언트를 만들지 않으므로 위 감사표의 대상이 아니다.

SPU3 `src/app/actions/wbsBulk.ts#bulkUpdateWbsItems`: projectMember 가드 및 isProjectAdmin(actor, projectId) 뒤 서비스 클라이언트를 만든다. 대상마다 apply_wbs_bulk_item RPC가 프로젝트 관리자 등급과 소속/revision을 다시 확인한다. 팀·이력·필드 쓰기는 항목별 트랜잭션이며 알림/워크플로는 기존 wbsAssign 경로를 사용한다.
