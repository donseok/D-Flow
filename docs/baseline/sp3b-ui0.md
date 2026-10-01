# SP3b UI-0 — 현행 기준선(COM-0)

UI-1~UI-3 눈확인과 SPU2 Q07·SP9 Q01 의 비교 기준이 되는 **기록**이다(스펙 §3). 각 Phase 의 판정은 D48 대로 그 브랜치의 (기준, 머리)를 같은 시드·같은 스크립트로 새로 찍어 비교한다. 이미지는 리포 밖 `/Users/jerry/D-Flow/.superpowers/qa/sp3b/ui0/`(과제 5b 에서 다시 찍은 `invite` 네 장만 `ui0-invite/`)에 있고 여기에는 파일명과 sha256 앞 12자만 적는다. 경로의 `{pid}`·`{minuteId}`·`{topicId}` 는 `db:reset` 으로 사라지는 로컬 시드 id, `[token]` 은 가린 초대·공유 토큰이다.

| 항목 | 값 |
|---|---|
| 트리 | `sp3b/ui0` 머리 `56fa0af` — 앱 코드 = main `81deae9`(`sp3a-done`, `git diff --quiet main HEAD -- src` 참). 빌드는 같은 `src` 의 `a253af1` 에서 했다(그 뒤 커밋은 `scripts/`·`tests/` 만) |
| 일시 | 2026-10-01 12:22~13:56 KST — 시드·빌드 12:22~12:23 · 캡처(2차) 12:40~12:48 · 규모별 성능 12:51~13:11(1차)·13:12~13:56(재측정). 과제 5b — 새 `db:reset` 시드·`invite` 재촬영·결정성 확인 14:16~14:27(스크립트 `341e2a3`·`2f5ef01`, 앱 트리는 같은 main `81deae9`) |
| 서버 | 레인 B 3201 `next start`(프로덕션 빌드), Next 15.5.19, Node v22.18.0 |
| 스택 | `d-flow-lane-b`(api 54421 · db 54422), `[api] max_rows = 20000`(D51 — 로컬 수정, 리포 값은 1000) |
| 브라우저 | Chromium 145.0.7632.6 / Playwright 1.58.2(npx 캐시 — `package.json` 무변경) |
| 시드 | `db:reset` → `dev:bootstrap` → `node scripts/ui-capture.mjs seed`(커밋 `a253af1` — 시드 코드는 과제 2 이후 무변경) — KST 2026-10-01 상대 날짜. 과제 5b(`17f2b82`)부터 시드가 워크스페이스 A 의 초대 허용 도메인에 `example.com` 을 넣는다(이미 있으면 쓰지 않는다) — 그래서 `invite` 네 장만 다시 찍었다(§2) |
| 계정 | 시드 계정 넷(플랫폼 관리자 `ui-platform`·비플랫폼 워크스페이스 관리자 `ui-wsadmin`·멤버 `ui-member`·두 워크스페이스 멤버 `ui-duo`). 비밀번호는 실행마다 임의 값(메모리) — 부트스트랩 관리자 무변경. 화면마다 볼 수 있는 가장 낮은 등급으로 찍는다(`routes.json` 의 `grade`) |
| 캡처 방식 | 뷰포트 캡처(판정 Q5), deviceScaleFactor 1·ko-KR·Asia/Seoul·reducedMotion·새 컨텍스트·CDN 캐시(판정 Q3), 로드 → 네트워크 유휴 → `document.fonts.ready` → 500ms. 가림 = `routes.json` 의 `commonMask`·`mask`(자리를 남기는 `visibility:hidden`)와 `hide`(폭이 실행마다 바뀌는 표시를 레이아웃에서 뺀다 — 과제 5). 실행 시작 때 캡처 계정의 서버 테마(판정 Q8)와 `lastProjectId`(= 시드 프로젝트, 과제 5a)를 고정한다. 과제 5b 부터는 테마 패스마다 캡처 계정 넷의 공지 읽음 워터마크와 시드 프로젝트의 진척 스냅샷도 지운다(시작 상태 = `db:reset` 뒤 첫 실행 — 아래 결정성 행) |
| 범위 | `shoot --since b4283c0,C` — 기준선 31 + 보충 둘(`p-import-admin`·`p-office-lane`) + 설정(C) `ws-settings` = 34행 × 4크기 × 라이트 = 136장 |
| 글꼴 | 136장 가운데 `fallback` 0장 |
| 자기 차이 | `diff ui0 ui0-self` — 136장 가운데 `diff` 0장(0 이어야 한다). 차이율이 0 이 아닌 장: `p-agents@768x1024` 0.178% · `minute@1280x720` 0.000% — 모두 문턱 0.2% 아래(판정 Q33). 앞의 것은 위임 표 sticky 머리글 아래 테두리의 1px 스냅(§2 메모), 뒤의 것은 4px. 이 가림 규칙은 1차 자기 차이(diff 2 — 좌석 화면의 시각 표시)를 고친 뒤의 2차 실행이다 |
| 결정성(과제 5b) | 첫 방문이 써서 다음 화면을 바꾸는 상태 둘을 테마 패스 시작에서 지운다 — ① 공지 읽음 워터마크(과제 5 권고 1, `17f2b82`) ② 시드 프로젝트의 진척 스냅샷(`2f5ef01` — 대시보드가 응답 뒤 오늘 스냅샷을 써서 `db:reset` 뒤 첫 대시보드 방문만 속도 지표가 '—'). `shoot --routes p-announcements,projects,p-dashboard --sizes 1440x900` 를 두 번 찍어 비교: ①만 고친 1차(`ui0-ann-a`·`ui0-ann-b`)는 `diff` 1(`p-dashboard` 0.26% — ②), ② 뒤 2차(`ui0-ann-a2`·`ui0-ann-b2`)는 **`diff` 0**(세 장 0.00%, `p-announcements`·`p-dashboard`·`projects` sha 같음). 전 경로 순서(`portfolio` → `p-dashboard`)로 찍은 `ui0-pf` 는 `diff ui0 ui0-pf` 0(`p-dashboard` sha 같음) — 전 경로를 새로 찍지는 않았다. 과제 5 1차 실행이 같은 시작 상태(워터마크·스냅샷 없음)였고 그때 2차와의 차이는 좌석 시각(가림으로 고침)과 공지 칩뿐이었으므로, 새 시작 상태에서 이 기록과 달라지는 장은 `p-announcements@1440x900` 의 NEW 칩(0.13%, 문턱 아래 — §2 메모)으로 본다 |

## 1. 라우트 표

셸 의존: `PPS` = `ProjectPageShell` 직접, `PPS 하위` = 하위 컴포넌트(`AgentFrame`·`WikiSearch`)가 `ProjectPageShell`, `main` = 셸 없이 main 스크롤(실측 shell §5 를 main `81deae9` 에서 다시 확인). 현재 게이트의 줄 번호는 main `81deae9` 기준. 가시 h1 은 `meta.json` 의 `h1Count`(보이는 h1 수). SP3b 처분은 브리프의 배정에 스펙 §6(UI-3)이 더하는 일을 괄호로 붙였다.

