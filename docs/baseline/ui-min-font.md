# 글자 크기 하한 12px · 대문자 라벨 정리 — 기록

개정 스펙 §5.5.6 "금지" 행(주요 조작에 12px 미만 금지, 한글에 uppercase·과도한 자간 금지)을 `src/` 전체에 적용한 기록이다.
기준 트리는 `origin/main f516939d`, 작업일 2026-10-09. 불변식은 `tests/css/min-font-size.test.ts` 가 지킨다(허용 목록은 그 파일의 `ALLOW` 가 정본 — 아래 표는 사본).

## 1. 올린 건수

모두 12px(`text-meta` — 12/18)로 올렸다. 새 토큰은 없다.

| 종류 | 9px | 10px | 10.5px | 11px | 합 |
|---|---|---|---|---|---|
| 유틸 `text-[Npx]` → `text-meta` | 5 | 84 | 2 | 257 | 348(91 파일) |
| CSS 모듈 `font-size` → `12px`(`seatmap.module.css` 14 · `delegationTable.module.css` 2) | – | 4 | 1 | 11 | 16 |
| WBS 글자 배율 변수의 100% 기준값(`src/lib/wbsFontScale.ts`) | – | 2 | 1 | 2 | 5 |

유틸 348건의 디렉터리별 분포: `components/wbs` 88 · `issues` 42 · `dashboard` 35 · `settings` 26 · `agent-hub` 25 · `wiki` 22 · `agents` 21 · `minutes` 19 ·
`portfolio` 11 · `meetings` 11 · `attendance` 9 · `announcements` 7 · `members` 7 · `usage` 4 · `kanban` 4 · `admin` 3 · `ui` 2 · `chat` 2 · `search` 2 · `report` 2 ·
`calendar` 1 · `roster` 1 · `doc` 1 · `app/(app)`(프로젝트 설정 화면) 1 · `app/globals.css`(회의록 본문의 인원·이슈 배지) 2.

WBS 표의 배율 변수(100% / 115% / 130%):

| 변수 | 전 | 후 | 비고 |
|---|---|---|---|
| `--wbs-index-font`(번호·개요 번호) | 11 / 12.65 / 14.3 | 12 / 13.8 / 14.3 | 상한 = 옛 최대값 |
| `--wbs-head-font`(열 머리·간트 월) | 10 / 11.5 / 13 | 12 / 13 / 13 | 상한 = 옛 최대값 |
| `--wbs-chip-font`(상태 칩) | 11 / 12.65 / 13 | 12 / 13 / 13 | 상한 13 그대로 |
| `--wbs-badge-font`(단계 칩·접힌 개수·레벨 배지) | 10 / 10.5 / 10.5 | 12 / 12 / 12 | 고정 폭 칸이라 배율을 타지 않는다 |
| `--wbs-owner-font`(담당 팀 이름) | 10.5 / 12.07 / 13.65 | 12 / 13.65 / 13.65 | 상한 = 옛 최대값 |
| `--wbs-timeline-font` · `--wbs-day-font` · `--wbs-bar-font` · `--wbs-owner-mark-font` | 9.5 · 9 · 9 · 9 | 그대로 | 예외(§2) |

행 높이는 그대로다 — WBS 행(`--wbs-row-h`)·머리(`--wbs-head-h` 58px)는 고정값이고, 표 머리 행(`<tr>`·`<th>`) 11곳은 `leading-4`(16px)로 옛 행간(15~16.5px)을 유지했다.

## 2. 예외(12px 미만으로 남긴 자리)

닫힌 목록 15줄·28건. 데이터 시각화의 눈금·도형 안 글자와 키 표시뿐이다.

