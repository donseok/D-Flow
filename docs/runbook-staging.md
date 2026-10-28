# 스테이징 운영 runbook

> **D-Flow 현황(2026-10-14)** — 운영 원격이 생겼다(Vercel `d-flow`·Supabase `dflow-prod` — §5). **원격 스테이징은
> 여전히 없다.** 아래는 **원본 리포의 원격 스테이징 기록이 아니라 D-Flow 자신의 절차**다.
> 마이그레이션 "스테이징 리허설"은 지금도 로컬 `npm run db:reset`으로 하고, 통과한 뒤 운영에 적용한다(§5). 원본의 원격 DB(금지 ref 목록: `CLAUDE.md` "원본 DB 금지"·
> `scripts/lib/targets.mjs` FORBIDDEN_REFS)에는 접속하지 않는다(`docs/fork-policy.md`).

---

## 1. 지금의 "스테이징"은 로컬 Supabase다

원격 스테이징이 생기기 전까지는 빈 로컬 Postgres에 기준선부터 처음부터 재적용하는 것이 유일한
리허설 수단이다.

```bash
npm run db:reset          # 0000_baseline.sql + 0001_storage_realtime.sql(+이후 마이그레이션) + seed 재적용
npm run dev:bootstrap     # db:reset은 계정도 지운다 — 첫 슈퍼유저를 다시 만든다
```

"운영 → 스테이징 데이터 동기화" 같은 절차는 이 리포에 없다. 원본 운영 DB에 접속하는
유일한 스크립트는 `scripts/baseline-dump.mjs`(SP0 기준선 확보, 읽기 전용 1회)뿐이다.

---

## 2. 마이그레이션 리허설 절차

1. `supabase/migrations/00NN_설명.sql` 작성 + 대응하는
   `supabase/rollbacks/00NN_설명_rollback.sql`(역방향 SQL, 필수).
2. `npm run db:reset` — 기준선부터 재적용해 스키마가 깨끗하게 올라가는지 확인한다.
   실패하면 여기서 고치고 다시 돌린다(로컬이므로 몇 번이든 반복 가능).
   기준선 대조는 `npm run db:diff:baseline`(0001 까지만 재생해 대조 → 나머지 `migration up`) — CI `db` 잡과 같은 순서다.
3. `npm run dev:bootstrap` → `npm run dev`로 화면에서 새 스키마가 의도대로 동작하는지 확인한다.
4. 마이그레이션 파일만 커밋(G1 — 코드와 분리):
   ```bash
   git add supabase/migrations/00NN_설명*.sql supabase/rollbacks/00NN_설명*.sql
   git commit -m "<마이그레이션 이유>" \
     --trailer "Staging-verified: local db reset $(date '+%Y-%m-%d %H:%M')"
   ```
5. push는 사람 확인 후(`CLAUDE.md`) — G4 pre-push 훅이 이 트레일러(또는 범위 내 빈 커밋
   트레일러)를 요구한다.

그 다음이 운영 적용이다 — `PROD_REF=<ref> npm run db:apply -- <파일> --target prod`(`scripts/db-apply.mjs`, 절차는 §5).
`--target local`은 거부하고 원격 ref(`STAGING_REF`/`PROD_REF`)가 없으면 즉시 에러로 멈춘다(`scripts/lib/targets.mjs`).
**`main` push 는 운영 배포이므로 운영 적용이 push 보다 먼저다.**

---

## 3. env 전환

- `npm run env:local` — `supabase status` 결과로 `.env.local`을 채운다. 지금은 사실상 이것만
  쓴다.
- `npm run env:staging` / `npm run env:prod` — `.env.local.staging` / `.env.local.prod` 파일이
  있어야 동작한다. **아직 아무도 만든 적이 없다**(운영 원격이 생긴 뒤에도 — 로컬 dev 를 운영 DB 에 붙이지 않는다).
  파일이 없으면 에러로 실패한다(의도된 동작, `scripts/env-swap.mjs`).
- `npm run dev`의 predev 가드(`scripts/check-env-target.mjs`)는 `.env.local`이 원본 리포의
  DB 좌표를 가리키면 **우회 불가로 차단**한다 — 파일에 원본 ref가 섞여 들어오는 사고를 막기
  위함이다.

---

## 4. AI 어시스턴트 API 키

