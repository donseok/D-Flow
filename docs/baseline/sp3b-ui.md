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

토큰(`globals.css` 비색 `:root`): `--z-sticky 20` · `--z-shell 70` · `--z-rail 90` · `--z-popover 100` · `--z-overlay 110` · `--z-fullscreen 120` · `--z-modal 150` · `--z-toast 200` · `--z-skip 250`.
출처: `grep -rnoE "(^|[^a-z0-9-])-?z-(\[[^]]+\]|\(--z-[a-z]+\)|[0-9]+)" src --include='*.tsx' --include='*.ts'` — 과제 23 머리(`de21512`) 기준 78줄(토큰 10 · 임의값 17 · 이름 유틸 51 — 브리프 사본 실측의 토큰 11·임의값 16 과 하나 다른 것은 전체 화면 +1 이 임의값 `z-[calc(…)]` 이라서). '화면 내부' = 그 화면의 스태킹 컨텍스트 안에서만 겨루는 층(전역 층과 순서를 다투지 않는다).

| 지금 값 | 파일:줄 | 새 값 | 비고 |
|---|---|---|---|
| 셸 70 | `app/HeaderChrome.tsx:157` | `z-(--z-shell)` | UI-1(과제 10) |
| 팝오버 90·95 | `app/HeaderChrome.tsx:282`·`:283` | `z-(--z-popover)` | UI-1 — 계정·알림 팝오버와 그 배경 |
| 모바일 메뉴 100 | `app/HeaderChrome.tsx:315` | `z-(--z-overlay)` | UI-1 |
| 전체 화면 125 | `wbs/WbsGanttSheet.tsx:1089` | `z-[calc(var(--z-fullscreen)_+_1)]`(121) | UI-1 수정 F3 — AI 버튼(120) 위에 두려는 임시 +1. **AI 버튼이 `--z-rail` 로 내려가면(아래 AI 행) `z-(--z-fullscreen)` 으로 되돌리고 `no-raw-color` `ALLOW`·`fullscreen-layer` 테스트의 표기 해석을 맞춘다** |
| 모달 150 | `ui/Modal.tsx:86` | `z-(--z-modal)` | UI-1(과제 15). 중첩 모달은 body 끝 포털의 문서 순서(판정 Q38) |
| 보관 챗 140 | `minutes/ArchiveChatPanel.tsx:38` | `z-(--z-modal)` | UI-1(판정 Q32) — AI 패널(130)·전체 화면(121) 위 순서 유지 |
| 토스트·툴팁 200 | `ui/Toast.tsx:59` · `ui/Tooltip.tsx:100` | `z-(--z-toast)` | UI-1 |
| 스킵 링크 200 · STAGING 300 | `(app)/layout.tsx:106`·`:110` | `z-(--z-skip)`(250) | UI-1 |
| 에이전트 히어로 `z-[1]` | `agent-hub/AgentFrame.tsx:26`·`:32` | `z-10` | UI-1(과제 13) — 히어로 안 장식 위 글자(화면 내부) |
| AI 버튼(FAB) `z-[120]` | `chat/AssistantChat.tsx:496` | **UI-2b 레일 → `--z-rail`(90) 권고** | 주인 B. 지금 모바일 메뉴(110) 위·WBS 전체 화면과 같은 층이라 전체 화면에 +1 이 필요했다(과제 10 눈확인 CARRY · U1a F3). rail 90 이면 overlay·fullscreen·modal 모두 아래 — 전체 화면 동안은 D56 의 `useRailHost` 포털이 전체 화면 안 레일 자리에 둔다 |
| AI 접힌 바·열린 패널 `z-[130]` | `chat/AssistantChat.tsx:511`·`:529` | UI-2b 레일(D56) | 주인 B. 지금 전체 화면(121) 위·보관 챗(150)·모달 아래. UI-2b 가 레일로 옮기면 전체 화면 안 포털 |
| 인스펙터 `z-[110]` | `wbs/RowDetailPanel.tsx:301` | UI-2b 레일(D56) | 지금 overlay 와 같은 값 — 전체 화면(121) 아래로 숨는 것은 포털로 푼다 |
| 툴바 토글 `z-[60]` | `wbs/WbsGanttSheet.tsx:1115` | 화면 내부 → UI-2b/SPU2 토큰 | 문서 층에서 셸(70) 아래로 경쟁하는 전역 층(U1b 리뷰 R2 P3, `ALLOW` 사유와 같다) |
| 진척 렌즈 `z-[45]` | `wbs/WbsGanttSheet.tsx:2011` | 화면 내부 → UI-2b/SPU2 토큰 | `fixed` — 셸 아래(같은 `ALLOW` 사유) |
| 막대 겹침 `z-[25]` | `wbs/WbsGanttSheet.tsx:1949` | 화면 내부 | 행 `relative z-10` 안 |
| 팝오버 배경·본문 `z-[90]`·`z-[95]` | `minutes/MinuteBlockPopover.tsx:68`·`:70` · `minutes/MinuteSelectionBubble.tsx:208` | 화면 내부 — SP5(화면 소유) | 회의록 화면 내부 층(`ALLOW`) |
| 날짜 팝오버 `z-[90]`·`z-[95]` | `ui/DayPopover.tsx:33`·`:35` | 화면 내부 — UI-5(화면 소유) | `ALLOW` |
| 좌석표 `z-[1]`·`-z-[1]` | `agents/RosterBoard.tsx:217`·`:227`·`:243`·`:249` | 화면 내부 — UI-5(개정 §5.9.4) | 이름표·장식 겹침(`ALLOW`) |
| `z-50` | `wbs/WbsGanttSheet.tsx:2085`(토스트) · `roster/TeamMultiSelect.tsx:145`(팝오버 본문) | 화면 내부 | WBS 토스트는 전체 화면 컨테이너 안에서는 그 문맥. 전역 토스트로 옮길 때 `--z-toast` |
| `z-40` | `wbs/WbsGanttSheet.tsx:1382` · `weekly/WeeklySheetView.tsx:801`(2)·`:802` | 화면 내부 | sticky 머리(WBS·주간 시트) — UI-2b D54 sticky 13파일 |
| `z-30` | `wbs/WbsGanttSheet.tsx:1574`·`:1581`·`:1590`·`:1990` · `weekly/WeeklySheetView.tsx:801` · `weekly/SheetCell.tsx:101`·`:106`·`:125`·`:132` · `minutes/MinutesExplorer.tsx:883` | 화면 내부 | 고정 열·셀 편집 층 |
| `z-20` | `wbs/WbsGanttSheet.tsx:2154` · `wbs/AssigneeComboBox.tsx:142` · `weekly/SheetCell.tsx:91`·`:95`·`:101` · `attendance/AttendanceView.tsx:245` · `meetings/MeetingsView.tsx:123` · `meetings/MyMeetingsView.tsx:207` · `minutes/MinutesExplorer.tsx:489`·`:850`·`:872`·`:881` · `minutes/MinutesView.tsx:261` | 화면 내부(sticky 는 `--z-sticky` 와 같은 값) | sticky 머리·콤보 목록 |
| `z-10` | `wbs/WbsGanttSheet.tsx:445`·`:1074`·`:1562`·`:1608`·`:1843`·`:1920` · `wbs/RowDetailPanel.tsx:314` · `ui/Modal.tsx:89`(패널 — 배경 위) · `app/Sidebar.tsx:181`(아이콘) · `members/MemberPicker.tsx:196` · `minutes/MinutesExplorer.tsx:488`·`:802`·`:916`·`:921` · `weekly/SheetCell.tsx:79`·`:101`·`:104` · `wiki/WikiSearch.tsx:97` · `wiki/WikiShared.tsx:438` · `agent-hub/AgentFrame.tsx`(위 행) | 화면 내부 | 형제 위 한 칸 |
| `z-0` | `wbs/WbsGanttSheet.tsx:1345`·`:1839` | 화면 내부 | 바닥 층 |

