# SP3b UI 눈확인 기록(UI-1~UI-3)

| 항목 | 값 |
|---|---|
| 서버 | 레인 B 3201 `next start -H 127.0.0.1`(프로덕션 빌드) · 기준 3202(스크래치 워크트리 `lane-b-base`) |
| 스택 | `d-flow-lane-b`, `max_rows = 20000`(D51) |
| 도구 | `scripts/ui-capture.mjs`(shoot·diff·axe·checks·sheet), Playwright 1.58.2 / Chromium 145 |
| 비교 | (기준, 머리)를 같은 KST 날짜·같은 시드·같은 스크립트로 새로 찍은 픽셀 차이율(채널 차 > 16). 판정 same(0)·near(0 초과 ~ 0.2% — 판정 Q33 문턱, 눈확인 '볼 목록'에 든다)·diff·problem·missing |
| 계정 | 시드 계정 넷(비밀번호는 실행마다 임의 값). 부트스트랩 관리자 무변경 |
| UI-1 착수점 | `f2356ae`(main 머리 — UI-0 `sp3b/ui0` + 레인 A 후속 반영 뒤. 과제 24·25 의 범위 `f2356ae..HEAD`) |

## 1. z 대응표(D56)
(과제 24)

## 2. 파일 → 화면 대응표(UI-1 이 고친 파일이 렌더되는 화면 — 눈확인 (a) 의 필수 목록. 초안 = 착수 때, 과제 24 가 실제 diff 로 대조·보충)
| 파일 | 라우트 키 |
|---|---|
| `src/app/globals.css`·`src/app/layout.tsx` | 전 라우트 |
| `src/app/(app)/layout.tsx`·`src/components/app/{Sidebar,HeaderChrome,InboxPanel,PrefsSync}.tsx`·`src/components/chat/AssistantChat.tsx`·`src/components/ui/{Toast,Tooltip,Icon}.tsx` | 전 `(app)` 라우트 + `mobile-menu`·`account-popover`·`inbox-popover` |
| `src/app/login/page.tsx` | `login` |
| `src/app/not-found.tsx` · `src/app/invite/[token]/page.tsx` · `src/components/minutes/ShareViewer.tsx` | `not-found` · `invite` · `share` |
| `src/components/wbs/{WbsGanttSheet,RowDetailPanel}.tsx` | `p-wbs`·`p-gantt`·`p-wbs-fullscreen` |
| `src/components/ui/{PageHero,KpiCard,SectionCard,Modal,StatusPill}.tsx` | `grep -rln "<PageHero\|<KpiCard\|<SectionCard\|<Modal\b\|<StatusPill" src/app src/components` 가 가리키는 화면 전부(과제 24 가 라우트 키로 푼다) |
| 회의록 파일 여섯(`MinutesCalendar`·`MinutesExplorer`·`MinutesView`·`MinuteChatPanel`·`FolderManageModal`·`MinuteViewer`)·`MarkdownView`·`ArchiveChatPanel` | `minutes`·`minute`·`share` |
| `MeetingCalendar`·`MeetingDetailModal` | `meetings`·`p-meetings` |
| `AttendanceView` · `AnnouncementsView` · `WeeklySheetView` | `p-attendance` · `p-announcements` · `p-weekly` |
| `LlmProfilesModal` · `UsageEventLog` · `dashboard/bits` · `ImportWizard` · `KanbanBoard` · `StageCreditSlider` | `llm-config` · `usage` · `p-dashboard` · `p-import-admin` · `p-kanban` · `p-settings` |
| `NewProjectModal` | `projects` |
| `AgentFrame`·`AgentTabs`·`AgentHubView` · `RosterBoard` | `p-agents` · `agents`·`p-office` |
| `WikiSearch`·`WikiReindexButton` | `p-wiki` |
| `AccountView`·`ThemeRadioGroup` | `account`·`account-popover` |
| `UiStatesShowcase`·`(global)/admin/ui-states/page.tsx` | `admin-ui-states` |

(과제 24: 이 줄 아래에 `DARK4=` 한 줄 — 판정 Q44)

## 3. UI-1 눈확인(스펙 §8.5 UI-1 행)
(과제 25 — (a) 전 라우트 라이트 회귀 차이율 표 · (b) 다크 · (c) axe · (d) 쇼케이스·지정 화면 · (e) Tab · (f) 인쇄 · 깜빡임 · 이월 목록. 쇼케이스 두 열 대조는 라이트 페이지 캡처로 본다 — 판정 Q37)

## 4. 로컬 스모크(`SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod`)
(과제 24 가 UI-0 기준 `smoke-ui0.txt`·델타 `smoke-ui0-delta.txt` 행을 옮기고, 과제 25 가 UI-1 행을 더한다)

## 5. UI-1 사용자 확인(D29 — 사용자 게이트)
(과제 25 — 일시·대조표 경로·라이브 표본·지적과 처리)