| # | 키 | 경로 | 파일 | 패턴(개정 §5.9.4) | 태그 | 셸 의존 | 현재 게이트 | 가시 h1(1280×720 / 390) | SP3b 처분 | 화면 이행 SP |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `root` | `/` | `page.tsx` | 리디렉션 | W | — | `redirect('/projects')`(:4) | 1 / 1(최종 `/projects`) | UI-2a(리졸버) | SP3b |
| 2 | `login` | `/login` | `login/page.tsx` | 단일 작업 | O | 앱 셸 없음 | 없음(공개) | 1 / 1 | 셸 교체(UI-2b)만(앱 셸 없음 — 토큰은 UI-1, 스펙 §6.6) | SP3b(UI-1 토큰) |
| 3 | `invite` | `/invite/[token]` | `invite/[token]/page.tsx` | 단일 작업: 워크스페이스·프로젝트·권한·본인 식별 | O | 앱 셸 없음(`app-backdrop`) | `notFound()`(:17 — service_role 미설정), 무효 초대는 카드 문구 | 1 / 1 | 셸 교체(UI-2b)만(+ UI-3 단일 작업 모양, 스펙 §6.6) | SP3b |
| 4 | `share` | `/share/minutes/[token]` | `share/minutes/[token]/page.tsx` | 문서 읽기(앱 메뉴 없음, 공유 범위·버전) | O | 앱 셸 없음(`ShareViewer`) | `notFound()`(:15·:19·:30·:33·:42) | 2 / 2 | 셸 교체(UI-2b)만 | SP8 |
| 5 | `projects` | `/projects` | `(app)/projects/page.tsx` | 행 목록 | W | `main`(`.hero-card`) | 없음 | 1 / 1 | UI-2b(`/w/[slug]/projects` 이동 — C 파일, D45)(+ UI-3 행 목록, 스펙 §6.2) | SP3b |
| 6 | `meetings` | `/meetings` | `(app)/meetings/page.tsx` | 월/주/목록, 범위 칩 | W·S | PPS | `requireModulePage(null, 'meetings')`(:25) | 0 / 0 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP5 |
| 7 | `minutes` | `/minutes` | `(app)/minutes/page.tsx` | 폴더·목록·문서 3영역 | W·S | PPS | `requireModulePage(null, 'minutes')`(:29) | 0 / 0 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP5 |
| 8 | `minute` | `/minutes/[id]` | `(app)/minutes/[id]/page.tsx` | 문서 | W | `main`(`MinuteViewer`, xl 안쪽 스크롤) | `notFound()`(:31·:41·:42), `requireModulePage({ workspaceId }, 'minutes')`(:32 — 행의 워크스페이스) | 2 / 2 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP8 |
| 9 | `agents` | `/agents` | `(app)/agents/page.tsx` | 실행 현황·필요 조치 | W | PPS 하위(`SeatmapView` → `AgentFrame`) | `canViewAgents` 거부 → `redirect('/projects')`(:13), `requireModulePage(null, 'agents')`(:14) | 0 / 0 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP7 |
| 10 | `portfolio` | `/portfolio` | `(app)/portfolio/page.tsx` | 비교 표 + 마감 타임라인 | W | `main` | `canViewPortfolio` 거부 → `redirect('/projects')`(:23), `requireModulePage(null, 'portfolio')`(:24) | 0 / 0 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP8 |
| 11 | `usage` | `/usage` | `(app)/usage/page.tsx` | 기간·대상 → 추세 → 상세 | W | `main` | `canViewUsage` 거부 → `redirect('/projects')`(:35), `requireModulePage(null, 'usage')`(:36) | 0 / 0 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP8 |
| 12 | `admin-accounts` | `/admin/accounts` | `(app)/admin/accounts/page.tsx` | 관리 목록 + 행 상세 | W | `main` | 행위자 없음·비플랫폼 관리자·관리 프로젝트 없음 → `redirect('/projects')`(:22·:23·:32) | 0 / 0 | UI-2a(`/w/[slug]` 이동)(+ UI-3, 스펙 §6.6) | SP3b |
| 13 | `admin-teams` | `/admin/teams` | `(app)/admin/teams/page.tsx` | 관리 목록 | W·S | `main` | `canManageTeams` 거부 → `redirect('/projects')`(:16) | 0 / 0 | UI-2a(`/w/[slug]` 이동) | 이동 SP3b, 화면 SP4 |
| 14 | `llm-config` | `/admin/llm-config` | `(app)/admin/llm-config/page.tsx` | 보호된 편집(비밀 가림, 저장·테스트 분리) | — | `main` | `canManageLlmConfig` 거부 → `redirect('/projects')`(:15) | 0 / 0 | UI-2b(`(global)`) | SP8 |
| 15 | `account` | `/account` | `(app)/account/page.tsx` | 개인 설정(테마·밀도·시작 화면·언어) | — | `main`(`AccountView`) | 없음(미들웨어 인증) | 0 / 0 | UI-2b(`(global)`)(+ UI-3 구역, 스펙 §6.6) | SP3b |
| 16 | `p-dashboard` | `/p/[projectId]/dashboard` | `(app)/p/[projectId]/dashboard/page.tsx` | 요약 → 위험·다음 마감 → 추세 | P | PPS | `requireModulePage({ projectId }, 'dashboard')`(:26), `notFound()`(:49) | 0 / 0 | 셸 교체(UI-2b)만(라벨 '개요' — UI-2, 스펙 §6.6) | 라벨 SP3b, 위젯 SP4 |
| 17 | `p-wbs` | `/p/[projectId]/wbs` | `(app)/p/[projectId]/wbs/page.tsx` | 작업 계획(표·간트·보드) | P·F | PPS(`flush`) | `requireModulePage({ projectId }, 'wbs')`(:31) | 0 / 0 | 셸 교체(UI-2b)만(+ UI-3 보기 전환, 스펙 §6.3) | 보기 전환 SP3b, 그리드 SPU2, 대량·간트 SPU3 |
| 18 | `p-gantt` | `/p/[projectId]/gantt` | `(app)/p/[projectId]/gantt/page.tsx` | 리디렉션(유지) | P | — | `requireModulePage({ projectId }, 'wbs')`(:7) → `redirect(…/wbs?view=timeline)`(:8) | 0 / 0(최종 작업 계획) | 셸 교체(UI-2b)만 | — |
| 19 | `p-kanban` | `/p/[projectId]/kanban` | `(app)/p/[projectId]/kanban/page.tsx` | `wbs?view=board` 로 리디렉션(예정) | P | PPS | `requireModulePage({ projectId }, 'kanban')`(:18) | 0 / 0 | UI-3(D36 — 작업 계획 보드로 흡수·스텁) | SP3b |
| 20 | `p-import` | `/p/[projectId]/import` | `(app)/p/[projectId]/import/page.tsx` | 파일 → 매핑 → 검증 → 결과 | P | PPS | `requireModulePage({ projectId }, 'wbs')`(:35), 페이지 안 `isProjectAdmin` 분기(멤버 = 제한 문구) | 0 / 0 | 셸 교체(UI-2b)만 | SP4(멱등·실행 ID·결과 링크), fingerprint·매핑 복원은 출시 후 |
| 21 | `p-import-admin`(보충) | 같음(워크스페이스 관리자) | 같음 | 같음 | P | PPS | 같음(관리자 = 마법사, 판정 Q10) | 0 / 0 | 셸 교체(UI-2b)만 | SP4 |
| 22 | `p-issues` | `/p/[projectId]/issues` | `(app)/p/[projectId]/issues/page.tsx` | 저장 필터 + 목록/보드 + inspector | P·S·F | PPS | `requireModulePage({ projectId }, 'issues')`(:20) | 0 / 0 | 셸 교체(UI-2b)만 | SP5 |
| 23 | `p-weekly` | `/p/[projectId]/weekly` | `(app)/p/[projectId]/weekly/page.tsx` | 기간 선택 → 영역 행 시트 | P·S | PPS | `requireModulePage({ projectId }, 'weekly')`(:23) | 0 / 0 | 셸 교체(UI-2b)만 | SP4 |
| 24 | `p-meetings` | `/p/[projectId]/meetings` | `(app)/p/[projectId]/meetings/page.tsx` | 일정 | P·S | PPS | `requireModulePage({ projectId }, 'meetings')`(:30) | 0 / 0 | 셸 교체(UI-2b)만 | SP5 |
| 25 | `p-wiki` | `/p/[projectId]/wiki` | `(app)/p/[projectId]/wiki/page.tsx` | 주제 목록 → 읽기 | P | PPS 하위(`WikiSearch`) | `requireModulePage({ projectId }, 'wiki')`(:28), `notFound()`(:42·:49) | 0 / 0 | 셸 교체(UI-2b)만 | SP8 |
| 26 | `p-wiki-topic` | `/p/[projectId]/wiki/topics/[topicId]` | `(app)/p/[projectId]/wiki/topics/[topicId]/page.tsx` | 문서(출처·검증 상태) | P | PPS | `requireModulePage({ projectId }, 'wiki')`(:18) | 0 / 0 | 셸 교체(UI-2b)만 | SP8 |
| 27 | `p-announcements` | `/p/[projectId]/announcements` | `(app)/p/[projectId]/announcements/page.tsx` | 피드 + 읽기 | P | PPS | `requireModulePage({ projectId }, 'announcements')`(:19) | 0 / 0 | 셸 교체(UI-2b)만 | SP5 |
| 28 | `p-members` | `/p/[projectId]/members` | `(app)/p/[projectId]/members/page.tsx` | 사람 행, 다중 팀 칩, 초대 상태 | P | PPS | `requireModulePage({ projectId }, 'members')`(:22), `notFound()`(:28) | 0 / 0 | 셸 교체(UI-2b)만(+ UI-3 실효 역할 열, 스펙 §6.5) | SP4 |
| 29 | `p-attendance` | `/p/[projectId]/attendance` | `(app)/p/[projectId]/attendance/page.tsx` | 개인×날짜 매트릭스(모바일 날짜별 목록) | P·S | PPS | `requireModulePage({ projectId }, 'attendance')`(:19) | 0 / 0 | 셸 교체(UI-2b)만 | SP5 |
| 30 | `p-agents` | `/p/[projectId]/agents` | `(app)/p/[projectId]/agents/page.tsx` | 실행 목록·검토 대기 | P·F | PPS 하위(`AgentHubView` → `AgentFrame`) | 비멤버 → `redirect(…/dashboard)`(:25), `requireModulePage({ projectId }, 'agents')`(:26) | 0 / 0 | 셸 교체(UI-2b)만 | SP7 |
| 31 | `p-office` | `/p/[projectId]/agents/office` | `(app)/p/[projectId]/agents/office/page.tsx` | 좌석 보기(보조) | P | PPS 하위(`SeatmapView` → `AgentFrame`) | 비멤버 → `redirect(…/dashboard)`(:18), `requireModulePage({ projectId }, 'agents')`(:19), `notFound()`(:21 uuid 형식·:24 프로젝트 없음) | 0 / 0 | 셸 교체(UI-2b)만 | SP7 |
| 32 | `p-office-lane`(보충) | 같음(상태 레인 클릭) | 같음 | 같음 | P | PPS 하위 | 같음 | 0 / 0 | 셸 교체(UI-2b)만 | SP7 |
| 33 | `p-settings` | `/p/[projectId]/settings` | `(app)/p/[projectId]/settings/page.tsx` | 설정 작업 공간(§5.9.3) | P·S | PPS | `requireModulePage({ projectId }, 'settings')`(:109), 비관리자 → `redirect(…/dashboard)`(:127) | 0 / 0 | 셸 교체(UI-2b)만(+ UI-3 시각 패턴·`views.default`, 스펙 §6.4) | SP3a(기능)·SP3b(UI-3) |
| 34 | `ws-settings`(C) | `/w/[slug]/settings` | `(app)/w/[slug]/settings/page.tsx` | 설정 작업 공간 | W·S(목록 태그 S) | `main`(`mx-auto max-w-5xl`, 자체 h1) | `workspacePageAccess(slug)` 비관리자 → `redirect('/projects')`(:41) | 1 / 1 | 셸 교체(UI-2b)(+ UI-3 시각 패턴·`portal.widgets`, 스펙 §6.4) | SP3a(기능)·SP3b(UI-3) |
| 예정 | — | `/w/[slug]` | — | 포털 | W | — | — | — | UI-2a(홈 v0)·UI-3(포털 v1, 스펙 §6.1) | SP3b |
| 예정 | — | `/w/[slug]/my-work` | — | 목록 + inspector | W | — | — | — | UI-2a(내 업무 v0) | SPU2 |
| 예정 | `admin-ui-states` | `/admin/ui-states` | `(app)/(global)/admin/ui-states/page.tsx` | 상태 점검(5.7.3) | — | — | 예정(UI-1 `uiStatesAccess` — 행위자 없음 404, `routes.json` 등급 플랫폼 관리자) | — | UI-1 | SP3b(UI-1) |

