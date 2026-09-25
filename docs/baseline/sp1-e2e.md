# SP1 Phase A 체크포인트 — E2E 실측 (2026-09-25 · 재실행 2026-09-26)

플랜 `docs/superpowers/plans/2026-09-24-sp1-org-core.md` Task 11 을 로컬에서 잰 기록이다. 첫 측정(run1~run6, 2026-09-25)의 트리는
`sp1/phase-a` 의 `1bdb553` 위에 이 태스크의 러너 변경(`scripts/e2e-local.mjs`·`scripts/lib/e2e.mjs`)을 얹은 것이다.
재실행 run7(2026-09-26)의 트리는 FK 결함을 고친 `d8259d2` 다(러너는 `fccf32c` 그대로).
최종 실행 run8(2026-09-26)의 트리는 리뷰가 확정한 러너 판정 결함을 고친 `be93fee` 다. 시각은 전부 KST.

**요약**

- E2E 최종 실행(run8, 2026-09-26, `be93fee`)은 **exit 0** 이다. 17단계가 전부 통과했다(3절).
- run8 은 화면 판정을 고친 러너로 돌았다(6.4). 스트리밍된 서버 오류(Flight 오류 행·`data-dgst`)와 열려야 하는 화면의 notFound 를 잡는다.
  기대 문구는 레이아웃(사이드바)이 아니라 페이지 세그먼트만 그리는 것으로 바꿨다. carol 의 A·B "열림" 도 이 판정을 거친다.
- run7(exit 0)은 FK 수정 뒤 첫 초록이었다. 다만 그 화면 판정은 스트리밍된 오류를 잡을 수 없었고 일부 기대 문구가 레이아웃으로 늘 충족됐다(6.4).
  그래서 run7 의 "오류 없이 렌더" 는 run8 로 대체한다.
- 그 전 최종 실행(run6, 2026-09-25)은 **exit 1** 이었다. 17단계 중 16단계가 통과했고, 마지막 `render-pages` 가 회의 화면에서 방금 만든 회의를 찾지 못했다.
- run6 의 원인은 `0003_org_core.sql` 이 두 표에서 단일 FK 를 남긴 채 복합 FK 를 더한 것이었다(6.1, 보고서 우려 C1). PostgREST 가 임베드를
  PGRST201 로 거절하고, 회의 조회는 로그만 남긴 채 빈 목록으로 그렸다. 같은 원인으로 헤더 알림함도 `failed` 였다.
  `0185093` 이 0003 을 고쳐 표 쌍마다 FK 를 하나만 남겼고, `d8259d2` 가 이를 스키마 불변식 테스트로 막았다. run7 에서 회의 목록·알림함이 정상이다(5절).
- 브리프의 "carol 로 `/p/B` 404" 는 스펙과 어긋나 그대로 검사하지 않았다(4절). B 는 같은 워크스페이스라 조회 전용이다.
  존재 은닉은 타 워크스페이스 프로젝트 C 와 미존재 id 로 확인했다.
- 은닉된 화면도 HTTP 상태는 200 이다(4.1). 판정은 실제 HTTP 404 또는 RSC 페이로드의 `notFound()` digest 다. run8 에서 신호는 둘 다 digest 였다.

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres(Docker `supabase_db_d-flow`) · 마이그레이션 `0000`~`0003` |
| 앱 | Next.js 15.5.19 `next dev` · Node 22.18.0 |
| dev 서버 env | 명령줄로만 `INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000`(`.env.local` 에 쓰지 않음) |
| 부트스트랩 | `admin@example.com`, 워크스페이스 `default`(기본값). 부트스트랩은 팀을 만들지 않는다(Task 8) |
| 산출물 | 이 PC 의 세션 스크래치 폴더(`E2E_OUT_DIR`, 커밋 안 함) |

## 2. 순서와 명령

순서는 addendum 대로 `db:reset` → `dev:bootstrap` → E2E(깨끗한 상태) → `test:rls` 다.
`test:rls` 는 픽스처(워크스페이스 `rls-a` 등, "RLS A/B" 프로젝트)를 dev DB 에 남기므로 반드시 E2E 뒤에 돌린다.
비밀번호는 플랜 Task 11 Step 2 의 값을 env 로만 넘겼다(아래 `<BOOTSTRAP_PASSWORD>`).

최종 실행 run8(2026-09-26, 트리 `be93fee`). 대기 루프와 정지는 실제로 친 명령 그대로다(zsh):

