# SP3a 눈확인 — 화면 행 기록

스펙 §7.5 의 눈확인 표. Phase 마다 자기 행을 더한다(이 문서는 Phase A 행만). 스크린샷은 커밋하지 않고 파일명과 `shasum -a 256` 앞 12자만 적는다.

# Phase A(과제 34)

| 항목 | 값 |
|---|---|
| 트리 | `sp3a/phase-a` `4701ed4d542ca2b6fa95777fa328b62bdded8600` |
| 일시 | 2026-09-29 01:25~01:58 KST |
| 서버 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp3a-a` 의 `next dev -p 3101`(Next.js 15.5.19, Node 22.18.0) — E2E(`docs/baseline/sp3a-e2e.md`) 2회차 직후의 DB. 사용자의 :3000 은 건드리지 않음 |
| 계정 | 부트스트랩 관리자 1개(`admin@example.com`, 플랫폼 관리자) — Phase A 화면은 등급별 차이가 없다. 비밀번호는 스크립트가 service_role 로 실행마다 새 임의 값을 넣어 메모리에서만 썼다(출력·저장 없음). CARRY 3 만 E2E 의 bea(워크스페이스 B 관리자)를 같은 방식으로 |
| 도구 | 헤드리스 Chromium 145.0.7632.6(Playwright 1.58.2, npx 캐시 — `package.json` 에 없음), 라이트(`colorScheme: 'light'`), 로케일 ko-KR |
| 크기 | 1440×900 · 1280×720 · 768×1024 · 390×844 |
| 캡처 방식 | 앱 본문이 안쪽 스크롤 컨테이너라 전체 페이지 캡처가 뷰포트만 찍힌다 — 확인 대상 요소를 화면에 스크롤한 뷰포트 캡처 |
| 대상 | `<A>` = E2E A(`b0926d5c-8b7e-4d77-a689-2b01e4768715`), `<B>` = E2E B(`4350887c-b755-4efd-88f2-6537ac3db295`) — 둘 다 뒤의 `db:reset` 으로 사라진 로컬 id |
| 판정 | 조작 뒤 DB(`project_settings` revision·values)와 새로고침 뒤 화면을 둘 다 대조. 모든 행에서 오류 경계(Next 오류 문서·`(app)/error.tsx`) 0 |

| # | 라우트 | 크기 | 결과 | 스크린샷 | 해시 | 비고 |
|---|---|---|---|---|---|---|
| A-1 | `/p/<A>/settings` | 1440×900 | 통과 | A-1-1440x900-before.png<br>A-1-1440x900-data.png<br>A-1-1440x900-credits.png<br>A-1-1440x900-levels.png<br>A-1-1440x900-slider.png | b75497af4c5c<br>d2dba3991912<br>dd0be3c0b69a<br>36a3322901a8<br>8811e4840e74 | 단계 `확인1440c` 추가·저장 rev 8→9, 새로고침에 남음 · 크레딧 IP 35→30 rev 9→10, 남음 · 양식 비우기 rev 10→11, 버튼 사라짐(새로고침 전후). 앞선 시도 둘(rev 3→6 전부 통과였으나 캡처가 뷰포트 위쪽뿐 / `확인1440b` rev 8 저장 뒤 dev 서버 메모리 재시작으로 새로고침 끊김)은 무효로 두고 다시 했다. data·credits·levels 는 rev 11 상태를 찍었다. slider 는 보충(최종 상태 IP 35) |
| A-1 | `/p/<A>/settings` | 1280×720 | 통과 | A-1-1280x720-before.png<br>A-1-1280x720-data.png<br>A-1-1280x720-credits.png<br>A-1-1280x720-levels.png<br>A-1-1280x720-slider.png | 4a9313ed9fa8<br>f397359cf7d4<br>7b768c3ccead<br>5d6258b2d2a5<br>2511b5cd2441 | `확인1280` rev 12→13 · IP 30→35 rev 13→14 · 비우기 rev 14→15, 모두 새로고침에 유지 |
| A-1 | `/p/<A>/settings` | 768×1024 | 통과 | A-1-768x1024-before.png<br>A-1-768x1024-data.png<br>A-1-768x1024-credits.png<br>A-1-768x1024-levels.png<br>A-1-768x1024-slider.png | 49090969ca56<br>ce05184543fb<br>fde108c64a3a<br>a6855b5fb450<br>c4df05eb7078 | `확인768` rev 16→17 · IP 35→30 rev 17→18 · 비우기 rev 18→19 |
| A-1 | `/p/<A>/settings` | 390×844 | 통과 | A-1-390x844-before.png<br>A-1-390x844-data.png<br>A-1-390x844-credits.png<br>A-1-390x844-levels.png<br>A-1-390x844-slider.png | 8241aa1d8a94<br>f120eae73f30<br>46889c15f866<br>55f728fa0269<br>0c2ec7117815 | `확인390` rev 20→21 · IP 30→35 rev 21→22 · 비우기 rev 22→23. DB 교차 확인(마지막): `24\|["단계","작업","활동","확인1440","확인1440b","확인1440c","확인1280","확인768","확인390"]`, 이력은 저장마다 1행(편집기 edit, 가져오기 internal) |
| A-2 | `/projects` 새 프로젝트 모달 | 1440×900 | 통과 | A-2-1440x900-ok.png<br>A-2-1440x900-fail.png | 3ebf389933f7<br>da00831eeeb8 | 성공: `눈확인 1440x900`, 단계 `단계, 작업`, 설명·날짜 빈 값 → 모달 닫힘·라이브러리에 표시, DB 1행·rev 1·labels ["단계","작업"]. 실패: 단계 칸이 비면 생성 버튼 비활성(제출 불가) → `,` 만 넣어 빈 라벨 목록 → 모달 안 `단계가 최소 1개 필요합니다.`, 프로젝트 0행. 서버 결과(실패) 경로는 단위 테스트(`tests/ui/new-project-modal.test.tsx:93`) — 화면에서 서버 실패를 만들 수 없다 |
| A-2 | `/projects` 새 프로젝트 모달 | 1280×720 | 통과 | A-2-1280x720-ok.png<br>A-2-1280x720-fail.png | d3d566871c9c<br>e2610b808f74 | 같음 |
| A-2 | `/projects` 새 프로젝트 모달 | 768×1024 | 통과 | A-2-768x1024-ok.png<br>A-2-768x1024-fail.png | b411dff69320<br>c0e7955a8f65 | 같음 |
| A-2 | `/projects` 새 프로젝트 모달 | 390×844 | 통과 | A-2-390x844-ok.png<br>A-2-390x844-fail.png | 0bea7f133103<br>a49caaf75927 | 같음. 실패 문구는 클라이언트 사전 검증이 낸다(서버 `parseLevelLabels` 와 규칙이 같아 서버까지 가는 빈 라벨은 화면에서 만들 수 없다) |
| A-3 | `/p/<A>/import` 완료 화면 | 1440×900 | 통과 | A-3-1440x900.png | 5be97bdcd3b2 | 엑셀 탭 → E2E 의 채운 양식 → 전체 교체 + 양식 저장 → `프로파일 저장` 셀 `저장됨`(3열 중 셋째, x 1046·y 394·w 328), rev 11→12. **경고 블록 상태는 단위 테스트**(`import-wizard-profile-save-warning`) — 실행 중인 서버에서 만들 수 없다 |
| A-3 | `/p/<A>/import` 완료 화면 | 1280×720 | 통과 | A-3-1280x720.png | 2ac7c79e1c03 | 셀 x 939·y 304·w 275, rev 15→16. 상태는 단위 테스트 |
| A-3 | `/p/<A>/import` 완료 화면 | 768×1024 | 통과 | A-3-768x1024.png | ccc5263c6f82 | 셀 x 518·y 336·w 192, rev 19→20. 상태는 단위 테스트 |
| A-3 | `/p/<A>/import` 완료 화면 | 390×844 | 통과 | A-3-390x844.png | dc6e2c45dd6a | 한 열로 접힘(셀 x 44·y 372·w 302), rev 23→24. 상태는 단위 테스트 |
| A-4 | `/p/<B>/{dashboard,wbs,settings}` | 1440×900 | wbs·settings 통과 / dashboard 는 설계상 단계 이름을 읽지 않음 → 통과(보충 — Ruling [T34 A-4]) | A-4-dashboard-1440x900.png<br>A-4-wbs-1440x900.png<br>A-4-settings-1440x900.png<br>A-4-dashboard-kw-1440x900.png | d2e79a2674a4<br>d3ee6d7b4bd4<br>530014981b94<br>55e84767fad9 | `core.level_labels` → `42`(브리프 명령) 뒤: wbs 는 화면 대신 `설정을 불러오지 못해…` + `손상되었거나 비어 있는 설정: core.level_labels`, settings 는 WBS 단계 절 자리에 같은 오류(나머지 절은 그림). **dashboard 는 오류 상태 없이 정상 화면** — 대시보드는 `core.level_labels` 를 읽지 않는다(`dashboard/page.tsx:61`, 과제 27·C1 리뷰의 valueOf 계약 "그 키를 쓰는 기능만 멈춘다"), 라벨을 쓰는 요소도 없어 기본값으로 그린 것도 아니다. 보충: 대시보드가 읽는 `core.milestone_keywords` 를 같은 방식으로 손상 → 오류 상태(키 이름) + 뷰는 계속 그림(`-kw`). 복원: labels `["단계","작업","활동"]`(rev 1 그대로), 키워드는 원래 없던 키라 제거 |
| A-4 | `/p/<B>/{dashboard,wbs,settings}` | 1280×720 | 같음 | A-4-dashboard-1280x720.png<br>A-4-wbs-1280x720.png<br>A-4-settings-1280x720.png<br>A-4-dashboard-kw-1280x720.png | 374147431133<br>4c0be98c3f3d<br>e8b35935e69f<br>fd47650db439 | 같음 |
| A-4 | `/p/<B>/{dashboard,wbs,settings}` | 768×1024 | 같음 | A-4-dashboard-768x1024.png<br>A-4-wbs-768x1024.png<br>A-4-settings-768x1024.png<br>A-4-dashboard-kw-768x1024.png | 498450732d75<br>d25050c88e7f<br>dc5018d7fc67<br>f60c2f1dc2b0 | 같음 |
| A-4 | `/p/<B>/{dashboard,wbs,settings}` | 390×844 | 같음 | A-4-dashboard-390x844.png<br>A-4-wbs-390x844.png<br>A-4-settings-390x844.png<br>A-4-dashboard-kw-390x844.png | f5acf5aafb94<br>34eeb5259509<br>f5e3b3cb588d<br>688e4692e63c | 같음. 손상 화면마다 브라우저 콘솔에 `[settings] invalid …`(서버 로그의 dev 전달 — 해석기의 키당 로그)와 dev 오버레이 `1 Issue` 배지 |

## 비고(Phase A)

- **f5abb35(C2 수정 라운드 1)의 화면 변경** — 위 행이 닿지 않아 따로 봤다(같은 워크트리·3101, 깨끗한 DB, 프로젝트 `충돌확인`):
  - 양식 비우기 충돌 토스트: 탭 1 이 설정 화면을 연 뒤 탭 2 가 마크를 더한 양식으로 다시 가져와 같은 키를 바꿈(rev 7→8) → 탭 1 비우기 → 토스트
    `양식을 비우지 못했습니다` / `다른 사용자가 설정을 먼저 바꿨습니다. 최신 값을 확인한 뒤 다시 저장하세요.`, 모달 닫힘, refresh 뒤 버튼 남음 → 다시 누르면 비워짐(rev 9).
    `F5-clear-conflict-toast-1440x900.png` 6dbf03c0397b. 다른 키만 바뀌었을 때는 자동 재기준으로 성공, 이미 빈 키를 비우면 쓰지 않고 성공한다(설계대로).
  - 비보안 컨텍스트(`http://<LAN IP>:3101`, `isSecureContext` false, `crypto.randomUUID` 없음)에서 단계 이름 저장 rev 9→10, 페이지 오류 0.
    `F5-insecure-save-1440x900.png` 9c42f00fcd3e.
