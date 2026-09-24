# SP0 — 포크 부트스트랩·스키마 기준선·탈-브랜드 설계 스펙

> **익명화(2026-09-24):** 원본 고객사·구 브랜드·고객 업무 문자열은 일반 명칭으로 치환했다. 실측 재현 명령과 식별자도 함께 치환돼 있어 원본 리포에서 그대로 실행되지 않을 수 있다.

| 항목 | 값 |
|---|---|
| 날짜 | 2026-09-23 |
| 상태 | 초안 — 사용자 검토 대기 |
| 상위 정본 | `docs/superpowers/specs/2026-09-23-generic-platform-design.md` 6.2 SP0(범위·done_when). 이 문서는 그 SP0 을 **로컬 우선 개발** 전제로 구체화하고, 아래 "상위 스펙 대비 변경" 표의 항목만 바꾼다 |
| 컷오프 | `wbs-web@77cf6785e088e65a35857ae69b4b5b040fa13bf3`(첫 커밋 `c40de1a` 트레일러). 상위 스펙 6.6 은 "`origin/main` SHA" 라 적었으나 실제 컷오프는 staging 77cf6785 이다 — 2026-09-23 실측으로 77cf6785 는 wbs-web `origin/main` 의 조상이고 그 뒤 `supabase/migrations` 차이는 0건이므로 운영 스키마 = 컷오프 코드의 스키마다 |
| 제품명 기본값 | `D-Flow`(env `BRAND_*` 로 교체 가능, SP3 에서 워크스페이스 설정으로 승격) |

## 1. 전제와 결정

### 1.1 사용자 결정(2026-09-23)

| # | 결정 | 귀결 |
|---|---|---|
| U1 | DB 는 SQLite 가 아니라 **로컬 Supabase**(`supabase start`, Docker) | 결정 2(Postgres·RLS·Auth·Storage·Realtime)·점진 포크 근거 유지. SQLite 는 supabase-js 122파일·RLS `auth.uid()` 142곳·`security definer` 54·RPC 42종·pgvector 7파일·Auth/Storage/Realtime 전면 재작성이라 기각 |
| U2 | 개발 동안 웹서버는 로컬(`npm run dev`) | 새 클라우드 Supabase(staging·prod)·Vercel 프로젝트 생성은 **첫 배포 시점으로 연기**. SP0 done_when 은 로컬 실측 + CI 로 정의 |
| U3 | 제품명 기본값 `D-Flow`, 로고는 텍스트 워드마크 | `src/lib/branding.ts` 기본값 |

### 1.2 상위 스펙 대비 변경

