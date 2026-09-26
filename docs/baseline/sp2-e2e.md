# SP2 E2E 실측 — Phase A 체크포인트 · Phase B 최종

플랜 `docs/superpowers/plans/2026-09-26-sp2-workspace-isolation.md` Task 5(Phase A)·Task 17(Phase B)를 로컬에서 잰 기록이다.
Phase A 트리는 `sp2/phase-a` 의 `2204bbc` 다(측정일 2026-09-26). Phase B 는 문서 뒤쪽 'Phase B' 절. 시각은 KST.

# Phase A — 체크포인트(Task 5)

**요약**

- 깨끗한 DB(`db:reset` → `dev:bootstrap`) 위에서 SP1 과 같은 흐름의 E2E 가 **exit 0** 이다. 17단계 전부 ✓
  (Phase A 는 흐름을 바꾸지 않는다 — 브리프대로 SP1 흐름 재확인).
- `test:rls` 4 파일 · 30 케이스 전부 PASS.
- `typecheck`·`lint`(0 error, 기존 warning 5건)·`vitest run`(509 파일 · 6285 테스트)·`build` 전부 초록.
- R3·R4 는 Task 2 의 판정(둘 다 분기 A)이 이 리허설에서도 그대로 유지된다 — 아래 4절.

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres(Docker `supabase_db_d-flow`) · 마이그레이션 `0000`~`0006` |
| 앱 | Next.js 15.5.19 `next dev` · Node 22.18.0 |
| dev 서버 env | 명령줄로만 `INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000`(`.env.local` 에 쓰지 않음) |
| 부트스트랩 | `admin@example.com`, 워크스페이스 `default`(기본값) |
| 산출물 | 세션 스크래치 폴더(커밋 안 함) |

## 2. 순서와 명령

브리프대로 `db:reset` → `dev:bootstrap` → dev 서버(백그라운드, PID 기록) → E2E → `test:rls` → `typecheck`/`lint`/`vitest`/`build` → dev 서버 종료(기록한 PID 로만).

```bash
npm run db:reset                                                              # 11:19 — 0000~0006 적용, seed 완료
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' npm run dev:bootstrap   # 11:2x
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3000 nohup npm run dev &    # PID 53691(next dev)
# /login 등에서 200 확인 후
BOOTSTRAP_PASSWORD='<BOOTSTRAP_PASSWORD>' node scripts/e2e-local.mjs > e2e.json     # exit 0
npm run test:rls                                                              # 4 파일 · 30 통과
npm run typecheck                                                            # 무출력, 통과
npm run lint                                                                 # 0 error, warning 5건(기존 테스트 파일의 미사용 변수)
npx vitest run --reporter=dot                                                # 509 파일 · 6285 통과
npm run build                                                                # Compiled successfully, 19/19 정적 페이지 생성
kill 53691                                                                   # dev 서버 종료 확인
```

## 3. E2E 단계표

17단계 전부 `ok: true`, exit 0. SP1 러너(`scripts/e2e-local.mjs`) 그대로 — Phase A 는 흐름을 바꾸지 않는다.

| 단계 | rows |
|---|---|
| login | – |
| create-projects | 2 |
| project-teams | 3 |
| roster | 3 |
| fill-template | 5 |
| import-inspect | – |
| import-append | – |
| import-replace | – |
| assign-external | 1 |
| meeting | – |
| export | – |
| trace-scan | – |
| invite-issue | 1 |
| invite-redeem | 3 |
| other-workspace-fixture | – |
| visibility | – |
| render-pages | – |

## 4. R3·R4 판정

Task 2(`f8af5ec`/`8936df7`/`2204bbc` 계열)에서 이미 확정된 분기가 이번 Phase A 체크포인트의 `test:rls`·E2E 에서도 그대로 유지됨을 확인했다.

**R3: A** — `revoke execute on function public.project_ws(uuid) from authenticated;`(`supabase/migrations/0006_workspace_isolation.sql:715`)가 유지된 상태에서 `npm run test:rls` 30 케이스 전부 PASS, `permission denied for function project_ws`(42501) 는 0건이었다.

