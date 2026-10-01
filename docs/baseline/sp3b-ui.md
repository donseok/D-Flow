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

- 착수점 `8a84269`(옛 경로가 아직 페이지 — 기준 서버 3202 로 별도 워크트리에서 빌드), 머리 `4e3d43c`(캡처는 `03f07b2` 서버, 이후 변경은 E2E 스크립트 한 파일). 시드 2026-10-02, 라이트, 네 크기(1440×900·1280×720·768×1024·390×844). 증거 폴더 `qa/sp3b/ui2a-base`·`ui2a`·`ui2a-extra`·`ui2a-chip`·`ui2a-h1`, 비교표 `diff-ui2a-base--ui2a-pair.md`·`diff-ui2a-base--ui2a.md`.
- 스모크: `smoke:prod`(3201) 통과(`smoke-ui2a.txt`). 서버 두 개(3201·3202)는 묶음 뒤 모두 내려갔다.
- 스파이크 요약(`spike-ui2.md`): S-1 ② 스텁 307·no-store 통과(원점 주의 → 상대 `Location`, 판정 W2), S-1 ① 간트 200(로딩 경계 안 meta refresh) → 간트를 `(legacy)` 로 옮겨 307(판정 W1), S-5 `.app-main` 스크롤 통과, S-8 ①② 소프트 이동이 스텁을 지나도 전체 새로고침·오류 경계 없음(통과).

### 판정표(스펙 §8.5 UI-2a 행)

| 항목 | 통과 조건 | 결과 | 산출 |
|---|---|---|---|
| 짝 비교(`--pair`) | 옮긴 여덟 화면의 새 경로 장이 기준 옛 경로 장과 같거나 이 Phase 가 의도한 차이뿐 | **통과** — compared 32 · same 6 · near 6 · diff 20 · problem 0 · missing 0. diff 의 원인은 아래 4종뿐(장마다 확인) | `diff-ui2a-base--ui2a-pair.md` |
| 옛 경로 이동 | 옛 키 장의 최종 URL 이 `/w/<wsSlug>/…`, problem 0 | **통과** — root→`/w/default`, meetings·minutes·minute·agents·portfolio·usage·admin-accounts·admin-teams 모두 `/w/default/…`, 머리 80장 problems 0·idle 거짓 0. 기준 서버는 옛 경로가 최종(`baseFinal`) | `ui2a/meta.json` |
| 홈 v0·내 업무 v0·리졸버 | 섹션 셋·종류 칩·빈 상태, `/` → `/w/<slug>` | **통과** — 홈 세 섹션(처리할 일·진행 중 프로젝트·공지), 내 업무 종류 칩·행, root 최종 `/w/default` | `ui2a/ws-home-*`·`ws-my-work-*`·`root-*` |
| 회의록 칩·개요 | '프로젝트: …' 칩과 ×, 개요 회의 카드, '이 프로젝트 회의록' 링크 | **통과** — 칩 `프로젝트: UI-CAPTURE ×`, 프로젝트 회의 화면 머리의 '이 프로젝트 회의록' | `ui2a-chip/`·`ui2a-extra/` |
| 가시 h1 수 | 기록(판정은 UI-2b ④) | 기록 — 아래 | `ui2a-h1/meta.json` |
| E2E | 일곱 단계 ✓ | **통과**(`sp3b-e2e.md`) | `e2e-ui2a.txt` |
| 스모크 | exit 0 | **통과** | `smoke-ui2a.txt` |

짝 비교 diff 의 원인(의도한 차이):
1. **워크스페이스 한정(D21·D22)** — 포트폴리오 행 5→1(시드 프로젝트 하나, 다른 워크스페이스·rls 프로젝트 제외), 계정 12→5(그 워크스페이스 소속·명단), 좌석표 층 수 변화(ws-agents 0.4~0.6%).
2. **사용 현황 범위 칩**(D21) — '플랫폼 전체(워크스페이스 구분은 SP8)'.
3. **옛 셸의 경로 의존 표시가 사라짐** — 사이드바 활성 항목·프로젝트 메뉴·브레드크럼이 `/minutes`·`/p/…` 경로로 파생되어 새 경로(`/w/<slug>/…`)에서는 비어 보인다. 판정 W13 이 허용한 공백이며 UI-2b 의 셸 교체(과제 31)가 메운다 — **UI-2a 단독으로 main 에 넣지 않는 이유**.
4. 회의록·회의 화면 좌측 약 600×640 영역(1.1~1.6%) — 위 3 의 사이드바 프로젝트 메뉴 부재(기준 장에는 이전 프로젝트의 메뉴가 있다). 768·390 의 near(0.13~0.15%)는 머리 영역(브레드크럼 칩)뿐.

### 가시 h1 수(기록 — 1280×720·390, 44 라우트)

대부분의 옛 셸 화면이 가시 h1 이 **0** 이다(`PageHero` 는 접힌 머리만 그린다 — 공유 `share`·`ws-minute` 는 2). 홈·내 업무는 세 크기 모두 1. UI-2b 과제 32 가 모든 뷰포트 h1 을 판정한다.

### 알려진 도구 상태

- `ui2a-h1` 의 `withProblems`: `mobile-menu@1280x720`·`p-wbs-fullscreen@1280x720·390`(클릭 대상이 그 크기에 없음 — UI-1 부터 같은 행의 알려진 한계, 화면 문제 아님).
