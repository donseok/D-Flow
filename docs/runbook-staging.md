# 스테이징 운영 runbook

> **D-Flow 현황(2026-09-24)** — 원격 스테이징·운영·Vercel 프로젝트가 아직 없다(첫 배포 SP에서
> 생성한다). 아래는 **원본 리포의 원격 스테이징 기록이 아니라 D-Flow 자신의 절차**다.
> 지금은 로컬 Supabase가 유일한 환경이므로, 마이그레이션 "스테이징 리허설"은 로컬
> `npm run db:reset`으로 한다. 원본의 원격 DB(금지 ref 목록: `CLAUDE.md` "원본 DB 금지"·
> `scripts/lib/targets.mjs` FORBIDDEN_REFS)에는 접속하지 않는다(`docs/fork-policy.md`).

---

## 1. 지금의 "스테이징"은 로컬 Supabase다

원격이 생기기 전까지는 빈 로컬 Postgres에 기준선부터 처음부터 재적용하는 것이 유일한
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

원격이 생긴 뒤에는 `npm run db:apply -- <파일> --target staging|prod`로 원격 적용 단계가
추가된다(`scripts/db-apply.mjs`) — 지금은 `--target local`을 거부하고 원격 ref
(`STAGING_REF`/`PROD_REF`)가 없으면 즉시 에러로 멈춘다(`scripts/lib/targets.mjs`).

---

## 3. env 전환

- `npm run env:local` — `supabase status` 결과로 `.env.local`을 채운다. 지금은 사실상 이것만
  쓴다.
- `npm run env:staging` / `npm run env:prod` — `.env.local.staging` / `.env.local.prod` 파일이
  있어야 동작한다. **아직 아무도 만든 적이 없다** — 원격이 생기기 전까지 실행하면
  "원격 staging은 아직 없다"는 에러로 실패한다(의도된 동작, `scripts/env-swap.mjs`).
- `npm run dev`의 predev 가드(`scripts/check-env-target.mjs`)는 `.env.local`이 원본 리포의
  DB 좌표를 가리키면 **우회 불가로 차단**한다 — 파일에 원본 ref가 섞여 들어오는 사고를 막기
  위함이다.

---

## 4. AI 어시스턴트 API 키

환경변수명은 `GEMINI_API_KEY` 하나다(Google AI Studio에서 발급, 서버 전용). 미설정이어도
봇은 구조화 질의 기반 결정형 답변으로 자동 폴백해 동작한다. 로컬 `.env.local`에 직접
추가한다 — 원격 Vercel 프로젝트가 생기면 그 프로젝트의 Environment Variables에도 등록한다.

---

## 5. 원격 인프라가 생긴 뒤

첫 배포 SP에서 Vercel·원격 Supabase(스테이징/운영)를 만들면, 이 문서는 그 실좌표·동기화
절차(운영→스테이징 복제, `staging_reader` 역할, Vercel Ignored Build Step 등)로 다시 채운다.
지금 그 절차의 옛 기록은 `docs/superpowers/**`에만 있고, 원본 리포의 기록일 뿐 이 리포의
실행 절차가 아니다.

---

## 참고

| 항목 | 문서 · 경로 |
|---|---|
| 프로덕션 롤백(원격 생긴 뒤) | `docs/runbook-rollback.md` |
| 포크 정책·금지 DB ref | `docs/fork-policy.md` |
| pre-push 훅 (G1-G5) | `.githooks/pre-push` |
| 로컬 개발 규칙 정본 | `CLAUDE.md` |
