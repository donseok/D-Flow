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
출처: `grep -rnoE "(^|[^a-z0-9-])-?z-(\[[^]]+\]|\(--z-[a-z]+\)|[0-9]+)" src --include='*.tsx' --include='*.ts'` + className 밖(최종 리뷰 N7): `grep -rn "z-index" src --include='*.module.css'` · `grep -rn "zIndex" src` — 과제 23 머리(`de21512`) 기준 78줄(토큰 10 · 임의값 17 · 이름 유틸 51 — 브리프 사본 실측의 토큰 11·임의값 16 과 하나 다른 것은 전체 화면 +1 이 임의값 `z-[calc(…)]` 이라서). '화면 내부' = 그 화면의 스태킹 컨텍스트 안에서만 겨루는 층(전역 층과 순서를 다투지 않는다).

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
| **className 밖(최종 리뷰 N7 보충)** — 좌석 팝오버 `fixed` 140 | `agents/seatmap.module.css:153`(`.popWrap{position:fixed; inset:0; z-index:140}`) | 화면 SP 에서 `--z-modal`(또는 popover) | **전역 층** — AI 바·패널(130)·전체 화면(121) 위, 모달(150) 아래. UI-1 이 바꾼 값 아님(회귀 아님) |
| 좌석표 내부 2·1·1 | `agents/seatmap.module.css:109`·`:156`·`:224` | 화면 내부 — SP7 | 위상 슬롯·팝오버 본문·선택 좌석 |
| 위임표 3·1·4·6 | `agent-hub/delegationTable.module.css:48`·`:61`·`:62`·`:116` | 화면 내부 — SP7 | 고정 열·머리 |
| 인라인 `zIndex` 50·`z` | `wbs/WbsGanttSheet.tsx:1038`·`:1552` | 화면 내부 → SPU2 | 동결 셀 sticky — 행(`z-10`) 스태킹 문맥 안 |

새 층 둘: WBS 전체 화면 `--z-fullscreen: 120`(overlay 110 위·modal 150 아래), 보관 챗 = `--z-modal`(중첩 모달은 body 끝 포털의 문서 순서 — 판정 Q38). UI-2b: 전체 화면이 열린 동안 레일은 전체 화면 안 레일 자리로 포털(`useRailHost`).
지금 겹침 순서(UI-1 끝, 위가 위): 스킵·STAGING 250 > 토스트 200 > 모달·보관 챗 150 > 좌석 팝오버 140(CSS 모듈) > AI 바·패널 130 > 전체 화면 121 > AI 버튼 120 > 인스펙터·모바일 메뉴 110 > 팝오버 100 > 셸 70 > 툴바 토글 60 > 진척 렌즈 45. 알려진 어긋남 둘(회귀 아님 — 옛 값도 같은 순서): 모바일 메뉴 위에 AI 버튼, 전체 화면 위에 AI 바·패널 → 둘 다 UI-2b 레일 몫.

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

`DARK4`(판정 Q44 — 하드코딩 색 화면 12 ∪ 위 표에 이름으로 적힌 키, 과제 25 Step 6 이 `--routes` 로 쓴다. 대응표의 모든 파일이 UI-1 diff 에 있다 — "(무변경)" 행 없음. 최종 리뷰 N7: 좌석표 하드코딩 색 대부분이 있는 `p-office-lane`(supplement 행)을 더했다 — 스펙 §8.5 (b) 좌석표 네 크기):

DARK4=p-weekly,p-attendance,agents,p-office,p-office-lane,p-agents,p-wiki,p-wiki-topic,minute,p-dashboard,p-wbs,p-gantt,p-kanban,mobile-menu,account-popover,inbox-popover,login,not-found,invite,share,p-wbs-fullscreen,p-issues,p-meetings,p-announcements,p-members,p-import,p-import-admin,p-settings,meetings,minutes,portfolio,usage,admin-accounts,admin-teams,llm-config,account,projects,ws-settings,admin-ui-states,report-modal

## 3. UI-1 눈확인(스펙 §8.5 UI-1 행)
(과제 25 — (a) 전 라우트 라이트 회귀 차이율 표 · (b) 다크 · (c) axe · (d) 쇼케이스·지정 화면 · (e) Tab · (f) 인쇄 · 깜빡임 · 이월 목록. 쇼케이스 두 열 대조는 라이트 페이지 캡처로 본다 — 판정 Q37)

