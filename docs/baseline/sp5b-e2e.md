# SP5b E2E·리허설 기록 — I·W1·W2·Z

스펙 `docs/superpowers/specs/2026-10-04-sp5b-workflow-design.md` §6·§7, 계획 `docs/superpowers/plans/2026-10-04-sp5b-phase-{i,w1,w2}.md`.
단일 세션·로컬 스택(클라우드 컨테이너의 Docker, `supabase` CLI 2.75). 시각은 KST. 마이그레이션은 접미로 적는다(`*_issue_status_vocab` = 0025, `*_workflow_policy` = 0026).

## 리허설

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_issue_status_vocab` | `db:reset`(빈 DB 재적용) + `supabase/rehearsal/0025_issue_status_vocab_smoke.sql` | 10-04 16:53 | smoke 통과 · 기존 이슈 `status_code` = 범주 그대로(이행) |
| `*_issue_status_vocab` | 데이터 있는 DB(E2E 데이터)에 롤백 → 재적용 왕복 | 10-04 16:54~17:05(I 커밋 전) | 왕복 통과(계획 I 진행 절) |
| `*_workflow_policy` | `db:reset` + `supabase/rehearsal/0026_workflow_policy_smoke.sql` | 10-04 17:52 | smoke 통과 · 사전 검사(①)·사후 검사(⑨) 통과 |
| `*_workflow_policy` | 데이터 있는 DB 에 적용 → 롤백 거부(원장 행 — 23514 `WORKFLOW_POLICY_ROLLBACK_BLOCKED`) → 정리 뒤 롤백 → 재적용 | 10-04 17:52~18:09(W1 커밋 전) | 거부 문구에 남은 것 목록 · 정리 뒤 왕복 통과 |
| `*_workflow_policy` | Z 성능 A/B — 빈 원장 DB 에서 롤백 ↔ 재적용 12회 | 10-04 19:16~19:20 | 매번 통과 · 끝에 9인자 시그니처 확인(`sp5b-perf.md`) |
| 공통 | `test:rls` | W1 10-04 18:09 커밋 전 | 43 files · 739 통과(+`workflow-policy` 21, I 의 이슈 상태 73 포함) · 건너뜀 0 |

## 로컬 E2E(`scripts/e2e-local.mjs`, 빌드 + `next start -p 3101`)

| 회차 | 일시 | 결과 | SP5b 단계 |
|---|---|---|---|
| I | 10-04 17:06 커밋 전 | 57/57 | `issue-status-flow` 9 검사 — 첫 상태 접수·허용 전이 둘·전이표 밖 거부·해결 범주 파생·이력 2행·사용 중 삭제 `CONFIG_IN_USE`·다른 범주 이관 거부·같은 범주 이관·이관 뒤 삭제 |
| W1 | 10-04 18:09 커밋 전 | 58/58 | `workflow-approval` 8 검사 — 첫 승인 뒤 reported·im·`work.approval_step` 1·`work.approved` 0, 같은 사람 거부, 다른 관리자 승인 뒤 approved·xx·100·`work.approved` 1, 원장 2행, 사람 리프 xx 직행 `approval_required`·단계 승인 둘로 xx |
| W2 | 10-04 18:57 커밋 전(새 reset) | 58/58 | 위 둘 회귀. 선행 기준 `final` 의 claim 403 → 허용은 E2E 가 아니라 라우트 수준 단위 테스트(`tests/agent/claim-gate-final.test.ts`) — depends 를 화면 액션으로 만들 길이 없고 E2E 규칙상 `wbs_items` 를 service_role 로 쓰지 않는다 |

## 합성 게이트(`scripts/e2e-synthetic.mjs`) — Z

10-04 19:05~19:06, `db:reset` + `dev:bootstrap` 직후, 서버 3101(W2 main 빌드). 전 단계 통과(`synthetic-acceptance.md` SP5b 절).

## 단위·정적

| 회차 | 단위(`npm run test`) | typecheck·lint·build |
|---|---|---|
| I | 11,984 | 통과(lint 오류 0) |
| W1 | 12,018 | 통과 |
| W2 | 12,047(+2 skipped) — 915 files | 통과 |
| Z | 12,047(+2 skipped) — 915 files, 19:37 | 통과(lint 오류 0·typecheck·build). 합성 재실행 19:36 22/22(라벨 수정 뒤) |

## CI(main)

| 커밋 | 내용 | 결과 |
|---|---|---|
| `c04674d` 계열 | I | 초록(뒤 `efad1eb` 로 settings-writes 참조 수 정정) |
| `d5fe569` | test 잡 제한 시간 25분 | 초록 |
| `ed157a0` | W1 | 초록 |
| `cedcdb7` | W2 | 초록(run 70) |