- **CARRY 1(과제 25 리뷰 m3)**: `dev:bootstrap` 뒤 `default` 의 `modules.allowed` = 비core 13개(rev 1, 이력 internal 1행). 0012 ⑫ 사후검사 DO 블록을 그 DB 에서 다시 → `DO`.
- **CARRY 2(C1 리뷰 M-1)**: `<A>` 의 `core.milestone_keywords`(`["kick-off","오픈"]`) → `42` → `/p/<A>/dashboard` 1440×900: 맨 위 오류 상태(키 이름), 나머지 카드는 그림.
  **마일스톤 카드는 "감지된 마일스톤이 없습니다…"(빈 목록 문구), 요약의 다음 마일스톤은 "예정 마일스톤 없음"** — 카드 안에 손상 사유가 없다(M-1 관찰 그대로,
  Phase B 메모). `CARRY2-dashboard-1440x900.png` 09a162f40fb5, 손상 전 대조 `CARRY2-dashboard-before-1440x900.png` b8a893954b90(같은 카드 문구 — `<A>` 의 WBS 에
  키워드 일치 항목이 없다). 복원 확인.
- **CARRY 3(C1 리뷰 M-6)**: 권한 없는 bea 로 `/p/<A>/dashboard` → 404, dev.log `[settings] 페이지 설정 조회 실패` **1줄**(console.error, `{ projectId, cause }`),
  `/p/<A>/wbs` → 404 **1줄**, `/p/<A>/settings` → 404 **0줄**. 이름 노출 없음. E2E 의 숨은 프로젝트 방문 5회도 방문당 1줄.
  `CARRY3-bea-settings-notfound-1440x900.png` 7fec01f01f18.
- **CARRY 4(C2 수정 라운드 3 M-3 · 라운드 4 P-1)**: 서버 액션 HTTP(E2E 하네스 방식). `default` 의 `invites.allowed_domains` 를 service_role `apply_workspace_settings`
  로 `["xn--bj0bj06e.test","example.com"]`(`한글.test` 의 퓨니코드 — `updateWorkspaceSettings` 를 import 하는 페이지가 Phase A 에 없다) →
  `createProjectInvite(<A>, idn1@한글.test)` → 초대 행 `idn1@xn--bj0bj06e.test` → 응답 링크로 새 세션 가입·수락 → 명단 member·people 1행 연결.
  인물 원장 경로: `upsertRosterMember(<A>, idn2@한글.test, 권한 없음)` → people 저장값 `idn2@xn--bj0bj06e.test`(계정 없음) → 같은 주소 초대·가입·수락 →
  **people 에 그 이메일 1행, user_id 연결, 명단 행 1개가 member 로** — 두 경로 모두 통과.
- **CARRY 5**: 전체 vitest(617 파일 · 7678)와 test:rls(26 · 282)는 첫 실행에서 초록 — 부하 플레이크 없음. E2E 1회차의 render-pages ✗ 는 같은 규칙(이름·원인·load 기록 → 한 번
  재실행)으로 처리했고 재실행 초록 — "부하 의존 플레이크 — render-pages(/issues 첫 컴파일 중 팀 마스터 첫 로드 3초 초과)"(`sp3a-e2e.md` 4절).

# Phase A 최종 수정(눈확인 A-5~A-9)

