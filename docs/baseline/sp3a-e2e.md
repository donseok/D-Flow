# SP3a E2E 실측 — Phase A 체크포인트

플랜 `docs/superpowers/plans/2026-09-28-sp3a-phase-a.md` 과제 34 를 로컬에서 잰 기록이다. 트리는 `sp3a/phase-a` 의 `4701ed4`
(측정일 2026-09-29, 시각은 KST). 눈확인 표는 `docs/baseline/sp3a-ui.md`.

# Phase A — 체크포인트(과제 34)

**요약**

- 깨끗한 DB(`db:reset` 0000~0012 → `dev:bootstrap`) 위에서 E2E **exit 0, 24단계 전부 ✓** — 기존 시나리오 22단계와 SP3a 새 단계
  `settings-update`·`create-copy`. 산출물 흔적 검사(`trace-scan`) 135항목 적중 0.
- 첫 실행은 `render-pages` 한 단계가 부하 속 첫 컴파일의 팀 캐시 시간 초과로 ✗ 였고, 새 dev 서버로 한 번 재실행해 초록이었다(4절 — SP2 §9 ① 과 같은 원인).
- `test:rls` 26 파일 · 282 케이스(건너뜀 0), `settings:verify` 문제 0건, `typecheck`·`lint`(0 error)·`vitest`(617 파일 · 7678)·`build` 초록.
- 롤백 리허설 R 은 다시 돌지 않았다 — 과제 26~33 사이에 SQL 변경이 없다(`git log --oneline h2-done..HEAD -- supabase/migrations supabase/rollbacks` 가
  커밋 ② `dcf166e` 하나). 과제 25 의 결과를 인용한다: 롤백 `diff r11 b12` ✓ 불일치 0 · 기본 권한 차이 없음 · 재적용 `diff f12 a12` ✓ 불일치 0.

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres 17.6.1.075(Docker/colima `supabase_db_d-flow`) · 마이그레이션 `0000`~`0012` |
| 앱 | Next.js 15.5.19 `next dev -p 3101` · Node 22.18.0 |
| 앱 위치 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp3a-a`(detached `4701ed4`, node_modules 는 메인 체크아웃으로 심볼릭 링크, `.env.local` 복사). 러너는 cwd = 워크트리(서버 액션 id 를 그 워크트리의 `.next` 매니페스트에서 찾는다). 사용자의 :3000 은 건드리지 않음. 끝나고 `git worktree remove --force` |
| dev 서버 env | 명령줄로만 `NEXT_PUBLIC_APP_URL=http://localhost:3101 INVITE_ALLOWED_DOMAINS=example.com MINUTES_API_ENABLED=true MINUTES_API_SECRET=<생성값>` + 모듈 플래그 `WIKI_SERVICE_ENABLED`·`WIKI_WORKER_ENABLED`·`CHAT_V2_ENABLED`·`CHAT_V2_PLANNER_ENABLED`·`CHAT_V2_LLM_SYNTHESIS_ENABLED`·`CHAT_V2_INDEX_WORKER_ENABLED`·`AGENT_API_ENABLED`=true |
| 계정 | 부트스트랩 `admin@example.com`(플랫폼 관리자, 워크스페이스 A=`default` 관리자, 허용 모듈 13개 rev 1). 부트스트랩·B 관리자(`E2E_B_PASSWORD`) 비밀번호와 API 시크릿은 `openssl rand` 로 만들어 한 셸의 변수로만 넘겼다(출력·파일·커밋 없음). ana·외부 계정·carol 비밀번호는 러너가 실행마다 만든다 |
| 산출물 | 세션 스크래치 `mktemp -d`(커밋 안 함) |

## 2. 순서와 명령

```bash
git status --short                                   # 비어 있음
npm run typecheck && npm run lint && npx vitest run --reporter=dot    # 메인 체크아웃, 01:01:50 — 617 파일 · 7678 통과
npm run db:reset                                     # 01:04:07 — 33초, 0000~0012, max(version)=0012
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="$BP" npm run dev:bootstrap   # ✓ 허용 모듈 13개 (revision 1)
npm run settings:verify                              # 프로젝트 0행, 워크스페이스 1행, 문제 0건 — exit 0
npm run test:rls                                     # 26 파일 · 282 통과, 건너뜀 0
git worktree add --detach /Users/jerry/D-Flow-wt/sp3a-a HEAD      # + node_modules 링크, .env.local 복사
( cd "$WT" && npm run build )                        # 01:06~01:07 — Compiled successfully, 정적 페이지 19/19
# test:rls 픽스처가 남으므로 E2E 직전에 다시: reset → bootstrap → dev 서버 → E2E 를 한 셸에서(비밀번호·시크릿이 셸 밖으로 나가지 않게)
npm run db:reset && BOOTSTRAP_PASSWORD="$BP" … npm run dev:bootstrap
( cd "$WT" && <env> nohup npm run dev -- -p 3101 > "$WT/dev.log" 2>&1 & )          # /login 200
( cd "$WT" && BOOTSTRAP_PASSWORD="$BP" E2E_B_PASSWORD="<생성값>" MINUTES_API_SECRET="$MS" E2E_OUT_DIR="$OUT/art" \
    node scripts/e2e-local.mjs > "$OUT/e2e.json" )   # 2회차 01:21:11 → 01:23:42, exit 0
npm run settings:verify                              # E2E·눈확인 뒤 — 프로젝트 9행, 워크스페이스 2행, 문제 0건
kill <기록한 PID>                                     # 3101 닫힘 확인
npm run db:reset && npm run dev:bootstrap            # 손상 행·E2E 데이터를 남기지 않는다
git worktree remove --force /Users/jerry/D-Flow-wt/sp3a-a
```

