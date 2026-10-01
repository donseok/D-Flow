# SP4 E2E·리허설 기록 — Phase A1

계획 `.superpowers/sp4/plan-a1.md`(스펙 `docs/superpowers/specs/2026-10-01-sp4-weekly-teams-design.md` §3·§7). 전용 스택(워크트리
`/Users/jerry/D-Flow-wt/lane-a-sp4`, 브랜치 `sp4/a1`, project `d-flow-sp4`, api 54521·db 54522)에서 잰다. 시각은 KST.
마이그레이션 번호는 접미로 적는다(`*_weekly_areas` 등 — D12). 체크포인트 절(E2E·합성·눈확인)은 과제 36 이 끝에 더한다.

## 리허설

| 파일 | 리허설 | 일시 | 결과 |
|---|---|---|---|
| `*_weekly_areas` | R(카탈로그) | 2026-10-01 19:44 KST | `diff r b` 불일치 0 · 기본 권한 diff 없음 · 재적용 `diff f a` 불일치 0 · ⑫ `WEEKLY_AREAS_POSTCHECK` 통과 |
| `*_weekly_areas` | 사전검사(`precheck_violations` 경우 1·2) | 2026-10-01 19:45 KST | 둘 다 `WEEKLY_AREAS_PRECHECK` 로 멈춤(`this_content`·`next_issue` 20001자), 버전 그대로 |
| `*_weekly_areas` | 데이터 업그레이드(`seed_wide` → 적용 → `smoke` → `created_fixture` → `smoke` → 롤백 → `rollback_check` → 재적용 → `smoke`) | 2026-10-01 19:46 KST | 첫 적용 `영역 신설 8, 재사용 2, 병합으로 지운 행 5, 머리표 4, 남은 행 11` · 스모크 3회 통과(14개) · 롤백 확인 통과(11개) · 재적용 `영역 신설 0, 재사용 12, …, 남은 행 13` |
| `*_weekly_areas` | 사후검사 민감도(트리거 끔·insert grant) | 2026-10-01 19:46 KST | 둘 다 `WEEKLY_AREAS_POSTCHECK` 로 멈춤 — `트리거가 없다: weekly_report_rows_touch`·`정책 없는 DML 권한: weekly_report_rows:INSERT` |