환경변수명은 `GEMINI_API_KEY` 하나다(Google AI Studio에서 발급, 서버 전용). 미설정이어도
봇은 구조화 질의 기반 결정형 답변으로 자동 폴백해 동작한다. 로컬 `.env.local`에 직접
추가한다 — 원격 Vercel 프로젝트가 생기면 그 프로젝트의 Environment Variables에도 등록한다.

---

## 5. 운영 원격 (2026-10-14 첫 배포)

| 항목 | 값 |
|---|---|
| Vercel | 팀 `leedonseoks-projects`(Hobby) · 프로젝트 `d-flow` · https://d-flow-eight.vercel.app · 리전 `icn1` |
| 배포 | GitHub `donseok/D-Flow` 연결 — `main` push = 운영 배포, 그 밖의 브랜치 push = Preview 배포 |
| Supabase | `dflow-prod` · ref `aivjcfoeshnhqdrfteyq` · 조직 `dflow-staging`(무료 플랜) · 서울 |
| 스키마 | 기준선 + 0001~0061 (첫 배포 0058, 0059 `workspace_mail_settings` 2026-10-15, 0060 `weekly_columns`·0061 `minute_wbs_links` — 2026-10-28 Management API 조회로 적용 확인) |

비밀값(DB 비밀번호·`CRON_SECRET`)은 리포에 없다 — 배포한 사람의 PC 와 Vercel 환경변수에만 있다.

**Vercel 환경변수 — Production 에만 넣었다**: `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`·`CRON_SECRET`,
그리고 `NEXT_PUBLIC_APP_URL=https://d-flow-eight.vercel.app`(2026-10-15 — 회의 안내·초대 메일 링크의 기준 주소. 빌드 때 굳으므로 바꾸면 다시 배포한다).
`APP_ENV` 는 `next.config.ts` 가 `VERCEL_ENV` 에서 옮긴다. AI 키·SMTP·초대 허용 도메인·아래 에이전트 API 외 기능 스위치(`.env.local.example`)는 넣지 않았다 — 그 기능들은 꺼져 있다.

**에이전트 API(2026-10-19)**: Vercel `d-flow` 의 **Production** 환경에 `AGENT_API_ENABLED=true` 를 추가했다. 개인 액세스 토큰 발급과
에이전트 외부 API를 활성화하는 서버 설정이며, 변경 후 새 운영 배포가 필요하다. 인증은 발급한 PAT 를 사용하고 `AGENT_API_SECRET` 은 사용하지 않는다.
토큰 발급은 기존 워크스페이스 소속·`agents` 모듈 검사, API 사용은 토큰 스코프·프로젝트 권한 검사를 그대로 따른다. Preview·Development 환경에는 추가하지 않았다.

**메일 발송(2026-10-15)**: 회의 안내·초대 메일은 워크스페이스 설정 › 메일 발송에 저장한 계정으로 나간다(표 `workspace_mail_settings`, 0059 — service_role 전용,
비밀번호는 평문 저장이고 지키는 것은 권한뿐이다). 우선순위는 워크스페이스 설정 → env `SMTP_*` → 미설정이다. 운영에는 `SMTP_*` 를 넣지 않았으므로
설정을 저장하지 않은 워크스페이스는 메일을 보내지 않는다. 계정을 바꾸는 데 재배포가 필요 없다. 로그인 화면의 비밀번호 재설정 링크는 여전히 env `SMTP_*`
(`mailConfigured()`)로만 판정하므로 숨겨진 채다 — 재설정 메일을 열려면 Supabase Auth 의 SMTP 와 env `SMTP_*` 를 따로 정한다(`docs/runbook-selfhost.md`).

**Preview 에는 환경변수가 없다**(Preview 가 운영 DB 를 보게 할지 미결정) — 그래서 Preview 배포는 눈확인에 쓸 수 없고 `CLAUDE.md` 의 로컬 확인 규칙이 그대로다.

**Supabase Auth**: Site URL·허용 리다이렉트를 운영 주소로 맞췄고(비밀번호 재설정 메일의 링크), 공개 가입(`disable_signup`)을 껐다 — 앱은 `signUp` 을 쓰지 않는다.

**무료 플랜의 제약**: 7일 동안 접속이 없으면 프로젝트가 일시정지되고(대시보드에서 다시 켠다), 자동 백업이 없다(`docs/runbook-backup.md`).