`db:reset` 한 번(01:08)은 gotrue migrate 컨테이너가 로그 없이 멈춰 300초 제한으로 끊고, 그 컨테이너를 지운 뒤 다시 돌렸다(23초, exit 0).

## 3. E2E 단계표

2회차 — 24단계 전부 `ok: true`, exit 0. **굵은 이름**이 SP3a 에서 새로 넣은 단계다. 워크스페이스 A = `default`, B = `e2e-other`.
프로젝트 A·B·A-copy·A2 는 워크스페이스 A, C 는 B.

| # | 단계 | 판정 |
|---|---|---|
| 1 | login | 부트스트랩 계정의 워크스페이스 소속 A 관리자 1건, 쿠키 `sb-127-auth-token` |
| 2 | create-projects | `createProject(input)`(create_project_with_settings 한 트랜잭션). A·B, 단계 라벨 `["단계","작업","활동"]`, `modules.enabled` 9개 |
| 3 | **settings-update** | `updateProjectSettings` → revision 2, 이력 1행 `core.milestone_keywords` null → `["kick-off","오픈"]`, changed_by = 로그인 사용자, source edit. 같은 명령 재전송 → `duplicate` |
| 4 | **create-copy** | A 를 원본으로 복사 생성(라벨 `["국면","과업","세부"]`) — 이력 키 `core.level_labels`·`core.milestone_keywords`·`modules.enabled`, 전부 source copy·copied_from = A |
| 5–11 | project-teams · roster · fill-template · import-inspect · import-append · import-replace · assign-external | 팀 3(A: ERP·MES, B: QA) · 명단 3 · WBS 5행 · append/replace 각 5건(profileSaved true) · 외부 인력 bob 담당 1 |
| 12–14 | meeting · export · trace-scan | 회의 1(참석자 1) · PPT·주간 엑셀·WBS 엑셀 · 흔적 적중 0(135항목) |
| 15–16 | invite-issue · invite-redeem | carol 멤버·A 첫 팀(ERP), 메일 미설정이라 응답 url 로 가입, 초대 소비 |
| 17 | other-workspace-fixture | 워크스페이스 행과 `modules.allowed`(비core 13)만 service_role, C 는 `createProject(B, …)`, bea 는 `createAccount({ workspaceId: B })` |
| 18 | visibility | carol: A 열림 · B 조회 전용(회의 생성 `권한 없음`) · C·미존재 id not-found(이름 없음). 플랫폼 관리자는 C 를 본다 |
| 19–20 | workspace-admin-project · outsider-invite | ana(A 관리자, 플랫폼 관리자 아님)가 A2 생성 · 외부 초대 가입, outsider 소속 A 멤버 1건, C not-found |
| 21–23 | minutes-upload · workspace-b-isolation · minutes-api-scope | 회의록 2건(`ws/<A>/p/…`) · bea 에게 A·A2 not-found, 목록 흔적 0, Storage 쓰기 RLS 거부·읽기 Object not found · meta: ana 4·outsider 4(A-copy 포함, C 없음)·bea 1(C)·플랫폼 관리자 대조, 목록 ana 2·bea 0, 모르는 이메일 403 `unknown_user`, bea 의 A2 meta 404 |
| 24 | render-pages | 관리자 세션 10화면(`/projects`, A 의 dashboard·members·meetings·issues·announcements·weekly·wbs·attendance, `/minutes`) — 오류 digest·notFound·열화 표식 0 |

## 4. 비고

- **1회차 실패(부하 의존 플레이크 — render-pages)**: 01:14:21 → 01:19:50, 23단계 ✓ 뒤 `render-pages` ✗ — `/p/<A>/issues` 에 `error-digest:2323996267`.
  dev.log: `/p/[projectId]/issues` 첫 컴파일 12s(8063 modules) 직후 `[teams] 최초 팀 마스터 로드 실패 … 팀 마스터 로드 3000ms 초과` →
  `ProjectLayout` 의 `teamsForProjectSync` 가 `팀 마스터를 아직 불러오지 못했습니다.` throw. 그 GET 119.6초, 이어 announcements 컴파일 72.4초 — 병행 리뷰
  워크플로 부하 속 첫 컴파일(load average 01:19 13.47). `docs/baseline/sp2-e2e.md` 9절 ① 과 같은 원인이고 Phase A 가 건드리지 않은 `src/lib/teams/master.ts`
  의 3초 한도다. 기록한 PID 로 서버를 내리고(모듈 인스턴스별 팀 캐시가 옛 DB 를 보지 않게) reset → bootstrap → 새 dev 서버로 한 번 재실행 → 초록.