**조건:** 기준 `f2356ae`(UI-1 착수점, 스크래치 워크트리 `lane-b-base` 3202, 빌드 `Rm26jaiPqj7Feyg2u7uW0`) · 머리 `680c5d0`(3201, 빌드 `WqCys8H4DUXOqzZgRybvQ`) · KST 2026-10-01(시드 같은 날, db:reset → bootstrap → seed 21:34) · Chromium 145.0.7632.6 · 촬영 21:39~21:58(`qa/sp3b/bundle-t25.log`). 대조표 `qa/sp3b/ui1-sheet.html`(비교 132·ui1-dark 84·ui1-dark4 156·ui1-extra 30, axe 117행, checks 넷). 묶음 뒤 3201·3202 LISTEN 없음.

| 항목 | 결과 | 산출 |
|---|---|---|
| (a) 라이트 회귀 | 132장 same 0 · near 0 · **diff 132** · problem 0 · missing 0(토큰 전환이라 전 장이 다르다 — 예상). 대체 글꼴 0·maskZero 0. 상위 10(p-wiki 768 94.4% · root 1440 91.2% · projects 1440 91.2% · p-wiki 390 91.2% · projects·root 1280 89.5% · projects·root 768 88.2% · login 1440 88.0% · invite 1440 85.1%)과 §2 화면(p-wbs·p-dashboard·p-weekly·p-issues·p-settings·p-office-lane·login)을 열어 봤다 — 넘침·잘림·사라진 경계 없음, `.btn` 36 툴바 정렬 맞음 | `diff-ui1-base--ui1.md` |
| (b) 다크 | ui1-dark 84장(1440·390, `--since b4283c0,UI-1,C`)·ui1-dark4 156장(DARK4 39키 × 4) — 대체 글꼴 0, `expect-missing` 0(좌석표·위임표 막힘 좌석 그려짐). problem 은 `click-failed` 뿐: `mobile-menu`@1440·1280(햄버거는 lg 미만에만 — 라우트 정의), `p-wbs-fullscreen`@1280·768·390(좁은 폭은 툴바가 설정 버튼으로 접혀 토글이 숨는다 — 라우트 정의, 회귀 아님). 본 장: p-dashboard·p-weekly·p-attendance 1440, agents·p-wbs 390, report-modal·not-found 1440 — 글자 사라진 곳 없음. 주간 시트 표는 다크에서도 흰 바탕(하드코딩 — 이월) | `ui1-dark/`·`ui1-dark4/` |
| (c) axe 라이트 | 기준 33쪽 162 → 머리 52(같은 33쪽 기준). 라우트별 증가는 **p-office-lane 9 → 15** 하나 — 새 7노드는 범례 글자 `seatmap.module.css` `--sm-ink-3`(#7e8b93) on 캔버스 3.26. 같은 색이 기준에서도 3.28 이었고, 기준은 `.app-backdrop` 그라데이션 때문에 axe 가 판정 못 함(incomplete 31 → 머리 8) — 새로 측정된 기존 결함으로 본다(하드코딩 색, 이월). 나머지 6노드는 기준과 같다 | `ui1-base-axe/axe.json`·`ui1/axe.json` |
| (c) axe 다크 | 34노드. 하드코딩: 아바타 인라인 `#f538a0`+흰 글자 3.52(p-wbs·p-gantt·p-weekly·p-wbs-fullscreen), `PhaseBadge` 인라인 `#f2aa4c`+흰 1.97(agents·p-office·p-office-lane), `seatmap.module.css` eyebrow·cardZone 4.43, 주간 시트 `text-neutral-400` 2.58, 근태 칩 색 1.71~4.39. 화면 파일의 `opacity-40`(달력의 이번 달 밖 날짜 — `MeetingCalendar`·`AttendanceView`, 3.51·2.31)·`opacity-80`(회의 시각 4.23). **토큰 경로 의심 1 — `src/lib/domain/issues.ts` 의 칩 `bg-line text-ink-subtle`(보류 상태·낮음 심각도) 다크 4.19**: 경계 토큰을 채움으로 쓴 화면 조합(설계 쌍 표 밖). 고치지 않고 판정을 컨트롤러에 올린다 | `ui1/axe.json` |
| (d) 쇼케이스 | `showcase.json` 9쌍 unequal 0. 라이트 장(`ui1-extra/admin-ui-states-1440x900-light.png`)에서 두 열 대조 — 상태 8종 두 열 모두 읽힘, '설정 열기' 36px ghost. `/projects`·WBS·설정·로그인·404·초대·공유·ws-settings 1440 라이트·다크 30장 problem 은 mobile-menu@1440 click-failed 뿐 | `ui1/showcase.json`·`ui1-extra/` |
| (e) Tab | p-dashboard·p-wbs·p-meetings-list·report-modal × 라이트·다크 8쪽 — failedSteps 0 · unreached 0 | `ui1/tab.json` |
| (f) 인쇄 | report-modal 다크·라이트 각 글자 100, low 0, 최저 5.10 | `ui1/print.json` |
| 깜빡임 | login·account·p-dashboard × light·dark·system(OS 다크) 9행 모두 ok | `ui1/flicker.json` |
| 스모크 | exit 0 — §4 UI-1 행 | `smoke-ui1.txt` |
| 대조표 | 비교 절·추가 라벨 절 셋·axe 절(다크 행 포함)·checks 절 넷 | `ui1-sheet.html` |

**사용자 눈확인 볼 목록(정지 캡처로 다 못 본 것 — 원장 CARRY):** 전체 화면 층(`p-wbs-fullscreen` — FAB·AI 패널 겹침), `not-found`, 모달 바닥 `.btn` 36(정지 캡처에 열린 모달은 report-modal 뿐), 포커스 링 색(`border-focus`), SegmentedTabs 탭 폭 +15~18px(회의록 채팅 머리·회의록 툴바·회의일정·공지), 이정표 칩 9px 글자, 390 보고서 모달 바닥 좁음, `/projects` 히어로 pill 경계(UI-2b).

**이월(파일 → 소유 SP):** 주간 시트 표 흰 바탕·`text-neutral-400`(`WeeklySheetView` 계열 → 주간 화면 SP) · 근태 칩 색(`AttendanceView` → 근태 화면 SP) · 달력 `opacity-40`/`opacity-80`(`MeetingCalendar`·`AttendanceView` → 화면 SP) · 좌석표 `seatmap.module.css` `--sm-ink-3`·`PhaseBadge` 인라인 색(에이전트 화면 SP) · 아바타 인라인 색(프레즌스 → 화면 SP) · 벤더 색 grok 흰 위 2.64(판정 Q40) · 공용 기기 백필(판정 Q24) · 라우트 정의: `mobile-menu`·`p-wbs-fullscreen` 의 넓은·좁은 폭 click-failed(ui-capture 행에 sizes 를 두는 쪽 — 도구 이어 고치기) · 판정 대기: `issues.ts` 칩(위 (c) 다크).

**트레일러 시각 정정(기록):** 과제 9 커밋 `1d0d385` 은 트레일러가 없다 — 눈확인 근거 `local 2026-10-01 17:03 — p-wbs·p-issues·p-weekly·p-dashboard·projects·p-settings·minute·usage × 1440·390 × 라이트·다크`(u1-t9 32장). U1a 수정 커밋의 트레일러 18:43 은 실제 18:40, 과제 18 `cd36e3e` 의 20:13 은 실제 20:11.

## 4. 로컬 스모크(`SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod`)

| 시점 | 기록 | smoke exit | CSS 크기 | 규칙 수 | 커스텀 프로퍼티 | @property | @keyframes | 안전망 사본 |
|---|---|---|---|---|---|---|---|---|
| UI-0 기준(`b4283c0` 트리, 과제 5) | `qa/sp3b/smoke-ui0.txt`(2026-10-01 12:40) | 0(통과) | 130,834 B | 1,931 | 493 | 71 | 9 | 1 |
| UI-0 끝(`sp3b/ui0` 수정 라운드 머리 = main 반영 트리, 과제 6 수정) | `qa/sp3b/smoke-t6fix.txt`(2026-10-01 15:50) | 0(통과) | 130,834 B | 1,931 | 493 | 71 | 9 | 1 |
| UI-1 머리(`680c5d0`, 과제 25) | `qa/sp3b/smoke-ui1.txt`(2026-10-01 21:39) | 0(통과) | 124,966 B | 1,795 | 616 | 71 | 5 | 1 |

(UI-0 은 창 ① rebase 없이 main 에 들어갔다(ui1-addendum §1) — 계획의 델타 행 `smoke-ui0-delta.txt`(과제 6 Step 4)는 해당 없음이라 수정 라운드 끝 기록을 둘째 행으로 둔다. UI-0 은 `src/**` 무수정이라 두 행이 같다. UI-1 행은 과제 25.)

## 5. UI-1 사용자 확인(D29 — 사용자 게이트)
(과제 25 — 일시·대조표 경로·라이브 표본·지적과 처리)