| 파일 | 표기 | 건 | 용도 | 사유 |
|---|---|---|---|---|
| `components/app/GlobalBar.tsx` | `text-[10px]` | 1 | 찾기 버튼의 ⌘K 키 표시(`<kbd>`) | 버튼 라벨 옆 보조 기호 — 12px 이면 좁은 전역 바에서 라벨을 민다 |
| `components/app/PresenceStrip.tsx` | `text-[10px]` | 2 | 접속자 아바타 원(28px) 안 이니셜·+N | 고정 크기 원 안 두 글자 |
| `components/dashboard/IssueStatusCard.tsx` | `text-[9px]` | 1 | 영역별 해결률 링 게이지(34px) 안 퍼센트 | 안쪽 지름 24px 에 "100%". 같은 값이 옆 글·aria-label 에 있다 |
| `components/wbs/WbsGanttSheet.tsx` | `text-[9px]` | 1 | 범례의 팀 색 점(●) | 글자가 아니라 색 표지 도형 |
| `components/wbs/WbsGanttSheet.tsx` | `fontSize 9.5px` | 1 | 간트 머리 주차 눈금 | 주 칸 폭이 날짜 축척에 묶여 있다 |
| `components/wbs/WbsGanttSheet.tsx` | `fontSize 9px` | 4 | 간트 일자 눈금 1 · 막대 안팎 퍼센트 3 | 일 칸·막대 안 숫자. 같은 퍼센트가 실적 열에 12px 로 있다 |
| `components/wbs/OwnerBadges.tsx` | `fontSize 9px` | 1 | 담당 표지 도형(●주관·△지원) | 글자가 아니라 표지 도형. 팀 이름은 12px |
| `components/dashboard/TrendChart.tsx` | `fontSize 9px` | 3 | S-커브 축 눈금·양 끝 날짜(SVG) | viewBox 단위 축 라벨 |
| `components/usage/UsageTrendChart.tsx` | `fontSize 9px` | 3 | 일별 사용자 차트 축 눈금·날짜(SVG) | viewBox 단위 축 라벨 |
| `components/dashboard/IssueTrendCard.tsx` | `fontSize 10px` | 2 | 이슈 추이 축 눈금·주 라벨(SVG) | viewBox 단위 — 주 라벨은 칸 간격에 묶인다 |
| `components/dashboard/IssueTrendCard.tsx` | `fontSize 11px` | 1 | 추이 선 끝의 현재 잔량(SVG) | 오른쪽 여백에 들어가는 값 |
| `components/dashboard/SpiPanel.tsx` | `fontSize 10px` | 3 | SPI 반원 게이지 눈금(SVG) | 게이지 바깥 좁은 여백 |
| `components/dashboard/MilestoneTimeline.tsx` | `fontSize 10px` | 1 | 마일스톤 이름 라벨(SVG, `FS_NAME`) | 줄바꿈·겹침 회피 계산이 이 크기에 묶여 있다 |
| `components/dashboard/MilestoneTimeline.tsx` | `fontSize 9px` | 2 | 마일스톤 날짜·오늘 라벨(SVG, `FS_SUB`) | 같은 배치 계산 |
| `components/portfolio/PortfolioMilestoneBoard.tsx` | `fontSize 9px` | 2 | 월 눈금·오늘(SVG) | 머리 높이 18 에 맞춘 축 눈금 |

SVG 의 `fontSize` 는 px 이 아니라 viewBox 단위다(`h-auto w-full` — 카드 폭에 따라 커진다). 판정기가 못 잡는 모양은 실행 중 계산(`BrandMark` 의 `size * 0.46`)과 em 단위뿐이다.

## 3. 대문자·넓은 자간

- 유틸 제거: `uppercase` 50 · `tracking-wide` 20 · `tracking-wider` 3 · `tracking-[0.06~0.16em]` 33(합 106 토큰). CSS: `seatmap.module.css` 의 `.eyebrow`(uppercase·.14em)·`.cardZone`(.08em),
  `delegationTable.module.css` 의 표 머리(.04em). 좁히는 자간(`tracking-tight`·음수 값)은 그대로다.
- `.toUpperCase()` 로 찍는 코드(WBS 단계 `AS/IP/IM/XX`, 팀·영역 code)는 데이터라 건드리지 않았다.

### 지운 머리글(제목과 같은 뜻의 영문 대문자 eyebrow) — 59곳