- 2회차 뒤 눈확인 중 dev 서버가 `Server is approaching the used memory threshold, restarting...` 로 한 번 스스로 재시작했다(sp2-e2e 9절 ② 와 같은 현상 —
  진행 중 새로고침 하나가 `ERR_CONNECTION_RESET`, 재시도로 통과). 판정에는 영향이 없다.
- E2E 의 숨은 프로젝트 방문 5회(carol→C·미존재 id, outsider→C, bea→A2·A 대시보드)마다 dev.log 에 `[settings] 페이지 설정 조회 실패` 가 1줄씩
  (console.error, `{ projectId, cause: '프로젝트 설정 행이 없습니다: <id>' }`) — 세션 RLS 0행 → 해석기 throw. 화면은 not-found. C1 리뷰 M-6 의 관찰 그대로다.

## 5. 게이트 결과

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입 | `npm run typecheck` | 0 error |
| 린트 | `npm run lint` | 0 error, warning 5(기존 — `tests/ai/*` 미사용 변수) |
| 단위 | `npx vitest run --reporter=dot` | 617 파일 · 7678 테스트 통과(한 번에 초록 — 부하 플레이크 없음) |
| 빌드 | `npm run build`(스크래치 워크트리, `4701ed4`) | Compiled successfully · 정적 페이지 19/19 |
| DB | `npm run db:reset` | 0000~0012 적용, `max(version)` = 0012 |
| 사후검사 | 0012 ⑫ DO 블록(`0012_settings.sql:1319-1483`)을 부트스트랩 뒤 DB 에 다시 | `DO`, exit 0. `default` 의 `modules.allowed` 13개(rev 1) |
| 설정 | `npm run settings:verify` | 문제 0건(부트스트랩 직후 프로젝트 0·워크스페이스 1, E2E·눈확인 뒤 9·2) |
| RLS | `npm run test:rls` | 26 파일 · 282 테스트 통과, 건너뜀 0 |
| E2E | 3절 | exit 0 · 24/24 ✓(2회차) |
| 롤백 | 과제 25 인용 | 불일치 0 · 기본 권한 차이 없음 · 재적용 불일치 0 |

## 6. 최종 수정 뒤 재실행(Phase A 최종 수정 — FN-1 이 생성 결과를 바꿔서)

- 트리 `sp3a/phase-a` `cbf186d`(최종 수정 코드 커밋 전부), 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp3a-final` 의 `next dev -p 3101`, 2절과 같은 순서·플래그 7개.
- **최종 수정 뒤 재실행: exit 0 · 24/24 ✓**(2회차, 2026-09-29 04:12:13~04:18:22). create-projects A·B 의 `modules.enabled` = 토글 9 — 플래그가 켜진 E2E 에서는
  FN-1(허용 목록에서 env 를 뺌) 전후가 같다. settings-update rev 2·재전송 duplicate, trace-scan 135항목 적중 0, render-pages 10화면 문제 0.
- 1회차(03:46~04:10)는 render-pages ✗ `TypeError: fetch failed` — dev.log `⚠ Server is approaching the used memory threshold, restarting...`(4절 둘째 줄·sp2-e2e §9 ② 와
  같은 현상), load 10~11.8, 첫 컴파일 members 56.7s·issues 106.9s·announcements 281.2s. 23단계는 ✓. 기록한 PID 로 서버를 내리고 reset → bootstrap → 새 서버로 한 번
  재실행했다. 재실행의 dev 서버에만 `NODE_OPTIONS=--max-old-space-size=8192`(하네스 설정, 앱 코드 무관) — 재시작 0회.

# Phase B — 체크포인트(과제 28)

**요약**

- 깨끗한 DB(`db:reset` 0000~0012 → `dev:bootstrap`) 위에서 E2E **exit 0, 28단계 전부 ✓** — Phase A 의 24단계와
  B 의 새 넷(`module-issues-off`·`module-agents-off`·`module-minutes-integration-off`·`module-index-skip`).
  산출물 흔적 검사(`trace-scan`) 135항목 적중 0, `render-pages` 10화면 오류 표식 0.
- **눈확인 B-1~B-4 전부 통과(22개 항목)** — 챗 위젯 탐침, 꺼진 모듈 URL 과 사이드바 링크 잔존, 에이전트 카드
  중지·재개, core 화면의 설정 손상 상태. 기록은 `docs/baseline/sp3a-ui.md` 의 `# Phase B(과제 28)` 절.