**R4: A** — non-deferrable NO ACTION FK 6개(명단 등)를 되돌리지 않은 상태로, E2E `create-projects`/`import-append`/`import-replace`/`assign-external` 등 프로젝트 생성·명단·WBS 흐름이 전부 통과했고 `test:rls` 의 프로젝트 삭제 캐스케이드 핀 케이스도 PASS 다. 별도 deferrable 재작성은 필요하지 않았다.

## 5. 게이트 결과 한 줄 요약

E2E 17/17 ✓(exit 0) · test:rls 4 파일/30 케이스 PASS · typecheck 무오류 · lint 0 error(warning 5, 기존) · vitest 509 파일/6285 테스트 PASS · build 성공(19/19 정적 페이지) · dev 서버(PID 53691) 정상 종료.

---

# Phase B — 2-워크스페이스 E2E·최종 게이트(Task 17)

측정일 2026-09-26, 시각은 KST. 러너·헬퍼·테스트는 `31878b1`(`e2e(sp2): 2-워크스페이스 …`), 앱 코드는 그 부모 `23c1ab7` 와 같다
(Task 17 은 앱 코드를 바꾸지 않는다).

**요약**

- 깨끗한 DB(`db:reset` 0000~0008 → `dev:bootstrap`) 위에서 E2E **exit 0, 22단계 전부 ✓**. SP2 새 단계 6개(워크스페이스 B 픽스처 확장 포함)가
  전부 통과했다 — 초대받은 외부 계정의 워크스페이스 소속은 A 하나, B 관리자에게 A 프로젝트 URL 은 not-found.
- `test:rls` 6 파일 · 54 케이스, 불변식·가드 시그니처 9 파일 · 30, `vitest` 542 파일 · 6694, `typecheck`·`lint`(0 error)·`build` 초록.
- 롤백 3개(0008·0007·0006) 카탈로그 대조 **세 번 모두 불일치 0**.
- 성능: 대시보드·WBS p95 비(sp2-final ÷ sp1-done) 최대 **1.09**(2회 중앙값) — 게이트 ≤ 1.20 통과. 상세는 `docs/baseline/sp2-perf.md`.
- 브라우저 눈확인은 컨트롤러가 따로 한다(아래 3절 자리).

## 1. 환경

| 항목 | 값 |
|---|---|
| 로컬 스택 | Supabase CLI 2.75.0 · Postgres(Docker/colima `supabase_db_d-flow`) · 마이그레이션 `0000`~`0008` |
| 앱 | Next.js 15.5.19 `next dev -p 3170` · Node 22.18.0 |
| 앱 위치 | 세션 스크래치의 detached `git worktree`(node_modules 는 메인 체크아웃으로 심볼릭 링크 — lockfile 동일). 이유: :3000 에 사용자의 `next dev` 가 메인 체크아웃의 `.next` 로 돌고 있어, 같은 디렉터리에서 두 번째 dev 서버나 `next build` 를 돌리면 그 `.next` 를 덮는다. 러너는 메인 경로의 스크립트를 워크트리를 cwd 로 실행했다(매니페스트·`.env.local` 을 워크트리에서 읽게) |
| dev 서버 env | 명령줄로만 `INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3170 MINUTES_API_ENABLED=true MINUTES_API_SECRET=<생성값>` |
| 계정 | 부트스트랩 `admin@example.com`(플랫폼 관리자, 워크스페이스 A=`default` 관리자) — 비밀번호·B 관리자 비밀번호(`E2E_B_PASSWORD`)·API 시크릿은 실행 때 `openssl rand` 로 만들어 env 로만 넘겼다(출력·커밋 없음). ana·외부 계정·carol 비밀번호는 러너가 실행마다 만든다 |
| 산출물 | 세션 스크래치(커밋 안 함) |

## 2. 순서와 명령