```bash
npm run db:reset                                                    # 06:17:36 → 06:18:03
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' npm run dev:bootstrap   # 06:18:03
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 nohup npm run dev > <스크래치>/run8.dev.log 2>&1 &
echo $! > <스크래치>/dev.pid                                        # 06:18:08, npm PID 64770
for i in $(seq 1 60); do c=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login); \
  [ "$c" = 200 ] && { echo "ready $c $(date +%H:%M:%S) try=$i"; break; }; sleep 2; done   # ready 200 06:18:11 try=2(리스너 PID 64841)
BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' INVITE_ALLOWED_DOMAINS=example.com E2E_OUT_DIR=<스크래치>/run8.out \
  node scripts/e2e-local.mjs > <스크래치>/run8.e2e.json 2> <스크래치>/run8.e2e.err   # 06:18:16 → 06:18:51, exit 0
# 눈확인(5절) 06:19:05 → 06:19:21
P=$(cat <스크래치>/dev.pid); C1=$(pgrep -P $P); C2=$(for c in ${=C1}; do pgrep -P $c; done)
kill -TERM $P ${=C1} ${=C2}                                        # 64770 64829 64841, rc 0
lsof -nP -iTCP:3000 -sTCP:LISTEN; pgrep -fl "next dev|next-server|npm run dev"   # 06:19:34 둘 다 비어 있음(rc 1)
npm run test:rls                                                    # 06:19:34, 2 파일 · 10/10 통과
```

run8 의 dev 서버 로그에서 E2E 구간(149줄 중 1~85행)에 `error`·`실패`·`PGRST` 줄은 0이다. 86행부터의 오류 25줄은 눈확인 탐침을
처음에 잘못 부른 것이다. zsh 가 id 셋을 한 인자로 넘겨 `/p/<id id id>/members`·`/p/undefined/wbs` 를 요청했고, 바로 바른 인자로 다시 돌렸다(5절).

run7(2026-09-26, 트리 `d8259d2`) — exit 0, 화면 판정은 6.4 이전 러너:

```bash
npm run db:reset                                                    # 06:03:24 → 06:03:49
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' npm run dev:bootstrap   # 06:03:49
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  nohup npm run dev > <스크래치>/run7.dev.log 2>&1 &               # 06:03:55, npm PID 기록(16390)
# /login 이 200 을 줄 때까지 2초 간격 최대 60회 대기 → 06:04:00 200(리스너 PID 16453)
BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' INVITE_ALLOWED_DOMAINS=example.com E2E_OUT_DIR=<스크래치>/run7.out \
  node scripts/e2e-local.mjs > <스크래치>/run7.e2e.json            # 06:04:04 → 06:04:47, exit 0
# 눈확인(5절) 06:05:11 → 06:05:15
# 기록한 npm PID 와 그 자손(16390 16438 16453)을 SIGTERM → lsof -nP -iTCP:3000 -sTCP:LISTEN 비어 있음(rc 1),
#   pgrep "next dev|next-server|npm run dev" 0건 확인(06:05:42)
npm run test:rls                                                    # 06:05:44, 2 파일 · 10/10 통과
```

run7 의 dev 서버 로그(`run7.dev.log`)에 `error`·`실패`·`PGRST` 줄은 0이다.

그 전 최종 실행 run6(2026-09-25, 트리 `1bdb553` + 러너 변경) — **exit 1**, 기록으로 남긴다:

```bash
npm run db:reset                                                    # 15:31:09 → 15:31:34
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' npm run dev:bootstrap
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  nohup npm run dev > <스크래치>/run6.dev.log 2>&1 &               # 15:31:34, npm PID 기록(10149)
# /login 이 200 을 줄 때까지 2초 간격 최대 60회 대기 → 15:31:37 200(리스너 PID 10201)
BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' INVITE_ALLOWED_DOMAINS=example.com E2E_OUT_DIR=<스크래치>/run6.out \
  node scripts/e2e-local.mjs > <스크래치>/run6.e2e.json            # 15:31:37 → 15:32:12, exit 1
# 눈확인(5절) 15:32:12 → 15:32:17
# 기록한 npm PID 와 그 자손(10149 10190 10201)을 SIGTERM → lsof -nP -iTCP:3000 -sTCP:LISTEN 비어 있음 확인(15:32:18)
npm run test:rls                                                    # 15:32:29, 9/9 통과
```

실행 이력. 각 실행이 드러낸 것과 고친 것은 이렇다.