- 1280×720·390 에서 가시 h1 이 0 인 행이 34행 가운데 27행(보충 둘 포함)이다 — `PageHero` 의 컴팩트 숨김과 `ProjectPageShell` 의 컴팩트 히어로 생략 때문(실측 shell §5 와 같다). 컴팩트에서도 1 인 행은 `root`(최종 `/projects`)·`login`·`invite`·`projects`·`ws-settings`(C 의 새 화면 — 자체 h1) 다섯, 2 인 행은 `minute`·`share` 둘(화면 머리 h1 + 회의록 본문 `# 설계 검토 회의` 가 그리는 h1). 개정 done_when ④("모든 페이지 h1 정확히 1개, 컴팩트 포함")의 대상이다.
- 1440×900 에서는 34행 모두 1 이상이다(`minute`·`share` 는 2).

## 2. 캡처(라우트 × 4크기 × 라이트)

`meta.json`: commit `56fa0af` · scriptCommit `56fa0af` · browser `145.0.7632.6` · kstDate `2026-10-01` · seedDate `2026-10-01` · baseUrl `http://127.0.0.1:3201` · 136행 모두 `idle: true`(네트워크 유휴 도달)·`font: ok`·`problems` 없음. `expect` 셋(`agents`·`p-office` 의 `[data-roster-desk]`, `p-office-lane` 의 `[data-state="BLOCKED"]`)이 모두 잡혔다. 표의 `invite` 네 행만 과제 5b 재촬영 `ui0-invite` 다 — `meta.json`: commit `341e2a3` · scriptCommit `341e2a3` · browser `145.0.7632.6` · kstDate·seedDate `2026-10-01`(새 `db:reset` 시드) · 2026-10-01 14:17 KST · 같은 앱 트리(main `81deae9`) 프로덕션 빌드 · 네 장 `idle: true`·`font: ok`·문제 없음.

캡처 메모(기록 — 판정이 아니다):

- **좌석 화면의 시각 표시는 가렸다**(과제 5 자기 차이에서 찾음). `agents`·`p-office`·`p-office-lane` 은 조작 줄 끝의 '갱신 HH시 MM분 SS초'를 `hide`(`[aria-label="표시 범위"] + div`) — 고정폭이지만 분·초 자릿수가 바뀌면 폭이 달라져 '잡담'·'내 작업|전체'를 민다. `agents`·`p-office` 의 책상 카드 '신호 N분 전'·프로필 '마지막 신호 · N분 전'·신호 계기 표식은 `mask`(계기 막대 자체는 보인다). `p-agents` 의 '갱신' 시각은 `hide`(`[data-hub-stamp]`). 그래서 이 네 화면의 PNG 에는 그 시각 글자가 없다(좌석표 세 화면은 '내 작업|전체' 가 줄 오른쪽 끝에 붙는다).
- `p-agents@768x1024` 의 자기 차이 0.178% 는 위임 표 sticky 머리글 아래 테두리가 1px 위아래로 스냅하는 것이다 — 머리글 글자와 아래 행은 픽셀까지 같고, 실행마다 두 상태를 오간다(판정 Q33 의 서브픽셀 흔들림). UI-1 비교에서 이 장의 0.18% 안팎은 잡음 후보다.
- **`invite` 는 과제 5b 에서 다시 찍었다(`ui0-invite`) — 이유: 시드 초대 도메인.** 처음 기록(`ui0`)은 유효 초대가 아니라 "만료되었거나 사용할 수 없는 초대입니다" 화면이었다 — 시드 초대(`ui-invitee@example.com`)는 만료·취소·소비 전이지만 워크스페이스 A 의 `invites.allowed_domains`(SP3a 가 더한 초대 도메인 허용)가 제품 기본값 `[]`(초대 불가)이라 `getInvitePreview` 의 도메인 재검사가 '사용할 수 없음'을 냈다. 시드가 A 에 `example.com` 을 넣도록 고친 뒤(`17f2b82`) 네 장 모두 수락 가능한 카드다 — 계정 없는 초대 대상의 가입 폼(초대받은 프로젝트 `UI-CAPTURE`·설명(시드 표식 `ui-capture seed 2026-10-01`)·가린 이메일 `ui********@example.com`·이름·비밀번호·비밀번호 확인·'가입하고 합류하기'). `diff ui0 ui0-invite` 는 네 장 모두 차이(1440 3.71% · 1280 7.26% · 768 6.12% · 390 23.42%). A 의 설정이 바뀌어도 `ws-settings` 네 장은 그대로다(`diff ui0 ui0-wsset` 0.00% — '초대' 구역은 뷰포트 밖).
- **`p-announcements` 의 이 기록(`ui0`)은 '읽음' 상태(NEW 칩 없음)다.** 공지 화면 방문이 `announcement_seen` 워터마크를 쓰고 이 기록의 두 실행은 같은 DB 의 세 번째·네 번째 실행이었다(첫 두 실행은 가림을 고치기 전의 1차). 과제 5b 부터 `shoot` 은 테마 패스마다 캡처 계정의 워터마크를 지워 '아무 공지도 보지 않음'(= `db:reset` 뒤 첫 실행)에서 시작하므로, 이제 실행마다 첫 크기(1440×900) 장에 NEW 칩 셋이 있고 나머지 크기는 없다 — 이 기록의 1440 장과 0.13%(문턱 아래, `diff ui0 ui0-ann-a`). 사이드바의 공지 배지 3 은 방문 뒤에도 남는다 — 워터마크가 밀리초로 잘리고(`.483`) `created_at` 은 마이크로초(`.483017`)라 SQL `created_at > last_seen_at` 이 가장 최근 공지를 계속 안 읽음으로 센다(제품 결함 후보, src 무수정).
- `p-dashboard` 의 속도 지표(SPI 0.84 — 게이지 숫자·호는 1440×900 에서만 뷰포트 안, 1280×720 은 카드 머리만)는 진척 스냅샷에서 나온다 — 대시보드·포트폴리오가 응답 뒤(`after`) 오늘 스냅샷을 쓰므로 `db:reset` 뒤 **첫** 대시보드 방문만 '—' 다. 전 경로 실행은 `portfolio` 가 `p-dashboard` 앞이라 늘 0.84 이고(이 기록·과제 5 1차·`ui0-pf` 바이트 동일), `portfolio` 없는 부분 실행은 테마 패스마다 첫 크기가 '—' 다(과제 5b 가 스냅샷을 패스 시작에서 지운다 — 머리 표 결정성 행).
- `minute`·`share` 의 mermaid 흐름도는 넓은 틀의 왼쪽 위에 작게 그려진다(현행 그대로). `admin-teams` 의 팀 목록은 빈 상태다 — 공용 팀(`project_id is null`)만 보이는데 시드 팀 다섯은 프로젝트 팀이다.
- 전역 브리지 화면(`meetings`·`minutes`·`minute`·`agents` 등)의 사이드바에는 `UI-CAPTURE 메뉴` 가 보인다 — 실행 시작 때 `lastProjectId` 를 시드 프로젝트로 고정했기 때문이다(과제 5a, 과제 3 보고 §4-2).