```bash
npm run db:reset                                                         # 21:22:50 — 0000~0008, seed
BOOTSTRAP_EMAIL=admin@example.com BOOTSTRAP_PASSWORD="<생성값>" npm run dev:bootstrap
# 워크트리에서(백그라운드, PID 기록 — npm 66280 · next 66328 · next-server 66369)
INVITE_ALLOWED_DOMAINS=example.com NEXT_PUBLIC_APP_URL=http://localhost:3170 \
  MINUTES_API_ENABLED=true MINUTES_API_SECRET="<생성값>" npm run dev -- -p 3170
# 워크트리를 cwd 로
BOOTSTRAP_PASSWORD="<생성값>" E2E_B_PASSWORD="<생성값>" MINUTES_API_SECRET="<같은 값>" \
  E2E_BASE_URL=http://localhost:3170 node <리포>/scripts/e2e-local.mjs > e2e.json   # 21:23:36 → 21:35:24, exit 0
kill 66369 66328 66280                                                   # 기록한 PID 로만, :3170 비었음 확인
```

render-pages 단계가 11분 걸린 것은 dev 서버의 첫 컴파일이 메모리 압박(스왑 7 GB) 속에서 느렸기 때문이다(`announcements` 112초,
`weekly` 205초 컴파일) — 판정에는 영향이 없다.

## 3. 브라우저 눈확인

| 항목 | 기록 |
|---|---|
| 브라우저 눈확인 | 컨트롤러가 별도 기록 |

## 4. E2E 단계표

22단계 전부 `ok: true`, exit 0. 1~11·13·19 는 SP1 흐름(Phase A 와 같은 러너)이고, **굵은 이름**이 SP2 에서 새로 넣거나 바꾼 단계다.
워크스페이스 A = 부트스트랩 워크스페이스(`default`), B = `e2e-other`. 프로젝트 A·B·A2 는 워크스페이스 A, C 는 워크스페이스 B.

| # | 단계 | 판정 |
|---|---|---|
| 1 | **login** | 부트스트랩 계정의 워크스페이스 소속이 A 관리자 1건 — 세션으로 확인해 이후 `createProject(A, …)` 의 대상으로 쓴다 |
| 2 | **create-projects** | `createProject(workspaceId, …)` 새 시그니처. A·B 각 1건, 워크스페이스 = A, 단계 라벨 그대로 |
| 3–9 | project-teams · roster · fill-template · import-inspect · import-append · import-replace · assign-external | Phase A 와 같음(팀 3 · 명단 3 · WBS 5행 · 외부 인력 담당 1) |
| 10–12 | meeting · export · trace-scan | 같음(산출물 흔적 적중 0) |
| 13–14 | invite-issue · invite-redeem | 같음(carol 멤버·A 첫 팀) |
| 15 | **other-workspace-fixture** | 워크스페이스 B 행만 service_role. 그 안의 **C 는 `createProject(B, …)`**, **B 관리자 bea(`e2e-bea@example.com`)는 `createAccount({ workspaceId: B, workspaceRole: 'admin' })`** — 플랫폼 관리자 호출. bea 소속 = B 관리자 1건, 플랫폼 관리자 아님 |
| 16 | **visibility** | carol: A·B 열림(B 는 조회 전용 — 회의 생성 `권한 없음`, B 회의 0건), C·미존재 id not-found(digest). **은닉된 C 화면에 C 이름 없음** — SP1 은 기록만 했고 이제 실패 조건. 플랫폼 관리자는 C 를 본다(대조) |
| 17 | **workspace-admin-project** | 부트스트랩 계정이 `createAccount({ workspaceId: A })` 로 A 관리자 ana(`e2e-ana@example.com`, 플랫폼 관리자 아님)를 만들고, **ana 가 `createProject(A, …)` 로 E2E A2** 생성 — 워크스페이스 관리 가드를 플랫폼 관리자 우회 없이 통과 |
| 18 | **outsider-invite** | ana 가 A2 에 `e2e-outsider@example.com` 멤버 초대(팀 없음) → 새 세션 가입·합류 → **outsider 의 `workspace_members` = [A, member] 1건**(service_role 확인), 플랫폼 관리자 아님. outsider 에게 A2 열림, C not-found·이름 없음 |
| 19 | **minutes-upload** | 플랫폼 관리자가 `addTeam(A, 'OPS')`(공용 팀 — 무프로젝트 회의록의 담당). ana 가 화면과 같은 순서(회의록 id 선발급 → 세션으로 Storage 업로드 → `createMinute(입력, null, source)`)로 2건: 프로젝트 A(담당 ERP) → `ws/<A>/p/<A 프로젝트>/minutes/<id>/e2e-project.md`, 미지정(담당 OPS) → `ws/<A>/p/_/minutes/<id>/e2e-noproject.md`. `minutes` 행의 워크스페이스·프로젝트·담당, `minute_files` 경로, Storage 객체 목록이 서로 같다. `minutes` 버킷 최상위는 `ws` 하나 |
| 20 | **workspace-b-isolation** | bea: `/p/<A2>/wbs`·`/p/<A>/dashboard` not-found(digest), 이름 없음. 자기 C 는 열림. bea 의 `/minutes`·`/projects` HTML 에 A 회의록 제목 0·A 프로젝트 이름 0(대조: ana 의 `/minutes` 에는 두 제목 모두). bea 의 A 경로 Storage 업로드 → `new row violates row-level security policy`, A 본문 파일 다운로드 → `Object not found`, 거부된 업로드 자리에 객체 0 |
| 21 | **minutes-api-scope** | 시크릿 + `user_email`: meta 의 projects — ana 3(A·B·A2, C 없음, 팀 OPS), outsider 3(C 없음), bea 1(C 만, 팀 없음 — A 공용 팀 OPS 안 실림), 플랫폼 관리자 4(대조). 목록 `GET /api/v1/minutes` — ana 는 A 회의록 2건, bea 0. 모르는 이메일 → 403 `unknown_user`, bea 의 `meta?project_id=<A2>` → 404 |
| 22 | **render-pages** | 관리자 세션 10화면: `/projects`, A 의 `dashboard`·`members`·`meetings`·`issues`·`announcements`·`weekly`·`wbs`·`attendance`, `/minutes`(두 회의록 제목) — 스트리밍 오류 digest·notFound·열화 표식 0. (대시보드·공지·주간보고·회의록 목록은 SP2 에서 추가) |