- **성능 통과** — 관문이 붙은 셸의 p95 가 기준선 대비 +20% 이내(가장 높은 비율 1.12). 기록은
  `docs/baseline/sp3a-perf.md`. 조건부 최적화(과제 27 Step 6)는 측정값이 기준 안이라 실행하지 않았다.
- `test:rls` 26 파일 · 282 케이스(건너뜀 0), `settings:verify` 문제 0건, `typecheck`·`lint`(0 error)·`vitest`(651 파일 · 8543 — 최종 리뷰 때 실측값으로 고친 것, 중간값 650/8513 은 수정 라운드 전 스냅샷)·`build` 초록.
- **롤백 리허설 R 은 돌지 않았다** — Phase B 에 마이그레이션이 없다(P18). `git log --oneline main..HEAD -- supabase` 가 비어 있음을 확인했다.

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres 17.6.1.075(Docker/colima) · 마이그레이션 `0000`~`0012` |
| 스택 이름 | **`d-flow-sp3a-e2e`**(api 54421 · db 54422) — 전용 스택을 하나 더 띄웠다. 근거는 4절 ⑤ |
| 앱 | Next.js 15.5.19 `next dev -p 3101` · Node 22.18.0 |
| 앱 위치 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp3a-b-26`(detached `178a4ba`, node_modules 는 메인 체크아웃으로 심볼릭 링크, `.env.local` 복사 후 `NEXT_PUBLIC_SUPABASE_URL` 만 54421 로 바꿈). 러너는 cwd = 그 워크트리(서버 액션 id 를 그 워크트리의 `.next` 매니페스트에서 찾는다). 사용자의 :3000 은 건드리지 않음. 성능 측정 뒤 `git worktree remove --force` |
| dev 서버 env | 명령줄로만 `NEXT_PUBLIC_APP_URL=http://localhost:3101 INVITE_ALLOWED_DOMAINS=example.com MINUTES_API_SECRET=<생성값> CRON_SECRET=<생성값>`. 모듈 플래그 8개는 `npm run env:local` 가 워크트리 `.env.local` 에 써 준다(과제 5) |
| 계정 | 부트스트랩 `admin@example.com`(플랫폼 관리자, 워크스페이스 A=`default` 관리자, 허용 모듈 13개 rev 1). 부트스트랩·B 관리자(`E2E_B_PASSWORD`) 비밀번호와 API 시크릿은 `openssl rand` 로 만들어 한 셸의 변수로만 넘겼다(출력·파일·커밋 없음). ana·외부 계정·carol 비밀번호는 러너가 실행마다 만든다 |
| 산출물 | `/Users/jerry/D-Flow-wt/e2e-out-b`(커밋 안 함) |

## 2. 순서와 명령

```bash
# 전용 스택은 워크트리의 supabase/config.toml 을 project_id="d-flow-sp3a-e2e" · 54421/54422 로 바꿔 띄웠다(커밋 안 함)
colima start --cpu 4 --memory 6 --disk 60
npm run db:start                                              # supabase_db_d-flow-sp3a-e2e healthy
( cd "$WT" && npm run db:reset )                              # 0000~0012, max(version)=0012
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="$BP" npm run dev:bootstrap    # ✓ 허용 모듈 13개 (revision 1)
npm run settings:verify                                       # exit 0 — 1 passed
npm run test:rls                                              # 26 파일 · 282 통과, 건너뜀 0
npm run db:reset && BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="$BP" npm run dev:bootstrap   # RLS 픽스처를 지우고 E2E 용 깨끗한 DB
( cd "$WT" && npm run build )                                 # Compiled successfully
( cd "$WT" && <env> nohup npm run dev -- -p 3101 > "$WT/dev.log" 2>&1 & )          # /login 200
( cd "$WT" && BOOTSTRAP_PASSWORD="$BP" E2E_B_PASSWORD="$(openssl rand -base64 24)" MINUTES_API_SECRET="$MS" CRON_SECRET="$CS" \
    E2E_OUT_DIR=/Users/jerry/D-Flow-wt/e2e-out-b node scripts/e2e-local.mjs > …/e2e.json )   # exit 0
# 눈확인(과제 28 Step 5) — 같은 3101 dev 서버 위, 헤드리스 Chromium
node /Users/jerry/D-Flow-wt/.eye28/eye.mjs                    # pass 22 / fail 0
# 성능(과제 27) — 기준선 h2-done(00bfe8c) 을 3102, 후보를 3101. 한 스택을 0011 ↔ 0012 로 오간다
( cd "$WT0" && supabase db reset --version 0011 && BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="$BP" npm run dev:bootstrap && npm run build )
node scripts/perf-baseline.mjs measure --base http://localhost:3102 --label h2-done-run1 --n 30   # ×3
```