| 항목 | 값 |
|---|---|
| 트리 | `sp3a/phase-a` `cbf186d` — 최종 수정 코드 커밋 전부(88f8bfd·267d316·8a374b0·f436fc9·d3777d5·bb76679·320e8e2·b8e6e93·cbf186d) |
| 일시 | 2026-09-29 04:19~04:28 KST |
| 서버 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp3a-final` 의 `next dev -p 3101`(Next.js 15.5.19, Node 22.18.0, `NODE_OPTIONS=--max-old-space-size=8192`) — 최종 수정 E2E 2회차(`sp3a-e2e.md` 6절) 직후의 DB. 사용자의 :3000 은 건드리지 않음 |
| 계정 | 부트스트랩 관리자(`admin@example.com`, 플랫폼 관리자). 비밀번호는 스크립트가 service_role 로 실행마다 새 임의 값을 넣어 메모리에서만 썼다 |
| 도구 | 헤드리스 Chromium 145.0.7632.6(Playwright 1.58.2, npx 캐시), 라이트, 로케일 ko-KR(A-9 만 en) |
| 크기 | 1440×900 · 1280×720 · 768×1024 · 390×844(A-9 는 1440×900 하나) |
| 대상 | `<A>` = 최종 수정 E2E 의 A(`aa36ef51-7759-4364-8a70-c5b1c617d4f5` — 뒤의 `db:reset` 으로 사라진 로컬 id) |
| 손상 방법 | postgres 로 `project_settings."values"` 를 `jsonb_set(…, '42')`(과제 34 와 같이 RPC 를 거치지 않는 수동 손상) — 확인 뒤 원래 값으로 되돌림 |
| 판정 | 화면(문구·요소 수)과 DB(`project_settings` revision·values, `/api/export` 응답 본문)를 둘 다 대조. 모든 행에서 오류 경계 0 |

| # | 라우트 | 크기 | 결과 | 스크린샷 | 해시 | 비고 |
|---|---|---|---|---|---|---|
| A-5 | `/p/<A>/settings` 'Excel 내보내기'(FN-7) | 1440×900 | 통과 | A-5-1440x900.png | 49dd6d5b10ea | `core.level_labels` → `42` 뒤 버튼 → `/api/export` 422 `{code: CONFIG_INVALID, key: core.level_labels}` → 토스트 `내보내기에 실패했습니다` / `WBS 단계 이름 설정이 손상되었거나 없어 내보낼 수 없습니다 — 설정 화면의 WBS 단계 이름을 확인하세요.` 옛 처방(`저장된 엑셀 양식이 손상되었습니다 … 양식을 비우세요`) 0건. `<A>` 에는 저장 양식이 있어 '저장된 양식 비우기' 버튼이 그대로 보인다(비우라는 안내는 없다) |
| A-5 | 같음 | 1280×720 | 통과 | A-5-1280x720.png | c85e5f3ecb9c | 같음 |
| A-5 | 같음 | 768×1024 | 통과 | A-5-768x1024.png | 5175b3027f2e | 같음 |
| A-5 | 같음 | 390×844 | 통과 | A-5-390x844.png | 2d1930e6bd98 | 같음 |
| A-6 | `/p/<A>/settings` 두 탭(FN-2) | 1440×900 | 통과 | A-6-1440x900.png | 42ff53291673 | 탭 1 이 화면을 연 뒤(rev 3) 탭 2 가 셋째 단계를 `탭2-1440` 으로 저장(rev 4) → 탭 1 이 형제 편집기(크레딧 RW 50→55) 저장 = 자동 재기준으로 성공(rev 5, 저장됨 표시) → 탭 1 의 단계 편집기(refresh 뒤에도 옛 초안 `단계·작업·활동`)에서 첫 이름을 고쳐 저장 → `다른 사용자가 설정을 먼저 바꿨습니다. 최신 값을 확인한 뒤 다시 저장하세요.`(role=alert). DB 는 탭 2 의 값 그대로(rev 5) — 옛 초안이 덮지 않았다 |
| A-6 | 같음 | 1280×720 | 통과 | A-6-1280x720.png | 90638b554852 | rev 5→6(탭 2 `탭2-1280`)→7(크레딧) → 충돌 문구, DB 는 탭 2 값 |
| A-6 | 같음 | 768×1024 | 통과 | A-6-768x1024.png | d7fcff1ff942 | rev 7→8→9 → 충돌 문구, DB 는 탭 2 값 |
| A-6 | 같음 | 390×844 | 통과 | A-6-390x844.png | e63ef297099a | rev 9→10→11 → 충돌 문구, DB 는 탭 2 값. 확인 뒤 단계 이름을 `단계·작업·활동` 으로 되돌림 |
| A-7 | `/p/<A>/agents`(FN-8) | 1440×900 | 통과 | A-7-1440x900-hub.png<br>A-7-1440x900-detail.png | 7aedc9586fa5<br>6686d3dcb417 | `core.level_labels` → `42` 상태에서 허브를 그린다: 상태 줄(`에이전트 상태` — 관리자 토글 버튼 1)·위임 표 5행·승인 대기(`승인 대기 없음`), 누르기 전 오류 상자 0. 이름(`설계`)을 누르면 상세 패널 자리에만 `설정을 불러오지 못해…` + `손상되었거나 비어 있는 설정: core.level_labels`(상태 줄·표·큐는 그대로) |
| A-7 | 같음 | 1280×720 | 통과 | A-7-1280x720-hub.png<br>A-7-1280x720-detail.png | 94183848b8fd<br>a217f3f9d576 | 같음 |
| A-7 | 같음 | 768×1024 | 통과 | A-7-768x1024-hub.png<br>A-7-768x1024-detail.png | 56c01c3d5544<br>3dfea519b5e9 | 같음 |
| A-7 | 같음 | 390×844 | 통과 | A-7-390x844-hub.png<br>A-7-390x844-detail.png | bab3d09d9488<br>394fda555998 | 같음. 브라우저 콘솔은 `[settings] invalid …`(서버 로그의 dev 전달)와 내보내기 422 줄뿐 |
| A-8 | `/p/<A>/wbs`(FM-1 — 키워드 손상 pinned) | 1440×900 | 통과 | A-8-wbs-kw-1440x900.png | f14af304680e | `core.milestone_keywords` → `42` 뒤: 머리(pinned)에 `손상되었거나 비어 있는 설정: core.milestone_keywords`, 간트·표는 그린다(행 5). 복원 `["kick-off","오픈"]` |
| A-8 | 같음 | 1280×720 | 통과 | A-8-wbs-kw-1280x720.png | 940aa2baa6ed | 같음 |
| A-8 | 같음 | 768×1024 | 통과 | A-8-wbs-kw-768x1024.png | 27cf966f7362 | 같음 |
| A-8 | 같음 | 390×844 | 통과 | A-8-wbs-kw-390x844.png | 46cf9d972e15 | 같음(사유 상자가 머리에 남고 간트가 아래에 그려진다) |
| A-9 | `/p/<A>/{wbs,settings}` en(FM-1 — A-4 의 en 1크기) | 1440×900 | 통과(관찰 1) | A-9-wbs-en-1440x900.png<br>A-9-settings-en-1440x900.png | fce0f9464b91<br>9f1db660cb23 | 단계 이름 손상 + en: 제목 `Settings could not be loaded, so this view cannot be drawn. Refresh in a moment.`·키 줄 `Corrupt or missing setting: core.level_labels`, wbs 는 화면 대신, settings 는 WBS Levels 절 자리에. **셋째 줄(서버 문구 `설정 값이 올바르지 않습니다. (core.level_labels)`)은 한국어** — CR-13(Phase C ConfigStateNotice 교체 때 셋째 줄 제거)의 관찰 그대로. 서버에 저장된 UI 설정 언어가 쿠키를 이겨(PrefsSync) 확인 동안만 `user_preferences.prefs.locale` 을 en 으로 두고 ko 로 되돌림 |

# Phase B(과제 28)

| 항목 | 값 |
|---|---|
| 트리 | `sp3a/phase-b` `178a4babf6de21067ae54efba992c0aad506eebc` |
| 일시 | 2026-09-30 09:50~09:53 KST (3회차, 22/22 통과) |
| 서버 | 스크래치 워크트리 `/Users/jerry/D-Flow-wt/sp3a-b-26` 의 `next dev -p 3101`(Next.js 15.5.19, Node 22.18.0) — E2E(`docs/baseline/sp3a-e2e.md` 3절) 직후의 DB. 사용자의 :3000 은 건드리지 않음 |
| 계정 | 부트스트랩 관리자 1개(`admin@example.com`, 플랫폼 관리자) — Phase B 화면은 **모듈만** 본다(등급별 화면 차이 없음 — Phase A 절과 같은 관례). 비밀번호는 스크립트가 env 로만 받아 메모리에서 썼다(출력·파일 없음) |
| 도구 | 헤드리스 Chromium(Playwright 1.63.0, npx 캐시 — `package.json` 에 없음), 라이트(`colorScheme: 'light'`), `reducedMotion: 'reduce'`, 로케일 ko-KR |
| 크기 | 1440×900 · 1280×720 · 768×1024 · 390×844 (B-2·B-3·B-4 는 1440·390, B-1 만 네 크기) |
| 대상 | `<A>` = E2E A(`482539e8-d9fd-4cff-964a-56ab72e89153` — `issues`·`agents`·`chatbot` 꺼짐), `<B>` = E2E B(`28f43d04-8017-4e61-a63c-6c3c14407574` — 9모듈 켜짐). 뒤의 `db:reset` 으로 사라지는 로컬 id |
| 판정 | 조작 뒤 DB(`project_settings.values`·`agent_projects.enabled`)와 새로고침 뒤 화면을 둘 다 대조. 22개 항목 전부 통과. 모든 행에서 오류 경계(Next 오류 문서·`(app)/error.tsx`) 0 |
| 스크린샷 | 커밋하지 않는다 — 아래 해시는 파일 식별용 `shasum -a 256` 앞 12자다 |

| # | 라우트 | 크기 | 결과 | 스크린샷 | 해시 | 비고 |
|---|---|---|---|---|---|---|
| B-1 | `/p/<A>/wbs` ↔ `/p/<B>/wbs` | 1440×900 · 1280×720 · 768×1024 · 390×844 | 통과 | B-1-A-wbs-{1440,1280,768,390}.png<br>B-1-B-wbs-{1440,1280,768,390}.png | A: 196494108f6c · f28a08b83498 · 7fe13ab1b8fd · 76fd20aebe3b<br>B: c1c5bc2aae4d · 1c1e26d8c8e8 · 22ee3b0ac01a · 4d3b461c04ca | 챗봇 FAB(`button[aria-label="AI 어시스턴트 열기"]`)가 **A 에는 0개 · B 에는 1개**, 네 크기 모두. 두 화면 다 404 아님·설정 오류 상태 아님. DB 대조: A `["kanban","meetings","weekly","announcements","attendance","wiki"]` / B `["kanban","meetings","weekly","issues","announcements","attendance","agents","wiki","chatbot"]` |
| B-1 | 전환: B 에서 패널을 연 채 A 로 | 1440×900 | 통과 | B-1-B-panel-open-1440.png<br>B-1-after-switch-1440.png | 297f940c7c4a · 8c1f012958cc | B 에서 FAB 를 눌러 패널(`role="dialog"`) 1개 → A 로 옮기면 **다이얼로그 0 · FAB 0**(패널이 닫히고 진입점도 사라진다). 스크립트는 헤더에서 'E2E A'/'E2E B' 글자를 가진 버튼·링크를 찾았으나 0개여서(헤더에 프로젝트 전환기가 이 형태가 아니다) URL 이동으로 대신했다 — 판정에는 영향 없다 |
| B-2 | `/p/<A>/issues` · `/p/<A>/agents` | 1440×900 · 390×844 | 통과 | B-2-A-issues-{1440,390}.png<br>B-2-A-agents-{1440,390}.png | issues·agents 1440: 7fec01f01f18(둘이 동일 — 같은 404 화면) · 390: 8dbaab029cb1 | 꺼진 모듈 URL 은 **not-found 화면**(`NEXT_HTTP_ERROR_FALLBACK;` digest)이고 **오류 경계가 아니다**(Next 오류 문서·`화면을 불러오지 못했습니다` 없음) |
| B-2 | `/p/<A>/wbs` 사이드바 | 1440×900 · 390×844 | 통과 | B-2-A-wbs-sidebar-{1440,390}.png | 196494108f6c · 76fd20aebe3b | 꺼진 상태에서도 사이드바에 `/p/<A>/issues` 1개와 `/p/<A>/agents/office` 1개가 **남아 있다**(스펙 §2.1 — SP3b UI-2 까지). 켜진 모듈 화면은 정상. **주의:** 사이드바의 에이전트 항목 href 는 `/agents/office`(스튜디오)다 — `/agents` 는 그 항목의 활성 접두일 뿐(`Sidebar.tsx:62`)이라 `/agents` 로 찾으면 0개가 나온다. 또 404 화면에는 셸째가 없어 **사이드바가 없다** — 링크 잔존은 셸이 있는 화면에서 봐야 한다 |
| B-3 | `/p/<A>/settings` 에이전트 카드 | 1440×900 · 390×844 | 통과 | B-3-1-stopped-{1440,390}.png | 7d4b6e62b65f · 408bef2957b3 | 모듈이 꺼진 상태: 칩 `에이전트 중지` · 버튼 `재개` · **안내문 '에이전트 모듈이 꺼져 있습니다.' 1개** · 크레딧 블록(개발 워크플로 크레딧) 1개 — 크레딧 편집기가 남아 있다(스펙 §4.4 넷째 줄). DB: `modules.enabled` 에 `agents` 없음 ∧ `agent_projects.enabled` false |
| B-3 | 재개 → 새로고침 | 1440×900 | 통과 | B-3-2-resumed-1440.png | ff6efffdae11 | 새로고침에 칩 `에이전트 활성` · 버튼 `전체 중지` · 안내문 0 · 크레딧 블록 유지. DB: `modules.enabled` 에 `agents` 있음 ∧ 행 true — **두 원천이 같이 바뀐다** |
| B-3 | 다시 중지 | 1440×900 | 통과 | B-3-3-restopped-1440.png | 0ebfea2258c5 | 칩 `에이전트 중지` · 안내문 1 · DB 도 `modules.enabled` 에서 빠지고 행 false(E2E 가 남긴 상태로 복귀) |
| B-4 | `/p/<B>/dashboard` · `/p/<B>/wbs` (설정 손상) | 1440×900 · 390×844 | 통과 | B-4-dashboard-{1440,390}.png<br>B-4-wbs-{1440,390}.png | aaaf6b60923f · 2d90008ddd29 · 1aa16c80bfb0 · 807297281343 | `core.level_labels` 와 `core.milestone_keywords` 를 `42` 로 손상 → 네 화면 모두 **404 가 아니라 Phase A 의 오류 상태**(Plan Review Focus 3 — core 관문은 설정을 읽지 않는다). `설정을 불러오지 못해 이 화면을 그릴 수 없습니다` 문구 확인 |
| B-4 | 복구 뒤 `/p/<B>/wbs` | 1440×900 | 통과 | B-4-restored-wbs-1440.png | 4d3b461c04ca | `core.level_labels = ["단계","작업","활동"]` 로 되돌린 뒤 정상(해시가 B 의 원본 캡처와 동일 — 화면이 정확히 복구됨) |

## 비고(Phase B)

- **B-1의 "패널이 닫힌다"는 클라이언트 판정이다** — 위젯은 프로젝트 전환 때 `GET /api/chat/context?probe=1` 을 다시 부르고
  404 면 스스로 안 그린다(과제 24 · 판정 P12). 그래서 A 로 옮긴 뒤에는 **패널과 FAB 이 둘 다 없다**. 404 응답을 실제로
  받아 그렸다면 위젯이 남았어야 한다.
- **B-4의 복구는 `values` 통째로 되돌렸다** — 손상 전 `project_settings.values` 전문을 스크립트 메모리에 저장했다가
  그대로 `$json$…$json$::jsonb` 로 되돌렸다. 복구 후 캡처 해시가 B 의 원본 캡처와 같다(위 표).
- **1·2회차는 무효다** — 1회차는 서브에이전트 리뷰와 dev 서버 워밍업이 겹쳐 타임아웃으로 잘렸다. 그때 B-4 에서
  손상해 둔 `<B>` 설정을 복구하기 전에 죽어 **3회차 시작 시 `<B>` 의 `core.level_labels` 가 이미 `42` 였다**
  (그래서 2회차의 B-1 네 항목이 "B 화면이 설정 오류 상태"로 실패했다). 2회차는 그 사실을 스크립트가 모르고
  "손상 전" 값을 `42` 로 저장·복구해 B-4 복구가 무효가 되었다. 3회차는 DB 를 직접 되돌린 뒤 돌렸고,
  손상 전 값이 `["단계","작업","활동"]` 임을 로그에 남겼다. **실결함 아님 — 측정 절차의 문제였다.**
- **눈확인 결과는 스크립트 판정 22개뿐이다** — B-1 의 네 크기 × 2 화면처럼 같은 사실을 여러 번 찍는 행이 있다.
  사람 눈으로 다시 볼 필요는 없고, 사람이 볼 것은 `Preview-checked` 트레일러와 여기 표다.


# Phase C(눈확인 C)

| 항목 | 값 |
|---|---|
| 트리 | `ui/sp3a-settings` — 첫 측정은 `652cf12`, 수정 뒤 재확인은 `5f3ab4a`(둘 다 전용 스택 워크트리 `sp3a-c-visual` 의 같은 커밋) |
| 일시 | 2026-10-01 오전(KST) — E2E 직후부터 수정 재확인까지 |
| 서버 | `next dev -p 3101`(Next.js 15.5.19, `--max-old-space-size=4096`), 사용자의 :3000·메인 스택은 건드리지 않음 |
| DB | 전용 로컬 스택 `d-flow-sp3a-c-visual`(api 54521 · db 54522), `db:reset` → `dev:bootstrap` → E2E 29단계 직후의 상태 |
| 계정 | 플랫폼 관리자 `admin@example.com`(비밀번호는 스크래치 파일 — 출력·커밋 없음) + service_role 로 만든 임시 계정 셋(① A 워크스페이스 관리자·비플랫폼 ② A 프로젝트 일반 멤버 ③ B 워크스페이스 관리자). 끝나고 계정·소속 행·비밀번호 파일 삭제 |
| 도구 | 헤드리스 Chromium(Playwright, npx 캐시 — `package.json` 에 없음), 라이트, ko-KR |
| 판정 | 조작 뒤 DB(`*_settings` revision·values·이력)와 새로고침 뒤 화면을 둘 다 대조. 설정은 매 행 뒤 기준선으로 복원하고 재조회로 검증. 스크린샷은 커밋하지 않고 파일명과 해시 앞 12자만 적는다 |
| 눈확인 절차 규칙(uI28) | 손상시키기 전에 그 키의 현재 값이 이미 손상 값이면 멈춘다 — Phase B 에서 가드 없이 오염된 적이 있다. 이번엔 가드를 거쳐 통과(`c6-proj-corrupt-slot`) |

| # | 라우트 | 크기 | 결과 | 스크린샷 | 해시 | 비고 |
|---|---|---|---|---|---|---|
| C-1 | /p/A/settings(admin) | 1440 | 통과 | c1-admin-1440-top.png; c1-admin-1440-bottom.png; c1-admin-1440-search.png; c1-admin-1440-modules.png | 97522b52462c; bottom 18f423d713e9 | 목차 6개 클릭 모두 해당 범주로 스크롤(대상 top≈222px, 화면 안). 검색 'level'→13개 중 2개(WBS 단계·기록)만 남고 'zzzzqq'→0, 지우면 13 복원. 담당 영역 탭·core.extra_axis_label 없음. 공개 범위 스위치: 플랫폼 관리자에만(비플랫폼 ①에겐 없음, 1440 확인). 오류경계 0, 가로 스크롤 없음. 프로젝트 설정 화면에는 sticky 저장 바가 없다(전용 편집기별 저장 버튼) — 바닥 스크롤에서 고정/sticky 요소와 입력 겹침 0. 콘솔 error 1건=/api/chat/context?probe=1 404(chatbot 모듈 꺼짐, 기대). 중복 id project-modules ×2(D2). |
| C-1 | /p/A/settings(admin) | 1280 | 통과 | c1-admin-1280-top.png; c1-admin-1280-bottom.png | 1d0a08d95618; bottom e312368206a9 | 목차 6개 클릭 모두 해당 범주로 스크롤(대상 top≈164px, 화면 안). 검색 'level'→13개 중 2개(WBS 단계·기록)만 남고 'zzzzqq'→0, 지우면 13 복원. 담당 영역 탭·core.extra_axis_label 없음. 공개 범위 스위치: 플랫폼 관리자에만(비플랫폼 ①에겐 없음, 1440 확인). 오류경계 0, 가로 스크롤 없음. 프로젝트 설정 화면에는 sticky 저장 바가 없다(전용 편집기별 저장 버튼) — 바닥 스크롤에서 고정/sticky 요소와 입력 겹침 0. 콘솔 error 1건=/api/chat/context?probe=1 404(chatbot 모듈 꺼짐, 기대). 중복 id project-modules ×2(D2). |
| C-1 | /p/A/settings(admin) | 768 | 통과 | c1-admin-768-top.png; c1-admin-768-bottom.png | 54c1aea1653b; bottom 5b90e866740d | 목차 6개 클릭 모두 해당 범주로 스크롤(대상 top≈164px, 화면 안). 검색 'level'→13개 중 2개(WBS 단계·기록)만 남고 'zzzzqq'→0, 지우면 13 복원. 담당 영역 탭·core.extra_axis_label 없음. 공개 범위 스위치: 플랫폼 관리자에만(비플랫폼 ①에겐 없음, 1440 확인). 오류경계 0, 가로 스크롤 없음. 프로젝트 설정 화면에는 sticky 저장 바가 없다(전용 편집기별 저장 버튼) — 바닥 스크롤에서 고정/sticky 요소와 입력 겹침 0. 콘솔 error 1건=/api/chat/context?probe=1 404(chatbot 모듈 꺼짐, 기대). 중복 id project-modules ×2(D2). |
| C-1 | /p/A/settings(admin) | 390 | 결함(D1) | c1-admin-390-top.png; c1-admin-390-bottom.png; c1-admin-390-aiindex-overflow.png | 995c9a8cc69f; bottom 6f84926726a2; overflow 98f651a679cd | 목차 6개 클릭 모두 해당 범주로 스크롤(대상 top≈164px, 화면 안). 검색 'level'→13개 중 2개(WBS 단계·기록)만 남고 'zzzzqq'→0, 지우면 13 복원. 담당 영역 탭·core.extra_axis_label 없음. 공개 범위 스위치: 플랫폼 관리자에만(비플랫폼 ①에겐 없음, 1440 확인). 오류경계 0, 가로 스크롤 없음. 프로젝트 설정 화면에는 sticky 저장 바가 없다(전용 편집기별 저장 버튼) — 바닥 스크롤에서 고정/sticky 요소와 입력 겹침 0. 콘솔 error 1건=/api/chat/context?probe=1 404(chatbot 모듈 꺼짐, 기대). 중복 id project-modules ×2(D2). **결함 D1**: 390에서 "AI 색인 재생성"·"관리 화면 열기" 버튼이 카드 우측 밖으로 잘림(main 안쪽 scrollWidth 446>382). |
| C-2 | /w/default/settings(admin(플랫폼)) | 1440 | 통과 | c2-admin-1440-top.png; c2-admin-1440-bottom.png | top eec4938488c0; bottom 39c99d1fb35a | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 있음(기대: 있음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 있음("팀 관리"). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. 가로 스크롤 없음. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(admin(플랫폼)) | 1280 | 결함(D3) | c2-admin-1280-top.png; c2-admin-1280-bottom.png | top e51bf4b53190; bottom b00067223dc6 | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 있음(기대: 있음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 있음("팀 관리"). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. **가로 스크롤(D3)**: MAIN.min-h-0 w-full flex-1 overflow-y-auto px sw=1094 cw=1032. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(admin(플랫폼)) | 768 | 결함(D3) | c2-admin-768-top.png; c2-admin-768-bottom.png | top fe7822468625; bottom 8d1128b5d3c9 | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 있음(기대: 있음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 있음("팀 관리"). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. **가로 스크롤(D3)**: MAIN.min-h-0 w-full flex-1 overflow-y-auto px sw=843 cw=768. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(admin(플랫폼)) | 390 | 통과 | c2-admin-390-top.png; c2-admin-390-bottom.png | top 0563b675cda5; bottom 7bdd08724b1f | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 있음(기대: 있음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 있음("팀 관리"). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. 가로 스크롤 없음. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(① wsa(비플랫폼)) | 1440 | 통과 | c2-wsa-1440-top.png; c2-wsa-1440-bottom.png | top bf42c2eef24d; bottom 4d4d79fd85b2 | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 없음(기대: 없음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 없음(문구만). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. 가로 스크롤 없음. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(① wsa(비플랫폼)) | 1280 | 결함(D3) | c2-wsa-1280-top.png; c2-wsa-1280-bottom.png | top 9716d8eaf8f0; bottom dd7681307de7 | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 없음(기대: 없음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 없음(문구만). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. **가로 스크롤(D3)**: MAIN.min-h-0 w-full flex-1 overflow-y-auto px sw=1094 cw=1032. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(① wsa(비플랫폼)) | 768 | 결함(D3) | c2-wsa-768-top.png; c2-wsa-768-bottom.png | top b7b5611774c1; bottom 79ac207dc158 | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 없음(기대: 없음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 없음(문구만). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. **가로 스크롤(D3)**: MAIN.min-h-0 w-full flex-1 overflow-y-auto px sw=843 cw=768. 입력칸 테두리 없음(D4) |
| C-2 | /w/default/settings(① wsa(비플랫폼)) | 390 | 통과 | c2-wsa-390-top.png; c2-wsa-390-bottom.png | top 0563b675cda5; bottom e92dd8d233e9 | 목차 5개(일반/모듈·AI/초대/메뉴/기록). 모듈 허용 구역(모듈 사용 범위) 없음(기대: 없음). 초대 범주 공용 팀 안내 1건, /admin/teams 링크 없음(문구만). 저장 바 3개: 각 편집기 끝에서 마지막 입력과 겹침 없음(저장 바가 입력 아래 55~62px). 오류경계 0·콘솔 error 0. 가로 스크롤 없음. 입력칸 테두리 없음(D4) |
| C-3 | /w/default/settings (admin) | 1440 | 통과(관찰 D5) | c3-ws-sources.png; c3-ws-source-set.png; c3-ws-nochange-trim.png | eec4938488c0; 3ee7a6e9cb41; e116d9f4c269 | 출처 라벨: 제품 이름·메일 발신 이름·AI 기능 "제품 기본값", 초대 허용 도메인 "배포 기본값"(env), 제품 이름 저장 뒤 새로고침 "워크스페이스 설정". 변경 없음이면 저장 버튼 disabled. 제품 이름 뒤에 공백 1칸만 붙여 저장 → "바뀐 값이 없습니다." 표시, DB revision 4→4 불변. 새로고침 뒤 값 유지. (D5: 메일 발신 이름에 공백만 넣고 저장하면 클라이언트가 null 을 set 으로 보내 revision 2→3 이 오르고 출처가 "워크스페이스 설정"으로 바뀜 — 의미상 무변경인데 이력이 남음.) 원복: RPC unset 두 키, DB 값=기준선 재조회 일치(revision 5). |
| C-3 | /p/A/settings (admin) | 1440 | 통과 | c3-proj-review.png; c3-proj-nochange.png | 9b947e7bc0f6; 69d3836a35c4 | 마일스톤 키워드 "kick-off"→"Kick-Off" → 변경 내용 검토 패널(현재/변경) → 검토 후 저장 → "바뀐 값이 없습니다." DB revision 10→10 불변, 새로고침 뒤 "kick-off/오픈" 유지, 출처 라벨 "프로젝트 설정 · 즉시 적용". |
| C-4 | /p/A/settings 모듈·메뉴 (admin) | 1440 | 통과 | c4-review.png | 5d3e27686610 | 회의·위키 체크 해제 → 변경 내용 검토: "제외: 회의, 위키 / 회의: 회의 1건 / 위키: 위키 주제 0건 / 기존 데이터는 삭제되지 않으며…"(안내문 "꺼도 기존 데이터는 삭제되지 않습니다"도 상단에 있음). DB 건수(meetings 1, wiki 0)와 일치. 저장하지 않고 새로고침으로 취소 — DB revision 10 불변, 회의 체크 복원, 기준선과 일치. |
| C-5 | /w/default/settings 제품 이름 (admin 두 컨텍스트) | 1440 | 통과 | c5-ws-conflict.png; c5-ws-after-mine.png | 35a185e7fb81; 1f372d2295ab | 세션1 "눈확인C-가" 저장(rev 5→6) → 세션2(구 revision)가 "눈확인C-나" 저장 → 비교 화면(제품 이름: 내 값 눈확인C-나 / 최신 값 눈확인C-가, "내 값 다시 적용"·"최신 값 사용") 표시, DB 불변(rev 6, 가). "내 값 다시 적용" → 입력값 나 유지·저장 활성 → 저장(rev 7, 값 나), 새로고침 뒤 나. 원복: RPC unset product_name, DB = 기준선 일치(rev 8). |
| C-5 | /p/A/settings 마일스톤 키워드 (admin 두 컨텍스트) | 1440 | 통과 | c5-proj-conflict.png; c5-proj-after-mine.png | a2dd9b6dd406; 8bf2bd2d75ed | 세션1 "alpha" 저장(rev 10→11) → 세션2 "beta" 검토 후 저장 → 비교 화면(내 값 beta, 오픈 / 최신 값 alpha, 오픈), DB 불변. "내 값 다시 적용" → 텍스트 beta 유지 → 검토 후 저장 → rev 12, 값 ["beta","오픈"], 새로고침 뒤 유지. 원복: RPC set ["kick-off","오픈"] → DB = 기준선 일치(rev 13). |
| C-6 | /p/A/settings 마일스톤 키워드 51개·41자 (admin) | 1440 | 통과 | c6-proj-51keywords.png | 4a0a574313d7 | 51개 입력 → 클라이언트 검증이 먼저 막음: 텍스트영역 바로 아래 "입력값을 확인하세요. 키워드는 최대 50개, 각 40자까지 입력할 수 있습니다."(필드 아래), 검토 패널 안 열림, 서버 호출 없음(DB revision 13 불변). 41자 키워드도 같은 문구. |
| C-6 | /w/default/settings 제품 이름 41자·제어문자·도메인 형식 (admin) | 1440 | 통과(관찰 D6) | c6-ws-41chars.png; c6-ws-control-char.png; c6-ws-domain-error.png | dd85b68c065c; 96cb4c744565; d568f0071e4a | 41자: 입력칸 maxLength=40 이 입력·fill 모두 40자로 자름 — 문구 없이 조용히 잘려 40자가 저장됨(rev 8→9; D6 minor: 잘림 안내 없음). 제어문자(U+0007): 서버 거부, 해당 필드 아래 "입력값을 확인하세요. 제어 문자를 넣을 수 없습니다."(DB rev 불변). 초대 도메인 "not a domain!!": 해당 필드 아래 "도메인 형식이 아닙니다: not a domain!!"(rev 불변). 원복: RPC unset product_name, 기준선 일치(rev 10). |
| C-6 | /w/default/settings 패치 거부 (① wsa) | 1440 | 통과 | c6-ws-patch-rejected.png | 1c4ee7233bcd | 화면으로 플랫폼 전용 키를 못 바꾸게 하는 경로는 없음(① 계정엔 모듈 허용 UI 자체가 없음). 대신 ①이 페이지를 연 뒤 DB 에서 그 계정의 workspace_members.role 을 member 로 내리고 저장 → 저장 바 바로 위(16px 위)에 패치 거부 알림 "설정을 저장하지 못했습니다. 권한 없음"(필드 아래 아님), DB revision 10 불변. 역할 admin 으로 원복·확인. |
| C-6 | /p/A/settings 설정 손상 core.milestone_keywords=42 (admin) | 1440 | 통과 | c6-proj-corrupt-slot.png | 4bcd9fee28a0 | 가드 통과(손상 전 값 ["kick-off","오픈"]). 42 주입 후: 키 자리에 "설정이 손상되었습니다. 손상되었거나 비어 있는 설정: core.milestone_keywords / 키워드 목록이어야 합니다. / 설정에서 복구하기", 출처 라벨 "설정 손상 · 즉시 적용". 같은 화면의 모듈 체크·WBS 단계 편집기는 편집 가능(변경 내용 검토 버튼 활성), 대시보드·WBS 200 오류경계 0. 콘솔: 서버 로그 "[settings] invalid …"(dev 서버 로그 전달, 표시=로깅 원칙에 부합). 복구: jsonb_set 로 원래 값 → 재조회 ["kick-off","오픈"], 전 기준선 비교 일치. |
| C-7 | /p/B/agents (admin) — B=E2E B(fa08c1a4, agents 켜짐) | 1440 | 통과 | c7-agents-B.png | 89405c228cec | 상태 바에 "아직 등록 안 됨 — 첫 위임 때 켜집니다 · 프로젝트 설정 → 모듈·메뉴" 링크(/p/B/settings#project-modules). 켜기/끄기 토글·스위치 없음(aria-pressed 버튼은 필터·밀도뿐). 오류경계 0. |
| C-7 | /p/A/agents (admin) — A=E2E A(agents 모듈 꺼짐) | 1440 | 통과(기대된 404) | c7-agents-A.png | 7fec01f01f18 | A 프로젝트는 E2E 가 agents 를 modules.enabled 에서 뺀 상태라 허브가 404 화면("페이지를 찾을 수 없습니다")이다 — 모듈 관문 정상 동작. 그래서 허브 확인은 agents 가 켜진 프로젝트 B 로 대신함. (관찰: 404 문서의 HTTP 상태가 200 — dev 스트리밍 notFound.) |
| C-8 | /projects 새 프로젝트 모달 (admin) | 1440 | 통과 | c8-modal-blank.png; c8-modal-copy.png; c8-modal-corrupt-source.png; c8-copied-settings.png | c76d1508c967; c069ea5d9d65; 2b1d1195fd9b; 6f63d5f23d41 | 라디오 "빈 값으로 시작 / 기존 프로젝트에서 복사"(기본 빈 값). 복사 선택 시 원본 선택 + 문구 "복사합니다: 설정 값·팀·업무영역. 복사하지 않습니다: 멤버·WBS·회의록·이슈." 표시. 원본 E2E A-copy 선택 → WBS 단계 입력이 "국면, 과업, 세부"로 채워짐(원본 값). 실제 생성("눈확인C 복사"): 새 프로젝트 settings 값이 원본과 동일(모듈·core.level_labels·core.milestone_keywords, revision 1), 이력 3행, 멤버 0·WBS 0·팀 0(원본도 0), 새 프로젝트 설정 화면 WBS 단계 국면/과업/세부·키워드 kick-off/오픈. 손상 원본(A2 의 core.level_labels=42 주입): "원본 프로젝트의 설정이 손상되어 복사할 수 없습니다. (core.level_labels)" 알림, 단계 입력 비고 생성 버튼 disabled. 복구: A2 값 원복·기준선 일치. 테스트 프로젝트는 service_role 로 삭제(남은 projects 5개, "눈확인C" 0건). |
| C-9 | /w/default/settings 로고 (admin) | 1440 | 통과(관찰 D7) | c9-logo-selected.png; c9-logo-uploaded-preview.png; c9-logo-saved.png; c9-logo-svg-rejected.png; c9-logo-big-rejected.png; c9-logo-removed.png | e86f618cd798; d9788256349b; 58b58dc52293; 2f259c494a4f; b5c01cd3118c; e5c3a62d6750 | 64×64 PNG 선택 → 선택 파일 미리보기 img src=blob:http://localhost:3101/… (naturalWidth 64). 업로드 → "기본 로고 새 이미지 미리보기" blob: img + "새 이미지 업로드됨 · 저장하면 적용됩니다" + 알림 "…설정을 저장하면 적용됩니다", 이 시점 DB 로고 설정 불변(업로드≠저장). 저장 → DB rev 11 {"full": ws/<id>/branding/full-774718ef486012d7.png, mark:null, full_dark:null}, 새로고침 뒤 /api/brand/<ws>/full img 로드(naturalWidth 64). SVG(.svg) → "PNG·JPEG·WebP 이미지만 올릴 수 있습니다."; 270178바이트 PNG → "로고는 1바이트 이상 256KB 이하여야 합니다."(둘 다 업로드 클릭 뒤 서버 거부, DB 불변). 제거 → "설정된 이미지 없음" → 저장(rev 12, 세 슬롯 null). (D7 minor: 업로드 거부 사유가 "설정을 저장하지 못했습니다." 제목 아래 뜸 — 저장이 아니라 업로드 거부인데 제목이 어긋남.) |
| C-9 | /w/default/settings 강조색 (admin) | 1440 | 통과(관찰 D9) | c9-accent-red.png; c9-accent-yellow.png; c9-accent-valid-preview.png | cd6883400b12; 65a6aa92268b; c490300978f7 | #d32f2f → "입력값을 확인하세요. 상태색(danger)과 색상이 가까워 강조색으로 쓸 수 없습니다." 저장 버튼 disabled. "abc"/"#12345" → "강조색은 #rrggbb 형식이어야 합니다." 유효색 #2e7d32 → 밝은/어두운 미리보기(#2e7d32·#ffffff / #4b994d·#021d03) → 저장 rev 13, DB base+light/dark 세트 저장, 새로고침 뒤 입력 #2e7d32 유지. "기본값으로" → 저장 → DB branding.accent=null(rev 14). **관찰 D9**: 대비 모자란 색으로 예시된 #ffff00 은 거부되지 않음 — 파생기가 밝은 화면 bg 를 #797919 로 어둡게 보정해 통과시킴(#ffffff·#fffff0·#00ffff·#f0f0f0·#000000 도 모두 통과). 대비 실패 거부 문구는 이 입력들로 화면에서 만들 수 없다(추정: 보정 알고리즘 설계상 의도, 스펙 §5.5 대비 거부 문구와 불일치 여부는 사람이 판단). 화면 전체에 accent 적용은 이 Phase 의 레이아웃에 주입 코드가 없어 새로고침 뒤에도 --color-brand 불변(#0f766e) — SP3b UI-1 범위로 추정. 원복: RPC unset branding.logo·branding.accent, 기준선 일치(rev 15). |
| C-11 | /w/default/settings 파비콘 (admin) | 1440 | 통과 | c11-mark-saved.png | 52bb43720ec9 | 마크 없음: <link rel="icon" href="/icon?af432779143f21fe" type="image/png">(루트 아이콘). 마크(32×32 PNG) 업로드·저장(rev 16) 뒤 새로고침: <link rel="icon" href="/api/brand/5fe852d0-…/mark"> 로 바뀌고 해당 URL GET 200 image/png(99B). 마크 제거·저장(rev 17) 뒤 다시 /icon?af432779143f21fe. 관찰: /projects·/p/<A>/settings 는 마크가 있어도 루트 /icon 유지(마크 파비콘은 /w/<슬러그> 하위에만 적용 — 설계 의도로 추정). 원복: RPC unset branding.logo, 기준선 일치(rev 18); 업로드한 스토리지 객체 2개는 service_role 로 삭제(branding 버킷 0건). |
| C-2(보강) | /w/default/settings 모듈 허용 구역·초대 안내 | 1440 | 통과 | c2-wsa-1440-modules-area.png; c2-wsa-1440-invites.png; c2-admin-1440-modules-area.png; c2-admin-1440-invites.png | 4776a6d24c38; 8523e098c80f; a220030f1e87; a4eb1d8f3079 | ① wsa: "모듈·AI" 범주 제목이 "AI 사용"이고 AI 기능 체크만 있음(모듈 허용 편집기 없음). 초대 범주 끝 문구 "공용 팀 기준정보는 플랫폼 관리자가 팀 관리에서 편집합니다."(링크 없음). admin: 모듈 사용 범위 구역 있음, 초대 범주 문구에 "팀 관리" 링크(/admin/teams). |
| C-10 | /projects 설정 링크 (① wsa / ② mem / ③ wsb) | 1440 | 통과 | c10-wsa-projects.png; c10-mem-projects.png; c10-wsb-projects.png | c0d795cb7993; cc3b39840cd3; b9e7fbcb1504 | ① "기본 워크스페이스 설정"(/w/default/settings) 링크 있음. ② 일반 멤버 링크 없음. ③ 자기 워크스페이스 "E2E 타 워크스페이스 설정"(/w/e2e-other/settings)만 있음(A 프로젝트 목록 비노출, 프로젝트 1개). |
| C-10 | /w/<슬러그>/settings 404·리다이렉트 | 1440 | 통과 | c10-wsb-wDefault.png; c10-wsa-wOther.png; c10-mem-wOther.png; c10-wsb-pA.png; c10-mem-wDefault.png; c10-mem-pA.png | 7fec01f01f18(404 화면 공통); 7fec01f01f18; 7fec01f01f18; 7fec01f01f18; caafa4e7a5fb; 1a4196019f0e | ③(비소속)→/w/default/settings: 404 화면("페이지를 찾을 수 없습니다", 문서에 NEXT_HTTP_ERROR_FALLBACK;404 digest). ①→/w/e2e-other/settings: 404. ②(일반 멤버)→/w/e2e-other/settings: 404, →/w/default/settings: /projects 로 리다이렉트(404 아님, 관리자 아님 처리), →/p/A/settings: /p/A/dashboard 로 리다이렉트. ③→/p/A/settings: 404. ①→/w/default/settings·/p/A/settings 정상(200). 오류경계 0. (모든 404 문서의 HTTP 상태는 200 — dev 스트리밍 notFound.) |

## 결함 목록(첫 측정)


심각도 critical 0 / important 4 / minor 4 / 관찰 1. 소스는 고치지 않았다.

| ID | 심각도 | 내용 | 재현 | 스크린샷(해시) |
|---|---|---|---|---|
| D4 | important | 설정 편집기의 `className="input …"` 에 해당하는 CSS 가 없다(globals.css 에는 `.app-input`·`.app-textarea` 만 있음). 텍스트 입력·텍스트영역·검색창이 테두리 0·패딩 0·배경 투명(computed border 0px, padding 0px)이라 **입력칸이 보이지 않고 평문처럼 보인다**(제품 이름, 메일 발신 이름, 초대 허용 도메인, 기준 색, 마일스톤 키워드, 설정 검색, 메뉴 이름 등). 모든 크기·모든 설정 행에 영향. 처방 방향: 컴포넌트에서 `app-input`/`app-textarea` 사용(globals.css 는 UI 위험 파일이라 건드리지 않는 쪽) | 어느 설정 화면이든 입력칸 주변 확인; `getComputedStyle($('#settings-search')).borderTopWidth` | c1-admin-1440-top.png(`97522b52462c`), c2-admin-1440-top.png(a), c6-ws-control-char.png(`96cb4c744565`) |
| D8 | important | `bg-surface-1` 토큰이 정의돼 있지 않다(surface·surface-2 만 있음) → 저장 바(`sticky bottom-3`)와 설정 목차 aside 배경이 투명(rgba(0,0,0,0)). 스크롤 중 저장 바가 아래 내용 위에 놓일 때 글자가 비쳐 겹쳐 보인다(바닥 스크롤 끝에서는 마지막 입력과 겹침 0이므로 스펙의 "마지막 입력을 가리지 않는다"는 통과, 중간 스크롤에서 시각 결함). ModuleToggleEditor·ModuleAllowEditor·ConflictCompare·SettingsShell 도 같은 토큰 사용 | /w/default/settings 에서 "모듈·AI" 앞 스크롤 | c9-logo-svg-rejected.png(`2f259c494a4f`: "AI 기능" 설명과 "변경 0개" 겹침), c9-logo-uploaded-preview.png(`d9788256349b`) |
| D1 | important | 390px 에서 프로젝트 설정 카드 머리의 오른쪽 액션 버튼("AI 색인 재생성", "관리 화면 열기")이 줄바꿈 없이(`shrink-0`) 카드 밖으로 잘림. main 스크롤 영역 scrollWidth 446 > 382 | /p/A/settings 를 390×844 로 열고 "AI 어시스턴트"·"서버 LLM 설정" 카드 확인 | c1-admin-390-aiindex-overflow.png(`98f651a679cd`) |
| D3 | important | 1280·768 에서 워크스페이스 설정 main 이 가로로 넘친다(1280: scrollWidth 1094 > 1032, 768: 843 > 768). 원인: LogoEditor 의 `<input type="file">`(너비 325px)가 3열 카드(sm:grid-cols-3)의 칸보다 넓어 "아이콘 마크" 칸이 카드 밖으로 삐져나감. 1440·390 은 영향 없음 | /w/default/settings 를 1280 또는 768 로 열고 main 가로 스크롤 | c2-admin-768-fileinput-overflow.png(`7acd19157726`), c2-admin-1280-menu-overflow.png(`360a518841f5`), c2-admin-768-menu-overflow.png(`11db47b82963`) |
| D2 | minor | `id="project-modules"` 가 한 페이지에 두 번(바깥 div 와 SectionCard section) — 목차 앵커는 동작하나 유효하지 않은 HTML | /p/A/settings DOM 조회 | (DOM 계측) |
| D5 | minor | 메일 발신 이름에 공백만 넣고 저장하면 클라이언트가 `null` 을 set 으로 보내 revision 이 오르고 이력이 남으며 출처가 "제품 기본값"→"워크스페이스 설정"으로 바뀜(미설정≠명시 null). 의미상 무변경 | /w/default/settings 메일 발신 이름에 공백 3칸 → 저장 | c3-ws-nochange.png(`66df1c5bcead`) |
| D6 | minor | 제품 이름 입력칸 maxLength=40 이 41자 이상을 안내 없이 자름(입력·붙여넣기 모두). 서버 필드 오류 문구(41자)는 화면으로 만들 수 없음 | 제품 이름에 41자 입력 | c6-ws-41chars.png(`dd85b68c065c`) |
| D7 | minor | 로고 업로드 거부 사유(SVG·256KB 초과)가 "설정을 저장하지 못했습니다." 제목 아래에 표시 — 저장이 아니라 업로드 거부라 제목이 어긋남 | 로고 칸에 .svg 선택 → 업로드 | c9-logo-svg-rejected.png(`2f259c494a4f`) |
| D9 | 관찰 | 대비 모자란 색의 예(#ffff00)가 거부되지 않는다 — 파생기가 밝은 화면 배경을 #797919 로 보정해 통과(#ffffff·#00ffff·#f0f0f0·#000000 도 통과). 화면으로 만들 수 있는 거부는 danger 색 근접(#d32f2f)과 형식 오류뿐. 보정 알고리즘의 설계 의도인지 스펙 §5.5 와 맞는지 사람이 판단 | AccentEditor 에 #ffff00 입력 | c9-accent-yellow.png(`65a6aa92268b`) |

기타 관찰(결함 아님):
- 프로젝트 설정 화면에는 sticky 저장 바가 없다(전용 편집기별 저장 버튼). sticky 저장 바는 워크스페이스 설정(편집기당 1개, 3개)에만 있다. 스펙 §5.1 의 "저장 바" 계측 대상은 워크스페이스 화면으로 봤다.
- 콘솔 error: `/api/chat/context?probe=1` 404 — 프로젝트 A 의 chatbot 모듈이 꺼져 있어(E2E 상태) 챗 위젯 탐침이 404 를 받는 것. 기대된 동작이나 콘솔 노이즈. 설정 손상 행의 `[settings] invalid` 는 dev 서버 로그 전달.
- 프로젝트 A 는 E2E 가 issues·agents·chatbot 을 끈 상태라 C-7 허브 확인은 agents 가 켜진 프로젝트 B 로 했다.
- accent 의 화면 전체 반영(레이아웃 주입)은 이 Phase 코드에 없어 새로고침 뒤에도 --color-brand 불변 — SP3b UI-1 범위로 추정.
- 모든 404 화면의 HTTP 상태가 200(dev 스트리밍 notFound).
- "패치 거부"는 ① 계정으로 플랫폼 전용 키를 못 바꾸는 화면 경로가 없어(UI 자체가 없음) 세션 도중 DB 에서 역할을 내려 만든 "권한 없음"으로 대체했다.
- 일반 멤버 ② 가 /w/default/settings 를 열면 404 가 아니라 /projects 로 리다이렉트된다(워크스페이스 소속이라 404 대상이 아님).

## 수정과 재확인

- 첫 측정에서 화면 품질 결함 4건(important)이 나왔다 — **D4** 입력칸(`className="input"` 에 CSS 없음 → 테두리 없는 평문), **D8**(`bg-surface-1` 토큰 없음 → 저장 바·목차 배경 투명), **D3**(로고 파일 입력이 3열 카드보다 넓어 1280·768 가로 넘침), **D1**(390 에서 AI 색인·LLM 카드 머리 버튼 잘림). 단위 테스트·린트·타입체크는 전부 초록이었다 — 눈으로 봐야 잡히는 부류(`CLAUDE.md` UI 위험 파일 문단과 같은 이유).
- `5f3ab4a` 가 네 가지와 minor D2(`project-modules` 중복 id)·D5(공백만 입력한 메일 발신 이름이 revision 을 올림)·D6(제품 이름 `maxLength` 가 41자 이상을 안내 없이 자름)·D7(로고 업로드 거부 사유가 저장 실패 제목 아래 뜸)을 고쳤다. 전역 CSS 는 건드리지 않았다. 재발 방지로 `tests/css/settings-classes.test.ts` 가 설정 컴포넌트의 정의 없는 입력 클래스·surface 토큰을 막는다.
- **D9**(관찰): `#ffff00` 이 거부되지 않고 파생기가 밝은 화면 배경을 `#797919` 로 보정해 통과한다. 정확성 리뷰가 개정 §5.11.2·D30 과 일치함을 읽기로 확인했다 — 거부는 위험색 근접(hue<20°·C>0.08)과 형식 오류뿐이다. 사람이 의도인지 확인할 것(SP3b UI-1).