새 층 둘: WBS 전체 화면 `--z-fullscreen: 120`(overlay 110 위·modal 150 아래), 보관 챗 = `--z-modal`(중첩 모달은 body 끝 포털의 문서 순서 — 판정 Q38). UI-2b: 전체 화면이 열린 동안 레일은 전체 화면 안 레일 자리로 포털(`useRailHost`).
지금 겹침 순서(UI-1 끝, 위가 위): 스킵·STAGING 250 > 토스트 200 > 모달·보관 챗 150 > AI 바·패널 130 > 전체 화면 121 > AI 버튼 120 > 인스펙터·모바일 메뉴 110 > 팝오버 100 > 셸 70 > 툴바 토글 60 > 진척 렌즈 45. 알려진 어긋남 둘(회귀 아님 — 옛 값도 같은 순서): 모바일 메뉴 위에 AI 버튼, 전체 화면 위에 AI 바·패널 → 둘 다 UI-2b 레일 몫.

## 2. 파일 → 화면 대응표(UI-1 이 고친 파일이 렌더되는 화면 — 눈확인 (a) 의 필수 목록. 초안 = 착수 때, 과제 24 가 실제 diff 로 대조·보충)
| 파일 | 라우트 키 |
|---|---|
| `src/app/globals.css`·`src/app/layout.tsx` | 전 라우트 |
| `src/app/(app)/layout.tsx`·`src/components/app/{Sidebar,HeaderChrome,InboxPanel,PrefsSync}.tsx`·`src/components/chat/AssistantChat.tsx`·`src/components/ui/{Toast,Tooltip,Icon}.tsx` | 전 `(app)` 라우트 + `mobile-menu`·`account-popover`·`inbox-popover` |
| `src/app/login/page.tsx` | `login` |
| `src/app/not-found.tsx` · `src/app/invite/[token]/page.tsx` · `src/components/minutes/ShareViewer.tsx` | `not-found` · `invite` · `share` |
| `src/components/wbs/{WbsGanttSheet,RowDetailPanel}.tsx` | `p-wbs`·`p-gantt`·`p-wbs-fullscreen` |
| `src/components/ui/{PageHero,KpiCard,SectionCard,Modal,StatusPill}.tsx` | `p-dashboard`·`p-wbs`·`p-kanban`·`p-issues`·`p-weekly`·`p-meetings`·`p-wiki`·`p-wiki-topic`·`p-announcements`·`p-members`·`p-attendance`·`p-import`·`p-import-admin`·`p-settings`·`meetings`·`minutes`·`minute`·`portfolio`·`usage`·`admin-accounts`·`admin-teams`·`llm-config`·`account`·`projects`·`ws-settings`·`admin-ui-states`·`report-modal`(과제 24 — 페이지 22 + 컴포넌트 52파일의 grep 을 그 페이지·모달의 라우트 키로 풂) |
| 회의록 파일 여섯(`MinutesCalendar`·`MinutesExplorer`·`MinutesView`·`MinuteChatPanel`·`FolderManageModal`·`MinuteViewer`)·`MarkdownView`·`ArchiveChatPanel` | `minutes`·`minute`·`share` |
| `MeetingCalendar`·`MeetingDetailModal` | `meetings`·`p-meetings` |
| `AttendanceView` · `AnnouncementsView` · `WeeklySheetView` | `p-attendance` · `p-announcements` · `p-weekly` |
| `LlmProfilesModal` · `UsageEventLog` · `dashboard/bits` · `ImportWizard` · `KanbanBoard` · `StageCreditSlider` | `llm-config` · `usage` · `p-dashboard` · `p-import-admin` · `p-kanban` · `p-settings` |
| `NewProjectModal` | `projects` |
| `AgentFrame`·`AgentTabs`·`AgentHubView` · `RosterBoard` | `p-agents` · `agents`·`p-office` |
| `WikiSearch`·`WikiReindexButton` | `p-wiki` |
| `AccountView`·`ThemeRadioGroup` | `account`·`account-popover` |
| `UiStatesShowcase`·`(global)/admin/ui-states/page.tsx` | `admin-ui-states` |
| `src/components/report/{ReportButton,ReportModal}.tsx` | `p-dashboard`·`report-modal` |
| `src/components/ui/SegmentedTabs.tsx` | `p-attendance`·`p-announcements`·`minutes`·`minute`·`meetings`·`p-meetings`·`p-kanban`·`p-issues` |
| `src/components/ui/{Button,IconButton,Field,StatusMessage}.tsx`(새) · `src/lib/authz/uiStatesAccess.ts` | `admin-ui-states`(지금 소비처는 쇼케이스뿐) |
| `src/components/account/rovingRadio.ts` · `src/lib/i18n/dict/common{,.en}.ts`(`chrome.*`) | `account`·`account-popover` |
| `src/components/providers/ThemeProvider.tsx` · `src/lib/theme/policy.ts` · `src/lib/prefs/{sync,debouncedSave}.ts` · `src/lib/domain/types.ts` | 전 라우트(테마 해석·no-flash·선호 동기화) — 과제 25 `checks flicker` |
| `src/lib/settings/{accent,catalog-meta}.ts` | `admin-ui-states`(강조색 표본) · 화면 무변경(설명 한 줄) |