E2E 실행 2026-09-30 09:02:36~09:05:54 KST(3분 18초), 눈확인 09:50~09:53 KST. 첫 실행은 서브에이전트 리뷰와
dev 서버 워밍업이 겹쳐 한 차례 타임아웃으로 잘렸고(캡처는 `render-pages` 직후까지), 두 번째 실행은 1분 만에 끝났다.

## 3. E2E 단계표

28단계 전부 `ok: true`, exit 0. **굵은 이름**이 Phase B 에서 새로 넣은 단계다. 워크스페이스 A = `default`,
B = `e2e-other`. 프로젝트 A·B·A-copy·A2 는 워크스페이스 A, C 는 B. `<A>`=`482539e8-…`·`<B>`=`28f43d04-…`·`<C>`=`ede3843f-…`
(뒤의 `db:reset` 으로 사라지는 로컬 id).

| # | 단계 | 판정 |
|---|---|---|
| 1 | login | 부트스트랩 계정의 워크스페이스 소속 A 관리자 1건, 쿠키 `sb-127-auth-token` |
| 2 | create-projects | `createProject(input)`(create_project_with_settings 한 트랜잭션). A·B, `modules.enabled` 9개 |
| 3 | settings-update | revision 2, 같은 명령 재전송 `duplicate`, 이력 1행 |
| 4 | create-copy | A 를 원본으로 복사 → 이력 키 `copy/copied_from`, 단계 라벨 `["국면","과업","세부"]` |
| 5 | project-teams | 워크스페이스 A 3팀, B 1팀 |
| 6 | roster | 명단 3행(본인@A 관리자·다중 팀, 외부 인력 bob@A, 본인@B 멤버) |
| 7 | fill-template | WBS 양식 5행 채움(팀 `ERP`) |
| 8 | import-inspect | 계층 `outline`(col 0), 팀 열 `[(8,"*")]`, 경고 0 |
| 9 | import-append | `{ ok: true, count: 5, mode: "append", reindexed: 0, profileSaved: true }` |
| 10 | import-replace | 5행 · `item_owners` ERP 배정 2건(리프 `1.1.1`·`1.2.1`) |
| 11 | assign-external | `1.1.1` 담당 = 외부 인력 bob, `item_owners` 1행 |
| 12 | meeting | 회의 1건, 참석 1명(bob) |
| 13 | export | 산출물 3개(PPT·XLSX·WBS XLSX) |
| 14 | trace-scan | 135항목 스캔 · **원 고객사 흔적 적중 0** |
| 15 | invite-issue | 초대 1행(`carol@example.com`, `member`, 팀 `ERP`, 상태 `active`, 초대 URL origin `http://localhost:3101`) — 메일 발송은 미설정이라 발송 없음 |
| 16 | invite-redeem | carol 가입+합류 → 명단 3행, 워크스페이스 소속 A 하나 |
| 17 | other-workspace-fixture | 워크스페이스 B(`e2e-other`) + 프로젝트 `<C>` + 관리자 bea — 행만 service_role |
| 18 | visibility | carol: A 200(명단)·B 200(조회 전용, `createMeeting` → `권한 없음`)·`<C>` notFound digest·미존재 id notFound digest / admin: `<C>` 200 |
| 19 | workspace-admin-project | 워크스페이스 A 관리자 ana(슈퍼유저 아님)가 `createProject` 로 프로젝트 `E2E A2` 생성(0c94c0e9-…) |
| 20 | outsider-invite | 워크스페이스 밖 이메일 초대 1행(거부 경로) |
| 21 | minutes-upload | 프로젝트 지정·미지정 각 1건, Storage 키 `ws/<A>/p/<pid>/…`·`ws/<A>/p/_/…`, 행 2 |
| 22 | workspace-b-isolation | bea: A 제목 0·A 프로젝트명 0 / ana: A 제목 2 |
| 23 | minutes-api-scope | 미등록 사용자 403 `unknown_user`, bea 의 A2 회의 404 `Not Found` |
| 24 | render-pages | 10화면 렌더, 오류 표식 0. `/p/<A>/issues` 198183 bytes 등 |
| **25** | **module-issues-off** | **`GET /p/<A>/issues` → `page.status` 200 + `notFoundRendered` true(로딩 경계), `issueInHtml` false · `createIssue` → `{ ok: false, error: '이 기능은 지금 사용할 수 없습니다.' }` · `GET /api/issue-analysis?projectId=<A>` → 404 + 같은 문구 + `issueInBody` false. 끄기 전 대조: `modules.enabled` 8개에 `issues` 포함, 시드한 고유 제목이 화면에 있었다** |
| **26** | **module-agents-off** | **`meBefore` true(켜진 대조) → `modules.enabled` 에서 `agents` 만 뺀 상태에서 `rowAfterModuleOff` true(행은 켜진 채 모듈만 꺼짐)·`meAfterModuleOff` false(목록에서 빠짐)·`GET /api/v1/wbs/structure?project_id=<A>` → 404 `Not Found` · 옛 토글 재개 → `meAfterToggleOn` true + `modules.enabled` 에 `agents` 복귀 · 옛 토글 중지 → `rowAfterToggleOff` false + `modules.enabled` 에서 빠짐 + `meAfterToggleOff` false** |
| **27** | **module-minutes-integration-off** | **워크스페이스 A 의 `modules.allowed` 에서 `minutes_integration` 해제(`allowedBefore` true) → `meta`·목록 모두 `{ error: '이 워크스페이스에서 회의록 연동이 꺼져 있습니다.', code: 'module_disabled' }` · 업로드 `POST` → **409** + 같은 `code` · `createdRows` 0(부분 이동 없음) · `beaStillOpen` `[<C>]` — 워크스페이스 B 는 여전히 연다** |
| **28** | **module-index-skip** | **`<A>` 의 `chatbot` 해제 후 `modules.enabled` = `[kanban, meetings, weekly, announcements, attendance, wiki]` · service_role 로 넣은 대기 잡 1건을 `CRON_SECRET` 색인 크론이 선점(`claimed` 1) → 잡이 `status: 'skipped'` · `last_error: 'module_disabled'`** |