### 마이그레이션을 운영에 적용하는 순서

1. 로컬 `npm run db:reset` 초록(§2).
2. `PROD_REF=aivjcfoeshnhqdrfteyq npm run db:apply -- supabase/migrations/NNNN_이름.sql --target prod` — 파일 하나씩, 번호 순으로. 대상 ref 를 다시 입력받는다.
3. 이력 기록 — db:apply 는 `supabase_migrations.schema_migrations` 를 쓰지 않는다. 첫 배포 때 이 표를 손으로 만들고 0000~0058 을 넣었다
   (`version text primary key, statements text[], name text` — CLI 가 만드는 꼴). 새 번호도 같은 방법으로 넣는다(대시보드 SQL 편집기):
   `insert into supabase_migrations.schema_migrations(version, name) values ('NNNN', '이름');`
4. 그 뒤에 `main` 을 push 한다(push = 운영 배포).
5. `SMOKE_URL=https://d-flow-eight.vercel.app npm run smoke:prod`.

### 첫 배포 때 겪은 것 (새 원격을 만들 때 다시 만난다)

- **`realtime.messages` 가 처음에는 없다.** 새 Supabase 프로젝트는 Realtime 에 누군가 한 번 접속해야 그 표를 만든다 — `0001_storage_realtime.sql` 이
  42P01 로 멈춘다. anon 키로 채널을 하나 구독했다 끊은 뒤 다시 적용했다.
- **`alter table realtime.messages enable row level security` 는 클라우드에서 42501**(표의 소유자가 `supabase_realtime_admin`)이다. 클라우드는 이미
  RLS 가 켜져 있으므로(`pg_class.relrowsecurity` 로 확인) 그 한 줄을 뺀 사본으로 0001 을 적용했다. 리포의 파일은 그대로다(로컬 리셋에는 그 줄이 필요하다).
- **`vercel deploy --prod` 는 쓸 수 없었다** — 작업 트리의 파일이 15000개 한도를 넘는다. 첫 배포는 Vercel API(`POST /v13/deployments` 의
  `gitSource`)로 `main` 을 지정해 띄웠고, 그 뒤로는 push 가 배포한다.
- **`vercel link` 는 `.env.local` 끝에 `VERCEL_OIDC_TOKEN` 을 덧붙인다.** 로컬 대상 판정(predev 가드)에는 영향이 없다.
- 무료 플랜의 활성 프로젝트 한도(2개)는 조직별이 아니라 계정별이다.

**아직 하지 않은 것**: 원격 스테이징, 운영→스테이징 복제, `mark:good`, 운영 대상 백업·복구 리허설, `docs/runbook-selfhost.md` 의
"원격 호스팅 첫 배포 때 확인할 것"(로그인한 화면의 CSP 헤더·nonce — 계정이 생긴 뒤 확인). 원본 리포의 옛 절차 기록은
`docs/superpowers/**`에만 있고 이 리포의 실행 절차가 아니다.

원격 DB 에 마이그레이션을 적용한 직후에는 로그인할 계정이 없다. 첫 플랫폼 관리자와 첫 워크스페이스는
`npm run remote:bootstrap -- --target staging`(운영은 `--target prod`)으로 만든다 — `STAGING_REF`/`PROD_REF` 로 대상을
해석하고(`scripts/lib/targets.mjs`, 금지 ref 는 우회 불가), 플랫폼 관리자가 이미 있으면 아무것도 하지 않는다.
비밀값 취급·자체호스트 주소 지정·미검증 범위는 `docs/runbook-selfhost.md` "첫 부트스트랩" 절에 있다.
로컬의 `npm run dev:bootstrap` 은 `.env.local` 이 로컬일 때만 도는 별개 경로다.

---

## 참고

| 항목 | 문서 · 경로 |
|---|---|
| 프로덕션 롤백 | `docs/runbook-rollback.md` |
| 백업·복구 | `docs/runbook-backup.md` |
| 첫 부트스트랩·헬스체크·오류 참조 ID | `docs/runbook-selfhost.md` |
| 포크 정책·금지 DB ref | `docs/fork-policy.md` |
| pre-push 훅 (G1-G5) | `.githooks/pre-push` |
| 로컬 개발 규칙 정본 | `CLAUDE.md` |