| 실행 | 결과 | 조치 |
|---|---|---|
| run1(09-25 15:11) | `invite-issue` 확인 조회가 `permission denied for table project_invites` | 이 표는 `service_role` 에만 grant 가 있다. 러너의 확인 조회를 로컬 service_role 클라이언트로 바꿨다 |
| run2(09-25 15:13, 같은 dev 서버로 재실행) | `import-append` 409 `needsTeams:["ERP"], scope:"global"` | 팀 캐시가 모듈 인스턴스마다 따로다(6.3). 재시도로 덮지 않고 원인을 적은 실패 문구로 바꿨다 |
| run3(09-25 15:15) | carol 의 C 화면이 404 가 아닌 200 | 스트리밍 때문이다(4.1). 판정을 `notFound()` digest 로 바꿨다. 단계 이름을 덮어쓰던 러너 버그(`name` 키)도 고쳤다 |
| run4(09-25 15:19)·run5(09-25 15:22) | run6 과 같은 결과 | run5 뒤 단계 기록기에 예약 키 검사를 더했다. 그래서 그날의 최종 기록은 커밋할 코드로 다시 돈 run6 이다 |
| exp1(09-25 15:21) | exit 0 | 단일 FK 두 개를 로컬 DB 에서만 지운 실험(7절) |
| run6(09-25 15:31) | **exit 1** — `render-pages` 가 `/p/A/meetings` 에서 "E2E 킥오프" 를 찾지 못함 | 원인은 0003 의 FK 중복(6.1, 보고서 우려 **C1**). 러너로 덮지 않고 실패로 남겼다. `0185093` 이 0003 을 고쳤고 `d8259d2` 가 스키마 불변식 테스트를 더했다 |
| run7(09-26 06:04) | **exit 0** — 17단계 전부 ✓ | 러너 변경 없음. 뒤이은 리뷰가 화면 판정 결함을 확정했다(6.4). 그 판정으로는 오류를 잡을 수 없었으므로 run7 의 화면 결과는 확정 기록이 아니다 |
| run8(09-26 06:18) | **exit 0** — 17단계 전부 ✓ | 러너 `be93fee`(6.4). 3절·4절·5절이 이 실행의 기록이다 |

## 3. 단계표 — run8 (2026-09-26, reset 06:17:36, E2E 06:18:16)

화면이 부르는 서버 액션은 `.next/server/server-reference-manifest.json` 에서 id 를 읽어 그 페이지로 `POST` 했다(`next-action` 헤더).
반환값은 Flight 응답에서 꺼냈다(`actionResult`). 확인은 로그인 세션 조회로 했고, grant 가 없는 `project_invites` 만 service_role 로 봤다.
각 단계는 그 단계의 검사가 끝난 뒤 `ok` 와 함께 기록된다(실패면 `ok:false`·✗ 로 기록하고 멈춘다 — 6.4).

| 시각 | 단계 | 경로 | 결과 · 행 수 |
|---|---|---|---|
| 06:18:19 | login | `@supabase/ssr` 로그인 → `GET /projects` | ✓ 200, 쿠키 `sb-127-auth-token` |
| 06:18:19 | create-projects | `createProject` × 2 via `POST /projects` | ✓ 2건(`E2E A/B 202609252118`), 둘 다 라벨 단계·작업·활동 · `max_depth` 3, 같은 워크스페이스 |
| 06:18:21 | project-teams | `addProjectTeam` via `POST /p/<id>/settings` | ✓ 3행 — A: ERP·MES, B: QA. 전부 프로젝트와 같은 워크스페이스 |
| 06:18:24 | roster | `upsertRosterMember` via `POST /p/<id>/members` | ✓ 3행 — 본인@A admin [ERP(대표), MES] 계정 연결, bob@A 권한·이메일·팀 없음·계정 없음, 본인@B member [QA] |
| 06:18:25 | fill-template | `GET /api/import/template` | ✓ 5행, 말단 담당 = ERP |
| 06:18:25 | import-inspect | `POST /api/import/inspect` | ✓ outline(0열), 팀 열 `[[8,'*']]` |
| 06:18:25 | import-append | `POST /api/import/execute` `registerTeams=false` | ✓ `count 5`, 5행, ERP 담당 2행(1.1.1·1.2.1, primary) |
| 06:18:25 | import-replace | 같은 라우트 `mode=replace` | ✓ 백업 5행, 교체 뒤 5행·ERP 담당 2행 |
| 06:18:31 | assign-external | `setWbsAssignee` via `POST /p/A/wbs` | ✓ bob 담당 1행(1.1.1) |
| 06:18:35 | meeting | `createMeeting` via `POST /p/A/meetings` | ✓ 회의 1건, 참석자 1행(bob) |
| 06:18:38 | export | `GET /api/report`(pptx·xlsx), `GET /api/export` | ✓ 3건 — 430,269 B / 113 항목, 10,679 B / 11 항목, 20,969 B / 11 항목 |
| 06:18:38 | trace-scan | 산출물 zip 전 항목 | ✓ 135 항목, 적중 0 |
| 06:18:38 | invite-issue | `createProjectInvite` via `POST /p/A/members` | ✓ carol@example.com member [ERP], 상태 active, 링크 origin `http://localhost:3000`, 메일 미발송("메일 발송이 설정되지 않았습니다." — SMTP 없음, 초대는 유효), 초대 1행 |
| 06:18:40 | invite-redeem | 새 쿠키 항아리로 `GET /invite/<토큰>` → `redeemInviteWithSignup` | ✓ `projectId` = A, A 명단 3행, carol [ERP] 계정 연결, 초대 `redeemed_at` 기록 |
| 06:18:40 | other-workspace-fixture | service_role(로컬 전용) | ✓ 워크스페이스 `e2e-other` + 프로젝트 `E2E C 202609252118`(워크스페이스 생성 경로는 SP2) |
| 06:18:41 | visibility | carol 로그인 뒤 화면·액션 | ✓ 4절 표 — 열린 화면은 `pageProblems` 0건 |
| 06:18:51 | render-pages | 관리자 세션 `GET` 6화면, `pageProblems`(digest·notFound·열화·기대 문구) | ✓ 6화면 문제 0(아래 표) |