**브리프와 다르게 한 것**

- "A 관리자" 행위(A2 생성·초대·업로드·meta)는 부트스트랩 계정이 아니라 플랫폼 관리자가 아닌 A 워크스페이스 관리자 ana 로 했다. 부트스트랩
  계정은 플랫폼 관리자라 `requireWorkspaceAdmin` 이 워크스페이스와 무관하게 통과하고, 외부 API meta 도 전 워크스페이스(C 포함)를 돌려준다 —
  브리프대로 그 계정의 meta 에서 "B 프로젝트가 없다"를 단언하면 실패한다(설계상 플랫폼 관리자는 전부 본다). 부트스트랩 계정은 대조군으로만 쓴다.
- B 관리자·C 는 service_role 로 행을 넣지 않고 플랫폼 관리자의 `createAccount`·`createProject` 로 만들었다(워크스페이스 행만 service_role).
- `/p/<A 프로젝트 id>` 루트에는 페이지가 없어(항상 404) 대시보드(`/p/<A>/dashboard`)로 봤다.
- `/minutes` 판정은 bea 확인 전에 A 회의록이 있어야 의미가 있어 업로드(브리프 4)를 bea 확인(브리프 3) 앞에 두었다.
- `E2E_B_PASSWORD` 에 기본값을 두지 않는다(없거나 8자 미만이면 러너가 멈춘다).

## 5. R6 판정(presence private 채널)

**R6 = 분기 (a) 정책 보완 — 통과**(Task 9, 2026-09-26 12:2x~12:31). 실 Realtime 서버에서 private 채널 join 이 presence 정책만으로는
`CHANNEL_ERROR`(Unauthorized)였다 — join 에 `extension = 'broadcast'` SELECT 권한이 필요하다. 0007 에 `join_project_presence`
(`extension = 'broadcast' and presence_topic_project(realtime.topic()) is not null and can_read_project(…)`, presence 두 정책과 같은 술어)를
넣은 뒤, Node 3-클라이언트 스크립트로 wbs·weekly 두 토픽 모두: 같은 워크스페이스 두 세션이 서로 보이고, 이탈하면 사라지고, 타 워크스페이스
세션은 `CHANNEL_ERROR` 로 presence 0건. `test:rls` ⑦b·⑦c 가 이 정책을 고정한다(이번 54 케이스에 포함). 두 세션 아바타의 브라우저
재확인은 3절(컨트롤러).

