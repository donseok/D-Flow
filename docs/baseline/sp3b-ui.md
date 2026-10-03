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
| AI 버튼(FAB) `z-[120]` | `chat/AssistantChat.tsx:496` | **UI-2b 레일 → `--z-rail`(90) 권고**(`plan-ui2` 과제 30 의 `--z-fab` 과 어긋남 — §3 이월표, 컨트롤러가 계획 정정) | 주인 B. 지금 모바일 메뉴(110) 위·WBS 전체 화면과 같은 층이라 전체 화면에 +1 이 필요했다(과제 10 눈확인 CARRY · U1a F3). rail 90 이면 overlay·fullscreen·modal 모두 아래 — 전체 화면 동안은 D56 의 `useRailHost` 포털이 전체 화면 안 레일 자리에 둔다 |
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
(과제 25 — 최종 리뷰 수정 라운드 뒤 Step 3~8 재실행 결과. 앞 실행(머리 `680c5d0`, 21:39~21:58)의 산출은 `qa/sp3b/t25-r1/` 에 옮겨 두었다. 쇼케이스 두 열 대조는 라이트 페이지 캡처로 본다 — 판정 Q37)

**조건:** 기준 `f2356ae`(UI-1 착수점, 스크래치 워크트리 `lane-b-base` 3202, 빌드 `Rm26jaiPqj7Feyg2u7uW0` — 기준 트리 무변경이라 앞 실행 빌드 재사용) · 머리 `03e0e30`(3201, 빌드 `jgHPCj1M-kLT82K_Z721I` — 최종 리뷰 수정 `d6497b2`·`7feae90`·`5a44ba7`·`930bbb1` + 문서 `03e0e30`) · KST 2026-10-01(db:reset → bootstrap → seed 22:27, 같은 날) · Chromium 145.0.7632.6 · 촬영 22:28~22:47(`qa/sp3b/bundle-t25fix-step6.log`). 대조표 `qa/sp3b/ui1-sheet.html`(비교 132·ui1-dark 84·ui1-dark4 160·ui1-extra 30·ui1-mm390 2, axe 119행, checks 넷). 묶음 뒤 3201·3202 LISTEN 없음. 공통 묶음 로그 `qa/sp3b/t25fix-{vitest,lint,typecheck,build,settings-verify}.log`.

| 항목 | 결과 | 산출 |
|---|---|---|
| (a) 33라우트 라이트 회귀(오버레이 아홉 — `not-found`·`mobile-menu`·두 팝오버·전체 화면·보고서 모달·`ws-settings`·`admin-ui-states`·`p-meetings-list` — 은 기준 짝 없이 1440 정지 캡처만, (d)) | 132장 same 0 · near 0 · **diff 132** · problem 0 · missing 0(토큰 전환이라 전 장이 다르다 — 예상. same/near 가 아무것도 걸러 주지 않으므로 "회귀 없음"은 사람이 연 장에만 근거한다). 대체 글꼴 0·maskZero 0. 상위 10(p-wiki 768 94.4% · root·projects 1440 91.2% · p-wiki 390 91.2% · root·projects 1280 89.5% · root·projects 768 88.2% · login 1440 88.0% · invite 1440 85.1%)과 §2 화면(p-wbs·p-dashboard·p-weekly·p-issues·p-settings·p-office-lane·login)을 열어 봤다 — **기준과 다른** 넘침·잘림·사라진 경계 없음(p-issues 390 의 헤더 열 겹침·심각도 칩 잘림은 기준에도 같다), `.btn` 36 툴바 정렬 맞음. 장별 차이율은 아래 표 | `diff-ui1-base--ui1.md` |
| (b) 다크 | ui1-dark 84장(1440·390, `--since b4283c0,UI-1,C`)·ui1-dark4 160장(DARK4 40키 × 4 — `p-office-lane` 더함) — 대체 글꼴 0, `expect-missing` 0(좌석표·위임표 막힘 좌석 그려짐). problem 은 `click-failed` 뿐: `mobile-menu`@1440·1280(햄버거는 lg 미만에만), `p-wbs-fullscreen`@1280·768·390(좁은 폭은 툴바가 설정 버튼으로 접혀 토글이 숨는다 — 기준도 같은 모양, 회귀 아님). **전체 화면 다크 증거는 1440 한 장뿐**(나머지 세 크기는 일반 WBS 장). 본 장: p-dashboard·p-weekly·p-attendance 1440, p-office-lane 768, agents·p-wbs 390, report-modal·not-found 1440 — 글자 사라진 곳 없음. 주간 시트 표는 다크에서도 흰 바탕(하드코딩 — 이월) | `ui1-dark/`·`ui1-dark4/` |
| (c) axe 라이트 | 기준 33쪽 162 → 머리 **같은 33쪽 48**(새 쪽 포함 42쪽 49 — `p-wbs-fullscreen` 아바타 1). 라우트별 증가는 **p-office-lane 9 → 15** 하나(범례 `seatmap.module.css` `--sm-ink-3` 3.26 — 기준은 그라데이션 때문에 incomplete 31 로 판정 못 함 → 머리 8, 기존 결함이 측정됨, 이월). p-issues 10 → **0**(앞 실행 3 = `bg-line text-ink-subtle` 3.97 — N1 로 해소). **incomplete**(axe 가 겹침·그라데이션으로 판정 못 한 대비 — 통과가 아니다): 기준 498 → 머리 라이트 235(상위 p-wbs 44 · p-wbs-fullscreen 38 · p-gantt 37 · p-dashboard·inbox-popover·report-modal 15) | `ui1-base-axe/axe.json`·`ui1/axe.json` |
| (c) axe 다크 | **31노드**(앞 실행 34 − p-issues 3), incomplete 264(상위 p-wbs 45 · p-wbs-fullscreen 39 · p-gantt 38). 모두 이월 범주: 아바타 인라인 `#f538a0`+흰 글자 3.52(`PresenceStrip` — p-wbs·p-gantt·p-weekly·p-wbs-fullscreen), `PhaseBadge` 인라인 `#f2aa4c`+흰 1.97(agents·p-office·p-office-lane), `seatmap.module.css` eyebrow·cardZone 4.43, 주간 시트 `text-neutral-400` 2.58, 화면 `opacity`(달력·근태의 이번 달 밖 날짜 `opacity-40` 1.71~3.51 — 칩 안 글자 포함, 근태 종류 라벨 `opacity-75` 4.39, 회의 시각 `opacity-80` 4.23). **새 토큰 경로에서 온 위반 0** | `ui1/axe.json` |
| (d) 쇼케이스·지정 화면 | `showcase.json` 9쌍 unequal 0. 항목별: 라이트 장(`ui1-extra/admin-ui-states-1440x900-light.png`) 두 열 — 상태 8종 두 열 모두 읽힘, '설정 열기' 36px ghost · 표본 10 = 통과 6·거부 4(`tests/ui/ui-states-page.test.tsx` 가 고정) · `/projects` 히어로 평면(옅어진 pill 경계는 UI-2b) · WBS 오늘 칩 teal 12px·상태 채움 글자 읽힘(p-wbs 1440 라이트·다크) · 설정(p-settings 다크 — 목차·입력·저장 바) · 로그인 · 404(다크)·초대·공유 · ws-settings — 1440 라이트·다크 30장, problem 은 mobile-menu@1440 click-failed 뿐. **모바일 메뉴 열린 모습 390 라이트·다크**(`ui1-mm390/`, 최종 리뷰 증거 P2 — 앞 실행엔 라이트 390 이 없었다) problem 0, axe 0/0 | `ui1/showcase.json`·`ui1-extra/`·`ui1-mm390/` |
| (e) Tab | p-dashboard·p-wbs·p-meetings-list·report-modal × 라이트·다크 8쪽 — failedSteps 0 · unreached 0 | `ui1/tab.json` |
| (f) 인쇄 | report-modal 다크·라이트 각 글자 100, low 0, 최저 5.10. 단 PNG 는 보고서가 첫 카드에서 잘린다(인쇄 영역이 `Modal` 패널 `overflow-hidden` 안에 갇힘 — 기존 구조, 인쇄 기준 캡처가 없어 UI-1 이전부터인지 판정 불가, 이월). 글자 수·최저 대비는 잘린 노드까지 센 값 | `ui1/print.json`·`print-report-modal-*.png` |
| 깜빡임 | login·account·p-dashboard × light·dark·system(OS 다크) 9행 모두 ok | `ui1/flicker.json` |
| 스모크 | exit 0(새 검사 — 원색·비색 `:root` 블록 — 포함) — §4 UI-1 행 | `smoke-ui1.txt` |
| 대조표 | 비교 절·추가 라벨 절 넷(ui1-dark·ui1-dark4·ui1-extra·ui1-mm390)·axe 절(다크 행 포함 119행)·checks 절 넷 | `ui1-sheet.html` |