render-pages 의 기대 문구는 페이지 세그먼트만 그리는 것이다. 레이아웃(사이드바·헤더)은 프로젝트 이름을 모든 화면에 싣기 때문이다.

| 화면 | 기대 문구 | 문제 |
|---|---|---|
| `/projects` | 카드 링크 `/p/<A>/dashboard`·`/p/<B>/dashboard` | 0 |
| `/p/A/members` | `bob`, `carol` | 0 |
| `/p/A/meetings` | `E2E 킥오프` | 0 |
| `/p/A/issues` | (없음 — digest·열화·notFound 만) | 0 |
| `/p/A/wbs` | `요구사항 정리` | 0 |
| `/p/A/attendance` | (없음 — digest·열화·notFound 만) | 0 |

`/projects` 의 카드 링크가 레이아웃 몫이 아님은 눈확인 탐침에서 따로 확인했다. 사이드바는 현재 프로젝트의 메뉴만 그린다.
그래서 `/p/A/members` 에는 A 의 대시보드 링크만 있고 B 의 것은 없다. 관리자의 `/p/C/wbs` 에는 둘 다 없다.

run7(2026-09-26 06:04) 의 단계 결과는 run8 과 같았다(시각·이름 스탬프 제외). 다만 화면 판정이 6.4 이전이었다.
run6(2026-09-25) 의 단계 결과는 `render-pages` 를 빼고 같았다. run6 의 `render-pages` 는 **✗** 였다 —
`/p/A/meetings` 에 방금 만든 회의 제목 "E2E 킥오프" 가 없었다(6.1). 나머지 5화면은 ✓ 였다.

토큰은 발급 응답의 `url` 에만 있고(DB 는 해시) 러너가 거기서 꺼냈다. carol 의 비밀번호는 실행마다 새로 만들고 출력하지 않는다.

## 4. 존재 은닉 — carol 세션 (run8)

"열림" 은 notFound 가 아니고 `pageProblems` 가 0건이라는 뜻이다. 즉 스트리밍된 오류 digest·열화 표시가 없고, 기대 문구가 있어야 한다.
기대 문구는 WBS 페이지 히어로 제목 `<이름> WBS · 간트` 다. A 는 리프 "요구사항 정리" 도 요구한다.
은닉 판정은 HTTP 404 또는 notFound digest 이고, 어느 신호였는지 기록한다. run6·run7 의 A·B 판정은 notFound 여부만 봤다(6.4).

| 대상 | 기대(근거) | HTTP | notFound(신호) | 열린 화면의 문제 | 프로젝트 이름이 HTML 에 |
|---|---|---|---|---|---|
| A — 명단 멤버 | 화면 열림 | 200 | 아니오 | 0(히어로 제목·리프 있음) | 예 |
| B — 같은 워크스페이스, 명단 없음 | 조회 전용(스펙 2.4.1 "그 외 워크스페이스 멤버 → `'viewer'`") | 200 | 아니오 | 0(히어로 제목 있음) | 예 |
| B 에 `createMeeting` | 쓰기 거부 | — | — | — | 결과 `{ ok: false, error: "권한 없음" }`, B 회의 0건 |
| C — 타 워크스페이스 | 존재 은닉(roleIn ④ null) | 200 | **예**(digest) | — | **예**(4.2) |
| 미존재 id | 존재 은닉 | 200 | **예**(digest) | — | — |
| (대조) 관리자로 C | 플랫폼 관리자는 전부 봄 — 은닉이 부재가 아니라는 대조 | 200 | 아니오 | 0(히어로 제목 있음) | 예 |

히어로 제목은 은닉된 C 의 HTML 에도 실린다(4.2 — 레이아웃이 notFound 를 내도 페이지 세그먼트가 병렬로 흘러간다).
그래서 "열림" 의 근거는 기대 문구만이 아니다. notFound 가 아니고 오류 digest 가 없다는 것과 함께여야 한다.

**브리프와의 편차.** 브리프는 "carol 로 `/p/B` 는 404" 를 요구한다. 그러나 초대 수락 RPC `consume_project_invite` 가 carol 을 워크스페이스
`default` 의 member 로 넣는다. B 도 같은 워크스페이스다. 설계 정본 `2026-09-23-generic-platform-design.md` 2.4.1 과 `roleIn` ⑥ 에 따라
carol 은 B 에서 `'viewer'` 다. 그래서 러너는 B 를 "화면 열림 + 쓰기 거부" 로 검사한다. "타 프로젝트 404" 의 뜻인 존재 은닉은 C 와 미존재 id 로 검사한다.
브리프 문구대로의 검사("B 404")는 **하지 않았다.** 스펙을 바꿀지는 컨트롤러가 판정한다.

