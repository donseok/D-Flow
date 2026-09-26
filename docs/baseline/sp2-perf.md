# SP2 성능 기준선 — 대시보드·WBS p50/p95

- 측정 일시: 2026-09-26
- 측정 커밋(HEAD): `f8af5ec`(sp2/phase-a) vs `sp1-done` 태그(`4faed0d`, 마이그레이션 0000~0005)
- 데이터: `node scripts/perf-baseline.mjs seed` — 부트스트랩 워크스페이스(`default`)의 프로젝트 `PERF`에
  `wbs_items` 800행(10 단계 × 80) · `announcements` 20행 · `issues` 50행. 두 라벨 모두 같은 시드 절차로
  다시 만들었다(로컬 DB 를 두 스키마 사이에서 `supabase db reset [--version 0005]`로 오가며 재시드 — 행 값은
  결정적이라 두 실행의 데이터가 같다).
- N = 30(경로별 워밍업 3회 + 순차 30회, `next start` 프로덕션 빌드).

## 결과

| 경로 | sp1-done p50 (ms) | sp1-done p95 (ms) | sp2-phase-a p50 (ms) | sp2-phase-a p95 (ms) | p95 비율(HEAD/sp1-done) |
|---|---:|---:|---:|---:|---:|
| `/p/<pid>/dashboard` | 74.15 | 103.34 | 74.43 | 84.31 | 0.82 |
| `/p/<pid>/wbs` | 144.35 | 207.90 | 140.11 | 160.00 | 0.77 |

기준: 두 경로 모두 p95 비율 ≤ 1.20. **통과** — 오히려 HEAD 쪽이 더 빠르게 나왔다(두 서버 모두 로컬 `next start`
프로덕션 빌드, 순차 요청 — 절대값 차이는 OS/파일 캐시 온도 같은 측정 잡음 범위 안이지 0006 의 RLS 술어가
이 두 경로에서 유의미한 비용을 더한다는 신호는 없다).

## Task 3(팀장 노트) — `is_ws_member`/`is_ws_admin` 행별 평가가 p95 에 보이는가

0006 의 `update_own_minute_folders`·`delete_own_minute_folders`(2건, `is_ws_member` + `is_ws_admin` 함께)와
`insert_own_minute_folders`(1건, `is_ws_admin`)는 `minute_folders` 표의 정책이다(0006:319–327 부근). 이 세
정책은 `WBS_items`·`announcements`·`issues`·`projects` 를 읽는 대시보드·WBS 경로에서 전혀 평가되지 않는다
(`minute_folders` 는 회의록 폴더 트리 화면에서만 읽힌다) — 그래서 **이번 측정 범위 밖**이고, 위 표의 비율에는
반영되지 않는다. 대시보드·WBS 가 실제로 거치는 정책(`wbs_items`·`announcements`·`issues` 의 SELECT)은
`is_project_member(project_id)`/`accessible_project_ids()` 계열이며, 인자가 행마다 `project_id` 하나로
고정된 조회(한 프로젝트 화면)라 어느 쪽이든 평가 비용이 요청당 1회에 수렴한다 — 800/20/50 행을 반환하는 이번
쿼리에서 그 차이가 드러나지 않은 것과 일치한다.

`minute_folders` 세 정책의 행별 비용은 회의록 폴더 화면(이번 기준선에 없음)의 몫으로 남는다 — 그 화면을
다루는 태스크가 필요하면 별도로 측정한다.
