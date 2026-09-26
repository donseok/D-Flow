# SP2 성능 기준선 — 대시보드·WBS p50/p95

- 측정 일시: 2026-09-26 (라운드 2 — 리뷰 라운드 1 지적 반영, 아래 "방법 — 라운드 2 에서 바뀐 점" 참조)
- 측정 커밋(HEAD): `8936df7`(sp2/phase-a) vs `sp1-done` 태그(`4faed0d`, 마이그레이션 0000~0005)
- 데이터: `PERF_MEMBER_PASSWORD=… node scripts/perf-baseline.mjs seed` — 부트스트랩 워크스페이스(`default`)의
  프로젝트 `PERF`에 `wbs_items` 800행(10 단계 × 80) · `announcements` 20행 · `issues` 50행(결정적 id). 추가로
  슈퍼유저가 아닌 워크스페이스 멤버(`bob@example.com`, `workspace_members.role='member'`, `PERF` 프로젝트
  `project_members.access_role='member'`)를 만든다. 두 스키마 모두 같은 시드 절차로 다시 만들었다(로컬 DB 를
  두 스키마 사이에서 `supabase db reset [--version 0005]`로 오가며 재시드 — 행 값이 결정적이라 두 실행의
  데이터가 같다).
- N = 100(경로별 워밍업 3회 + 순차 100회), `next start` 프로덕션 빌드. **두 페르소나**로 각각 잰다:
  - `admin` — 플랫폼 슈퍼유저(BOOTSTRAP 계정). `is_superuser()` 분기라 `my_workspace_ids()`/`is_ws_member()`
    등의 `exists(...)` 서브쿼리를 건너뛴다.
  - `member` — 슈퍼유저도 워크스페이스 관리자도 아닌 일반 명단 멤버. 실제 RLS 서브쿼리 경로(워크스페이스
    멤버십 존재 확인, 명단 조회)를 그대로 탄다 — 운영에서 절대다수인 경로다.
- **각 편(sp1-done/sp2-phase-a)을 2 회, 교대로** 측정했다: sp1 → sp2 → sp1 → sp2. 순서를 고정하지 않은
  이유는 OS/파일 캐시 온도 같은 단조 추세(예: 뒤에 잴수록 유리·불리)가 한쪽에만 실리는 것을 막기 위해서다.
  같은 (레이블·페르소나·경로) 조합의 2 회 p50/p95 는 `scripts/lib/perf.mjs` 의 `median()`(표준 중앙값, 2 개면
  산술평균)으로 합쳤다 — 게이트는 이 중앙값에 건다.

## 방법 — 라운드 2 에서 바뀐 점(리뷰 라운드 1 지적)

이전 라운드는 N=30·1 회·`admin` 페르소나뿐이었다. 그 표본으로는 p95 가 "30 개 중 2 번째로 느린 요청"이라
잡음에 취약했고(sp1 쪽 자체의 p95/p50 비가 1.40~1.44 로 게이트(≤1.20)보다 컸다 — 표본이 잡음을 못 눌렀다는
뜻), `admin` 페르소나만 재서 `is_superuser()` 분기가 일반 멤버가 타는 `exists(...)` 경로를 가려버렸다. 이번
라운드는 N=100·2 회 교대 측정·`admin`+`member` 두 페르소나로 이 세 가지를 고친다.

## 결과 — 중앙값(2 회), p50·p95 비율 나란히

| 페르소나 | 경로 | sp1-done p50 (ms) | sp1-done p95 (ms) | sp2-phase-a p50 (ms) | sp2-phase-a p95 (ms) | p50 비율 | p95 비율 |
|---|---|---:|---:|---:|---:|---:|---:|
| admin | `/dashboard` | 70.28 | 81.28 | 70.32 | 79.20 | 1.00 | 0.97 |
| admin | `/wbs` | 135.25 | 167.52 | 132.73 | 156.28 | 0.98 | 0.93 |
| member | `/dashboard` | 67.49 | 74.56 | 67.32 | 72.15 | 1.00 | 0.97 |
| member | `/wbs` | 129.97 | 151.84 | 129.70 | 161.47 | 1.00 | **1.06** |