**(a) 장별 차이율(기준 `ui1-base` ↔ 머리 `ui1`, 라이트, 판정은 전부 diff):**

| 라우트 | 1440×900 | 1280×720 | 768×1024 | 390×844 |
|---|---|---|---|---|
| `account` | 53.4% | 51.3% | 45.0% | 43.0% |
| `admin-accounts` | 61.2% | 53.7% | 56.9% | 46.8% |
| `admin-teams` | 81.1% | 72.1% | 72.9% | 65.2% |
| `agents` | 58.4% | 44.9% | 49.7% | 30.9% |
| `invite` | 85.1% | 79.4% | 75.5% | 53.5% |
| `llm-config` | 59.3% | 50.6% | 57.0% | 48.8% |
| `login` | 88.0% | 84.5% | 84.1% | 75.1% |
| `meetings` | 56.0% | 47.9% | 54.5% | 47.5% |
| `minute` | 41.9% | 45.6% | 13.7% | 16.6% |
| `minutes` | 78.3% | 75.4% | 77.7% | 55.2% |
| `p-agents` | 76.4% | 67.3% | 63.3% | 57.1% |
| `p-announcements` | 34.7% | 34.4% | 14.9% | 17.4% |
| `p-attendance` | 59.1% | 51.8% | 57.0% | 44.9% |
| `p-dashboard` | 40.8% | 39.6% | 20.7% | 18.1% |
| `p-gantt` | 54.6% | 53.5% | 34.5% | 32.1% |
| `p-import` | 75.4% | 70.5% | 74.1% | 67.3% |
| `p-import-admin` | 83.8% | 80.9% | 81.5% | 74.7% |
| `p-issues` | 78.4% | 78.3% | 78.2% | 56.1% |
| `p-kanban` | 66.0% | 56.6% | 49.1% | 42.5% |
| `p-meetings` | 56.7% | 49.0% | 54.9% | 43.1% |
| `p-members` | 75.9% | 71.2% | 74.6% | 69.3% |
| `p-office` | 59.5% | 46.3% | 39.3% | 40.3% |
| `p-office-lane` | 83.7% | 73.6% | 69.5% | 37.9% |
| `p-settings` | 43.4% | 41.1% | 19.4% | 16.4% |
| `p-wbs` | 54.6% | 53.5% | 34.5% | 31.2% |
| `p-weekly` | 70.1% | 64.4% | 68.8% | 60.2% |
| `p-wiki` | 80.2% | 76.8% | 94.4% | 91.2% |
| `p-wiki-topic` | 49.4% | 45.9% | 31.5% | 32.1% |
| `portfolio` | 70.1% | 64.3% | 69.4% | 64.7% |
| `projects` | 91.2% | 89.5% | 88.2% | 75.5% |
| `root` | 91.2% | 89.5% | 88.2% | 75.5% |
| `share` | 22.3% | 24.8% | 13.0% | 24.9% |
| `usage` | 48.8% | 48.4% | 32.2% | 33.1% |

**(c) axe 라우트 × 테마(위반 노드 / incomplete, 1440, `*` = 그 행에 problems — mobile-menu@1440 click-failed):**

| 라우트 | 기준 라이트 | 머리 라이트 | 머리 다크 |
|---|---|---|---|
| `account` | 0 / 5 | 0 / 0 | 0 / 1 |
| `account-popover` | — | 0 / 1 | 0 / 1 |
| `admin-accounts` | 3 / 5 | 0 / 0 | 0 / 1 |
| `admin-teams` | 0 / 5 | 0 / 0 | 0 / 1 |
| `admin-ui-states` | — | 0 / 0 | 0 / 1 |
| `agents` | 4 / 23 | 4 / 1 | 2 / 2 |
| `inbox-popover` | — | 0 / 15 | 0 / 16 |
| `invite` | 0 / 3 | 0 / 0 | 0 / 1 |
| `llm-config` | 0 / 5 | 0 / 0 | 0 / 1 |
| `login` | 0 / 22 | 0 / 0 | 0 / 1 |
| `meetings` | 13 / 20 | 6 / 7 | 5 / 8 |
| `minute` | 0 / 8 | 0 / 4 | 0 / 5 |
| `minutes` | 0 / 25 | 0 / 14 | 0 / 15 |
| `mobile-menu` | — | 0* / 1 | 0* / 1 |
| `not-found` | — | 0 / 0 | 0 / 0 |
| `p-agents` | 2 / 22 | 0 / 0 | 0 / 1 |
| `p-announcements` | 8 / 5 | 0 / 0 | 0 / 1 |
| `p-attendance` | 18 / 25 | 9 / 7 | 9 / 8 |
| `p-dashboard` | 6 / 19 | 0 / 15 | 0 / 16 |
| `p-gantt` | 17 / 57 | 1 / 37 | 1 / 38 |
| `p-import` | 2 / 4 | 0 / 0 | 0 / 1 |
| `p-import-admin` | 2 / 5 | 0 / 0 | 0 / 1 |
| `p-issues` | 10 / 7 | 0 / 0 | 0 / 1 |
| `p-kanban` | 7 / 13 | 0 / 7 | 0 / 8 |
| `p-meetings` | 15 / 20 | 6 / 7 | 5 / 8 |
| `p-meetings-list` | — | 0 / 0 | 0 / 1 |
| `p-members` | 2 / 3 | 0 / 0 | 0 / 1 |
| `p-office` | 6 / 22 | 4 / 1 | 2 / 2 |
| `p-office-lane` | 9 / 31 | 15 / 8 | 3 / 1 |
| `p-settings` | 2 / 4 | 0 / 0 | 0 / 1 |
| `p-wbs` | 22 / 47 | 1 / 44 | 1 / 45 |
| `p-wbs-fullscreen` | — | 1 / 38 | 1 / 39 |
| `p-weekly` | 4 / 9 | 2 / 2 | 2 / 3 |
| `p-wiki` | 2 / 12 | 0 / 0 | 0 / 1 |
| `p-wiki-topic` | 3 / 9 | 0 / 1 | 0 / 2 |
| `portfolio` | 5 / 22 | 0 / 4 | 0 / 5 |
| `projects` | 0 / 15 | 0 / 1 | 0 / 1 |
| `report-modal` | — | 0 / 15 | 0 / 16 |
| `root` | 0 / 15 | 0 / 1 | 0 / 1 |
| `share` | 0 / 4 | 0 / 4 | 0 / 5 |
| `usage` | 0 / 7 | 0 / 0 | 0 / 1 |
| `ws-settings` | — | 0 / 0 | 0 / 1 |

**사용자 눈확인 볼 목록(정지 캡처로 다 못 본 것 — 원장 CARRY):** 전체 화면 층(`p-wbs-fullscreen` — FAB·AI 패널 겹침, 다크 증거 1440 뿐), `not-found`, 모달 바닥 `.btn` 36(정지 캡처에 열린 모달은 report-modal 뿐 — 이슈 상세 모달의 중립 칩·업데이트 목록 배경(N1·N4)도 여기서), 포커스 링 색(`border-focus`), SegmentedTabs 탭 폭 +15~18px(회의록 채팅 머리·회의록 툴바·회의일정·공지), 이정표 칩(12px 하한 — `wbs-sheet-colors` 가 `max(12px, …)` 를 고정, 옛 목록의 "9px" 는 틀린 표기), 390 보고서 모달 바닥 좁음, 보고서 인쇄 미리보기 잘림(위 (f)), `/projects` 히어로 pill 경계(UI-2b), WBS 접힌 행 수 배지(N1 — 흰 알약 + 경계 링).

**이월(파일 → 받는 쪽):**