| 상위 스펙 SP0 | 이 문서 | 근거 |
|---|---|---|
| 새 스테이징에서 빈 DB 완주 | 로컬 `supabase start` + `npm run dev` 에서 빈 DB 완주 | U2 |
| 새 Supabase 2 + Vercel 2 생성 | 연기(첫 배포 SP 에서) | U2 |
| 매 SP done_when 에 `mark:good` | SP0 은 git 태그 `sp0-done` 으로 대체. `mark:good` 은 `vercel inspect` 의존이라 첫 배포 이후 | U2 |
| UI 눈확인 정본 = 스테이징 URL | 로컬 `npm run dev` 눈확인, 트레일러 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` | U2 |
| 마이그레이션 스테이징 리허설(G4) | 로컬 `npm run db:reset` 리허설, 트레일러 `Staging-verified: local db reset <YYYY-MM-DD HH:MM>` | U2. 원격 스테이징이 생기면 원래 규칙으로 복귀 |
| 롤백 파일 위치 `supabase/migrations/*_rollback.sql` | `supabase/rollbacks/NNNN_*_rollback.sql` | Supabase CLI 는 `supabase/migrations` 의 `^[0-9]+_.*\.sql$` 를 전부 순서대로 적용한다 — 롤백이 같은 폴더에 있으면 `db reset` 이 롤백까지 실행하고 같은 번호 두 파일이 버전 충돌을 낸다 |
| 초대 도메인 → env | env `INVITE_EMAIL_DOMAINS` **필수**. 미설정이면 초대 거부(fail-closed), 명시값 `*` 만 제한 없음 | 현 `parseAllowedDomains` 가 "미설정을 제한 없음으로 읽지 않는다" 를 원칙으로 적고 있고, 에러 처리 3원칙 "보안 가드는 fail-closed" |

### 1.3 비목표

- 워크스페이스·조직 모델·설정 엔진(SP1~SP3) — 스키마는 기준선 그대로
- `WEEKLY_SECTIONS`·`ISSUE_MEGA_AREAS`·`LEGACY_*_PROFILE` 의 런타임 import 제거(SP4·SP5)
- 양식 엔진(SP6) — PPTX 는 파일만 중립화
- 원격 배포·`mark:good`·운영 스모크

## 2. 안전 선행 — wbs-web 좌표 격리

**문제(실측).** 사본에는 wbs-web 의 DB 좌표가 리터럴로 남아 있다. `scripts/lib/staging.config.mjs` 의 `PROD_REF = 'rglfgrwwwwdqejohdnty'`(운영 원본 고객사)·`STAGING_REF = 'abtyahghvvkcriawffty'`(wbs-web 스테이징), `scripts/seatmap-load.mjs`. 이 상태로 `npm run db:apply -- x.sql --target prod` 는 **운영 원본 고객사 에 쓴다**, `npm run staging:sync` 는 wbs-web 스테이징을 덮는다. 또 `core.hooksPath` 가 미설정이라 pre-push 훅이 꺼져 있다.

**설계.** 이 절이 SP0 의 첫 커밋들이며, 다른 어떤 작업보다 먼저 한다.

1. `scripts/lib/staging.config.mjs` → `scripts/lib/targets.mjs` 로 교체.
   - `resolveTarget(name)`: `local` 은 `supabase status` 의 DSN(`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), `staging`·`prod` 는 env `STAGING_REF`·`PROD_REF` — 없으면 throw(fail-closed).
   - `FORBIDDEN_REFS = ['rglfgrwwwwdqejohdnty', 'abtyahghvvkcriawffty']` — 어떤 경로로 해석된 ref·URL·DSN 이든 이 문자열을 포함하면 throw. 유일한 예외는 `baseline-dump.mjs`·`baseline-diff.mjs` 의 **읽기 전용** 접속(3절)이며, 그 두 스크립트만 `allowForbidden: 'readonly-baseline'` 을 넘긴다.
   - 단위 테스트 `tests/scripts/targets.test.ts`: 미설정 throw, 금지 ref throw(env 로 주입해도), 예외 플래그 없이 금지 ref 거부.
2. 소비처 전환: `db-apply.mjs`·`check-env-target.mjs`·`env-swap.mjs`·`staging-sync.mjs`·`lib/staging-core.mjs` 가 `targets.mjs` 만 쓴다. `staging-sync.mjs` 는 원격 스테이징이 생길 때까지 `STAGING_REF`·`PROD_REF` 미설정으로 자연 차단된다.
3. `scripts/seatmap-load.mjs` 삭제(원본 고객사 좌석 데이터 전용).
4. `npm install` 로 `prepare` 가 `core.hooksPath .githooks` 를 건다 — 이후 모든 push 에 G1~G4 적용.
5. `CLAUDE.md` 재작성: wbs-web 전용 절(Supabase 계정·ref·원본 고객사 데이터·`memberships` deprecated·Vercel env 실측) 삭제, 로컬 Supabase 개발 규칙·금지 ref·이 문서의 트레일러 규칙 추가, git 운영·CSS 안전망·권한·에러 3원칙 유지(상위 스펙 6.6 표).
6. `docs/fork-policy.md` 신설(상위 스펙 6.6 그대로 + 컷오프 SHA 정정 + 금지 ref 목록).

**검증.** `grep -rn 'rglfgrwwwwdqejohdnty\|abtyahghvvkcriawffty' scripts src .github supabase` 결과가 `targets.mjs`(금지 목록)와 그 테스트뿐. 역사 문서(`docs/superpowers/**`·`docs/runbook-*`)의 ref 는 기록이므로 남긴다 — 단 runbook 은 7절에서 개정.

## 3. 스키마 기준선

### 3.1 `0000_baseline.sql`

- 스크립트 `scripts/baseline-dump.mjs`(1회성, 커밋해 재현 가능하게 둔다).
  - 접속: 키체인 `DFlow Prod Reader` 의 DSN(세션 풀러). `PGOPTIONS='-c default_transaction_read_only=on'` 로 세션 자체를 읽기 전용으로 연다.
  - 실행: 로컬에 `pg_dump` 가 없으므로 `docker run --rm postgres:17 pg_dump --schema-only --schema=public --no-owner` (버전 ≥ 17 검사 유지).
  - 후처리(스크립트 내, 규칙 기반): `SET` 헤더 정리, `\restrict`/`\unrestrict` 메타명령 제거(pg_dump 17.6+ 가 출력; CLI 적용 불가), `CREATE SCHEMA public` 제거(이미 존재). **권한 `GRANT`/`ALTER DEFAULT PRIVILEGES` 는 남긴다** — `anon`·`authenticated`·`service_role` 권한이 RLS 판정의 전제다.
  - 확장: `vector` 등 `public` 밖 스키마의 확장은 덤프에 `CREATE EXTENSION` 이 빠질 수 있으므로 스크립트가 운영 `pg_extension` 을 읽어 파일 머리에 `create extension if not exists … with schema …` 를 생성한다.
- 산출 파일은 롤백 쌍이 없는 유일한 예외(상위 스펙 6.5.2).
- `auth.users` 등 Supabase 관리 스키마를 참조하는 FK·트리거는 로컬 Supabase 에도 같은 스키마가 있으므로 그대로 적용된다 — 3.4 의 CI 잡이 이를 매번 검증한다.

### 3.2 `0001_storage_realtime.sql` + `supabase/rollbacks/0001_storage_realtime_rollback.sql`

수기. 상위 스펙 SP0 마이그레이션 칸 그대로 — `storage.buckets` 3개(`deliverables`·`minutes`·`issue-attachments`, 운영의 `public`·크기·MIME 제한 값은 운영 `storage.buckets` 읽기 결과를 옮긴다), `storage.objects` 정책 9개, `realtime.messages` 정책 2개. 원문은 기존 `0008`·`0021`·`0036`·`0045`·`0068`·`0075`·`0098` 의 **최종 유효 `create policy`** 를 모은다(중간에 drop·재생성된 것은 마지막 것). 정확성은 3.3 의 diff 로 판정한다.

### 3.3 `scripts/baseline-diff.mjs`

- 양쪽 카탈로그를 읽어 비교: 운영(읽기 전용, 3.1 과 같은 접속)과 로컬(`db reset` 직후).
- 비교 항목: `pg_policies`(schema·table·policyname·cmd·qual·with_check), `pg_proc`(public, 이름·인자·`prosecdef`), `pg_trigger`(비내부), `pg_tables.rowsecurity`, `storage.buckets`.
- 출력: 항목별 수와 불일치 목록. 불일치 0 이면 exit 0.
- 결과 스냅샷을 `docs/baseline/2026-09-23-live-catalog.md` 에 커밋 — SP2 스펙의 "라이브 정책 목록" 입력(상위 스펙 6.7 첫 행을 닫는다).

### 3.4 정리

- 삭제: `supabase/migrations/0001~0100` 전량(정방향 97 + 롤백 70 = 167파일), `tests/migrations/` 41파일.
- `migration_ledger` 표는 기준선에 포함(스키마만이므로 행은 원래 0).
- 마이그레이션 커밋은 코드와 분리(G1). 기존 파일 삭제 커밋·`0000`·`0001` 추가 커밋이 각각 마이그레이션 전용 커밋이다.
- 불변식 테스트 `tests/invariants/migration-files.test.ts`: 파일 단위 번호 유일, 정방향마다 `supabase/rollbacks/` 에 쌍(예외 `0000` 하나), `supabase/migrations/` 에 `_rollback` 파일 0개.

## 4. 로컬 개발 환경

- `supabase/config.toml`: `project_id = "d-flow"`. 시드는 `seed.sql` 유지(내용은 6절).
- `package.json` 스크립트: `db:start`(`supabase start`), `db:reset`(`supabase db reset`), `env:local`(`supabase status -o env` → `.env.local` 생성).
- `env-swap.mjs`·`check-env-target.mjs`: 대상 `local|staging|prod`, 판독은 `.env.local` 의 URL 이 `127.0.0.1`/`localhost` 면 local. **금지 ref 를 가리키면 `FORCE_*` 로도 우회 불가하게 차단**, prod 는 기존처럼 `FORCE_PROD_DEV=1` 로만.
- `db-apply.mjs`: `--target local|staging|prod`, `--driver mgmt|psql`(기본: local→psql, 원격→mgmt). psql 드라이버도 로컬에 psql 이 없으면 `docker run --rm --network host postgres:17 psql` 로 실행.
- `.githooks/pre-push`: G4 컷오프 `>= 72` → `>= 1`(100·109행). 트레일러 키는 그대로 `Staging-verified:` — 값에 `local db reset <일시>` 를 적는다(1.2).
- 전제: Docker Desktop 실행. `supabase` CLI 2.75.0 설치 확인(최신 2.117.0 — 업그레이드는 CI 와 같은 버전으로 맞출 때만).

## 5. 탈-브랜드

- `src/lib/branding.ts` 단일 출처: `productName`(기본 `D-Flow`), `shortName`, `mailFromName`, `logoText` — env `NEXT_PUBLIC_BRAND_NAME` 등으로 덮어쓰기. 로고는 `productName` 텍스트 워드마크 컴포넌트, `public/logo.png` 는 삭제 또는 중립 파비콘으로 교체.
- 치환 대상(2026-09-23 실측): `"구 브랜드명"` 24파일(`src`+`public`), `origincorp|원본 고객사|ORIGIN|원본 고객사` 21파일, `README.md` 첫 문단, `MAIL_FROM_NAME` 기본값, 로그인 문구, `package.json` `name`(`d-flow`).
- 초대 도메인: `DEFAULT_ALLOWED_DOMAINS = ['example-corp.com']`(`src/lib/domain/invites.ts:17`) 삭제. `parseAllowedDomains` 는 env `INVITE_EMAIL_DOMAINS` 가 비면 **빈 허용 목록 = 초대 거부**를 돌려주고 화면은 "초대 도메인이 설정되지 않았습니다" 를 표시한다. `*` 는 명시적 제한 없음. 테스트 3케이스(미설정 거부·목록 허용·`*`).
- PPTX: `src/lib/report/assets/weekly-template.pptx`·`issue-analysis-template.pptx` 는 같은 경로·같은 레이아웃 유지, 로고 이미지·회사명 텍스트·브랜드 색만 제거/중립색 교체(JSZip 으로 XML 수정, 슬라이드 구조는 불변 — 렌더 코드 무수정이 조건). 기존 렌더 테스트가 초록이어야 한다.
- `TEAM_COLOR`(`src/lib/report/brand.ts:33`)·`TEAM`(`src/components/wbs/shared.tsx:4`): 팀 코드 키 대신 순번 팔레트 `teamColorAt(index)` 로 임시 교체(컬럼화는 SP4).
- UI 위험 파일(`globals.css` 브랜드 토큰, `layout.tsx` 제목·메타)은 `ui/sp0-debrand` 브랜치에서 작업하고 로컬 눈확인 후 `Preview-checked: local …` 트레일러로 머지.

## 6. 폴백·원본 고객사 시드 제거

상위 스펙 SP0 "폴백 제거" 그대로:

- `src/lib/teams/master.ts`: `let cache = DEFAULT_TEAMS` 초기값·"전역 행 0이면 throw" 제거 — 공용 팀 0개가 정상. `TeamsProvider` 기본값 `[]`.
- `DEFAULT_TEAMS` → `tests/fixtures/teams.ts`, `excel/parse.ts` `LEGACY_COLUMN_MAP` → `tests/fixtures/excel/legacyParse.ts`(런타임 importer 0 확인 후).
- `LEGACY_ORIGIN_PROFILE` → `LEGACY_EXCEL_PROFILE_V1` 개명만.
- `TEAM_SUB_ALIASES`(`src/lib/domain/minutes.ts:86`) 삭제.
- `supabase/seed.sql`: 4팀 시드 → 로컬 개발용 최소 시드(플랫폼 슈퍼유저 1명 계정 생성은 시드가 아니라 `scripts/dev-bootstrap.mjs` 가 `auth.admin.createUser` 로 — 비밀번호를 파일에 두지 않는다).
- `src/lib/domain/projectPresets.ts`·`preset_applied` 사용처 삭제, `createProject` 에서 `level_labels` 필수(빈 값 거부).

## 7. CI·문서

- `.github/workflows/ci.yml`
  - 잡 `test`: `npm ci` → `npm run lint` → `npm run test` → `npm run build`. **정정(Task 8 리뷰, 2026-09-24):
    `npm run build` 는 `tests/` 를 타입체크하지 않는다** — Next 15.5.19 는 `*.test.*`·`__tests__` 경로의
    진단을 전부 버린다(`node_modules/next/dist/lib/typescript/runTypeCheck.js`). 즉 지금 CI 에는 테스트
    파일 타입체크 게이트가 없다. 실제 게이트는 §11 열린 항목 참고.
  - 잡 `db`: `supabase/setup-cli` → `supabase start` → `supabase db reset` — 기준선·0001·seed 가 빈 Postgres 에 적용되는지 검증. **정정(Task 8 fix round 1·8b, 2026-09-24)**: "매 push" 가 아니라
    `on.push.branches: [main, staging, 'sp0/**', 'ui/**']` 와 `pull_request` 에서만 돈다 — PR 브랜치·이
    네 패턴에 없는 임시 브랜치로만 push 하면 `db` 잡은 그 push 에서 돌지 않고, 나중에 PR 을 열거나 이
    패턴에 맞는 브랜치로 push 할 때 돈다.
  - 두 잡 모두 외부 시크릿 불필요(원격 DB 접속 없음).
- `package.json` `engines.node: "^22.13.0 || >=24"`. **정정(Task 8 리뷰·8b, 2026-09-24)**: 처음엔
  `>=22.4` 로 뒀다가 `>=22.13` 을 거쳐 지금 값으로 좁혔다. 실측 결과 `jsdom` 29.1.1 의 `engines.node`
  (`node_modules/jsdom/package.json`)가 정확히 `^20.19.0 || ^22.13.0 || >=24.0.0` 이다(vitest 4.1.9
  는 `^22.0.0`, next 15.5.19 는 `>=20`, eslint 9.39.4 는 `^20.9.0 || >=21.1.0` 으로 더 느슨해 jsdom 이
  제일 빡빡하다). 이 프로젝트는 Node 20 계열을 지원하지 않으므로(개발 문서·CI 모두 22 전제) jsdom 의
  범위에서 20.x 가지를 뺀 `^22.13.0 || >=24`(22.13.0~22.x 전부 + 24 이상 — **22.14~23.x 는 제외**, jsdom
  이 그 구간을 허용하지 않는다)가 정확한 하한이다. 단순 `>=22.13` 은 jsdom 이 거부하는 Node 23.x 를
  허용해 버려서 부정확했다.
- `warm.yml`: 대상 URL 이 wbs-web 운영이므로 **삭제**(배포가 생기면 env 로 다시 만든다).
- `scripts/smoke-prod.mjs`·`mark-good.mjs`: 기본 URL 리터럴 삭제, `SMOKE_URL` 필수. `FLOOR` 는 로컬 `npm run build && npm start` 대상으로 재측정해 갱신(줄었다면 커밋에 사유).
- `vercel.json`·`scripts/vercel-ignore-build.sh`: 프로젝트명 리터럴 `dflow-staging*` → env `STAGING_PROJECT_PREFIX`. 파일은 유지(첫 배포 대비).
- `docs/runbook-staging.md`·`docs/runbook-rollback.md`: 맨 위에 "원격 스테이징·운영 미생성 — 로컬 절차" 절을 두고, wbs-web 좌표 절은 "원본 리포 기록" 으로 표시.
- `.claude/skills/dflow-*`: SP0 범위 밖(SP7 동결). 2026-09-23 grep 으로 스킬에 `*.vercel.app` 기본 URL 0건 — `DFLOW_API_BASE` env 로만 대상을 정하므로 손대지 않는다.
- `.env*` 는 이미 `.gitignore`(33~35행)라 `env:local` 이 만든 `.env.local`(서비스 키 포함)은 커밋되지 않는다.

## 8. 작업 순서

| # | 묶음 | 커밋 성격 |
|---|---|---|
| 1 | 2절 안전 선행(`targets.mjs`·소비처·`seatmap-load` 삭제·`npm install`·CLAUDE.md·fork-policy) | 코드·문서 |
| 2 | 3.4 기존 마이그레이션·`tests/migrations` 삭제 | 마이그레이션 전용 + 테스트 삭제는 별도 |
| 3 | 3.1~3.3 기준선 덤프·`0001`·diff — Docker 실행 필요 | 스크립트(코드) / `0000`·`0001`(마이그레이션) 분리 |
| 4 | 4절 로컬 환경·db-apply 드라이버·G4 | 코드 |
| 5 | 7절 CI | 코드 |
| 6 | 6절 폴백 제거 | 코드 |
| 7 | 5절 탈-브랜드(UI 위험 파일은 `ui/sp0-debrand`) | 코드 |
| 8 | done_when 실측·`sp0-done` 태그 | — |

각 묶음 끝에서 `npm run test` 초록을 유지한다(`main` 이 깨진 채 다음 묶음으로 가지 않는다).

## 9. 완료 조건(done_when)

- [ ] 로컬 `npm run db:reset` → `scripts/dev-bootstrap.mjs` → `npm run dev` 에서 빈 DB 로 로그인 → 프로젝트 생성(라벨 입력) → WBS 엑셀 임포트 → 주간보고 PPT/엑셀 내보내기 완주. 브라우저 실측 기록(스크린샷 경로·일시)을 `docs/baseline/sp0-e2e.md` 에 남긴다
- [ ] 산출 PPTX/XLSX 가 PowerPoint/Excel(또는 LibreOffice)에서 열리고 원본 고객사·원본 고객사·구 브랜드명 문자열이 없다(`unzip -p … | grep` 0건)
- [ ] `npm run test` 전부 초록(삭제 41파일 제외), `npm run lint`·`npm run build` 초록, CI 두 잡 초록
- [ ] `grep -rE 'origincorp|원본 고객사|ORIGIN|원본 고객사' src public` 0건, `grep -r "구 브랜드명" src public` 0건
- [ ] `grep -rn 'rglfgrwwwwdqejohdnty\|abtyahghvvkcriawffty' scripts src .github supabase` 가 `targets.mjs` 와 그 테스트뿐
- [ ] `node scripts/baseline-diff.mjs` 불일치 0, 스냅샷 `docs/baseline/2026-09-23-live-catalog.md` 커밋
- [ ] `tests/invariants/migration-files.test.ts` 초록
- [ ] `FLOOR` 재측정 반영
- [ ] CLAUDE.md·`docs/fork-policy.md`·runbook 개정
- [ ] git 태그 `sp0-done` push

## 10. 리스크

| 리스크 | 대응 |
|---|---|
| 기준선이 로컬 Supabase 에 그대로 안 붙음(확장 스키마·`auth`/`storage` 버전 차이·pg_dump 메타명령) | 3.1 후처리 규칙 + CI `db` 잡. 실패 유형은 후처리 규칙으로 흡수하고 수기 편집은 하지 않는다(재현성) |
| 운영 접속 사고 | 읽기 전용 세션 옵션 + 읽기 전용 계정 + 금지 ref 가드. 운영 접속은 `baseline-dump`·`baseline-diff` 두 스크립트뿐 |
| 탈-브랜드 치환이 테스트 기대 문자열을 깨뜨림 | 테스트는 `branding.ts` 값을 import 해 비교하도록 같은 커밋에서 수정 |
| PPTX XML 수정이 렌더 경로를 깨뜨림 | 레이아웃·자리 이름 불변을 조건으로, 기존 렌더 테스트 + 실제 열기 확인 |
| 로컬 Docker 미실행 | 3·4·9절 작업 전 사용자에게 Docker Desktop 실행 요청 |

## 11. 열린 항목

- **tsc --noEmit gate for tests** — §7 의 `npm run build` 는 `tests/` 를 타입체크하지 않는다(정정 사유는
  §7 본문). CI 에 테스트 파일 타입체크 게이트가 없다는 뜻이다. `npx tsc --noEmit --incremental false`
  실측(2026-09-24, Task 8 fix round 1)은 61건이었으나, 그중 33건(`tests/scripts/targets.test.ts` 31건 +
  `tests/scripts/baseline.test.ts` 2건)은 SP0 이 이번에 새로 만든 테스트가 원인이라 Task 8b 에서 바로
  고쳤다(아래 "SP0 자체 발생분 — 고침" 참고). **남은 것은 fork 이전부터 있던 기존(pre-existing) 오류
  28건, 9개 `tests/*.test.ts(x)` 파일**(`tests/actions/authz-gate-global.test.ts` 2건,
  `tests/agent/ensure-order.test.ts` 12건, `tests/agent/resolve-principal.test.ts` 3건,
  `tests/components/agents-detail-panel.test.tsx` 1건, `tests/components/agents-seat.test.tsx` 1건,
  `tests/components/agents-seatmap-view.test.tsx` 6건, `tests/domain/office-chatter.test.ts` 1건,
  `tests/report/issue-analysis-deck-plan.test.ts` 1건, `tests/report/issue-analysis-export.test.ts`
  1건 — `npx tsc --noEmit --incremental false` 로 2026-09-24 Task 8b 재실측). 지금 CI 에는 `tsc` 스텝을
  더하지 않는다(오류 28건이 그대로 빨간불이 된다). **SP1 의 첫 작업**으로 이 28건을 먼저 고친 뒤
  `npx tsc --noEmit` 스텝(또는 테스트 전용 tsconfig + 베이스라인)을 `test` 잡에 추가한다.

  **SP0 자체 발생분 — 고침(Task 8b, 2026-09-24)**: `scripts/lib/targets.mjs`·`scripts/lib/baseline.mjs`
  는 `.mjs` 라 `tsconfig.json` 의 `checkJs` 가 꺼져 있어 자기 자신은 타입 오류를 안 내지만, `allowJs` 로
  TS 가 그 시그니처를 추론해 소비하는 `.test.ts` 쪽에서 오류가 난다. 원인은 둘:
  (1) `env = process.env` 처럼 기본값만으로 매개변수 타입을 추론하면 전역 `NodeJS.ProcessEnv`(Next.js
  가 `node_modules/next/types/global.d.ts` 에서 `NODE_ENV` 를 필수로 더한다)로 넓어져, 테스트가 넘기는
  `{}`·`{ PROD_REF: '...' }` 같은 최소 객체가 전부 오류가 됐다(`resolveTarget`·`classifySupabaseUrl`·
  `detectEnvTarget`·`devEnvVerdict`, targets.test.ts 다수).
  (2) `const counts = {}`/`const values = {}` 뒤 루프 안에서 계산된 키로 채우는 "진화형 객체" 패턴은
  TS 가 반환 타입을 넓히지 못해, 나중에 넣은 키(`counts.policies` 등)가 반환 타입에서 빠졌다
  (`diffCatalog`·`parseEnvFile`, baseline.test.ts·targets.test.ts).
  둘 다 **라이브러리 함수에 JSDoc `@param`/`@returns` 타입 주석을 다는 방식**으로 고쳤다(별도 `.d.mts` 나
  테스트 쪽 `as unknown as` 캐스팅이 아니라). 이유: 오류가 각 라이브러리 함수 하나당 테스트 파일의 여러
  호출부에 퍼져 있어(targets.test.ts 만 31건), 호출부마다 캐스팅하면 진짜 계약이 무엇인지 안 드러나고
  다음에 호출부가 늘 때마다 또 캐스팅해야 한다. 함수 시그니처에 타입을 다는 쪽이 "이 함수가 실제로
  받고 돌려주는 게 뭔지"를 한 곳에 정확히 적어, 오류 원인(과도하게 넓은 추론)을 소스에서 없앤다.
  `devEnvVerdict` 는 첫 인자가 구조분해 패턴이라 `@param` 이름이 그 모양과 안 맞으면(예: 둘째 인자만
  bare `@param {EnvBag} [env]` 로 적기) TS 가 오히려 다른 매개변수 타입을 엉뚱하게 좁히는 부작용을 실측해,
  두 인자 모두 구조 그대로 명시했다. 고친 뒤 `npx vitest run tests/scripts/targets.test.ts
  tests/scripts/baseline.test.ts` 는 여전히 123 passed(런타임 동작 불변 — JSDoc 주석은 지워지고 남는
  게 없다).