### 4.1 은닉된 화면도 HTTP 200 이다

`(app)/loading.tsx` 가 `/p/[projectId]` 레이아웃을 Suspense 로 감싼다. 그래서 셸이 먼저 흘러가고 상태 코드는 200 으로 확정된다.
레이아웃의 `notFound()` 는 RSC 페이로드의 digest `NEXT_HTTP_ERROR_FALLBACK;404` 와 `<meta name="robots" content="noindex">` 로만 남는다.
화면은 클라이언트가 not-found 로 그린다. 따라서 러너는 실제 HTTP 404 또는 digest(`notFoundRendered`)를 은닉으로 본다(run8 에서 신호는 digest).
셸 전에 렌더되는 경로(예: SP2 뒤 재측정)가 진짜 404 를 주더라도 올바른 은닉을 실패로 읽지 않게 하려는 것이다.
API 라우트의 404(`denyStatus`)는 이 영향을 받지 않는다.

### 4.2 C 의 이름과 화면 페이로드가 carol 의 HTML 에 실린다

carol 이 받은 C 화면 HTML 에는 다음이 들어 있다(run3 뒤 탐침, 2026-09-25 15:18).

- 사이드바 목록과 프로젝트 선택에 C 가 있다. `listProjectsWithState` 가 비공개만 거르고, `projects` 읽기 정책이 개방이기 때문이다.
- WBS 페이지 본문의 제목 "E2E C … WBS · 간트" 와 `projectName` 이 있다. 레이아웃이 `notFound()` 를 내도 페이지 세그먼트는 병렬로 렌더돼 흘러간다.

SP1 스펙 표(258행)는 "`read_all_members`·`projects` 읽기가 SP1 동안 개방 상태 — 의도된 상태(SP2 범위)" 로 이것을 받아들였다.
"SP2 착수 전 원격 배포 금지" 도 명시했다. 러너는 이 노출을 판정하지 않고 `projectNameInHtml` 로 기록만 한다.
SP2 가 읽기 정책을 닫을 때 이 값이 C 에서 `false` 가 돼야 한다.

## 5. 눈확인 — 관리자 세션

**방법.** 이 샌드박스의 브라우저(claude-in-chrome)는 localhost 에 닿지 못한다(`.claude/skills/verify`). 그래서 러너와 같은 `@supabase/ssr` 세션
쿠키로 렌더된 HTML 을 받아 봤다. 화면을 사람 눈으로 본 것은 아니다.

판정은 `pageProblems` 다. 주 판정은 스트리밍된 서버 오류 digest(Flight `E{"digest":…}` 행·`<template data-dgst>`)와 notFound 다.
보조로 열화 표시("일부 정보를 불러오지 못했습니다")·Next 오류 문서(`__next_error__`)·error.tsx 문구("화면을 불러오지 못했습니다")를 본다.
error.tsx 문구는 스트리밍 아래 HTML 에 나오지 않는다(6.4). run7·run6 의 표는 그 문구를 주 판정으로 쓴 이전 방법의 기록이다.

### run8 (2026-09-26 06:19:18 → 06:19:21)

| 화면 | 결과 |
|---|---|
| `/projects` | 200, `pageProblems` 0 |
| `/p/A/members` | 200, `pageProblems` 0 |
| `/p/A/meetings` | 200, `pageProblems` 0. 방금 만든 회의 "E2E 킥오프" 가 있다(러너 `render-pages`) |
| `/p/A/issues` | 200, `pageProblems` 0 |
| `/p/A/wbs` | 200, `pageProblems` 0. 리프 "요구사항 정리" 가 있다(러너) |
| `/p/A/attendance` | 200, `pageProblems` 0 |
| 헤더(e5065be 어댑터) — 측정 | 6화면 모두 `identity` prop = `{ roleLabel: "슈퍼유저", teamCode: "ERP", isSuperuser: true, showUsage: true, showPortfolio: true }`. 팀 라벨 값은 A 의 대표 팀 ERP 다 |
| 헤더 계정 메뉴 문구 — 추론 | "슈퍼유저 · ERP" 는 `HeaderChrome` 코드(roleTeam)로부터의 **추론이다(미관측)**. SSR 에서 메뉴가 닫혀 있어 문구가 HTML 에 없다. 사람 눈 확인은 8절에 남는다 |
| 헤더 알림함(`GET /api/shell`) | 200, `inbox` = `{ items: [], unseen: 0 }` — `failed` 없음 |

### run7 (2026-09-26 06:05:11 → 06:05:15) — 6.4 이전 판정