`DARK4`(판정 Q44 — 하드코딩 색 화면 12 ∪ 위 표에 이름으로 적힌 키, 과제 25 Step 6 이 `--routes` 로 쓴다. 대응표의 모든 파일이 UI-1 diff 에 있다 — "(무변경)" 행 없음):

DARK4=p-weekly,p-attendance,agents,p-office,p-agents,p-wiki,p-wiki-topic,minute,p-dashboard,p-wbs,p-gantt,p-kanban,mobile-menu,account-popover,inbox-popover,login,not-found,invite,share,p-wbs-fullscreen,p-issues,p-meetings,p-announcements,p-members,p-import,p-import-admin,p-settings,meetings,minutes,portfolio,usage,admin-accounts,admin-teams,llm-config,account,projects,ws-settings,admin-ui-states,report-modal

## 3. UI-1 눈확인(스펙 §8.5 UI-1 행)
(과제 25 — (a) 전 라우트 라이트 회귀 차이율 표 · (b) 다크 · (c) axe · (d) 쇼케이스·지정 화면 · (e) Tab · (f) 인쇄 · 깜빡임 · 이월 목록. 쇼케이스 두 열 대조는 라이트 페이지 캡처로 본다 — 판정 Q37)

## 4. 로컬 스모크(`SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod`)

