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