| 화면 | 결과 |
|---|---|
| `/projects` | 200, 오류 표식 없음. A·B 가 목록에 있다(러너 `render-pages`) |
| `/p/A/members` | 200, 오류 표식 없음. bob·carol 이 있다 |
| `/p/A/meetings` | 200, 오류 표식 없음. **방금 만든 회의 "E2E 킥오프" 가 있다** — run6 의 결함이 고쳐졌다 |
| `/p/A/issues` | 200, 오류 표식 없음 |
| `/p/A/wbs` | 200, 오류 표식 없음. 리프 "요구사항 정리" 가 있다 |
| `/p/A/attendance` | 200, 오류 표식 없음 |
| 헤더(e5065be 어댑터) | 6화면 모두 `identity` = `{ roleLabel: "슈퍼유저", teamCode: "ERP", isSuperuser: true, showUsage: true, showPortfolio: true }`. 팀 라벨은 A 의 대표 팀 ERP 다 |
| 헤더 알림함(`GET /api/shell`) | 200, `inbox` = `{ items: [], unseen: 0 }` — `failed` 가 없다. run6 의 PGRST201 이 사라졌다 |

dev 서버 로그에 `[getProjectMeetingData]`·`[inbox]` 실패 줄이 없다.

### run6 (2026-09-25 15:32:12)

| 화면 | 결과 |
|---|---|
| `/projects` | 오류 없이 렌더. A 가 목록에 있다 |
| `/p/A/members` | 오류 없이 렌더. 옛 화면(MembersBoard)이 새 DTO 로 admin·bob·carol·ERP·MES 를 싣는다 |
| `/p/A/meetings` | 오류 경계는 없다. **방금 만든 회의가 없다** — 서버 로그 `[getProjectMeetingData] meetings 조회 실패 … Could not embed because more than one relationship was found for 'meetings' and 'meeting_attendees'`(6.1) |
| `/p/A/issues` | 오류 없이 렌더 |
| `/p/A/wbs` | 오류 없이 렌더. 리프 "요구사항 정리" 가 있다 |
| `/p/A/attendance` | 오류 없이 렌더 |
| 헤더(e5065be 어댑터) | 전 화면에서 `identity` = `{ roleLabel: "슈퍼유저", teamCode: "ERP" }`(측정). 관리자의 대표 팀(A 의 ERP, B 의 QA) 중 가나다순 첫 팀이 ERP 다. 계정 메뉴 문구 "슈퍼유저 · ERP" 는 `HeaderChrome` roleTeam 코드로부터의 추론이다(미관측 — SSR HTML 에는 메뉴가 닫혀 있어 문구가 없다) |
| 헤더 알림함(`GET /api/shell`) | 200 이지만 `inbox` = `{ items: [], unseen: 0, failed: true }` — `notification_recipients`↔`notification_events` 임베드 PGRST201(6.1) |

## 6. 발견

### 6.1 0003 의 FK 중복 — 회의 조회·알림함이 깨진다 (결함, Phase A 회귀 — 고침: `0185093`·`d8259d2`)

**해소(2026-09-26).** `0185093` 이 0003 본문을 고쳤다. `meeting_attendees` 는 단일 `meeting_id` FK 를 지우고 복합 FK 만 남긴다.
`notification_recipients` 는 단일 `event_id` FK 를 남기고 복합 FK 대신 트리거로 사건과의 `project_id` 일치를 본다
(`project_id` 가 null 인 수신자가 있어서다). `d8259d2` 는 같은 public 표 쌍에 FK 가 둘 이상이면 실패하는 스키마 불변식 테스트를 더했다.
run7 직전 `db:reset` 뒤 두 표 쌍의 FK 는 각각 `meeting_attendees_meeting_project_fk`·`notification_recipients_event_id_fkey` 하나뿐이다.
run7 은 exit 0 이고 회의 목록·알림함이 정상이다(3절·5절). 아래는 run6 시점의 기록이다.

`0003_org_core.sql` 은 두 표에 복합 FK 를 더하면서 단일 FK 를 남겼다. `attendance_records` 에는 같은 상황에서 단일 FK 를 지웠다("복합만 남긴다").

```
meeting_attendees       | meeting_attendees_meeting_id_fkey          | FOREIGN KEY (meeting_id) REFERENCES meetings(id)
meeting_attendees       | meeting_attendees_meeting_project_fk       | FOREIGN KEY (meeting_id, project_id) REFERENCES meetings(id, project_id)
notification_recipients | notification_recipients_event_id_fkey      | FOREIGN KEY (event_id) REFERENCES notification_events(id)
notification_recipients | notification_recipients_event_project_fk   | FOREIGN KEY (event_id, project_id) REFERENCES notification_events(id, project_id)
```

두 관계가 생기면 PostgREST 가 임베드를 거절한다(service_role 로 재현).