- 프로젝트 설정(`p/[projectId]/settings/page.tsx`) 22: CORE INFORMATION · WBS · AUTHORIZATION×2 · DATA · AI ASSISTANT×2 · MODULES · TEAMS · WORK AREAS · ISSUES · ISSUE POLICY · MINUTES ·
  VOCABULARY · FORMS · CUSTOM FIELDS · WORKFLOW×2 · AGENT · STATUS POLICY · CALENDAR · HISTORY
- 개요: MILESTONES×2 · S-CURVE×2 · ISSUES×2 · BACKLOG×2 · VELOCITY · BY OWNER · ACTION QUEUE · ISSUE QUEUE · CATCH-UP · OVERDUE AGING · DATA QUALITY · ATTENDANCE · MEETINGS
- 포트폴리오: PORTFOLIO×2 · MILESTONES×2 / 칸반: KANBAN×2 / 사용 현황: TREND · USERS · MENUS · ACCESS LOG
- 그 밖: 근태 ATTENDANCE · 회의 폼 MEETING · 가져오기 TEAMS · 엑셀 프로필 EXCEL · 프로젝트 정보 모달 CORE INFORMATION · 명단 `TEAM & AUTHORIZATION`/`TEAM`
- 위키(사전 키였던 것): 신뢰 `TRUST & OWNERSHIP` · 기준 문서 `CANONICAL DOCUMENT` · 제안 `PENDING PROPOSALS` · 열린 항목 `OPEN LOOPS` · 근거 `SOURCE EVIDENCE` · 타임라인 `CHANGE TIMELINE`
  — 사전에서 `wiki.*.eyebrow` 14개 키(쓰는 6 + 안 쓰던 8)를 ko·en 모두 지웠다.

`SectionCard` 는 eyebrow 가 없으면 제목을 아이콘 높이 가운데에 둔다(`items-center`, 제목의 `mt-0.5` 는 eyebrow 가 있을 때만).

### 사전으로 옮기거나 문구를 바꾼 것

| 자리 | 전 | 후 |
|---|---|---|
| 개요 요약 카드(`ExecSummary`) — 하드코딩 | `EXECUTIVE SUMMARY` | 사전 `dash.exec.eyebrow`: 종합 현황 / Executive Summary |
| 위키 질문 머리 `wiki.ask.eyebrow` | `PROJECT MEMORY`(ko·en) | 프로젝트 지식 / Project Memory |
| 사용 현황 KPI 라벨(하드코딩 — 이 화면은 한글 하드코딩이 관례) | `TODAY` · `ACTIVE nD` · `SESSIONS nD` · `VIEWS nD` | 오늘 · 활성 n일 · 세션 n일 · 열람 n일 |
| `meet.kpi.today/upcoming/total`(en) | `TODAY` · `NEXT 7 DAYS` · `THIS MONTH` | Today · Next 7 Days · This Month |
| `workspace.projects/active`(ko·en, 지금 쓰는 곳 없음) | `PROJECTS` · `ACTIVE` | 프로젝트·진행 중 / Projects·Active |

남긴 대문자 사전 값은 `kanban.ddayToday = D-DAY` 하나다(D-3·D+2 와 같은 코드 표기).

### 손대지 않은 것(판단 필요)

대문자가 아닌 영문 하드코딩 머리글 21곳은 이 과제의 금지 패턴(대문자·넓은 자간)이 아니라 그대로 두었다 — 한글 화면에 영문 머리글이 남는다:
모달 eyebrow 18(`Remove attendance` · `Teams` · `Invite` · `Workspace dialog` · `New account` · `Bulk create` · `Reset password` · `Announcement` · `Delete announcement` ·
`Weekly report` · `By phase` · `At risk` · `By owner` · `Issue analysis` · `Revoke token` · `Delete meeting` · `Cancel occurrence` · `Security`),
`.eyebrow` 3(`Active LLM` · `Account board` · `Agent access`). 지울지 사전으로 옮길지는 따로 정한다.

## 4. 글자가 커져 잘리거나 줄이 바뀔 수 있는 자리

눈확인 때 먼저 볼 순서다.