| 라우트 | 크기 | 파일 | sha256(앞 12) | 글꼴 | 최종 경로 | 문제 | 가시 h1 |
|---|---|---|---|---|---|---|---|
| root | 1440×900 | root-1440x900-light.png | 555f5cb83a7a | ok | /projects | — | 1 |
| root | 1280×720 | root-1280x720-light.png | 32f703637664 | ok | /projects | — | 1 |
| root | 768×1024 | root-768x1024-light.png | 2a172eb85fe4 | ok | /projects | — | 1 |
| root | 390×844 | root-390x844-light.png | b91d8c7dfe2d | ok | /projects | — | 1 |
| login | 1440×900 | login-1440x900-light.png | 51f78431dc11 | ok | /login | — | 1 |
| login | 1280×720 | login-1280x720-light.png | 65add31653bb | ok | /login | — | 1 |
| login | 768×1024 | login-768x1024-light.png | 5dda6c264b8e | ok | /login | — | 1 |
| login | 390×844 | login-390x844-light.png | 85a55b8bb6a7 | ok | /login | — | 1 |
| invite | 1440×900 | ui0-invite/invite-1440x900-light.png | b7786a31a361 | ok | /invite/[token] | — | 1 |
| invite | 1280×720 | ui0-invite/invite-1280x720-light.png | 202956a89254 | ok | /invite/[token] | — | 1 |
| invite | 768×1024 | ui0-invite/invite-768x1024-light.png | 6fa9940467a1 | ok | /invite/[token] | — | 1 |
| invite | 390×844 | ui0-invite/invite-390x844-light.png | 5d1f7fd27c0a | ok | /invite/[token] | — | 1 |
| share | 1440×900 | share-1440x900-light.png | d065fba36663 | ok | /share/minutes/[token] | — | 2 |
| share | 1280×720 | share-1280x720-light.png | 9b7d32eca974 | ok | /share/minutes/[token] | — | 2 |
| share | 768×1024 | share-768x1024-light.png | f6f2c9cdffe5 | ok | /share/minutes/[token] | — | 2 |
| share | 390×844 | share-390x844-light.png | d58efcc9e35e | ok | /share/minutes/[token] | — | 2 |
| projects | 1440×900 | projects-1440x900-light.png | 555f5cb83a7a | ok | /projects | — | 1 |
| projects | 1280×720 | projects-1280x720-light.png | 0c561373d9b8 | ok | /projects | — | 1 |
| projects | 768×1024 | projects-768x1024-light.png | 2a172eb85fe4 | ok | /projects | — | 1 |
| projects | 390×844 | projects-390x844-light.png | b91d8c7dfe2d | ok | /projects | — | 1 |
| meetings | 1440×900 | meetings-1440x900-light.png | 740a1ef5efed | ok | /meetings | — | 1 |
| meetings | 1280×720 | meetings-1280x720-light.png | 8a085ed6e556 | ok | /meetings | — | 0 |
| meetings | 768×1024 | meetings-768x1024-light.png | 94fdd9ac0af2 | ok | /meetings | — | 0 |
| meetings | 390×844 | meetings-390x844-light.png | d622f7f1b731 | ok | /meetings | — | 0 |
| minutes | 1440×900 | minutes-1440x900-light.png | bc3a18545931 | ok | /minutes | — | 1 |
| minutes | 1280×720 | minutes-1280x720-light.png | 38a1a3d515aa | ok | /minutes | — | 0 |
| minutes | 768×1024 | minutes-768x1024-light.png | 1590ddf65301 | ok | /minutes | — | 0 |
| minutes | 390×844 | minutes-390x844-light.png | 213165fe3280 | ok | /minutes | — | 0 |
| minute | 1440×900 | minute-1440x900-light.png | 84997732d911 | ok | /minutes/{minuteId} | — | 2 |
| minute | 1280×720 | minute-1280x720-light.png | d715d8452541 | ok | /minutes/{minuteId} | — | 2 |
| minute | 768×1024 | minute-768x1024-light.png | 3cde4469aa2d | ok | /minutes/{minuteId} | — | 2 |
| minute | 390×844 | minute-390x844-light.png | cabbfea0f967 | ok | /minutes/{minuteId} | — | 2 |
| agents | 1440×900 | agents-1440x900-light.png | d477ea7ecbb7 | ok | /agents | — | 1 |
| agents | 1280×720 | agents-1280x720-light.png | 683f670869b9 | ok | /agents | — | 0 |
| agents | 768×1024 | agents-768x1024-light.png | 39c12c5ae800 | ok | /agents | — | 0 |
| agents | 390×844 | agents-390x844-light.png | eedfec7bd665 | ok | /agents | — | 0 |
| portfolio | 1440×900 | portfolio-1440x900-light.png | 71b908dd2db7 | ok | /portfolio | — | 1 |
| portfolio | 1280×720 | portfolio-1280x720-light.png | deff2cfe1e75 | ok | /portfolio | — | 0 |
| portfolio | 768×1024 | portfolio-768x1024-light.png | 4aed5eb40f81 | ok | /portfolio | — | 0 |
| portfolio | 390×844 | portfolio-390x844-light.png | b9e1c4358c19 | ok | /portfolio | — | 0 |
| usage | 1440×900 | usage-1440x900-light.png | 2e9ea6cb04dc | ok | /usage | — | 1 |
| usage | 1280×720 | usage-1280x720-light.png | a30a9176a038 | ok | /usage | — | 0 |
| usage | 768×1024 | usage-768x1024-light.png | 16e781d6cf1e | ok | /usage | — | 0 |
| usage | 390×844 | usage-390x844-light.png | 2b00d2ab29de | ok | /usage | — | 0 |
| admin-accounts | 1440×900 | admin-accounts-1440x900-light.png | 26753d44f5b3 | ok | /admin/accounts | — | 1 |
| admin-accounts | 1280×720 | admin-accounts-1280x720-light.png | a10d6ee4b195 | ok | /admin/accounts | — | 0 |
| admin-accounts | 768×1024 | admin-accounts-768x1024-light.png | 755d7ffa62e9 | ok | /admin/accounts | — | 0 |
| admin-accounts | 390×844 | admin-accounts-390x844-light.png | 61b235053261 | ok | /admin/accounts | — | 0 |
| admin-teams | 1440×900 | admin-teams-1440x900-light.png | 4910f3babfef | ok | /admin/teams | — | 1 |
| admin-teams | 1280×720 | admin-teams-1280x720-light.png | f282d627d497 | ok | /admin/teams | — | 0 |
| admin-teams | 768×1024 | admin-teams-768x1024-light.png | 4544ee486658 | ok | /admin/teams | — | 0 |
| admin-teams | 390×844 | admin-teams-390x844-light.png | 55ac3f1868ac | ok | /admin/teams | — | 0 |
| llm-config | 1440×900 | llm-config-1440x900-light.png | c1dc171b899c | ok | /admin/llm-config | — | 1 |
| llm-config | 1280×720 | llm-config-1280x720-light.png | 3204f233a74a | ok | /admin/llm-config | — | 0 |
| llm-config | 768×1024 | llm-config-768x1024-light.png | 145b02bc5810 | ok | /admin/llm-config | — | 0 |
| llm-config | 390×844 | llm-config-390x844-light.png | e9677d452991 | ok | /admin/llm-config | — | 0 |
| account | 1440×900 | account-1440x900-light.png | 9d429cde32d4 | ok | /account | — | 1 |
| account | 1280×720 | account-1280x720-light.png | 8b1308a285cc | ok | /account | — | 0 |
| account | 768×1024 | account-768x1024-light.png | 1c454a4c00ef | ok | /account | — | 0 |
| account | 390×844 | account-390x844-light.png | 62650f2756df | ok | /account | — | 0 |
| p-dashboard | 1440×900 | p-dashboard-1440x900-light.png | 0ff561eafac0 | ok | /p/{pid}/dashboard | — | 1 |
| p-dashboard | 1280×720 | p-dashboard-1280x720-light.png | d86628e09f35 | ok | /p/{pid}/dashboard | — | 0 |
| p-dashboard | 768×1024 | p-dashboard-768x1024-light.png | 939361978392 | ok | /p/{pid}/dashboard | — | 0 |
| p-dashboard | 390×844 | p-dashboard-390x844-light.png | dbb02cfa5a7c | ok | /p/{pid}/dashboard | — | 0 |
| p-wbs | 1440×900 | p-wbs-1440x900-light.png | decc658986fd | ok | /p/{pid}/wbs | — | 1 |
| p-wbs | 1280×720 | p-wbs-1280x720-light.png | 9c53ab7730cd | ok | /p/{pid}/wbs | — | 0 |
| p-wbs | 768×1024 | p-wbs-768x1024-light.png | d06a3d84e677 | ok | /p/{pid}/wbs | — | 0 |
| p-wbs | 390×844 | p-wbs-390x844-light.png | df223ea4340b | ok | /p/{pid}/wbs | — | 0 |
| p-gantt | 1440×900 | p-gantt-1440x900-light.png | 2f8096ef5509 | ok | /p/{pid}/wbs?view=timeline | — | 1 |
| p-gantt | 1280×720 | p-gantt-1280x720-light.png | a0cea87e3cc4 | ok | /p/{pid}/wbs?view=timeline | — | 0 |
| p-gantt | 768×1024 | p-gantt-768x1024-light.png | fe6ee0ab9e3c | ok | /p/{pid}/wbs?view=timeline | — | 0 |
| p-gantt | 390×844 | p-gantt-390x844-light.png | a6de8e8f7a14 | ok | /p/{pid}/wbs?view=timeline | — | 0 |
| p-kanban | 1440×900 | p-kanban-1440x900-light.png | b7f8b6d96a0f | ok | /p/{pid}/kanban | — | 1 |
| p-kanban | 1280×720 | p-kanban-1280x720-light.png | a8c0ab92d50a | ok | /p/{pid}/kanban | — | 0 |
| p-kanban | 768×1024 | p-kanban-768x1024-light.png | 6c1672998f84 | ok | /p/{pid}/kanban | — | 0 |
| p-kanban | 390×844 | p-kanban-390x844-light.png | 79a737c56343 | ok | /p/{pid}/kanban | — | 0 |
| p-import | 1440×900 | p-import-1440x900-light.png | 47196afd0765 | ok | /p/{pid}/import | — | 1 |
| p-import | 1280×720 | p-import-1280x720-light.png | cf5caedf7ff6 | ok | /p/{pid}/import | — | 0 |
| p-import | 768×1024 | p-import-768x1024-light.png | ce09855d9c61 | ok | /p/{pid}/import | — | 0 |
| p-import | 390×844 | p-import-390x844-light.png | 7352df4bca0b | ok | /p/{pid}/import | — | 0 |
| p-import-admin | 1440×900 | p-import-admin-1440x900-light.png | 0b7ca1360626 | ok | /p/{pid}/import | — | 1 |
| p-import-admin | 1280×720 | p-import-admin-1280x720-light.png | 7f89bd2e0b78 | ok | /p/{pid}/import | — | 0 |
| p-import-admin | 768×1024 | p-import-admin-768x1024-light.png | 655a02565582 | ok | /p/{pid}/import | — | 0 |
| p-import-admin | 390×844 | p-import-admin-390x844-light.png | f3e8e279b0ec | ok | /p/{pid}/import | — | 0 |
| p-issues | 1440×900 | p-issues-1440x900-light.png | abc8467570ba | ok | /p/{pid}/issues | — | 1 |
| p-issues | 1280×720 | p-issues-1280x720-light.png | 4bf0186d52f3 | ok | /p/{pid}/issues | — | 0 |
| p-issues | 768×1024 | p-issues-768x1024-light.png | 8b0ce5043b4a | ok | /p/{pid}/issues | — | 0 |
| p-issues | 390×844 | p-issues-390x844-light.png | 80c7e6581f73 | ok | /p/{pid}/issues | — | 0 |
| p-weekly | 1440×900 | p-weekly-1440x900-light.png | 1cc4401b377f | ok | /p/{pid}/weekly | — | 1 |
| p-weekly | 1280×720 | p-weekly-1280x720-light.png | 786fcc3dc18e | ok | /p/{pid}/weekly | — | 0 |
| p-weekly | 768×1024 | p-weekly-768x1024-light.png | d7215ada2a70 | ok | /p/{pid}/weekly | — | 0 |
| p-weekly | 390×844 | p-weekly-390x844-light.png | b11e19c5fa2a | ok | /p/{pid}/weekly | — | 0 |
| p-meetings | 1440×900 | p-meetings-1440x900-light.png | e45d3a771ae3 | ok | /p/{pid}/meetings | — | 1 |
| p-meetings | 1280×720 | p-meetings-1280x720-light.png | 67d7dbd2c8a2 | ok | /p/{pid}/meetings | — | 0 |
| p-meetings | 768×1024 | p-meetings-768x1024-light.png | 103d2285cd57 | ok | /p/{pid}/meetings | — | 0 |
| p-meetings | 390×844 | p-meetings-390x844-light.png | 689596694717 | ok | /p/{pid}/meetings | — | 0 |
| p-wiki | 1440×900 | p-wiki-1440x900-light.png | 4fccefd8526b | ok | /p/{pid}/wiki | — | 1 |
| p-wiki | 1280×720 | p-wiki-1280x720-light.png | 3f3d034aeb3e | ok | /p/{pid}/wiki | — | 0 |
| p-wiki | 768×1024 | p-wiki-768x1024-light.png | 7f901e602f66 | ok | /p/{pid}/wiki | — | 0 |
| p-wiki | 390×844 | p-wiki-390x844-light.png | ef7056c6a1ef | ok | /p/{pid}/wiki | — | 0 |
| p-wiki-topic | 1440×900 | p-wiki-topic-1440x900-light.png | 9e48fc79ad09 | ok | /p/{pid}/wiki/topics/{topicId} | — | 1 |
| p-wiki-topic | 1280×720 | p-wiki-topic-1280x720-light.png | be1e0f895961 | ok | /p/{pid}/wiki/topics/{topicId} | — | 0 |
| p-wiki-topic | 768×1024 | p-wiki-topic-768x1024-light.png | 85cb7e87ee1f | ok | /p/{pid}/wiki/topics/{topicId} | — | 0 |
| p-wiki-topic | 390×844 | p-wiki-topic-390x844-light.png | 63b0d34534b8 | ok | /p/{pid}/wiki/topics/{topicId} | — | 0 |
| p-announcements | 1440×900 | p-announcements-1440x900-light.png | 72141c4e8804 | ok | /p/{pid}/announcements | — | 1 |
| p-announcements | 1280×720 | p-announcements-1280x720-light.png | 7703a22ef9c1 | ok | /p/{pid}/announcements | — | 0 |
| p-announcements | 768×1024 | p-announcements-768x1024-light.png | 653fac7438e6 | ok | /p/{pid}/announcements | — | 0 |
| p-announcements | 390×844 | p-announcements-390x844-light.png | 6a08d3d12678 | ok | /p/{pid}/announcements | — | 0 |
| p-members | 1440×900 | p-members-1440x900-light.png | 252ae7e6862e | ok | /p/{pid}/members | — | 1 |
| p-members | 1280×720 | p-members-1280x720-light.png | 83366583da25 | ok | /p/{pid}/members | — | 0 |
| p-members | 768×1024 | p-members-768x1024-light.png | 33874f9d341d | ok | /p/{pid}/members | — | 0 |
| p-members | 390×844 | p-members-390x844-light.png | ca62823060e3 | ok | /p/{pid}/members | — | 0 |
| p-attendance | 1440×900 | p-attendance-1440x900-light.png | 0f3e6878eadb | ok | /p/{pid}/attendance | — | 1 |
| p-attendance | 1280×720 | p-attendance-1280x720-light.png | 90cafd92334b | ok | /p/{pid}/attendance | — | 0 |
| p-attendance | 768×1024 | p-attendance-768x1024-light.png | 87b82684aced | ok | /p/{pid}/attendance | — | 0 |
| p-attendance | 390×844 | p-attendance-390x844-light.png | c1de3beaf6ff | ok | /p/{pid}/attendance | — | 0 |
| p-agents | 1440×900 | p-agents-1440x900-light.png | ca3361106db0 | ok | /p/{pid}/agents | — | 1 |
| p-agents | 1280×720 | p-agents-1280x720-light.png | f2128e5d6492 | ok | /p/{pid}/agents | — | 0 |
| p-agents | 768×1024 | p-agents-768x1024-light.png | 3eb5d6eacbd9 | ok | /p/{pid}/agents | — | 0 |
| p-agents | 390×844 | p-agents-390x844-light.png | 38ff4b029ec3 | ok | /p/{pid}/agents | — | 0 |
| p-office | 1440×900 | p-office-1440x900-light.png | 32ff0c866733 | ok | /p/{pid}/agents/office | — | 1 |
| p-office | 1280×720 | p-office-1280x720-light.png | 7063f90203d3 | ok | /p/{pid}/agents/office | — | 0 |
| p-office | 768×1024 | p-office-768x1024-light.png | ced7196901ab | ok | /p/{pid}/agents/office | — | 0 |
| p-office | 390×844 | p-office-390x844-light.png | e008fe07b042 | ok | /p/{pid}/agents/office | — | 0 |
| p-office-lane | 1440×900 | p-office-lane-1440x900-light.png | 102a8003b369 | ok | /p/{pid}/agents/office | — | 1 |
| p-office-lane | 1280×720 | p-office-lane-1280x720-light.png | dc3539ada9fe | ok | /p/{pid}/agents/office | — | 0 |
| p-office-lane | 768×1024 | p-office-lane-768x1024-light.png | a3681cf7b580 | ok | /p/{pid}/agents/office | — | 0 |
| p-office-lane | 390×844 | p-office-lane-390x844-light.png | ee47665258c0 | ok | /p/{pid}/agents/office | — | 0 |
| p-settings | 1440×900 | p-settings-1440x900-light.png | f9f02d801d01 | ok | /p/{pid}/settings | — | 1 |
| p-settings | 1280×720 | p-settings-1280x720-light.png | 6cf268defc0c | ok | /p/{pid}/settings | — | 0 |
| p-settings | 768×1024 | p-settings-768x1024-light.png | b0f1082c6de3 | ok | /p/{pid}/settings | — | 0 |
| p-settings | 390×844 | p-settings-390x844-light.png | b9c5e1e75e23 | ok | /p/{pid}/settings | — | 0 |
| ws-settings | 1440×900 | ws-settings-1440x900-light.png | f3c555f620e0 | ok | /w/default/settings | — | 1 |
| ws-settings | 1280×720 | ws-settings-1280x720-light.png | 23792e0f160f | ok | /w/default/settings | — | 1 |
| ws-settings | 768×1024 | ws-settings-768x1024-light.png | 1fe93008d121 | ok | /w/default/settings | — | 1 |
| ws-settings | 390×844 | ws-settings-390x844-light.png | 63a4aebe1ce3 | ok | /w/default/settings | — | 1 |