## 4. 비고

① **스펙 R15** — 여러 워크스페이스에 속한 사용자는 SP3b 까지 전역 화면 다섯(`/meetings`·`/minutes`·`agents`·`/portfolio`·`/usage`)과
프로젝트 없는 챗·트래커가 닫힌다(판정 P13 — `resolveSoleWorkspaceId` fail-closed). 로컬의 다중 소속 계정은 픽스처뿐이라
E2E 로는 재지 않는다 — **SP3b 인수 목록**이다.

② **스펙 §2.1** — Phase B 뒤 SP3b UI-2 까지 사이드바는 꺼진 모듈의 링크를 **계속 보이고** 그 링크는 404 다(메뉴 소비가 SP3b).
눈확인 B-2 가 이걸 눈으로 봤다(아래 ③ 참고).

③ **3단계 판정과 스펙 §7.3 문언의 차이** — 페이지 404 는 로딩 경계 때문에 스트리밍 뒤 **200 + notFound 화면**으로 나올 수 있어
`notFoundRendered` 로 판정했다(실측 상태 코드 `page.status` = 200 을 함께 적었다). 이슈 분석 API 는 `runId` 가 필수라
(없으면 가드 앞 400) `runId` 를 붙여 불렀다.

④ **계정 구성** — E2E 는 부트스트랩 관리자 1 + 러너가 실행마다 만드는 계정(ana·외부·carol) + B 관리자 bea.
눈확인은 부트스트랩 관리자 하나(Phase B 화면은 모듈만 본다 — 등급별 화면 차이가 없다) + 성능은
`admin`(슈퍼유저)·`bob@example.com`(일반 멤버) 두 페르소나. 임시 플랫폼 관리자 계정은 쓰지 않았다(판정 P30).

⑤ **전용 스택을 하나 더 띄운 이유(계획 편차)** — 계획은 "로컬 스택은 하나다 — `db:reset`·`test:rls`·E2E·성능·눈확인을 동시에
돌리지 않는다"를 전제로 `npm run db:reset` 을 메인 체크아웃에서 돌리게 한다. 그런데 이 시점에 메인 스택(`d-flow`, 54321)에는
**실제 개발 데이터 8계정·3워크스페이스·4프로젝트가 있었다**(사용자의 :3000 dev 서버가 쓰는 곳). 이를 지우지 않기 위해
`supabase/config.toml` 을 **워크트리 안에서만** `project_id = "d-flow-sp3a-e2e"` · api 54421 · db 54422 로 바꿔 스택을 하나 더 띄우고
그 위에서만 리허설했다(커밋되지 않았다 — 1절에도 적었다). 성능 측정의 `scripts/lib/targets.mjs` `LOCAL_DSN` 도 54422 로 바꿔
시드가 같은 DB 를 보게 했다. 이 편차는 **측정 하네스와 로컬 환경에만** 있고 커밋된 코드에는 없다. 사용자에게는
"메인 스택은 그대로였고, `:3000` 은 재부트스트랩이 필요 없다"는 뜻이다(계획이 예고한 사용자 조치 ① 이 발생하지 않았다).