| 시점 | 기록 | smoke exit | CSS 크기 | 규칙 수 | 커스텀 프로퍼티 | @property | @keyframes | 안전망 사본 |
|---|---|---|---|---|---|---|---|---|
| UI-0 기준(`b4283c0` 트리, 과제 5) | `qa/sp3b/smoke-ui0.txt`(2026-10-01 12:40) | 0(통과) | 130,834 B | 1,931 | 493 | 71 | 9 | 1 |
| UI-0 끝(`sp3b/ui0` 수정 라운드 머리 = main 반영 트리, 과제 6 수정) | `qa/sp3b/smoke-t6fix.txt`(2026-10-01 15:50) | 0(통과) | 130,834 B | 1,931 | 493 | 71 | 9 | 1 |

(UI-0 은 창 ① rebase 없이 main 에 들어갔다(ui1-addendum §1) — 계획의 델타 행 `smoke-ui0-delta.txt`(과제 6 Step 4)는 해당 없음이라 수정 라운드 끝 기록을 둘째 행으로 둔다. UI-0 은 `src/**` 무수정이라 두 행이 같다. UI-1 행은 과제 25.)

## 5. UI-1 사용자 확인(D29 — 사용자 게이트)
(과제 25 — 일시·대조표 경로·라이브 표본·지적과 처리)