## 3. 핵심 동작

라우트마다 무엇을 보고 무엇을 하는가 — UI-1~UI-3 눈확인과 SP9 J1~J3 의 회귀 목록이다. 조작은 캡처 등급 기준(관리자 전용 조작은 그렇게 적었다).

| 키 | 보는 것 · 하는 것 |
|---|---|
| `root` | 로그인한 사용자를 `/projects` 로 보낸다(최종 경로 단언 `expectFinal`). UI-2a 리졸버가 대체한다 |
| `login` | 이메일·비밀번호 로그인(비밀번호 보기 토글·제출). 1024 이상은 왼쪽 어두운 히어로(제품 문구·부유 장식·통계 칩) + 오른쪽 폼, 좁은 화면은 머리 + 폼 |
| `invite` | 초대 링크 미리보기(초대 대상·권한) → 로그인 또는 가입 뒤 합류. 이 기준선(`ui0-invite`, 과제 5b)은 계정 없는 초대 대상의 가입 폼 카드('가입하고 합류하기' — §2 메모). 처음 기록(`ui0`)은 '사용할 수 없는 초대' 카드 + '로그인 화면으로'였다 |
| `share` | 읽기 전용 공유 회의록 — 목차(접기)·본문(mermaid·표·코드 블록)·글자 크기 A−/A+ |
| `projects` | 워크스페이스 히어로(TASKS·DONE·% 칩, '전체 프로젝트')와 프로젝트 라이브러리 카드(이니셜·상태 칩·설명·기간·'열기'). 관리자는 새 프로젝트(모달) |
| `meetings` | 내 회의 — 월 달력/리스트, '내 것만·전체 프로젝트', 이전·다음 달·오늘, 공휴일 표시, 회의 칩 → 상세 모달 |
| `minutes` | 회의록 탐색 — 즐겨찾기·폴더 트리(프로젝트·미분류), 기간 이동·제목·본문 검색, 트리/달력·그리드/리스트, 전체 내려받기, 회의록 챗봇, 등록(업로드 모달). 폴더 관리·프로젝트 지정·폴더 이동 |
| `minute` | 회의록 문서 — 목록 복귀, 팀·폴더 칩, 핵심 요약(펼치기), 목차·본문(mermaid·표·코드), AI 대화 패널(이 문서·전체 회의록), 내용 .md 내려받기, 글자 크기, 집중 모드. 작성자·관리자는 메타 편집·공유·본문 교체·하이라이트·이슈 만들기 |
| `agents` | 전체 에이전트 스튜디오 — 히어로 타일(업무 중·결정 대기·무응답·끊김·빈자리), '확인 필요' 띠, 보기 전환(에이전트·평면도·상태 레인), 잡담 켬/끔, 내 작업/전체, 책상 선택 → 프로필(지금 하는 일·결정 필요·마지막 신호) |
| `portfolio` | 전사 포트폴리오(플랫폼 관리자) — 요약 칸(프로젝트·신호 분포·지연 종료·집계 실패), 프로젝트 비교 표(신호·진척·편차·SPI·예상 종료·지연·PM·상태 → 행 이동), 마일스톤 통합 타임라인 |
| `usage` | 사용 현황(플랫폼 관리자) — 7/30/90일, 요약 칸(오늘·30일 활성·세션·화면 열람), 일별 활성 사용자·많이 쓰는 프로그램, 사용자 현황 표 |
| `admin-accounts` | 계정 관리(플랫폼 관리자) — 로그인 계정 표(워크스페이스 역할·이 프로젝트 권한·플랫폼 관리자 지정·생성일), 일괄 추가·계정 추가, 비번 리셋 |
| `admin-teams` | 팀 관리 — 새 팀 이름 + 팀 추가, 팀 목록(순서·상태·팀별 진척현황·작업) |
| `llm-config` | LLM 설정(플랫폼 관리자) — 서버 적용 중 생성·임베딩 모델, 활성 LLM(환경변수 기본값·프로필 선택·선택 안 함), 프로필 관리, 저장 |
| `account` | 내 계정 — 프로필(이름·이메일)·비밀번호 변경, 개인 액세스 토큰 목록과 새 토큰 발급(이름·프로젝트·스코프·만료) |
| `p-dashboard` | 프로젝트 운영 현황 — 공지 띠, 요약(진척 게이지·일정 D+N·리스크·다음 마일스톤), 주간보고서 요약(PPT), 마일스톤 타임라인, S-커브 진척현황·속도 지표 |
| `p-wbs` | 작업 계획 — 계층 표 + 간트(주·일 눈금·오늘 표식·주말·공휴일·계획/실적·크리티컬 패스·의존선), 단계 펼침(1·2·3·4), 도구 줄(검색·코드 표시·간트 확대·완료 숨김·마일스톤·진척 렌즈·글자 크기·전체 화면·주간보고). 진척 % 셀 편집(멤버)·가중치·행 추가(관리자), 행 상세 패널(필드·산출물·의존·담당·단계) |
| `p-gantt` | `/p/{pid}/wbs?view=timeline` 으로 리디렉션 — 같은 작업 계획 화면 |
| `p-kanban` | 칸반 보드 — 진행/Phase별/담당자별, 내 팀/전체, 필터 칩(지연·이번 주 마감·진행중·미착수)·검색, 카드 끌기·+/−·착수·완료·재개로 진척 변경, 첫 방문 안내 띠('알겠어요') |
| `p-import` | 멤버: '임포트 권한이 없습니다' 제한 문구 |
| `p-import-admin` | 워크스페이스 관리자: 임포트 마법사 — WBS 마크다운(wbs.md)·엑셀(.xlsx) 탭 → 파일 선택 → 미리보기 → 적용 |
| `p-issues` | 이슈 목록 — 상태·심각도 필터, Mega 카테고리, 내 담당, 페이지 크기. 이슈 등록·편집 모달(진행률·진행 업데이트), 이슈 분석서 작성 |
| `p-weekly` | 주간업무 — 주차 이동, 금주 실적·차주 계획 시트 셀 편집(Enter 저장·Alt+Enter 줄바꿈), AI로 다시 작성·주간보고 점검·요약/상세 PPT 내려받기. 관리자는 새 보고 만들기 |
| `p-meetings` | 프로젝트 회의 — 월 달력/리스트, 이전·다음 달·오늘, 공휴일, 새 회의(모달), 회의 칩 → 상세(회차 취소·삭제·공지 만들기) |
| `p-wiki` | 프로젝트 Wiki — 질문 검색(질문하기·추천 칩)과 결과 자리·안내 패널 |
| `p-wiki-topic` | 위키 주제 — 상태 배지(참조 자료·검증되지 않음)·연결 근거·열림·상충 수, 현재 기준 문서(없으면 '이 주제로 문서 쓰기'), 신뢰 정보·피드백(도움됨·오래된 내용), 회의에서 나온 근거, 열린 질문·리스크 |
| `p-announcements` | 공지 목록(전체·일반·중요·행사), 카드(중요·고정·NEW 칩) → 읽기. 관리자는 작성·수정·삭제. 방문하면 읽음 처리 |
| `p-members` | 팀 구성 — 참여자 명단(이름·이메일·팀·역할 라벨·직함·권한·상태). 관리자는 추가·수정·제거 |
| `p-attendance` | 근태현황 — 월 달력/리스트, 이름순·담당 카테고리별, 멤버 필터, 범례(정상근무·연차·반차·반반차·병가·출장), 근태 등록·삭제 |
| `p-agents` | 위임·승인 — 히어로 타일(위임·대기·작업 중·승인 대기·막힘), 에이전트 상태 띠·갱신·새로고침, 위임 표(내 담당/전체/승인 대기만, 조밀·열 고정·열 너비 초기화, 위임 체크·담당자·단계·사유·에이전트 신호·조정), 행 상세 패널 |
| `p-office` | 프로젝트 에이전트 스튜디오(기본 = 에이전트 보기) — `agents` 와 같은 구성을 이 프로젝트 층으로, '전체 스튜디오' 링크 |
| `p-office-lane` | 같은 화면의 상태 레인 보기 — 결재 대기·손봐야 함·업무 중·빈자리·완료 레인, 막힘 카드(결정 대기·중단), 범례·설명 |
| `p-settings` | 프로젝트 설정(관리자) — 설정 검색·범주(일반·모듈·메뉴·팀·업무영역·상태·승인·달력·기록), 기본 정보 편집, 마일스톤 키워드(변경 내용 검토 → 저장), WBS 단계 |
| `ws-settings` | 워크스페이스 설정(관리자) — 설정 검색·범주(일반·모듈·AI·초대·메뉴·기록), 제품 이름·메일 발신 이름(변경 N개 저장 바), 로고 세 칸 업로드·로고 설정 저장 |