## 5. 게이트 결과

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입 | `npm run typecheck` | 0 error |
| 린트 | `npm run lint` | 0 error, warning 4(기존 — `tests/ai/index-lexical`·`tests/ai/tools-members` 미사용 변수) |
| 단위 | `npx vitest run --reporter=dot --maxWorkers=4` | **651 파일 · 8543 테스트 통과**(최종 리뷰 때 실측. 수정 라운드 전 스냅샷은 650/8513) |
| 빌드 | `npm run build`(스크래치 워크트리 `sp3a-b-26`, `178a4ba`) | Compiled successfully · 정적 페이지 19/19 |
| DB | `npm run db:reset`(전용 스택) | 0000~0012 적용, `max(version)` = 0012. 성능 기준선은 `--version 0011` |
| 설정 | `npm run settings:verify` | exit 0 — 1 passed(부트스트랩 직후) |
| RLS | `npm run test:rls` | 26 파일 · 282 통과, 건너뜀 0 |
| E2E | 3절 | **exit 0 · 28/28 ✓** |
| 눈확인 | `docs/baseline/sp3a-ui.md` Phase B 절 | B-1~B-4 · 22 항목 전부 통과 |
| 성능 | `docs/baseline/sp3a-perf.md` | p95 비율 최대 **1.12**(admin 대시보드) — 기준 +20% 이내, 조건부 최적화 미실행 |
| 열거 게이트 | `tests/gates` (리뷰 B7·B8·B9 참조) | 액션 174 · 라우트 핸들러 44 · 스텁 74 · 가드 등급 null 59 양방향 대조 |
| 마이그레이션 | `git log --oneline main..HEAD -- supabase` | **비어 있음** — Phase B 는 마이그레이션이 없다(P18). 롤백 리허설 대상 없음 |

main 반영 뒤 컨트롤러가 채울 두 줄:

- main 커밋의 스크래치 워크트리 빌드: (컨트롤러)
- push 뒤 GitHub Actions run: (컨트롤러)

## 6. 남아 있는 한계 — `docs/baseline/sp3a-b-known-limits.md`

체크포인트 시점에 남은 것은 위키 재구성 잡의 파괴적 선점(운영자가 알아야 함)·`agents` 허용 백필 공백·
열거 게이트의 축 한계 넷·스펙 귀결 둘이다. 원래 SDD 원장에만 적혀 있었고 **그 원장은 브랜치에 따라가지
않으므로** 머지한 사람이 볼 수 없었다 — 최종 리뷰가 지적해 `docs/baseline/sp3a-b-known-limits.md` 로
옮겼다. 머지 전에 그 파일을 읽는 사람이 있어야 한다.


# Phase C — 체크포인트

스펙 §7.3 의 **7단계**(워크스페이스 설정 화면의 경계)를 `scripts/e2e-local.mjs` 에 더해 로컬에서 잰 기록이다. 트리는 `ui/sp3a-settings`
(측정일 2026-10-01, 시각은 KST). 눈확인은 `docs/baseline/sp3a-ui.md` 의 Phase C 절, 남은 한계는 `docs/baseline/sp3a-c-known-limits.md`.

**요약**

- 깨끗한 DB(`db:reset` 0000~0012 → `dev:bootstrap`) 위에서 E2E **exit 0, 29단계 전부 ✓** — Phase B 의 28단계 + 새 `workspace-settings-boundary`.
  산출물 흔적 검사(`trace-scan`)·`render-pages` 오류 0 은 그대로다.
- 전용 스택 `d-flow-sp3a-c-visual`(api 54521 · db 54522) 위에서만 돌렸다 — 메인 스택(사용자 데이터)은 이번에도 건드리지 않았다.
- `settings:verify` exit 0 · `test:rls` 26 파일 · 282 통과(건너뜀 0) · `build` 초록 · `typecheck` 0 · `lint` 0 error(경고 4 — 기존) ·
  `vitest` **675 파일 · 8663 통과**.
- 마이그레이션이 없다 — `git log --oneline main..HEAD -- supabase` 가 비어 있다. 롤백 리허설 대상 없음.

## 새 단계

| # | 단계 | 판정값 |
|---|---|---|
| 7 | `workspace-settings-boundary` | ana(워크스페이스 A 관리자, 플랫폼 관리자 아님)가 `/w/e2e-other/settings`(B)를 열면 notFound digest(HTTP 200 — 스트리밍), 응답에 B 이름 없음 · ana 의 `/w/default/settings` 는 열리고 문제 0, **모듈 허용 구역 없음** · bea(B 관리자)의 `/w/default/settings` 는 notFound, A 이름 없음 · 플랫폼 관리자 admin 의 `/w/e2e-other/settings` 는 열리고 **모듈 허용 구역 있음**(은닉이 부재가 아니라는 대조) |

구역 유무는 키 이름이 아니라 `ModuleAllowEditor` 전용 문구로 판정한다 — `modules.allowed` 는 '기록' 범주의 변경 이력에도 나온다(첫 실행이 이 때문에 ✗ 였다).

## 기존 단계의 변경

- `module-agents-off`: 옛 토글(`setAgentProjectEnabled`)이 Phase C 에서 지워졌다. 켜기·끄기는 `modules.enabled` 의 `agents` 저장 한 길이다.
  기본 모듈 목록에 `agents` 가 이미 있어 같은 값을 저장하면 '새로 켬'이 아니라서 `agent_projects` 등록 행이 만들어지지 않는다 — **끈 뒤 켜는** 경로로 고쳤다.
  끄기는 등록 행을 건드리지 않으므로 `rowAfterToggleOff` 기대값이 `false` → `true` 다(두 원천 AND 라 `meAfterToggleOff` 는 여전히 false).
  이 간극(켜짐으로 보이지만 등록 안 됨)은 `sp3a-c-known-limits.md` 에 운영 한계로 적었다.