Task 9 에서 넘어온 작은 항목(이번 태스크 범위 밖, 기록만): 훅 4곳의 `realtime.setAuth()` Promise 미대기, 토픽 변경 테스트 없음,
weekly presence 무세션 케이스 없음.

## 6. 롤백 리허설 — 카탈로그 대조 3회

각 롤백을 적용한 DB 를 그 직전 번호까지만 적용한 DB 와 `supabase/rehearsal/compare-catalog.mjs` 로 맞댔다. CLI 2.75 의
`supabase db reset --version NNNN` 은 브리프대로 동작했다(`Resetting local database to version: NNNN` — 0000~NNNN 만 적용).

| 롤백 | 기준(직전 번호까지) | 롤백 뒤 | 결과 |
|---|---|---|---|
| `0008_workspace_settings_rollback.sql`(0000~0008 위) | `--version 0007` — 정책 139 · 함수 107 · 트리거 28 · RLS 표 72 · 덤프 14533줄 | 같은 수 | ✓ 불일치 0(버킷 3/3 · 발행 1/1 · 확장 같음 · 덤프 차이 0) — 21:36~21:37 |
| `0007_storage_realtime_rollback.sql`(`--version 0007` 위) | `--version 0006` — 정책 136 · 함수 100 · 트리거 28 · RLS 표 72 · 덤프 14375줄 | 같은 수 | ✓ 불일치 0 — 21:37~21:38 |
| `0006_workspace_isolation_rollback.sql`(`--version 0006` 위) | `--version 0005` — 정책 136 · 함수 98 · 트리거 24 · RLS 표 72 · 덤프 14119줄 | 같은 수 | ✓ 불일치 0 — 21:39~21:40 |

끝에 `npm run db:reset` 으로 0000~0008 을 되돌려 놓았다.

## 7. 최종 게이트

| 게이트 | 명령 | 결과 |
|---|---|---|
| 타입 | `npm run typecheck` | 0 error |
| 린트 | `npm run lint` | 0 error, warning 5(기존 — `tests/actions/*`·`tests/ai/*` 미사용 변수) |
| 단위 | `npx vitest run --reporter=dot` | 542 파일 · 6694 테스트 통과 |
| 빌드 | `npm run build`(스크래치 워크트리, `31878b1`) | Compiled successfully · 정적 페이지 19/19 |
| RLS | `npm run db:reset && npm run test:rls` | 6 파일 · 54 테스트 통과 |
| 불변식 | `npx vitest run tests/invariants tests/authz/guard-signatures.test.ts` | 9 파일 · 30 테스트 통과 |
| E2E | 2절 | exit 0 · 22/22 ✓ |
| 롤백 | 6절 | 세 번 모두 불일치 0 |
| 성능 | `docs/baseline/sp2-perf.md` sp2-final 절 | p95 비 최대 1.09(2회 중앙값) ≤ 1.20 |

## 8. 사고 기록 — 디스크 가득 참(17:18)

첫 시도 중 성능 측정용 워크트리 둘(각 node_modules + 빌드)이 호스트 디스크를 채웠다(ENOSPC). colima VM 의 Docker 데이터 디스크(ext4
`vdb1`)가 쓰기 실패로 저널을 중단하고 읽기 전용으로 다시 붙었다(`Remounting filesystem read-only`) — Supabase 컨테이너가 쓰지 못하는
상태였다. 컨트롤러가 워크트리를 치웠고, colima 가 다시 뜬 뒤(21:21~21:22, 쓰기 가능 확인) 위 결과를 **처음부터 다시** 쟀다(깨끗한 `db:reset` 부터).
이 절의 모든 수치는 복구 뒤의 것이다. 재발 방지로 이후에는 워크트리를 하나만 두고 node_modules 를 링크했다.