## 4. 규모별 그리드 성능(`perf-grid.mjs`)

**한 줄 결론: 가상화가 없는 현재 그리드는 약 3천 행에서 무너지고 5천 행부터 응답하지 않는다 — 비교(Q07)는 SPU2.**

`/p/{pid}/wbs` 를 규모별 합성 프로젝트(깊이 4 · 팀 5 · 담당 20 · 날짜·진척 분포 고정 시드, 행 전부 `is_owner_split=false`)로 잰다. 중앙값은 **응답한 run 만**이다. '응답' = 3초 안에 돌아오는 `page.evaluate` 에서 `readyState === 'complete'` ∧ `[data-row-id]` ≥ 1(과제 4 후속 — 원장 Ruling [T4 무응답 = 기준선 결과]). 무응답은 결함이 아니라 이 기준선의 수치다. DOM 행 = 시드 행 대조(D51)는 응답한 run 에서만 한다.

- 1,011행: 두 묶음 10/10 응답. 3,033행: 1차 1/5 · 재측정 4/5(과제 4 는 2/3) — 응답과 무응답의 경계이고, 응답해도 스크롤 프레임이 평균 1.6~4초다. 5,055행: 여섯 run 가운데 측정을 끝낸 run 이 없다(재측정 셋째 run 은 한순간 '응답'으로 잡힌 뒤 15분 넘게 멈췄다). 10,110행: 두 묶음 모두 무응답.

**측정 환경 경고.** 이 기계에서는 측정 내내 다른 프로젝트의 Docker 컨테이너 `pms-app`(이미지 `prj-manager-app`)이 재시작을 되풀이했다(RestartCount 628 → 724, `unless-stopped`) — 시작할 때마다 CPU 2~3코어를 쓰고 load1 이 8~25 로 오른다. 1차 묶음의 3,033행은 다른 세션의 vitest 와도 겹쳤다. 그래서 두 묶음을 모두 싣고 묶음마다 그 시간의 기계 상태를 적었다. 행 수 경계는 두 묶음과 과제 4 실측이 같고, ms 값은 부하에 따라 두 배쯤 흔들린다(1,011행 TTFB 270 → 969ms).

