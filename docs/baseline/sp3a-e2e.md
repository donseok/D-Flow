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