기준: 모든 (페르소나·경로) 조합에서 p95 비율 ≤ 1.20. **통과** — 가장 높은 비율(member·`/wbs`, 1.06)도
여유 있게 아래다. R1(`EXPLAIN ANALYZE`) 은 필요 없다.

**p95 < 1 은 "더 빨라졌다"는 신호가 아니라 잡음이다** — admin·`/wbs` 의 0.93 처럼 1 아래로 나온 값들은 두
서버가 로컬 `next start` 로 순차 요청을 받는 벤치마크의 실행 간 편차(OS 스케줄링·파일 캐시 온도) 범위 안이다.
0006 의 RLS 술어가 이 두 경로를 **의미 있게 빠르게 만들었다는 근거는 아니다** — 다만 **느리게 만들었다는
근거도 없다**(모든 비율이 1.10 안쪽, 유일하게 1 을 넘는 member·`/wbs` 도 1.06 으로 게이트 밖 여유가 크다).

각 조합의 개별 2 회 값(중앙값 계산에 쓴 원자료, p95 기준):

| 페르소나 | 경로 | sp1-done run1 / run2 | sp2-phase-a run1 / run2 |
|---|---|---|---|
| admin | `/dashboard` | 83.95 / 78.61 | 78.36 / 80.04 |
| admin | `/wbs` | 160.47 / 174.57 | 157.90 / 154.66 |
| member | `/dashboard` | 70.61 / 78.51 | 72.64 / 71.67 |
| member | `/wbs` | 150.60 / 153.08 | 169.76 / 153.18 |

## 정책 정정(리뷰 라운드 1) — 대시보드·WBS 가 실제로 타는 SELECT 정책

이전 판(라운드 1)이 `is_project_member(project_id)` 라고 적었던 것은 틀렸다. 대시보드·WBS 가 읽는
`wbs_items`·`announcements`·`issues` 의 실제 SELECT 정책은 다음과 같다(`pg_policies` 실측):

```
wbs_items_ws_read       SELECT  project_id IN (SELECT accessible_project_ids())
announcements_ws_read   SELECT  project_id IN (SELECT accessible_project_ids())
issues_ws_read          SELECT  project_id IN (SELECT accessible_project_ids())
```

`is_project_admin(project_id)`/`is_project_member` 는 이 세 표의 **쓰기(ALL)** 정책(`admin_write_items`,
`admin_write_announcements`)에서만 쓰인다 — 읽기 경로가 아니다. `accessible_project_ids()` 는 워크스페이스
전체의 프로젝트 id 집합(`project_id IN (SELECT id FROM projects WHERE workspace_id IN (SELECT
my_workspace_ids()))`)이고, 이 서브쿼리는 대상 표의 행(`project_id`)과 상관되지 않으므로 플래너가 요청당
1 회만 평가한다(admin·member 두 페르소나 모두 이 경로를 탄다 — 차이는 `my_workspace_ids()` 내부에서
`is_superuser()` 분기냐 `workspace_members` 조회냐 뿐이고, 위 표에서 보듯 그 차이가 p95 에 유의미하게
드러나지 않는다).

## `is_ws_member`/`is_ws_admin` 행별 평가가 p95 에 보이는가(팀장 노트)

0006 의 `update_own_minute_folders`·`delete_own_minute_folders`(`is_ws_member` + `is_ws_admin` 함께)와
`insert_own_minute_folders`(`is_ws_admin`)는 `minute_folders` 표의 정책이다(0006:319–335 부근). 이 세 정책은
대시보드·WBS 경로에서 전혀 평가되지 않는다(`minute_folders` 는 회의록 폴더 트리 화면에서만 읽힌다) —
**이번 측정 범위 밖**이고, 위 표의 비율에는 반영되지 않는다. 대시보드·WBS 가 실제로 거치는 정책은 위 절의
`accessible_project_ids()` 계열이며, 요청당 상관되지 않는 서브쿼리 1 회 평가로 수렴한다 — admin/member
두 페르소나로 다시 재도 그 차이가 드러나지 않은 것과 일치한다.

`minute_folders` 세 정책의 행별 비용은 회의록 폴더 화면(이번 기준선에 없음)의 몫으로 남는다 — 그 화면을
다루는 태스크가 필요하면 별도로 측정한다.