| # | 라우트 | 크기 | 결과 | 스크린샷 | 해시 | 비고 |
|---|---|---|---|---|---|---|
| C-R1 | `/w/default/settings` | 1440×900 | 통과 | re-ws-1440.png | 4fafcf8328b6 | 입력칸 테두리 1px, 저장 바 배경 불투명(`rgb(255,250,244)`), 가로 넘침 없음 |
| C-R1 | `/w/default/settings` | 1280×720 | 통과 | re-ws-1280.png | b43f1ed88c8d | D3 해소 — main scrollWidth 1032 = clientWidth 1032(수정 전 1094). 파일 입력이 카드 안에 들어감 |
| C-R1 | `/w/default/settings` | 768×1024 | 통과 | re-ws-768.png | 642b4edb4aab | D3 해소 — 768 = 768(수정 전 843) |
| C-R1 | `/w/default/settings` | 390×844 | 통과 | re-ws-390.png | f92df612cf9d | 390 = 390 |
| C-R2 | `/p/<A>/settings` | 1440×900 | 통과 | re-proj-1440.png | 99d81515600a | 가로 넘침 없음, 중복 id 0 |
| C-R2 | `/p/<A>/settings` | 1280×720 | 통과 | re-proj-1280.png | 50908442825d | 같음 |
| C-R2 | `/p/<A>/settings` | 768×1024 | 통과 | re-proj-768.png | b41543aa3cfd | 같음 |
| C-R2 | `/p/<A>/settings` | 390×844 | 통과 | re-proj-390.png | 734a17382bf3 | D1 해소 — main 390 = 390(수정 전 446 > 382), 중복 id 0 |

Preview-checked 트레일러: `Preview-checked: local <일시> — /w/default/settings·/p/<A>/settings 네 크기`(원격 Preview 가 아직 없다 — `CLAUDE.md`).