## 실행 메모

- 서버는 `next dev -p 3101`(`--max-old-space-size=4096`)이다. `next start` 는 팀 캐시 TTL 때문에 임포트 단계가 409 라 쓸 수 없다.
- 작은 머신에서 dev 서버가 메모리 감시로 재시작해(`Server is approaching the used memory threshold`) 두 번 실패했다 — 한 번은 요청 끊김, 한 번은 서버 액션
  매니페스트가 빔. 스크립트가 매니페스트를 다시 읽기 전에 그 페이지를 GET 해 복구하도록 고쳤다(`action()`). 마지막 실행에서도 재시작이 1회 있었지만 단계가 통과했다.
- 명령은 Phase B 와 같다(`LOCAL_DB_URL` 로 전용 스택 지정, 공유 잠금 `heavy-lock.sh` 아래). 비밀번호·시크릿은 `openssl rand` 로 만든 셸 변수·스크래치 파일(mode 600)에만 두었고 커밋·출력하지 않았다.


# Phase D — 체크포인트

스펙 §6(권한 변경 이력의 서버 배선·읽기 화면)과 §7.3 의 **8단계**를 잰 기록이다. 트리는 `sp3a/phase-d`(측정일 2026-10-01, 시각은 KST). 이 Phase 는
**마이그레이션이 없다**(DB 객체와 그 DB 테스트는 Phase A — `0012` 의 10번 절, `tests/rls/authz-events.test.ts`).

**요약**

- 깨끗한 DB 위에서 E2E **exit 0, 30단계 전부 ✓** — Phase C 의 29단계 + 새 `authz-events`. 전용 스택 `d-flow-sp3a-c-visual`(api 54521 · db 54522)에서만 돌렸다.
- `settings:verify` exit 0 · `test:rls` 26 파일 · 282 통과(건너뜀 0) · `build` 초록 · `typecheck` 0 · `lint` 0 error(경고 4 — 기존) · `vitest` **679 파일 · 8698 통과**.
- `git log --oneline main..HEAD -- supabase` 비어 있음 — 롤백 리허설 대상 없음.

## 새 단계

| # | 단계 | 판정값 |
|---|---|---|
| 8 | `authz-events` | 플랫폼 관리자가 화면과 같은 서버 액션 `setWorkspaceRole` 로 ana 를 멤버로 내렸다가 관리자로 되돌린다. DB 에서 `authz_events` 두 행: 최신 `{role: member} → {role: admin}`, 그 앞 `{role: admin} → {role: member}`, 둘 다 `cause = direct` · 행위자 = 그 플랫폼 관리자 · `command_id` 있음(서로 다름). 화면의 읽기 `listAuthzEvents` 가 같은 두 행을 요약('멤버 → 관리자'·'관리자 → 멤버')과 행위자·대상 이름과 함께 돌려준다 |

## 배선

- `setPlatformAdmin`·`setWorkspaceRole` 은 `platform_admins`·`workspace_members` 를 직접 쓰던 것을 `set_platform_admin`·`set_workspace_role` RPC 로, 명단 권한(계정 생성·명단 편집)은
  `upsert_project_member` 대신 `upsert_project_member_cmd` 로 바꿨다. 행위자는 가드의 actor, 명령 id 는 호출마다 새로 만든다(권한이 안 바뀐 호출은 이력 행을 남기지 않아 재전송은 멱등 쓰기).
- 계정 생성(`workspace_members` insert)과 초대 수락의 행위자는 여전히 null 이다(도장 값은 `after` 에 있다) — 스펙 §6 마지막 문단.
- 읽기는 `listAuthzEvents(workspaceId, { limit, before })` — 워크스페이스 관리자 가드 뒤 세션 클라이언트(RLS 가 한 번 더 좁힌다). 플랫폼 관리자 지정·해제 행(워크스페이스가 없다)은 플랫폼 관리자에게만 같은 목록에 싣는다.
  지워진 계정은 '삭제된 계정', 행위자 없음은 '시스템', 이름 조회 실패는 '이름 확인 불가', 이력 조회 실패는 빈 목록이 아니라 오류다.
- 설정 표 읽기 허용 목록에 `src/lib/authz/events.ts`(select 한 곳)를 올렸고, 열거 게이트 매니페스트에 `listAuthzEvents`(워크스페이스 관리자)를 올렸다.

## 실행 메모

Phase C 와 같다 — `next dev -p 3101`(`--max-old-space-size=4096`), 공유 잠금 아래, 비밀번호·시크릿은 셸 변수·스크래치 파일에만. 이번 실행에서 dev 서버 재시작은 없었다.
