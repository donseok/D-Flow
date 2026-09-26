# SP2 E2E 실측 — Phase A 체크포인트

플랜 `docs/superpowers/plans/2026-09-26-sp2-workspace-isolation.md` Task 5 를 로컬에서 잰 기록이다.
트리는 `sp2/phase-a` 의 `2204bbc`(이 커밋의 부모) 다. 시각은 KST.

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