```
GET /rest/v1/meetings?select=id,meeting_attendees(member_id)                → 300 PGRST201
GET /rest/v1/notification_recipients?select=id,notification_events(type)   → 300 PGRST201
GET /rest/v1/meeting_attendees?select=member_id,meetings(title)            → 300 PGRST201
```

영향받는 조회는 다음과 같다. 모두 오류를 로그로만 남기고 빈 결과(또는 `null`)로 진행한다.

- `src/lib/data/meetings.ts` 103행·127행·194행(`getProjectMeetingData`·`getMeetingDetail`·`getMyMeetings`).
  호출처는 전역 `/meetings`, 프로젝트 대시보드·회의 화면, 회의 안내 메일(`meetingNotify`), 회의록의 회의 연결(`minutes`),
  주간보고 내보내기(`/api/report`), AI 프로젝트 사실(`ai/projectFacts`)이다.
- `src/lib/repositories/supabase/meetings.ts` 26행: 챗봇의 회의 도구 3개와 대시보드 도구.
- `src/app/actions/inbox.ts` 43행: 헤더 알림함 전체.

단위 테스트는 Supabase 를 모킹해 이것을 잡지 못한다(vitest 6144 전부 통과).
같은 방식으로 스키마 전체를 훑었다. public↔public 표 쌍에 FK 가 둘 이상인 것 중 0003 이 새로 만든 것은 이 둘뿐이다.
나머지는 `auth.users` 참조이거나 기준선부터 있던 것이다(`task_dependencies`·`wiki_item_relations`).

**수정안(검증함, 7절).** 두 단일 FK 를 지운다. 복합 FK 가 같은 행을 같은 `on delete cascade` 로 덮는다.
`0003` 이 아직 `main` 에 없으므로, 3c 처럼 0003 본문을 고치고 롤백 파일에 되살리기를 더할 수 있다. 또는 코드의 임베드 5곳(위 목록)에 FK 힌트를 줄 수도 있다.
어느 쪽인지는 컨트롤러가 판정한다.

### 6.2 존재 은닉의 상태 코드와 SP1 노출 — 4.1·4.2

결함이 아니라 기록이다. 상태 코드 200 은 Next 스트리밍의 성질이다. 이름·페이로드 노출은 SP1 이 받아들인 개방 읽기 정책의 결과다.
SP2 가 닫을 때 이 문서의 `projectNameInHtml` 을 다시 잰다.

### 6.3 팀 마스터 캐시가 모듈 인스턴스마다 따로다 — 방금 만든 프로젝트 팀을 임포트가 못 볼 수 있다 (기존 설계, SP1 에서 드러남)

`src/lib/teams/master.ts` 는 프로세스 전역 캐시(TTL 60초)다. TTL 이 지난 뒤 첫 동기 읽기는 옛 값을 돌려주고 백그라운드로 갱신한다.
next dev 에서 설정 화면(`addProjectTeam` → `refreshTeams()`)과 `/api/import/execute` 라우트는 다른 모듈 인스턴스다. run2 는 같은 dev 서버로
다시 돌렸고, 임포트 라우트가 run1 에서 이미 로드돼 있었다. 그래서 방금 만든 ERP 를 못 보고 409 `needsTeams:["ERP"], scope:"global"` 를 냈다.

- `scope` 도 옛 캐시로 판정해 `global` 이다. 이 응답에 마법사가 "등록" 을 누르면(`registerTeams=true`) **프로젝트 팀이 아니라 전역 팀 ERP 를 만든다**(슈퍼유저일 때).
- SP0 에서는 부트스트랩이 서버 기동 전에 전역 팀을 만들어 드러나지 않았다. SP1 에서 팀이 프로젝트별이 되면서 드러났다.
- 깨끗한 순서(새 dev 서버)에서는 라우트가 팀 생성 뒤 처음 로드되므로 재현되지 않는다. 러너는 재시도로 덮지 않고 원인을 적어 멈춘다.
- 소유 태스크가 없다. SP4 R10(팀 캐시 워크스페이스 스코프)과 함께 볼 거리다.

### 6.4 러너의 화면 판정이 스트리밍된 오류를 못 잡았다 (러너 결함, 리뷰 확정 — 고침: `be93fee`)

run7 까지의 러너는 화면이 깨져도 통과할 수 있었다. 두 가지 이유다.

