# D-Flow — 작업 규칙

범용 프로젝트 관리 플랫폼(가칭). wbs-web(원본 리포)의 포크 — 컷오프 `wbs-web@77cf6785`.
Next.js 15 (App Router) + Tailwind v4 + Supabase. 설계 정본: docs/superpowers/specs/2026-09-23-generic-platform-design.md,
SP 별 스펙은 같은 폴더. 포크 규칙은 docs/fork-policy.md.

## 원본 DB 금지 (최우선)

wbs-web 의 Supabase `rglfgrwwwwdqejohdnty`(원본 운영, 고객 데이터)·`abtyahghvvkcriawffty`(원본 스테이징)에 접속하지 않는다.
`scripts/lib/targets.mjs` 의 금지 목록이 기계적으로 막는다 — 우회 플래그를 만들지 말 것.
예외: `scripts/baseline-dump.mjs`(SP0 기준선, 읽기 전용 1회). docs/superpowers/** 의 옛 문서에 박힌 ref·절차는 원본 리포 기록이다.

## 개발 환경 — 로컬 우선

원격 스테이징·운영 Supabase·Vercel 은 아직 없다(첫 배포 SP 에서 생성). 개발·검증은 로컬 Supabase(Docker)로 완결한다.

- 전제: Docker 런타임(Docker Desktop 또는 colima)이 실행 중이어야 한다. `supabase` CLI 설치를 확인한다 — 검증한 버전은 2.75 다.
- `supabase/config.toml` 에서 analytics 를 껐다(colima 호환 — 로그 수집기가 colima 에서 docker 소켓을 마운트하지 못한다).
  Studio 의 로그 화면만 빠진다.
- 최초 셋업: `npm run db:start`(로컬 Supabase 기동) → `npm run env:local`(`supabase status` 결과로 `.env.local` 생성) →
  `npm run dev:bootstrap`(워크스페이스 1개 + 그 관리자인 플랫폼 슈퍼유저 계정 등 최소 시드 생성 — 이메일·비밀번호는
  프롬프트로 묻고, `BOOTSTRAP_EMAIL`/`BOOTSTRAP_PASSWORD`/`BOOTSTRAP_WORKSPACE_SLUG`(기본 `default`)/
  `BOOTSTRAP_WORKSPACE_NAME`(기본 `기본 워크스페이스`)/`BOOTSTRAP_MODULES`(쉼표 목록 — 워크스페이스의 허용 모듈. 없으면 비core 전부,
  빈 문자열은 core 만. 다시 돌릴 때 기존 워크스페이스에 값이 있으면 명시했을 때만 덮는다) env 로도 받는다. 비밀번호는 파일에 남기지 않는다)
  → `npm run dev`.
- 스키마를 바꿨으면 `npm run db:reset`(기준선 + 마이그레이션 + seed 를 빈 Postgres 에 재적용)으로 검증한다 —
  이것이 이 리포의 "스테이징 리허설"이며 아래 G4 트레일러의 근거다. 리셋은 계정까지 지우므로 이어서
  `npm run dev:bootstrap` 을 다시 돌린다.
- 작업이 끝나면 `npm run db:stop` 으로 컨테이너를 내린다.

## git 운영

### 커밋

- **`git add -A` 금지.** 항상 파일명을 명시해 stage 한다. 병렬 세션의 dirty 파일과 `.env` 가 섞여 들어간다.
- **마이그레이션과 코드를 같은 커밋에 담지 않는다.** `supabase/migrations/*` 는 별도 커밋으로.
  섞으면 `git revert` 가 코드만 되돌리고 DB 는 남아 롤백이 반쪽이 된다. pre-push 훅(G1)이 막는다.
- 커밋 메시지는 한국어. "무엇"보다 "왜".

### 브랜치

- 일반 작업은 `main` 직행으로 해도 된다.
- **UI 위험 파일을 건드리면 브랜치를 쓴다** — `src/app/globals.css`, `src/app/layout.tsx`,
  `src/app/(app)/layout.tsx`, `src/components/app/*`.
  이 파일들은 전 화면에 영향을 주는데 **빌드·린트·타입체크·테스트로 깨짐이 잡히지 않는다**
  (2026-07-27 사고 때 vitest 2438건이 전부 통과했다). Vercel Preview 에서 눈으로 봐야 한다.
  ```bash
  git switch -c ui/<주제>
  git push -u origin HEAD      # 사람 확인 후 push. Preview URL 에서 화면 확인(원격 Preview 가 생긴 뒤 기준)
  git switch main && git merge ui/<주제> && git push   # ff 머지도 괜찮다. 여기도 push 는 사람 확인 후
  ```
  pre-push 훅(G2)은 **"원격 어디에도 올라간 적 없는 UI 커밋"** 이 main 으로 가는 것만 막는다.
  브랜치로 한 번이라도 push 했다면 Preview 를 받은 것이므로 ff 머지든 `--no-ff` 든 통과한다
  (이 문단은 원격 Preview 가 있는 이후 기준 — 지금은 바로 아래 ⚠️ 참고).

  ⚠️ **지금은 원격 Preview 가 없다** — Vercel 프로젝트가 아직 없어 push 해도 눈으로 확인할 URL 이 생기지 않는다.
  눈확인은 로컬 `npm run dev` 로 하고, 트레일러는 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` 을 남긴다.
  (원격 Preview 가 생기면 원래 규칙으로 복귀한다.)

- 마이그레이션 리허설: 로컬 `npm run db:reset` 초록 → 트레일러 `Staging-verified: local db reset <일시>`(G4).
- `git push --force origin main` 금지. push 는 사람 확인 후.

### pre-push 훅

`.githooks/pre-push` — `npm install` 이 `core.hooksPath` 를 걸어 자동 설치된다(리포에 커밋되므로 모든 PC 에 따라감). 검사는 다섯:

| | 내용 | 예외 |
|---|---|---|
| G1 | 마이그레이션+코드 혼합 커밋 차단 | 머지·revert 커밋은 제외 |
| G2 | Preview 를 거치지 않은 UI 변경의 main 직행 차단 | `Preview-checked:` 트레일러 |
| G3 | 반응형 안전망 desync·충돌 검사 | vitest 없으면 건너뛰고 그 사실을 알림 |
| G4 | 0001+ 마이그레이션의 main 직행 차단(스테이징 리허설 트레일러) | 범위 내 빈 커밋 트레일러로도 인정 |
| G5 | 원본 리포 사본(`c40de1a`, 로컬 `main-fork-history`)이 조상인 ref 의 push 차단 | 없음 — `SKIP_GUARD` 로도 우회 불가 |

검사 대상은 **이번 push 로 원격에 처음 올라가는 커밋**(`--not --remotes`)뿐이다. 브랜치에 `origin/main` 을 머지해도 남의 커밋이 검사에 끌려들어오지 않는다.

빌드/테스트는 이 훅이 돌리지 않는다. GitHub Actions(`.github/workflows/ci.yml`)가 push/PR 뒤에 lint·test·build 와
db 기준선 대조를 돌리지만 사후 검사라 push 를 막지는 못한다(원격 Vercel 은 아직 없다). push 전에 `npm run lint`·
`npm run test`·`npm run build` 를 직접 돌리고, push 뒤 Actions 결과를 확인한다.
긴급 우회는 `SKIP_GUARD=1 git push`(G5 는 예외). (SP0 의 첫 push 는 squash 루트가 G1 에 걸려 SKIP_GUARD=1 과 1회성 강제 교체로
올렸다 — docs/fork-policy.md. 그 뒤로는 `main` force push 금지가 그대로다.) (`smoke:prod` 로 배포 후 재확인하는 절차는 첫 배포
이후에나 쓸 수 있다.)

---

## CSS — 반응형 안전망 주의

`src/app/globals.css` 끝에 `@layer` 밖(unlayered) 반응형 display 유틸이 있다(원본 리포에서 물려받음 — 부록: docs/runbook-rollback.md).
2026-07-27 사고의 응급 대응이며 **근본원인은 미확정, 효과도 미검증**이다. 상세는 `docs/runbook-rollback.md` 부록.

unlayered 규칙은 특이성과 무관하게 모든 named layer 를 이긴다. 따라서:

- `group-hover:flex`, `data-[state=open]:hidden`, `print:hidden` 같은 **상태 변형 display 유틸을 쓰지 않는다.** 안전망에 져서 조용히 동작하지 않는다.
- 한 요소에 **컨테이너 쿼리 display 와 반응형 display 를 같이 쓰지 않는다** (`hidden @[15rem]:flex lg:flex`).
- `@theme` 에 `--breakpoint-*` 를 추가하면 **안전망의 하드코딩 값도 같이 고친다.**

셋 다 `tests/css/breakpoint-safety-net.test.ts` 가 검사한다.

---

## 데이터

- 새 마이그레이션에는 `supabase/rollbacks/NNNN_<이름>_rollback.sql` 을 함께 만든다(`supabase/migrations/` 에 두면 CLI 가 같이 적용한다).
- `supabase db push` 는 쓰지 않는다. 원격 적용은 `npm run db:apply -- <파일> --target staging|prod`(원격이 생긴 뒤).
- 번호는 파일 단위로 유일(`tests/invariants/migration-files.test.ts`).
- `atomic` 으로 끝나는 식별자는 따옴표로 감싸거나 그 접미사를 피한다 — CLI 2.75 의 문장 분할기가 BEGIN ATOMIC 으로 읽어 여러 문장을 한 번에 보낸다(42601).

## 권한

등급은 **플랫폼 관리자**(`platform_admins`, 코드의 `isSuperuser`·SQL `is_superuser()`) · **워크스페이스 관리자**
(`workspace_members.role='admin'` — 그 워크스페이스 모든 프로젝트의 관리자를 승계) · 프로젝트 **관리자/멤버**다.
**명단 = 권한**: 프로젝트 역할은 명단 행의 `project_members.access_role`('admin'|'member') 한 칸뿐이고,
null 이거나 명단에 없으면 조회 전용이다. 계정 없는 외부 인력(people)은 권한을 받을 수 없다.

- 판정은 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/**`(가드·`*Access.ts`) 두 곳에서만 한다.
  액션에 `role === '...'` 을 직접 적지 않는다.
- 가드는 넷뿐이다: `requireSuperuser()` · `requireWorkspaceAdmin(wid)` · `requireProjectAdmin(pid)` · `requireProjectMember(pid)`
  (시그니처는 `tests/authz/guard-signatures.test.ts` 가 고정한다).
  `projectId` 를 인자로 받지 않는 액션은 `resolveProjectId(table, id)`(워크스페이스까지 필요하면 `resolveScope`)로 먼저 읽는다.
- 옛 `memberships`·`project_roles` 는 0003 에서 폐기됐다(`effectiveLegacyRole` shim 도 없다).
- **회의록·위키·AI 브리핑은 RLS 쓰기 정책이 없다.** service_role 로 쓰기 때문에
  RLS 2차 방어선이 없고 서버 액션 가드가 유일한 관문이다. 이 계열을 손댈 때 특히 주의할 것.
- 사용 현황(`/usage`)은 슈퍼유저 전용 — `canViewUsage()` 와 `0000_baseline.sql` 의 `read_usage_events` 정책이 쌍이다.
- **설정 쓰기는 RPC 한 길이다**(`apply_project_settings`·`apply_workspace_settings`·`create_project_with_settings`, 0012). 설정 4표(`project_settings`·`workspace_settings`·두 이력)와 `authz_events` 의 이름은 허용 파일에만 두고 그 접근은 읽기(select)뿐이다 — 읽기는 `src/lib/settings/{projectConfig,workspaceConfig}.ts`(해석기)·`src/lib/settings/history.ts`(이력), 쓰기는 `src/app/actions/settings.ts`·`src/app/actions/project.ts`(`createProject` 의 `create_project_with_settings`)·`src/lib/settings/write.ts`(가드 없는 내부 쓰기 — 호출자 닫힘). `tests/invariants/settings-writes.test.ts` 가 src·scripts 원문에서 허용 파일 밖의 표 이름(리터럴·조립 조각·scripts 의 SQL·REST), 허용 파일 안의 쓰기, 리터럴이 아닌 RPC 이름, 내부 쓰기 호출자를 잡는다(의도적 난독화는 못 잡는다). 액션 가드가 유일한 관문이다(RPC 는 등급을 보지 않는다).
- 위 규칙의 전체 설계는 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` §2(조직·권한 모델),
  SP1 구현 결정은 `docs/superpowers/specs/2026-09-24-sp1-org-core-design.md` 에 있다.
- 워크스페이스 관리 가드는 `requireWorkspaceAdmin(wid)` — `requireSuperuser` 는 플랫폼 11곳(`tests/invariants/platform-guards.test.ts`)뿐이다. service_role 클라이언트를 새로 만들면 `docs/sp2-admin-client-audit.md` 에 분류를 적는다.

## 에러 처리 3원칙

- 조회 실패를 "데이터 없음"으로 위장하지 않는다 — 표시 = 로깅
- 쓰기 전 선행 조회가 실패하면 중단한다
- 보안 가드는 fail-closed. 모르면 `unknown`

---

## 자주 쓰는 명령

```bash
npm run db:start          # 로컬 Supabase 기동(Docker)
npm run db:reset          # 기준선+마이그레이션+seed 재적용 — 스키마 변경 검증
npm run env:local         # supabase status 결과로 .env.local 생성
npm run dev:bootstrap     # 첫 슈퍼유저 생성(db:reset 뒤에도 다시)
npm run settings:verify   # 로컬 DB 의 설정 값이 레지스트리를 통과하는지(리허설·체크포인트)
npm run dev
npm run build
npm run lint
npm run test
npm run db:stop           # 로컬 Supabase 정지
npm run smoke:prod        # 첫 배포 후. 프로덕션 스모크
npm run mark:good         # 첫 배포 후. known-good 태그
```