1. **WBS 표**(`/p/…/wbs`) — 열 머리(10→12px, 고정 폭 64~150px: 가중치·계획%·실적%·달성률 머리와 그 아래 보조 줄), 번호·개요 번호(11→12px, 44·96px 칸),
   담당 팀(10.5→12px, 128px 칸 `nowrap` — 팀 둘 이상이면 더 일찍 잘린다), 단계 칩·접힌 개수 배지(10→12px), 작업명 머리의 레벨 버튼(9→12px, 16×20px). 조치: 배율 상한을 옛 최대값으로 묶었다.
2. **선·후행 그래프**(작업 상세 › 의존) — 노드가 56px 고정 높이 세 줄이다. 조치: 줄마다 `leading-4`, 노드 여백 `py-1→py-0.5`(가운데 노드 `py-1.5→py-0.5`). 폭 150px 안의 코드·관계 배지(9→12px)·상태 배지가 좁아졌다.
3. **근태·회의 달력 칸**(`AttendanceView`·`MeetingCalendar`·`MinutesCalendar`) — 칩 10.5→12px, 공휴일 라벨·"+N" 10→12px. 칸 높이가 늘거나 칩 글자가 더 일찍 잘릴 수 있다(390 폭 우선).
4. **에이전트 좌석도**(`/agents`) — 책상 안 결재 버튼 `.opMini`(10.5→12px, `nowrap`·책상 폭 123~157px), 책상 우상단 `.flag`, 단계 사다리 `.ladder li`(5칸), 머리 위 단계 말풍선(`PhaseBadge` chip 10→12px), 담당 꼬리표(`OwnerTag`), 말풍선(`SeatSpeech`).
5. **위임 표**(`DelegationTable`) — 표 머리 11→12px(자간 제거), 행 안 단계 선택 `h-6`·버튼 `h-6`(11→12px), 신호 시각 보조 줄 10→12px(행이 두 줄일 때 높이).
6. **포트폴리오 표** — 머리 10→12px, 위험·대기 배지, 기준일·추세·지연일 보조 숫자(10→12px), 마일스톤 날짜.
7. **단계 크레딧 슬라이더**(프로젝트 설정) — 핸들 위 코드 라벨(10→12px, 조치: `leading-[15px]` 로 높이 유지), 수동 표식 라벨·눈금 숫자(절대 배치).
8. **개요** — 신호 타일·KPI 묶음의 라벨(10→12px, 자간 제거), 이슈 상태 카드의 영역 code·"+N", 차트 범례(10→12px), 날짜 타일의 요일.
9. **회의록** — 팀 막대(`TeamBar` cell 48px 고정 폭 — 팀 code 4자 이상), 달력 칸 태그, 본문의 인원·이슈 배지(둘이 겹치지 않게 3rem 띄운 자리), 목차의 이슈 수 배지.
10. **이슈 상세 모달** — 구역 라벨 11→12px(대문자·자간 제거), 진행 기록의 배지.
11. **프로젝트 설정** — eyebrow 22개가 빠져 카드 머리가 한 줄이 됐다(아이콘 36px 가운데 정렬). 정의 목록 `dt`(128px 폭) 11→12px.
12. **칸반 카드** — 경로 라벨(10→12px, `truncate`), 글자 크기 조절 버튼의 `A−`·`A+`(WBS·회의록).

## 5. 검증

`npm run typecheck` 0 오류 · `npm run lint` 0 오류(경고 4 — 기존) · `npm run test` · `npm run build` 성공. 숫자는 과제 보고에 적는다.
바꾼 기존 테스트: `tests/ui/wbs-font-scale.test.tsx`(배율 기대값), `tests/ui/calendar-holiday-label-narrow.test.ts`(라벨 선택자 `text-[10px]`→`text-meta`),
`tests/ui/wiki-safety.test.tsx`(근거 구역 기준점을 지운 머리글에서 제목으로), `tests/ui/ui-states-page.test.tsx`(타이포 표본 단언 추가).
`/admin/ui-states` 에 "타이포 스케일" 표본(여덟 단계 + 칩·배지)을 더했다.