| 규모 | 묶음 · 시각(KST) | run 상태 | ① 이동 → 첫 행(ms) | ② 첫 행까지 긴 작업 합(ms) | ③ 스크롤 프레임 평균(ms) / 50ms 초과 | ④ HTML 끝 / TTFB(ms) | DOM 행 = 시드 행 | 무응답 run 의 `domRowsAt` | 그 시간의 기계 |
|---|---|---|---|---|---|---|---|---|---|
| 1,011행(`PERF-GRID-p1`) | 1차 12:51:39~12:53:18 | 5/5 응답(제한 120초) | 520 | 0 | 109.1 / 10 | 414 / 270 | 1,011 = 1,011 | — | next·vitest 없음(Docker 부하 표본 없음) |
| 1,011행(`PERF-GRID-p1`) | 재측정 13:12:18~13:15:21 | 5/5 응답(제한 120초) | 1,167 | 54 | 225.4 / 27 | 1,106 / 969 | 1,011 = 1,011 | — | next·vitest 없음. 끝난 직후(13:15) `pms-app` 117%·Docker VM 290%·load1 6.1 — 부하 표본기는 그 뒤에 띄웠다 |
| 3,033행(`PERF-GRID-p3`) | 1차 12:53:18~13:07:28 | 1/5 응답 · 4 무응답(제한 120초) | 959 | 0 | 3,146.6 / 97 | 849 / 758 | 3,033 = 3,033 | #2 5s=null 15s=null 30s=null 60s=null ; #3 5s=0 15s=null 30s=null 60s=null ; #4 5s=0 15s=3539 30s=null 60s=4473 ; #5 5s=null 15s=null 30s=null 60s=null | **12:59:49~약 13:04 다른 세션 vitest(워커 7) 겹침** |
| 3,033행(`PERF-GRID-p3`) | 재측정 13:16:51~13:37:24 | 4/5 응답 · 1 무응답(제한 120초) | 1,804 | 145 | 1,888.4 / 98 | 2,107 / 1,013 | 3,033 = 3,033 | #3 5s=null 15s=null 30s=null 60s=null | next·vitest 없음, load1 3.2~25.4, `pms-app` 최대 353%(20초 표본 52 중 47 바쁨) |
| 5,055행(`PERF-GRID-p5`) | 1차 13:07:28~13:10:36 | 0/3 응답 · 3 무응답(제한 60초) | — | — | — | — | — | #1 5s=null 15s=null 30s=null 60s=null ; #2 5s=null 15s=null 30s=null ; #3 5s=null 15s=null 30s=null | next·vitest 없음(5초 표본 0) |
| 5,055행 | 재측정 13:37:24~13:55:18 | 결과 없음 — 첫 두 run 무응답, 셋째 run 이 응답 판정 뒤 15분 넘게 멈춰 측정을 끝냈다(exit 1) | — | — | — | — | — | — | next·vitest 없음, load1 8.3~13.9, `pms-app` 최대 339%(20초 표본 45) |
| 10,110행(`PERF-GRID`) | 1차 13:10:36~13:11:50 | 0/1 응답 · 1 무응답(제한 60초) | — | — | — | — | — | #1 5s=null 15s=10110 30s=null 60s=null | next·vitest 없음(5초 표본 0) |
| 10,110행(`PERF-GRID`) | 재측정 13:55:19~13:56:26 | 0/1 응답 · 1 무응답(제한 60초) | — | — | — | — | — | #1 5s=0 15s=null 30s=null 60s=null | next·vitest 없음, load1 9.4~12.6, `pms-app` 최대 323%(20초 표본 3 중 3 바쁨) |

- 지표: ① `goto` 시작 → 첫 `[data-row-id]`(MutationObserver) ② 첫 행 전 longtask 합 ③ `[data-wbs-scroll-region]` 을 프레임마다 400px 씩 40,000px(또는 끝)까지 스크롤한 프레임 간격의 평균·50ms 초과 수 ④ navigation `responseEnd − requestStart`(HTML 끝) / `responseStart − requestStart`(TTFB) — 판정 Q9. 1440×900 라이트, run 마다 새 컨텍스트. 응답한 run 의 DOM 행은 시드 행과 모두 같았다(D51). 무응답 run 의 `domRowsAt` 는 5·15·30·60초 이후 첫 표본의 `[data-row-id]` 수이고 `null` 은 그 시점의 `page.evaluate` 가 3초 안에 돌아오지 않았다(메인 스레드 점유)는 뜻이다 — 로딩 중 값이 시드 행보다 큰 것(3,539·4,473)은 같은 속성을 쓰는 요소가 표와 간트 양쪽에 있어서로 보인다.
- run 수: 1,011·3,033 행은 5회(제한 120초), 5,055 행 3회·10,110 행 1회(제한 60초) — 응답하지 않는 규모는 기계 시간 때문에 줄였다(스펙 §3.2 의 "5회"와 다른 편차, 보충 지시 Step 3 확정).
- exit(재측정): 1,011행 0 · 3,033행 2 · 5,055행 1(멈춘 run 을 끝냄 — 결과 파일 없음) · 10,110행 2 — 0 = 전 run 응답, 2 = 측정됨·무응답 run 있음(결과), 1 = 오류. 5,055행의 1 은 '응답' 판정 뒤 단계(행 수 안정 대기·스크롤 `page.evaluate`)에 시간 제한이 없어 멈춘 run 을 15분 뒤 끝낸 것이다(`✗ page.evaluate: Target page, context or browser has been closed`) — 도구 보강 후보.
- 그 뒤 상한을 더했다(`341e2a3`, 과제 5b) — 응답 뒤 두 단계도 각각 `timeoutMs` 와 겨루고 넘으면 오류가 아니라 `unresponsive` + `stalledAt`(`load`·`settle`·`scroll`)으로 남는다. 위 수치는 상한 전 도구로 잰 것이고 다시 재지 않았다 — 같은 조건이면 3,033행의 응답 run(스크롤 100프레임 × 1.6~4초)은 이제 `stalledAt: 'scroll'` 무응답으로 기록되므로 비교(Q07, SPU2)는 같은 도구 판으로 다시 잰다.
- 기준 장치: Apple M3 · 메모리 8 GB · macOS 26.6.2 · Node v22.18.0 · Chromium 145.0.7632.6 · 스크립트 커밋 `56fa0af`(앱 = main `81deae9`) · `max_rows` 20000 · 페르소나 비플랫폼 워크스페이스 관리자 `ui-wsadmin`(판정 Q9 — `measure` 가 `user_wbs_state` 0행·`wbsHideDone` 없음을 확인) · 시드 `perf-grid.mjs seed --phases 1|3|5|10`(이름 `PERF-GRID-p1|p3|p5`·`PERF-GRID`) · 서버 3201 `next start` · 공유 잠금 안에서 한 번에 하나.
- 조용한 기계 확인: 묶음마다 서버 기동 전 `pgrep -fl 'next (dev|build|start)|vitest'` 가 비었다(`qa/sp3b/quiet-ui0-try1.txt`·`quiet-ui0.txt` — 재측정은 규모마다 vitest·next dev|build 가 0 이 될 때까지 기다렸다가 쟀다. `quiet-ui0.txt` 의 post-p1 `heavy_n=1` 은 측정 쪽 표본기 자신이 패턴에 걸린 것이다). 5초 간격 표본 `quiet-sampler-t5*.log`, 재측정의 20초 간격 부하 표본(load1·컨테이너 CPU) `load-sampler-t5.log`. 산출 JSON: 재측정 `perf-grid-ui0-p1.json`·`perf-grid-ui0-p3.json`·`perf-grid-ui0.json`, 1차 `perf-grid-ui0-p1-try1.json`·`perf-grid-ui0-p3-noisy.json`·`perf-grid-ui0-p5-try1.json`·`perf-grid-ui0-try1.json`(모두 `qa/sp3b/`).
- 과제 4(`a41b6b9`, 오전)의 실측도 같은 꼴이다 — 1,011행 3/3 응답(첫 행 410·TTFB 316·프레임 96ms), 3,033행 2/3 응답, 5,055행 0/3, 10,110행 0/1(앞선 진단에서 20분 뒤에도 `readyState` 가 `complete` 가 아니었다).
- 비교(Q07)는 SPU2 가 같은 도구·같은 규모로, **같은 기계 조건(다른 컨테이너 부하 없음 — `docker stats`·load1 를 함께 적는다)**에서 다시 잰다. 스펙 §3.2 의 단일 수치(1만 행 5회 중앙값, `domRows 10110`)는 이 상태에서 낼 수 없어 규모 곡선으로 바꿨다(원장 Ruling [T4 무응답 = 기준선 결과]).

## 5. API 소비처(main `81deae9` 기준)

### 5.1 설정 쓰기(`updateProjectSettings`·`updateWorkspaceSettings`·`getSettingsCommandOutcome`)

| 화면 | 컴포넌트 | 액션 | 가드 |
|---|---|---|---|
| `p-settings` | `LevelSettingsManager`·`ModuleToggleEditor`·`MilestoneKeywordsEditor`·`StageCreditSlider` | `updateProjectSettings` · `getSettingsCommandOutcome` | `requireProjectAdmin(projectId)`(결과 재조회는 범위가 프로젝트면 `requireProjectAdmin`, 워크스페이스면 `requireWorkspaceAdmin`) |
| `p-settings` | `ClearExcelProfileButton` | `updateProjectSettings` | `requireProjectAdmin(projectId)` |
| `ws-settings` | `WorkspaceFieldsEditor`·`AccentEditor`·`ModuleAllowEditor`·`MenuOrderEditor`·`LogoEditor` | `updateWorkspaceSettings` · `getSettingsCommandOutcome` | `requireWorkspaceAdmin(workspaceId)` |
| `ws-settings` | `LogoEditor` | `branding#uploadBrandLogo`(파일 업로드만 — revision 은 `updateWorkspaceSettings`) | `requireWorkspaceAdmin(workspaceId)` |

설정 RPC 는 등급을 보지 않는다 — 위 액션 가드가 유일한 관문이다(CLAUDE.md '권한').

### 5.2 권한 판정

액션 파일(`src/app/actions/**`)의 가드 호출 수: `requireProjectAdmin` 49 · `requireProjectMember` 31 · `requireWorkspaceAdmin` 15 · `requireSuperuser` 9(가드마다 `grep -rho 'requireProjectAdmin(' src/app/actions | wc -l` 식으로 센 호출 수).