| 항목 | 받는 쪽 | 근거·비고 |
|---|---|---|
| 아바타 흰 글자 3.52(`PresenceStrip.tsx`·`sheetPresence.ts` 색 풀) | **UI-2b**(전역 바 과제 — `plan-ui2` 과제 추가는 컨트롤러가 계획에 반영) | `no-raw-color` `ALLOW` 사유("함께 보기 표시 — 셸, UI-2b 가 다시 쓴다")와 같은 소유자. 인라인 style 이라 `no-raw-color` 는 못 잡는다 — 이 표가 유일한 기록 |
| ui-capture `click` 단수 → `clicks`(배열) + 행별 `sizes` 제한(`mobile-menu` 는 lg 미만, `p-wbs-fullscreen` 은 설정 팝오버 열기 뒤 토글) | **UI-2 첫 과제**(도구) | `plan-ui2` 의 `clicks` 행·`p-wbs-fullscreen`·`p-wbs-fullscreen-ai`(390) 가 지금 도구로는 click-failed |
| FAB z: UI-1 표(§1 AI 행)는 `--z-rail`(90) 권고, `plan-ui2` 과제 30 은 `--z-fab` | **컨트롤러가 `plan-ui2` 정정** | 같은 커밋에서 전체 화면 `+1` 되돌림·`fullscreen-layer.test.ts` FAB 탐색·`no-raw-color` `ALLOW` 건수를 맞춘다(§1 전체 화면 행) |
| UI-0 범위 재리뷰 P3 넷 — P3-1 원문 검사 우회 다섯·P3-3 axe 산출물에 서버 정체 없음·P3-4 문서 invite 행 옛 라벨·P3-5 약한 테스트 둘(`ui0-rereview.md`) | **UI-2 첫 과제**(도구 — 위 `clicks` 와 같은 과제) | 과제 23·UI-1 Phase 끝 리뷰 두 약속 지점을 모두 지나 받는 쪽이 없었다 |
| `BrandMark` 모노그램 `bg-brand text-white`(다크 약 2.3:1, `aria-hidden` 글리프라 axe 밖) | **C — UI-2b 이동 커밋** | `fill-foreground` `ALLOW`. 스펙 §4.4 가 UI-1 무수정으로 정함 |
| 월 밖 날짜 `opacity-40`·시각 글자 `opacity-75/80`(`MeetingCalendar`·`MinutesCalendar`·`AttendanceView`) | **SP5**(개정 §5.9.4 #8·#26·#31) | 칩 토큰 쌍(`bg-done-weak text-done` 등)은 통과 — 하드코딩 색이 아니라 화면 `opacity` 가 깎는다. 받는 SP 스펙에 "월 밖 칸 흐림 = opacity 가 아니라 `fg-muted`" 한 줄. 이월 허용 범위 판정은 컨트롤러 원장 |
| 주간 시트 표 흰 바탕·`text-neutral-400`(`WeeklySheetView` 계열) | SP4(#25) | `no-raw-color` `ALLOW` |
| 좌석표 `seatmap.module.css`(`--sm-ink-3` 범례 3.26·eyebrow 4.43·좌석 팝오버 fixed 140 — §1)·`PhaseBadge` 인라인 색 | SP7(#32·#33) | CSS 모듈·인라인이라 이 표가 기록 |
| 보고서 인쇄 영역이 모달 `overflow` 에 갇혀 첫 쪽만 보임 | 보고서 화면 소유 SP(UI-5) | 위 (f). 기준 비교 없음 |
| 벤더 색 grok 흰 위 2.64 · 공용 기기 백필 | 판정 Q40 · 판정 Q24 | |

**트레일러 예외(마감 §9 ⑩ 점검용):** 과제 9 커밋 `1d0d385` 은 `Preview-checked` 트레일러가 없다 — 이미 원격(`origin/ui/sp3-tokens`)이라 고치지 않는다. 눈확인 근거는 `local 2026-10-01 17:03 — p-wbs·p-issues·p-weekly·p-dashboard·projects·p-settings·minute·usage × 1440·390 × 라이트·다크`(u1-t9 32장)이고, **마감 때 `git log … Preview-checked` 출력의 빈 줄 하나는 이 기록으로 갈음하는 허용 예외다.** 원격 `ui/sp3-tokens` 는 main 반영 뒤에 지운다(먼저 지우거나 prune 하면 `1d0d385` 가 G2 범위로 돌아와 push 가 막힌다). 시각 정정: U1a 수정 커밋의 트레일러 18:43 은 실제 18:40, 과제 18 `cd36e3e` 의 20:13 은 실제 20:11. 최종 리뷰 수정 `d6497b2` 의 "이슈 상세 모달 × 1440 라이트·다크" 중 모달 라이트는 실제로는 다크 장이었다(서버 선호가 앞 촬영의 dark 로 남음) — 이슈 칩 라이트는 p-issues 라이트로 봤다.

## 4. 로컬 스모크(`SMOKE_URL=http://127.0.0.1:3201 npm run smoke:prod`)

| 시점 | 기록 | smoke exit | CSS 크기 | 규칙 수 | 커스텀 프로퍼티 | @property | @keyframes | 안전망 사본 |
|---|---|---|---|---|---|---|---|---|
| UI-0 기준(`b4283c0` 트리, 과제 5) | `qa/sp3b/smoke-ui0.txt`(2026-10-01 12:40) | 0(통과) | 130,834 B | 1,931 | 493 | 71 | 9 | 1 |
| UI-0 끝(`sp3b/ui0` 수정 라운드 머리 = main 반영 트리, 과제 6 수정) | `qa/sp3b/smoke-t6fix.txt`(2026-10-01 15:50) | 0(통과) | 130,834 B | 1,931 | 493 | 71 | 9 | 1 |
| UI-1 머리(`680c5d0`, 과제 25) | `qa/sp3b/t25-r1/smoke-ui1.txt`(2026-10-01 21:39) | 0(통과) | 124,966 B | 1,795 | 616 | 71 | 5 | 1 |
| UI-1 최종 리뷰 수정 뒤(`03e0e30`, 과제 25 재실행) | `qa/sp3b/smoke-ui1.txt`(2026-10-01 22:28) | 0(통과 — 원색·비색 `:root` 검사 포함, 커스텀 프로퍼티 하한 480) | 125,369 B | 1,800 | 618 | 71 | 5 | 1 |
| UI-2b 최종 수정 뒤(`bffd64e` 와 같은 src — 3203 스크래치 빌드, GG3) | `qa/sp3b/smoke-ui2g.txt`(2026-10-02 15:46) | 0(통과) | 124,922 B | 1,799 | 619 | 71 | 5 | 1 |

(UI-0 은 창 ① rebase 없이 main 에 들어갔다(ui1-addendum §1) — 계획의 델타 행 `smoke-ui0-delta.txt`(과제 6 Step 4)는 해당 없음이라 수정 라운드 끝 기록을 둘째 행으로 둔다. UI-0 은 `src/**` 무수정이라 두 행이 같다. UI-1 행은 과제 25.)

## 5. UI-1 사용자 확인(D29 — 사용자 게이트)
| 항목 | 값 |
|---|---|
| 일시 | 2026-10-01 23:10 KST(사용자 확인 회신) |
| 확인한 머리 | `9b3dc49`(최종 리뷰 수정·Step 3~8 재실행 뒤 — 범위 재리뷰 초록) |
| 대조표 | `.superpowers/qa/sp3b/ui1-sheet.html`(리포 밖) |
| 라이브 표본 | 3201 프로덕션 빌드(127.0.0.1) — `/admin/ui-states`·`/projects`·WBS(전체 화면)·프로젝트 설정·로그인·워크스페이스 설정 × 라이트·다크, 정지 캡처로 다 못 본 10항목 목록 함께 안내 |
| 계정 | 시드 `ui-member`·`ui-platform`(확인 동안만 임시 비밀번호 — 대화에만, 확인 뒤 다시 임의 값) |
| 사용자 판정 | "제대로 봤어. 많은 부분이 개선되었네. 괜찮아." — 지적 없음 |
| 처리 | 수정 없음. 이월은 §3 이월표 그대로 |

## 6. UI-2a 눈확인(에이전트 — D29)

> **rebase 전(merge-base `305a3b4`) 기록이다 — main `7768830` 위로 rebase 한 뒤의 판정은 §8(과제 39)이 최신이다.**

- 착수점 `8a84269`(옛 경로가 아직 페이지 — 기준 서버 3202 로 별도 워크트리에서 빌드), 머리 `4e3d43c`(캡처는 `03f07b2` 서버, 이후 변경은 E2E 스크립트 한 파일). 시드 2026-10-02, 라이트, 네 크기(1440×900·1280×720·768×1024·390×844). 증거 폴더 `qa/sp3b/ui2a-base`·`ui2a`·`ui2a-extra`·`ui2a-chip`·`ui2a-h1`, 비교표 `diff-ui2a-base--ui2a-pair.md`·`diff-ui2a-base--ui2a.md`.
- 스모크: `smoke:prod`(3201) 통과(`smoke-ui2a.txt`). 서버 두 개(3201·3202)는 묶음 뒤 모두 내려갔다.
- 스파이크 요약(`spike-ui2.md`): S-1 ② 스텁 307·no-store 통과(원점 주의 → 상대 `Location`, 판정 W2), S-1 ① 간트 200(로딩 경계 안 meta refresh) → 간트를 `(legacy)` 로 옮겨 307(판정 W1), S-5 `.app-main` 스크롤 통과, S-8 ①② 소프트 이동이 스텁을 지나도 전체 새로고침·오류 경계 없음(통과).

### 판정표(스펙 §8.5 UI-2a 행)

| 항목 | 통과 조건 | 결과 | 산출 |
|---|---|---|---|
| 짝 비교(`--pair`) | 옮긴 여덟 화면의 새 경로 장이 기준 옛 경로 장과 같거나 이 Phase 가 의도한 차이뿐 | **통과** — compared 32 · same 6 · near 6 · diff 20 · problem 0 · missing 0. diff 의 원인은 아래 4종뿐(장마다 확인) | `diff-ui2a-base--ui2a-pair.md` |
| 옛 경로 이동 | 옛 키 장의 최종 URL 이 `/w/<wsSlug>/…`, problem 0 | **통과** — root→`/w/default`, meetings·minutes·minute·agents·portfolio·usage·admin-accounts·admin-teams 모두 `/w/default/…`, 머리 80장 problems 0·idle 거짓 0. 기준 서버는 옛 경로가 최종(`baseFinal`) | `ui2a/meta.json` |
| 홈 v0·내 업무 v0·리졸버 | 섹션 셋·종류 칩·빈 상태, `/` → `/w/<slug>` | **통과** — 홈 세 섹션(처리할 일·진행 중 프로젝트·공지), 내 업무 종류 칩·행, root 최종 `/w/default` | `ui2a/ws-home-*`·`ws-my-work-*`·`root-*` |
| 회의록 칩·개요 | '프로젝트: …' 칩과 ×, 개요 회의 카드, '이 프로젝트 회의록' 링크 | **통과(일부는 단위 테스트 근거)** — 칩 `프로젝트: UI-CAPTURE ×`(`ui2a-chip/`), 프로젝트 회의 화면 머리의 '이 프로젝트 회의록'(`ui2a-extra/p-meetings-*`). **개요(`/p/<pid>/dashboard`) 회의 카드**: 뷰포트를 키운 전체 페이지 캡처(`ui2a-extra/p-dashboard-full-on-{1440x900,390x844}-light.png`)와 카드 확대(`p-dashboard-meeting-card-on-*-light.png`)에서 카드 머리 오른쪽에 '이 프로젝트 회의록'이 있고 `href=/w/default/minutes?project=<pid>`(1440·390 모두, 접히지 않음). 개요의 모듈 꺼짐 때 카드가 사라지는 것은 눈으로 보지 못했다 — 이슈를 끈 시드 프로젝트(`pOff`)는 WBS 0건이라 개요가 빈 상태('분석할 WBS 데이터가 없습니다', `…-off-*.png`)여서 카드 비교가 성립하지 않는다. 그 구현은 `dashboard-cross-module.test.tsx` 가 고정한다(꺼짐과 실패를 구분) | `ui2a-chip/`·`ui2a-extra/` |
| 가시 h1 수 | 기록(판정은 UI-2b ④) | 기록 — 아래 | `ui2a-h1/meta.json` |
| E2E | 일곱 단계 ✓ | **통과**(`sp3b-e2e.md`) — 통과한 최종 표는 `e2e-sp3b-2026-10-01T19-20-39-631Z.md`. (`e2e-ui2a.txt` 는 E6 가 실패한 **첫 실행**의 출력이다 — 증거로 쓰지 않는다) | `qa/sp3b/e2e-sp3b-2026-10-01T19-20-39-631Z.md` |
| 스모크 | exit 0 | **통과** | `smoke-ui2a.txt` |

짝 비교 diff 의 원인(의도한 차이):
1. **워크스페이스 한정(D21·D22)** — 포트폴리오 행 5→1(시드 프로젝트 하나, 다른 워크스페이스·rls 프로젝트 제외), 계정 12→5(그 워크스페이스 소속·명단). 좌석표(`ws-agents`)는 여기에 속하지 않는다 — 시드에 프로젝트가 하나라 좌석표 층 수는 바뀌지 않았고(768·390 이 0.00%, 본문 같음) 한정 동작은 `tests/agents/seatmap-scope.test.tsx` 가 증명한다. `ws-agents` 의 1280·1440 차이(0.41~0.58%)는 사이드바 안(20,220 203×438)이며 원인은 3 이다.
2. **사용 현황 범위 칩**(D21) — '플랫폼 전체(워크스페이스 구분은 SP8)'.
3. **옛 셸의 경로 의존 표시가 사라짐** — 사이드바 활성 항목·프로젝트 메뉴·브레드크럼이 `/minutes`·`/p/…` 경로로 파생되어 새 경로(`/w/<slug>/…`)에서는 비어 보인다. 판정 W13 이 허용한 공백이며 UI-2b 의 셸 교체(과제 31)가 메운다 — **UI-2a 단독으로 main 에 넣지 않는 이유**.
4. 회의록·회의 화면 좌측 약 600×640 영역(1.1~1.6%) — 위 3 의 사이드바 프로젝트 메뉴 부재(기준 장에는 이전 프로젝트의 메뉴가 있다). 768·390 의 near(0.13~0.15%)는 머리 영역(브레드크럼 칩)뿐.

장별 차이율(라이트, `diff-ui2a-base--ui2a-pair.md` 에서 옮김 — 판정 수 same 6 · near 6 · diff 20, problem 0):

| 라우트 | 1440 | 1280 | 768 | 390 | 원인(번호는 위 목록) |
|---|---|---|---|---|---|
| ws-admin-accounts | 2.85% | 3.30% | 5.12% | 11.43% | ① 워크스페이스 한정(행 12→5, 프로젝트 select 사라짐 — 후보 1개) |
| ws-usage | 5.94% | 6.44% | 7.46% | 10.36% | ② 범위 칩(머리 아래 52px 밀림) + ③ 사이드바 |
| ws-portfolio | 3.45% | 4.45% | 3.26% | 5.23% | ① 워크스페이스 한정(행 5→1·요약 수치) |
| ws-meetings | 1.12% | 1.57% | 0.15% | 0.13% | ③·④ 사이드바 프로젝트 메뉴·활성 항목 부재(768·390 은 브레드크럼 칩) |
| ws-minutes | 1.10% | 1.55% | 0.15% | 0.13% | ③·④ 사이드바 프로젝트 메뉴·활성 항목 부재(768·390 은 브레드크럼 칩) |
| ws-minute | 1.10% | 1.55% | 0.15% | 0.13% | ③·④ 사이드바 프로젝트 메뉴·활성 항목 부재(768·390 은 브레드크럼 칩) |
| ws-agents | 0.41% | 0.58% | 0.00% | 0.00% | ③ 사이드바 `UI-CAPTURE 메뉴` 블록 부재(좌석표 본문은 같다 — 768·390 이 0.00%) |
| ws-admin-teams | 0.00% | 0.00% | 0.00% | 0.00% | 차이 없음 |

### 레인 A 알림(main 반영 때 충돌·확인 대상 — 원장 목록에 더한다)

`merge-base 305a3b4` 이후 main(`54a202e`)과 양쪽이 바꾼 파일 아홉: `scripts/ui-capture.mjs`, `tests/gates/manifest.ts`, `tests/invariants/project-page-gates.test.ts`, `tests/invariants/settings-writes.test.ts`, `tests/minutes/external-api.test.ts`, `tests/rls/fixture-ws.sql`, `tests/rls/isolation-map.ts`(account_preferences 탐침 — 레인 A 소유), `tests/scripts/ui-capture.test.ts`, `tests/ui/app-layout-teams.test.tsx`. `git merge-tree` 3-way 충돌 표지는 0 이다. 앞의 원장 알림에는 `isolation-map.ts`·`external-api.test.ts`·`app-layout-teams.test.tsx` 가 없었다.

### 이월(문구·표현)

- 포트폴리오 화면 제목이 워크스페이스 한정(D21) 뒤에도 '전사 포트폴리오' 로 남아 있다(`ws-portfolio` 캡처) — 문구가 사실과 다르다. 화면 소유 SP 가 정리하며 UI-2b/UI-3 이월 목록에 한 줄 둔다.
- 스펙 §5.3·§8.3 E1 의 "`Location` 은 요청 원점" 은 판정 W2(상대 `Location`)로 갈음했다 — §7 반영 때 스펙 문언을 정정한다.
- 없는 `/w/<slug>/…` 경로의 RSC prefetch 가 끝나지 않는 관찰(U2a-5) — 과제 25 가 `/w/<slug>/projects` 를 만들어 홈의 '전체 보기'·시작 화면이 가리키던 임시 옛 경로를 새 경로로 돌렸다. 남은 없는 경로 링크는 과제 31·35 의 전수 점검 몫.

### 가시 h1 수(기록 — 1280×720·390, 44 라우트)

대부분의 옛 셸 화면이 가시 h1 이 **0** 이다(`PageHero` 는 접힌 머리만 그린다 — 공유 `share`·`ws-minute` 는 2). 홈·내 업무는 세 크기 모두 1. UI-2b 과제 32 가 모든 뷰포트 h1 을 판정한다.

### 알려진 도구 상태

- `ui2a-h1` 의 `withProblems`: `mobile-menu@1280x720`·`p-wbs-fullscreen@1280x720·390`(클릭 대상이 그 크기에 없음 — UI-1 부터 같은 행의 알려진 한계, 화면 문제 아님).

## 7. UI-2b 눈확인(에이전트 — 과제 38, 최종 리뷰 수정 GG3 로 재생성)

> **rebase 전 기록이다 — rebase 뒤 재생성은 §8(과제 39).** 아래 '사용자 확인(D29)' 절은 rebase 전 머리(`8150307`)에 대한 것이다(§8 의 'D48 — 섞임' 참고).

> **GG3 재생성(2026-10-02 15:46~16:29 — 아래 'GG 뒤 재생성' 절이 최신 판정이다).** 이 절의 첫 판(머리 `256652a`)에서 미해결이던 셋 — 가시 h1 = 1(회의록 상세·스텁·share 2), 390 달력 공휴일 라벨 잘림, UI 위험 목록 — 은 각각 `8aada02`(본문 머리 강등)·`9ce4f5c`(라벨 줄바꿈)·`87102b7`(CLAUDE.md)로 **해결**됐다. 대조표 `ui2b-sheet.html` 은 GG 뒤 판으로 바뀌었다(첫 판은 `ui2b-sheet-1237.html`).

- 기준 = UI-2 착수점 `8a84269`(스크래치 `lane-b-base` · 3202 · 빌드 `T1Ky7IAqYrNJRQwZejnI5`), 머리 = `256652a`(DD1 — 캡처 서버 빌드 `oEi0sF6IIoXxcl7s6FMIo`) · 키보드 재측정 `40c4127`(캡처 행 선택자 한 줄 — 앱 코드 같음). 시드 2026-10-02. 증거 폴더 `qa/sp3b/ui2b-base`·`ui2b`·`ui2b-shell`·`ui2b-accent-{default,bright,dark}`·`ui2b-scrolled`·`ui2b-settings-bottom`·`ui2b-nojs`·`ui2b-nojs-ref`·`ui2b-fs-ai`·`ui2b-h1`·`ui2b-broken`·`ui2b-base-axe`·`ui2b-tab2`, 비교표 `diff-ui2b-base--ui2b-pair.md`·`diff-ui2b-base--ui2b.md`, 대조표 `ui2b-sheet.html`(섹션 11 · axe 174행 · tab).
- 스모크: `smoke:prod`(3201) 통과(`smoke-ui2b.txt`). 서버(3201·3202)는 묶음마다 내려갔다.
- 공통 묶음: vitest 784 files · 9,992 tests(실패 1 = 알려진 `baseline-cli`), lint 0 errors(경고 4 기존), typecheck 0, build 통과. `breakpoint-safety-net`·`platform-guards`·`guard-signatures` 무수정 초록, `globals.css` 안전망 블록 sha1 이 `b4283c0`·`305a3b4`·머리에서 같다. 임시 허용(`'UI-2b: '`·`'UI-2b — '`) 0·0·0, 브리지·`ProjectTabs`·`SECTION_LABEL` 잔재 0, `(legacy)` route 10(스텁 9 + 간트 — 판정 W1).
- DB 묶음: `db:reset` → `dev:bootstrap` → `test:rls` 28 files · 289 tests(건너뜀 0) → `settings:verify` 초록 → 캡처 시드.

### 스파이크 결과(`.superpowers/sp3b/spike-ui2.md`)

| # | 판정 |
|---|---|
| S-2 | 혼합 — 범위 레이아웃이 던지는 404 는 HTTP 404, 로딩 경계 안 페이지 404 는 200 + notFound digest. E2E E4 는 '404 또는 digest'(실측: 세 경로 모두 404 + digest) |
| S-3 | 통과 — 대안(`scopeMatchesPath` 로 게시 기다림) 뒤 `/w↔/p` 이동당 `/api/shell` 1회·소켓 1·URL 커밋 p95 83ms, `/w↔(global)` AI 입력·레일 보존 |
| S-6 | 통과 — 범위 레이아웃 `generateMetadata` 의 icons 가 루트 파일 아이콘을 덮는다(C `3cae800`), `icon.tsx`·`apple-icon.tsx` 무변경 |
| S-7 | 회의록 탐색기 문서형 유지 + 트리만 lg 고정(BB2 `0a8538a` — 26건 재측정에서 트리 이탈 수정) |
| S-8 ③ | 통과 — 전환기 B 뒤 65ms 안에 사이드바 '전체 보기'가 B 경로(`router.refresh()` 불필요) |

### 판정표(스펙 §8.5 UI-2b 행)

| 항목 | 통과 조건 | 결과 | 산출 |
|---|---|---|---|
| (a) 셸 행렬 | 범위마다 그 범위 내비, 접힘·펼침, duo 전환, 드로어, 브레드크럼 '워크스페이스 전체' 칩, 에이전트 세 화면, 설정 저장 바, 에이전트 보기 전환, WBS 스크롤 하나, AI 레일 병치·오버레이, 로고·accent·파비콘, 홈·내 업무 v0 | **통과** — 176장(22행 × 네 크기 × 라이트·다크), problems 은 그 크기에 UI 가 없는 click-failed 뿐(전환기·AI 버튼은 390 에 없음, 드로어·햄버거는 lg 미만 전용). 열어 본 장: ws-switcher-open 1440 다크(두 워크스페이스·체크), drawer-project 390 다크(프로젝트 내비·닫기), ws-home-collapsed 1280(64px 아이콘 레일), p-wbs 1280(채움형 — 그리드만 스크롤), rail-ai-1280 → 1440 병치·1280 오버레이, ws-agents 1440(브레드크럼 '워크스페이스 전체' + 에이전트 현황 활성). accent 셋 24장 problems 0 — 밝은 `#ffd43b` 은 라이트 세트 `#8c7316` 로 어두워져 링크·아바타·활성 칩에, 어두운 `#1c1c6b` 다크는 `#7181d8` 계열(열어 봄). 설정 바닥 6장 — 저장 바(변경 0개)가 마지막 입력을 가리지 않음 | `ui2b-shell/`·`ui2b-accent-*/`·`ui2b-settings-bottom/` |
| 가시 h1 = 1 | 모든 라우트 × 1280×720·390 | **해결(GG3 재측정: 66행 132장 모두 1)** — 첫 판(`256652a`)에서는 `ws-minute`·`minute`(스텁 최종)·`share` 가 2(본문 마크다운 `# 제목` 을 `MarkdownView` 가 h1 로 그림, UI-2a 부터 같음). 판정 R-h1 로 `8aada02` 가 본문 머리를 한 단계 강등(`demoteHeadings` — 시각 클래스 그대로)했고, `ui2g-h1` 이 전 행 1 을 확인했다 | `ui2b-h1/meta.json`(첫 판)·`ui2g-h1/meta.json`(재측정) |
| (b) 전 라우트 회귀 | diff 장이 의도한 차이(셸 교체)뿐 | **통과** — 짝 36: diff 36·problem 0(옮긴 화면 전부 — 전역 바·브레드크럼·워크스페이스 내비·접기·main 여백 16px 이 원인, 본문 같음: agents⇔ws-agents 1440·meetings⇔ws-meetings 390 열어 봄). 옛 키 264: same 17·diff 140·new 96·problem 11 = 모두 click-failed(기준 서버에 `/w/<s>/projects` 가 없어 mobile-menu·account-popover 행이 클릭 대상 없음, p-wbs-fullscreen·mobile-menu 의 크기 한계는 UI-1 부터). 옛 키 최종 URL 전부 `/w/default/…`(p-gantt → `/p/<pid>/…`) | `diff-ui2b-base--ui2b*.md` |
| (c) 스크롤 상태 | 고정 요소가 도구 줄을 덮지 않음 | **통과** — 28장 problems 0(p-weekly 1280 열어 봄 — 도구 줄 위 고정 요소 없음) | `ui2b-scrolled/` |
| JS 끈 첫 페인트 | 사이드바 유무·폭·머리 높이가 JS 켬과 같다(D55) | **통과** — p-dashboard 1280·ws-home 390 비교(사이드바 232px·전역 바 48px 같음, 본문만 스켈레톤) | `ui2b-nojs`·`ui2b-nojs-ref` |
| 전체 화면 AI | 레일이 전체 화면 안에 열리고 숨지 않는다(D56) | **통과** — p-wbs-fullscreen-ai 1440 라이트·다크(전체 화면 오른쪽 레일). 390·compact 행의 click-failed 는 크기 한계 | `ui2b-fs-ai/` |
| 키보드 | Tab 순회 실패 0·미도달 0 | **통과(재측정)** — 첫 측정은 p-dashboard 미도달 `aside a…`(도구 행이 옛 셸 `<aside>` 를 가리킴 — 새 셸 내비는 `[data-side-rail] nav`) → `40c4127` 로 선택자를 고쳐 ws-home·p-dashboard·p-wbs × 라이트·다크 실패 0·미도달 0 | `ui2b-tab2/tab.json` |
| axe | 머리 위반 ≤ 기준(라이트), 다크는 새 셸 파일에서 온 위반 0 | **조건부 통과** — 같은 키 라이트: agents·meetings·p-attendance·p-office·p-office-lane·p-weekly 같음, **p-dashboard 0→24**(같은 경로의 행 넷도 24). 24 는 개요 이슈 카드(`IssueStatusCard` — 이슈 없는 영역 카드 `opacity-60` + `text-ink-subtle`, 2.39·4.33)의 기존 결함: 컴포넌트·색 토큰이 UI-2 범위에서 바뀌지 않았고 기준은 같은 노드를 `incomplete`(15)로 남겼다(스크롤 주체가 main 하나로 바뀌어 접힘 밖 노드가 측정됨 — UI-1 의 p-office-lane 판정과 같은 부류). 라이트·다크 모두 셸 요소(header·nav·`data-side-rail`·`#app-rail`·브레드크럼·전환기·계정) 위반 노드 0 | `ui2b/axe.json`·`ui2b-base-axe/axe.json` |
| 설정 손상 | 셸이 열리고 머리 알림, 설정 화면 열림, 개요 정상(D49) | **통과** — `navigation.menu:"oops"` 상태 8장 problems 0: 알림 '설정을 불러오지 못해 메뉴 일부를 숨겼습니다.'·'설정 열기', `/w/<s>/settings` 열림, 개요 정상(열어 봄). 묶음 안에서 원래 values 로 복원·대조 | `ui2b-broken/` |
| E2E·스모크·성능 | Step 3·4 | E2E E1·E2·E4~E11 10/10 ✓·스모크 통과(`sp3b-e2e.md`) · 성능은 `sp3b-perf.md`(시리즈 1·2 초과, 시리즈 3·9회 합 통과 — 잡음 기록) | 기록 문서 |

### 관찰(이월 후보)

- ~~390 회의 달력(`ws-meetings`·`p-meetings`): main 좌우 여백이 16px 로 늘어 칸이 좁아져 공휴일 표지 글자가 잘린다~~ — **해결**(판정 R-390, `9ce4f5c` — 좁은 화면에서 라벨이 칸 너비로 줄바꿈, `title` 유지). GG3 재캡처 `ui2g/ws-meetings-390x844-light.png` 에서 개천절·대체공휴일(두 줄)·한글날이 읽힌다(열어 봄).
- 개요 이슈 카드의 대비(위 axe 행) — 이슈 없는 영역 카드의 흐림(`opacity-60`)과 `text-ink-subtle` 겹침. 화면 소유 SP 몫.
- ~~회의록 본문 `# 제목` 의 h1(위 h1 행)~~ — 해결(`8aada02`).
- 개요 이슈 카드 대비 24 는 UI-3 입력(`plan-ui3.md` Step 1b — GG6).

### UI 위험 목록(CLAUDE.md)

`.githooks/pre-push` 의 `UI_RE` 는 과제 31 에서 범위 레이아웃 셋을 더했다. `CLAUDE.md` '브랜치' 절의 UI 위험 파일 목록에 같은 셋 — `src/app/(app)/w/[slug]/layout.tsx`·`src/app/(app)/p/[projectId]/layout.tsx`·`src/app/(app)/(global)/layout.tsx` — 을 **컨트롤러가 `87102b7` 로 더했다(해결)**. 스펙 §9 의 "같은 커밋"과는 다르다(`UI_RE` 는 `3d58967`) — 내용은 일치, 의도된 편차로 기록(완료 리뷰 F-9).

### GG 뒤 재생성(UI-2b 최종 리뷰 수정 GG3 — 2026-10-02 15:46~16:29)

- 머리: 레인 B `bffd64e`(GG1 `087fd53`·GG2 `ed94da2`·GG7 `eb45e2b`·GG4 `a227187`·GG5 `bffd64e` — EE 의 `8aada02`·`9ce4f5c` 포함). 사용자 확인 서버 3201 을 건드리지 않으려 **스크래치 워크트리 `lane-b-gg`(src 가 머리와 같음)** 를 3203 에서 빌드(`e9Mp7lg1TEsyp9zGqU73L`)해 찍었다. 기준 = `lane-b-base`(`8a84269`, 3202, `T1Ky7IAqYrNJRQwZejnI5`). 시드 2026-10-02(EE 의 `db:reset` 뒤 캡처 시드 — 첫 판과 시드 프로젝트 id 가 달라 기준도 다시 찍었다). 라벨 `ui2g*`, 대조표 `ui2b-sheet.html`(= `ui2g-sheet.html`, 섹션 11 · axe 174행 · tab).
- 스모크(3203) 통과(위 §4 행). E2E E1·E2·E4~E11 **10/10 ✓**(16:28~16:29, `sp3b-e2e.md`).
- (b) 짝 36: same 0·near 0·**diff 36**·problem 0 — 첫 판과 같다(셸 교체가 원인). 옛 키 264: same 17·diff 100·new 96·problem 51 = click-failed 11(첫 판과 같은 기준 서버 클릭 대상 없음·크기 한계) + **도구 산물 40**: 머리를 `--base http://127.0.0.1:3203` 로 찍으면 캡처 도구가 그 서버를 '기준 서버'로 보고 옛 경로 행의 기대 최종 경로를 옛 페이지(`baseFinal`)로 잡는다 — 실제 최종 경로는 모두 `/w/default/…`(첫 판의 기대와 같음)라 화면 문제가 아니다.
- (a) 셸 행렬 176장·accent 셋 24장·스크롤 28장·설정 바닥 6장·JS 끔/켬 18장·전체 화면 AI 20장·설정 손상 8장: problems 은 그 크기에 UI 가 없는 click-failed 뿐(첫 판과 같은 행).
- 가시 h1: **132장 모두 1**(`ui2g-h1`).
- 키보드: ws-home·p-dashboard·p-wbs × 라이트·다크 실패 0·미도달 0.
- axe: 기준 라이트 42쪽 44건, 머리 라이트 189·다크 122 — **첫 판과 키마다 같다**(같은 키 변화는 p-dashboard·inbox-popover 0→24 = 개요 이슈 카드 기존 결함, UI-3 입력). 셸 요소 위반 노드 0.
- 열어 본 장: `ui2g/ws-meetings-390x844-light`(공휴일 라벨 줄바꿈), `ui2g/ws-minute-390x844-light`(본문 제목 '설계 검토 회의' 가 h2 크기 그대로·페이지 h1 하나), `ui2g-shell/ws-home-1440x900-dark`(셸·홈 v0), `ui2g-broken/ws-settings-broken-1440x900-light`(설정 손상 알림·'설정 열기'·저장 바). GG1 의 비공개 숨김은 `qa/sp3b/gg1/`(6장 — 명단 밖 404·명단·워크스페이스 관리자·플랫폼 관리자 정상).
- 계정 처리: 캡처·E2E 는 시드 계정 비밀번호를 실행마다 재설정한다 — 사용자 확인 계정(ui-* 넷)의 비밀번호 해시·개인 설정·공지/알림 읽음을 묶음 전에 백업하고 끝에 되돌렸다(대조 일치). E2E 픽스처(bea·B 공용 팀·두 프로젝트·회의록 둘)는 지워 캡처 시드 상태로 돌렸다.

## UI-2b 사용자 확인(D29)

| 항목 | 값 |
|---|---|
| 일시 | 2026-10-02 15:27 무렵 KST — 레인 B 원장 `progress.md` 기록 시각(사용자 응답 "어 괜찮아 계속 진행해"는 그 직전). 앞 판의 '14시대'는 원장과 어긋나 고쳤다(같은 날 14시대의 사용자 판단은 R25 — 최종 수정 지시서가 적은 것, HH4) |
| 확인 대상 | 3201 `next start`(머리 `8150307` — EE 반영 빌드), 대조표 `ui2b-sheet.html`(12:37 판 — 지금은 `ui2b-sheet-1237.html`, GG3 에서 재생성) |
| 표본 | 과제 38 Step 9 의 여섯 — ① 워크스페이스 홈 → 회의록 → 회의록 하나(브레드크럼·사이드바 활성) ② 프로젝트 전환기(이슈 꺼진 프로젝트 → 개요 + 토스트) ③ duo 워크스페이스 전환·옛 `/minutes` ④ 1280×720 AI 레일 오버레이·Esc, 1440 병치 ⑤ 390 햄버거 → 드로어 → Esc → 초점 ⑥ 다크 작업 계획(스크롤 하나·전체 화면 + AI)·주간보고(스크롤 뒤 도구 줄) |
| 계정 | 시드 `ui-member`·`ui-wsadmin`·`ui-duo`·`ui-platform`(비밀번호는 대화에만) |
| 사용자 판정 | 지적 없음. 같은 자리에서 GG1(명단 밖 비공개 프로젝트 화면 404) 동작 변경에 동의. **'명단 밖'의 실제 경계는 명단 권한(access_role)이다** — 명단 행이 있어도 access_role 이 null 인 사람도 404 다(정본 canSeeProject — 회의록·위키·AI·포털 목록과 같은 축, `tests/authz/project-layout-hiding.test.tsx` 가 고정, HH5). 동의 문구는 이 집단을 적지 않았으므로 컨트롤러가 사용자에게 알린다 |
| 처리 | 수정 없음. 커밋 시각(git)과 확인(15:27 무렵)의 순서 — **확인 전**: GG2(`ed94da2` 15:21 불변식 — 테스트뿐, 화면 영향 없음). **확인 뒤**: GG1(`087fd53` 15:37 — 비공개 숨김 판정자 하나, 프로젝트 화면 404)·GG7(`eb45e2b` 15:37 주석)·GG4·GG5(`a227187`·`bffd64e` 15:38 성능 문서)와 이 문서 갱신(`8f5f332`). 화면 변화는 GG1 의 명단 밖 비공개 404 하나이고 확인 뒤 커밋이다(사용자가 동의한 변경) |

## 8. 과제 39 — rebase 뒤 재생성(main `7768830` 위, 창 직전 — D46·D48)

- `ui/sp3-menu` 를 main `7768830`(SP4 A1·A2 — 0013~0017) 위로 rebase(18:50~19:05, 충돌 15파일 — 해소 기록은 리포 밖 과제 39 보고).
  `account_preferences` 는 `0018` 로 옮기고 재리허설(`Staging-verified` 빈 커밋 19:04).
- 기준 = rebase 뒤 merge-base `7768830`(main 그대로 — 스크래치 `lane-b-base` 를 다시 detach, 3202, 빌드 `0uWOUOlD1k-5hNOXOMd3X`),
  머리 = `bed4f396`(3201, 빌드 `ptEThFX2MLV1RSL6OyB9k` — 머리를 `--base` 없이 찍어 GG3 의 도구 산물 40 이 없다). 시드 2026-10-02(캡처 시드, 같은 날).
  라벨 `ui2rb*`(UI-2b 묶음 — 전 라우트·셸 행렬 등)·`ui2ra-extra`·`ui2ra-chip`(UI-2a 고유 장), 대조표 `qa/sp3b/ui2rb-sheet.html`, 비교표 `diff-ui2rb-base--ui2rb{,-pair}.md`.
- **D48 대로 UI-2a 행도 rebase 된 머리(UI-2a + UI-2b)에서 다시 찍었다** — 그래서 UI-2a 의 짝 비교 차이에는 UI-2b 의 셸 교체가 함께 들어 있다(UI-2a 지점만의 빌드는 찍지 않았다).
- 공통 묶음: vitest 832 files · 10,792 tests(실패 1 = 알려진 `baseline-cli` firmlink), lint 0 errors(경고 4 기존), typecheck 0, build 통과.
  `breakpoint-safety-net`(merge-base·`b4283c0` 대비)·`platform-guards`·`guard-signatures` 무수정 초록.
- DB 묶음: `db:reset` → `dev:bootstrap` → `test:rls` 32 files · 391 tests(건너뜀 0) → `settings:verify` 초록 → 캡처 시드. 스모크(3201) 통과.
- E2E: 합친 `e2e-local` 의 `sp3b-` 열 단계 ✓(19:26 — `sp3b-e2e.md` '과제 39' 절). 같은 실행의 앞 38 단계와 합성 게이트 15 단계도 ✓.

### UI-2a 행(스펙 §8.5)

| 항목 | 결과 | 산출 |
|---|---|---|
| 짝 비교(`--pair`) | **통과** — 36: diff 36 · problem 0(같은 판정 수가 rebase 전 GG3 와 같다). 장별 차이율도 GG3 와 ±3.6%p 안(가장 큰 변화: `ws-admin-accounts` 390 10.78→14.38% — 기준 화면이 계정 12행(테스트 픽스처 포함)·머리 5행인 D22 한정 차이, 열어 봄) | `diff-ui2rb-base--ui2rb-pair.md` |
| 옛 경로 이동 | **통과** — 옛 키 264: same 17 · diff 140 · new 96 · problem 11(전부 click-failed — 기준 서버에 `/w/<s>/projects` 가 없는 mobile-menu·account-popover, 크기 한계 p-wbs-fullscreen — t38 판과 같다). 옛 키 최종 URL 모두 `/w/default/…`(경로 문제 0) | `diff-ui2rb-base--ui2rb.md`·`ui2rb/meta.json` |
| 홈 v0·내 업무 v0·리졸버 | **통과** — `ws-home`·`ws-my-work`·`root` 장(root 최종 `/w/default`), 셸 행렬의 ws-home 다크 1440(duo — 처리할 일·진행 중 프로젝트·공지 세 섹션, 열어 봄) | `ui2rb/`·`ui2rb-shell/` |
| 회의록 칩·개요 | **통과** — `/w/default/minutes?project=<시드>` 에 '프로젝트: UI-CAPTURE ×' 칩(열어 봄), 프로젝트 회의 화면 머리의 '이 프로젝트 회의록'(1440 열어 봄). 개요 카드 링크는 §6 판정 그대로(`dashboard-cross-module.test.tsx`) | `ui2ra-chip/`·`ui2ra-extra/` |
| 가시 h1 | 132장 모두 1(아래 UI-2b 행) | `ui2rb-h1/meta.json` |
| E2E | E1·E2·E4·E6·E8·E9·E11 ✓ | `sp3b-e2e.md` |
| 스모크 | 통과 | `qa/sp3b/t39/smoke.txt` |

### UI-2b 행(스펙 §8.5)

| 항목 | 결과 | 산출 |
|---|---|---|
| (a) 셸 행렬 | **통과** — 176장, problems 16 = GG3 판과 **같은 목록**(그 크기에 UI 가 없는 click-failed). accent 셋 24장 problems 0(기본·`#ffd43b`·`#1c1c6b` — 끝에 기본으로 복원), 설정 바닥 6장 0. 열어 봄: ws-switcher-open 1440 다크(두 워크스페이스·체크), drawer-project 390 다크(프로젝트 내비·닫기) | `ui2rb-shell/`·`ui2rb-accent-*/`·`ui2rb-settings-bottom/` |
| 가시 h1 = 1 | **통과** — 66행 × 1280×720·390 = 132장 모두 1 | `ui2rb-h1/meta.json` |
| (b) 전 라우트 회귀 | **통과** — 위 UI-2a 행의 짝·옛 키 비교와 같다(셸 교체가 원인). SP4 가 바꾼 화면(주간·설정·가져오기·WBS·개요·이슈·명단)의 기준↔머리 차이율이 rebase 전과 ±0.3%p 안 — SP4 변경과 셸 교체가 서로 화면을 바꾸지 않았다. 열어 봄: p-weekly 1440, p-wbs 1280, p-import-admin 1440(새 셸 안) | `diff-ui2rb-base--ui2rb.md` |
| (c) 스크롤 상태 | **통과** — 28장 problems 0(p-weekly 1280 열어 봄) | `ui2rb-scrolled/` |
| JS 끈 첫 페인트 | **통과** — p-dashboard 1280 JS 끔: 사이드바 232px·전역 바 48px 그대로, 본문 스켈레톤(열어 봄), 9·9장 problems 0 | `ui2rb-nojs`·`ui2rb-nojs-ref` |
| 전체 화면 AI | **통과** — p-wbs-fullscreen-ai 1440 다크: 레일이 전체 화면 안 오른쪽(열어 봄), problems 10 = GG3 와 같은 크기 한계 | `ui2rb-fs-ai/` |
| 키보드 | **통과** — ws-home·p-dashboard·p-wbs × 라이트·다크 실패 0·미도달 0 | `ui2rb/tab.json` |
| axe | **조건부 통과(GG3 와 동일)** — 기준 라이트 42쪽 44건, 머리 132쪽 311건(라이트 189·다크 122) — **쪽마다 GG3 판과 같은 수**(달라진 쪽 0). 같은 키 변화는 개요 이슈 카드 기존 결함(UI-3 입력)뿐 | `ui2rb/axe.json`·`ui2rb-base-axe/axe.json` |
| 설정 손상 | **통과** — `navigation.menu:"oops"` 8장 problems 0: 머리 알림 '설정을 불러오지 못해 메뉴 일부를 숨겼습니다.'·'설정 열기', 설정 화면 열림(1440 열어 봄). 묶음 안에서 원래 values 로 복원·대조 | `ui2rb-broken/` |
| E2E·스모크·성능 | E2E 10 단계 ✓·스모크 통과. 성능은 재측정 생략(사용자 지시 — 전체 완료 뒤 일괄, `sp3b-perf.md`) | 기록 문서 |

### D48 — 다른 레인의 화면 파일이 섞였다

rebase 로 main 의 SP4 A1·A2 화면 파일 **18개**(`p/[projectId]/{import,settings,weekly}/page.tsx`, `components/import/*` 3, `components/settings/*` 3,
`components/wbs/{RowDetailPanel,WbsGanttSheet,WbsProgressLens,shared}`, `components/weekly/*` 5)가 머리에 들어왔다 — UI-2 가 함께 고친 파일은
`WbsGanttSheet.tsx`·`WeeklySheetView.tsx` 둘(자동 병합 — sticky·전체 화면 AI 줄이 그대로, `sticky-offset` 초록). §7 의 사용자 확인(D29, 15:27)은 이 파일들이 없던
머리(`8150307`)였고 표본 ⑥(다크 작업 계획·주간보고)이 바로 이 화면이다. 에이전트 재캡처는 셸 교체의 차이가 rebase 전과 같음을 보였지만, 사용자 확인은 계획(과제 39 Step 5)대로
컨트롤러가 다시 받는다.


### D48 사용자 재확인(과제 39 — 컨트롤러)

| 항목 | 값 |
|---|---|
| 일시 | 2026-10-02 20:28 KST |
| 확인 대상 | 3201 `next start`(머리 `57b01dd7` — 빌드 `ptEThFX2MLV1RSL6OyB9k`, 그 뒤 src 변경 없음), 레인 B 스택은 `db:reset` → `dev:bootstrap` → 캡처 시드로 새로 만든 상태(2026-10-02) |
| 표본 | 다크 작업 계획(WBS — 스크롤 하나·전체 화면 + AI)·주간보고(스크롤 뒤 도구 줄)(표본 ⑥ — SP4 A1·A2 화면이 섞인 곳), 가능하면 프로젝트 가져오기 화면, 나머지 표본은 rebase 전과 같은 장으로 에이전트가 비교(§8) |
| 계정 | 시드 `ui-member`·`ui-wsadmin`·`ui-duo`·`ui-platform`(비밀번호는 대화에만) |
| 사용자 판정 | "이상없음 계속 진행해" — 지적 없음 |
| 처리 | 수정 없음. 이 확인으로 UI-2b 체크포인트(빈 커밋)를 만든다. 성능(R25)은 사용자 지시로 전체 구현 완료 뒤 일괄 측정 |


## UI-3 과제 11 — 프로젝트 목록 v1 · 2026-10-04

- 브랜치 `ui/sp3-screens`, 최종 빌드 `wnP4CjrgX-408Rve__VDB`. 행·카드 × 1440/1280×720/768/390 × light/dark = 16장, `u3-t11-complete/meta.json` 문제 0. contact sheet 두 장과 모바일·관리자·즐겨찾기 원본을 직접 확인했다.
- 보조 `u3-t11-interactions` 4장: 행↔카드 저장 후 전환, 즐겨찾기 즉시 저장, 페이지 재조회 후 별 유지, 1440 사이드바 자동 반영, 390 문서 가로 넘침 0. `u3-t11-admin` 2장: 관리자만 생성 가능·`?new=1`·워크스페이스 대상 이름. 총 22장. 조작 뒤 전용 계정의 선호를 복구했다.
- 즐겨찾기 저장은 최신 성공 목록 기반으로 직렬화한다. 선행 조회 실패 시 쓰기를 막으며, 상한 20개의 신규 추가는 사유를 표시하고 거부한다. 보기 전환은 계정 저장 큐를 비운 뒤 갱신한다. 반복 브라우저 검사의 RSC 부분 갱신 누락 때문에 홈 숨김과 같은 전체 페이지 재조회 경로를 사용한다(페이지 갱신 비용 있음).
- 테스트: 관련 200 files·1,559 통과, 최종 조작/선호 검사 11 files·75 통과. typecheck 통과, lint 0 errors·기존 경고 4. 구 `projects-home`의 카드 화면 테스트는 새 `projects-page`의 조회 실패·권한·시간대·생성·검색·쪽 나눔 검사로 대체했다.

| 파일(작업 트리 밖 `.superpowers/qa/sp3b/`) | SHA-256 앞 12자리 |
|---|---|
| `u3-t11-complete/ws-projects-390x844-light.png` | `9e9de92e6ab8` |
| `u3-t11-complete/ws-projects-cards-1440x900-dark.png` | `cf643386116f` |
| `u3-t11-interactions/1440x900-dark.png` | `ad365a955666` |
| `u3-t11-admin/1440x900-light.png` | `1cc78b62a082` |

## UI-3 과제 12 — 명단 실효 역할 · 2026-10-04

- 브랜치 `ui/sp3-screens`, 빌드 `ZUf9f0Uf4f0svSP499BQJ`. 기본 명단과 관리자 상속 상태 각각 1440/390 × light/dark, 총 8장. 기본 캡처 문제 0, 스모크 통과. 데스크톱 상속 장과 모바일 기본·다크 상속 원본을 직접 확인했다.
- 전용 시드의 워크스페이스 관리자 명단 권한을 잠시 member로 바꾸어 명단 권한은 멤버, 실효 역할은 관리자·상속 배지로 표시되는 것을 검사했다. 매 조작은 finally에서 원래 권한으로 복구한다. 모바일 표 가로 스크롤 뒤 문서 가로 넘침도 0이다. 숨김 작업 제목의 위치 기준을 열 안으로 제한해 스크롤 후 페이지가 늘어나는 결함을 고쳤다.
- 권한 판정과 표시는 같은 순수 승계 함수를 사용한다. 역할 표는 세션 RLS·workspace_id 필터·끝까지 쪽 읽기를 적용하며, 조회 실패는 확인 불가로 표시한다. 숨김 프로젝트 판정·공용 팀 원천·기존 명단 편집은 보존했다.
- 관련 검사 221 files·1,799 통과. 최종 표 수정 뒤 4 files·34 통과. typecheck 통과, lint 0 errors·기존 경고 4.

| 파일(작업 트리 밖 `.superpowers/qa/sp3b/`) | SHA-256 앞 12자리 |
|---|---|
| `u3-t12-fixed/p-members-390x844-light.png` | `f2c8d6494cad` |
| `u3-t12-inherited-role/1440x900-light.png` | `a46aaa70fcab` |
| `u3-t12-inherited-role/390x844-dark.png` | `1a906da48dd6` |

### 과제 11 CI 후속 수정

Actions `37133788930`에서 미정의 `bg-action-weak`와 슬러그 시간대 정적 계약 불일치 두 건을 확인했다. 선언된 `bg-action-soft`로 고치고 `viewTimezone(scope.ws.id)` 계약을 보존했다(동일 워크스페이스 값). 관련 CSS·달력·프로젝트 화면 24 files·461 통과, typecheck·lint 통과(기존 경고 4), 빌드 `oW41puDylLCtTK9N1hpUQ` 스모크 통과. `u3-t11-ci-fix` 1440/390 × light/dark 4장 문제 0, 모바일 라이트 원본의 선택 강조를 확인했다.

## UI-3 과제 13 — 계정 선호·초대 식별 · 2026-10-04

- 브랜치 `ui/sp3-screens`, 빌드 `fDnun8lklwg4dsz5LNqMp`. 계정·멤버 초대 관리·공개 초대·루트 × 1440/390 × light/dark = 16장, `u3-t13/meta.json` 문제 0·스모크 통과. contact sheet 두 장과 데스크톱 계정·관리자, 모바일 다크 초대 원본을 직접 확인했다.
- 보조 `u3-t13-account-prefs` 4장: 다중 소속 계정으로 시작 화면을 현재 워크스페이스에, 행/카드 보기를 계정에 저장한다. 요청 범위·재조회 후 선택 유지·루트 리졸버 이동·다른 워크스페이스 선호 불변·390 가로 넘침 0을 검증했다. 각 조작 뒤 두 범위의 원래 선호를 finally에서 복구했다. 모바일 하단의 두 신규 구역도 별도로 열어 봤다.
- 워크스페이스 소속/선호 조회 실패는 시작 화면 선택을 열지 않는다. 활성 초대만 워크스페이스 이름과 받을 권한을 반환하며 취소·만료·사용된 링크에는 두 필드가 없다. 이메일 마스킹과 기존 합류 흐름·플랫폼 조작 권한은 보존했다. 소속 없음 화면과 초대 페이지의 브랜드/공개 경로 가드는 확인 후 무변경이다.
- 관련 검사 204 files·1,872 통과, 추가 선호/초대 70·관리자 11 통과. 최종 전체 회귀 896 files·11,713 중 11,712 통과, 기존 macOS baseline-cli firmlink 경로 검사 1건 실패(`/System/Volumes/Data`의 `.superpowers` 경로 별칭). 검사 제외/완화 없이 기록했다. typecheck 통과, lint 0 errors·기존 경고 4.
- U3-5(과제 11~13) 자체 검토: 명단 역할의 세션 RLS·워크스페이스 필터·숨김 선행 판정, 비활성 초대의 새 필드 차단, 즐겨찾기/시작 화면의 명시적 workspaceId와 직렬 저장을 확인했다. 추가 차단 문제는 발견하지 않았다. 독립 리뷰 결과는 아니다.

| 파일(작업 트리 밖 `.superpowers/qa/sp3b/`) | SHA-256 앞 12자리 |
|---|---|
| `u3-t13/account-1440x900-light.png` | `e4cc03842db0` |
| `u3-t13/invite-390x844-dark.png` | `47734b46e49a` |
| `u3-t13-account-prefs/390x844-dark.png` | `ab20ec4f00eb` |