- **오류 표식이 도달 불가였다.** `pageProblems` 는 `(app)/error.tsx` 문구 "화면을 불러오지 못했습니다" 를 찾았다. 그러나 error.tsx 는
  `'use client'` 클래스 경계라 서버 렌더가 돌리지 않는다. `(app)/loading.tsx` 가 셸을 먼저 흘려보낸 뒤 서버 컴포넌트가 던지면 HTTP 는 200 이다.
  HTML 에는 인라인 RSC 페이로드의 Flight 오류 행 `<id>:E{"digest":"…"}` 와 `<!--$!--><template data-dgst="…">` 만 남는다.
  경계는 브라우저가 그린다. 로컬 실측(2026-09-26 06:13)으로 확인했다. dev 서버에서 PostgREST 컨테이너만 멈추고 관리자로 `/p/A/wbs` 를 받았다.
  `getComputedWbs` 가 던졌고, 결과는 HTTP 200·digest `2570364813`·`data-dgst` 1개·error.tsx 문구 0회였다. 컨테이너는 바로 되살렸다.
  → 러너는 이제 `$undefined`·notFound 가 아닌 digest 를 오류로 잡는다(`streamedErrorDigests`). 관리자 화면의 notFound 도 문제로 본다.
  이 캡처와 정상 화면 캡처를 `tests/scripts/fixtures/page-*.html.gz` 로 넣었다. 세션 쿠키 값과 로컬 경로는 가렸다.
  정상 화면에도 메타데이터 경계의 `"digest":"$undefined"` 가 있어서 그것을 빼는 규칙까지 픽스처로 고정했다.
- **기대 문구가 레이아웃으로 충족됐다.** `/projects` 는 A·B 이름을 기대했지만 사이드바가 모든 화면에 이름을 싣는다.
  carol 의 A·B "열림" 은 notFound 가 아닌 것만 봤다. → `/projects` 는 카드 링크를, 열린 WBS 화면은 히어로 제목(A 는 리프명까지)과
  `pageProblems` 를 본다(3절·4절).

같이 고친 것은 네 가지다. 단계 ✓ 는 그 단계의 검사 뒤에 기록한다(run6 은 `render-pages ✓` 를 찍고 throw 했다).
실패 메시지·스택의 `/invite/<토큰>` 을 가린다. 은닉 판정에 실제 HTTP 404 도 인정한다.
`ERR_DENIED`·문구 표식을 앱 원본과 대조하는 드리프트 테스트를 더했다.

### 6.5 관찰 — 판정하지 않은 것

- 캡처 중 dev 모드 HTML 의 인라인 RSC 페이로드에 로그인 세션 쿠키 값(`base64-…`, access·refresh 토큰)이 실린 것을 봤다.
  React 개발 모드의 디버그 정보로 보이지만 확인하지 않았다. 프로덕션 빌드(`next start`)에서도 실리는지는 재지 않았다. 픽스처에서는 가렸다.
- 관리자(플랫폼 관리자)로 없는 프로젝트 id(`/p/<무작위 uuid>/wbs`)를 받으면 notFound 가 아니라 빈 화면이 렌더됐다(06:14 탐침).
  carol 에게는 같은 요청이 notFound 다(4절). 슈퍼유저 판정이 존재 확인보다 먼저라서인 것으로 보이며, 결함인지는 판정하지 않았다.

## 7. 실험 — 두 단일 FK 를 지운 DB (exp1, reset 15:21:03)

`db:reset` 직후 로컬 DB 에만 아래를 적용하고 2절과 같은 순서로 돌렸다. 리포의 마이그레이션은 바꾸지 않았고, 다음 `db:reset`(run5)으로 원상태가 됐다. 실험은 단계 기록기 검사를 더하기 전의 러너로 돌렸다(단계 동작은 같다).

```sql
alter table public.meeting_attendees drop constraint meeting_attendees_meeting_id_fkey;
alter table public.notification_recipients drop constraint notification_recipients_event_id_fkey;
notify pgrst, 'reload schema';
```

결과: E2E **exit 0**, 17단계 전부 ✓(15:21:32 → 15:22:09). dev 서버 로그에 오류 줄이 0이다. 이 흐름 안에서는 6.1 뒤에 가려진 다른 실패가 없었다. 이 실험 실행은 헤더 알림함을 부르지 않았으므로, 알림함이 고쳐지는지는 FK 가 하나일 때 임베드가 풀린다는 PostgREST 규칙에 기댄 추론이다.

## 8. 완료하지 못한 것

- ~~**E2E exit 0**~~ — 2026-09-26 run8 에서 완료(6.1 을 `0185093` 이, 6.4 를 `be93fee` 가 고친 뒤 2절 순서로 재실행, exit 0).
- **브리프 문구의 "carol 로 `/p/B` 404"** — 스펙과 어긋나 검사하지 않았다(4절). 존재 은닉은 C·미존재 id 로 대신 검사했다.
- **존재 은닉의 HTTP 404** — 화면 경로에서는 스트리밍 때문에 받을 수 없다(4.1). digest 로 판정했다.
- **사람 눈의 화면 확인** — 브라우저가 localhost 에 닿지 못해 헤드리스 HTML 검사로 대신했다(5절). 헤더 계정 메뉴 문구 "슈퍼유저 · ERP" 도
  여기에 든다. identity prop 은 쟀지만 메뉴 문구는 추론이다.