| 술어 파일(`src/lib/authz/*Access.ts`) | export | 쓰는 곳 |
|---|---|---|
| `agentsAccess.ts` | `canViewAgents`·`seatmapProjectIds` | `agents` 페이지, `actions/agentSeatmap.ts` |
| `llmConfigAccess.ts` | `canManageLlmConfig` | `llm-config` 페이지, `HeaderChrome`(메뉴 노출) |
| `portfolioAccess.ts` | `canViewPortfolio` | `portfolio` 페이지, `(app)/layout.tsx`, `lib/data/portfolio.ts` |
| `teamsAccess.ts` | `canManageTeams` | `admin-teams` 페이지, `HeaderChrome` |
| `usageAccess.ts` | `canViewUsage` | `usage` 페이지, `(app)/layout.tsx`, `lib/data/usage.ts` |

화면별 페이지 관문은 §1 의 '현재 게이트' 열(모듈 관문 `requireModulePage` 는 권한 가드가 아니다 — CLAUDE.md).

### 5.3 인라인 편집 저장

SPU1 의 표면별 채택 순서(개정 §5.8.7)의 입력. 액션 파일 wbs·wbsAssign·weekly·issues·issueUpdates·minutes·attendance·announcements·meetings·roster 의 **쓰기** export 를 부르는 화면만 적었다(조회 export 는 뺐다). 가드 열의 `+` 는 호출 순서, 괄호는 같은 파일의 도우미가 부르는 가드다.

| 화면 | 컴포넌트 | 액션(파일#export) | 가드 |
|---|---|---|---|
| `p-wbs` | `WbsGanttSheet` | `wbs#updateActual`(진척 % 셀) | `resolveProjectId` + `requireProjectMember` |
| `p-wbs` | `WbsGanttSheet` | `wbs#updateWeight` · `wbs#addWbsItem` | `resolveProjectId` + `requireProjectAdmin` · `requireProjectAdmin` |
| `p-wbs`·`p-agents` | `RowDetailPanel`(행 상세) | `wbs#updateWbsFields`·`addSubAct`·`deleteWbsItem`·`moveWbsItem`·`removeTaskDependency` · `wbs#addWbsItem`·`addTaskDependency` · `wbs#updateDeliverable` | `resolveProjectId` + `requireProjectAdmin` · `requireProjectAdmin` · `resolveProjectId` + `requireProjectMember` |
| `p-wbs`·`p-agents` | `WbsAssigneeStagePanel`(행 상세 안) | `wbsAssign#setWbsAssignee`·`setWbsAssigneeCascade` · `wbsAssign#setWbsStage`·`setWbsDevWorkflow` | `requireProjectAdmin` · `resolveItemProjectId` + `requireSubtreeManagerOrAdmin`(관리자 ∨ 하위 트리 담당자) |
| `p-agents`·`agents`·`p-office` | `DelegationTable`·`ApprovalQueue`·`SeatmapView` | `agentHub#runHubProcessOp`(10개 밖 파일 — 단계 op 는 안에서 `wbsAssign#setWbsStage` 를 부른다) | `requireProjectMember` + 단계는 `requireSubtreeManagerOrAdmin` |
| `p-kanban` | `KanbanBoard` | `wbs#updateActual` | `resolveProjectId` + `requireProjectMember` |
| 전 `(app)` 화면(AI 패널) | `AssistantChat` | `wbs#updateActual`·`updateWbsFields` | 위와 같음 |
| `p-weekly` | `WeeklySheetView` | `weekly#saveWeeklyCell`·`saveWeeklyCells`·`saveWeeklyTitle`·`prepareWeeklyCellRewrite` · `weekly#createWeeklyReport` | `requireProjectMember` + `requireModule` · `requireProjectAdmin` + `requireModule` |
| `p-issues` | `IssueModals` | `issues#createIssue` · `issues#updateIssueProgress` · `issues#updateIssue`·`deleteIssue` | `requireProjectMember` + `requireModule` · `resolveProjectId` + `requireProjectMember` + `requireModule` · `adminOrOwnerGate`(`resolveProjectId` + `requireModule` + 작성자 ∨ `requireProjectAdmin`) |
| `p-issues` | `IssueUpdates`(이슈 모달 안) | `issueUpdates#addIssueUpdate`·`archiveIssueUpdate`·`unarchiveIssueUpdate`·`purgeIssueUpdate` | `requireIssueMember`(`resolveProjectId` + `requireProjectMember`) |
| `minute` | `MinuteViewer` | `issues#createIssueFromMinuteBlock`·`prepareMinuteIssueDraft` · `minutes#replaceMinuteBody`·`deleteMinute` · `minutes#toggleMinuteHighlight` | `requireProjectMember` + `requireModule` · `requireActor` + `checkOwner`(`resolveScope` + `canEditMinute` + `requireModule`) · `requireActor` + `requireMinuteMember`(`resolveScope` + `isMinuteMember` + `requireModule`) |
| `minute`·`minutes` | `MinuteMetaModal` | `minutes#updateMinuteMeta`·`resetMinuteExternalId` | `requireActor` + `checkOwner` |
| `minute` | `MinuteShareModal` | `minutes#setMinuteShare` | `requireActor` + `checkOwner` |
| `minute` | `MinuteInsightCard` | `minutes#ensureMinuteInsightsAction` | `requireActor` + `requireMinuteMember` |
| `minutes` | `MinutesExplorer` | `minutes#moveMinuteToFolder`·`deleteMinute` · `minutes#assignMinutesProject`·`moveMinuteFolder` | `requireActor` + `checkOwner` · `requireSessionModule` |
| `minutes` | `FolderManageModal` | `minutes#createMinuteFolder`·`renameMinuteFolder`·`deleteMinuteFolder` | `requireSessionModule` |
| `minutes` | `MinuteUploadModal` | `minutes#createMinute` · `minutes#recordMinuteFile` | `requireActor` + (`resolveProjectId` →) `requireModule` 또는 `requireSessionModule` · `requireActor` + `checkOwner` |
| `minutes` | `MinutesView` | `minutes#toggleMinuteFavorite` | `resolveScope` + `requireModule` |
| `p-attendance` | `AttendanceView` | `attendance#upsertAttendance` · `attendance#removeAttendance` | `requireProjectMember` + `requireModule` · `resolveProjectId` + `requireProjectMember` + `requireModule` |
| `p-announcements` | `AnnouncementsView` | `announcements#createAnnouncement` · `announcements#updateAnnouncement`·`deleteAnnouncement` · `announcements#markAnnouncementsSeen` | `requireProjectAdmin` + `requireModule` · `resolveProjectId` + `requireProjectAdmin` + `requireModule` · 세션 + `requireModule` |
| `p-meetings` | `MeetingFormModal` | `meetings#createMeeting` · `meetings#updateMeeting` · `announcements#createAnnouncementFromMeeting` | `requireProjectMember` + `requireModule` · `adminOrOwnerGate` · `resolveProjectId` + `requireProjectAdmin` + `requireModule` |
| `p-meetings`·`meetings`·`p-dashboard` | `MeetingDetailModal` | `meetings#cancelOccurrence` · `meetings#deleteMeeting` · `announcements#createAnnouncementFromMeeting` | `occurrenceGate`(`adminOrOwnerGate` + 회차 작성자) · `adminOrOwnerGate` · 위와 같음 |
| `p-members` | `RosterManager`·`RosterRow` | `roster#upsertRosterMember` · `roster#removeRosterMember` | `requireProjectAdmin` · `resolveProjectId` + `requireProjectAdmin` |

## 6. 로컬 스모크(`SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod`)

UI-1 이 `FLOOR` 를 건드릴 때의 기준(`FLOOR` 는 UI-0 이 바꾸지 않는다). 래퍼 경유(`lane-b.env` 의 `SMOKE_URL`).

결과: **스모크 통과(exit 0)** — 2026-10-01 12:40 KST, 3201 `next start`(위 빌드). 산출 `qa/sp3b/smoke-ui0.txt`(1차 12:24 의 값과 같다).

| 검사 | 값 | `FLOOR`(하한) |
|---|---|---|
| 로그인 페이지 | HTTP 200 · 25,258 bytes · 이메일·비밀번호 입력란·제출 버튼 | — |
| 스타일시트 | 링크 1개(`/_next/static/css/20d0291a93c31fd4.css`), 중괄호 균형 depth 0. 전송 완결성 비교는 `content-encoding: gzip` 이라 생략 | — |
| CSS 크기 | 130,834 bytes | 90,000 |
| 규칙 수(`}` 수) | 1,931 | 1,300 |
| 커스텀 프로퍼티 | 493 | 380 |
| `@property` | 71 | 50 |
| `@keyframes` | 9 | 6 |
| `@layer` | properties · theme · base · components · utilities(다섯 모두) | 다섯 이름 |
| 레이아웃 급소 | base `.hidden` 1회 · 사이드바 `lg:flex` 2회 · 헤더 로고 `sm:flex` 2회 | — |
| 안전망 | 반응형 display 안전망 사본 1개 · CSS 꼬리 도달(안전망 마지막 규칙 존재) | — |

UI-1 은 판정 Q21 대로 로그인 부유 장식의 `@keyframes` 넷을 지워 9 → 5 가 되므로 `FLOOR.keyframes` 를 6 → 4 로 내린다(그 과제의 몫).

## 7. 델타(B 체크포인트 뒤)

해당 없음 — UI-0 기준선 자체를 `sp3a-done`(B·C·D 포함) 위에서 찍었다(2026-10-01 rebase, 원장).

## 8. 브라우저 미확인

Safari·Firefox·실기기 터치·IME·200% 확대·스크린리더 — 이번 기준선이 보지 않은 것(개정 §5.12.1). 다크 테마도 찍지 않았다(UI-0 은 라이트만 — 다크는 UI-1 이 테마 3값을 다시 노출한 뒤 `DARK4` 로 찍는다).
