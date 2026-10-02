# SP4 — WBS·주간보고 설정값 승격 + 팀 캐시 폐기(+ 진척 null 가중치 정정·가져오기 멱등) 설계 스펙

| 항목 | 값 |
|---|---|
| 날짜 | 2026-10-01 |
| 상태 | **확정 — 비평 다섯(`critique-security.md`·`critique-db-probe.md`·`critique-scope.md`·`critique-fidelity.md`·`critique-feasibility.md`)·판정 Q1~Q40 반영, 2026-10-01. 범위 재검토 A·B 반영(T1~T16), 2026-10-01** — 재검토 `.superpowers/sp4/rereview-{a,b}.md`. 구속 판정은 셋이다 — 초안 전 R1~R26(`.superpowers/sp4/rulings-pre-draft.md`), 비평 뒤 Q1~Q40(`.superpowers/sp4/rulings-post-critique.md`), 범위 재검토 뒤 T1~T16(`.superpowers/sp4/rulings-final-touch.md`). 판정과 다르게 쓴 곳은 그 자리에 "판정과 다름 — 이유", 비평으로 바뀐 결정 행은 "비평 반영 — Qn", 재검토 판정이 바꾼 행은 "재검토 반영 — Tn", 판정 표 밖의 재검토 P3 를 반영한 곳은 "재검토 반영 — A F-n·B P3-n" 으로 적었다. 반영 기록은 `.superpowers/sp4/revision-report.md`(끝 절 "마무리 반영(재검토 A·B)"). 사전 승인 규칙(memory `dflow-spec-preapproval`, SP3a §1.1 P-1)으로 §8 사용자 확인 항목은 권고 기본값으로 진행하고, 각 항목은 적힌 기한 전까지 바꿀 수 있다. 컨트롤러가 `docs/superpowers/specs/` 로 옮긴다 |
| 상위 정본 | 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` 의 §6.2 SP4 블록·§1.4.3·§4.3·§4.6·§4.8·§2.11 SP4 행·§6.3·§6.5.4·§6.5.6~§6.5.8. 정본 `docs/superpowers/specs/2026-09-23-generic-platform-design.md` 의 §3.4.2·§3.4.2a 의 SP4 행과 `정본@31878b1:2922-2950`(옛 SP4 블록 — 개정이 "유지"로 가져온 범위). SP3a 스펙 §9 #7·§10. SP3b 스펙(레인 B `sp3b/ui0`, **main 밖** — `/Users/jerry/D-Flow-wt/lane-b/docs/superpowers/specs/2026-09-29-sp3b-shell-ia-design.md`)의 결정 D9·D15·D19·D46·D47·D48·D51·D53·D54(이 문서에서는 "SP3b Dn" 으로 적어 이 문서의 D 와 가른다)·§2.4 알림 3·4·6·7·9·10·11·12·§5.4.1(레이아웃 분담)·§11. 이 문서는 그 결정을 옮겨 적고 이 리포에서 실제로 할 일(파일·순서·경계 동작·테스트)을 더한다 |
| 선행 | `sp3a-done` = main `81deae9`(마이그레이션 `0000`~`0012`, SP3a 실측 노력 `docs/baseline/sp3a-effort.md`). 레인 B UI-0 은 A1 보다 먼저 main 에 든다(D53). 체크포인트 B 는 SP3b UI-1·UI-2(2a·2b)의 main 머지가 선행이다(§2.1) |
| 마이그레이션 | 셋 — 개발 중 파일명 `0013_weekly_areas`·`0014_command_receipts`·`0015_authz_carry`(+ 롤백 쌍). 상속 공용 팀 전환 RPC(D54)는 `_command_receipts` 에 든다. 번호는 main 머지 직전에 확정한다(D12) — SP3b UI-2a 의 `0013_account_preferences` 가 먼저 머지되면 한 칸씩 민다. 테스트·리허설·문서·사전/사후검사 토큰·마이그레이션 머리 주석의 파일 경로는 번호가 아니라 접미(`_weekly_areas` 등)로 찾는다. 이 문서도 번호 대신 `NNNN_<이름>` 으로 적는다 |
| 실측 근거 | 2026-10-01 읽기 전용 조사 넷 — `.superpowers/sp4/survey-{canon,weekly-code,wbs-excel-teams,db-gates}.md`(이하 실측 C·W·T·G). 비평 다섯 — 보안·DB 실험·범위·충실도·실행(이하 비평 보안·실험·범위·충실도·실행). 비평 실험은 일회용 컨테이너(PostgreSQL 17)에서 영역 FK 를 재현했다(`critique-db-probe.md` §3). 코드 줄은 main `81deae9` 기준이고, 개정의 줄 인용은 H1 뒤 여러 곳이 밀렸으므로 이 문서는 심볼 이름을 먼저 적고 줄은 참고로만 단다 |

읽는 순서: 사용자는 §8 을 먼저 읽는다. 표기 — "R n" 은 초안 전 판정, "Q n" 은 비평 뒤 판정, "T n" 은 범위 재검토 뒤 판정(`.superpowers/sp4/rulings-final-touch.md` — 바꾼 행에 "재검토 반영 — Tn", 판정 표 밖의 재검토 P3 를 반영한 곳은 "재검토 반영 — A F-n"·"B P3-n"), "D n" 은 이 문서의 결정(D1~D26 은 같은 번호의 R 을 옮긴 것, D27~D48 은 초안이 더한 것, D49 부터는 비평 반영으로 더한 것), "E n" 은 상위 문서·판정 대비 정정, "W n" 은 실측 C §2 의 완료 조건 번호, "C-n" 은 실측 C §7 의 충돌 번호, "K n" 은 §10 의 리스크, "개정 §N"·"정본 §N"·"SP3a §N"·"SP3b §N" 은 상위 문서의 절이다. "CAN:줄" 은 정본의 줄, "KLC:줄" 은 `docs/baseline/sp3a-c-known-limits.md` 의 줄이다. "A1·A2·B" 는 §2 의 체크포인트다(초안의 B1·B2 를 하나로 — Q1). "정본 결정 n" 은 정본 §1.3 의 결정, "사용자 결정 n(U-n)" 은 2026-09-26 사용자 결정이다. §8 의 "(U1)·(N2)" 꼴 — 하이픈 없는 Un·Nn — 은 실측 C 의 사용자 확인 후보 번호라 U-n(사용자 결정)과 다르다(재검토 반영 — B P3-4).

## 목차

1. 전제와 결정 — 1.1 구속하는 결정 · 1.2 이 SP 의 결정(D) · 1.3 상위 문서 대비 정정(E) · 1.4 범위 표
2. Phase 구성 — 2.1 Phase 표 · 2.1.1 main 반영과 레인 B 창 · 2.2 노력 추정과 근거 · 2.3 소유 파일 · 2.4 SP3b 와 겹치는 파일·UI 위험 파일·트레일러 · 2.5 커밋·브랜치·전용 스택
3. DB 계약(Phase A1) — 3.1 공통 규칙 · 3.2 `NNNN_weekly_areas` · 3.3 `NNNN_command_receipts`(+ 상속 공용 팀 전환) · 3.4 `NNNN_authz_carry` · 3.5 격리 맵·픽스처·RLS 테스트 · 3.6 리허설
4. 도메인·서버 — 4.1 주간 · 4.2 팀 원천·이름 매칭·개명·예약어 · 4.3 Excel 표준 레이아웃·경로 하나 · 4.4 가져오기 멱등 · 4.5 진척 null 가중치 · 4.6 무범위 조회 · 4.7 DB 오류 원문 · 4.8 상수 제거·회귀 가드·픽스처
5. 화면 — 5.1 Phase A 의 최소 수정 · 5.2 Phase B 의 이행
6. 테스트·검증 — 6.1 단위·정적 · 6.2 실행형 · 6.3 로컬 E2E · 6.4 합성 게이트 · 6.5 성능 · 6.6 눈확인
7. 완료 조건(done_when)
8. 사용자 확인 항목
9. 범위 제외·이월
10. 리스크

## 1. 전제와 결정

### 1.1 구속하는 결정

| # | 결정(출처) | SP4 에서의 귀결 |
|---|---|---|
| 정본 결정 1 | 포크 — 원본 데이터를 옮기지 않는다. 라벨 → 영역 이관은 로컬 개발 데이터만 해당(개정 §4.3.4) | 원격 DB 가 없다. 이관 리허설은 데이터가 있는 전용 스택에서만 한다(D9·§3.6). 사용자 DB(메인 스택)의 업그레이드는 번호 확정·main 반영 뒤 사용자 확인을 받고 한다(§8 #10) |
| 사용자 결정 3(U-3) | 집계·위험·완료 정책은 지금과 같게(개정 U-3) | null 가중치 통일은 개정이 명시한 정합 수정(개정 §1.4.3·C6)이고 위험 모델 `topWeightPhaseDelayed` 는 바꾸지 않는다(D20) |
| 사용자 결정 4(U-4) | 주 시작 일요일 | SP5 몫이다. SP4 는 주 계산 사본을 새로 만들지 않고 주 키는 기존 `mondayIso` 다(W30 — §7 에 리뷰 항목으로). 봇 도구의 월요일 강제도 그대로 둔다(D24) |
| 사용자 결정 6(U-6) | 디자인 결정 번복(중립·코발트, 다크 재노출) | 팀 색은 라이트 hex 가 아니라 다크 짝이 있는 `category-*` 토큰으로 그린다(D3) |
| 정본 결정 9 | 팀·영역·휴일은 FK 표라 설정 키가 아니다(정본 §1.3) | 주간 영역은 `project_areas(kind='weekly_section')` 행이고 레지스트리 키를 만들지 않는다. `settings_ref_check` 분기를 더하지 않는다(개정 §2.3.2 분기 표에 SP4 행 없음) |
| R4-7·R4-8·R4-9·R4-14 | 개정 §4.0 | 영역 탭은 소비처 SP 에서 연다(주간 구분 = SP4) · 읽기 경로는 쓰지 않는다 · 비활성 영역 대기 내용은 거부 + 명시 매핑 · Excel 표준 레이아웃 |
| SP3b D46·D47 | SP3b(승인, main 밖) | 레인 B 는 레인 A 체크포인트 직후 창에서만 main 에 넣고, 레인 A 는 창이 닫힌 뒤 main 에서 다음 브랜치를 자른다(사람 확인 대기 중의 쌓기는 D49 ②·③ — SP3b D46·알림 7 과 다르고 그 rebase 비용은 레인 A 가 진다. **재검토 반영 — T10**). `(app)/layout.tsx`·`p/[projectId]/layout.tsx`·`src/components/app/*`·`p/[projectId]/**/page.tsx` 의 화면 이행은 UI-2 머지 뒤 main 에서 자른다. **비평 반영 — Q38**: SP3b D47 첫 문장 "`sp3a-done` 뒤 main 에 가장 먼저 들어가는 것은 UI-2(창 ③)"는 `sp3a-done` 때 UI-2 가 준비된다는 전제 위의 문장이다. 그 전제가 깨졌으므로(레인 B 는 UI-0 마무리 중) SP4 A1·A2 는 UI-2 를 기다리지 않고 체크포인트를 (사람 확인 때) main 에 넣는다(재검토 반영 — B P3-5) — 근거는 같은 문서 `:150`("SP4 의 DB·도메인 과제는 영향 없음")·알림 9("UI-2 가 SP4 의 첫 마이그레이션보다 먼저 머지되면"). 그때 UI-2 가 SP4 위로 rebase 하고 번호를 민다(E32·D49) |
| C1·P-1 | 결정은 사용자만 개정한다 · 스펙 사전 승인 | 상위 문서가 정하지 않은 것은 §8 에 올리고 권고 기본값으로 간다. 되돌릴 수 없는 일(사용자 DB 업그레이드)은 그때 묻는다 |

### 1.2 이 SP 의 결정

D1~D26 은 판정 R1~R26 을 같은 번호로 옮긴 것이다. 판정 문언과 다르게 쓴 곳은 행 안에 **판정과 다름**으로, 비평 뒤 판정(Q)이 바꾼 곳은 **비평 반영 — Qn** 으로 표시했다. D49~D54 는 비평 반영으로 더한 결정이다.

| # | 결정 | 이유 | 대안(사용자·비평이 달리 정하면) |
|---|---|---|---|
| D1 | (R1) **두 Phase, 체크포인트 셋.** Phase A(UI-2 머지 전): 마이그레이션·RPC·도메인·데이터 로더·서버 액션/라우트·출력(PPT/Excel)·봇 서버 측·상수 제거·픽스처·주간 영역 편집기 장착(D26)·합성 S2·S4(월)·S10 부분. 화면 파일은 데이터 계약을 지키는 최소 수정만(§5.1). Phase B(UI-2 머지 뒤 main): `ui/sp4-teams`(팀 색·`TeamsProvider`·레이아웃 팀 주입·`teams/master.ts` 삭제)와 화면 이행(D52 의 범위 — #23·#25·개명·가중치·토스트). **비평 반영 — Q1**: 체크포인트는 **A1·A2·B 셋**이고 마감은 B 묶음 안에 둔다. B 는 `ui/sp4-teams`(UI 위험 파일·트레일러) 위에 화면 브랜치를 쌓아 한 번에 반영하고 눈확인은 한 번(라이트·다크)이다. B 는 UI-3 을 기다리지 않는다 — 먼저 머지한 쪽이 기준(개정 §6.1-5). **판정과 다름(구조만)** — Phase A 에 체크포인트를 둘 둔다(A1·A2). 범위와 순서는 R1 그대로다 | N4·C-13·C-38, SP3b D47. §2.2 추정에서 Phase A 가 고정 비용을 빼고도 3.4~4.65주라 개정 §6.1-1 의 상한(3주)을 넘는다 — "넘으면 Phase 로 나누고 main 체크포인트". A1 이 마이그레이션 셋·리허설(가장 위험한 묶음)을 따로 검증·반영하고, A1 의 main 반영이 곧바로 되면 A1 뒤 창에 레인 B 가 UI-1 을 넣고 A2 가 그 위에서 시작한다(A2 가 고치는 `WbsGanttSheet.tsx`·`RowDetailPanel.tsx` 는 UI-1 과제 8·11·12 가 먼저 고친다). 사람 확인이 늦으면 A2 는 A1 위에 먼저 쌓고 창이 닫힌 뒤 UI-1 위로 rebase 한다 — 고치는 줄이 달라 비용이 작다(§2.4, D49 ②·③ — **재검토 반영 — T10**). B 를 둘로 나눌 이유는 상한에 없다(B = 1.5~2.25주) — 나누면 체크포인트 고정 비용(0.2~0.3주)과 사람 push 확인이 한 벌씩 늘고, 둘째를 UI-3 뒤에 자르면 UI-3 의 사용자 눈확인 게이트가 SP4 경로에 들어온다(비평 범위 §2) | 체크포인트 넷(초안 — B1·B2. 고정 비용 한 벌 더, B2 가 UI-3 게이트를 기다릴 수 있다) / Phase 당 하나(A 는 상한 초과로 진행, 레인 B 창은 A 끝까지 닫힌다) |
| D2 | (R2) 레인 A 이월 셋 — CR-1 `authz_events` 기록을 `access_role`·`active` 전환까지, `people.email` 열 권한 회수, CR-6·FN-3 apply RPC 의 필수 키 unset 거부 — 을 SP4 Phase A1 의 **셋째 마이그레이션** `NNNN_authz_carry` 로 담는다 `[사용자 확인 §8 #1]`. **비평 반영 — Q15·Q30**: CR-1 은 `access_role` 이 있는 명단 행의 `active` 전환과 인물의 `people.active` 전환을 기록하고 표시 도메인(`describeAuthzChange`)을 같이 고친다. `people` 분기는 명령 id 를 비운다. `project_members_guard` 에 `person_id` 불변을 더한다. CR-6 은 `p_set` 의 JSON `null` 도 거부한다(§3.4) | 판정 P18("관문과 무관한 권한 변경을 다른 리허설에 섞지 않는다")·SP3b 알림 3, "첫 원격 배포 전 필수". 원격 DB 가 없어 번호 추가 비용이 0(개정 §6.3). 셋 다 이미 두 번 밀렸다(SP3a Phase B → SP3a 마감 → SP4 — 비평 범위 §1.2) | `NNNN_weekly_areas` 에 독립 절로 동승(번호 추가 없음, 롤백·리허설이 섞인다) |
| D3 | (R3) 팀 화면 색 = 테마 토큰 `category-N`. **N = `teams.color` 가 `TEAM_PALETTE` 의 몇 번째 값인지 + 1**(1~5 — 생성 순 배정 `pickTeamColor` 그대로라 워크스페이스 앞 다섯 팀이 서로 다른 색), 팔레트 밖 hex(기본값 `#6b7280` 포함)면 팀 **id** 의 안정 해시 % 8 + 1. DB 변경 없음. `teams.color` 를 라이트 hex inline 으로 그리지 않는다. 사용자 지정 색(팔레트 슬롯 선택)은 뒤로 `[사용자 확인 §8 #2]`. 체크포인트 B — UI-1 뒤라 "토큰 15개 삭제"가 아니라 `@theme inline` 별칭 10줄 삭제와 `tests/css/token-aliases.test.ts` 의 `ALIASES`·`DELETED_TOKENS` 갱신이다 | N1·C-5. hex inline 은 UI-1 이 고친 다크 대비(2.60~3.24:1 — SP3b D15)를 되살린다. 지금 화면 색은 코드 해시 슬롯(`teamStyle()`)이라 이행하면 팀 색이 한 번 바뀐다 — 눈확인 기록에 남긴다. 전환 RPC(D54)는 공용 팀의 색 값을 그대로 복사하므로 전환한 프로젝트의 팀 슬롯도 그대로다 | id 해시만(배정 순서 무시 — 앞 팀끼리 같은 색이 날 수 있다) |
| D4 | (R4) 가져오기의 미등록 팀은 **늘 프로젝트 전용 팀**으로 등록한다(`requireProjectAdmin` 만). 공용 팀 등록은 워크스페이스 관리 화면만 `[사용자 확인 §8 #3]`. **비평 반영 — Q16·Q36**: 전용 팀이 0개인(공용 팀을 상속하는) 프로젝트에 첫 전용 팀이 생기면 `resolveTeamsForProject`("전용 팀이 하나라도 있으면 그것만") 때문에 상속하던 공용 팀이 그 프로젝트 화면에서 사라진다. 그래서 409 `needsTeams` 가 `inheritsCommon: true` 와 상속 중인 활성 공용 팀 목록을 싣고, 확인된 등록(`registerTeams=true`)은 먼저 **전환 RPC `convert_inherited_teams`(D54)를 한 번** 부른다 — 한 트랜잭션에서 상속 공용 팀을 이름·색·순서·활성 그대로 전용 팀으로 복사하고, 그 프로젝트 안에서 공용 팀을 가리키던 참조(담당·명단 팀·영역 팀·수락 전 초대)를 새 id 로 옮긴다. 그 뒤 미등록 팀을 전용 팀으로 더한다 — 등록은 "이미 있으면 성공"이다(사전 조회·23505 → 성공). 기존 `copyGlobalTeams` 도 같은 RPC 를 쓴다 — **재검토 반영 — T14**: 그 연결은 B(팀 관리 화면의 확인 문구 정정과 한 커밋 — §5.2), A1 은 전환 RPC 와 가져오기 경로만이다 | 정본 §3.4.2(CAN:1459)가 SP4 로 정했다(N3·C-7). SP1 E2E 가 캐시 오판으로 공용 팀이 생기는 경로를 기록했다(`docs/baseline/sp1-e2e.md:296-303`). 서버는 워크스페이스 관리자에게 공용 팀 등록을 열고 화면은 슈퍼유저에게만 여는 어긋남(`ImportWizard.tsx:740`)이 함께 사라진다. 초안의 '복사만'은 같은 code·다른 id 의 팀 두 벌을 만든다 — 화면·Excel·봇은 code 로 판정해 괜찮지만, 실적·산출물의 서버 재검사와 DB 2차 방어선은 팀 **id** 로 판정한다(`actions/wbs.ts:141-145`·`:621-624`, `0006_workspace_isolation.sql:198-200`). 상속 시절 공용 팀으로 명단을 꾸린 담당 팀 멤버가 새로 가져온 항목(담당 = 전용 팀 id — `0009:167-172`)의 실적을 고칠 수 없게 된다(비평 범위 §7). 이 분열은 기존 `copyGlobalTeams`(팀 행만 넣는다)에도 있다 — 전환은 **앞으로 생기는** 분열을 닫는다(가져오기는 A1, 그 버튼은 B 부터 — T14. 그 사이 버튼의 분열은 지금 그대로라 회귀가 아니다). 이미 갈라진 프로젝트(B 전에 그 버튼을 써 전용 팀이 있다)는 전환이 `already` 로 끝나 그대로 남는다 — 로컬 개발 데이터라 §8 #10 때 같은 code 로 옮기는 수리를 함께 물을 수 있다(재검토 반영 — A F-5). 이름·색을 원본에서 그대로 가져가므로 개명(D37)·팔레트 자리 색(D3)도 이어진다(비평 충실도 F-9) | ① 상속 프로젝트에서는 등록을 거부하고 '워크스페이스 관리 화면에서 공용 팀으로 더하기 / 프로젝트 팀으로 전환'을 안내한다(사용자 단계 하나, `copyGlobalTeams` 의 분열은 남는다) ② 현행(공용 팀 등록) |
| D5 | (R5) `command_receipts` 의 키 = PK `(actor, command_id, kind)`. 요청 요약 `command_digest` = sha256(정규형 jsonb `{project, mode, items, holidays}`). 같은 키에 다른 요약 → `23505 COMMAND_REUSED`(SP3a D8 의 매핑 — `CONFIG_INVALID` 422), 같은 요약 → 저장 결과 + `status:'duplicate'`. 동시 재전송은 `(actor, command_id)` advisory 잠금. `result jsonb not null` 은 요약(상태·모드·건수·명령 id)이지 행·백업이 아니다. 보존·정리는 SP4 밖 — 워크스페이스·프로젝트 삭제 때 FK 로만 지워진다(머리 주석에 적는다). **비평 반영 — Q28**: 보존 정책의 거처는 SP8(개정 §4.10 — 정리 잡의 WORM 예외·계정 삭제 포함, §9). 영수증 읽기 액션은 A1(그 프로젝트의 영수증만 — Q14), 링크 화면은 B(#23) | C-23 — 개정의 PK 와 조회 키(+`project_id`)가 어긋나 같은 id 를 다른 프로젝트에 쓰면 PK 충돌이었다. 프로젝트를 요약에 넣으면 그 경우가 `COMMAND_REUSED` 하나로 정리되고 PK = 조회 키가 된다. 개정에 없던 요약 열·`not null` 은 선례 `authz_commands`(`0012:911-925`) | PK 에 `project_id`(조회 키 4열 — 프로젝트 없는 명령 종류가 생기면 nullable PK 문제) |
| D6 | (R6) `weekly_report_rows` 의 읽기·갱신 정책을 행의 `project_id` 직접 술어로 다시 만든다(§3.2 ⑩). 읽기 집합은 지금 부모 조인과 같다(`accessible_project_ids()`). 실시간 `weekly-rows-<reportId>`(`postgres_changes`)는 구독자별로 이 읽기 정책을 탄다 — 계약 불변을 RLS 테스트로 고정한다. `isolation-map.ts` 판별식은 `inAP`. **판정과 다름(비평 반영 — Q22)** — R6 의 "쓰기 정책을 직접 술어로" 가운데 insert·delete 는 바꾸지 않고 지운다(D27·E26) | C-8. 정본 §2.4.6(CAN:811)·실시간 계약(CAN:922). 개정 §4.3.1 SQL 에 정책 문장이 없다. 복합 FK 가 `row.project_id = report.project_id` 를 보장해 직접 술어와 옛 부모 조인(`0006:252-253`)이 같은 집합이다(비평 보안 §3) | 부모 조인 유지(조인 비용과 두 술어가 남는다) |
| D7 | (R7) 부정 테스트 1·2 의 **봇 부분은 SP8**. SP4 의 완료 조건은 봇 밖(기본 생성·이월·Excel·PPT·API 응답). 봇 `weekly:read` 팀 필터 패리티(W18)와 팀 이름 매칭(W27·W28)은 부정 테스트가 아니라 SP4 에 남는다. **비평 반영 — Q19**: 봇 **도구 층**(weekly 도구·`compare_weekly_sheets` 의 레코드 — LLM 없이 결정적)의 센티널 0 은 SP4 부정 테스트 1 에 한 케이스로 둔다. SP8 로 가는 것은 LLM 답(플래너·verifier)이다 | C-12 — 같은 시험이 두 SP 완료 조건에 있었다(개정 §6.8 "봇 부분 SP8"). 도구 층은 SP4 가 다시 쓰는 코드라 SP8 까지 남는 틈이 거기서 닫힌다(비평 범위 §6) | 봇 부분도 SP4(SP8 범위 ③ 에서 지운다) |
| D8 | (R8) S10 의 SP4 몫 = 센티널 부분 집합(주간 11구분명·5팀 코드)이 R·C 의 주간·WBS 응답과 출력에서 0건. **비평 반영 — Q19·Q39**: 대상은 R8 그대로 — ① 액션·라우트 응답 본문 ② **주간 PPT/Excel** = 시트 PPT(`/api/report?source=sheet`)와 기본 갈래 주간 보고서(`/api/report` 의 `format=xlsx`·`format=pptx`) ③ WBS Excel(`/api/export`) ④ 주간·WBS 화면의 서버 렌더 HTML. 일치 규칙 — 대소문자를 구분한다, zip 은 텍스트 파트(`*.xml`·`*.rels`·`[Content_Types].xml`·`docProps/*`)만 보고 미디어는 보지 않는다, 영문 코드는 앞뒤가 영숫자가 아닐 때만 적중한다, 검사 전에 닫힌 마스크 목록(복합어 '영업일'·'영업관리팀' — §6.4)을 지운다. `tests/fixtures/legacy-sentinels.ts` = 전체 목록 + SP 별 부분 집합. **이 문서가 더한 규칙**: 그 프로젝트가 스스로 등록한 영역·팀의 code·name 과 **같은** 센티널만 그 프로젝트의 센티널에서 뺀다(포함 관계로는 빼지 않는다) — 개정 §6.5.8 표의 C 주간 영역 '품질' 이 11구분명에 들어 있다(E9) | C-24. 개정 §4.3.6 "그 이름을 실제로 등록한 프로젝트는 정상 동작한다. 단어 전역 금지로 통과시키지 않는다". 초안은 R8 의 '주간 Excel' 을 빼고 화면 HTML 을 통째로 뺐다 — 기본 갈래 보고서는 SP4 가 팀 원천(A2)과 `weightOf`(§4.5)를 고치는 출력이고 E23 의 예시 문구가 든 같은 템플릿을 쓰며(비평 충실도 F-1), 런타임 문자열로 남은 옛 이름(`WeeklySheetView.tsx:603`)은 HTML 에서만 보인다(비평 보안 §8). 일치 규칙이 없으면 짧은 영문 코드가 글꼴 이름·이진 미디어에서 거짓 적중한다(비평 실행 §9) | C 의 영역 이름을 바꾼다(개정 §6.5.8 표를 고친다) |
| D9 | (R9) 라벨 → 영역 이관이 이미 있는 `(project_id, 'weekly_section', code)` 영역과 겹치면 **그 영역을 재사용**한다 — 이름·순서·활성은 기존 값(사용자가 입력한 영역을 덮지 않는다). 이관 리허설은 데이터가 있는 **전용 스택**에서만(메인 스택 금지) | C-26·C-27. SP3a §9 #7 "이미 입력된 영역은 지우지 않는다", 로컬 DB 에 weekly_section 1행이 있다(실측 W §1.1). 메인 스택에 사용자 데이터가 있다 | 겹치면 사전검사로 멈춘다 |
| D10 | (R10) `getComputedWbs` 의 무범위 조회(`wbs_items`·`item_owners`)와 `getPendingApprovalCount` 의 같은 결함을 Phase A 가 고친다(D18). **비평 반영 — Q5**: `getComputedWbs` 의 두 조회는 데이터 손실 경로라 **A1 첫 묶음**(마이그레이션 앞 순수 커밋), `getPendingApprovalCount` 는 A2 | C-31, 원칙 ①(잘린 배열을 데이터로 위장하지 않는다). `item_owners` 가 프로젝트 필터 없이 1,000행에서 잘리면 담당이 조용히 빠지고, 그 값이 Excel 의 ●/△ 로 나가 replace 로 되돌아오면 담당이 영구히 사라진다(비평 범위 §1.2). 쪽 나눔·가상화는 SPU2(레인 B 기준선: 3천 행에서 무너짐) | SPU2 로 미룬다 |
| D11 | (R11) 개정이 다시 적지 않은 정본 SP4 범위 — `RESERVED_TEAM_NAMES` 파생, 팀 코드 리터럴 테스트 fixture 공용화, `WbsRow.owners` 계약 불변, `import_wbs`/`replace_wbs` 팀 해석 스코프, 대시보드 팀별 진척·간트·칸반 색 — 를 §1.4 범위 표에 명시한다 | C-29 | — |
| D12 | (R12) 마이그레이션 번호는 개발 중 `0013_weekly_areas`·`0014_command_receipts`·`0015_authz_carry`, **머지 직전 확정**. 테스트·리허설·문서는 접미로 찾는다(원문을 읽는 테스트는 `readdirSync('supabase/migrations').find((f) => f.endsWith('_weekly_areas.sql'))`). UI-2a 의 `account_preferences` 와는 머지 순서대로 | C-9·C-28, SP3b 알림 9. UI-2 는 UI-1 뒤라 SP4 A1 이 먼저 머지될 가능성이 크다 | — |
| D13 | (R13) 이미 끝난 것(C-1·C-6·C-14~C-16·C-34·C-35)은 범위에서 빼고 **회귀 가드를 현재 식별자로** 다시 적는다 — 주간 `WEEKLY_SECTIONS`·`WEEKLY_TEAM_SECTIONS`·`FALLBACK_SECTION`, 단계 `DEFAULT_LEVEL_LABELS`·`LEGACY_LABEL_ABBR`, Excel `LEGACY_EXCEL_PROFILE_V1`(런타임), 팀 `RESERVED_TEAM_NAMES`, 토큰 `--color-team-[1-5]`, 팀 색 `teamStyle`·`team-[1-5]` 클래스(§4.8) | C-1~C-4·C-35. 정본 grep(W2·W3)은 이미 0건인 이름을 보고 남은 이름을 놓친다 | — |
| D14 | (R14) SP4 화면의 눈확인 주체 = 에이전트 헤드리스 + 기록(사용자는 SP3b UI-3 게이트에서 직접 본다) `[사용자 확인 §8 #4]`. **비평 반영 — Q27**: 기본값이 Phase A 의 최소 수정 화면(영역 0개 안내·이월 매핑 창·영역 편집기·가져오기 등록 확인·사전 백업·Excel 표기)에도 걸리므로 §8 #4 가 둘을 함께 묻는다 | U6. SP3a §9 #10 과 같은 기본값. R14 는 Phase B 만 물었는데 초안이 Phase A 로 넓혔다(비평 충실도 F-11) | 개정 R21 대로 사용자가 A1·A2·B 체크포인트에서 직접 본다 |
| D15 | (R15 + 확정) CR-4 는 **해당 없음** — SP4 의 세 롤백은 `modules.*` 를 건드리지 않는다(세 롤백 머리에 적는다). **비평 반영 — Q22**: R15 의 "이월 유지(SP3a 롤백 설계의 몫)로 기록한다"를 §9 의 행으로 남긴다(E29). CR-7 의 남은 절반(골격 시드가 쓰기 전 `validateProjectConfig`)은 **SP4 A2 가 닫는다**. SP3a Phase B 과제 21 의 `max_rows` 후보(외부 회의록 API 가 플랫폼 관리자 후보로 `workspaces` 전량을 한 번에 읽음)는 **SP7**(외부 API 소유)로 넘긴다 | R15 는 "실측 뒤 확정"이었고 조사 넷이 처리 기록을 찾지 못했다(C-17). 두 항목을 파일 소유로 정했다 — `src/lib/agent/wbsImport.ts` 의 골격 시드는 WBS 설정 쓰기(SP4), `api/v1/minutes` 는 외부 API(SP7) | CR-7 도 SP7(외부 WBS API) / 과제 21 을 SP4 D18 에 더한다 |
| D16 | (R16) Excel **표준 레이아웃은 설정이 아니라 내보낼 때마다 트리에서 계산**한다(`'{}'` = 이제 '키 미설정'). 표준 결과는 옛 빌더와 **셀 단위 동등** — 깊은 WBS(L 초과)의 접기, 비활성·담당 있는 팀 열(`resolveTeamColumns`)까지. 두 빌더가 함께 재현하는 상태 열 머리 누락(`export.ts:97`)은 **먼저 별도 커밋으로 고치고** 동등성은 고친 뒤 기준으로 본다. 표준 프로파일을 설정 키로 저장하지 않는다. 깊은 트리 거부는 저장 양식에서만 나오고 표준 경로는 접는다 — 거부 문구("저장된 양식 비우기")가 표준 양식의 처방이 될 길이 없다(§4.3). **비평 반영 — Q31·Q40**: 동등성 오라클은 `export.ts` 를 지우기 전에 `buildWbsAoa`·`resolveTeamColumns` 원문을 옮긴 `tests/fixtures/excel/legacyBuild.ts` 다(런타임 import 금지 가드) — W23 = "fixture 오라클과 셀 단위". 뒤 계산 열 머리의 어긋남('계획대비%' 가 롤업 실적% 위, '진척' 이 성과율 위 — `export.ts:74-75` vs `:94-97`)은 감지 낱말 호환 때문에 그대로 둔다 — 동등성 기준이 이 상태를 고정한다. 펼침에서 sub-act 는 ~~깊이와 무관하게~~ 계층 열이 모자랄 때(부모가 마지막 계층 열 깊이 이상 — 접힌 항목 아래 포함)만 `insertAt` 에 쓰고 얕으면 제 깊이의 계층 열에 쓴다, 접는 것은 일반 항목뿐이다(**정오표(A2 — A2-2 리뷰 정확성 P2)**: 늘 `insertAt` 이면 잎이 마지막 계층 열보다 얕은 트리의 펼침 파일이 깊이를 건너뛰어(1단 → 3단) 다시 가져올 때 거부된다 — 접기가 필요한 깊은 트리는 옛 규칙으로도 `insertAt` 이었다) | 실측 T #1·#2. 프로파일 빌더는 프로파일 밖 팀을 실적% 뒤에 붙이고 깊은 트리를 거부한다(`exportWithProfile.ts:111-116,149-156`) — 트리에서 계산한 팀 열과 접기 선택지 없이는 동등이 깨진다. 저장하면 교차 검증(활성 팀만 — `validateConfig.ts:39-43`)에 걸린다. 오라클이 지울 파일을 import 하면 삭제 커밋에서 W23 이 깨진다 — 선례는 라운드트립 오라클을 fixture 로 옮겨 두었다(`export.ts:5-6`, 비평 실행 §5) | 표준도 깊은 트리를 거부(동등 포기 — 개정 W23 을 고친다) |
| D17 | (R17) **가져오기 멱등은 가져오기와 같은 트랜잭션**이다 — `import_wbs`·`replace_wbs` 를 감싸는 DEFINER RPC `import_wbs_cmd` 가 null 확인 → 명령 잠금 → 격리 가드(25001) → 행위자 등급 재판정(`upsert_project_member_cmd` 선례) → 원장 조회(D5) → 실행 → 원장 기록을 한 번에 한다. DEFINER 라 RLS `admin_write_items` 가 빠지므로 RPC 안의 등급 판정이 2차 방어선이고 `docs/sp2-admin-client-audit.md` 의 가져오기 라우트 행을 고친다. `p_actor` 는 가드 결과의 `actor.userId` 다(D51). 팀 등록(D4)·replace 백업 select 는 트랜잭션 밖 — 실패 순서는 §4.4. **판정과 다름(세부)** — `p_digest` 를 받지 않고 RPC 가 인자에서 요약을 만든다(D34) | 실측 T #3, G §2.7. 원장을 RPC 뒤에 따로 쓰면 커밋과 기록 사이의 끊김에서 재시도가 두 벌을 만든다. 요약을 RPC 가 만드는 이유는 D34 | R17 문면대로 TS 가 요약을 만들어 `p_digest` 로 넘긴다 |
| D18 | (R18) 무범위 조회 일괄 — `getComputedWbs`(`wbs_items` 끝까지, `item_owners` 프로젝트 필터 + 끝까지, `task_dependencies`·`holidays` 끝까지)·`snapshots.ts` 의 기록 경로·`getProjectsCompletion`·replace 백업 select(**1,000행에서 조용히 잘린 백업을 바로 뒤 replace 가 지운 원본의 유일한 사본으로 내준다**)·`getPendingApprovalCount`(결재 대기 `limit(500)` 과 항목 트리)를 `fetchAllPages` 로. 잘린 배열 → 끝까지 읽기. 화면 성능은 SPU2 — 이 SP 는 정확성만. **비평 반영 — Q5**: 데이터 손실 경로 — replace 백업 select, `getComputedWbs` 의 `item_owners`(프로젝트 필터 + 끝까지)·`wbs_items` 끝까지 — 는 **A1 첫 묶음**(마이그레이션 앞 순수 커밋)에서 한다. 나머지(`task_dependencies`·`holidays`·팀 정렬, 스냅샷, `getProjectsCompletion`, 결재 대기, 봇 리포지토리)는 A2 | 실측 T #4, D10. 셋 다 A1 이 어차피 다시 쓰는 파일의 한두 줄이라 비용 없이 노출 기간만 준다(비평 범위 §1) | 잘림을 `count:'exact'` 로 감지해 오류만 낸다(큰 프로젝트는 계속 못 본다) |
| D19 | (R19) **팀 원천의 규칙 하나** — 요청 범위 원천 `getProjectConfig(pid).teams`(공용 ∪ 전용)에 지금 캐시의 노출 규칙 "전용 팀이 있으면 그것만, 없으면 공용"(`resolveTeamsForProject`, `domain/teams.ts:57-62`)을 적용한다(§4.2). 워커·봇은 `{ client: admin }`. 캐시의 모듈 인스턴스별 상태(e2e `next start` 409 의 원인)가 사라지는 것을 E2E(`next start`)로 확인한다(A2). `teams/master.ts` 는 화면 넷이 B 에서 옮겨 가고 `refreshTeams` 호출이 사라진 뒤 지운다. **비평 반영 — Q23**: 화면 넷 = 레이아웃 둘(UI-2b 뒤 구조 — `w/[slug]/layout.tsx` 가 그 워크스페이스의 활성 팀을, `p/[projectId]/layout.tsx` 가 프로젝트 팀을 `TeamsProvider` 로 내린다, SP3b §5.4.1)·명단 페이지·`DashboardView`. 여러 워크스페이스 접근자 `activeTeamsForWorkspaces` 는 만들지 않는다. 목록은 B 착수 때 다시 센다 | 실측 T #5. 레이아웃 둘은 SP3b D47 경계 파일이고 `DashboardView` 는 UI-2a 가 고친다 — A 에서 건드리지 않는다. 설정 페이지는 A1 이 편집기 장착으로 어차피 만지므로 그때 원천도 옮긴다. UI-2b 뒤 `(app)/layout.tsx` 는 "프로젝트 목록·팀·신원은 싣지 않는다" — 초안의 대상은 UI-2b 이전 구조였다(비평 범위 §7·충실도 F-16) | 레이아웃까지 A 에서 옮긴다(SP3b D47 위반 — UI-2 가 rebase) |
| D20 | (R20) **null 가중치** — `rollup.ts` 가 export 하는 `weightOf(w) = w ?? 1` 하나로 모은다. 실제 동작이 바뀌는 곳은 루트 두 줄(`overallProgress`·`plannedCurve` 루트)뿐이다. 정반대를 단언하던 `overallProgress.test.ts:36-43` 은 사용자 결정 3 의 정정으로 바꾼다. `topWeightPhaseDelayed`(null=0) 불변 + 루트 혼재 회귀 테스트를 **새로** 둔다. 저장 스냅샷은 재계산하지 않으므로 추세 실적선·SPI·속도·포트폴리오 `trendDelta` 의 계단을 운영 메모(`docs/baseline/sp4-e2e.md`)와 커밋 메시지에 적는다. "가중치 미지정 N개" 계산은 A2(도메인), 화면 표시는 B | 실측 T #9, 개정 §1.4.3 | — |
| D21 | (R21) **DB 오류 원문 노출 제거**(H2 이월) — `actions/wbs.ts` 32곳/10함수, 가져오기 라우트 5곳, 팀 액션, 그리고 SP4 가 다시 쓰는 주간·영역 액션. H2 선례(`src/lib/attachments/removeErrors.ts`): 고정 한국어 + 코드 매핑, 원문은 로그. 원문 부분 문자열로 의미를 뽑는 곳(`wbs.ts:182` `WORKFLOW_ACTUAL_LOCKED`)을 먼저 토큰 매핑으로 뗀다. 원문을 고정한 테스트는 같은 커밋에서 바꾼다. 화면의 사전 매핑(WBS 토스트)은 B. **비평 반영 — Q20·Q40**: 주간 액션은 파일 전부(`createWeeklyReport`·`saveWeeklyTitle`·`saveWeeklyCell(s)` — `errMsg(e)` 보간 포함)를 A1 이 고치고, 회귀 가드가 `.message` 와 함께 `errMsg(`·`String(e)` 보간과 다른 결과의 `${x.error}` 옮기기도 잡는다. 토큰은 기존 `mapDbError`·`dbToken`(`settings/errors.ts`)을 먼저 쓴다 | 실측 T #10, 개정 SP4 블록 H2 이월. 토스트 줄은 UI-1 과제 12 의 스크립트 조각과 같은 파일이라 UI-1 뒤로 둔다(§2.4). 범위가 파일 일부면 파일 단위 가드가 남은 원문 때문에 빨개지고, 가드가 `.message` 만 보면 `errMsg(e)` 로 우회된다(비평 보안 §7) | — |
| D22 | (R22) **주간 읽기 경로의 쓰기 세 진입점**(주간 페이지 렌더·주간 PPT GET·`createWeeklyReport` 멱등 확인)을 한꺼번에 순수 읽기로 바꾸고, 행 생성은 `create_weekly_report`·`upsert_project_area(…, p_from_week)` RPC 만. 점검(`weeklyLint`)과 PPT(`sheetNarrative`)는 같은 묶음 키를 공유하므로 **함께** `areaId` 로. PPT 는 프로젝트의 영역만 페이지로 낸다(11구분 고정 페이지 금지). 이월은 "원본에 그 영역 행이 없음"(재활성·새 영역)을 빈 행으로 다룬다. 20,000자 초과 잘림과 비표준 구분의 PMO 흡수는 결함으로 보고 규칙을 둔다(D31·§4.1.1) — 조용히 자르지 않는다 | 실측 W #1·#5·#6 | — |
| D23 | (R23) `NNNN_weekly_areas` 의 순서 — 한 파일 안에서 확장(열 추가·백필·이관·검증) → 제약(NOT NULL·복합 FK·유일) → 축소(`section`·`module`·`sort_order` drop, 단일 FK drop). 명시 select 넷·`sort_order` 정렬 넷·임베드 넷은 같은 브랜치의 코드 커밋이 바꾼다(G1 — 마이그레이션 커밋 먼저, 목록 §4.1.2 — Q35). 롤백은 지운 열을 영역 code·순서로 되살린다(Q33). 픽스처·격리 맵·스키마 불변식과, 영역 FK 와 프로젝트 삭제 캐스케이드의 충돌(선례 `workspace-isolation-cases.test.ts:99-100`)을 같은 과제에서 맞춘다 — **비평 반영 — Q10. 해법: 영역 FK 는 개정대로 `on delete restrict`(직접 삭제는 즉시 23503)이고, 주간 행에 `project_id → projects on delete cascade` 직접 FK(`weekly_report_rows_project_id_fkey`)를 더해 프로젝트 삭제가 RI 트리거 순서와 무관하게 통과하게 한다**(E2). 마이그레이션 주석과 RLS·카탈로그 테스트로 고정한다 | 같은 사건의 RI 트리거는 이름(`RI_ConstraintTrigger_a_<OID>`)의 **문자열** 순으로 돌고, 캐스케이드가 낳은 검사는 큐 끝에 붙어 다음 바퀴에 돈다. 기준선의 `weekly_reports → projects` 캐스케이드가 0003 의 `project_areas → projects` 보다 이름이 앞이면 통과, 뒤면 23503 이다 — 마이그레이션으로 만든 DB(같은 자릿수)는 통과하지만 덤프·복원·기준선 재생성(FK 를 제약 이름순으로 만든다), 두 FK 중 하나의 재생성, OID 자릿수 경계에서 뒤집힌다(실험 `.superpowers/sp4/critique-db-probe.md` §3). 직접 FK 는 주간 행을 `projects` 의 1단 캐스케이드로 지우고, 영역 검사는 영역 삭제가 낳는 2단 사건이라 이름 순서와 무관하게 그 뒤에 돈다(같은 실험 — 네 순서 모두 통과). 지연 없는 `no action` 은 `restrict` 와 같은 때 검사해 도움이 안 된다. 기준선의 프로젝트 소속 표는 거의 모두 `project_id → projects cascade` 를 직접 갖는다 — 주간 행만 문서를 거쳤다. 실측 W #2·#3. 결정이 실험으로 앞당겨져 A1 의 스파이크는 없다 | ① 영역 FK `on delete cascade` + `project_areas` BEFORE DELETE 가드 "프로젝트가 아직 있고 주간 행이 달렸으면 `23503 PROJECT_AREA_IN_USE`"(SP3a D7·D35 의 부모 부재 면제 꼴 — 순서와 무관, 새 함수·토큰, 가드가 꺼지면 직접 삭제가 행을 지운다) ② 영역 FK `no action deferrable initially deferred`(순서와 무관하나 직접 삭제 오류가 커밋 때 나 RPC 예외 처리가 잡지 못하고 `begin…rollback` 테스트가 거짓 통과, `set constraints all immediate` 뒤에는 순서 의존 — 비권고) |
| D24 | (R24) **봇**: 주간 팀 필터 원천을 `area_teams`(primary ∪ support) 하나로 — 하드코딩 매핑·팀 캐시·동명 구분 폴백 셋을 없앤다. 비교·증거의 키를 `section+module` 문자열에서 `areaId` 로. 주 시작(월요일 강제)은 건드리지 않는다(SP5) | 실측 W #7 | — |
| D25 | (R25) **모듈 관문**: 영역 액션은 설정 도메인(`module: null`)이고, 영역 추가·재활성이 현 주차 이후 문서에 행을 만드는 일은 주간 모듈 상태와 무관하게 한다(꺼짐 = 숨김·데이터 유지). RPC 안의 쓰기는 열거 게이트(리터럴 `.from` 만 본다)를 우회하므로 **RPC → 소유 표 대응**(`tests/gates/_rpc-tables.ts`)을 게이트에 더한다. **비평 반영 — Q9**: 대응은 `tablesInNode`(`tests/invariants/_ast.ts`) 안에서 적용한다 — `.rpc('x')` 를 `RPC_TABLES[x]` 로 바꿔 표 목록에 합치고, 표에 없는 이름은 `module: null` 항목에서 실패로 센다(모듈 항목은 건너뛴다). 그래서 액션 축(`deny.test.ts`)과 라우트 축(`deny.routes.test.ts`)이 함께 쓴다. `upsertArea` 의 예외는 새 매니페스트 필드가 아니라 기존 닫힌 목록 `NULL_TABLE_ALLOW` 한 줄이다(`GateEntry` 형은 바꾸지 않는다). 닫힌 목록의 대상 = `module: null` 항목 본문의 리터럴 `.rpc('…')` — 모듈 항목이 부르는 RPC 는 모듈 관문이 먼저 닫으므로 표에 없어도 된다 | 실측 W #9. 주간을 다시 켰을 때 행이 있어야 한다. null 항목의 모듈 표 접촉은 이미 `NULL_TABLE_ALLOW`(`deny.test.ts:41-49` — 표·사유, 죽은 항목까지 양방향)가 관리한다 — 새 필드는 같은 판단을 두 목록에 나눈다. 액션 본문만 바꾸면 라우트(`import/execute`)의 RPC 를 라우트 축이 보지 못한다(비평 보안 §2·실행 §9). src 의 리터럴 RPC 는 약 50종이라 전부를 닫힌 목록에 넣으면 위키·회의록 RPC 의 SQL 까지 읽어야 한다(비평 범위 §1) | 주간 모듈이 꺼지면 영역 백필을 건너뛴다(다시 켤 때 백필 경로가 하나 더 필요하다) |
| D26 | (R26) **주간 영역 편집기**를 Phase A1 이 프로젝트 설정 '팀·업무영역' 범주에 다시 붙인다(`weekly_section` 탭만 — 이슈 영역 탭은 SP5). 새 프로젝트는 주간 영역이 0개라(`create_project_with_settings` 가 만들지 않는다) 주간보고 생성이 `WEEKLY_AREAS_REQUIRED` 로 막히기 때문이다. SP3b 패턴 이행이 아니라 기능이 막히지 않게 하는 장착이다. `settings-page-visibility.test.tsx:72-75` 의 부재 단언을 같은 과제에서 바꾼다. 편집기는 RPC(D22)를 쓴다(지금 `upsertArea` 는 service_role·비원자·행 생성 없음·잠금 없음). **비평 반영 — Q8**: 편집기의 SP3b 패턴 이행(상태 계약·빈 상태 `StatusMessage`·12px/uppercase — W43 일부)은 SPU3 로 넘긴다(D52) | 실측 W #4·#9, SP3a §9 #7 | — |
| D27 | **세션 쓰기 길을 닫는다.** `project_areas`·`area_teams` 쓰기 정책(`project_areas_write`·`area_teams_write`)을 지우고 authenticated 의 INSERT·UPDATE·DELETE 를 회수한다. `weekly_reports` 의 INSERT·DELETE 정책을 지우고 회수, UPDATE 는 열 권한 `(title)` 만. `weekly_report_rows` 의 INSERT·DELETE 정책을 지우고 회수, UPDATE 는 열 권한 `(this_content, this_issue, next_content, next_issue)` 만. **비평 반영 — Q13**: 두 표의 `updated_at` 은 `before update` 트리거(`new.updated_at := now()`)가 채우고 열 권한에서 뺀다 — 액션의 `updated_at` 대입을 지운다(`weekly.ts:161,319,384`). 주간 문서 삭제 정책은 앱의 마지막 사용처(보상 삭제 `deleteReportIfEmpty`)가 사라져 함께 지운다. **판정·정본과 다름(비평 반영 — Q22, E26)** — 정본 §2.3.5 의 영역·영역-팀 RLS 쓰기(`is_project_admin`)와 R6 의 "쓰기 정책을 직접 술어로"를 교체가 아니라 폐쇄로 바꾼다. 받는 쪽: SP5 의 이슈 영역 편집도 `upsert_project_area`(kind `issue_area`)를 쓴다(§9) | 행 생성이 RPC 한 길이 되는데(D22·D26) 세션 경로를 남기면 RPC 를 우회한 재활성이 백필을 건너뛰고, 잠금 없는 문서 생성이 영역 추가와 엇갈려 행이 빠진다. 구조 열(`area_id`·`project_id`·`report_id`·`week_start`)을 세션이 바꾸면 행이 영역·문서 사이를 옮겨 다닌다. 0012 의 세션 프로젝트 insert 폐쇄(SP3a D6)와 같은 이유. 정책 없는 DML 0 불변식(H2 규칙 2)이 grant 회수를 같이 요구한다. 세션이 `updated_at` 을 고르면 멤버가 문서 시각을 되돌려 AI 색인 신선도(`ai/index/backfill.ts:116,166`)를 속일 수 있고, 관리자의 PostgREST 문서 삭제는 모듈 관문·`'weekly:'` 잠금을 거치지 않는 마지막 구조 쓰기였다(비평 보안 §3) | 정책을 남기고 RPC 를 권장 경로로만 둔다(불변식이 깨질 길이 남는다) / `updated_at` 을 열 권한에 남기고 §9 로(SP8 색인 배선과 함께) |
| D28 | 주간 RPC 둘(`create_weekly_report`·`upsert_project_area`)도 **`p_actor` 를 받아 프로젝트 관리자 등급을 RPC 안에서 다시 판정**한다(가져오기 RPC 와 같은 도우미 `actor_is_project_admin`). **개정과 다름(비평 반영 — Q22, E27)** — 개정 §4.3.2 의 시그니처(`create_weekly_report(p_project_id, p_week_start, p_seed)`, `p_actor` 없음)에 행위자를 더한다. 기록은 머리 주석과 `docs/sp2-admin-client-audit.md` 의 **본문 절**('DEFINER RPC 가 등급을 다시 판정하는 경로' — 표 밖)이다 | 지금 `createWeeklyReport` 는 세션 클라이언트라 RLS(`weekly_reports_insert`)가 2차 방어선이다. DEFINER RPC 로 옮기면 그것이 사라진다 — D17 과 같은 이유. 설정 RPC(등급을 보지 않는다 — 0012)와 다른 선택이다. 주간 액션은 `adminFor` 만 써서 감사표에 행을 둘 수 없다 — 표는 `createAdminClient` 를 쓰는 파일과 양방향으로 대조된다(`admin-scope.test.ts:31-33`, 비평 보안 §9) | 등급을 보지 않는다(액션 가드가 유일한 관문 — CLAUDE.md 의 회의록·위키·AI 와 같은 성격) |
| D29 | **비평 반영 — Q18. 이관 라벨 = `btrim(section)`**(개정 §4.3.4 그대로) — 구분이 비면 모듈, 둘 다 비면 `'기타'`. 같은 `(문서, 라벨)` 의 행을 합칠 때(행이 하나뿐인 묶음 포함) 모듈이 비어 있지 않고 라벨과 다른 행은 그 행의 칸 가운데 공백만이 아닌 값 앞에 **머리표** 를 붙인다. **재검토 반영 — T4**: 머리표는 본문 줄 앞 접두가 아니라 **`[모듈]` 단독 줄 + 줄바꿈**이다 — `'[' \|\| 모듈 이름 \|\| ']' \|\| E'\n' \|\| 값`. 글자 수는 접두 꼴(`[모듈] `)과 같은 `char_length(모듈 이름) + 3` 이라 ①·⑦ 산술·롤백은 그대로다. 머리표는 `btrim(값, <⑤ 의 공백 집합>) <> ''` 인 값에만 붙이고 공백뿐인 값은 머리표 없이 그대로 옮긴다(A F-13 — 판정의 `btrim(값) <> ''` 을 ⑤ 의 집합으로 읽었다: 기본 `btrim` 은 공백만 걷어 탭·줄바꿈뿐인 값을 놓친다). 이름 목록 없이 정의한다(초안안 — 화면 라벨 '구분 · 모듈' — 은 버렸다) | 영역 구조(문서마다 생기는 행)는 개정·지금 시트와 같게 둔다 — 지금 PPT·점검은 표준 구분 아래 모듈 행을 이미 한 페이지로 합쳐 낸다(`sectionKeyOf` — `weeklySheet.ts:72-75`, `sheetNarrative.ts:59`, `weeklyLint.ts:105`), 시트도 구분을 크게·모듈을 보조 글씨로 그렸고(`WeeklySheetView.tsx:693-699`), 이월도 구분명으로만 찾았다(`weeklySheet.ts:130`). 모듈 정보는 칸 내용 안에 남아 조용히 사라지지 않는다. 초안안은 조합마다 활성 영역이 생겨 이후 모든 주간 문서의 행 구조가 영구히 커진다. `sectionKeyOf` 와 같게 하는 셋째 안은 표준 11구분명을 마이그레이션 원문에 넣어야 해 고객 흔적 규칙·S10 과 부딪친다(비평 충실도 F-7, E1). 머리표를 행 하나짜리 묶음에도 붙이는 이유 — 병합이 없어도 `module` 열은 지워지므로, 붙이지 않으면 그 행의 모듈이 사라진다. 머리표를 머리글 **줄**로 두는 이유(T4) — 점검은 줄 전체가 대괄호 한 쌍인 줄을 셀 안 구획 머리글로 읽고 구획마다 번호를 1부터 다시 세며 구획 사이의 같은 문구를 중복으로 보지 않는다(`weeklyLint.ts:1-17` 머리 주석·`:142-152` `BLOCK_HEADER`, 사용자 확인 2026-08-06). 이관이 만드는 칸이 바로 "한 구분에 모듈 둘 이상을 담은 칸"이다. 접두 꼴이면 첫 줄이 번호 줄로 읽히지 않아 번호 목록 칸마다 재번호 수정이 나고 그 수정을 누르면 번호가 망가진다(재검토 A F-1). 공백뿐인 값에 머리표를 붙이면 "내용 있음"(D32)이 되어 비활성 영역 행이 머리표만 든 칸으로 시트·PPT·이월 대기에 나타난다(A F-13) | ① 개정 문면 그대로(머리표 없음 — 모듈 이름은 버려지고 내용만 이어 붙는다) ② 화면 라벨 '구분 · 모듈'(초안안) ③ `sectionKeyOf` 와 같게(지금 PPT 와 같지만 이름 목록이 원문에 든다) — §8 #6 |
| D30 | 이관의 중복 행 병합 뒤(머리표 줄 `[모듈]` 포함 — T4) 한 칸이 20,000자를 넘는 `(문서, 라벨)` 이 있으면 사전검사 `WEEKLY_AREAS_PRECHECK` 로 멈춘다(자르지 않는다). 비평 반영 — Q18·Q34 | 셀 상한은 TS 뿐이다(`WEEKLY_CELL_MAX`). 넘긴 채 이관되면 그 셀은 이후 저장이 거부된다. "보정하지 않고 멈춘다"(0012 사전검사 관례) | 넘긴 채 이관하고 화면이 경고한다 |
| D31 | 이월의 **20,000자 넘침은 거부**한다 — 매핑으로 한 활성 영역에 내용이 모여 칸이 상한을 넘으면 `carryOverRows` 가 `ok:false` 에 `overflow` 목록을 싣고 문서를 만들지 않는다. 화면은 같은 매핑 창에서 다른 영역이나 '옮기지 않음'을 고르게 한다. **개정과 다름(비평 반영 — Q22, E25)** — 개정 §4.3.3 은 "현 append 규칙(trim, 20,000자 상한)"을 쓰라고 했고 그 규칙은 상한에서 자른다(`weeklySheet.ts:126`). 받는 쪽: §8 #9 | R22 "조용히 자르지 않는다" — 판정이 잘림을 결함으로 보았다. 영역별 1행·저장 상한 아래에서는 넘침이 매핑에서만 생긴다(같은 영역 중복 행은 유일 인덱스가 막는다) | 그대로 붙여 넘친 칸으로 만들고 저장 때 줄이게 한다 / 개정 문면대로 자른다 |
| D32 | **영역 순서와 표시 집합** — 영역은 `(sortOrder, code, id)` 순(동률 결정적). 시트·점검·PPT 가 보이는 행은 같은 함수 하나가 정한다: 활성 영역의 행(영역 순) → 내용이 있는 비활성 영역의 행(뒤에, '비활성' 표지, 편집 가능). 내용이 없는 비활성 영역 행은 숨긴다. PPT 는 그 행들만 페이지로 낸다. **비평 반영 — Q37**: 표시 집합은 페이지를 읽을 때 정하고 같은 화면 안에서는 빼지 않는다. "내용 있음" = 해당 칸 `trim() !== ''`(대기 판정은 `next_*` 두 칸, 표시·시드 보존은 네 칸) — 술어 함수 하나를 이월·표시·시드가 함께 쓴다. **정본과 다름(E31)** — 정본 `:1982` 의 "활성 구분 전부(내용 없는 구분 포함)"는 영역 기준이고, SP4 는 그 문서에 행이 있는 영역만 페이지로 낸다 | 개정 §4.3.1(활성 먼저, 내용 있는 비활성 뒤). `sort_order` 는 기본 0·유일 아님이라 `getProjectConfig` 순서가 동률에서 비결정이다(실측 W §6.3). 같은 화면에서 빼면 비활성 영역 행의 마지막 칸을 비우는 순간 실시간 병합 뒤 행이 손 아래에서 사라진다(비평 실행 §7). 문서 기준이어야 과거 주차에 뒤에 생긴 영역의 빈 페이지가 생기지 않는다(W17) | 비활성 영역 행을 모두 숨긴다(내용이 화면에서 사라진다) |
| D33 | `create_weekly_report` 의 시드 의미 — 잠금 아래에서 **지금 활성인 영역마다 1행**(시드에 그 영역이 있으면 그 칸, 없으면 빈 칸) + **시드에만 있는 비활성 영역 행은 내용과 함께 넣는다**. 같은 주 문서가 있으면 `exists` 를 돌려주고 아무것도 바꾸지 않는다. 시드의 "내용"은 D32 의 술어로 정한다 | 액션이 영역을 읽은 뒤 RPC 사이에 영역이 바뀌어도 행이 빠지지 않고(새로 활성 = 빈 행) 내용이 사라지지 않는다(그새 비활성 = 내용 보존 행). `(project_id, week_start)` 유일이 자연 멱등이다 | 시드와 현재 영역이 어긋나면 재시도 가능한 충돌로 거부한다 |
| D34 | `import_wbs_cmd` 는 **함수 하나 + `p_mode`**. 요약은 RPC 가 인자에서 만든다 — sha256(`jsonb_build_object('project', p_project_id, 'mode', p_mode, 'items', p_items, 'holidays', p_holidays)::text`). 원장 조회 뒤 **프로젝트 잠금**(`'wbs-import:' \|\| project_id`)을 하나 더 잡아 같은 프로젝트의 가져오기를 직렬화한다. 옛 `import_wbs`·`replace_wbs` 는 `create or replace` 로 본문의 표 이름만 `public.` 한정한다(INVOKER·ACL·속성 그대로 — 0009 원문의 나머지는 바이트 그대로) | 0012 의 RPC 는 모두 요약을 안에서 만든다 — 호출자가 넘긴 요약을 믿는 경계가 없어진다. jsonb 텍스트는 키 순서가 정규화되고 `tempId` 는 결정적(`t${i}` — `parseWithProfile.ts:210`)이라 같은 파일·양식이면 같은 요약이다. 두 replace 가 엇갈리면 트리가 두 벌이 되는 기존 경합(실측 없음 — 추론)이 사라진다. 옛 함수는 이름 비한정이라 `search_path ''` 인 DEFINER 안에서 42P01 이다(실측 G §2.3). 옛 함수의 authenticated 실행권은 남긴다 — `workspace-isolation-cases.test.ts` ⓚ 가 세션으로 부른다(무수정 원칙) | 요약을 TS 가 만들어 넘긴다(R17 문면) / 옛 함수의 세션 실행권을 회수하고 ⓚ 를 고친다 |
| D35 | `command_receipts` 는 고칠 수 없다 — `before update or delete` 트리거가 `55000 HISTORY_IMMUTABLE` 로 거부하고 DELETE 는 부모(프로젝트·워크스페이스) 부재일 때만 통과(캐스케이드), `before truncate` 는 기존 `history_reject_truncate()` 재사용. 워크스페이스 일치는 새 함수 없이 기존 `workspace_scope_from_project()` 트리거. FK 둘은 `on delete cascade`. **비평 반영 — Q14**: `kind = 'wbs_import'` 인 동안 `check (kind <> 'wbs_import' or project_id is not null)` — 면제의 "부모 없음" 판독이 null `project_id` 에서 늘 참이 되지 않게 한다 | 원장이 바뀌면 재전송 판정이 틀린다. service_role 권한은 회수할 수 없다(SP2 불변식 ⓘ — 트리거로 막는다). FK 를 동작 없이 두면 영수증이 프로젝트 삭제를 23503 으로 막는다(실측 G §2.7-5 — 워크스페이스는 `projects_workspace_id_fkey` RESTRICT 때문에 프로젝트를 먼저 지워야 지워진다). 선례 `authz_events_reject_mutation` 은 null 을 먼저 거른다(`0012:936`) — 여기서는 check 하나가 더 단순하다(비평 보안 §4) | FK 없이 정리 트리거(`authz_commands` 꼴) |
| D36 | 팀 원천 모듈은 `src/lib/teams/source.ts`(서버 전용, 요청 범위 `react cache`). `domain/teams.ts` 의 `Team` 에 `name`·`color` 를 더하고("name 은 code 와 동기" 주석을 고친다) 규칙은 기존 순수 함수(`resolveTeamsForProject`·`activeCodes`·`teamCodesVisibleTo`)를 그대로 쓴다. 동기 접근자(`*Sync`)는 async 로 바뀐다. 비평 반영 — Q23: 순수 함수 `activeTeamsForWorkspaces` 는 B 에서 소비처가 남지 않으면 지운다(원천 접근자는 만들지 않는다) | 해석기는 이미 요청마다 팀을 읽는다(`projectConfig.ts:56-57`) — 같은 요청의 설정 조회와 공유하면 추가 왕복이 없다. 규칙을 새로 만들지 않아 화면마다 다른 팀이 보이지 않는다 | — |
| D37 | **팀 개명**: `updateProjectTeam`·`updateTeam` 의 patch 에 `name` 을 더한다(code 불변). 이름은 앞뒤 공백을 걷고 1~40자, 예약어 아님(D38), 같은 범위(전용 팀이면 그 프로젝트의 전용 팀, 공용 팀이면 그 워크스페이스의 공용 팀)의 다른 팀 code·name 과 겹치지 않는다. 회의록 폴더 이름은 건드리지 않는다(루트 이름 동기는 SP5). 화면의 개명 입력은 B(D52) | 개정 §4.7·§4.8 "SP4 부터 name 편집". 범위가 다른 팀끼리의 겹침은 봇의 모호 거부가 맡는다(D24). 지금 팀 루트 폴더는 code 로 시드되므로 개명과 어긋나지 않는다(C-39) | 이름 겹침을 허용하고 봇 모호 거부에만 맡긴다 |
| D38 | **팀 예약어는 파생한다** — `src/lib/excel/headerWords.ts` 의 `EXCEL_HEADER_WORDS`(두 빌더가 쓰는 머리 낱말과 감지기의 논리·담당 별칭의 단일 출처 — 제품 고정 낱말) ∪ 그 프로젝트의 `core.level_labels` ∪ `core.extra_axis_label`. 공용 팀은 머리 낱말만 본다. 정본의 "`wbs.excel_profile` 헤더"는 빌더·감지기의 머리 낱말로 읽었다(E30) | 정본 §3.4.2(CAN:1308 "SP4"). 하드코딩 목록의 `Phase`·`Task`·`Activity` 는 옛 단계 이름이라 프로젝트 단계 이름에서 와야 한다. `ExcelProfile`(`excel/profile.ts:4-24`)에는 머리 낱말이 없고 열 번호·팀 열만 있다. 공용 팀은 여러 프로젝트에 걸려 단계 이름이 하나로 정해지지 않는다 — 한계로 기록(§10) | 공용 팀도 그 워크스페이스 모든 프로젝트의 단계 이름을 본다 |
| D39 | **임포트 양식의 '담당' 열**(H1 이월 ②) — 감지기는 '담당' 계열 머리 열을 마크 방식 팀 열로 보지 않는다(그 열에 ●/△ 가 있으면 경고 "담당 열에는 팀 이름을 적으세요 — ●/△ 는 팀마다 열을 둘 때 씁니다"와 함께 팀 열 없음). 양식 예시 행의 담당 칸은 비우고 작성법 6행을 고친다. `template.test.ts` 에 팀 열 단언(`[[8,'*']]`)을 더한다 | 지금 양식을 그대로 감지하면 `teamColumns [[8,'담당']]` 이 되어 '담당' 이라는 팀이 생기고 예약어에 걸린다(실측 T §1.1). e2e 는 담당 칸에 팀 이름을 직접 써서 비켜 갔다 | 예시 행에 가상의 팀 이름을 적는다(지우지 않고 가져오면 그 팀이 생긴다) |
| D40 | **합성 게이트 구성** — C 구성에 `weekly` 를 더한다(`tests/fixtures/synthetic/configs.ts`·`scripts/lib/synthetic.mjs` 같은 커밋 — 개정 §6.5.8 표가 C 에 주간 영역 4개를 준다). **비평 반영 — Q40**: C 의 프로젝트 `modules.enabled` 와 워크스페이스 `modules.allowed` **둘 다**에 더한다(프로젝트 쪽만 더하면 S1 의 설정 저장이 허용 밖 모듈로 거부된다). S1 에 팀(R `RES`·`OPS`, C `CIV`·`MEP`·`SAF`)과 주간 영역(R 실험·데이터·운영, C 공정·안전·품질·자재)·담당 팀을 설정 화면과 같은 액션으로 더한다. S2 는 R·C 둘, S4(월)는 C, S10 대상은 §6.4 | E10. 지금 C 의 `modules.enabled`·`modules.allowed`(`configs.ts:37,41`, `synthetic.mjs:29`)에 `weekly` 가 없어 S4 "C 월요일 키"를 돌릴 수 없다 | S4(월)를 R 로 돌리고(SP4 는 모두 월요일 키) SP5 가 R 을 일요일로 바꿀 때 C 를 더한다 |
| D41 | Phase A 의 **화면 최소 수정**은 §5.1 의 목록만이다 — 데이터 계약이 바뀌어 깨지는 곳(주간 시트·주간 페이지·설정 페이지의 편집기와 Excel 표기·가져오기 마법사의 명령 id·등록 확인·사전 백업·내보내기 실패 매핑·WBS 단계 라벨 prop). 시각 패턴(SP3b)은 바꾸지 않는다. 화면 파일을 고친 커밋은 모두 `Preview-checked: local <일시> — <화면>` 또는 `n/a — <사유>`(SP3a §2.3). **비평 반영 — Q25**: 경계를 기계로 본다 — A1·A2 완료 조건에 `git diff --name-only $(git merge-base main HEAD)..HEAD -- src/app src/components` 가 §5.1 표의 파일과 비화면 파일(액션·라우트·`lib`)만 내고 UI 위험 파일 0 | R1. SP3b D47 의 금지는 "화면 이행"이고 이 목록은 기능 유지다(R26 과 같은 판단). 설정 페이지·주간 페이지는 `p/[projectId]/**/page.tsx` 라 몇 줄로 줄여 UI-2·UI-3 의 rebase 를 작게 한다. G2 훅은 `Preview-checked:` 트레일러만 있으면 통과시켜 경계를 넘어도 막지 못한다 — 넘으면 UI-2 가 셸 파일 전체를 rebase 한다(비평 범위 §3) | — |
| D42 | **전용 스택과 도구** — 레인 A 의 SP4 워크트리는 `/Users/jerry/D-Flow-wt/lane-a-sp4`, `supabase/config.toml` 의 `project_id = "d-flow-sp4"`·포트 545xx(SP3a C·D 스택 `d-flow-sp3a-c-visual` 을 내리고 같은 포트를 쓴다, skip-worktree, 커밋 안 함). A1 의 첫 과제로 `supabase/rehearsal/compare-catalog.mjs` 에 컨테이너 env(`SUPABASE_DB_CONTAINER`) 한 줄과 단위 테스트를 넣고, SP4 리허설 파일 머리 명령은 컨테이너를 변수로 쓴다. 모든 DB 명령은 `RLS_DATABASE_URL`·`LOCAL_DB_URL`·워크트리 `.env.local` 을 명시하고 `/Users/jerry/D-Flow-wt/heavy-lock.sh` 안에서 돈다 | 실측 G §7 — 하네스는 DSN 이 없으면 54322(사용자 DB)에 픽스처를 **커밋**하고, 리허설 도구·선례 머리 명령은 메인 스택 컨테이너 고정이다. 확정 전 번호를 사용자 DB 에 적용하면 번호 변경 뒤 `migration up` 이 파일을 건너뛴다(실측 G §6.3-3) | 기존 C·D 스택 워크트리를 그대로 쓴다(그 워크트리의 미커밋 수정이 섞인다) |
| D43 | **주간 읽기 계약** — `getWeeklySheet(projectId, weekStart)` 는 `{ report, rows }` 만 돌려준다(쓰기 0). 영역은 호출부가 `getProjectConfig(pid).areas.weekly_section` 으로 읽는다(같은 요청 캐시). `createWeeklyReport` 는 존재 확인에 `getWeeklySheet` 를 쓰지 않는다 — RPC 가 판정한다. 결과형은 `{ ok: true, reportId, status: 'created' \| 'exists' } \| { ok: false, code: 'CARRY_PENDING', pending, overflow } \| { ok: false, code, error, retryable? }` | 실측 W §2.7 — 멱등 확인이 백필을 부를 수 있었고 영역 조회가 늘면 실패 지점이 는다. 결과 유니온이라 매니페스트 `deny` 가 필요 없다 | — |
| D44 | **실시간** — `fromRecord` 는 `area_id` 로 행을 만든다. 화면이 모르는 `area_id` 의 INSERT(관리자가 영역을 더해 RPC 가 이번 주에 행을 넣은 경우)를 받으면 `router.refresh()` 로 영역 목록을 다시 받는다. `project_areas` 는 발행하지 않는다 | 실측 W §3.6 — 영역 개명·순서·추가는 새로고침 전까지 오지 않는다. 모르는 영역의 행은 라벨·순서가 없다 | `project_areas` 도 발행한다(발행 표 대조·롤백이 늘어난다) |
| D45 | **새 DB 토큰의 화면 코드** — 비평 반영 — Q14·Q40, **재검토 반영 — T6**: `mapDbError`·`dbToken`(`settings/errors.ts:72,105-114`)의 표는 **SP3a 규칙 그대로 둔다** — 정상 경로에서 나올 수 없는 토큰은 표에 넣지 않는다(표에 없으면 호출부가 원문을 로그하고 500 고정 문구 — 표시 = 로깅, `errors.ts:5-6`). 그래서 `WEEKLY_ISOLATION`·`IMPORT_RECEIPT_ISOLATION`·`TEAM_CONVERT_ISOLATION`(25001)과 `COMMAND_ID_REQUIRED`(22023)는 **로그 + 500 고정 문구**이고 `tests/settings/errors.test.ts`(`:82-88` 의 null 단언)는 고치지 않는다. 입력 토큰(`WEEKLY_INVALID_INPUT`·`WEEKLY_SEED_INVALID`·`AREA_INVALID_INPUT`·`IMPORT_INVALID_INPUT`·`TEAM_CONVERT_INVALID_INPUT`, 22023)도 같은 이유로 로그 + 500 이다 — 호출부가 RPC 앞에서 같은 것을 먼저 검증한다(라우트 #1~#4, 주간 액션의 입력 확인·`carryOverRows`, 영역 액션의 `validateArea` — `areas.ts:20-40` 이 종류·code·이름·순서·팀 구분·팀 중복을 본다). 기존 표를 그대로 쓰는 것: `WEEKLY_AREAS_REQUIRED`(23514) → `CONFIG_REQUIRED` 409(`errors.ts:103`), `COMMAND_REUSED`(23505) → `CONFIG_INVALID` 422(`:104`), `40P01`(교착) → `CONFIG_BUSY` 503 재시도 가능(`:111`). SP4 의 새 정상 경로 토큰은 **호출부 자기 매핑**이다 — 가져오기 라우트: `PROJECT_NOT_FOUND`(P0002) → 404, `COMMAND_REUSED` → 422(기존 표와 같은 상태), `IMPORT_FORBIDDEN`·`TEAM_CONVERT_FORBIDDEN`(42501) → 403, `55P03`(잠금 대기 상한 — §3.1) → 503 재시도 가능. 주간·영역 액션: `WEEKLY_FORBIDDEN`·`AREA_FORBIDDEN`(42501) → 403, `PROJECT_NOT_FOUND`·`AREA_NOT_FOUND`(P0002) → 404, `PROJECT_AREA_KIND_IMMUTABLE`·`PROJECT_AREA_CODE_IMMUTABLE`·`PROJECT_AREA_PROJECT_IMMUTABLE`·`AREA_TEAM_SCOPE`(23514)·영역 code 중복(23505) → 400 고정 문구(code 불변은 지금 액션 사전검사와 같은 문구 `ERR_AREA_CODE_IMMUTABLE`), `55P03` → 503 재시도 가능. 표에도 호출부 매핑에도 없는 오류는 로그 + 일반 문구(D21) | 에러 3원칙 — 원문을 응답에 싣지 않는다. SP3a 의 표는 "정상 경로에서 나올 수 없는 토큰은 없다"가 규칙이고 그 테스트가 고정한다 — 25001 은 PostgREST 기본(read committed)에서 나지 않아 나면 설정 결함이라 재시도해도 같고, `COMMAND_ID_REQUIRED` 는 라우트가 #1 에서 먼저 400 으로 거르고 `p_actor` 는 가드 결과라 RPC 에서 나면 결함이다(재검토 A F-4). 400·404 는 `MappedDbError` 의 코드(`ConfigCode \| 'ERR_DENIED'`)·상태 표에 없어 표에 넣을 수 없다 — 그래서 호출부가 자기 매핑으로 낸다. 슈퍼유저는 없는 pid 로도 가드를 통과하므로(`route.ts:134` 주석) `PROJECT_NOT_FOUND` 가 500 이 되지 않게 한다(비평 실행 §4). 55P03 은 잠금을 쥔 쪽이 끝나면 풀리므로 재시도할 만하다(A F-7) | — |
| D46 | `project_areas_guard` 트리거에 **kind 불변**을 더한다(`23514 PROJECT_AREA_KIND_IMMUTABLE`). **비평 반영 — Q11**: 같은 자리에 **`project_id` 불변**(`23514 PROJECT_AREA_PROJECT_IMMUTABLE`)도 더한다 | 3열 FK 는 행이 달린 영역의 kind 만 묶는다 — 행이 없는 영역은 주간 ↔ 이슈로 바뀔 수 있다(실측 W §1.3). 세션 길을 닫아도 service_role 직접 쓰기가 남는다. 행이 없는 영역은 복합 FK 가 묶지 않아 service_role 로 다른 프로젝트로 옮길 수 있고, 그러면 `area_teams` 가 프로젝트를 가로지른다 — 선례는 `project_members_guard` 의 `PROJECT_MEMBER_PROJECT_IMMUTABLE`(`0011:398-401`, 비평 보안 §1) | RPC 의 검사만 둔다 |
| D47 | **옛 이름 정리(H1 이월 ①) 범위 = 주간 구분명.** SP4 가 다시 쓰는 주간·WBS·Excel 테스트는 합성 영역·팀 이름(R·C)과 공용 픽스처를 쓴다. 팀 코드(ERP·MES 등) 리터럴의 일괄 치환은 하지 않는다 — 라우터·골든 등 주간 밖 테스트에 넓게 박혀 있다. 11구분명·5팀 코드의 센티널 **목록**의 유일한 사본은 `tests/fixtures/legacy-sentinels.ts` 다(부정 테스트·센티널이 import). 같은 낱말이 일반어·다른 뜻(회의록 폴더 이름·이슈 대분류·에이전트 항목·가드 정규식 등)으로 테스트에 남는 것은 범위 밖이다 — 완료 조건의 grep 은 SP4 가 다시 쓴 테스트로 묶는다(§4.8 — **재검토 반영 — T3**). 비평 반영(충실도 F-20): 정본 옛 블록 2938 의 "팀 코드 리터럴 중 WBS·주간 계열 fixture 공용화"는 SP4 가 다시 쓰는 테스트로 좁히고, 다시 쓰지 않는 WBS·주간 계열과 라우터·골든은 SP8 로 넘긴다(§9) | 실측 W §7.7 — `weeklyLint.test.ts` 하나에 174회. 팀 코드까지 넓히면 라우터의 코드 추출 기대값이 함께 바뀐다(실측 W §7.9) | 팀 코드도 합성으로 일괄 치환(SP8 의 봇 테스트와 겹친다) |
| D48 | **Excel 표기**(개정 §4.6 UI 표기)는 A2 — 설정 화면 내보내기 버튼 옆에 "표준 양식(프로젝트 팀·단계로 생성)" 또는 "저장된 양식(임포트 마법사, YYYY-MM-DD)". 날짜는 `project_settings_history` 의 그 키 최신 `changed_at`(새 읽기 함수 `latestKeyChange` — 허용 파일 `src/lib/settings/history.ts`). 내보내기 응답에 `X-Excel-Layout: standard\|saved` | 409 가 사라지고 표준 양식이 조용히 대신 나가지 않게 한다("조용한 대체가 아니다"). 설정 페이지는 A1 이 이미 만진다 | B 로 미룬다(그동안 표기 없이 표준이 나간다) |
| D49 | **비평 반영 — Q2·Q3·Q38. main 반영과 레인 B 창**(§2.1.1) — ① 체크포인트 = 검증 묶음 통과 + 로컬 태그(`sp4-a1-done`·`sp4-a2-done`·`sp4-done`), main 반영(ff·push)은 사람 확인 때 ② 확인을 기다리는 동안 다음 Phase 는 직전 체크포인트 HEAD 위에 쌓는다 ③ 레인 B 창은 실제 main 반영 직후 열린다 ④ 레인 A 에 열린 Phase 브랜치가 없는 동안 창은 열려 있다 ⑤ 창은 머지 준비가 끝난 레인 B 산출물만 받고, 사람 게이트가 남은 단계(UI-1 눈확인)는 다음 창으로 넘긴다 — 레인 A 는 그 게이트를 기다리지 않는다 ⑥ A2 → B 대기 동안 레인 A 는 SP5 스펙·계획(브랜치 없음)을 한다. 그보다 길면 SP5 Phase A 구현을 당기고, 그때 UI-2a·2b 는 SP3b D46 의 대안(창 밖 머지 — 레인 A 가 rebase 를 받아들인다)으로 넣는다. SP5-A 는 자기 전용 스택을 쓰고(`d-flow-sp4` 를 같이 쓰면 B 의 E2E·합성과 `db:reset` 이 엇갈린다), B 게이트가 열리면 SP5-A 는 진행 중인 과제의 커밋에서 멈추고 SP4 B 를 먼저 끝낸다 — SP5-A 브랜치는 B 반영 뒤 main 위로 rebase 한다(재검토 반영 — B P3-6) ⑦ SP4 A1·A2 는 UI-2 를 기다리지 않는다(§1.1 SP3b D46·D47 행). **재검토 반영 — T10**: ②·③ 은 SP3b D46·알림 7("레인 A 는 다음 Phase 브랜치를 창이 닫힌 뒤의 main 에서 자른다")과 다르다 — 사람 확인을 기다리는 동안은 직전 체크포인트 위에 쌓고, 창이 열리면 그 브랜치를 창이 닫힌 뒤의 main 위로 rebase 한다. rebase 비용은 레인 A 가 지고 레인 B 의 창 규칙은 그대로다 | SP3a 는 같은 구조에서 B·C·D 가 main 에 한 번에 들어갔다 — 태그 `sp3a-a-done`(09-29) 다음 main 반영은 `sp3a-done`(10-01) 하나뿐이라 SP3b D46 의 창 ①·② 는 열린 적이 없다(`.superpowers/sp3a/progress.md:60,62`, 비평 범위 §2). 사용자는 자리를 비우는 일이 많다(memory `dflow-spec-preapproval`) — 확인 대기를 Phase 막힘으로 두지 않는다. 체크포인트 증거는 쌓인 상태에서도 유효하다(main 반영은 ff). B 게이트(UI-2 머지)가 창을, 창이 레인 A 체크포인트를 기다리는 순환은 ④ 가 끊는다(비평 실행 §8). SP5 Phase A 브랜치가 열리면 다음 창은 SP5-A 체크포인트까지 없어 UI-2·SP4 B 가 함께 밀린다(비평 범위 §2) | 초안 — 체크포인트마다 main 반영, 창은 그 직후, 확인 대기 중 다음 브랜치 없음(사람 확인이 늦으면 두 레인이 함께 멈춘다) |
| D50 | **비평 반영 — Q6. replace 사전 백업** — 마법사는 replace 를 보내기 **전에** 읽기 액션 `getWbsBackup(projectId)`(`src/app/actions/importBackup.ts` — `requireProjectAdmin`, ~~`fetchAllPages`~~ id 키셋 `fetchAllByKeyset` 으로 끝까지 — **정오표(A1 — K2)**)로 지금 트리를 받아 지금과 같은 JSON 백업 파일(`downloadBackup` 꼴)로 내려받게 한 뒤 실행한다. 내려받기를 시작하기 전에는 실행 버튼이 잠기고(브라우저는 내려받기 완료를 알리지 않는다 — 기준은 내려받기를 시작한 클릭이다, 재검토 반영 — B P3-5), 읽기에 실패하면 실행하지 않는다(에러 3원칙 ②). 라우트의 백업 응답(§4.4 #7)은 그대로 두고 응답에 오면 지금처럼 내려받는다(실행 직전 시점이라 사전 백업과 다를 수 있다 — 둘 다 남긴다) | replace 의 백업은 응답 본문에만 실린다(`route.ts:155-166,214`). 같은 명령 id 재전송이 일어나는 경우가 바로 응답 유실이고 그때 `duplicate` 응답에는 백업이 없다 — `replace_wbs` 가 지운 원본이 어디에도 남지 않는다. 지금보다 나빠지지는 않지만(지금은 재시도가 이미 교체된 트리를 백업한다) 남은 데이터 보존 구멍이다(비평 범위 §5). 사용자 원칙 "조회 실패를 데이터 없음으로 위장하지 않는다"와 같은 결이다. ≈0.1주 | 하지 않는다 — K9 를 고쳐 적고 거처를 SPU1 로(초안) |
| D51 | **비평 반영 — Q12. `p_actor` 의 출처** — `p_actor` 를 받는 RPC(주간 둘·가져오기·전환, 0012 의 것)를 부르는 곳은 가드 결과의 `actor.userId`(`require*` 반환)를 넘긴다 — 폼·인자·본문 값을 쓰지 않는다(라이브러리 도우미는 아래 (c)). 정적 불변식 `tests/invariants/rpc-actor-source.test.ts` 가 `src` 의 `.rpc('<p_actor 함수>', { … })` 호출에서 `p_actor` 값의 출처를 AST 로 보고, 대상 목록을 마이그레이션 원문의 `p_actor` 함수 이름과 양방향으로 대조한다. **재검토 반영 — T7(판정 규칙)**: 대상 = 마이그레이션에서 인자 이름이 정확히 `p_actor` 인 함수(`p_actor_id`·`p_actor_name` 류 — 회의록 RPC — 는 범위 밖). 판정 — (a) **직접**: `p_actor` 식이 같은 함수 안 가드 결과(`require*` 반환)의 `.actor.userId` (b) **간접**: 같은 파일 함수의 매개변수·지역 객체 필드면 **한 단계** 추적해 그 값의 출처가 모두 (a) (c) 그 밖은 **닫힌 허용 목록**(`파일#함수`·사유, 죽은 항목 검사) — 세션 가드가 아닌 행위자(에이전트 토큰·내부 경로)도 받는 라이브러리 도우미와 두 단계 전달. **첫날 초록**이어야 한다 — main `81deae9` 의 `p_actor` 호출 9곳(`grep -rn "p_actor:" src`) 실측: (a) `actions/project.ts:198`·`actions/accounts.ts:332`·`:366` (b) `actions/roster.ts:88`(`callUpsert` 의 `actorId` ← `:123` 의 `g.actor.userId`)·`actions/accounts.ts:203`(`createOne` 의 `grantedBy` ← `:232`·`:261` 의 `g.actor.userId`) (c) `actions/settings.ts:259`·`:283`(어댑터 `rpc` 의 `x.actor` ← `runCommand` 의 `actor.userId` `:180` ← `:301`·`:309` 의 `g.actor` — 두 단계, 사유 "설정 명령 어댑터"), `lib/settings/write.ts:61`(`writeProjectSettingsInternal` 의 `actorUserId` — 호출처 가져오기 라우트 `:189` 와 에이전트 `lib/agent/wbsImport.ts:231`), `lib/agent/workflowEvent.ts:65`(`applyWorkflowEvent` 의 `args.actorUserId` — 호출처 세션 액션과 에이전트 토큰 라우트 `api/v1/agent/work/[id]/{claim,release,report}`·`lib/agent/delegation.ts:129,175`). SP4 의 새 호출 넷(주간 둘·가져오기·전환)은 모두 (a) 다 — 다른 파일의 도우미로 감싸면 (c) 에 사유와 함께 더해야 초록이다 | DEFINER RPC 는 `p_actor` 를 행위자로 그대로 믿고 그 안에서 `auth.uid()` 는 null 이다. 기존 호출은 (a)·(b)·(c) 로 갈린다 — 글자 그대로 "가드 결과만"이면 9곳 가운데 6곳이 첫날 빨갛고, 도우미 둘은 세션 가드가 아닌 행위자를 정당하게 받는다(재검토 A F-15). DB 쪽 불변식(`schema-invariants.test.ts:211-220`)은 세션 실행권만 보고 코드의 출처는 보지 않는다(비평 보안 §1) | 리뷰 체크리스트로만 둔다 |
| D52 | **비평 반영 — Q8·Q17. B 의 화면 범위** — 남기는 것: 팀 개명 입력(#15 팀 관리·설정 '팀' 절), #15 의 팀 색 칩(팀 슬롯 색), #23 실행 ID·영수증 링크·중복 안내, #25 주간(기간 선택·채움형·상태 문구·이월 매핑 창·12px/uppercase 제거, 그리고 주간 4파일 `SheetCell.tsx`·`WeeklyAiRewriteModal.tsx`·`WeeklyLintPanel.tsx`·`WeeklySheetView.tsx` 의 하드코딩 색을 토큰으로 바꾸고 `tests/css/no-raw-color.test.ts` 의 `ALLOW` 네 줄을 지운다), WBS 의 가중치 미지정 표시, WBS·칸반 토스트 사전 매핑. SPU3 로 넘기는 것: #19 개요 위젯·#30 명단의 패턴 이행, #15 의 `PageHeader`·상태 계약·12px/uppercase, A1 이 다시 붙인 `ProjectAreasManager` 의 SP3b 패턴(W43 일부). `src/lib/domain/projectColors.ts`(프로젝트 점 색)는 SP5(회의 화면)로 `[사용자 확인 §8 #5]` | 개정 SP4 블록 목표 ④ 와 §6.1-4("SP4 가 만지는 화면은 SP3b 패턴으로 끝낸다", W43)를 고치는 일이라 사용자 확인으로 올린다(E33). 남기는 것은 블록·개정 문면의 기능이고(실행 ID·개명·가중치·토스트) #25 는 SP4 가 데이터 계약을 바꾸는 핵심 화면이다. 넘기는 셋은 순수 패턴 이행이라 정확성과 무관하고, 개정 §5.9.4 끝 문단이 "표의 SP 에서 이행하지 못한 화면은 SPU3 가 맡는다"로 거처를 정해 두었다. 레인 B UI-1 의 허용 목록이 주간 4파일을 "SP4 화면 이행"으로, `projectColors.ts` 를 "SP4(팀·영역 색 이행)"로 넘겼다 — 뒤의 것은 팀·영역이 아니라 프로젝트 점 색이고 소비처가 포트폴리오(#12)·내 회의(#8)다(비평 범위 §4). 줄이는 노력 0.4~0.55주 | 그대로 SP4(#15·#19·#30·편집기 패턴까지 — +0.4~0.55주) |
| D53 | **비평 반영 — Q29. 레인 B UI-0 캡처 시드는 A1 이 고친다** — UI-0 은 SP4 A1 보다 먼저 main 에 든다(지금 머지 준비 중). 그래서 나중 쪽인 A1 이 `scripts/ui-capture.mjs` 의 주간 시드(주간 영역 `project_areas`(weekly_section)를 더하고, 행에 `area_id`·`project_id` 를 싣고 `section`·`module`·`sort_order` 를 뺀다)를 같은 브랜치에서 고치고, 그 테스트(`tests/scripts/ui-capture.test.ts`)가 주간 행을 단언하면 함께 고친다(2026-10-01 레인 B 머리에는 주간 단언이 없다). 레인 B 의 다른 스크립트(`perf-grid.mjs`·`perf-baseline.mjs` — 그 `sort_order` 는 WBS·팀 열이다)와 main 의 `scripts/**` 는 지울 열을 쓰지 않는다(2026-10-01 grep). 줄 번호가 아니라 심볼로 적는다 — 레인 B 가 계속 고치는 파일이라 줄 인용은 금방 낡는다(재검토 반영 — A F-11) | 시드 계획의 `weeklyRows` 가 주간 행을 `section`·`module`·`sort_order` 로 만들고 `insertOnce('weekly_report_rows', …)` 가 service_role 로 upsert 한다 — A1 뒤에는 PGRST204·NOT NULL 로 멈춘다(비평 실행 §8). UI-1 대조는 (그 브랜치의 merge-base, 브랜치 머리) 쌍을 같은 트리에서 새로 찍으므로(SP3b D48) 기준이 A1 위에서 다시 찍혀 SP4 몫의 차이가 섞이지 않는다 | UI-0 이 A1 뒤에 들어오면 레인 B 가 그 rebase 에서 고친다 |
| D54 | **비평 반영 — Q16. 상속 공용 팀 전환 RPC** `public.convert_inherited_teams(p_actor uuid, p_project_id uuid) returns jsonb`(`NNNN_command_receipts` ⑤, §3.3) — service_role 만 실행. 한 트랜잭션에서: 전제(그 프로젝트의 전용 팀 0개)가 깨져 있으면 아무것도 하지 않고 `{status:'already'}`. 아니면 상속 중인 공용 팀 — 그 워크스페이스의 활성 공용 팀 + 그 프로젝트의 `item_owners`·`project_member_teams`·`area_teams`·수락 전 초대(`project_invites.team_ids`)가 가리키는 비활성 공용 팀 — 을 code·이름·색·순서·`progress_visible`·활성 그대로 전용 팀으로 복사하고, 그 프로젝트 안의 네 참조를 새 id 로 옮긴다 → `{status:'converted', teams, moved}`. 가져오기(409 확인 뒤)와 `copyGlobalTeams` 가 모두 이 RPC 를 쓴다(`copyGlobalTeams` 의 연결은 B — **재검토 반영 — T14**). 카탈로그 불변식 — `public.teams` 를 참조하는 FK 열 ∪ 팀 id 배열 열(`team_ids uuid[]`) = RPC 가 옮기는 열. 열 **이름**에 기대는 검사라 FK 없는 단일 uuid 열·이름이 다른 uuid[] 열·jsonb 안의 팀 id 는 보지 못한다(§3.5 — **재검토 반영 — T8**). **A1 반영(A1-3 리뷰 M1·A1-4 리뷰 P1 — 좁힌 규칙)**: 전환의 "그 프로젝트 안 공용 팀 참조 0" 은 커밋하는 순간에만 맞는다 — 같은 잠금을 잡지 않는 쓰기(영역·명단 RPC·세션 RLS 쓰기·초대 발급)가 공용 팀 id 를 다시 붙일 수 있었다. 그래서 `NNNN_command_receipts` ⑤′ 의 트리거 넷(`item_owners`·`project_member_teams`·`area_teams`·`project_invites`)이 **그 프로젝트에 같은 code 의 전용 팀(비활성 포함)이 있는 공용 팀**을 가리키는 **새로 생기는** 참조를 23514 `TEAM_SCOPE_PROJECT_OWNED` 로 거부한다(동시 실행 창은 트리거의 프로젝트 행 `for key share` ↔ 전환의 `for update`). "전용 팀이 하나라도 있으면 모든 공용 팀 거부"로 넓히지 않은 이유 — 전용 팀과 다른 code 의 공용 팀을 함께 쓰는 프로젝트를 DB 가 지금 허용하고 무수정 불변식(`workspace-isolation-cases` ⓚ)이 그 계약을 고정한다. 분열(D4)은 같은 code·다른 id 이고 전환은 쓰이는 공용 팀을 전부 같은 code 로 복사하므로 전환 뒤 공용 참조는 모두 이 규칙에 걸린다. 이미 있는 참조의 재저장(on conflict·팀 열 그대로인 UPDATE·초대의 옛 `team_ids`)은 통과한다 — 막으면 갈라진 프로젝트의 명단 권한 회수·비활성화가 막혀 권한이 남는다. 한계: 전용 팀을 만드는 팀 추가 액션은 이 잠금을 잡지 않는다(전환의 전제 판독과 엇갈리면 23505) | 복사만 하면 같은 code·다른 id 로 갈라져 담당 팀 멤버의 실적 편집이 서버에서 거부된다(D4). 수락 전 초대도 팀 id 배열을 들고 있다가(`0003_org_core.sql:185`, FK 없음) 수락 때 그 id 로 명단 팀을 만든다(`consume_project_invite` — `0008_workspace_settings.sql:128-`) — 옮기지 않으면 전환 뒤 분열이 다시 생긴다(이 문서가 Q16 의 "세 표"에 더한 범위). 파일은 가져오기 RPC 와 같은 `_command_receipts` — 도우미 `actor_is_project_admin`(`_weekly_areas`) 뒤에 와야 하고, 첫 소비처(가져오기 라우트)가 같으며, `_authz_carry` 는 권한 이월만 담는다(P18). 새 파일은 번호·리허설·rename 한 벌이 는다 | 복사만(초안) / 참조를 옮기지 않고 영역 편집기·명단이 목록 밖 공용 팀 배정을 '공용 팀(상속)' 표지로 보여 뺄 수 있게 한다(비평 충실도 F-9 의 대안) |

### 1.3 상위 문서 대비 정정(실측)

| # | 상위 문서의 말 | 실측(근거) | 이 문서의 처리 |
|---|---|---|---|
| E1 | 개정 §4.3.4 ① "주간행의 distinct `btrim(section)` 으로 영역" | `module` 이 버려지고 같은 구분·다른 모듈 행이 병합된다. 지금 PPT·점검·이월은 표준 구분이면 모듈을 합쳐 묶는다(`sectionKeyOf` — `domain/weeklySheet.ts:72-75`, 이월 `:130`) — 개정안은 표준 구분에서는 지금 PPT 와 같다. 빈 구분 행은 이름이 없다 | D29 — 비평 반영 — Q18: 라벨은 개정 그대로, 모듈은 칸 안 머리표 — `[모듈]` 단독 줄(T4) — 로 보존, 빈 구분은 모듈 또는 '기타' |
| E2 | 개정 §4.3.1 영역 FK `on delete restrict` — 프로젝트 삭제 캐스케이드와의 관계를 말하지 않는다 | 같은 결의 RESTRICT(팀)가 프로젝트 삭제를 막은 선례가 테스트 주석에 있다(`tests/rls/workspace-isolation-cases.test.ts:99-100`). 실측 W §1.3 의 "`no action`(문장 끝 검사)" 제안은 PostgreSQL 에서 효과가 없다 — 지연 없는 `no action` 과 `restrict` 는 같은 때 검사한다. 주간 행이 문서를 거쳐서만 프로젝트에 닿으면 프로젝트 삭제의 통과가 RI 트리거 이름(OID 문자열) 순서에 달린다(비평 실험 §3) | D23 — 비평 반영 — Q10: `restrict` 유지 + 주간 행의 `projects` 직접 FK(cascade). 순서를 테스트로 '고정'하지 않는다(테스트는 그 DB 의 OID 순서만 본다). 지연 없는 `no action` 이 `restrict` 와 같은 결과임은 실험으로 확인했다 |
| E3 | 개정 SP4 블록 `command_receipts` — PK `(command_id, actor, kind)`, 조회 키 `(command_id, actor, project_id, kind)`, `result jsonb`(nullable), 요약 열 없음 | 같은 id 를 다른 프로젝트에 쓰면 조회는 빈손인데 insert 가 PK 충돌이다. 같은 id·다른 내용이 조용히 옛 결과를 받는다(실측 T §2.3, G §2.7) | D5 |
| E4 | 개정 §4.3.1 SQL | 정책 문장이 없다. 정본 §2.4.6 은 "SP4 에서 직접 술어로 교체"(C-8) | D6·§3.2 ⑩ |
| E5 | 개정 §4.3.5 "`WEEKLY_SECTIONS`·`WEEKLY_TEAM_SECTIONS`·`FALLBACK_SECTION` 을 `tests/fixtures` 로 이동" | 주간 테스트를 합성 이름으로 바꾸면(D47) 매핑·폴백을 쓰는 테스트가 없다. 11구분명은 센티널이 쓴다 | 매핑·폴백은 지운다. 센티널 **목록**의 유일한 사본은 `tests/fixtures/legacy-sentinels.ts`(D8 — 같은 낱말의 일반어 쓰임은 범위 밖, 재검토 반영 — T3) |
| E6 | 정본 W3 `grep -nE 'team-(pmo\|dt\|erp\|mes\|mdm)' globals.css` 0건, 개정 "팀 토큰 15개 삭제" | 이미 0건 — SP0 이 `team-1..5` 로 바꿨다. UI-1 뒤에는 15선언이 아니라 `@theme inline` 별칭 10줄이다(SP3b D15, C-3) | D3·D13 — 가드는 `--color-team-` |
| E7 | 정본 §3.4.2 `shared.tsx` `TEAM`·`kanban.ts` `TEAM_DOT`·`MembersBoard.tsx` `TEAM_META` → `teams.color` | 셋 다 없다. 소비처는 `domain/teamColor.ts` 의 `teamStyle()` 하나(17곳/12파일), `MembersBoard.tsx` 는 SP1 이 지웠다(C-4) | D3 — `teamColor.ts` 이행 |
| E8 | 정본 "`teams.color` inline style", 개정 §5.5.4 "`hash(id) % 8`, 또는 `teams.color` 가 있으면 그 값" | `teams.color` 는 NOT NULL 라이트 hex 라 "있으면"이 늘 참이고 다크에서 대비 미달(C-5) | D3 |
| E9 | 개정 §6.5.8 S10 센티널에 11구분명 | 같은 표가 C 의 주간 영역으로 '품질'(11구분명 가운데 하나)을 준다 — 단어 금지로는 C 가 통과하지 못한다 | D8 — 등록 이름 제외 |
| E10 | 개정 §6.5.8 S4 "C 월요일 키" | 합성 C 구성의 프로젝트 `modules.enabled`·워크스페이스 `modules.allowed` 둘 다에 `weekly` 가 없다(`tests/fixtures/synthetic/configs.ts:37,41`) | D40 — 두 키 모두에 더한다 |
| E11 | 개정 §4.3.6·§4.8 의 부정 테스트 봇 부분(SP4) ↔ §6.8·SP8 범위 ③ | 같은 시험이 두 SP 에 있다(C-12) | D7 — SP8 |
| E12 | 개정 §2.8.2 "SP3a~SP4 사이 409 `CONFIG_REQUIRED`" | 실제 코드는 409 `PROFILE_REQUIRED`(`api/export/route.ts:13,62`) | SP4 가 그 409 를 없앤다(§4.3) |
| E13 | 개정 SP4 블록 "`route.ts:135` `rpc('import_wbs')`" | `:175`. `import_wbs`·`replace_wbs`(0009 정의)는 INVOKER·이름 비한정이라 `search_path ''` DEFINER 안에서 42P01 이다(실측 G §2.3) | D34 |
| E14 | 개정 §4.6 "`'{}'` 이면 표준 레이아웃" | 0012 뒤 `'{}'` 는 키를 만들지 않았다 — "키 미설정(default null)"이다(`0012_settings.sql:186-187`) | D16 |
| E15 | 개정 §4.6 "표준 ≡ 삭제 전 `buildWbsAoa`" | 프로파일 빌더는 깊은 트리를 거부하고 프로파일 밖 팀을 실적% 뒤에 붙인다 — 같은 입력으로는 동등이 아니다(실측 T §1.3) | D16 — 트리에서 계산한 팀 열 + 접기 선택지 |
| E16 | 개정 §1.4.3·SP4 블록·§4.3 의 줄 인용(`dashboard.ts:118-123`, `snapshots.ts:61,94`, `rollup.ts:17-19`, `trend.ts:100`, `weeklySheet.ts:123-128` 등) | H1 뒤 줄이 밀렸다(C-18, 실측 W §2.7) | 심볼로 적는다 |
| E17 | 정본 W1 "테스트 + 스테이징", W3 "스테이징 눈확인" | 원격이 없다(개정 §6.1-6) | 로컬 E2E·로컬 눈확인 트레일러(C-25) |
| E18 | 개정 §6.3 번호표 SP4 = `0013`·`0014` | SP3b D9 가 `0013_account_preferences`(머지 순서)를 받고 SP4 는 셋째 파일을 더한다 — SP3b D47 대로면 SP4 는 `0014`~`0016`(그 전제가 깨져 A1 이 먼저일 가능성이 크다 — E32) | D12 |
| E19 | 개정 SP4 블록 "의존: SP3b 와 파일이 나뉜다 … SP3b 가 먼저 머지되면 rebase" | SP3b D47 은 UI-2 먼저를 고정하고 레이아웃 팀 주입을 UI-2 뒤 과제로 둔다(C-11) | D1·D19 — 레이아웃·`TeamsProvider` 는 B |
| E20 | 정본 §3.4.2(CAN:1459) "`import/execute` 의 `requireSuperuser` 분기" | 분기는 SP2 가 `requireWorkspaceAdmin` 으로 바꿨고, 공용 팀 등록은 남았으며 화면은 아직 슈퍼유저 전용이다(C-7) | D4 |
| E21 | 개정 SP4 목표 ③ "가져오기 append 가 멱등" | replace 도 같은 라우트·같은 위험(응답 유실 재시도)이다 | D34 — append·replace 둘 다 같은 명령 경로 |
| E22 | 정본 SP4 "`import_wbs`/`replace_wbs` 팀 해석을 `(workspace, project)` 스코프로" | 0009 F3 이 이미 그 프로젝트의 워크스페이스 공용 팀으로 좁혔다(`0009_sp2_isolation_fixes.sql:167-172`, ⓚ) | 끝남 — 이름 한정(D34) 뒤에도 ⓚ 무수정 초록으로 회귀만 본다 |
| E23 | — | 주간 PPT 템플릿 `slide2.xml` 표 안에 예시 문구 '데이터 표준화'(11구분명 '표준화' 포함)가 있다 — 렌더러는 표 셀만 갈아 끼운다(`templateFill.ts:106`). 기본 갈래(`fillWeeklyTemplate`)도 같은 템플릿을 쓴다(`templateFill.ts:109,294`) | S10 이 출력 XML 을 보므로 계획 첫 주간 출력 과제에서 시트 갈래·기본 갈래 둘 다로 남는지 실측한다. 남으면 렌더러가 예시 칸을 비운다(템플릿 교체는 SP6) |
| E24 | 실측 C·SP3b 알림 12 의 무범위 조회 목록 | `getPendingApprovalCount` 는 결재 대기도 `limit(500)` 로 자른다(`data/agentApprovals.ts:51`) | D18 |
| E25 | 개정 §4.3.3 명시 매핑 "그 영역의 `this_*` 에 덧붙인다(현 append 규칙: trim, 20,000자 상한)" | 그 규칙은 상한에서 자른다(`domain/weeklySheet.ts:126` `merged.slice(0, WEEKLY_CELL_MAX)`). 판정 R22 가 잘림을 결함으로 보았다 | D31 — 넘치면 거부하고 다시 고르게 한다. 받는 쪽: 사용자 확인 §8 #9(비평 반영 — Q22) |
| E26 | 정본 §2.3.5 `project_areas`·`area_teams` RLS 쓰기 `is_project_admin`(CAN:472·483), 판정 R6 "읽기·쓰기 정책을 `project_id` 직접 술어로 바꾼다" | 행 생성이 RPC 한 길이 되면 세션 쓰기 정책은 RPC 를 우회하는 길이다 | D27 — 쓰기 정책을 교체하지 않고 지우고 권한을 회수한다(판정·정본과 다름). 받는 쪽: SP5 의 이슈 영역 편집도 `upsert_project_area`(§9)(비평 반영 — Q22) |
| E27 | 개정 §4.3.2 `create_weekly_report(p_project_id, p_week_start, p_seed jsonb)` — 행위자 인자 없음 | DEFINER 로 옮기면 RLS `weekly_reports_insert` 의 2차 방어선이 사라진다 | D28 — `p_actor` 를 받아 등급을 다시 판정(비평 반영 — Q22) |
| E28 | 개정 §4.3.3 "`create_weekly_report` 의 `p_seed` 행은 `custom` 을 그대로 넘기고 …", §3.6.7 "SP5c 가 고치는 것은 이 주입과 호출부(`actions/weekly.ts` 이월 경로)뿐이다" | SP4 에는 `custom` 열이 없어 시드 모양이 `area_id` + 네 칸이다 — SP5c 가 RPC 를 다시 만들어야 한다 | §4.1.1 — 시드에 싣지 않는다(개정과 다름). 받는 쪽: SP5c 블록에 "§3.6.7 '주입과 호출부뿐'의 예외 — `create_weekly_report` 를 다시 만들어 시드의 `custom` 을 통과시킨다"(§9)(비평 반영 — Q22) |
| E29 | 판정 R15 "CR-4 … 해당 없음 — 이월 유지(SP3a 롤백 설계의 몫)로 기록한다" | 초안은 롤백 머리에 '해당 없음'만 적고 CR-4 가 남는 곳을 적지 않았다(C-17) | D15 — §9 에 받는 곳 행(비평 반영 — Q22) |
| E30 | 정본 §3.4.2(CAN:1308) "예약어는 `wbs.excel_profile` 헤더·`core.level_labels`·`core.extra_axis_label` 에서 파생 — SP4" | `ExcelProfile`(`excel/profile.ts:4-24`)에는 머리 낱말이 없고 열 번호·팀 열만 있다 | D38 — 빌더·감지기의 머리 낱말(`EXCEL_HEADER_WORDS`)로 읽는다 |
| E31 | 정본@31878b1:1982(개정 §4.3.1·§4.3.5 가 인용) `sections[]` "활성 구분 전부(내용 없는 구분 포함, `sort_order` 순)" | 영역 기준이면 문서 뒤에 추가·재활성된 영역의 빈 페이지가 과거 주차 PPT 에 생긴다 | D32 — 그 문서에 행이 있는 영역만(W17) |
| E32 | SP3b D47 첫 문장 "`sp3a-done` 뒤 main 에 가장 먼저 들어가는 것은 UI-2(창 ③)" | 그 전제(`sp3a-done` 때 UI-2 준비)가 깨졌다 — 레인 B 는 UI-0 마무리 중이다. 같은 문서 `:150`·알림 9 는 SP4 A 가 먼저 들어갈 수 있다고 읽힌다 | D49 — SP4 A1·A2 는 UI-2 를 기다리지 않는다. UI-2 가 SP4 위로 rebase 하고 번호를 민다(비평 반영 — Q38) |
| E33 | 개정 SP4 블록 목표 ④ "주간·WBS 화면 SP3b 패턴", §6.1-4(W43) "SP4 가 만지는 화면은 SP3b 패턴으로 끝낸다", §5.9.4 의 SP4 몫(#15·#19·#23·#25·#30) | 순수 패턴 이행(#15 의 머리·상태·글자, #19, #30)과 A1 이 붙인 영역 편집기의 패턴은 정확성과 무관하다. §5.9.4 끝 문단이 SPU3 를 거처로 둔다 | D52 — SPU3 로 넘긴다(목표 ④ 를 고친다). 받는 쪽: 사용자 확인 §8 #5, §9(비평 반영 — Q8) |

### 1.4 범위 표(R11)

| 항목 | 출처 | 처리 | 절 |
|---|---|---|---|
| 주간 행 `project_id`·`area_id`·`area_kind`, 복합 FK, 단일 FK drop, 유일 `(report, area)`, 구조 열 drop, 정책 직접 술어, 이관·리허설 | 개정 §4.3.1·§4.3.4, 정본 §2.4.6 | A1 | §3.2 |
| 읽기 경로 쓰기 제거, 문서 생성·영역 추가 RPC, 이월 계약(대기·매핑·넘침), 소비처(시트·점검·PPT·API·봇 어댑터·AI 색인·다시 쓰기·실시간) | 개정 §4.3.2~§4.3.5, R22 | A1 | §4.1 |
| 주간 구분 편집기 장착, 구분 0개 배너·생성 거부, 빈 시트 문구(`WeeklySheetView.tsx:603` — 옛 구분 리터럴 삭제)·`:664` 주석 | R26, 개정 SP4 블록, D6-§4-weekly | A1(기능)·B(#25 패턴)·SPU3(편집기 패턴 — D52) | §4.1.8·§5 |
| "양식 통일·멀티셀 편집/프레즌스(`rowId` 키 확인)" | `정본@31878b1:2935` | A1 — 행 id 를 보존하므로 셀 주소(`rowId:col`)·프레즌스는 그대로다. 회귀 테스트만 — `tests/components/weekly-presence.test.tsx`·`tests/domain/{sheetPresence,sheetSelection}.test.ts`(행 픽스처만 `areaId` 로) | §6.1 |
| 봇 주간 팀 필터 `area_teams`, 비교 키 `areaId` | 개정 §4.8, R24 | A1 | §4.1.5 |
| `command_receipts`·가져오기 멱등·영수증 읽기 액션 | 개정 SP4 블록, R5·R17 | A1(서버)·B(링크 화면 #23) | §3.3·§4.4 |
| 미등록 팀은 늘 프로젝트 전용 팀 + 상속 공용 팀 전환 RPC(D54 — `copyGlobalTeams` 도) | 정본 CAN:1459, R4, Q16 | A1(전환 RPC·가져오기 경로)·B(`copyGlobalTeams` 연결 — 재검토 반영 T14) | §3.3·§4.4·§5.2 |
| replace 사전 백업(D50) | 비평 범위 §5, Q6 | A1 | §4.4 |
| `p_actor` 출처 불변식(D51) | 비평 보안 §1, Q12 | A1 | §3.1 |
| 레인 B UI-0 캡처 시드의 주간 행 모양(D53) | 비평 실행 §8, Q29 | A1 | §2.4 |
| `import_wbs`/`replace_wbs` 팀 해석 스코프 | `정본@31878b1:2937` | 끝남(E22) — 회귀 | §3.3 |
| 레인 A 이월 셋(CR-1·`people.email`·CR-6) | SP3b 알림 3, R2 | A1 | §3.4 |
| 팀 캐시 폐기 — 비화면 소비처 | 개정 §2.5·R10, R19 | A1(가져오기 라우트·설정 페이지)·A2(나머지) | §4.2 |
| 팀 캐시 폐기 — 레이아웃(`w/[slug]`·`p/[projectId]`)·명단·`DashboardView`·`TeamsProvider`·`master.ts` 삭제 | 정본 §3.2.5 끝 문단, SP3b D47·§5.4.1·알림 4, Q23 | B | §5.2 |
| 봇 팀 원천 교체·이름 매칭(code ∪ name) | 개정 §4.8 | A2 | §4.2.2 |
| 팀 개명(`name` 편집) | 개정 §4.7·§4.8 | A2(액션)·B(개명 입력) | §4.2.3 |
| `RESERVED_TEAM_NAMES` 파생 | 정본 CAN:1308 | A2 | §4.2.4 |
| 팀 색 `category-*`(대시보드 팀별 진척·간트·칸반·회의록 팀 막대 — `teamStyle` 소비처, 팀 관리 #15 의 칩. 명단 칩은 #30 과 함께 SPU3 — D52) | 개정 §5.12.5·§6.5.4, R3 | B | §5.2 |
| Excel 표준 레이아웃·경로 하나·fixture·교차 검증·표기 | 개정 §4.6, R16 | A2 | §4.3 |
| `DEFAULT_LEVEL_LABELS`·`LEGACY_LABEL_ABBR` 삭제, `levelLabels` prop 필수 | 정본 §3.4.2, SP3a E33 | A2 | §4.8 |
| 임포트 양식 '담당' 열(H1 이월 ②) | 개정 SP4 블록 | A2 | §4.3 |
| 진척 null 가중치 | 개정 §1.4.3, R20 | A2(도메인)·B("가중치 미지정 N개" 표시) | §4.5 |
| 무범위 조회 | SP3b 알림 12, R10·R18, Q5 | A1(데이터 손실 경로 — replace 백업, `getComputedWbs` 의 `item_owners`·`wbs_items`)·A2(나머지) | §4.6 |
| DB 오류 원문 | 개정 SP4 블록 H2 이월, R21, Q20 | A1(가져오기·주간 액션 파일 전부·영역 액션)·A2(`wbs.ts`·팀 액션)·B(WBS 토스트 사전 매핑) | §4.7 |
| 상수 제거·회귀 가드·`no-runtime-constants` 허용 목록 | 개정 SP4 블록, R13 | A1(주간)·A2(Excel·단계·예약어)·B(팀 색) | §4.8 |
| 테스트 옛 구분 이름 → 합성(H1 이월 ①), 팀 코드 리터럴 fixture 공용화(WBS·주간 계열 — SP4 가 다시 쓰는 테스트만, 나머지는 §9), `WbsRow.owners` 계약 불변 | 개정 SP4 블록, `정본@31878b1:2938` | A1(주간)·A2(WBS·Excel) | §4.8 |
| CR-7 잔여(골격 시드의 `validateProjectConfig`) | CARRY-A 14, R15 | A2 | §4.3 |
| `revalidatePath('/p/${…}', 'layout')` 형식 정정 — SP4 가 만지는 액션 파일의 줄 | SP3b 반영 지시 22, Q28 | A1·A2·B(`project.ts` 5줄) | §4.7 |
| 카탈로그 `wbs.excel_profile` 소비처·상태(`verified`), 제품 고정 절의 진척 집계 행 | 개정 §2.11 SP4 행·§6.1-3 | A2 | §4.3 |
| 합성 S2·S4(월)·S10 부분·경계 행렬 SP4 행, S1 의 팀·영역 | 개정 §6.5.8, R8, Q19·Q21 | A1(S1 추가·S2·S4)·A2(S10·경계 행렬) | §6.4 |
| 화면 이행 — #23 임포트 결과·#25 주간(채움형·색 토큰), 팀 개명 입력·팀 색 칩, 그 화면의 12px 미만·uppercase 제거 | 개정 §5.9.4, SP3b D14·D19·§11, 레인 B UI-1 `no-raw-color` 허용 목록, Q8·Q17 | B(D52) | §5.2 |
| 화면 이행 — #15 의 `PageHeader`·상태 계약·12px/uppercase, #19 개요 위젯, #30 명단, 영역 편집기 패턴 | 개정 §5.9.4·§6.1-4(W43 일부) | SPU3(D52·E33 — 사용자 확인 §8 #5) | §9 |
| 끝난 것 — `LEGACY_SECTION_MAP`·`DEFAULT_TEAMS`·`TEAM_COLOR`·`LEGACY_ORIGIN_PROFILE`(C-1), `'골격(PMO)'`(C-6), 읽기 원천(C-14·C-15), `ensureAreaRows` 안(C-16), `DEFAULT_PROJECT_CONFIG`(C-34) | 실측 C §7 | 범위 밖 — 회귀 가드만(D13) | §4.8 |

## 2. Phase 구성

### 2.1 Phase 표

| 체크포인트 | 목표 | 의존(게이트) | 노력(추정, 노력 단위 — 작업 + 체크포인트 고정 비용) | 브랜치 | 체크포인트 조건(main 배포 가능) |
|---|---|---|---|---|---|
| **A1** — 주간 영역·가져오기 멱등·이월 셋 | 마이그레이션 셋이 들어가고, 주간보고가 영역 id 로 돈다(읽기 무부작용·RPC 생성·이월 대기/매핑·점검·PPT·봇 필터·AI 색인). 편집기로 영역을 만든다. 가져오기는 같은 명령 id 2회 = 1벌이고 미등록 팀은 전용 팀이 된다(상속 공용 팀은 전환 — D54). replace 전에 백업을 받는다(D50). 데이터 손실 경로의 잘린 읽기가 없다(D18) | `sp3a-done` + 레인 B UI-0 의 main 반영(D53), 이 스펙 | 2.0~2.7 + 0.2~0.3주 | `sp4/phase-a1` | 공통 묶음 + 리허설 셋(§3.6) + CI 등가 1회 + 로컬 E2E 의 A1 새 단계(§6.3) + 합성 S1 추가분·S2·S4(월) + 눈확인 A1 행 + 로컬 태그 `sp4-a1-done` |
| **A2** — 팀 원천·Excel·집계·정확성 | 비화면 소비처의 팀 원천이 요청 범위 하나다(봇 이름 매칭·개명 액션·예약어 파생). Excel 이 한 경로·표준 레이아웃이다. null 가중치 규칙이 하나다. 잘린 배열이 데이터로 위장되지 않는다. DB 원문이 응답에 없다. SP4 의 런타임 상수가 0 이다 | A1 체크포인트(main 반영 전이면 그 HEAD 위에 쌓는다 — D49) | 1.4~1.95 + 0.2~0.3주 | `sp4/phase-a2` | 공통 묶음 + 로컬 E2E 전체를 `next start` 로(D19) + 합성 S10 부분·경계 행렬 SP4 행 + 성능 기록(§6.5) + 눈확인 A2 행 + 로컬 태그 `sp4-a2-done` |
| **B** — 팀 색·화면·마감(비평 반영 — Q1) | 팀 색이 `category-N` 이다. `TeamsProvider`·두 레이아웃·명단·개요가 A 와 같은 팀 원천을 쓴다. `teams/master.ts` 가 없다. D52 의 화면(#23 실행 ID·영수증, #25 주간, 팀 개명 입력·팀 색 칩, 가중치 미지정, 토스트 사전)이 끝났다. '전역 팀 복사로 시작'도 전환 RPC 를 쓴다(T14). 합성·E2E 기록과 노력 실측이 있다 | A2 ∧ SP3b **UI-1·UI-2a·UI-2b 가 main 에 머지됨**(SP3b D47·R3). UI-3 은 기다리지 않는다(먼저 머지한 쪽이 기준 — 개정 §6.1-5) | 1.5~2.25 + 0.2~0.3주 | `ui/sp4-teams`(UI 위험 파일·트레일러) 위에 화면 브랜치 `ui/sp4-screens` 를 쌓아 한 번에 반영 | 공통 묶음 + 눈확인 B 행 한 번(라이트·다크) + `Preview-checked` 트레일러(W33) + 마감 묶음(§7) + 태그 `sp4-done` |

- **순차로 돈다: A1 → A2 → B(마감 포함).** 전용 스택이 하나라 `db:reset`·`test:rls`·리허설·E2E·성능을 동시에 돌리지 않는다(무거운 실행은 두 레인 공유 잠금 — SP3b 알림 10).
- **공통 묶음**(모든 체크포인트): 전용 스택에서 `db:reset` → `dev:bootstrap` → `settings:verify` → `test:rls`(건너뜀 0) → 다시 `db:reset` + `dev:bootstrap`(픽스처가 커밋되어 남는다) → **체크포인트 HEAD 를 담은 트리(SP4 워크트리 — D42)에서** `test`(`--maxWorkers=4`)·`lint`·`typecheck`, 기록에 그 HEAD 해시(**재검토 반영 — T15**: SP3a 는 Phase 브랜치를 메인 체크아웃에 두어 "메인 체크아웃"이 맞았지만, SP4 의 메인 체크아웃 `/Users/jerry/D-Flow` 는 다른 작업이 같이 써서 체크포인트 HEAD 가 아닌 트리일 수 있다) → 스크래치 워크트리 `build` → 로컬 태그. 여기까지가 체크포인트다. main 반영(ff·push)은 사람 확인 때 하고 그 뒤 CI(`test`·`db`) 초록을 확인한다(D49). SP3a E2E 기록의 순서다(`docs/baseline/sp3a-e2e.md`).
- **Phase B 의 게이트**: UI-1(토큰 별칭 — D3 의 전제)과 UI-2a·UI-2b(레이아웃·`/w/[slug]/admin/teams` 이동 — SP3b D47)가 main 에 있어야 B 를 자른다. 레인 B 가 늦으면 B 가 기다린다(SP3b §10.1 #8). 그동안의 일은 §2.1.1 ⑥ — SP5 의 전제인 "팀 캐시 폐기의 원천"(요청 범위 원천)은 A2 에서 끝난다(§10 K3).
- CI 는 `main`·`staging`·`sp0/**`·`ui/**` push 와 PR 에서만 돈다. `sp4/*` 의 CI 증거는 main push 뒤에 받고, 그 전에 CI db 잡과 같은 조건을 전용 스택에서 손으로 재현한다(§3.6).
- 체크포인트마다 실측 노력을 원장(`.superpowers/sdd/<날짜>-sp4-*/progress.md`)에 적고 B 의 마감 묶음에서 `docs/baseline/sp4-effort.md` 로 남긴다(SP3a D31 관례).

#### 2.1.1 main 반영과 레인 B 창(D49 — 비평 반영 Q2·Q3·Q38)

| # | 규칙 |
|---|---|
| ① | **체크포인트 = 검증 묶음 통과 + 로컬 태그**(`sp4-a1-done`·`sp4-a2-done`·`sp4-done`). main 반영(ff·push)은 사람 확인 때 한다. push 는 늘 사람 확인 뒤다(CLAUDE.md) |
| ② | 확인을 기다리는 동안 다음 Phase 는 **직전 체크포인트 HEAD 위에 쌓는다**(SP3a B → C 선례). 체크포인트 증거는 쌓인 상태에서도 유효하다 — main 반영이 ff 이기 때문이다. 둘 이상이 쌓이면 태그 순서대로 한 번에 ff 한다. SP3b D46·알림 7(다음 브랜치는 창이 닫힌 뒤의 main 에서)과 다르다 — 그 rebase 비용(③)은 레인 A 가 진다(재검토 반영 — T10) |
| ③ | 레인 B 창(SP3b D46)은 **실제 main 반영 직후**에 열린다. 레인 A 는 창이 닫힌 뒤의 main 에서 다음 브랜치를 자른다 — ② 로 이미 쌓아 둔 브랜치는 창이 닫힌 뒤의 main 위로 rebase 하고, 그 체크포인트 증거는 rebase 뒤 트리에서 다시 만든다(SP3b D46 과 같은 규칙). 창 시각은 컨트롤러가 두 원장에 적는다 |
| ④ | 레인 A 에 열린 Phase 브랜치가 없는 동안 창은 열려 있다 — 지금(SP4 스펙·계획)도 그렇다. 레인 B UI-0 은 A1 브랜치를 자르기 전에 넣는다(D53) |
| ⑤ | 창은 머지 준비가 끝난 레인 B 산출물만 받는다. 사람 게이트가 남은 단계(UI-1 의 사용자 눈확인)는 다음 창으로 넘기고, 레인 A 는 그 게이트를 기다리지 않는다 |
| ⑥ | A2 → B 대기 동안 레인 A 는 **SP5 스펙·계획**(브랜치 없음 — 창을 막지 않는다)을 한다. 대기가 그보다 길어 SP5 Phase A 구현을 당기면, UI-2a·UI-2b 는 SP3b D46 의 대안(창 밖 머지 — 레인 A 가 rebase 를 받아들인다)으로 넣는다. 그때 SP5-A 는 자기 전용 스택을 쓰고(`d-flow-sp4` 를 같이 쓰면 B 의 E2E·합성과 `db:reset` 이 엇갈린다), B 게이트가 열리면 진행 중인 과제의 커밋에서 멈추고 SP4 B 를 먼저 끝낸다 — SP5-A 브랜치는 B 반영 뒤 main 위로 rebase 한다(재검토 반영 — B P3-6) |
| ⑦ | SP4 A1·A2 는 UI-2 를 기다리지 않는다 — SP3b D47 첫 문장의 전제가 깨졌다(E32). UI-2 가 SP4 A 위로 rebase 하고 번호를 민다(D12) |

### 2.2 노력 추정과 근거

개정 SP4 블록은 2.5주(2~3)다. 이 문서의 추정은 **5.5~7.8주**(노력 단위 — 체크포인트 고정 비용 0.6~0.9주 포함, 빼면 4.9~6.9주)다. **비평 반영 — Q4**: 묶음마다 "출처"를 적고 체크포인트 고정 비용을 행으로 둔다. 출처 — (i) 개정 SP4 블록 문면(정본 유지 범위 포함), (ii) 개정 §5.9.4 가 SP4 에 준 화면 가운데 블록 문면에 없는 것, (iii) 블록에 없는 이월(레인 A 셋·무범위 조회·CR-7·레인 B 알림), (iv) 판정·초안·비평 반영이 더한 처리, (v) 구조(체크포인트 수). 개정 2.5주 대비 넘는 몫 가운데 약 1.0~2.2주는 블록 자체의 과소 추정((i) 이 3.5~4.7주 — SP3a 3 → 4.3~6.3, SP3b 3 → 6.4~8.0 과 같은 모양. 이 두 값은 비평 범위 §1.1 의 초안 기준 어림이다 — 아래 표의 출처가 섞인 행은 나누지 않았다, 재검토 반영 — B P3-1)이고, 범위가 실제로 넓어진 몫은 (iii)·(iv), 구조 몫은 (v) 다(비평 범위 §1). 합계는 Q1(체크포인트 셋)·Q8(B 축소)·Q16(전환 RPC)·Q6(사전 백업)을 반영해 다시 셌다.

| 묶음 | 추정(주) | 출처 | 근거 |
|---|---|---|---|
| A1 — 마이그레이션 셋 + 리허설 + RLS 테스트 | 0.75~0.95 | (i) 주간·영수증, (iii) 이월 셋, (iv) D27·D28·D46·Q10~Q15·Q30 | 0012(2,203줄, SP3a A 의 절반 이상)보다 작다. 주간 파일은 이관·재생성 롤백이 있어 셋 중 가장 크다. 비평 반영(직접 FK·프로젝트 술어·`updated_at` 트리거·`lock_timeout`·check·CR-1 표시·CR-6 null)이 각각 줄 단위라 +0.05 |
| A1 — 상속 공용 팀 전환 RPC·가져오기 연결·등록 멱등 | 0.15~0.25 | (iv) Q16·Q36 | RPC·롤백·RLS 케이스·카탈로그 불변식·감사 기록(비평 범위 §7 (B) 추정). `copyGlobalTeams` 연결은 B 로 옮겼다(T14) — 액션 한 함수와 그 테스트 케이스라 반올림 단위(0.05주) 아래로 보고 두 행의 값은 그대로 둔다(추정) |
| A1 — 주간 도메인·데이터·액션·출력·봇·AI 색인·실시간·편집기·최소 화면 | 0.65~0.85 | (i), (iv) Q19·Q20·Q29·Q35·Q37 | 쓰기 진입점 셋, 묶음 키 공유 둘(점검·PPT), 테스트 재작성(`weeklyLint.test.ts` 174회 등 — 실측 W §7). 주간 액션 원문 전부·지운 열 정적 가드·이월 매핑 규칙·레인 B 캡처 시드가 +0.05 |
| A1 — 가져오기 멱등·미등록 팀·영수증 액션·마법사 명령 id·사전 백업·데이터 손실 경로·E2E·합성 S2·S4 | 0.45~0.65 | (i), (iii) D18 일부, (iv) Q5·Q6 | 라우트 한 파일 + 마법사 상태. 원장 꼴은 선례가 있다. 사전 백업 +0.1(Q6), A2 에서 당긴 끝까지 읽기 +0.05(Q5) |
| A2 — 팀 원천(비화면 23파일)·봇 이름 매칭·개명·예약어 | 0.5~0.7 | (i) | 동기 접근자가 async 가 되며 AI 도구·리포지토리 시그니처가 줄줄이 바뀐다 |
| A2 — Excel(동등성·접기·삭제·fixture 오라클·양식·표기)·CR-7 | 0.3~0.45 | (i), (iii) CR-7, (iv) Q31·Q40 | 동등성 픽스처 L=3·5·비활성 팀·팀 0개, 옛 빌더를 fixture 오라클로 옮기는 일 |
| A2 — null 가중치·무범위 조회(나머지)·DB 원문·상수·가드·픽스처 이름·S10·경계 행렬·성능 | 0.6~0.8 | (i), (iii) D18 나머지, (iv) Q9·Q19·Q21·Q39 | 원문 32+5곳, 무범위 넷, 레벨 라벨 prop 에 기대는 테스트 약 29파일. 손실 경로를 A1 로 보내고(−0.05) 성능 경로를 줄였으며(−0.03~0.05) S10 대상·일치 규칙이 넓어졌다(+0.05~0.1) |
| B — 팀 색·`TeamsProvider`·레이아웃·`master.ts` 삭제 | 0.65~0.95 | (i) | `teamStyle` 17곳/12파일, 테스트 mock 정리, 다크 눈확인. 여러 워크스페이스 접근자를 만들지 않는다(−0.05, Q23) |
| B — 화면(#23·#25 + 주간 색 토큰·팀 개명 입력·팀 색 칩·가중치 미지정·토스트 사전·`copyGlobalTeams` 전환 연결과 그 확인 문구 — T14) + 이름 있는 테스트 넷 | 0.75~1.1 | (i), (iv) Q17·Q26 | 초안 B2 1.0~1.4 에서 SPU3 로 넘긴 순수 패턴(−0.4~0.55, Q8 — 출처 (ii))을 빼고 주간 4파일 색 토큰(+0.1~0.2)·테스트 넷(+0.05)을 더했다 |
| B — 마감 묶음(합성 전체·E2E·기록·노력 실측·태그) | 0.1~0.2 | (i) | 공통 묶음·CI 는 B 의 고정 비용에 든다 |
| **체크포인트 고정 비용** | 0.2~0.3 × 3 = **0.6~0.9** | (v) | Phase 최종 리뷰 고정분·공통 묶음·로컬 E2E·눈확인·기록·main 반영과 CI — SP3a 체크포인트 꼬리 2.5~3.5시간 가운데 diff 와 무관한 2~3시간(`docs/baseline/sp3a-effort.md` §1·§2, 비평 범위 §2.1). 사람 push 확인·레인 B 대기는 넣지 않았다(달력 — D49) |

- Phase A 작업은 3.4~4.65주(고정 비용 제외)로 개정 §6.1-1 의 상한(3주)을 넘어 A1·A2 로 나눈다(D1). 체크포인트별(고정 비용 포함)로는 A1 2.2~3.0·A2 1.6~2.25·B 1.7~2.55주 — **A1 의 상한이 3주에 닿는다.** 일을 미리 옮기지 않는다 — §2.5 ③ 끝에서 실측으로 넘침을 판단하고, 넘칠 것으로 보이면 K17 의 넘길 목록을 차례로 쓴다(재검토 반영 — T9).
- **에이전트 시간 환산**: SP3a 실측 비율은 0.14(하한 0.11·상한 0.17 — 경과 달력일 ÷ 추정 노동일, `docs/baseline/sp3a-effort.md` §2)다. 그 비율은 고정 비용 행이 없는 추정에 대한 값이라 같은 꼴(4.9~6.9주)에 적용하고, 두 불확실성을 곱하지 않게 상한 추정 × 하한 비율·하한 추정 × 상한 비율로 짝짓는다 — 6.9 × 5 × 0.11 ≈ 3.8일, 4.9 × 5 × 0.17 ≈ 4.2일, 중간 5.9 × 5 × 0.14 ≈ 4.1일 → **약 4일(3.8~4.2)**(비평 반영 — Q40. 비율 자체는 한 표본의 값이다). 같은 문서가 적었듯 SP3a 는 검증 비용(리뷰·E2E·눈확인)이 지배했다 — SP4 는 DB 와 화면이 다 있어 그 모양에 가깝다. Phase D 의 교훈(작은 단위로 테스트 먼저)을 계획 과제 단위에 적용한다.
- 달력은 노력보다 바깥이 정한다 — B 는 UI-1·UI-2 머지를 기다리고, UI-1 과 UI-2b 는 main 반영 전에 사용자 확인 게이트를 지난다(K3 — SP3b D29, 재검토 반영 B P3-6). 체크포인트의 main 반영은 사람 push 확인을 기다린다(D49 — 그동안 쌓는다). SP4 안의 사람 게이트는 기본값(D14)이면 없다.

### 2.3 소유 파일

파일마다 주인은 처음 고치는 체크포인트다. 뒤 체크포인트가 이어 고치는 파일은 표 아래에 적는다. `NNNN` 은 머지 직전에 정하는 번호다.

| 체크포인트 | 소유 파일 |
|---|---|
| A1 — DB | `supabase/migrations/NNNN_{weekly_areas,command_receipts,authz_carry}.sql`, `supabase/rollbacks/NNNN_{weekly_areas,command_receipts,authz_carry}_rollback.sql`, `supabase/rehearsal/NNNN_weekly_areas_{seed_wide,smoke,precheck_violations,created_fixture,rollback_check}.sql`·`NNNN_command_receipts_smoke.sql`·`NNNN_authz_carry_smoke.sql`, `supabase/rehearsal/compare-catalog.mjs`(컨테이너 env 한 줄 — D42), `tests/scripts/compare-catalog.test.ts`(새), 권한 이력 표시 `src/lib/domain/authzEvents.ts`(CR-1 의 새 모양 — Q30) |
| A1 — 주간 | `src/lib/domain/{weeklySheet,weeklyLint,weeklyRewrite,areas}.ts`, `src/lib/data/weeklySheet.ts`, `src/app/actions/{weekly,projectAreas}.ts`(주간 액션은 원문·`updated_at` 대입까지 파일 전부 — Q13·Q20), `src/lib/report/sheetNarrative.ts`, `src/app/api/report/route.ts`(시트 갈래), `src/lib/repositories/{types.ts,supabase/weekly.ts}`, `src/lib/ai/tools/weekly.ts`, `src/lib/ai/chat/evidence.ts`(비교 레코드 키), `src/lib/ai/index/content.ts`(주간 로더) — `src/lib/settings/errors.ts` 는 바꾸지 않는다(D45 — 재검토 반영 T6), 화면 최소(§5.1): `src/app/(app)/p/[projectId]/weekly/page.tsx`, `src/components/weekly/{WeeklySheetView,WeeklyLintPanel,WeeklyAiRewriteModal}.tsx`·`useSheetGrid.ts`·`CarryMappingModal.tsx`(새), `src/app/(app)/p/[projectId]/settings/page.tsx`, `src/components/settings/ProjectAreasManager.tsx` |
| A1 — 가져오기·팀 원천의 첫 소비처 | `src/app/api/import/execute/route.ts`, `src/app/actions/importReceipts.ts`(새 — `getImportReceipt`), `src/app/actions/importBackup.ts`(새 — `getWbsBackup`, D50), `src/lib/teams/register.ts`(새 — 가져오기의 멱등 등록 `ensureProjectTeams`, Q36), `src/lib/data/wbs.ts`(`getComputedWbs` 의 `wbs_items`·`item_owners` 끝까지 — D18), `src/lib/domain/importWizard.ts`, `src/components/import/ImportWizard.tsx`, `src/components/import/ImportModes.tsx`(`isSuperuser` prop 전달 삭제 — 재검토 반영 T2), `src/app/(app)/p/[projectId]/import/page.tsx`(`isSuperuser` prop 제거), `src/lib/teams/source.ts`(새 — 가져오기 라우트·설정 페이지가 먼저 쓴다), `src/lib/domain/teams.ts`(`Team` 에 `name`·`color`), `src/lib/teams/master.ts`(스냅샷 select 에 `name`·`color` 만 — B 까지 남는 동안 같은 형을 내린다). `src/app/actions/projectTeams.ts`(`copyGlobalTeams` → 전환 RPC 연결)는 A1 이 아니라 B 다(재검토 반영 — T14) |
| A1 — 게이트·문서·스크립트 | `tests/gates/{manifest.ts,_tables.ts,deny.test.ts,deny.routes.test.ts}`(`NULL_TABLE_ALLOW` 한 줄 — D25), `tests/gates/_rpc-tables.ts`(새 — D25), `tests/invariants/_ast.ts`(`tablesInNode` 의 `.rpc` 대응 — D25), `tests/invariants/rpc-actor-source.test.ts`(새 — D51), `tests/invariants/weekly-row-columns.test.ts`(새 — 지운 열 이름 정적 가드, Q35), `tests/invariants/settings-writes.test.ts`(e2e 두 스크립트의 refs·사유 — Q39), `docs/sp2-admin-client-audit.md`(가져오기 라우트·영역 액션 행과 본문 절 'DEFINER RPC 가 등급을 다시 판정하는 경로' — D28. `projectTeams.ts` 행은 B — T14), `CLAUDE.md` 권한·데이터 절의 몇 줄(SP4 가 세운 규칙 — §7 A1, 재검토 반영 — B P3-3), `scripts/e2e-local.mjs`(새 단계), `scripts/e2e-synthetic.mjs`·`scripts/lib/synthetic.mjs`(S1 추가·S2·S4), `tests/fixtures/synthetic/configs.ts`(C 에 `weekly` — 두 키), 레인 B UI-0 이 main 에 넣은 `scripts/ui-capture.mjs`·`tests/scripts/ui-capture.test.ts`(주간 시드 — D53), `docs/baseline/sp4-e2e.md`(새 — 리허설 절 포함) |
| A1 — 테스트 | 새 파일: `tests/rls/{weekly-areas,command-receipts,authz-carry,team-convert}.test.ts`, `tests/fixtures/legacy-sentinels.ts`, `tests/domain/weekly-carry.test.ts`, `tests/report/sheet-sections.test.ts`, `tests/actions/{weekly-create,team-convert,import-reads}.test.ts`, `tests/api/import-idempotent.test.ts`, `tests/gates/rpc-tables.test.ts`, `tests/negative/{weekly-outputs,sentinels}.test.ts`, `tests/ui/weekly-sheet-no-areas.test.tsx`, `tests/data/paging-consumers.test.ts`(A1 경로부터), `tests/invariants/no-raw-db-errors.test.ts`(주간·가져오기 파일부터 — A2 가 잇는다), 원문 통로 `src/lib/errors/dbFail.ts`(새 — `failWith` 만, 토큰은 기존 `dbToken`). 기존: `tests/rls/{fixture-ws.sql,isolation-map.ts,authz-events.test.ts}`(권한 이력 기대 모양 — Q30), `tests/domain/{weeklySheet,weeklyLint,weekly-rewrite,areas,authz-events,sheetSelection}.test.ts`, `tests/components/weekly-presence.test.tsx`, `tests/data/{weeklySheet,weeklySheet-carryover,computed-wbs-merge}.test.ts`, `tests/actions/{weekly-cells-batch,weekly-ai-rewrite,project-areas}.test.ts`(`project-teams-actions.test.ts` 는 A2·B — T14), `tests/report/{sheetNarrative,templateFill}.test.ts`, `tests/api/{report-route,import-execute,import-profile-mismatch-roundtrip}.test.ts`, `tests/ai/{tools-weekly-team,tools-detail,tools-core,chat-v2-verifier}.test.ts`·`tests/ai/golden/{fixtures,cases,fake-repositories}.ts`, `tests/repositories/core-read.test.ts`, `tests/ui/{weekly-lint-panel-sections,weekly-lint-panel-jump,weekly-ai-rewrite-modal,weekly-sheet-colgroup,settings-page-visibility,settings-page-teams}.test.tsx`·`tests/ui/import-wizard-state.test.ts`, `tests/components/{project-areas-manager,import-wizard-profile-mismatch}.test.tsx`, `tests/settings/no-runtime-constants.allow.ts`, `tests/settings/registry.test.ts`(explicit 키 대조 — §3.4 ③, 재검토 반영 A F-14), `tests/settings/project-isolation.test.ts`(정적 단언을 `src/lib/teams/source.ts` 하나에 — §4.2.1, 재검토 반영 B P3-7), `tests/scripts/{e2e,synthetic}.test.ts`, `Team` 형 변경(`name`·`color`)을 받는 `tests/fixtures/teams.ts`·`tests/helpers/teams-master-mock.ts` |
| A2 — 팀 | 비화면 소비처(`grep -rn "from '@/lib/teams/master'" src` 의 32파일 가운데 B 의 화면 넷(레이아웃 둘·명단 페이지·`DashboardView` — B 착수 때 다시 센다), A1 몫 셋(가져오기 라우트·설정 페이지·주간 도구), `refreshTeams` 만 쓰는 둘(`project.ts`·`teams.ts`)을 뺀 23파일): 액션 `src/app/actions/{teams,projectTeams,projectInvites}.ts`(원천·개명·예약어·원문 — `refreshTeams` 호출은 B 까지 남는다), 라우트 `src/app/api/{export,report,chat/v2/stream,minutes/chat,v1/minutes,v1/minutes/meta}/route.ts`, 데이터 `src/lib/data/{wbs,snapshots,portfolio}.ts`(`wbs.ts` 는 A1 이 먼저 — 아래 표)·`src/lib/repositories/supabase/wbs.ts`·`src/lib/minutes/teamScope.ts`, AI `src/lib/ai/{ingest,knowledge,projectFacts,wiki-ingest}.ts`·`src/lib/ai/tools/{attendance,dashboard,kanban,members,minutes,wbs}.ts`·`src/lib/ai/chat/router.ts`, 예약어 `src/lib/excel/headerWords.ts`(새), 테스트 도우미 `tests/helpers/teams-source-mock.ts`(새)와 소비처 테스트의 mock(`tests/actions/project-teams-actions.test.ts` 포함 — T14 로 A1 에서 옮겼다) |
| A2 — Excel | `src/lib/excel/{profile,exportWithProfile,detect,template}.ts`, `src/lib/excel/standardProfile.ts`(새 — `deriveStandardExcelProfile`·`resolveTeamColumns`), `src/lib/excel/export.ts`(삭제), `src/app/api/export/route.ts`, `src/components/import/downloadWbsExport.ts`, `src/components/settings/ExportExcelButton.tsx`, `src/lib/settings/{history,catalog-meta}.ts`, `docs/settings-catalog.md`, `src/lib/agent/wbsImport.ts`(CR-7), `tests/fixtures/excel/legacy-3row-profile.ts`(새), `tests/fixtures/excel/legacyBuild.ts`(새 — 옛 빌더 오라클, D16), `tests/excel/*`·`tests/api/{export-route,import-inspect}.test.ts`·`tests/components/download-wbs-export.test.ts`·`tests/ui/settings-page-excel-profile.test.tsx` |
| A2 — 집계·정확성·원문·상수 | `src/lib/domain/{rollup,trend,dashboard}.ts`(`dashboard.ts` 는 주석만), `src/lib/report/weekly.ts`(`:373`), `src/lib/data/agentApprovals.ts`, `src/app/actions/wbs.ts`, `src/components/wbs/{shared,RowDetailPanel,WbsGanttSheet,WbsProgressLens}.tsx`(라벨 prop·약어 — 다른 줄은 손대지 않는다), `scripts/perf-baseline.mjs`(DSN — SP3b 알림 11), `docs/baseline/sp4-perf.md`(새), `tests/domain/{overallProgress,trend,rollup,dashboard,level-badge}.test.ts`, `tests/actions/wbs-update-actual-lock.test.ts`, `tests/negative/wbs-outputs.test.ts`(새) |
| B — 팀(`ui/sp4-teams`) | `src/lib/domain/teamColor.ts`, `src/lib/domain/kanban.ts`, `src/app/globals.css`(별칭 10줄), `tests/css/token-aliases.test.ts`, `src/components/app/TeamsProvider.tsx`, `src/app/(app)/w/[slug]/layout.tsx`·`src/app/(app)/p/[projectId]/layout.tsx`(팀 주입만 — UI-2b 뒤 구조, D19·Q23. `(app)/layout.tsx` 는 UI-2b 가 팀 주입을 걷었는지 확인만), `src/app/(app)/p/[projectId]/members/page.tsx`(원천 한 줄), `src/components/dashboard/DashboardView.tsx`(원천 한 줄), `teamStyle` 소비 12파일(회의록 5·대시보드 2·WBS 3·보고서 1·칸반 1), `src/lib/teams/master.ts`(삭제)와 `refreshTeams` 호출 액션(`project.ts`·`teams.ts`·`projectTeams.ts`), `tests/lib/teams-master.test.ts`(삭제)·`tests/invariants/teams-scope.test.ts`(→ `teams-source.test.ts`)·`tests/helpers/teams-master-mock.ts`(삭제)·`tests/ui/team-style.test.ts`·`tests/ui/app-layout-teams.test.tsx`(UI-2b 가 다시 쓴 이름으로)·`tests/authz/project-layout-hiding.test.tsx`·`tests/domain/kanban.test.ts`, `tests/settings/project-isolation.test.ts`(`master.ts` 삭제 뒤 `src/lib/teams/**` 전체로 넓힌다 — B P3-7), `docs/baseline/sp4-ui.md`(새) |
| B — 화면(`ui/sp4-screens`, D52) | `src/app/actions/projectTeams.ts` 의 `copyGlobalTeams` → 전환 RPC(D54)와 `tests/actions/team-convert.test.ts` 의 그 케이스·`tests/actions/project-teams-actions.test.ts` 의 `copyGlobalTeams` 묶음·`docs/sp2-admin-client-audit.md` 의 `projectTeams.ts` 행(재검토 반영 — T14: 아래 `ProjectTeamsManager.tsx` 의 확인 문구 정정과 한 커밋), `src/app/(app)/w/[slug]/admin/teams/page.tsx` 와 팀 관리 컴포넌트(#15 — 개명 입력·팀 색 칩만), `src/app/(app)/p/[projectId]/import/page.tsx`·`ImportWizard.tsx` 결과 화면(#23), `weekly/page.tsx`·`src/components/weekly/{WeeklySheetView,SheetCell,WeeklyAiRewriteModal,WeeklyLintPanel}.tsx`(채움형·색 토큰)·스크롤 계약 테스트의 채움형 목록·`tests/css/no-raw-color.test.ts`(`ALLOW` 네 줄 삭제)(#25), `src/components/settings/ProjectTeamsManager.tsx`(개명·"전역 팀을 상속" 문구, 'copy' 의 확인 문구·성공 토스트를 전환에 맞게 — T14), `WbsGanttSheet.tsx`(가중치 미지정 표시·토스트 사전 매핑), 칸반 토스트, `src/app/actions/project.ts`(`revalidatePath` 5줄 — Q28), 사전 `src/lib/i18n/dict/*`, `tests/ui/{import-result-receipt,team-rename,wbs-unset-weight,wbs-toast-dict}.test.tsx`(새 — Q26) |
| B — 마감 묶음 | `docs/baseline/{synthetic-acceptance,sp4-e2e,sp4-effort}.md`, 개정 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md`(§9 의 "한 줄" 행을 받는 SP 블록·§8.1 에 — 재검토 반영 T13) |

| 파일(주인) | 이어 고치는 체크포인트와 내용 |
|---|---|
| `src/app/(app)/p/[projectId]/settings/page.tsx`(A1) | A2 가 Excel 표기(D48), B 는 바뀌지 않는다(A1 이 원천을 옮겼다) |
| `src/lib/teams/source.ts`·`src/lib/domain/teams.ts`(A1) | A2 가 나머지 접근자를 더하고, B 가 `w/[slug]/layout.tsx` 에 `workspaceTeams(wid)` 의 활성만 쓴다(여러 워크스페이스 접근자 없음 — Q23) |
| `src/lib/data/wbs.ts`(A1) | A2 가 `task_dependencies`·`holidays` 끝까지·팀 정렬 원천·`getProjectsCompletion`(§4.6) |
| `src/app/actions/projectTeams.ts`(A2 — 재검토 반영 T14 로 A1 은 이 파일을 만지지 않는다) | A2 가 원천·개명·예약어·원문(`copyGlobalTeams` 의 `복사 실패: ${…message}` 포함), B 가 `copyGlobalTeams` → 전환 RPC(T14)·`refreshTeams` 호출 삭제·`revalidatePath` 3줄 |
| `tests/gates/manifest.ts`·`tests/gates/_rpc-tables.ts`(A1) | A2 가 개명 액션 인자, B 가 화면 액션을 더한다. 새 RPC 를 부르는 쪽이 대응 표에 같은 커밋으로 더한다 |
| `tests/invariants/settings-writes.test.ts`(A1) | A2 가 D48 의 `history.ts` 참조 수·사유 |
| `tests/data/paging-consumers.test.ts`(A1) | A2 가 나머지 경로(§4.6) |
| `tests/invariants/no-raw-db-errors.test.ts`·`src/lib/errors/dbFail.ts`(A1) | A2 가 `actions/wbs.ts`·팀 액션을 가드 대상에 더한다(§4.7) |
| `src/components/import/ImportWizard.tsx`(A1) | B 가 결과 화면(실행 ID·영수증 링크) |
| `WeeklySheetView.tsx`(A1) | B 가 채움형·패턴·색 토큰 |
| `WbsGanttSheet.tsx`(A2) | B 가 범례 색·가중치 미지정·토스트 |
| `tests/settings/no-runtime-constants.allow.ts`(A1) | A2·B 가 항목을 지우고 가드 패턴을 더한다(§4.8) |
| `scripts/e2e-local.mjs`·`scripts/e2e-synthetic.mjs`(A1) | A2 가 Excel·팀 단계와 S10·경계 행렬을, B 가 팀 색 렌더 단계 `teams-color-render`(§6.3 — 재검토 반영 T12)를 더한다 |
| `docs/baseline/sp4-ui.md`(B) | B 의 화면 행을 덧붙인다. A1·A2 의 눈확인 행은 `sp4-e2e.md` 의 표에 둔다 |

### 2.4 SP3b 와 겹치는 파일·UI 위험 파일·트레일러

| 파일 | SP3b(과제) | SP4 | 처리 |
|---|---|---|---|
| `src/app/globals.css` | UI-1 전면 재작성(팀 = `category-1..5` 별칭 10줄) | B 별칭 삭제 | B 는 UI-1 뒤(게이트). 반응형 안전망은 손대지 않는다 |
| `src/components/app/TeamsProvider.tsx` | 없음 | B | UI 위험 파일 — `ui/sp4-teams`·트레일러 |
| `src/app/(app)/layout.tsx`·`w/[slug]/layout.tsx`·`p/[projectId]/layout.tsx` | UI-2b 재작성 — `(app)/layout.tsx` 는 팀을 싣지 않고 `w/[slug]`·`p/[projectId]` 레이아웃이 `TeamsProvider` 를 싣는다(SP3b §5.4.1), `UI_RE` 추가(알림 4) | B 팀 주입만(`w/[slug]` = 그 워크스페이스의 활성 팀, `p/[projectId]` = 프로젝트 팀 — 비평 반영 Q23) | SP3b D47 — UI-2 뒤 |
| `p/[projectId]/settings/page.tsx` | UI-2a·UI-2b(`p/[projectId]/**/page.tsx` 행 — 관문 줄 보존·교차 모듈 표시)·UI-3(시각 패턴). 첫 await 교체는 워크스페이스 설정 페이지 몫이다 | A1 편집기·A2 표기(몇 줄) | 먼저 머지한 쪽이 기준, 나중이 rebase. A1 이 먼저일 가능성이 크다 |
| `p/[projectId]/members/page.tsx` | UI-3(명단 실효 역할 열) | B 원천 한 줄(#30 패턴은 SPU3 — D52) | 먼저 머지한 쪽이 기준, 나중이 rebase. B 는 UI-3 을 기다리지 않는다(비평 반영 — Q1) |
| `src/components/dashboard/DashboardView.tsx` | UI-2a(교차 모듈 표시·회의록 링크 — SP3b D53) | B 원천 한 줄(#19 패턴은 SPU3 — D52) | Phase B 라 UI-2 뒤 |
| `src/components/weekly/WeeklySheetView.tsx` | UI-1 과제 9 의 내보내기 버튼 한 줄(`btn btn-accent` → `btn btn-ghost` — 레인 B 계획 `:132`·`:3229`), UI-2b sticky 한 줄(SP3b D54 — 토큰 치환) | A1 데이터 계약·B 이행·색 토큰 | A1 이 먼저면 UI-1·UI-2b 가 각 한 줄 rebase(다른 줄 — 재검토 반영 B P3-7) |
| `src/components/wbs/WbsGanttSheet.tsx` | UI-1 과제 8·12(조각 개수를 단언하는 적용 스크립트) | A2 라벨 prop·약어, B 범례·가중치·토스트 | A2 는 과제 12 조각과 다른 줄만(실측 T §7.2). 토스트 문구 줄은 B(UI-1 뒤) |
| `src/components/wbs/RowDetailPanel.tsx` | UI-1 과제 11 두 줄 | A2 라벨 prop, B 팀 색 | 다른 줄 |
| `src/components/import/ImportWizard.tsx` | UI-1 `StepBadge` 한 줄 | A1 명령 id·등록 확인·사전 백업, B 결과 화면 | 다른 줄 |
| 회의록 5파일 팀 막대 7줄 | UI-1 과제 11 `text-white` → `text-category-fg` | B `teamStyle` → 팀 슬롯 | B 가 UI-1 결과 위에서 같은 줄을 고친다 |
| `src/components/kanban/KanbanBoard.tsx` | UI-1 과제 11 조각 한 줄(빠른 필터 칩 `text-white` → `text-action-fg` — 레인 B 계획 `:3709-3710`), UI-3 의 보드 흡수(`group` 쿼리 — SP3b D36) | B 토스트 사전 매핑(D21·D52) | B 는 UI-1 뒤(게이트)라 다른 줄 위에서 고친다. UI-3 이 먼저 머지되면 보드가 작업 계획 안으로 옮겨 가므로 B 는 그 위에서 토스트 줄을 찾는다(먼저 머지한 쪽이 기준 — 재검토 반영 B P3-7) |
| `src/components/report/ReportModal.tsx` | UI-2b h1 → h2 | B 팀 색 | Phase B |
| `src/app/actions/teams.ts` | UI-2a `revalidatePath`·`listTeamsAdmin(workspaceId)` | A2 개명·예약어·원문 | 나중 머지가 rebase |
| `tests/rls/{isolation-map.ts,fixture-ws.sql}`·`tests/invariants/settings-writes.test.ts` | UI-2a `account_preferences` 등록 | A1·A2 | 나중 머지가 rebase 하고 `test:rls` 전체를 다시 돈다(실측 G §6.3-4) |
| 마이그레이션 번호 | UI-2a `0013_account_preferences` | A1 셋 | D12 — 나중 머지가 rename + 재리허설 빈 커밋 트레일러 |
| `/w/[slug]/admin/teams` | UI-2a 이동 | B #15(개명 입력·팀 색 칩) | UI-2 뒤 |
| `tests/css/token-aliases.test.ts` | UI-1 이 만든다 | B 갱신 | UI-1 뒤 |
| `tests/ui/app-layout-teams.test.tsx`·`tests/authz/project-layout-hiding.test.tsx` | UI-2b 재작성 | B | Phase B |
| `scripts/ui-capture.mjs`·`tests/scripts/ui-capture.test.ts` | UI-0 캡처 시드 — 시드 계획의 `weeklyRows` 가 주간 행을 `section`·`module`·`sort_order` 로 쓰고 `insertOnce('weekly_report_rows', …)` 가 upsert 한다(줄이 아니라 심볼 — 재검토 반영 A F-11) | A1 이 주간 영역 + `area_id`·`project_id` 로 고친다(D53 — 비평 반영 Q29). 테스트는 주간 행을 단언하면 함께 | UI-0 이 A1 보다 먼저 main 에 든다(§2.1.1 ④). UI-1 대조는 (merge-base, 머리) 쌍을 같은 트리에서 새로 찍으므로(SP3b D48) SP4 몫의 차이가 섞이지 않는다 |
| `scripts/e2e-local.mjs` | UI-2 마무리에서 `e2e-sp3b.mjs` 를 같은 파일에 합친다(SP3b 스펙 `:850`) | A1·A2 새 단계(이름 — §6.3) | 단계를 번호가 아니라 이름으로 부르므로 합쳐도 완료 조건이 흔들리지 않는다. 나중 머지가 rebase |
| `tests/css/no-raw-color.test.ts`(`ALLOW`) | UI-1 이 만든다 — 주간 4파일은 "SP4 화면 이행", `projectColors.ts` 는 "SP4(팀·영역 색 이행)" | B 가 주간 4파일 네 줄을 지운다(D52 — 비평 반영 Q17) | `projectColors.ts` 줄의 사유는 SP5(회의 화면)로 고친다 — 컨트롤러가 레인 B 원장에 알린다 |

- **UI 위험 파일**(`globals.css`·`src/app/layout.tsx`·`(app)/layout.tsx`·`src/components/app/*`, UI-2b 뒤 `w/[slug]/layout.tsx`·`p/[projectId]/layout.tsx`·`(global)/layout.tsx`)은 Phase A 에서 하나도 고치지 않는다. 구현 중 필요해지면 멈추고 B 로 옮긴다. A1·A2 완료 조건이 이것을 `git diff --name-only` 로 본다(D41).
- **트레일러**(SP3a §2.3·SP3b 규칙): `src/components/**`·`page.tsx`·`layout.tsx`·`globals.css` 를 고친 커밋은 전부 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>` 이나 `Preview-checked: n/a — <사유>` 를 단다. B 의 확인 화면은 "WBS·칸반·멤버·회의록·대시보드·보고서 모달·팀 관리·가져오기·주간(라이트·다크)"(개정 §6.5.4 의 "WBS·칸반·멤버"에 `teamStyle` 소비 화면 — 현황 보고서 모달 `ReportModal.tsx` 포함, 재검토 반영 B P3-7 — 과 D52 의 화면을 더함). 체크포인트는 확인 화면을 모두 적은 빈 커밋 하나로 닫는다(마지막 rebase 뒤).

### 2.5 커밋·브랜치·전용 스택

- **커밋 순서**(A1, SP3a D22·H2 관례): ① 마이그레이션 없이 초록인 커밋 — **첫 묶음은 데이터 손실 경로의 끝까지 읽기**(replace 백업 select, `getComputedWbs` 의 `item_owners` 프로젝트 필터·`wbs_items` — D18, 비평 반영 Q5), 그다음 새 순수 모듈(이월 계약·영역 순서·"내용 있음" 술어 등) → ② 마이그레이션 + 롤백 **두 파일만** — 파일마다 한 커밋(`weekly_areas` → `command_receipts` → `authz_carry`), 각 커밋에 `Staging-verified: local db reset <YYYY-MM-DD HH:MM> — 적용·test:rls 초록(건너뜀 0)·롤백 카탈로그 불일치 0·스모크 통과` 를 `Co-Authored-By:` 바로 위 줄에(G4) → ③ `tests/rls/**`·리허설 → ④ 호출부 교체(레인 B 캡처 시드 — D53 — 포함). ② 와 ④ 끝 사이는 배포 불가 상태다(옛 코드가 지운 열을 읽는다) — 그 사이 앱을 띄우지 않는다.
- `git add -A` 금지, 파일명 stage. 커밋 메시지 한국어·"왜". null 가중치 커밋 메시지에 동작 변화(혼재 루트 프로젝트만)를 적는다(D20).
- **전용 스택**(D42): `/Users/jerry/D-Flow-wt/lane-a-sp4`, `project_id = "d-flow-sp4"`, 포트 545xx 여덟 줄, `git update-index --skip-worktree supabase/config.toml`. 명령은 `( cd "$WT" && … )`. `RLS_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54522/postgres`, `LOCAL_DB_URL` 같은 값. 계획의 명령 전문에서 `grep -n "supabase_db_d-flow\b"` 0건.
- **메인 스택(사용자 데이터)**: SP4 마이그레이션을 번호 확정·main 반영 전에 적용하지 않는다. 반영 뒤 사용자 확인을 받아 `migration up` 한다(§8 #10).
- **머지 직전**: `ls supabase/migrations | tail -1` 로 다음 빈 번호를 확인한다. 레인 B 가 먼저면 마이그레이션·롤백·리허설 파일의 이름만 바꾸는 `git mv` rename 커밋(본문에 번호가 없으므로 내용 변경 0) + 재리허설 빈 커밋(`Staging-verified: … — 번호 변경 뒤 재리허설`).
- push 는 사람 확인 뒤, `SKIP_GUARD` 금지, `main` force push 금지.

## 3. DB 계약(Phase A1)

### 3.1 공통 규칙

| 규칙 | 내용 | 근거 |
|---|---|---|
| 파일 형식 | 정방향에 `begin;`/`commit;` 없음(CLI 가 파일 하나를 한 트랜잭션으로 적용). 롤백은 `begin;`…`commit;`·정방향의 역순·`cascade` 0건(`on delete cascade` 제외). 머리 주석 = 정본 링크·절 목록·권한 원칙·롤백·리허설 파일 이름 — **파일 경로도 번호가 아니라 접미로**(`supabase/rollbacks/*_weekly_areas_rollback.sql` 꼴 — 비평 반영 Q40, rename 이 "내용 변경 0" 이 되게), 롤백 머리 = "되돌리지 않는 데이터"와 재생성하는 표의 이전 모양. 세 롤백 머리에 "`modules.*` 를 건드리지 않는다 — CR-4 해당 없음(이월은 §9)"(D15) | 실측 G §1.4, SP3a Phase A 계획. 선례 머리는 번호가 든 경로를 적었다(`0006_workspace_isolation.sql:5`) |
| 번호를 참조하지 않는다 | 사전·사후검사 토큰은 `WEEKLY_AREAS_PRECHECK`·`WEEKLY_AREAS_POSTCHECK`·`COMMAND_RECEIPTS_POSTCHECK`·`AUTHZ_CARRY_POSTCHECK`. 리허설 파일은 접미 이름, 원문을 읽는 테스트는 접미로 찾는다. 새 픽스처 uuid 는 넷째 묶음에 번호 대신 표지 `5b04`, 테스트 id 범위는 `…7e57-0000000018NN`(레인 B 가 `15NN` 을 쓴다), 테스트 워크스페이스는 `…aa4N` | D12, 실측 G §1.8·§3.2 |
| 함수 | `language plpgsql security definer set search_path to ''`(헬퍼는 `language sql stable`), 본문은 `public.`·`pg_catalog.` 한정. 새 함수 전부 `revoke all on function <시그니처> from public, anon, authenticated;`, 서버 RPC 만 `grant execute … to service_role;`. 트리거 함수·헬퍼는 grant 없음. 행위자 인자는 `p_actor`(`schema-invariants.test.ts:211-220` 이 자동으로 덮는다). authenticated 가 실행하는 새 함수 0개 — `DEFINER_EXECUTABLE` 무수정. **비평 반영 — Q14**: advisory 잠금을 잡는 RPC 넷(주간 둘·가져오기·전환)은 함수 속성 `set lock_timeout to '15s'` — 대기가 넘치면 `55P03` 이고 화면은 503 재시도 가능(D45). **비평 반영 — Q12**: `p_actor` 를 받는 RPC 를 부르는 코드는 가드 결과의 `actor.userId` 만 넘긴다(D51) | H2 규칙 ①, 실측 G §2.3. `pg_advisory_xact_lock` 은 상한이 없으면 끝없이 기다려 일하지 않는 service_role 연결을 붙잡는다(비평 보안 §4) |
| RPC 안의 순서 | 행위자·명령 id null 확인(잠금보다 먼저) → 입력 모양 → advisory 잠금 → 격리 가드 → 등급(D17·D28) → 원장 조회(가져오기) → 쓰기 → 원장 기록 → 결과 | 0012 `set_platform_admin` 순서(실측 G §2.4) |
| 격리 가드 | 잠금 뒤·판독 전에 글자 그대로 `if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then raise exception using errcode = '25001', message = '<AREA>_ISOLATION'; end if;` + "이 가드에서 놓치는 것" 주석 한 줄. 토큰 `WEEKLY_ISOLATION`(주간 RPC 둘)·`IMPORT_RECEIPT_ISOLATION`(가져오기)·`TEAM_CONVERT_ISOLATION`(전환). 사후검사가 `prosrc` 문자열을 본다 | H2 규칙 ③ — 네 RPC 모두 잠금 뒤 다른 행(영역·문서·원장·팀)을 읽어 판정한다(C-22) |
| advisory 잠금 키 | `'weekly:' \|\| project_id`(주간 RPC 둘 — 개정 §4.3.2 그대로, 접두가 있어 `validate_task_dependency` 의 맨 `project_id` 키와 겹치지 않는다), `'import-receipt:' \|\| actor \|\| ':' \|\| command_id`(가져오기 명령), `'wbs-import:' \|\| project_id`(가져오기 프로젝트 — D34, 그리고 전환 RPC — 전환과 가져오기가 같은 프로젝트에서 엇갈려 공용 팀 참조가 다시 생기지 않게). 한 트랜잭션에서 둘을 잡는 것은 가져오기뿐이고 순서는 명령 → 프로젝트 한 방향. 전환은 프로젝트 잠금 하나만 잡고 가져오기와 다른 트랜잭션이다 | 실측 G §2.6 |
| 새 표 | `enable row level security` → `revoke all … from anon, authenticated` → 필요한 것만 grant. 읽기 정책 하나, 쓰기 정책 0. 정책 없는 DML 0(H2 규칙 ②) | `tests/rls/h2-table-grants.test.ts` |
| 같은 표 쌍 FK 하나 | 복합 FK 를 더하는 같은 `alter table` 에서 기준선 단일 FK 를 지운다. 주간 행의 `projects` 직접 FK(D23)는 새 쌍이라 FK 하나다 | `schema-invariants.test.ts:44-56`, PGRST201, 비평 실험 §3.7 |
| 식별자 | `…atomic` 접미 0건(CLI 2.75 문장 분할) | CLAUDE.md 데이터 절 |
| H2 규칙 ④ | 해당 없음 — SP4 에는 "마지막 하나를 지키는" 가드가 없다(마지막 활성 주간 영역의 비활성화는 허용하고 문서 생성만 `WEEKLY_AREAS_REQUIRED` 로 막는다). 리뷰가 찾지 않게 적어 둔다 | 비평 실행 §2 |
| 사후검사의 EXECUTE 기대표 | 0012 ⑫ 와 같은 꼴 — anon·authenticated 는 전부 거짓, service_role 은 "참이어야 하는 것"(서버 RPC)만 본다. 새 함수는 기본 권한으로 service_role EXECUTE 를 받고 생기므로 헬퍼·트리거 함수에 거짓을 기대하면 거짓 실패한다(비평 반영 — Q40) | `0011_authz_hardening.sql:6-7`, `0012_settings.sql:1475` |
| 무수정 불변식 | `tests/rls/{schema-invariants,workspace-isolation-cases,h2-table-grants}.test.ts` 는 고치지 않은 채 초록 — **SP4 의 커밋이 세 파일을 건드리지 않는다: `git diff --quiet $(git merge-base main HEAD) HEAD -- <셋>`**(비평 반영 — Q24. 레인 B UI-2a 가 먼저 머지되면 `account_preferences` 때문에 `sp3a-done` 대비 diff 가 SP4 와 무관하게 생긴다) | 실측 G §3.4 |

### 3.2 `NNNN_weekly_areas`

절 순서(머리 주석에 같은 목록):

| 절 | 내용 |
|---|---|
| ① 사전검사 | `WEEKLY_AREAS_PRECHECK`(23514) — 아래 ⑤·⑥ 의 라벨·머리표·병합 규칙으로 계산한 `(문서, 라벨)` 의 칸 하나라도 20,000자를 넘으면 목록(`left(…, 600)`)과 조치("그 문서의 해당 행 내용을 줄이고 다시 적용")를 적고 멈춘다(D30). 병합 뒤 길이 = Σ(비어 있지 않은 값의 `char_length`) + Σ(머리표 — 머리표가 붙는 값(①′)마다 `char_length(모듈 이름) + 3` — `[`·`]`·줄바꿈, T4) + (비어 있지 않은 값의 수 − 1). 보정하지 않는다 |
| ①′ 공통 정의(비평 반영 — Q34) | ①·⑥·⑦·스모크가 같은 정의를 쓴다. **비어 있지 않음 = `<> ''`(다듬지 않음** — 공백뿐인 칸도 내용으로 옮긴다. 이월·표시의 "내용 있음"(D32 — `trim() !== ''`)과 다른 술어다: 이관은 보존이 목적이다). **길이 = `char_length`**(코드 포인트) — TS 상한 `WEEKLY_CELL_MAX` 는 JS `.length`(UTF-16 단위)라 보조 평면 문자에서만 다르고(TS 가 2로 센다), 경계 바로 아래의 그런 칸은 이관 뒤 저장 때 상한에 걸릴 수 있다(로컬 개발 데이터라 받아들인다). **모듈 이름** = 라벨과 같은 공백 집합으로 걷은 `module`. **머리표가 붙는 값**(재검토 반영 — T4·A F-13) = 모듈 이름이 비어 있지 않고 라벨과 다른 행의 값 가운데 `btrim(값, <⑤ 의 공백 집합>) <> ''` 인 것 — 공백뿐인 값은 비어 있지 않아도(이관 대상이다) 머리표 없이 그대로 옮긴다. ①·⑥·⑦·스모크가 이 술어 하나를 쓴다 |
| ② 선행 유일 인덱스 | `create unique index project_areas_id_project_kind_uidx on public.project_areas (id, project_id, kind);` `create unique index weekly_reports_id_project_uidx on public.weekly_reports (id, project_id);` |
| ③ 열 추가(nullable) | `alter table public.weekly_report_rows add column project_id uuid, add column area_id uuid, add column area_kind text not null default 'weekly_section' check (area_kind = 'weekly_section');` |
| ④ `project_id` 백필 | 부모 문서의 `project_id` |
| ⑤ 라벨 → 영역(D29·D9 — 비평 반영 Q18·Q34) | 라벨 = `btrim(section)`, 구분이 비면 `coalesce(nullif(btrim(module), ''), '기타')`(걷는 공백 문자 집합은 화면의 JS `trim()` 과 같게 `btrim(x, <집합>)` 으로 — 기본 `btrim` 은 공백만 걷는다. 계획이 목록을 고정). 이름 목록을 원문에 넣지 않는다. 프로젝트마다 라벨 하나에 영역 하나 — 같은 프로젝트에 `(kind='weekly_section', code=라벨)` 영역이 있으면 재사용(이름·순서·활성 유지), 없으면 insert(`code = name = 라벨`, `active = true`, `sort_order = 그 프로젝트 기존 weekly_section 의 max(sort_order)(없으면 0) + dense_rank() over (partition by project_id order by min(행 sort_order), 라벨)`). 영역 순서는 근사다 — 옛 화면은 표준 구분을 이름 자리 순으로 놓았고 행 `sort_order` 는 주차마다 달랐다(머리 주석의 "보정하지 않는 것"에 "영역 순서는 근사 — 편집기로 고친다"). 주간행이 없는 프로젝트에는 만들지 않는다. 행의 `area_id` 를 채운다 |
| ⑥ 머리표·중복 병합(비평 반영 — Q18·Q34) | 같은 `(report_id, area_id)` 행 묶음(행이 하나뿐인 묶음 포함)에서 — (a) **머리표**(재검토 반영 — T4): 머리표가 붙는 값(①′)마다 `'[' \|\| 모듈 이름 \|\| ']' \|\| E'\n' \|\| 값` — `[모듈]` 단독 줄을 그 값의 첫 줄로 둔다(점검의 셀 안 구획 머리글 관례 — 줄 전체가 대괄호 한 쌍, `weeklyLint.ts:142-152`). 머리 주석의 "보정하지 않는 것"에 "모듈 이름에 `[`·`]` 가 들어 있으면 점검이 머리글로 읽지 못한다(본문 줄로 남는다)"를 적는다 (b) **병합**: `(sort_order, id)` 첫 행을 남기고 네 칸마다 비어 있지 않은 값(머리표 포함)끼리 `E'\n'` 로 이어 붙인다(그 순서). 남는 행의 `updated_at = max(묶음의 updated_at)`(AI 색인 신선도가 행 `updated_at` 의 최댓값을 쓴다 — `ai/index/content.ts:183-185`). 나머지 행은 지운다 |
| ⑦ 전후 대조(비평 반영 — Q18·Q34) | 이관 전에 임시 표로 잰 '(문서, 라벨, 칸) 가운데 비어 있지 않은 조합 수'·'칸 내용 총 글자 수'와, 이관 뒤 '(문서, 영역, 칸) 가운데 비어 있지 않은(`<> ''` — ①′) 조합 수'(재검토 반영 — A F-12: 빈 칸까지 세면 늘 어긋나 멈춘다)·'총 글자 수 − 병합 구분자 수 − 머리표 글자 수'가 다르면 `raise exception 'WEEKLY_AREAS_MIGRATION_MISMATCH: …'`. 구분자 수 = Σ max(k−1, 0)(k = 묶음·칸의 비어 있지 않은 값 수), 머리표 글자 수 = Σ(머리표가 붙은 값마다 `char_length(모듈 이름) + 3`). 같으면 `raise notice` 로 건수(영역 신설·재사용·병합·머리표·행)를 남긴다. 리허설 스모크가 다시 잰다(W19) |
| ⑧ 제약(비평 반영 — Q10) | `alter column project_id set not null, alter column area_id set not null, drop constraint weekly_report_rows_report_id_fkey, add constraint weekly_report_rows_report_fk foreign key (report_id, project_id) references public.weekly_reports (id, project_id) on delete cascade, add constraint weekly_report_rows_area_fk foreign key (area_id, project_id, area_kind) references public.project_areas (id, project_id, kind) on delete restrict, add constraint weekly_report_rows_project_id_fkey foreign key (project_id) references public.projects (id) on delete cascade` — 한 문장(영역 FK 는 개정 그대로. 직접 FK 는 D23 — 주석: `-- 프로젝트 삭제와 영역 restrict: 주간 행은 weekly_report_rows_project_id_fkey 로 projects 의 1단 캐스케이드에서 지워지고, 영역 검사는 영역 삭제가 낳는` `-- 2단 사건이라 늘 그 뒤에 돈다. RI 트리거 이름(OID 문자열) 순서에 기대지 않는다 — 덤프·복원·FK 재생성에도 같다. 영역을 지우는 캐스케이드 길을` `-- 새로 만들면(예: project_areas 에 workspace FK) 주간 행에도 같은 깊이의 길을 둔다.`). `create unique index weekly_report_rows_report_area_uidx on public.weekly_report_rows (report_id, area_id);` `create index weekly_report_rows_project_idx on public.weekly_report_rows (project_id);`(직접 FK 의 캐스케이드를 받친다) `create index weekly_report_rows_area_idx on public.weekly_report_rows (area_id);`(영역 삭제 검사용) |
| ⑨ 축소 | `drop column section, drop column module, drop column sort_order`(`weekly_report_rows_report_idx` 는 열과 함께 사라진다 — 문서 조회는 ⑧ 의 유일 인덱스가 앞 열 `report_id` 로 맡는다). 지운 열을 읽는 DB 함수는 없다(실측 G §2.10) |
| ⑩ 정책·권한(D6·D27 — 비평 반영 Q11·Q13) | **주간 행**: `weekly_report_rows_ws_read` 를 `for select to authenticated using (project_id in (select public.accessible_project_ids()))` 로 다시 만든다. `weekly_report_rows_update` 를 `using (public.is_project_member(project_id)) with check (public.is_project_member(project_id))` 로. `weekly_report_rows_insert`·`_delete` 정책 삭제. `revoke insert, update, delete on public.weekly_report_rows from authenticated; grant update (this_content, this_issue, next_content, next_issue) on public.weekly_report_rows to authenticated;` **주간 문서**: `weekly_reports_insert`·`weekly_reports_delete` 삭제, `revoke insert, update, delete on public.weekly_reports from authenticated; grant update (title) on public.weekly_reports to authenticated;`(읽기·`weekly_reports_update` 정책은 그대로). 두 표의 `updated_at` 은 열 권한에 없다 — ⑪ 의 트리거가 채운다. **영역**: `project_areas_write`·`area_teams_write` 삭제, `revoke insert, update, delete on public.project_areas, public.area_teams from authenticated;`(읽기 정책 그대로). **kind·`project_id` 불변**(D46): `project_areas_guard()` 를 `create or replace` — code 검사 뒤에 `if new.kind is distinct from old.kind then raise exception using errcode = '23514', message = 'PROJECT_AREA_KIND_IMMUTABLE'; end if; if new.project_id is distinct from old.project_id then raise exception using errcode = '23514', message = 'PROJECT_AREA_PROJECT_IMMUTABLE'; end if;` |
| ⑪ 함수·트리거 | 아래 세 함수(헬퍼·RPC 둘)와 그 EXECUTE 정리. **`updated_at` 트리거**(비평 반영 — Q13): 트리거 함수 `public.weekly_touch_updated_at()`(`language plpgsql set search_path to ''` — `new.updated_at := pg_catalog.now(); return new;`, revoke 만)와 `before update … for each row` 트리거 `weekly_reports_touch`·`weekly_report_rows_touch`. ⑥ 뒤에 만들므로 병합의 `updated_at = max` 를 덮지 않는다(선례 `project_members_guard` 의 `new.updated_at := now()`, `0011:437`) |
| ⑫ 사후검사 | `WEEKLY_AREAS_POSTCHECK` — 남은 열 목록(`section`·`module`·`sort_order` 없음), `project_id`·`area_id` NOT NULL, `weekly_report_rows → weekly_reports`·`→ project_areas`·`→ projects`(`weekly_report_rows_project_id_fkey`, `confdeltype = 'c'`) FK 각 1개이고 `weekly_report_rows_report_id_fkey` 없음, 유일 인덱스, 정책 수·명령(주간 행: select 1·update 1, 주간 문서: select·update, 영역·영역-팀: select 1), 정책 없는 DML 0(0011 ⑪ 의 쿼리), authenticated 의 열 권한이 위 목록과 정확히 같음(`has_column_privilege` — 주간 행 = 네 칸, 주간 문서 = `title`), `updated_at` 트리거 둘 활성(`tgenabled in ('O','A')`), 새 함수 EXECUTE 기대표(§3.1 — 0012 ⑫ 꼴), `create_weekly_report`·`upsert_project_area` 의 `proconfig` 에 `lock_timeout=15s`(재검토 반영 — A F-8: 넷 가운데 둘은 `_command_receipts` ⑦ 이 본다), 격리 문자열 두 곳, `project_areas_guard` 본문의 kind·`project_id` 검사, `supabase_realtime` 발행에 `weekly_report_rows` 그대로 |

**헬퍼** `public.actor_is_project_admin(p_actor uuid, p_project_id uuid) returns boolean` — `language sql stable security definer set search_path to ''`. 식은 `upsert_project_member_cmd` 의 등급 판정과 같다(플랫폼 관리자 ∨ 그 프로젝트 워크스페이스 관리자 ∨ (워크스페이스 멤버 ∧ 활성 명단 행·인물의 `access_role = 'admin'`) — `0012:1252-1265`). 정책은 부르지 않는다(RPC 넷만 — 주간 둘·가져오기·전환). 가져오기·전환 RPC(§3.3)도 쓴다 — 그래서 `NNNN_command_receipts` 는 이 파일 뒤에 온다.

**`public.create_weekly_report(p_actor uuid, p_project_id uuid, p_week_start date, p_seed jsonb) returns jsonb`** — service_role 만 실행, `set lock_timeout to '15s'`. `p_actor` 는 액션 가드의 `actor.userId`(D51).

1. `p_actor`·`p_project_id`·`p_week_start` 가 null 이면 `22023 WEEKLY_INVALID_INPUT`. `p_seed` 는 null(빈 시드) 또는 객체 배열 — 객체마다 `area_id`(uuid)·네 칸(text, 각 20,000자 이하), `area_id` 중복 없음. 어기면 `22023 WEEKLY_SEED_INVALID`. 주 키 요일은 검사하지 않는다 — 액션이 `mondayIso` 로 정규화하고 SP5 가 키 규칙을 바꾼다(W30).
2. `pg_advisory_xact_lock(hashtextextended('weekly:' || p_project_id, 0))` → 격리 가드 `WEEKLY_ISOLATION`(놓치는 것: 잠금을 기다리는 사이 커밋된 같은 주 문서·영역 변경 — 스냅샷이 고정된 수준에서는 보지 못해 아래 4 를 지나 23505 가 나거나 새 영역의 행이 빠진다).
3. `actor_is_project_admin` 이 거짓이면 `42501 WEEKLY_FORBIDDEN`. 프로젝트가 없으면 `P0002 PROJECT_NOT_FOUND`.
4. 같은 `(project_id, week_start)` 문서가 있으면 `{status:'exists', report_id}` 를 돌려주고 끝(D33).
5. 활성 `weekly_section` 영역이 0개면 `23514 WEEKLY_AREAS_REQUIRED`(임의 구분을 만들지 않는다).
6. 문서 insert → 활성 영역마다 1행(시드의 같은 `area_id` 칸, 없으면 빈 칸) → 시드에만 있는 영역(지금 비활성)의 행을 내용과 함께 insert(그 영역이 이 프로젝트의 `weekly_section` 이 아니면 FK 23503).
7. `{status:'created', report_id, rows}`.

**`public.upsert_project_area(p_actor uuid, p_project_id uuid, p_area jsonb, p_teams jsonb, p_from_week date) returns jsonb`** — service_role 만 실행, `set lock_timeout to '15s'`. `p_actor` 는 액션 가드의 `actor.userId`(D51). `p_area = {id?, kind, code, name, sort_order, active}`, `p_teams = [{team_id, kind}]`.

1. null·모양 검사 — kind 는 `weekly_section`·`issue_area`, code·name 은 앞뒤 공백(§3.2 ⑤ 의 공백 집합 — 롤백·재적용 왕복에서 code 가 라벨과 같게) 없는 빈 문자열 아님, `sort_order` 정수, `active` 불리언, 팀은 `primary`·`support` 이고 같은 팀 중복 없음, `kind = 'weekly_section'` 이면 `p_from_week` 필수. 어기면 `22023 AREA_INVALID_INPUT`.
2. 같은 잠금(`'weekly:' || p_project_id`) → 격리 가드 `WEEKLY_ISOLATION`(놓치는 것: 잠금을 기다리는 사이 커밋된 새 문서 — 스냅샷이 고정된 수준에서는 아래 6 이 그 문서를 못 봐 이 영역의 행이 빠진다).
3. 등급 `42501 AREA_FORBIDDEN`.
4. **비평 반영 — Q11.** `id` 가 있으면 `select … from public.project_areas a where a.id = (p_area->>'id')::uuid and a.project_id = p_project_id for update` — 없으면 `P0002 AREA_NOT_FOUND`(다른 프로젝트의 영역 id 도 여기서 끝나고 아무것도 바꾸지 않는다). kind 가 다르면 `23514 PROJECT_AREA_KIND_IMMUTABLE`, code 가 다르면 `23514 PROJECT_AREA_CODE_IMMUTABLE`, 이름·순서·활성을 `where id = v_area and project_id = p_project_id` 로 update. `id` 가 없으면 insert(같은 `(project, kind, code)` 는 23505).
5. 영역-팀을 목록으로 맞춘다 — **`v_area` 의 행만**: 목록 밖 행 delete(`where area_id = v_area`), 목록 행 `insert … on conflict (area_id, team_id) do update set kind`(범위 위반은 기존 트리거 `23514 AREA_TEAM_SCOPE`). 한 트랜잭션이라 지금 액션의 "두 문장 비원자"가 사라진다. 이 RPC 는 DEFINER 라 RLS 가 빠진다 — 클라이언트가 준 영역 id 를 그 프로젝트로 묶는 것은 이 술어 하나다(등급 판정은 `p_project_id` 만 본다. 지금 액션은 `eq('project_id', projectId)` 로 두 번 묶는다 — `projectAreas.ts:74-80,92`, 비평 보안 §1).
6. `kind = 'weekly_section'` 이고 `active` 면 `insert into public.weekly_report_rows (report_id, project_id, area_id) select r.id, r.project_id, <영역> from public.weekly_reports r where r.project_id = p_project_id and r.week_start >= p_from_week on conflict (report_id, area_id) do nothing` — 과거 주차는 그대로(W17). 비활성화는 행을 지우지 않는다(D32 가 화면에서 숨긴다).
7. `{status:'created'|'updated', area_id, rows_added}`.

**롤백**(`*_weekly_areas_rollback.sql`, 역순): (먼저 — 재검토 반영 A F-6) `_command_receipts` 가 적용돼 있으면 그 롤백을 먼저 한다 — 그 파일의 두 RPC(`import_wbs_cmd`·`convert_inherited_teams`)가 이 파일의 도우미 `actor_is_project_admin` 을 부르는데, plpgsql 본문은 의존이 추적되지 않아 도우미 drop 이 성공하고 두 RPC 가 실행 때 42883 으로 깨진다. 머리에 적고, 롤백 첫 문장이 `to_regprocedure('public.import_wbs_cmd(uuid,uuid,text,jsonb,jsonb,uuid)') is not null` 이면 `raise exception` 으로 멈춘다 → 트리거 둘(`weekly_*_touch`)·트리거 함수·함수 셋 drop → `project_areas_guard()` 를 0003 원문 바이트 그대로 → 영역·영역-팀 쓰기 정책과 grant 복원(0003 본문, 0006·0011 이 정리한 뒤의 권한) → 주간 문서 — `revoke update (title) on public.weekly_reports from authenticated;`(표 권한을 되돌려도 열 권한은 남아 카탈로그 R 에 한 줄 차이로 잡힌다 — 재검토 반영 A F-9) 뒤 `weekly_reports_insert`·`weekly_reports_delete` 정책과 표 권한 복원 → **`weekly_report_rows` 재생성**(열 drop·add 가 아니라 0012 모양 — 열 순서 `id, report_id, section, module, sort_order, this_content, this_issue, next_content, next_issue, updated_at`·기본값·PK·단일 FK `weekly_report_rows_report_id_fkey`·인덱스 `weekly_report_rows_report_idx`·RLS·정책 넷(select 는 0006 본문, 나머지는 0000 본문)·0011 뒤의 권한·`alter publication supabase_realtime add table`. 주간 행의 `projects` 직접 FK 는 0012 모양에 없어 따로 지울 것이 없다). 데이터는 같은 `id` 로 옮긴다 — **`section` = 영역 code**(비평 반영 — Q33: code 는 트리거로 불변이라 롤백 → 재적용 왕복에서 ⑤ 가 같은 영역을 재사용한다. 이름으로 되살리면 이관이 재사용한 영역·이관 뒤 개명한 영역·code ≠ name 영역에서 재적용이 같은 이름의 영역을 새로 만든다 — 비평 실행 §1), `module` = `''`, `sort_order` = 그 문서 안에서 영역 순서(D32)의 순위 → 새 유일 인덱스 둘 drop. 머리의 **되돌리지 않는 데이터**: 이관이 만든 영역 행(남는다), 병합된 중복 행(다시 나뉘지 않는다), `module`(열은 `''` 로 돌아오고 모듈 이름은 칸 내용 첫 줄의 머리표 `[모듈]` 로만 남는다 — 롤백은 머리표를 지우지 않는다, T4), 이관 뒤 바꾼 영역 이름(`section` 은 code 로 돌아간다), SP4 경로로 만든 행의 원래 순서(영역 순서로 매긴다), 트리거가 매긴 `updated_at`. `0006`·`0012` 소유 함수는 지우지 않는다.

### 3.3 `NNNN_command_receipts`

```sql
create table public.command_receipts (
  actor          uuid not null,
  command_id     uuid not null,
  kind           text not null check (kind in ('wbs_import')),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  project_id     uuid references public.projects (id) on delete cascade,
  command_digest text not null,
  result         jsonb not null,
  created_at     timestamptz not null default now(),
  primary key (actor, command_id, kind),
  constraint command_receipts_project_required check (kind <> 'wbs_import' or project_id is not null)  -- Q14
);
create index command_receipts_project_idx on public.command_receipts (project_id);
create index command_receipts_workspace_idx on public.command_receipts (workspace_id);
alter table public.command_receipts enable row level security;
revoke all on public.command_receipts from anon, authenticated;
grant select on public.command_receipts to authenticated;
create policy command_receipts_own_read on public.command_receipts for select to authenticated
  using (actor = auth.uid() and public.is_ws_member(workspace_id));   -- 0006 own_user_preferences 와 같은 꼴
```

| 절 | 내용 |
|---|---|
| ① 표·인덱스·RLS | 위. `actor` 열 이름이 `= auth.uid()` 비교와 `is_ws_member` 표지 둘로 스코프로 인정된다(`scripts/lib/rls-scope.mjs`). 쓰기 정책·쓰기 grant 없음. 다른 사람의 `command_id` 로 결과를 재생할 수 없다 — PK·조회·정책 모두 `actor` 를 쓴다. `wbs_import` 영수증은 늘 프로젝트를 가진다(check — 비평 반영 Q14·D35) |
| ② 트리거 | `command_receipts_workspace_scope` — `before insert or update of project_id, workspace_id … execute function public.workspace_scope_from_project()`(0006 함수 재사용 — 다르면 `23514 WORKSPACE_SCOPE_MISMATCH`). `command_receipts_worm` — `before update or delete` → 새 함수 `public.command_receipts_reject_mutation()`(UPDATE 는 늘 `55000 HISTORY_IMMUTABLE`, DELETE 는 `project_id` 의 프로젝트나 `workspace_id` 의 워크스페이스가 이미 없을 때만 통과 — 캐스케이드). `command_receipts_no_truncate` — `before truncate … execute function public.history_reject_truncate()`(0012 함수 재사용). 보존·정리 규칙은 없다(머리 주석 — 거처 SP8, D5) |
| ③ 옛 가져오기 함수 이름 한정(D34) | `create or replace function public.import_wbs(p_project_id uuid, p_items jsonb, p_holidays jsonb)`·`replace_wbs(…)` — 0009 본문(`0009_sp2_isolation_fixes.sql:129-259` — 비평 반영 Q32, `replace_wbs` 는 `:258 end;`·`:259 $function$;` 로 끝난다)에서 표 이름(`wbs_items`·`teams`·`projects`·`item_owners`·`holidays`)만 `public.` 로 한정한다. INVOKER·`search_path` 미지정·ACL 은 그대로(authenticated 실행권 유지 — ⓚ). 사후검사가 본문에 한정 안 된 표 이름이 없는지 본다 |
| ④ `import_wbs_cmd` | 아래 |
| ⑤ `convert_inherited_teams`(D54 — 비평 반영 Q16) | 아래. 이 파일에 두는 이유는 D54(도우미 `actor_is_project_admin` 뒤, 첫 소비처가 가져오기 라우트, `_authz_carry` 는 권한 이월만) |
| ⑥ 권한 | `revoke all on function public.import_wbs_cmd(uuid, uuid, text, jsonb, jsonb, uuid), public.convert_inherited_teams(uuid, uuid) from public, anon, authenticated; grant execute on function … to service_role;` `command_receipts_reject_mutation()` 은 revoke 만 |
| ⑦ 사후검사 | `COMMAND_RECEIPTS_POSTCHECK` — RLS 켜짐·정책 1(SELECT)·anon 권한 0·authenticated 는 SELECT 뿐(열 권한 포함)·정책 없는 DML 0·트리거 셋 활성(`tgenabled in ('O','A')`)·check `command_receipts_project_required`·EXECUTE 기대표(§3.1 — 0012 ⑫ 꼴)·격리 문자열 둘(가져오기·전환)·두 RPC 의 `proconfig` 에 `lock_timeout=15s`·옛 두 함수 본문의 한정 |

**`public.import_wbs_cmd(p_actor uuid, p_project_id uuid, p_mode text, p_items jsonb, p_holidays jsonb, p_command_id uuid) returns jsonb`** — service_role 만 실행, `set lock_timeout to '15s'`. `p_actor` 는 라우트 가드의 `actor.userId`(D51).

1. `p_actor` 나 `p_command_id` 가 null 이면 `22023 COMMAND_ID_REQUIRED`(잠금보다 먼저 — null 키는 잠그지 않는다).
2. `p_project_id` null, `p_mode not in ('append','replace')`, `p_items` 가 배열 아님, `p_holidays` 가 배열도 null 도 아님 → `22023 IMPORT_INVALID_INPUT`.
3. `pg_advisory_xact_lock(hashtextextended('import-receipt:' || p_actor || ':' || p_command_id, 0))` → 격리 가드 `IMPORT_RECEIPT_ISOLATION`(놓치는 것: 잠금을 기다리는 사이 커밋된 같은 명령의 영수증 — 못 보면 한 번 더 적용된다).
4. 프로젝트의 워크스페이스(없으면 `P0002 PROJECT_NOT_FOUND`), `actor_is_project_admin` 거짓이면 `42501 IMPORT_FORBIDDEN` — DEFINER 라 RLS `admin_write_items` 가 빠진 자리의 2차 방어선(D17).
5. 요약 = `encode(sha256(convert_to(jsonb_build_object('project', p_project_id, 'mode', p_mode, 'items', p_items, 'holidays', coalesce(p_holidays, '[]'))::text, 'UTF8')), 'hex')`(D34).
6. `(p_actor, p_command_id, 'wbs_import')` 영수증 — 요약이 같으면 `result || {status:'duplicate'}` 를 돌려주고 끝, 다르면 `23505 COMMAND_REUSED`(다른 프로젝트에 같은 id 를 쓴 경우 포함 — D5).
7. `pg_advisory_xact_lock(hashtextextended('wbs-import:' || p_project_id, 0))` — 같은 프로젝트 가져오기 직렬화(D34).
8. `v_count := public.import_wbs(…)` 또는 `public.replace_wbs(…)`.
9. `v_result := {status:'applied', mode, count, command_id}` → 영수증 insert(`workspace_id` 는 4 의 값) → `v_result`.

**`public.convert_inherited_teams(p_actor uuid, p_project_id uuid) returns jsonb`**(D54) — service_role 만 실행, `set lock_timeout to '15s'`. `p_actor` 는 가드의 `actor.userId`(D51).

1. `p_actor`·`p_project_id` 가 null 이면 `22023 TEAM_CONVERT_INVALID_INPUT`.
2. `pg_advisory_xact_lock(hashtextextended('wbs-import:' || p_project_id, 0))`(가져오기의 프로젝트 잠금과 같은 키 — §3.1) → 격리 가드 `TEAM_CONVERT_ISOLATION`(놓치는 것: 잠금을 기다리는 사이 커밋된 같은 프로젝트의 전환 — 스냅샷이 고정된 수준에서는 아래 4 가 그 전용 팀을 못 봐 두 벌을 만든다).
3. 프로젝트의 워크스페이스(없으면 `P0002 PROJECT_NOT_FOUND`), `actor_is_project_admin` 이 거짓이면 `42501 TEAM_CONVERT_FORBIDDEN`.
4. 그 프로젝트의 전용 팀(`teams.project_id = p_project_id`, 비활성 포함)이 하나라도 있으면 `{status:'already'}` 를 돌려주고 끝 — 아무것도 바꾸지 않는다(전제가 깨진 호출 — 동시 재전송·두 번 누른 버튼).
5. 복사 대상 = 그 워크스페이스의 활성 공용 팀 ∪ 그 프로젝트 안의 네 참조 — 그 프로젝트 항목의 `item_owners`, 그 프로젝트 명단 행의 `project_member_teams`, 그 프로젝트 영역의 `area_teams`, 그 프로젝트의 수락 전 초대(`project_invites`, `redeemed_at is null and revoked_at is null`)의 `team_ids` — 가 가리키는 공용 팀(비활성 포함). 대상마다 `teams` 에 `workspace_id`·`project_id = p_project_id`·`code`·`name`·`color`·`sort_order`·`progress_visible`·`active` 를 **원본 그대로** 넣고(`teams_guard` 가 워크스페이스 일치를 본다) 옛 id → 새 id 대응을 둔다.
6. 네 참조를 새 id 로 옮긴다 — 위 범위(그 프로젝트) 안에서만. 초대의 `team_ids` 는 배열 원소를 바꾼다. 범위 트리거(`item_owners_guard`·`area_teams_guard`·`project_invites_guard`·명단 팀 가드)는 같은 프로젝트의 전용 팀이라 통과한다. 전용 팀이 없던 프로젝트라 새 id 와 겹치는 행이 없다(PK 충돌 없음).
7. `{status:'converted', teams: <복사 수>, moved: {item_owners, project_member_teams, area_teams, invites}}`. 복사 수 0(공용 팀도 참조도 없음)이면 아무것도 바꾸지 않은 `converted` 다 — `copyGlobalTeams`(B 에서 이 RPC 에 잇는다 — 재검토 반영 T14)는 그것을 지금 문구("복사할 전역 팀이 없습니다.")의 실패로, `already` 를 지금 문구("이미 프로젝트 팀이 정의되어 있습니다.")의 실패로 낸다(액션 계약 `{ ok, error }` 그대로). 가져오기는 둘 다 성공으로 보고 다음 단계로 간다(§4.4 #6).

**롤백**: `convert_inherited_teams`·`import_wbs_cmd` drop → `import_wbs`·`replace_wbs` 를 0009 원문 바이트 그대로(`sed -n '129,259p' supabase/migrations/0009_sp2_isolation_fixes.sql` 로 떠서 대조 — 0002 가 아니다) → 트리거 셋 drop(재사용 함수 둘은 0006·0012 소유라 남긴다) → `command_receipts_reject_mutation()` drop → 표 drop. 되돌리지 않는 데이터: 영수증(표째 사라진다 — 그 뒤의 재전송은 새 명령으로 적용된다), 전환이 만든 전용 팀과 옮긴 참조(공용 팀 행은 그대로 남지만 참조를 되돌리는 길은 없다 — 프로젝트는 전용 팀을 쓰는 상태로 남는다).

### 3.4 `NNNN_authz_carry`

| 절 | 내용 |
|---|---|
| ① `people.email` 열 권한 | `revoke insert (email), update (email) on public.people from authenticated;` — 세션이 정규형 밖 이메일을 쓰는 유일한 길(`0003_org_core.sql:689-690`)을 닫는다. 앱의 `people` 쓰기는 service_role(`actions/accounts.ts`)과 DEFINER RPC(`upsert_project_member`)뿐이다 — 계획 때 `grep` 으로 다시 확인한다 |
| ② CR-1(비평 반영 — Q15·Q30) | `record_authz_event()` 를 `create or replace`. **명단 행**(`project_members`): INSERT·DELETE 는 지금처럼 `access_role` 이 있는 행만 기록하고 전·후에 `active` 를 더 싣는다. UPDATE 는 `access_role` 이 바뀌거나 **`access_role` 이 있는 행의** `active` 가 바뀌면 기록하고 전·후에 `{access_role, active}` 를 싣는다 — 권한 없는 행(`access_role` null)의 `active` 전환은 기록하지 않는다(지금도 권한 없는 행은 기록 대상이 아니다 — `0012:1044-1054`). **새 분기** `tg_table_name = 'people'`: `people.active` 가 바뀌면 그 인물의 `access_role` 이 있는 명단 행마다 `project_access` 1행(전·후 `{person_active}`). **`people` 분기는 `command_id`·`command_digest` 를 비운다** — 한 명령이 인물의 `people.active` 와 같은 프로젝트 명단 행을 함께 바꾸면 두 기록이 명령 원장 유일 인덱스 `authz_events_command_uq`(`(actor, command_id, kind, target_user_id, target_person_id, workspace_id, project_id) where command_id is not null`, `0012:896-898`)에서 같은 튜플이 되어 23505 로 명령 전체가 실패한다. 비우면 그 인덱스 밖이다(지금 `people.active` 를 바꾸는 명령 RPC 는 없다 — 잠재 함정을 미리 닫는다). 다른 안(같은 명령이 명단 행도 바꾸면 `people` 분기를 건너뛰고 명단 분기에 `person_active` 를 싣는다)보다 단순하다 — 분기 하나에서 두 변수를 null 로 두는 한 줄이고, 다른 안은 트리거가 같은 트랜잭션의 다른 행 변경을 알아야 한다. 트리거 — `project_members` 의 `authz_events_record` 를 `after insert or delete or update of access_role, active` 로 다시 만들고, `people` 에 `authz_events_record_people` `after update of active` 를 더한다. 원인 판정(① 워크스페이스 삭제 중 → 기록 안 함, ② 부모 삭제, ③ 연쇄, ④ 직접)은 그대로. **표시**: `describeAuthzChange`(`src/lib/domain/authzEvents.ts`)가 `active`·`person_active` 를 읽어 세 문구 — 비활성화(관리자 등 권한 이름)·다시 활성·인물 비활성(권한 정지) — 를 낸다. **재검토 반영 — T11**: 세 문구는 사전 키가 아니라 **이 모듈의 한국어 상수 표**(`ROLE_LABEL`·`UNREADABLE` 꼴 — `authzEvents.ts:9-16`)에 더한다 — 모듈과 소비 경로(`actions/authzEvents.ts:71` 의 `summary`)가 한국어 표시 문자열 계약이라, 세 문구만 키로 내면 화면에 키가 그대로 뜨거나 §5.1 밖 `AuthzEventsList.tsx` 를 고쳐야 하거나 세 문구만 언어를 따른다. 권한 이력 표시의 사전 이행은 §9. 지금은 `access_role` 하나만 읽어 활성 전환을 '관리자 → 관리자'로, `{person_active}` 행을 '변경 내용을 읽지 못했습니다'로 보인다. 단위 테스트(`tests/domain/authz-events.test.ts`)와 `tests/rls/authz-events.test.ts`(전·후를 정확히 단언하는 `:89-93`·`:107-110`)의 기대 모양을 같은 과제에서 고친다(비평 실행 §9) |
| ②′ `project_members_guard` — `person_id` 불변(비평 반영 — Q15) | `create or replace` — `project_id` 불변 검사 바로 뒤에 `if tg_op = 'UPDATE' and new.person_id is distinct from old.person_id then raise exception using errcode = '23514', message = 'PROJECT_MEMBER_PERSON_IMMUTABLE'; end if;`. 나머지 본문은 0011 그대로(`0011_authz_hardening.sql:391-441`). 명단 행의 `person_id` 는 세션 열 권한 밖이고 바꾸는 서버 경로도 없지만 기록 트리거의 열 목록(`update of access_role, active`)에도 없다 — 바꾸는 길이 생기면 권한이 기록 없이 다른 사람에게 옮겨 간다(비평 보안 §5) |
| ③ CR-6·FN-3(비평 반영 — Q15) | `apply_project_settings` 를 `create or replace` — `p_unset` 에 `core.level_labels`·`modules.enabled` 가 있거나 **`p_set` 에서 그 키의 값이 JSON `null`** 이면 `22023 CONFIG_INVALID:<키>`(입력 확인이라 잠금 앞, `create_project_with_settings` 와 같은 토큰 꼴). `v_next := (v_values - v_unset) \|\| v_set`(`0012:551`)은 JSON null 을 값으로 넣고, 해석기가 그것을 미설정으로 풀면 `modules.enabled` 가 "토글 전부 켜짐"이 된다. 격리 문자열·`SETTINGS_ISOLATION`·나머지 본문은 그대로. 워크스페이스 RPC(`modules.allowed` unset 허용)는 고치지 않는다. **대조 테스트**(`tests/settings/registry.test.ts`): 레지스트리의 `explicit: true` 키 집합(`settings/defs/project.ts:61,81`) = 마이그레이션 원문(`*_authz_carry.sql` — 접미로 찾는다)의 거부 목록. 뒤 SP 가 explicit 키를 더하면 같은 커밋에서 RPC 를 고쳐야 초록이다 |
| ④ 사후검사 | `AUTHZ_CARRY_POSTCHECK` — `not has_column_privilege('authenticated', 'public.people', 'email', 'INSERT')`·`'UPDATE'`, 트리거 둘의 이벤트·활성, 세 함수 본문의 새 분기 문자열(`people` 분기·`PROJECT_MEMBER_PERSON_IMMUTABLE`·JSON null 거부), EXECUTE 기대표 무변화 |

롤백: 열 권한 grant 복원 → `people` 트리거 drop → `project_members` 트리거를 0012 정의로 → `record_authz_event()`·`apply_project_settings` 를 0012 원문 바이트 그대로(`0012_settings.sql:984-1076`·`:487-578`), `project_members_guard()` 를 0011 원문 바이트 그대로(`0011_authz_hardening.sql:391-441`). 되돌리지 않는 데이터: 그사이 남은 `active` 전환 기록(`authz_events` 는 고칠 수 없다).

### 3.5 격리 맵·픽스처·RLS 테스트

| 파일 | 바꾸는 것 |
|---|---|
| `tests/rls/isolation-map.ts` | `weekly_report_rows: inAP`(D6), `command_receipts: \`t.workspace_id = ${A}\``, `UPDATE_DENIED_BY_GRANT` 에 `command_receipts`·`project_areas`·`area_teams`(authenticated 가 UPDATE 할 열이 없다 — 카탈로그와 양방향 대조, 주석의 "0012 뒤 47개"는 50 으로), `people` 탐침(`:102`)의 열에서 `email` 을 뺀다(③ 뒤 `permission denied` 로 바뀌기 때문 — 실측 G §3.1) |
| `tests/rls/fixture-ws.sql` | 주간 행 insert(`:150-151`)에 `project_id = …c1`·`area_id = …110c`(RLSA). `command_receipts` A 행 하나(행위자 = A 계정, `workspace_id = …aa01`, `project_id = …c1`, `on conflict do nothing`) |
| 복사 insert(`workspace-isolation.test.ts`) | 주간 행·주간 문서·영역·영역-팀·영수증은 authenticated INSERT 가 없어 건너뛴다(카탈로그가 고른다 — 고칠 것 없음). 갱신 탐침은 열 권한이 허용하는 첫 열을 고른다 — 주간 행 = `this_content`, 주간 문서 = `title`(Q13 으로 `updated_at` 이 열 권한에서 빠져 `title` 이 된다). delete 탐침은 42501 이 기대값이라 고칠 것이 없다(`:130-131`) |

새 RLS 테스트(번호 없는 파일명, `asUser`·`set local role service_role` 로 확인, 부트스트랩 계정·표 전체 행 수에 기대지 않는다, 케이스마다 `begin…rollback`, 두 연결 케이스는 전용 워크스페이스를 만들고 `finally` 에서 **그 워크스페이스의 프로젝트 → 워크스페이스 순으로** 지운 뒤(`projects_workspace_id_fkey` 가 RESTRICT — `0003:103`) 남은 행 0 을 단언. 커밋하는 케이스(두 연결·삭제)의 임시 프로젝트는 영역에 전용 팀을 붙이지 않는다. **전환을 커밋하는 케이스**(`team-convert` 의 두 연결)는 정리에서 그 프로젝트의 `area_teams` 를 먼저 지운다 — 전환이 영역 팀을 전용 팀으로 옮겨 놓아 프로젝트 삭제가 `area_teams_team_id_fkey`(K18)에 걸리기 때문이다. 영역 팀 이전의 단언은 단일 연결 rollback 케이스가 맡는다(재검토 반영 — T8, A F-3)):

| 파일 | 케이스 |
|---|---|
| `tests/rls/weekly-areas.test.ts` | W15 — 다른 프로젝트의 동명 영역 id·이슈 영역 id 로 행 insert → FK 위반(23503), 같은 `(report, area)` 두 번 → 23505 · 세션: 주간 행 insert·delete 42501, 구조 열(`area_id`·`project_id`·`report_id`) update 42501, 칸 update 는 멤버 통과·조회 전용 거부, `updated_at` update 42501(열 권한 밖)·칸 update 뒤 `updated_at` 이 트리거 시각(Q13), 주간 문서 insert·delete 42501·`week_start`·`updated_at` update 42501, 영역·영역-팀 쓰기 42501 · 읽기: A 멤버는 A 행을, B 계정은 0행(실시간 인가가 쓰는 같은 정책 — 정책 본문이 직접 술어인지도 단언) · RPC: 세션 실행 42501, service_role 통과, 25001 세 수준·read committed 통과, `WEEKLY_AREAS_REQUIRED`, `exists`, 등급 거부(`WEEKLY_FORBIDDEN`·`AREA_FORBIDDEN`), 시드의 비활성 영역 행 보존(D33) · **교차 프로젝트(비평 반영 — Q11)**: ① 같은 워크스페이스의 P 관리자가 `upsert_project_area(관리자, P, {id: Q 의 영역, active: false}, [])` → `AREA_NOT_FOUND`, Q 영역·그 영역-팀 그대로 ② 같은 워크스페이스의 공용 팀을 `p_teams` 로 넘겨도 Q 영역에 붙지 않는다 · W17 — 영역 추가·재활성이 `p_from_week` 이후 문서에만 행을 만들고 과거 문서는 그대로 · kind 변경·`project_id` 변경(service_role) 23514 · 두 연결: 문서 생성과 영역 추가가 같은 잠금으로 직렬화되어 둘 중 어느 순서든 새 문서에 새 영역 행이 있다 · **삭제(비평 반영 — Q10)**(전용 임시 워크스페이스·프로젝트 — 영역에 **전용 팀을 붙이지 않는다**(팀 선례 `area_teams_team_id_fkey`), 공용 팀은 붙인다): ① 주간 행이 달린 프로젝트 삭제 성공 — 그 프로젝트의 주간 행·영역·문서·영역-팀 0 ② 같은 트랜잭션에서 `weekly_reports_project_id_fkey` 를 다시 만든 뒤 삭제 성공, 따로 `project_areas_project_id_fkey` 를 다시 만든 뒤 삭제 성공(케이스마다 rollback — 다시 만든 FK 가 이름순 맨 앞·맨 뒤 어디로 가든 둘 중 하나는 영역 검사를 주간 캐스케이드보다 먼저 큐에 넣는다. `test:rls` 는 파일 병렬이 꺼져 있다 — `vitest.config.rls.ts:10`) ③ 카탈로그: `weekly_report_rows` 의 `projects` FK 가 정확히 하나이고 열 `(project_id)`·`confdeltype = 'c'` ④ 그 워크스페이스의 프로젝트를 모두 지운 뒤 워크스페이스 삭제 성공, 프로젝트가 남은 워크스페이스의 직접 삭제는 `23503 projects_workspace_id_fkey` ⑤ 행이 달린 영역의 직접 삭제(service_role) 즉시 `23503 weekly_report_rows_area_fk` |
| `tests/rls/command-receipts.test.ts` | 본인 읽기·타인 0행·워크스페이스에서 빠진 본인 0행·B 계정 0행 · 세션 insert·update·delete 42501, anon 0 · service_role 읽기, update·delete·truncate 거부(`HISTORY_IMMUTABLE`), 프로젝트 삭제 캐스케이드 통과(프로젝트를 먼저 지운 뒤 워크스페이스 삭제도 통과) · `WORKSPACE_SCOPE_MISMATCH` · `wbs_import` 인데 `project_id` null → check 위반 23514(Q14) · `import_wbs_cmd`: 세션 실행 42501, `COMMAND_ID_REQUIRED`(아무것도 쓰지 않는다), 같은 명령 2회 = 항목 1벌·두 번째 `duplicate`(W5 의 DB 층), 같은 id·다른 내용·다른 프로젝트 → `COMMAND_REUSED`, 다른 행위자의 같은 id 는 새 명령, 등급 거부, 25001 세 수준, 두 연결 동시 재전송 → 한쪽 `applied`·한쪽 `duplicate`·항목 1벌, 같은 프로젝트 두 replace 직렬화(트리 한 벌), 옛 `import_wbs` 의 세션 실행은 그대로(ⓚ 와 같은 결과). `lock_timeout` 은 사후검사의 `proconfig` 로 본다(15초를 기다리는 케이스는 두지 않는다) |
| `tests/rls/authz-carry.test.ts` | 세션의 `people.email` insert·update 42501(다른 열은 통과) · 권한 있는 명단 행의 `active` 전환이 전·후 `{access_role, active}` 와 함께 1행, 권한 없는 명단 행의 `active` 전환은 0행 · `people.active` 전환이 권한 있는 명단 행마다 1행이고 그 행의 `command_id` 는 null(Q15) · 명단 행 `person_id` update(service_role) 23514 `PROJECT_MEMBER_PERSON_IMMUTABLE` · `apply_project_settings` 의 필수 키 unset 거부(`CONFIG_INVALID:core.level_labels`·`:modules.enabled`)·`p_set` 의 JSON null 거부와 다른 키 unset 통과 |
| `tests/rls/team-convert.test.ts`(새 — D54, 비평 반영 Q16) | 세션 실행 42501, 등급 거부 `TEAM_CONVERT_FORBIDDEN`, 25001 세 수준 · 전용 팀이 하나라도 있으면 `already` 이고 아무것도 바뀌지 않는다 · 전환: 활성 공용 팀과 그 프로젝트가 가리키던 비활성 공용 팀이 code·이름·색·순서·`progress_visible`·활성 그대로 전용 팀이 된다, 그 프로젝트 안의 공용 팀 참조(담당·명단 팀·영역 팀·수락 전 초대의 `team_ids`)가 0 이고 다른 프로젝트의 참조는 그대로다 · **상속 시절 공용 팀으로 명단을 꾸린 담당 팀 멤버가 전환 뒤 가져온 항목의 실적을 고칠 수 있다**(RLS `member_update_actual` — 액션 쪽은 `tests/actions/team-convert.test.ts`) · 두 연결 동시 전환 → 한쪽 `converted`·한쪽 `already`, 전용 팀 한 벌(정리는 위 머리 문장 — `area_teams` 먼저) · **카탈로그 불변식** — `public.teams` 를 참조하는 FK 열 ∪ 이름이 `team_ids` 인 `uuid[]` 열 = RPC 가 옮기는 열(지금 `item_owners.team_id`·`project_member_teams.team_id`·`area_teams.team_id`·`project_invites.team_ids`). RPC 쪽 열은 RPC 본문(`pg_proc.prosrc`)에서 읽는다 — 테스트에 상수로 두면 새 열이 생겨도 목록만 고쳐 초록이 된다. 팀을 가리키는 열을 새로 만드는 SP 는 이 RPC 를 같이 고쳐야 초록이다 — **이름 규칙 안에서**. **한계(재검토 반영 — T8, A F-2)**: 이 검사는 FK 와 열 **이름**(`team_ids`)에 기댄다 — FK 없는 단일 uuid 열(예: SP5 가 회의록 `team_id` 를 FK 없이 만들면), 이름이 다른 uuid[] 열, jsonb 안의 팀 id 는 보지 못한다. 팀을 code 로 가리키는 열 다섯(`minutes.team_code`·`minute_versions.team_code`·`wiki_items.owner_team`·`wiki_topics.owner_team`·`ai_documents.team`)은 전환이 같은 code 로 복사하므로 옮길 대상이 아니다. 그런 열을 만드는 SP 는 이 RPC 와 이 테스트를 같은 커밋에서 고친다(§9) |

### 3.6 리허설

모두 전용 스택(D42)에서 공유 잠금 안. 명령 전문은 계획이 적는다(SP3a Phase A 계획의 리허설 R 꼴). 결과는 `docs/baseline/sp4-e2e.md` 의 리허설 절에 적는다(비평 범위 §3).

| 리허설 | 대상 | 통과 조건 |
|---|---|---|
| R(카탈로그) | 파일마다 — `db reset --version <N-1>` 캡처 r·기본 권한 → 적용 캡처 f → 롤백 캡처 b → `diff r b` 불일치 0·기본 권한 diff 없음 → `psql -1` 재적용 캡처 a → `diff f a` 0 | 세 파일 각각. `NNNN_command_receipts` 의 N-1 은 `NNNN_weekly_areas` 적용 상태. 적용은 그 파일 하나만이다 — 뒤 파일까지 적용된 상태에서 앞 파일만 롤백하면 r·b 가 어긋나고 `_weekly_areas` 롤백은 첫 문장에서 멈춘다(§3.2 롤백 — A F-6) |
| 데이터 업그레이드 — 주간 | `NNNN_weekly_areas` — N-1 에 `…_seed_wide.sql` 커밋 → `migration up` → `…_smoke.sql` → `…_created_fixture.sql`(새 경로로 만든 문서·영역·행 — **code ≠ name 영역 하나**를 만들고 개명까지, 비평 반영 Q33) → 롤백(역순 — 뒤 두 파일이 적용돼 있으면 그 롤백이 먼저다, §3.2 롤백 머리 — 재검토 반영 A F-6) → `…_rollback_check.sql` → 재적용 → 스모크 재실행 | seed_wide 가 덮는 경우: 자유 텍스트 구분, 중복 `(문서, 구분)`(두 행 모두 내용), 앞뒤 공백 구분, 구분 아래 모듈 행(머리표 줄이 붙는다 — 병합 묶음과 행 하나짜리 묶음 둘 다), **번호 목록 칸 + 머리표**(병합 묶음·행 하나짜리 묶음 — 이관 뒤 점검이 구획마다 1부터 읽어 체번·중복 지적 0, 재검토 반영 T4·A F-1), 모듈 = 구분인 행(머리표 없음), 빈 구분 + 모듈(→ 모듈 이름 영역, 머리표 없음), 둘 다 빈 행(→ '기타'), 공백뿐인 칸(다듬지 않고 옮긴다 — Q34. 모듈 행이어도 머리표 없음 — T4·A F-13), 주간행 없는 프로젝트의 기존 영역, 라벨과 code 가 같은 기존 영역(재사용), 비활성 기존 영역의 재사용, 병합 길이(머리표 포함)가 상한 바로 아래. 스모크 = 전후 대조(W19 — 머리표 글자 수 포함)·`area_id` 전부 채움·영역 신설 수. **재적용 스모크는 영역 신설 0**(롤백이 `section` 을 code 로 되살리므로 — Q33) |
| 데이터 업그레이드 — 나머지 둘(비평 반영 — 충실도 F-19) | `NNNN_command_receipts`·`NNNN_authz_carry` 도 위 seed_wide 가 남은 상태(명단 행·인물·설정 행·주간 데이터가 있는 N-1)에서 적용 → 스모크 → 롤백 → 재적용. 시드에 상속 프로젝트(공용 팀으로 꾸린 명단·담당·영역 팀·수락 전 초대) 하나를 더하고 전환 RPC 를 한 번 부른다 | 스모크가 그 프로젝트의 공용 팀 참조 0, 권한 있는 명단 행의 `active` 전환 기록 1을 본다 |
| 사전검사 | `…_precheck_violations.sql` 의 경우마다 `db reset --version <N-1>` → 위반 심기 → `migration up` 이 `WEEKLY_AREAS_PRECHECK` 로 멈추고 `max(version)` 이 N-1 | 병합 뒤(머리표 포함) 20,000자 초과 |
| 스모크 | `…_command_receipts_smoke.sql`·`…_authz_carry_smoke.sql` — 표·트리거·권한·함수 존재, 롤백 트랜잭션 안의 민감도 두 번(트리거 하나 disable, 금지 grant 하나)에서 사후검사가 멈추는지 | `sp4-e2e.md` 리허설 절에 적는다 |
| CI 등가 | 부트스트랩 없이 `supabase db reset --version 0001` → `supabase migration up --local` → `npm run test:rls`(H2 규칙 ⑤ — CI db 잡과 같은 조건, `sp4/*` push 는 CI 를 돌리지 않는다) | 건너뜀 0 |
| 번호 변경 뒤 | rename 한 트리에서 `db:reset` → `dev:bootstrap` → `test:rls` | 빈 커밋 트레일러 |

## 4. 도메인·서버

### 4.1 주간(A1)

#### 4.1.1 도메인 `src/lib/domain/weeklySheet.ts`

- 행 모양: `WeeklySheetRow = { id, reportId, areaId, thisContent, thisIssue, nextContent, nextIssue }`(`section`·`module`·`sortOrder` 삭제), `NewWeeklyRow = { areaId, thisContent, thisIssue, nextContent, nextIssue }`. 영역 모양은 해석기의 `ConfigArea`(`settings/projectConfig.ts:19-22`)를 그대로 쓴다.
- 순수 함수(전부 영역 목록을 받는다 — 상수 없음):
  - `orderAreas(areas)` — `(sortOrder, code, id)` 순(D32).
  - `hasContent(row, cells)` — 술어 하나(비평 반영 — Q37): 주어진 칸 가운데 `trim() !== ''` 인 것이 있는가. 이월의 대기 판정은 `next_*` 두 칸, 표시·시드 보존은 네 칸으로 부른다. 이월·표시·시드가 이 함수만 쓴다.
  - `visibleRows(rows, areas)` — 활성 영역의 행(영역 순) → 내용 있는(`hasContent` 네 칸) 비활성 영역의 행. 시트·점검·PPT·봇 저장소가 같이 쓴다. 화면은 페이지를 읽을 때 한 번 정한 집합을 들고 있고 같은 화면 안에서 행을 빼지 않는다(D32).
  - `rowLabel(row, areas)` — 영역 이름(비활성이면 표지). `rowSectionLabel`·`sectionKeyOf`·`sortWeeklyRows` 는 지운다 — 묶음 키는 `areaId` 하나다(점검과 PPT 가 함께 바뀐다 — D22).
  - `defaultWeeklyRows(areas)` — 활성 영역마다 빈 행.
  - `carryOverRows(prev, areas, mapping?, carryCustom = () => ({}))` → `CarryOverResult = { ok: true; rows } | { ok: false; pending: { areaId, areaName, cells }[]; overflow: { areaId, areaName, cell: WeeklyCellKey, length }[] }`.
  - `areasForTeam(areas, teams, teamCode)` — 그 code 의 팀(전용·공용 모두 — `area_teams_guard` 가 허용하는 범위)이 primary·support 로 든 영역 id 집합. 보고서와 봇이 같이 쓴다(패리티 W18).
- 지우는 상수: `WEEKLY_SECTIONS`·`WEEKLY_TEAM_SECTIONS`·`FALLBACK_SECTION`·`isWeeklySection`(E5). `WEEKLY_CELL_MAX`·셀 키·`applyServerRow` 는 그대로.

이월 규칙(개정 §4.3.3 + R22 + D31):

| 경우 | 결과 |
|---|---|
| 활성 영역 X 의 행이 원본에 있다 | 새 X 행의 `this_* ← 원본.next_*`, `next_*` 는 빈 값 |
| 활성 영역 X 의 행이 원본에 없다(그 뒤 추가·재활성 — 연휴로 건너뛴 주 포함) | 빈 행. 오류가 아니다 |
| 원본 행의 영역이 지금 비활성이고 `next_*` 에 내용이 있다(`hasContent` 두 칸) | `pending` — `mapping` 에 그 영역이 없으면 **전체 거부**(문서를 만들지 않는다) |
| 원본 행의 영역이 지금 비활성이고 내용이 없다 | 무시 |
| 매핑 → 활성 영역 Y | Y 의 `this_*` 에 덧붙인다(앞뒤 공백·개행을 걷고 `'\n'` 로) |
| 매핑 값이 이 프로젝트의 활성 `weekly_section` id 도 `'skip'` 도 아니다(그새 비활성·이슈 영역·다른 프로젝트 id)(비평 반영 — Q37) | 그 영역을 다시 `pending` 으로 돌려준다 — 오류가 아니다. 화면은 같은 매핑 창을 다시 연다 |
| 매핑의 **키**(원본 영역)가 대기 목록(`pending` 의 영역)에 없다(재검토 반영 — B P3-5: 키 규칙과 값 규칙을 나눈다) | 그 키는 무시한다 — 오류가 아니다 |
| 여러 비활성 영역을 같은 Y 로 보낸다·Y 자신의 이월분이 있다(비평 반영 — Q37) | 덧붙임 순서 = Y 자신의 이월분 → 매핑된 영역을 `orderAreas` 순으로 |
| 매핑 → `'skip'` | 옮기지 않는다 — 원본 문서는 바뀌지 않으므로 유실이 아니다 |
| 덧붙인 칸이 20,000자를 넘는다 | `overflow` — 전체 거부. 자르지 않는다(D31 — 개정 §4.3.3 의 "상한에서 자름"과 다름, E25) |
| 원본 행의 영역이 프로젝트 영역 목록에 없다 | FK 가 막아 생기지 않는다. 방어적으로 `pending` 과 같게 다룬다 |
| 사용자 정의 값 | 새 행의 `custom` = `carryCustom(원본 custom)` — SP4 에는 열이 없어 늘 `{}`, 시드에 싣지 않는다. SP5c 가 채운다. **개정과 다름(비평 반영 — Q22, E28)** — 개정 §4.3.3 은 `p_seed` 가 `custom` 을 통과시킨다고 했다. 받는 쪽: SP5c 가 `create_weekly_report` 를 다시 만든다(§9) |
| 금지 | 첫 영역·폴백 흡수, 절단, 원본 수정 |

#### 4.1.2 데이터 `src/lib/data/weeklySheet.ts`

- `getWeeklySheet(projectId, weekStart)` → `{ report, rows } | null` — 문서와 행을 읽기만 한다(`ensureStandardRows` 삭제 — W16). 행은 `report_id` 와 `project_id` 로 거르고 임베드를 쓰지 않는다. 영역은 호출부가 `getProjectConfig(pid).areas.weekly_section` 으로 읽는다(D43).
- `findCarryOverSource(projectId, before)` — 의미 그대로(가장 최근 이전 문서 하나). 행 임베드의 참조 정렬(`sort_order`)을 빼고 앱이 `visibleRows` 로 정렬한다. `hasCarryOverSource` 의 `weekly_report_rows(count)` 임베드는 그대로(FK 하나 — W21).
- **비평 반영 — Q35.** 지운 열을 쓰는 곳은 마이그레이션 커밋 뒤의 코드 커밋에서 바꾼다(D23): 명시 select 넷(`data/weeklySheet.ts`·`repositories/supabase/weekly.ts`·`ai/index/content.ts`·`actions/weekly.ts:236` — `prepareWeeklyCellRewrite` 의 라벨 조회), `sort_order` 정렬 넷(`repositories/supabase/weekly.ts:58`·`ai/index/content.ts:166`·`data/weeklySheet.ts:67,93`), 임베드 넷(`data/weeklySheet.ts:65,90,116`·`actions/weekly.ts:179`). `rowsInProject` 는 `weekly_reports!inner(project_id)` 임베드 대신 행의 `project_id` 를 본다. 정적 가드 `tests/invariants/weekly-row-columns.test.ts` 가 주간 행 문맥(위 파일들의 `weekly_report_rows` select·order 문자열)에서 `section`·`module`·`sort_order` 0 을 본다 — 열 drop 뒤 PostgREST 의 42703 은 런타임에서만 나고 Supabase mock 테스트는 못 잡는다(비평 실행 §3).

#### 4.1.3 액션 `src/app/actions/weekly.ts`·`projectAreas.ts`

| 액션 | 가드 → 관문 → 검증 | 하는 일 |
|---|---|---|
| `createWeeklyReport(projectId, weekStartIso, carryOver, mapping?)` | `requireProjectAdmin` → `requireModule({ projectId }, 'weekly')` → 입력(주 날짜, `mapping` 은 uuid → uuid\|`'skip'` 모양만 — 대상의 뜻은 `carryOverRows` 가 판정한다, Q37) | `mondayIso` 정규화 → `getProjectConfig` 의 주간 영역(0개면 RPC 를 부르지 않고 `CONFIG_REQUIRED`) → 이월이면 `findCarryOverSource` → `carryOverRows` → `pending`·`overflow` 면 `{ ok: false, code: 'CARRY_PENDING', … }` → 시드 → `create_weekly_report`(`adminFor({ projectId }).admin`, `p_actor` = 가드 결과의 `actor.userId` — D51) → 결과(D43). 보상 삭제(`deleteReportIfEmpty`) 삭제. 이월 원본 조회 실패는 중단(원본 없음과 구분 — 에러 3원칙 ②). 원문 대신 고정 문구 — `errMsg(e)` 보간 둘(`:103,125`)도(Q20) |
| `upsertArea(projectId, input)` | `requireProjectAdmin`(모듈 `null` — D25) → 입력 모양 → `validateArea` → 팀 id ⊆ (그 프로젝트의 `projectTeams` ∪ 그 영역에 이미 배정된 팀)(§4.1.8 — 재검토 반영 A F-5, 선행 조회 실패는 중단) | `upsert_project_area`(`p_actor` = 가드 결과의 `actor.userId` — D51, `p_from_week = mondayIso(seoulToday())` — SP4 는 주 계산 사본을 새로 만들지 않는다, W30) → `revalidatePath('/(app)/p/[projectId]/settings', 'page')`·`('/(app)/p/[projectId]/weekly', 'page')`. 오류는 D45 표 |
| `listAreas` | — | 삭제 — 호출처 0, 설정 페이지가 `cfg.areas` 를 넘긴다(매니페스트 같은 커밋) |
| `saveWeeklyCell(s)`·`saveWeeklyTitle` | 그대로 | 행 id 그대로(개정 §4.3.2). 열 권한(D27)이 구조 열 쓰기를 막는다. **비평 반영 — Q13·Q20**: `updated_at` 대입을 지운다(`:161,319,384` — 트리거가 채운다, 열 권한 밖이라 남기면 42501). 원문 반환(`:164,322,387→393`)을 고정 문구로 |
| `prepareWeeklyCellRewrite` | 그대로 | 라벨을 영역 이름에서 — 지운 열을 읽던 select(`:236`)를 행의 `area_id` + 영역 조회로(Q35) |

`src/lib/domain/areas.ts` 의 `validateArea` 는 그대로 두고 "담당 팀 0개 허용(소비처 없는 SP1)" 주석만 고친다 — 주간 영역은 담당 팀 없이도 쓸 수 있다(봇 팀 필터에서 빠질 뿐).

#### 4.1.4 출력 — 주간 PPT

`GET /api/report?source=sheet&week=` 는 세션 → 프로젝트 판정 → `requireModule weekly` → `getProjectConfig`(실패 503 — 기본 갈래 관례) → `getWeeklySheet`(쓰기 0) → 네 칸이 모두 비면 400(지금 문구) → `buildSheetSections(rows, areas)` → `fillSheetTemplate`. 페이지 = `visibleRows` 의 행(영역 순), 머리 = 영역 이름. 11구분 고정 페이지와 "시트에 없는 표준 구분의 빈 페이지"를 지운다(`sheetNarrative.ts:60`). 렌더러(`templateFill.ts`) 계약은 그대로다. 템플릿 예시 문구(E23)는 첫 출력 과제에서 시트 갈래와 기본 갈래(`/api/report` 의 `format=pptx`) 둘 다로 실측한다. 기본 갈래 주간 보고서(`format=xlsx`·`pptx`)는 SP4 가 팀 원천(A2)·`weightOf`(§4.5)를 고치는 출력이라 S10·부정 테스트 대상이다(D8).

#### 4.1.5 봇

- `src/lib/ai/tools/weekly.ts`: 팀 필터 = `areasForTeam(cfg.areas.weekly_section, cfg.teams, team)`(D24 — 같은 code 의 팀 id 가 primary·support 로 든 영역). 등록 판정은 `projectTeams(pid)`(D19 의 규칙, 비활성 포함 — 지금 `isRegisteredTeamCodeForProject` 와 같은 넓이). 등록되지 않은 팀은 "알 수 없는 담당팀입니다.", 영역이 0개면 "'{팀}' 팀이 맡은 주간보고 영역이 없습니다 — 프로젝트 설정의 업무영역에서 담당 팀을 지정하세요."(영역 용어 — 지금 `:44` 의 "업무영역 구분 체계" 문구 삭제). 동명 구분 폴백 삭제. `section` 인자는 이름을 그대로 두고 뜻을 "영역(이름 또는 code, 앞뒤 공백·대소문자 무시 일치)"으로 고친다(플래너 계약 — SP8). 레코드와 출처 제목은 영역 이름.
- `compare_weekly_sheets`: 집계 키 = `areaId`, 정렬 = 영역 순서. 비교 레코드에 `areaId` 를 싣고 증거 매칭(`ai/chat/evidence.ts`)을 영역 id 로 — 영역을 개명해도 같은 영역이다(W14).
- 저장소 `repositories/supabase/weekly.ts`: 행 select 열을 새 모양으로, 영역은 같은 클라이언트로 `project_areas` 에서. 백필 없음 단언(`tests/repositories/core-read.test.ts`) 유지.
- 월요일 강제(`tools/weekly.ts` 의 `getUTCDay() !== 1`, 라우터 `mondayOf`)는 그대로(SP5).
- 도구 층 센티널(비평 반영 — Q19): weekly 도구·`compare_weekly_sheets` 의 레코드(LLM 없이 결정적)를 합성 구성으로 만들어 SP4 센티널 0 을 단언하는 케이스를 부정 테스트 1 에 둔다(D7). LLM 답은 SP8.

#### 4.1.6 AI 색인·다시 쓰기

`ai/index/content.ts` 의 `loadWeeklyReport` 는 `area_id` 를 select 하고 영역 이름으로 `## {영역}` 머리를 쓴다(열 drop 에 런타임에서만 깨지는 지점 — 실측 W §5.5). 셀 저장이 `weekly_reports.updated_at` 을 올리지 않아 색인 신선도 판정이 셀 변경을 못 보는 기존 구멍은 SP4 밖이다(§9).

#### 4.1.7 실시간

`WeeklySheetView` 의 `fromRecord` 는 `area_id` 로 행을 만든다. 화면이 모르는 `area_id` 의 INSERT 면 `router.refresh()`(D44). DELETE 는 `old.id` 그대로(REPLICA IDENTITY 기본). 채널·필터(`weekly-rows-<reportId>`, `report_id=eq.`)는 그대로. 실시간 병합은 표시 집합을 다시 계산하지 않는다 — 비활성 영역 행의 마지막 칸이 비어도 그 화면에서는 행을 남기고, 다음에 페이지를 읽을 때 숨긴다(D32 — 비평 반영 Q37).

#### 4.1.8 주간 영역 편집기(D26)

설정 페이지의 '팀·업무영역' 범주에 `ProjectAreasManager` 를 `kind="weekly_section"` 고정으로 다시 붙인다(이슈 영역 탭은 숨김 — SP5). 기능만 붙이고 SP3b 패턴 이행(상태 계약·빈 상태·12px/uppercase)은 SPU3 다(D52 — 비평 반영 Q8). 영역·팀은 페이지가 `getProjectConfig` 로 읽어 넘긴다(팀 선택지는 §4.2 의 프로젝트 팀 + 이미 배정된 비활성 팀). 전환(D54)이 영역 팀 참조를 전용 팀으로 옮긴 뒤로는 화면이 공용 팀을 보이지 않는다. **서버도 막는다**(재검토 반영 — A F-5): `upsertArea` 가 `p_teams` ⊆ (그 프로젝트의 `projectTeams` ∪ 그 영역에 이미 배정된 팀)을 검사한다 — 편집기 선택지와 같은 집합이고, 전환 전에 연 낡은 화면이 공용 팀 id 를 보내도 "목록 밖 공용 팀 배정"(같은 code 의 공용·전용 팀이 한 영역에 함께 걸리는 상태)을 만들지 않는다. DB 가드는 같은 워크스페이스 공용 팀을 늘 허용하고 "전용 팀이 있으면 공용 제외"는 앱 계층이다(`0003:490`). 선행 조회가 실패하면 중단한다(에러 3원칙 ②). 명단 액션의 같은 검사는 §9. 이미 갈라진 프로젝트는 그대로다(D4). 새 영역의 code 입력은 이름으로 미리 채우고 고칠 수 있게 하며 저장 뒤 불변이다(트리거). 저장은 `upsertArea` → RPC. 비활성화는 "이번 주 이후 시트에서 숨겨지고 내용은 남는다"를 안내한다. RPC 는 활성 영역을 저장할 때마다 현재 주 이후 문서를 채우므로(§3.2 RPC 6), 이관이 재사용하지 않은 기존 영역(행이 없는 영역 — 로컬 DB 의 1행 같은 경우)은 편집기에서 한 번 저장하면 행이 생긴다. `settings-page-visibility.test.tsx:72-75` 의 부재 단언을 "주간 영역 편집기는 있고 이슈 영역 탭은 없다"로 바꾼다.

#### 4.1.9 모듈 관문(D25)

- `upsertArea` 는 매니페스트 `null`·`projectAdmin` 그대로이고, 기존 닫힌 목록에 한 줄을 더한다(비평 반영 — Q9): `NULL_TABLE_ALLOW['src/app/actions/projectAreas.ts#upsertArea'] = { tables: ['weekly_report_rows'], why: '영역 추가·재활성은 모듈이 꺼져도 현 주 이후 문서에 행을 만든다 — 다시 켰을 때 행이 있어야 한다(R25)' }`. 매니페스트 형(`GateEntry`)은 바꾸지 않는다.
- `tests/gates/_rpc-tables.ts`: `create_weekly_report → [weekly_reports, weekly_report_rows]`, `upsert_project_area → [project_areas, area_teams, weekly_report_rows]`, `import_wbs_cmd → [wbs_items, item_owners, holidays, command_receipts]`, `convert_inherited_teams → [teams, item_owners, project_member_teams, area_teams, project_invites]`, 그리고 `module: null` 항목 본문이 부르는 리터럴 RPC(설정·생성·명단·계정·초대 — 첫 판은 계획의 첫 게이트 과제가 null 항목 파일에서 뽑아 만들고 수를 계획에 적는다). `tests/invariants/_ast.ts` 의 `tablesInNode` 가 `.rpc('x')` 를 이 표로 바꿔 표 목록에 합친다 — 액션 축(`deny.test.ts`)과 라우트 축(`deny.routes.test.ts`)이 함께 쓴다. 표에 없는 RPC 이름은 `module: null` 항목 본문에서만 실패로 세고, 모듈 항목이 부르는 RPC(위키·회의록 등)는 대응이 없으면 건너뛴다(모듈 관문이 먼저 닫는다 — 닫힌 목록의 대상이 아니다).

### 4.2 팀 원천·이름 매칭·개명·예약어

#### 4.2.1 요청 범위 원천 `src/lib/teams/source.ts`(D19·D36)

| 함수 | 원천 | 규칙 |
|---|---|---|
| `projectTeams(projectId, opts?)` | `getProjectConfig(pid, opts).teams` | `resolveTeamsForProject` — 전용 팀이 하나라도(비활성 포함) 있으면 그것만, 없으면 그 워크스페이스 공용. 순서 `activeCodes` 와 같은 `(sortOrder, code ko)` |
| `projectOwnTeams(projectId, opts?)` | 같은 조회 | 전용 팀만(가져오기의 `inheritsCommon` 판정·설정 화면) |
| `workspaceTeams(workspaceId, opts?)` | `teams` where `project_id is null` | 공용 팀(설정 화면·가져오기 409 의 상속 공용 팀 목록·B 의 `w/[slug]/layout.tsx` — 활성만). 복사는 전환 RPC 가 DB 안에서 한다(D54) |
| `teamCodesVisibleTo(view, opts?)` | 보이는 워크스페이스의 공용 + 보이는 프로젝트의 전용, `fetchAllPages` | 기존 순수 함수 — 회의록·챗·외부 회의록 API |

- 여러 워크스페이스 접근자(`activeTeamsForWorkspaces`)는 만들지 않는다(비평 반영 — Q23). UI-2b 뒤 `(app)/layout.tsx` 는 팀을 싣지 않고 워크스페이스 팀은 `w/[slug]/layout.tsx` 가 한 워크스페이스씩 싣는다(SP3b §5.4.1). UI-2b 결과에 여러 워크스페이스 소비처가 남으면 B 착수 때 그때 더한다.

- 캐시는 요청 범위 `react cache` 하나(모듈 수준 상태 없음 — `project-isolation` 테스트(`tests/settings/project-isolation.test.ts`)가 `src/lib/settings/**` 에 거는 정적 단언을 A1 은 `src/lib/teams/source.ts` 하나에, B 는 `master.ts` 를 지운 뒤 `src/lib/teams/**` 전체에 건다 — `master.ts` 는 B 까지 프로세스 전역 캐시라 디렉터리째 걸면 바로 빨갛다, 재검토 반영 B P3-7). 워커·봇 잡·외부 API 는 `{ client: adminFor(…).admin }`.
- 조회 실패는 `TeamsUnavailableError` — 챗 라우트는 지금의 503 `TEAMS_UNAVAILABLE` 을 그대로 쓰고, 화면·라우트는 설정 조회 실패와 같은 처리(빈 목록으로 위장하지 않는다).
- A1 은 이 모듈을 만들고 가져오기 라우트·설정 페이지·주간 도구가 쓴다. A2 가 나머지 비화면 소비처 23파일을 옮긴다(§2.3). 테스트는 공용 도우미 `tests/helpers/teams-source-mock.ts` 로 mock 한다.

#### 4.2.2 봇 이름 매칭(A2)

`router.ts` 의 `teamFromCodes(message, codes)` 를 `teamFromTeams(message, teams: { code, name }[])` 로 — 매칭 대상 code ∪ name(경계 규칙은 지금과 같다), 반환은 code, 한 문자열이 서로 다른 팀의 code·name 에 걸리면 모호로 보고 추출하지 않는다. 별칭은 없다. 원천 `teamCodesFor` 는 프로젝트면 활성 `projectTeams`, 아니면 `teamCodesVisibleTo(teamViewOfScope(scope))`(개정 §4.8). 조사 붙은 코드('가공팀')는 SP8.

#### 4.2.3 개명(D37)

`updateProjectTeam(projectId, teamId, patch)`·`updateTeam(id, patch)` 의 patch 에 `name`. 검사: 앞뒤 공백 제거·1~40자·예약어 아님(D38)·같은 범위 다른 팀의 code·name 과 겹치지 않음(선행 조회 실패는 중단 — 에러 3원칙 ②). DB 제약은 더하지 않는다(경합은 봇 모호 거부가 맡는다 — §10). `Team.name` 주석을 고친다. 화면의 개명 입력은 B(D52).

#### 4.2.4 예약어(D38)

`src/lib/excel/headerWords.ts` 의 `EXCEL_HEADER_WORDS`(빌더 머리 낱말 '담당'·'산출물'·'계획'·'시작'·'종료'·'가중치'·'실적%'·'계획%'·'계획대비%'·'상태'·'Biz' 등과 감지기의 논리·담당 별칭 — 지금 흩어진 문자열의 단일 출처) → `reservedTeamNames({ levelLabels, extraAxisLabel })` → `normalizeNewTeamCode(input, reserved)`. `addProjectTeam` 은 그 프로젝트 설정의 단계 이름·추가 축 이름을 더해 보고, `addTeam`(공용)은 머리 낱말만 본다. `RESERVED_TEAM_NAMES` 상수는 지운다.

#### 4.2.5 미등록 팀(D4) — §4.4 표의 6단계, 상속 공용 팀 전환 RPC 는 §3.3(D54)

### 4.3 Excel 표준 레이아웃·경로 하나(A2)

| 항목 | 내용 |
|---|---|
| 순서 | ① **상태 열 머리** — 두 빌더(`export.ts`·`exportWithProfile.ts`)의 상태 열에 머리 '상태'를 더하는 별도 커밋(감지·왕복 테스트를 같은 커밋에서 고친다 — `상태` 는 예약어라 팀 열로 감지되지 않는다). 뒤 계산 열 머리의 어긋남('계획대비%'·'진척')은 감지 낱말 호환 때문에 그대로 둔다(D16) ② 표준 프로파일·접기 선택지·동등성 테스트 ③ 라우트를 한 경로로 ④ **비평 반영 — Q31**: 동등성 통과 뒤 `buildWbsAoa`·`resolveTeamColumns` 원문을 `tests/fixtures/excel/legacyBuild.ts` 로 옮겨 오라클로 남기고(런타임 import 금지 가드 한 줄 — `no-runtime-constants` 의 패턴 `fixtures/excel/legacyBuild`), `export.ts` 삭제·fixture 이동 |
| `deriveStandardExcelProfile(teamColumns, levelLabels)` | `src/lib/excel/standardProfile.ts`. `L = levelLabels.length`, `teamsStart = 1 + L + 2`, `base = teamsStart + n`. `{ sheetName: 'WBS', holidaySheetName: 'Holiday', headerRow: 2, hierarchy: { kind: 'columns', columns: [1..L] }, logical: { extraAxis: 0, code: null, name: null, deliverable: base, start: base+1, end: base+2, weight: base+3, actualPct: base+5 }, teamColumns: teamColumns.map((c, i) => [teamsStart + i, c]), ownerMarks: { '●': 'primary', '△': 'support' } }`(마크는 정확히 둘 — 기본 마크 다섯을 쓰면 fixture 와 다르다) |
| 팀 열 | `resolveTeamColumns(items, activeCodes(projectTeams))` — 활성 프로젝트 팀 코드 뒤에 트리 담당에 처음 나온 팀(비활성·sub-act·프로젝트 목록 밖 공용 팀 포함)을 등장 순으로. `export.ts` 에서 `standardProfile.ts` 로 옮긴다 |
| 깊은 트리 | `buildAoaWithProfile(…, { expandSubActs, levelLabels, deep: 'fold' \| 'reject' })` — 표준은 `'fold'`(이름을 마지막 계층 열에 — 옛 `export.ts:83` 과 같다), 저장 양식은 `'reject'`(지금 문구 그대로 — 저장 양식에는 맞는 처방이다). 표준 경로에서 빌더가 거부하면 그것은 결함이라 500 고정 문구 + 로그. 펼침에서 sub-act 는 ~~깊이와 무관하게~~ 깊이가 계층 열 수 이상일 때만 `insertAt`(마지막 계층 열 + 1)에, 얕으면 제 깊이의 계층 열에 쓰고, 접는 것은 일반 항목뿐이다(비평 반영 — Q40, **정오표(A2 — A2-2 리뷰 정확성 P2)** — D16 행) |
| 라우트 `/api/export` | 세션·가시성 → 설정 1회 → 단계 이름(손상·부재 422/409 그대로) → `getComputedWbs` → 저장 양식이면 그 양식(손상 422, outline+펼침 400), 아니면 표준 → 두 모드 모두 `buildWorkbookWithProfile` → `X-Excel-Layout: standard\|saved`. `'{}'`+펼침 409(`PROFILE_REQUIRED`)와 `buildWbsWorkbook` 분기·팀 캐시 import 를 지운다 |
| 화면 쪽 | `downloadWbsExport.ts` 의 409·`PROFILE_REQUIRED` 매핑 삭제, 400 깊이 문구는 저장 양식에서만 온다. 마법사 완료 화면의 펼침 버튼은 `profileSaved` 와 무관하게 보인다(`importWizard.exportProfileNeedsSaved` 삭제) — **정오표(A2 — U2 226dc7f, A2 최종 리뷰 완료 P3-1)**: 단, 라우트가 쓸 양식(이번에 저장한 양식, 없으면 프로젝트의 저장 양식)이 아웃라인이면 버튼 대신 사유를 보인다(빌더가 아웃라인 + 펼침을 거부해 늘 400 이었다 — 아웃라인 펼침은 §9 SP6). 설정 화면 표기(D48) |
| 저장·교차 검증 | 표준 프로파일은 저장하지 않는다. 임포트 실행이 저장하는 프로파일의 팀 열 ⊆ 그때의 설정 팀 code(개정 §4.6) — 지금 `writeProjectSettingsInternal` 경로는 교차 검증을 돌리지 않으므로(실측 T §1.1) 저장 전 `validateProjectConfig` 를 부른다. **비평 반영 — Q36**: 기준 팀 = §4.4 #3 에서 읽은 설정 팀 ∪ #6 의 등록 결과(전환·새 팀) — 요청 범위 캐시(`getProjectConfig` 의 `cache`)와 무관하게 정한다. 다시 읽으면 캐시가 방금 등록한 팀을 빼 미등록 팀이 든 첫 가져오기의 양식 저장이 늘 실패할 수 있다(비평 실행 §4) |
| fixture | `LEGACY_EXCEL_PROFILE_V1` → `tests/fixtures/excel/legacy-3row-profile.ts`. 테스트 8파일의 import 를 바꾸고 주석 셋(`parseWithProfile.ts:2`·`exportWithProfile.ts:70,82`)도 지운다 — `grep -r LEGACY_EXCEL_PROFILE_V1 src` 0건(W25). 동등성: `deriveStandardExcelProfile(5 레거시 코드, ['Phase','Task','Activity'])` deep-equal fixture(W26) |
| 동등성 테스트 | fixture 오라클(`tests/fixtures/excel/legacyBuild.ts` — 옮기기 전 `buildWbsAoa` 와 같은 원문)과 셀 단위(W23 — 비평 반영 Q31) — L=3·L=5, 팀 `['R&D','Ops']` + 담당이 있는 비활성 팀 1, 깊이 L 초과 항목, 팀 0개면 둘째 머리 행에 '담당' 칸 없음, 접기·펼침(펼침 + 깊은 트리는 sub-act 자리 규칙 — 옛 빌더에 펼침이 없어 기대값은 새로 정한 것이다) |
| 양식 '담당' 열(D39) | `detect.ts` 규칙 6 의 마크 방식 후보에서 '담당' 계열 머리 열을 뺀다. `template.ts` 예시 행의 담당 칸을 비우고 작성법 6행을 "담당 열에는 팀 이름(코드)을 적습니다. ●/△ 는 팀마다 열(머리 = 팀 이름)을 둘 때 씁니다"로. `template.test.ts` 가 감지 결과 `teamColumns = [[8,'*']]` 를 단언 |
| 카탈로그 | `wbs.excel_profile` 의 목표 상태 = **`verified`**(비평 반영 — 충실도 F-17). 개정 §6.1-3 의 네 연결을 실물로 적는다 — ① `SettingDef`·카탈로그 행 ② 편집 UI(임포트 마법사의 저장·설정 화면의 '저장된 양식 비우기')와 표기(D48) ③ 소비처(내보내기·inspect·execute) ④ 테스트(`tests/excel/standard-profile.test.ts`·`tests/api/export-route.test.ts`). 제품 고정 절의 진척 집계 행을 "null 가중치 = 1(루트·하위 동일)"로(`docs/settings-catalog.md:165`) |
| CR-7(D15) | `src/lib/agent/wbsImport.ts` 의 골격 시드가 단계 이름을 쓰기 전에 `validateProjectConfig`(트리 깊이·팀 열 교차)를 거친다 — 거부는 지금의 `validation_failed` 400 |

### 4.4 가져오기 멱등(A1)

`POST /api/import/execute` 의 순서와 트랜잭션 경계:

| # | 단계 | 트랜잭션 | 실패하면 |
|---|---|---|---|
| 1 | 폼 파싱·검증 — `commandId`(uuid) 필수 | — | 400 `COMMAND_ID_REQUIRED`(고정 문구) |
| 2 | `requireProjectAdmin` | — | 401·403·404 |
| 3 | 프로파일 JSON·검증, 설정 조회(여기서 읽은 설정 팀이 #10 교차 검증 기준의 한쪽), 저장 양식 대조 | — | 400·503·409 `PROFILE_MISMATCH`(지금 그대로) |
| 4 | 파싱·링크 | — | 400 |
| 5 | **영수증 선확인** — 세션으로 `(actor = 나, command_id, 'wbs_import')` 를 읽는다(RLS 본인 행). 있으면 6·7 을 건너뛰고 8 로(판정은 RPC 가 한다). 관문이 아니라 최적화다 — 거짓 양성이면 RPC 가 `COMMAND_REUSED`, 거짓 음성이면 `duplicate` 로 판정한다 | — | 조회 실패는 중단 503(에러 3원칙 ②) |
| 6 | 팀 대조·등록(D4·D54 — 비평 반영 Q16·Q36) — `projectTeams` 로 대조, 미등록이고 `registerTeams=false` 면 409 `needsTeams`(+ `inheritsCommon`·상속 활성 공용 팀 목록). 등록이면 ⓐ 상속 프로젝트(`projectOwnTeams` 0개)는 전환 RPC `convert_inherited_teams` 를 **한 번**(`converted`·`already` 모두 성공으로 본다) ⓑ 미등록 팀을 전용 팀으로 — **"이미 있으면 성공"**(사전 조회 + 23505 → 성공 — `ensureProjectTeams`, `src/lib/teams/register.ts`. 정규화·예약어 규칙은 `addProjectTeam` 과 같다. 클라이언트는 `adminFor({ projectId })` — 새 `createAdminClient` 파일을 만들지 않아 감사표 행이 늘지 않는다). 워크스페이스는 폼 값이 아니라 가드 결과에서 얻는다(지금 `route.ts:135` 처럼) | **밖** — 전환은 그 RPC 한 트랜잭션, 팀 행은 각자 커밋 | 전환 RPC 오류는 D45 의 매핑 — `55P03`(같은 프로젝트의 큰 가져오기가 `'wbs-import:'` 잠금을 15초 넘게 쥔 경우) 503 재시도 가능(라우트 매핑)·`40P01` 503(`mapDbError`)·`TEAM_CONVERT_FORBIDDEN` 403·`PROJECT_NOT_FOUND` 404, 그 밖(`TEAM_CONVERT_ISOLATION`·`TEAM_CONVERT_INVALID_INPUT` 포함)은 로그 + 500 고정 문구. 팀 행 등록 실패는 500 고정 문구(재검토 반영 — T6·A F-7). 만든 팀은 남는다(지금과 같은 성질). 같은 `commandId` 재시도는 팀이 이미 있어 대조를 통과하고 다시 진행한다. **동시 재전송**(첫 요청이 6~8 을 도는 중의 같은 id — 클라이언트 시간 초과 뒤 재시도)도 둘째의 전환은 `already`, 등록은 "이미 있음 = 성공"이라 500 이 아니고 8 에서 `duplicate` 를 받는다(비평 실행 §4) |
| 7 | replace 면 백업 — ~~`fetchAllPages`~~ id 키셋 `fetchAllByKeyset`(D18 — A1 첫 묶음. **정오표(A1 — K2)**: offset 쪽 나눔은 쪽 사이 삽입·이동이 중복 1 + 누락 1 을 같은 행 수로 통과시킨다 — 바뀌지 않는 키 다음부터 읽고 첫 쪽 count·같은 키 두 번에서 throw) | **밖** — 읽기 | 500 고정 문구, RPC 를 부르지 않는다 |
| 8 | `import_wbs_cmd`(service_role, `p_actor` = 가드 결과의 `actor.userId` — D51) — 항목·담당·휴일·영수증이 한 트랜잭션 | **안** | **재검토 반영 — T6**(D45): `40P01` 은 기존 `mapDbError`(`CONFIG_BUSY` 503 재시도 가능). 라우트 자기 매핑 — `55P03` 503 재시도 가능, `PROJECT_NOT_FOUND` 404, `IMPORT_FORBIDDEN` 403, `COMMAND_REUSED` 422. 그 밖 — `IMPORT_RECEIPT_ISOLATION`·`COMMAND_ID_REQUIRED`·`IMPORT_INVALID_INPUT` 처럼 정상 경로에서 나올 수 없는 토큰 포함 — 은 로그 + 500 고정 문구(재시도 표시 없음). 커밋 전 실패는 아무것도 남기지 않는다 |
| 9 | 결과 종류 — `status: 'duplicate'` 면 `kind: 'duplicate'` 로 저장 결과의 건수·모드를 돌려준다 — 백업은 없다. replace 면 경고 "이 실행은 이미 적용되어 있었습니다 — 교체 전 백업은 처음 응답에만 실렸습니다. 실행 전에 받은 백업 파일을 쓰세요"(D50·K9) | — | — |
| 10 | 프로파일 저장(W5, 별도 명령 id) — 중복이어도 요청이면 다시 돈다(같은 값이면 `changed: 0` — 값 기준 멱등). 저장 전 교차 검증의 기준 팀 = #3 의 설정 팀 ∪ #6 의 등록 결과(캐시와 무관 — §4.3, 비평 반영 Q36) | **밖** | 지금처럼 응답의 `profileSave` 경고 |
| 11 | 진척 스냅샷(같은 날 upsert)·색인(`ingestProject` — 지금 상태로 다시 만들고 낡은 것을 지운다) — **결과 종류와 무관하게 늘 돈다**(비평 반영 — Q40: 셋 다 멱등이라 분기가 없는 쪽이 단순하고, 첫 응답이 RPC 커밋 뒤·색인 전에 끊긴 재전송에서도 색인이 빠지지 않는다) | **밖** | 로그 |

- **응답 모양**(비평 반영 — 충실도 F-4, 개정 SP4 블록 "공통 응답 타입은 SP3a"): 성공 `{ ok: true, kind: 'applied' | 'duplicate', commandId, count, mode, … }`(SP3a 의 결과 종류 꼴 — `actions/settings.ts:35-42`), 실패 `{ ok: false, code, error, retryable? }`(503 은 `retryable: true`). `ExecuteResult` 에 `commandId`·`kind` 를 더한다.
- 마법사(`ImportWizard.tsx`): 명령 id 를 "실행 의도" 단위로 상태에 둔다 — 파일·프로파일·모드·저장 여부가 바뀌면 새로 뽑고(`newUuid()`, `NewProjectModal` 패턴), 네트워크 실패·응답 유실이면 같은 id 로 재시도, 409 `needsTeams` 뒤 `registerTeams=true` 재실행도 같은 id(409 는 영수증을 남기지 않는다). `inheritsCommon` 이면 확인 문구 "이 프로젝트는 지금 공용 팀 N개를 씁니다. 등록하면 그 팀들을 같은 코드·이름·색의 이 프로젝트 팀으로 전환하고(담당·명단·업무영역·초대의 팀 연결도 함께 옮깁니다) {미등록 팀} 을 더합니다"와 공용 팀 목록을 보인다. 슈퍼유저 전용 분기(`needsTeamsSuperuserOnly`)와 페이지의 `isSuperuser` prop 을 지운다 — prop 은 `import/page.tsx` → `ImportModes.tsx`(필수 prop·전달) → `ImportWizard.tsx` 로 흐르므로 세 파일을 함께 고친다(재검토 반영 — T2). **replace 사전 백업(D50 — 비평 반영 Q6)**: replace 실행 앞에 백업 단계를 둔다 — `getWbsBackup(projectId)` 로 받은 트리를 지금과 같은 JSON 백업 파일(`downloadBackup` 꼴, 이름에 '실행 전')로 내려받기를 시작한 뒤에야 실행 버튼이 열린다(브라우저는 내려받기 완료를 알리지 않는다 — 재검토 반영 B P3-5). 읽기에 실패하면 실행하지 않는다. 결과 화면의 실행 ID·영수증 링크는 B(#23).
- 읽기 액션 `getImportReceipt(projectId, commandId)`(`src/app/actions/importReceipts.ts`): `requireProjectAdmin` → 세션으로 본인 영수증을 **`.eq('project_id', projectId)` 로** 읽는다(비평 반영 — Q14: 다른 프로젝트의 같은 id 는 `receipt: null` — 그렇지 않으면 P 화면이 Q 의 결과를 "이 프로젝트의 실행"으로 보이고 SPU1 의 결과 불명 판정이 틀린다) → `{ ok: true, receipt: { commandId, mode, count, createdAt } \| null }`. 매니페스트 `null`(core)·`projectAdmin`. SPU1 의 결과 조회(OutcomeUnknown)도 이 액션을 쓴다.
- 읽기 액션 `getWbsBackup(projectId)`(`src/app/actions/importBackup.ts` — D50): `requireProjectAdmin` → 세션으로 그 프로젝트 `wbs_items` 를 ~~`fetchAllPages`~~ id 키셋 `fetchAllByKeyset` 으로 끝까지(**정오표(A1 — K2)** — 라우트 백업과 같은 원본의 사본이라 같은 규칙) → `{ ok: true, backup: { rows, generatedAt } } \| { ok: false, code, error }`. 매니페스트 `null`(core)·`projectAdmin`.
- 감사 문서(`docs/sp2-admin-client-audit.md` — 비평 반영 보안 §9): 가져오기 라우트 행의 근거를 "`requireProjectAdmin(pid)` 뒤 ① 미등록 팀 등록·상속 공용 팀 전환은 그 pid 의 전용 팀만 만든다(워크스페이스는 가드 결과, `teams_guard` 가 일치 강제 — 전환은 RPC 가 등급을 다시 판정) ② 공용 팀은 그 pid 의 워크스페이스 것만 읽는다 ③ 항목·담당·휴일·영수증은 `import_wbs_cmd`(행위자 등급 재판정) ④ 양식 저장은 `writeProjectSettingsInternal`" 으로 고친다 — 지금 행의 "전역 팀 등록은 requireWorkspaceAdmin…"은 D4 뒤 사실이 아니다. `projectAreas.ts`(A1)·`projectTeams.ts`(B — `copyGlobalTeams` 를 전환 RPC 에 잇는 커밋, 재검토 반영 T14)는 `createAdminClient` 를 계속 쓰면 근거를 고치고, `adminFor` 로 바꾸면 행을 지운다(불변식이 양방향으로 대조한다). 주간 액션은 `adminFor` 만 써서 표에 행이 없다 — 본문 절 'DEFINER RPC 가 등급을 다시 판정하는 경로'에 주간 RPC 둘·가져오기·전환을 적는다(D28).
- `tests/invariants/settings-writes.test.ts` 의 라우트 항목은 `writeProjectSettingsInternal` 호출 수 1 을 지키고 사유의 줄 번호만 고친다(e2e 두 스크립트·`history.ts` 의 참조 수는 §2.3 — Q39).
- 에이전트 가져오기(`import_wbs_upsert`·`/api/v1/wbs/import`)는 영수증을 쓰지 않는다 — 범위 밖(§9).

### 4.5 진척 null 가중치(A2)

- `rollup.ts` 가 `export function weightOf(w: number | null): number { return w ?? 1 }` 를 두고 `overallProgress`(전부 null 분기 삭제 — 결과는 같다)·`siblingWeight`·`trend.ts` 의 루트·하위 계획 곡선이 쓴다. 합이 0 이면 `|| 1` 은 그대로(명시 0 은 0). `report/weekly.ts:373`(이미 `?? 1`)도 `weightOf` 로 — 한 보고서 안의 두 규칙이 하나가 된다.
- `dashboard.ts` 는 `weightOf` 를 import 하지 않는다(W11 — 정적 단언). `dataHygiene.mixedWeight` 주석(`:260-262`)을 "롤업 규칙은 하나다 — 이 경고는 '가중치 미지정 N개' 표시의 근거"로 고친다.
- 새 도메인 함수 `unsetWeightCount(roots)` — 형제 그룹이 일부만 채워진 트리에서 null 가중치 항목 수. 화면 표시는 B(D52).
- 스냅샷은 재계산하지 않는다. 운영 메모(`docs/baseline/sp4-e2e.md`)와 커밋 메시지: "루트 가중치가 섞인 프로젝트만 전환일부터 실적선·SPI·속도·포트폴리오 `trendDelta` 에 계단이 생긴다. 전부 null·전부 값인 트리는 값이 같다".

### 4.6 무범위 조회(A1 데이터 손실 경로·A2 나머지 — 비평 반영 Q5)

모두 `fetchAllPages`(`src/lib/data/paging.ts`) — 정렬은 유일 키로 끝나고 `count: 'exact'`. **정오표(A1 — K1·K2)**: A1 첫 묶음의 두 줄(replace 백업·`getComputedWbs` 손실 경로)과 사전 백업(D50)은 offset 이 아니라 id 키셋 `fetchAllByKeyset`(같은 파일 — 바뀌지 않는 키 다음부터, 첫 쪽 count, 같은 키 두 번·읽은 수 ≠ count 면 throw)이다. `sort_order` 는 형제 안에서만 매겨 이동 한 번에 전역 자리가 수백 칸 뛰므로, offset 쪽 나눔은 쪽 사이 이동이 중복 1 + 누락 1 을 같은 행 수로 통과시킨다(A1-1 리뷰). 형제 정렬은 `computeTree` 가 한다. A2 의 나머지 줄은 같은 위험이 있으면 키셋을 쓴다. 읽는 사이 행이 바뀌면 throw 다(실시간 편집이 잦은 화면에서는 간헐 오류로 보일 수 있다 — 지금은 잘린 배열이 정상처럼 보였다).

| 위치 | 바꾸는 것 | 정렬 키 | 체크포인트 |
|---|---|---|---|
| `api/import/execute` replace 백업 | 끝까지(이 백업이 replace 전 원본의 유일한 사본이다) | `id` | **A1 첫 묶음** |
| `data/wbs.ts` `getComputedWbs` — 손실 경로 | `wbs_items` 끝까지, `item_owners` 는 `wbs_items!inner(project_id)` 로 그 프로젝트만 + 끝까지(빠진 담당이 Excel 의 ●/△ 로 나가 replace 로 되돌아오면 영구히 사라진다) | ~~`sort_order, id`~~ `id` / `wbs_item_id, team_id`(키셋 — 정오표 K1) | **A1 첫 묶음** |
| `data/wbs.ts` `getComputedWbs` — 나머지 | `task_dependencies`·`holidays` 끝까지, 팀 정렬은 `projectTeams` | `id` / `date` | A2 |
| `data/wbs.ts` `getProjectsCompletion` | 접근 가능한 프로젝트의 `wbs_items` 끝까지. 실패는 지금처럼 null(배지 하나 때문에 앱 루트가 멈추지 않게) + 로그. 주석의 "authenticated 전체 읽기 개방" 서술 정정 | `project_id, id` | A2 |
| `data/snapshots.ts` 기록 경로 | `wbs_items`·`holidays` 끝까지 | `sort_order, id` | A2 |
| `data/agentApprovals.ts` `getPendingApprovalCount` | 결재 대기 `limit(500)` → 끝까지, 항목 트리 끝까지 | `id` | A2 |
| 봇 리포지토리 `repositories/supabase/wbs.ts` | 부모 `wbs_items` 끝까지(담당은 임베드라 프로젝트 범위) | `sort_order, id` | A2 |

`tests/data/computed-wbs-merge.test.ts` 의 가짜 빌더에 `range`·`count` 를 더한다(A1). 1,000행을 넘는 경로는 단위 테스트(`tests/data/paging-consumers.test.ts` — A1 이 손실 경로로 만들고 A2 가 잇는다)가 쪽 크기를 줄인 가짜로 본다(끝까지 읽음·count 불일치 throw).

### 4.7 DB 오류 원문(A1·A2)

- 도우미 `src/lib/errors/dbFail.ts`: `failWith(tag, err, message)` — 원문을 `console.error(\`[${tag}] …\`, err.message)` 로 남기고 고정 문구를 돌려준다. 토큰 추출은 기존 `dbToken`, 기존 표에 있는 토큰·40P01 은 `mapDbError`(`src/lib/settings/errors.ts:72,105-114`)를 쓴다(비평 반영 — Q40). 그 표는 늘리지 않고 SP4 의 새 정상 경로 토큰은 호출부 자기 매핑이다(D45 — 재검토 반영 T6).
- 범위(비평 반영 — Q20): A1 — 가져오기 라우트 5곳(`:129,145,164,172,178`), **주간 액션 파일 전부**(`actions/weekly.ts` — `createWeeklyReport` 의 원문·`errMsg(e)` 보간 `:103,125`, `saveWeeklyTitle` `:164`, `saveWeeklyCell` `:322`, `saveWeeklyCells` `:387→393` — `e` 는 PostgREST 원문을 실은 Error 다, `data/weeklySheet.ts:69,71,95`), 영역 액션 `writeError`·`teamFail`(`projectAreas.ts:30-35`), 그리고 A1 이 새로 만드는 DB 읽기·쓰기 파일 셋 — `actions/importReceipts.ts`·`actions/importBackup.ts`(D50 의 `{ ok: false, code, error }`)·`lib/teams/register.ts`(#6 의 등록 실패)(재검토 반영 — A F-10). A2 — `actions/wbs.ts` 32곳/10함수(먼저 `:182` 의 `includes('WORKFLOW_ACTUAL_LOCKED')` 를 `dbToken` 으로), 팀 액션(`projectTeams.ts`·`teams.ts` 의 `팀 … 실패: ${…message}` — `copyGlobalTeams` 의 `복사 실패: ${…message}`(`projectTeams.ts:100`)도 A2 다. B 가 그 함수를 전환 RPC 로 바꾼다 — T14).
- 문구는 기능별 상수(예: "항목을 불러오지 못했습니다 — 잠시 후 다시 시도하세요")로 두고, 액션 계약(`{ ok, error }`)은 그대로다. 화면 사전 매핑(WBS 토스트·칸반)은 B — 그 전까지 영어 화면에 한국어 고정 문구가 뜬다(지금은 DB 원문이 뜬다).
- 원문을 고정한 테스트를 같은 커밋에서 바꾼다: `tests/actions/wbs-update-actual-lock.test.ts:98`, `tests/api/import-execute.test.ts:319-327,355-373,395-404`.
- 회귀 가드 `tests/invariants/no-raw-db-errors.test.ts`(파일 단위 — 위 범위의 파일 전부): 코드 줄(주석·로그 줄 제외)에서 반환 객체의 `error` 값이 `.message`·`errMsg(`·`String(e)` 를 보간하지 않고, 다른 액션 결과의 `${x.error}` 문자열을 그대로 옮기지 않는다(`route.ts:129,145` ← `projectTeams.ts:30,36,41` 꼴). 고정 문구의 통로는 `failWith` 하나임을 단언한다(비평 보안 §7).
- 만지는 액션 파일의 `revalidatePath('/p/${…}', 'layout')` 은 `('/(app)/p/[projectId]', 'layout')` 로 고친다(SP3b D8·반영 지시 22 — `wbs.ts` 10줄·`projectTeams.ts` 3줄, 주간·영역 액션은 §4.1.3, **`project.ts` 5줄(`:250,268,279,291,305`)은 B** — `refreshTeams` 호출을 지우며 그 파일을 만진다, 비평 반영 Q28).

### 4.8 상수 제거·회귀 가드·픽스처

| 체크포인트 | 지우는 것 | `no-runtime-constants.allow.ts`(같은 커밋 — 양방향 검사) |
|---|---|---|
| A1 | `WEEKLY_SECTIONS`·`WEEKLY_TEAM_SECTIONS`·`FALLBACK_SECTION`·`isWeeklySection`·`ensureStandardRows`·`defaultWeeklyRows()`(무인자)·`sectionKeyOf`·`rowSectionLabel`·`sortWeeklyRows` | SP4 다섯 항목(주간 5파일) 삭제, 패턴 `FALLBACK_SECTION` 추가(허용 항목 없음 = 영구 가드) |
| A2 | `LEGACY_EXCEL_PROFILE_V1`(정의·주석)·`DEFAULT_LEVEL_LABELS`(prop 기본값 셋 — `levelLabels` 필수)·`LEGACY_LABEL_ABBR`(단계 배지는 라벨 원문)·`RESERVED_TEAM_NAMES`·`buildWbsAoa`/`buildWbsWorkbook`(원문은 fixture 오라클로 — D16)·`exportWithProfile.ts` 의 `LEGACY_LEVEL_LABELS`(주입 라벨이 늘 있다) | `profile.ts`·`shared.tsx` 항목 삭제, 패턴 `DEFAULT_LEVEL_LABELS`·`RESERVED_TEAM_NAMES`·`fixtures/excel/legacyBuild`(오라클의 런타임 import 금지 — Q31) 추가 |
| B | `teamStyle`·`TEAM_SLOTS`(`team-1..5` 클래스) | 패턴 `teamStyle`·`\b(?:text\|bg)-team-[1-5]` 추가. CSS 쪽은 `token-aliases.test.ts` 의 `DELETED_TOKENS` 가 `--color-team-1..5(-weak)` 를 막는다 |

- 정본 grep(W2) `grep -rE 'WEEKLY_SECTIONS|WEEKLY_TEAM_SECTIONS|LEGACY_SECTION_MAP|DEFAULT_TEAMS|TEAM_COLOR|LEGACY_ORIGIN_PROFILE|LEGACY_LABEL_ABBR' src` 0건은 회귀 가드로 남기고(이미 0건인 넷 포함 — C-1), 현재 식별자 가드(D13)를 B 의 마감 묶음 done_when 에서 함께 본다.
- **센티널** `tests/fixtures/legacy-sentinels.ts`(D8): `LEGACY_SENTINELS = { weeklySections: [11], teamCodes: [5], issueAreas: [8], issueIdPrefix, timezone }` 와 `SENTINELS_BY_SP = { SP4: [...weeklySections, ...teamCodes], SP5: …, … }`, 도우미 `sentinelsFor(sp, registeredNames)` — 등록 이름과 **같은** 센티널만 뺀다(포함 관계로는 빼지 않는다 — 등록 이름 하나가 센티널 여럿을 지우지 않게, 비평 보안 §8). 검사 함수 `findSentinels(text, sentinels)` 는 §6.4 의 일치 규칙(대소문자 구분·영문 코드 경계·마스크 목록)을 한 곳에 두고 거짓 적중 표본 단위 테스트를 둔다(Q39). 원 샘플 ID 토큰은 `tests/report/template-neutral.test.ts` 처럼 유니코드 이스케이프로 적는다. 11구분명·5팀 코드의 센티널 **목록**의 런타임 밖 유일한 사본이다(E5 — 같은 낱말의 일반어 쓰임은 범위 밖, 재검토 반영 T3).
- **테스트 이름**(D47): 주간·WBS·Excel 테스트 가운데 SP4 가 다시 쓰는 것은 합성 영역(실험·데이터·운영 / 공정·안전·품질·자재)·합성 팀(RES·OPS / CIV·MEP·SAF — 공용 픽스처 `tests/fixtures/synthetic/teams.ts`(새))을 쓴다. 이름 치환과 묶음 키 변경은 다른 커밋으로 나눈다(회귀를 놓치지 않게 — 실측 W §7.9). SP4 가 다시 쓰지 않는 WBS·주간 계열 테스트의 팀 코드 리터럴은 §9(SP8)로 넘긴다(비평 반영 — 충실도 F-20). 완료 조건(**재검토 반영 — T3**): SP4 가 다시 쓴 주간·WBS·Excel 테스트 — 계획이 §2.3 의 A1·A2 테스트 목록으로 고정한 파일 — 에서 `grep -lE '생산계획|조업|표준화|설비및L2|관리회계' <그 목록>` 0건. 목록 밖 적중은 범위 밖이다 — 센티널 파일, SP5 소유 `tests/minutes/team-subgroups.test.ts`, 회의록 폴더 이름·이슈 대분류·에이전트 항목·일반어로서의 같은 낱말, `tests/invariants/skill-domain-neutral.test.ts` 의 가드 정규식(지우면 가드가 죽는다). main `81deae9` 에서 `tests` 전체 적중은 35파일이고 대부분이 SP4 밖이라, 전체 0건을 요구하면 SP5·에이전트 테스트를 고쳐야 해 D47 의 좁힘과 부딪친다(재검토 B P1-3).
- **`WbsRow.owners` 계약 불변**: `tests/data/computed-wbs-merge.test.ts` 가 팀 원천을 바꾼 뒤에도 담당 모양(`{ team, kind }[]`)·정렬이 같음을 단언한다.
- 새 코드에 옛 넓은 열 이름 `weekly_sections`(복수)를 쓰지 않는다 — `tests/invariants/settings-writes.test.ts:278` 의 정규식이 막는다(영역 kind 값 `weekly_section` 은 걸리지 않는다).

## 5. 화면

### 5.1 Phase A 의 최소 수정(D41)

시각 패턴은 바꾸지 않는다. 기존 프리미티브(`EmptyState`·`Modal`·기존 버튼)로 기능만 둔다. 화면 파일을 고친 커밋마다 트레일러(§2.4). 이 표 밖의 화면 파일과 UI 위험 파일을 고치지 않았음을 A1·A2 완료 조건이 `git diff --name-only` 로 본다(D41 — 비평 반영 Q25).

| 파일(체크포인트) | 바꾸는 것 | 왜(데이터 계약) |
|---|---|---|
| `p/[projectId]/weekly/page.tsx`(A1) | `getProjectConfig` 로 주간 영역을 읽어 넘긴다 | 라벨·순서·배너가 영역에서 온다 |
| `WeeklySheetView.tsx`(A1) | 행 라벨·순서를 `visibleRows`·`rowLabel` 로. 영역 0개면 '설정 필요' 안내(관리자에게는 설정 링크)와 '기본 시트로 시작' 숨김, 영역이 있으면 빈 시트 설명이 영역 이름을 나열 — `:603` 의 옛 구분 이름 리터럴을 지운다(비평 반영 — Q19: HTML 이 S10 대상이다). `:664` 주석과 열 머리 '구분' → '업무영역'. 이월 응답이 `CARRY_PENDING` 이면 `CarryMappingModal` | `WEEKLY_SECTIONS` 제거·행 모양 변경 |
| `CarryMappingModal.tsx`(A1, 새) | "비활성 영역 X — 대기 N칸: [영역 선택 ▾ \| 옮기지 않음]" 행 목록 + 넘침 목록(D31) → 매핑을 붙여 `createWeeklyReport` 재요청. 다시 `pending` 으로 온 영역(그새 비활성 등 — Q37)은 같은 창에 다시 보인다 | 개정 §4.3.3 UI |
| `WeeklyLintPanel.tsx`·`WeeklyAiRewriteModal.tsx`·`useSheetGrid.ts`(A1) | 묶음 키 `areaId`, 머리는 영역 이름. 붙여넣기 초과 문구의 "구분 n행 고정" → "업무영역 n행" | 묶음 키 변경 |
| `p/[projectId]/settings/page.tsx`(A1·A2) | A1: 주간 영역 편집기 장착(D26)·팀 원천 교체(D19). A2: Excel 표기(D48) | 영역이 0개면 주간보고를 쓸 수 없다 · 조용한 대체 금지 |
| `ProjectAreasManager.tsx`(A1) | `kind` 고정 prop, 저장이 RPC 를 지나는 `upsertArea`, 비활성화 안내 문구. SP3b 패턴은 SPU3(D52) | D26 |
| `ImportWizard.tsx`·`import/page.tsx`(A1) | 명령 id 상태·재시도, `inheritsCommon` 확인 문구(전환 — D54), 슈퍼유저 전용 분기 삭제, replace 사전 백업 단계(D50). A2: 펼침 내보내기 버튼을 `profileSaved` 와 무관하게(아웃라인 양식이면 사유 — §4.3 정오표) | D4·D17·D50·§4.3 |
| `ImportModes.tsx`(A1 — 재검토 반영 T2) | `isSuperuser` prop 전달 삭제(필수 prop·`<ImportWizard … isSuperuser>` — `ImportModes.tsx:12-13,36`) | 슈퍼유저 분기 삭제의 prop 경로(페이지 → 이 파일 → 마법사) |
| `downloadWbsExport.ts`(A2) | 409 `PROFILE_REQUIRED` 매핑 삭제 | 409 소멸 |
| `ExportExcelButton.tsx`(A2 — 재검토 반영 T2) | 실패 키 호출(`exportFailureKey` — `ExportExcelButton.tsx:7,18-21`)과 Excel 표기(D48)를 버튼 쪽에 둘 때 | 409 소멸 · 조용한 대체 금지 |
| `components/wbs/{shared,RowDetailPanel,WbsGanttSheet,WbsProgressLens}.tsx`(A2) | `levelLabels` prop 필수(기본값 삭제), 단계 배지 = 라벨 원문 | 상수 제거 — 런타임 호출부는 이미 값을 넘긴다(실측 T §6) |

### 5.2 Phase B 의 이행(체크포인트 B 하나 — 비평 반영 Q1)

**B — 팀(`ui/sp4-teams`)**(D3·D19)

- `src/lib/domain/teamColor.ts`: `teamStyle(code)` → `teamSlot(team: { id, color })` — `TEAM_PALETTE.indexOf(color.toLowerCase())` 가 0 이상이면 `category-(i+1)`, 아니면 `category-(hash(id) % 8 + 1)`. 슬롯 클래스는 리터럴 여덟 벌(`text-category-N`·`bg-category-N`·`bg-category-N-weak text-category-N`)로 둔다(Tailwind JIT). 채움 위 글자는 UI-1 의 `text-category-fg`. `TEAM_PALETTE`·`pickTeamColor` 는 DB 색 배정용으로 남긴다.
- 소비 17곳/12파일은 code 대신 팀(`id`·`color`)을 받는다 — 클라이언트는 `useTeams()`, 서버는 §4.2 원천. `domain/kanban.ts` 의 `accentDot` 은 팀 목록을 받는다(클래스 문자열 계약은 그대로라 `ProgressBar` API 는 바뀌지 않는다). 개요의 팀별 진척 위젯(`dashboard/TeamProgress.tsx`·`ProgressMatrix.tsx`)도 이 소비처라 색은 B 에서 바뀐다(위젯의 패턴 이행은 SPU3 — D52). 명단의 다중 팀 칩은 지금 팀 색을 쓰지 않는다(`src/components/roster/*` 에 `teamStyle` 0 — 2026-10-01 grep) — 칩 색은 #30 과 함께 SPU3 다.
- `TeamsProvider` 가 `name`·`color` 를 가진 `Team[]` 을 내린다. **비평 반영 — Q23**: UI-2b 뒤 구조대로 `w/[slug]/layout.tsx` 는 그 워크스페이스의 활성 공용 팀(`workspaceTeams(wid)` 의 활성), `p/[projectId]/layout.tsx` 는 `projectTeams`. `(app)/layout.tsx` 는 UI-2b 가 팀 주입을 걷었는지 확인만 한다. 명단 페이지·`DashboardView` 의 원천 한 줄. `refreshTeams` 호출과 `teams/master.ts` 를 지운다(W4). 고칠 화면 목록은 B 착수 때 다시 센다.
- `globals.css` 의 `@theme inline` 팀 별칭 10줄 삭제, `token-aliases.test.ts` 의 `ALIASES` 35 → 25·`DELETED_TOKENS` 에 팀 이름 열 개(W3·W32·W33). 반응형 안전망은 건드리지 않는다.
- 팀 색이 한 번 바뀐다(코드 해시 → 생성 순) — 눈확인 기록에 전후를 남긴다.

**B — 화면(`ui/sp4-screens`, `ui/sp4-teams` 위에 쌓는다)**(D52 — 비평 반영 Q8·Q17)

| 화면 | 하는 일 |
|---|---|
| #15 `/w/[slug]/admin/teams`(UI-2a 가 옮긴 자리) | 팀 개명 입력(D37)·팀 색 칩만. `PageHeader`·`StatusMessage` 상태 계약·12px 미만·uppercase·넓은 자간 제거는 SPU3(D52) |
| #23 `/p/[id]/import` | 결과 화면에 실행 ID(`commandId` 앞 8자)와 영수증 링크(같은 화면의 `?receipt=<commandId>` 가 `getImportReceipt` 로 요약을 보인다), 중복 실행 안내, 단계 표시 패턴. fingerprint·매핑 복원은 출시 후(§8 #7) |
| #25 `/p/[id]/weekly` | 기간(주) 선택 → 영역 행 시트, 채움형 `PageFrame variant="fill"`(스크롤 계약 테스트의 닫힌 목록에 한 줄 — SP3b D19), 상태 문구는 `StatusMessage`, 이월 매핑 창 패턴, 12px/uppercase 제거. **주간 4파일**(`WeeklySheetView.tsx`·`SheetCell.tsx`·`WeeklyAiRewriteModal.tsx`·`WeeklyLintPanel.tsx`)의 하드코딩 색(hex·rgb·팔레트 클래스)을 토큰으로 바꾸고 `tests/css/no-raw-color.test.ts` 의 `ALLOW` 네 줄을 지운다(다크 대비 포함 — 레인 B UI-1 이 "SP4 화면 이행"으로 넘긴 것) |
| 그 밖 | 설정 '팀' 절(`ProjectTeamsManager`)의 개명 입력과 "전역 팀을 상속" 문구 정정(SP3a §10). **재검토 반영 — T14**: 같은 커밋에서 `copyGlobalTeams` 를 전환 RPC(D54)에 잇고 '전역 팀 복사로 시작'(copy)의 확인 문구·성공 토스트를 전환의 실제 결과(같은 code·이름·색의 이 프로젝트 팀으로 바꾸고 담당·명단·업무영역·초대의 팀 연결도 옮긴다, 되돌리지 않는다)로 고친다 — 지금 문구(`ProjectTeamsManager.tsx:24-25`·`:65`)는 연결을 옮기지 않는 복사를 경고한다. A1~B 사이 그 버튼은 지금처럼 팀 행만 복사한다(분열은 지금 그대로 — 회귀가 아니다), WBS 의 "가중치 미지정 N개" 표시(합계 칸 곁 — D20), WBS·칸반 토스트의 오류 문구 사전 매핑(D21 — H2 `removeErrorKey` 꼴), `project.ts` 의 `revalidatePath` 5줄(Q28) |
| SPU3 로 넘긴 것(D52·E33 — 사용자 확인 §8 #5) | #19 개요 위젯의 패턴(`KpiCard`·`SectionCard`·12px/uppercase), #30 명단의 패턴(`PageHeader`·KPI 정리·다중 팀 칩의 팀 색 — 실효 역할 열은 SP3b UI-3 몫), #15 의 머리·상태·글자, `ProjectAreasManager` 의 SP3b 패턴. `projectColors.ts` 는 SP5(회의 화면) |

## 6. 테스트·검증

완료 근거는 행위 테스트다. `grep … 0건` 은 보조 — 부정 테스트·센티널과 함께 통과해야 근거가 된다(개정 §6.1-2). 설정을 읽는 도메인 계약 테스트는 `tests/fixtures/synthetic/configs.ts` 의 세 구성으로 `describe.each` 한다(개정 §6.5.7).

### 6.1 단위·정적(`npm run test`, DB 없음)

| 파일(체크포인트) | 고정하는 것 |
|---|---|
| `tests/domain/weekly-carry.test.ts`(A1, 새) | W12 반례(실험·운영 두 영역의 대기 내용이 각자 자기 영역으로, 첫 영역·다른 영역 흡수 0), W13(비활성 대기 → `pending`·매핑 영역/skip·원본 불변), 원본에 행 없는 활성 영역 = 빈 행, 넘침 → `overflow`(자르지 않음), 앞뒤 개행 다듬기, **Q37** — 활성 `weekly_section` 이 아닌 매핑 값 → 그 영역이 다시 `pending`(오류 아님), 덧붙임 순서(Y 자신 → 매핑 영역을 영역 순), `next_*` 가 공백뿐이면 대기 아님, 세 합성 구성 `describe.each` |
| `tests/domain/weeklySheet.test.ts`(A1, 재작성) | `orderAreas` 동률 결정적, `hasContent`(칸 집합별 — Q37), `visibleRows`(활성 → 내용 있는 비활성, 빈 비활성 숨김), `defaultWeeklyRows(areas)`, 개명 뒤 같은 `areaId`·같은 셀(W14) |
| `tests/data/weeklySheet.test.ts`(A1) | W16 — `getWeeklySheet` 가 insert 를 한 번도 부르지 않는다(지연 백필 세 건은 반전). `tests/data/weeklySheet-carryover.test.ts` 는 행 픽스처를 `area_id` 로 |
| `tests/ui/weekly-sheet-no-areas.test.tsx`(A1, 새 — 비평 반영 충실도 F-24) | W1·W14 의 배너 — 영역 0개: '설정 필요' 안내와 관리자 설정 링크, '기본 시트로 시작' 없음 / 영역 있음: 빈 시트 설명이 영역 이름을 나열(옛 구분 이름 0) · 비활성 영역 행의 마지막 칸을 비워도 그 화면에서 행이 남는다(D32 — Q37) |
| `tests/components/weekly-presence.test.tsx`·`tests/domain/{sheetPresence,sheetSelection}.test.ts`(A1) | 양식 통일·멀티셀 편집/프레즌스 회귀 — 셀 주소(`rowId:col`)·프레즌스가 그대로(행 픽스처만 `areaId` 로, 비평 범위 §3) |
| `tests/actions/weekly-create.test.ts`(A1, 새) | 가드 → 관문 → 검증 순서, 영역 0개 → `CONFIG_REQUIRED`·RPC 미호출, `CARRY_PENDING`, 매핑 재요청, RPC 토큰 → 코드(D45), 원문 비노출(`errMsg(e)` 경로 포함 — Q20), `exists`, RPC 인자 `p_actor` = 가드 결과(D51) |
| `tests/actions/weekly-cells-batch.test.ts`(A1) | 셀·제목 저장이 `updated_at` 을 보내지 않는다(Q13), 원문 비노출(Q20) |
| `tests/actions/project-areas.test.ts`(A1, 재작성) | `upsertArea` 가 RPC 를 부르고 `p_from_week` = 이번 주 월요일·`p_actor` = 가드 결과, 오류 토큰 매핑(`AREA_NOT_FOUND` 404 포함, 입력 토큰은 500 고정 문구 — D45·T6), `p_teams` 가 (프로젝트 팀 ∪ 그 영역에 이미 배정된 팀) 밖이면 RPC 를 부르지 않고 거부·선행 조회 실패는 중단(§4.1.8 — 재검토 반영 A F-5), `listAreas` 없음 |
| `tests/domain/weeklyLint.test.ts`·`tests/ui/weekly-lint-panel-*.test.tsx`(A1) | 묶음 키 `areaId`·머리 = 영역 이름. 이름 치환(합성)과 키 변경은 다른 커밋. **이관 꼴 칸**(`[모듈]` 머리글 줄 + 구획마다 1부터 — 병합·단독 둘)은 체번·중복 지적 0(재검토 반영 — T4·A F-1) |
| `tests/report/sheet-sections.test.ts`(A1, 새)·`sheetNarrative.test.ts`(재작성) | 페이지 = 보이는 행(영역 순), 11구분 고정 페이지 없음, 점검과 PPT 의 묶음이 같다(같은 시트에서 점검 묶음 수 = 페이지 묶음 수) |
| `tests/api/report-route.test.ts`(A1) | 시트 갈래가 설정 조회 실패에 503, 쓰기 0 |
| `tests/ai/tools-weekly-team.test.ts`·`tools-detail.test.ts`(A1, 재작성) | 팀 필터 = `area_teams`(primary ∪ support), 매핑 0 문구, 미등록 팀 거부, 동명 구분 폴백 없음, 비교 키 `areaId`(개명해도 같은 영역), **W18 패리티** — 봇 필터 결과 = 보고서 `buildSheetSections` 의 같은 팀 영역 집합(같은 `areasForTeam`) |
| `tests/ai/golden/*`·`chat-v2-verifier.test.ts`(A1) | 스냅샷 행 모양·영역-팀 픽스처, 비교 레코드의 `areaId` 증거 |
| `tests/ui/settings-page-visibility.test.tsx`·`tests/components/project-areas-manager.test.tsx`(A1) | 주간 영역 편집기 있음·이슈 영역 탭 없음(D26), kind 고정 |
| `tests/api/import-idempotent.test.ts`(A1, 새)·`import-execute.test.ts` | `commandId` 없음 400, 영수증 선확인 뒤 팀 등록·백업을 건너뜀, `kind: 'duplicate'` 응답(백업 없음·경고)과 응답 모양(`kind`·`commandId`·실패의 `retryable` — F-4), `COMMAND_REUSED` 422, `40P01`·`55P03` 503·`PROJECT_NOT_FOUND` 404(Q40), 전환 RPC 의 `55P03` 503 재시도 가능(A F-7), `IMPORT_RECEIPT_ISOLATION`·`COMMAND_ID_REQUIRED`·입력 토큰은 500 고정 문구(D45 — 재검토 반영 T6, `tests/settings/errors.test.ts` 는 무수정), 미등록 팀 → 전용 팀(D4)·상속 프로젝트의 409 `inheritsCommon`·전환 RPC 한 번 뒤 등록(Q16), **동시 재전송 — 둘째가 첫째의 등록·전환과 겹쳐도 500 이 아니고 RPC 에서 `duplicate`**(Q36), **미등록 팀 등록 + 양식 저장 → `profileSaved: true`**(교차 검증 기준 = #3 ∪ #6 — Q36), 중복이어도 스냅샷·색인이 돈다(Q40), 실패 순서(§4.4 표의 각 줄), 원문 비노출 |
| `tests/actions/import-reads.test.ts`(A1, 새) | `getImportReceipt` — 같은 명령 id 의 다른 프로젝트 영수증은 `receipt: null`(Q14), `getWbsBackup` — 쪽 크기를 줄인 가짜로 끝까지 읽음·읽기 실패는 `ok: false`(D50) |
| `tests/actions/team-convert.test.ts`(A1, 새 — D54 · B 가 잇는다) | A1: 가져오기 경로로 전환한 뒤 상속 시절 공용 팀으로 명단을 꾸린 담당 팀 멤버가 가져온 항목의 실적을 `updateActual` 로 고칠 수 있다(액션의 id 재검사 — `actions/wbs.ts:141-145`). B(재검토 반영 — T14): `copyGlobalTeams` 가 전환 RPC 를 부르고 `already`·복사 0개를 지금 문구의 실패로 낸다 |
| `tests/ui/import-wizard-state.test.ts`(A1) | 명령 id 가 입력이 바뀔 때만 새로, 재시도·`needsTeams` 재실행은 같은 id, replace 는 사전 백업의 내려받기를 시작하기 전 실행 버튼이 잠기고 백업 읽기 실패면 실행하지 않는다(D50 — B P3-5) |
| `tests/gates/rpc-tables.test.ts`(A1, 새)·`enumerate`·`deny`·`deny.routes` | `tablesInNode` 가 `.rpc('x')` 를 대응 표로 바꿔 액션·라우트 두 축이 같이 본다, `module: null` 항목 본문의 RPC 가 표에 없으면 실패(모듈 항목은 건너뜀), `upsertArea` 의 `NULL_TABLE_ALLOW` 줄(죽은 항목 검사 포함 — Q9), 새·바뀐 액션의 매니페스트 |
| `tests/invariants/rpc-actor-source.test.ts`(A1, 새 — D51)·`tests/invariants/weekly-row-columns.test.ts`(A1, 새 — Q35) | `p_actor` 의 출처가 D51 의 판정 규칙 (a) 직접 가드 결과 · (b) 한 단계 추적 · (c) 닫힌 허용 목록(사유·죽은 항목 검사) 가운데 하나 — main 의 기존 9곳이 첫날 초록(직접 셋·한 단계 둘·허용 목록 넷 — 재검토 반영 T7), 대상 = 인자 이름이 정확히 `p_actor` 인 마이그레이션 함수(양방향) · 주간 행 문맥에서 지운 열 이름 0 |
| `tests/settings/registry.test.ts`(A1)·`tests/domain/authz-events.test.ts`(A1) | 레지스트리 explicit 키 = `*_authz_carry.sql` 의 거부 목록(Q15) · 권한 이력의 활성 전환·인물 비활성 문구 — 모듈의 한국어 상수(Q30 — 재검토 반영 T11) |
| `tests/negative/sentinels.test.ts`(A1, 새 — 비평 반영 Q39) | `sentinelsFor` 는 등록 이름과 같은 센티널만 뺀다(포함 관계로는 빼지 않는다), `findSentinels` 는 대소문자를 구분하고 영문 코드는 앞뒤가 영숫자가 아닐 때만 적중, 마스크 목록('영업일'·'영업관리팀' — 사전에 그 두 문자열이 있음을 단언해 목록이 낡지 않게), 거짓 적중 표본(`Times New Roman`·영어 낱말 속 코드 글자 등) 0 |
| `tests/negative/weekly-outputs.test.ts`(A1, 새)·`tests/negative/wbs-outputs.test.ts`(A2, 새) | **부정 테스트 1·2(봇 밖, D7)** — 사용자 정의 팀·영역만 있는 합성 구성의 기본 생성 시드·이월·시트 PPT 묶음·**기본 갈래 주간 보고서 모델**(`buildWeeklyReportModel` → `buildWeeklyNarrative`·`buildReportWorkbook` — Q19)·Excel 표준 머리에 SP4 센티널 0건, **봇 도구 층**(weekly 도구·`compare_weekly_sheets` 레코드 — Q19) 0건. 같은 이름을 실제로 등록한 구성(팀 'ERP'·영역 '영업')은 그 이름이 나오고 정상 동작한다 |
| `tests/teams/source.test.ts`(A2, 새) | 노출 규칙(전용 우선·공용 폴백·비활성 포함 판정), 순서, 모듈 수준 상태 없음, 실패 = `TeamsUnavailableError` |
| `tests/ai/chat-v2-router.test.ts`(A2) | W27 — 개명 뒤 새 이름과 code 모두로 추출, W28 — 두 팀의 이름·code 가 겹치면 추출 안 함 |
| `tests/actions/team-rename.test.ts`(A2, 새) | 이름 규칙(D37)·예약어 파생(D38)·선행 조회 실패 중단 |
| `tests/excel/standard-profile.test.ts`(A2, 새)·`export-with-profile`·`export-nlevel`·`split`·`detect`·`template` | W23(fixture 오라클 `legacyBuild.ts` 와 셀 단위 — Q31)·W26 동등성, 상태 머리, 접기, 팀 0개면 '담당' 칸 없음, 양식 감지 `[[8,'*']]`, W24 — 팀 `['R&D','Ops']` 파일 머리에 5팀 코드 0건·detect → parse → link 왕복·N단(L=5) 왕복 |
| `tests/api/export-route.test.ts`(A2) | W22 — `'{}'` 두 모드 → 표준(`X-Excel-Layout: standard`), 저장 양식 두 모드 → 같은 양식(펼침만 다름), 손상 422, outline+펼침 400, 깊은 트리: 표준 200·저장 양식 400, 표준 + 펼침 + 깊은 트리에서 sub-act 는 `insertAt`(Q40) |
| `tests/domain/overallProgress.test.ts`·`rollup`·`trend`·`dashboard`(A2) | W8(`[(100%, w=1), (0%, w=null)]` 전체·하위 모두 50), W9 속성 테스트(`overallProgress(roots)` = 가상 루트의 `computeNode`), W10(루트 계획 곡선 ≡ `overallProgress`), W11(루트 [A null·지연, B 0.5·정상] 에서 `topWeightDelayed === false`, `dashboard.ts` 가 `weightOf` 를 import 하지 않음), `:36-43` 정정, `unsetWeightCount`(형제 그룹이 일부만 채워진 트리의 null 수 — §4.5) |
| `tests/data/computed-wbs-merge.test.ts`·`tests/data/paging-consumers.test.ts`(A1 손실 경로 → A2 나머지) | 쪽 크기를 줄인 가짜로 1,000행 넘는 경로가 끝까지 읽힘, `item_owners` 가 프로젝트로 걸러짐, count 불일치 throw, replace 백업 완전(A1), `getProjectsCompletion` 실패 = null(A2), `WbsRow.owners` 계약 불변 |
| `tests/invariants/no-raw-db-errors.test.ts`(A1 이 주간·가져오기 파일로 만들고 A2 가 `wbs.ts`·팀 액션을 더한다)·`wbs-update-actual-lock.test.ts` | §4.7 |
| `tests/settings/no-runtime-constants.test.ts`(A1·A2·B) | §4.8 의 항목 삭제·패턴 추가 — 양방향 |
| `tests/domain/level-badge.test.ts`(A2) | 단계 배지 = 라벨 원문 |
| `tests/domain/teamColor.test.ts`(B, 새)·`tests/ui/team-style.test.ts`·`tests/domain/kanban.test.ts` | 팔레트 자리 → 슬롯, 팔레트 밖 → id 해시, 여섯째 팀, 클래스 리터럴 |
| `tests/ui/app-layout-teams.test.tsx`(UI-2b 가 다시 쓴 이름)·`tests/authz/project-layout-hiding.test.tsx`(B) | `w/[slug]`·`p/[projectId]` 레이아웃이 요청 범위 원천의 팀(이름·색 포함)을 내린다(Q23) |
| `tests/invariants/teams-source.test.ts`(B — `teams-scope` 대체) | `src` 에 `teams/master` import 0, 접근자 표면 |
| **B 의 이름 있는 테스트 넷**(비평 반영 — Q26) | `tests/ui/import-result-receipt.test.tsx` — 실행 ID 8자·`?receipt=` 가 `getImportReceipt` 결과를 그린다·중복 안내 · `tests/ui/team-rename.test.tsx` — 입력·검증 문구·성공 뒤 목록 · `tests/ui/wbs-unset-weight.test.tsx` — `unsetWeightCount` 결과 표시, 0이면 숨김 · `tests/ui/wbs-toast-dict.test.tsx` — 토큰 → 사전 키, en 렌더에 한글 0자(SP3a CR-13 꼴) |
| B 화면 테스트 | #23·#25 의 상태 계약·12px/uppercase 0(D52 의 화면 파일 목록), 주간 채움형이 스크롤 계약 목록에 있다, `no-raw-color` 의 주간 4파일 줄 없음(Q17) |

### 6.2 실행형(`npm run test:rls`, 건너뜀 0)

§3.5 의 네 파일(전환 RPC 의 `team-convert` 포함)과 바뀐 격리 맵·픽스처·`authz-events` 기대 모양. 전체 `test:rls` 를 A1 의 공통 묶음과 CI 등가에서 돈다. `schema-invariants`·`workspace-isolation-cases`·`h2-table-grants` 는 무수정(§3.1 — merge-base 기준).

### 6.3 로컬 E2E(`scripts/e2e-local.mjs`, 기록 `docs/baseline/sp4-e2e.md`)

서버는 스크래치 워크트리의 3101(3000 금지). A1 은 `next dev`, **A2 부터는 `next build` + `next start -p 3101`**(팀 캐시가 비화면 경로에서 사라졌는지 — D19). **비평 반영 — Q7**: 단계는 번호가 아니라 `step('…')` 의 **이름**으로 부른다 — 지금 스크립트의 번호(가져오기 = `import-append`·`import-replace`, 렌더 = `render-pages`)는 `sp3a-e2e.md` 의 표 번호와도 다르고, 레인 B 가 UI-2 마무리에서 같은 파일에 단계를 합친다(§2.4). 기존 단계 `import-append`·`import-replace` 는 `commandId` 를 싣는다.

| 단계 이름(체크포인트) | 흐름 | 기대 |
|---|---|---|
| `weekly-areas-required`(A1) | 프로젝트 B(팀 QA — 사용자 정의 이름만): 영역 0개에서 `createWeeklyReport` | `CONFIG_REQUIRED`, 문서 0(W1·W14) |
| `weekly-carry-mapping`(A1) | `upsertArea` 로 '실험'(QA primary)·'운영' → 지난주 W0·이번 주 W1 생성 → W1 의 `next_*` 저장 → '운영' 비활성(내용 있음) → 다음 주 W2 이월 → `CARRY_PENDING` → 매핑 {운영 → 실험} 재요청 → '실험' 개명 → 새 영역 '신규' 추가 | W2 의 '실험' 칸에 두 내용, W1 불변, 개명 뒤 같은 `area_id`, '신규' 행은 W1·W2 에만 있고 W0 에 없다(W17) |
| `weekly-outputs`(A1) | B 의 W2 시트 PPT, 기본 갈래 주간 보고서(`format=xlsx`·`format=pptx` — Q19), PostgREST `weekly_reports.select('id, weekly_report_rows(count)')` | 시트 PPT 페이지 = 보이는 영역, 세 출력의 텍스트 파트에 SP4 센티널 0건(부정 테스트 1 — §6.4 의 일치 규칙), 임베드 PGRST201 0(W21) |
| `weekly-registered-names`(A1) | 프로젝트 A(팀 ERP·MES)에 영역 '영업'(ERP primary) → 주차 생성·시트 PPT | 등록한 이름이 PPT 에 나오고 정상 동작한다(부정 테스트 2). 봇 필터 패리티는 단위 테스트(W18 — E2E 는 LLM 플래너에 기대지 않는다) |
| `import-idempotent`(A1) | 새 프로젝트에 append(명령 id K) → 같은 K 재전송 → K 로 replace → `getImportReceipt(K)` → 다른 프로젝트에서 `getImportReceipt(K)` | 항목 1벌·두 번째 `kind: 'duplicate'`(W5), K 로 replace 는 422 `COMMAND_REUSED`, 영수증 요약, 다른 프로젝트에서는 `receipt: null`(Q14) |
| `import-unregistered-teams`(A1) | 공용 팀을 상속하는 프로젝트(공용 팀으로 꾸린 명단 포함)에 미등록 팀이 든 파일 → `registerTeams=false` → `true` | 409 `needsTeams`·`inheritsCommon`·공용 팀 목록 → 공용 팀이 같은 code·이름·색의 전용 팀으로 전환되고(그 프로젝트의 공용 팀 참조 0 — D54) 새 팀이 전용 팀, 팀 목록이 공용 팀 code 를 잃지 않는다 |
| `export-standard`(A2) | 저장 양식 없는 프로젝트 B 의 `/api/export` 접기·펼침 | 둘 다 200·`standard`(지금은 펼침 409), 파일 머리에 SP4 센티널 0 |
| `teams-source-next-start`(A2) | 기존 `project-teams` 단계에서 만든 팀으로 `import-append` 를 `next start` 에서 | 409 `needsTeams` 없음(KLC:56 의 제약 해제) |
| `render-pages`(기존 — A1·A2·B) | 렌더 목록에 `/p/B/weekly`·`/p/B/settings` 를 더한다 | 오류 표식 없음. A1 은 `/p/B/weekly` 서버 렌더 HTML(RSC 페이로드 포함)에 `findSentinels`(마스크 적용)를 돌린 결과를 `sp4-e2e.md` 에 적는다 — A2 의 S10 전에 마스크 목록이 충분한지 한 번 잰다. 적중이 있으면 K12 의 규칙으로 처리한다(재검토 반영 — B P3-2) |
| `teams-color-render`(B — 재검토 반영 T12) | 팀이 있는 프로젝트의 WBS·칸반·회의록·대시보드·보고서 렌더(`next start`) | 오류 표식 없음·팀 슬롯 클래스(`text-category-N`)가 보이고 옛 `team-[1-5]` 클래스 0 — UI 위험 파일(`TeamsProvider`·두 레이아웃)의 깨짐은 빌드·테스트로 잡히지 않는다(CLAUDE.md) |

### 6.4 합성 게이트(`npm run accept:synthetic`)

설정은 화면과 같은 서버 액션·API 로만 넣는다. 실행 전후 `git diff --quiet -- src supabase`. 건너뛴 활성 단계는 실패. 기록은 `docs/baseline/synthetic-acceptance.md`.

| 단계 | SP4 에서 더하는 것 |
|---|---|
| S1 생성(A1) | C 구성에 `weekly`(D40 — 프로젝트 `modules.enabled`·워크스페이스 `modules.allowed` 둘 다). 팀 R `RES`·`OPS`, C `CIV`·`MEP`·`SAF`(`addProjectTeam`), 주간 영역 R 실험·데이터·운영 / C 공정·안전·품질·자재와 담당 팀(`upsertArea`) — 다시 읽은 값이 같다 |
| S2 WBS(A1) | R·C 에 프로파일을 저장하는 가져오기(R 4단·C 3단, 담당 = 그 프로젝트 팀), 같은 `commandId` 재전송 → 항목 1벌·`kind: 'duplicate'`·`wbs.excel_profile` 이력 변경 1건. R 의 4단 파일은 양식 다운로드(3단)로 만들 수 없어 러너가 exceljs 로 직접 만든다(계획에 적는다 — 비평 실행 §9) |
| S4 주간(월)(A1) | C 에서 연속 2주 생성(월요일 키)과 이월, 영역 개명 뒤 같은 `area_id`·같은 셀. R 의 일요일 키는 '미활성(SP5)' |
| S10 부정(A2, 부분 — 비평 반영 Q19·Q39) | R·C 각각 `sentinelsFor('SP4', 그 프로젝트가 등록한 영역·팀 code·name)` — C 는 '품질' 을 뺀다(D8). **대상**(R8 그대로): ① S2·S4 의 액션·라우트 응답 본문(JSON) ② 시트 PPT `/api/report?source=sheet&format=pptx`(두 주차) ③ 기본 갈래 주간 보고서 `/api/report?projectId=<R\|C>&format=xlsx`·`format=pptx` ④ WBS Excel `/api/export` 접기·펼침 ⑤ 주간·WBS 화면의 서버 렌더 HTML(`/p/<R\|C>/weekly` — 빈 주차 포함 — 와 `/p/<R\|C>/wbs`). **일치 규칙**: 대소문자를 구분한다, zip 은 텍스트 파트(`*.xml`·`*.rels`·`[Content_Types].xml`·`docProps/*`)만 보고 미디어는 보지 않는다, 영문 코드는 앞뒤가 영숫자가 아닐 때만 적중한다, 검사 전에 닫힌 마스크 목록 — 복합어 **'영업일'·'영업관리팀'**(실측: 사전 `src/lib/i18n/dict/wbs.ts:132,143`·`settings.ts:99`·`issues.ts:75`, 코드 `src/lib/excel/template.ts:46`·`src/app/actions/wbs.ts:516` — 그 밖에 주간·WBS 화면에 센티널이 든 정당한 문자열은 없다. 2026-10-01 `src` grep, 지울 `WeeklySheetView.tsx:603` 제외) — 을 지운다. **교차 프로젝트 확인**(비평 보안 §8): R 의 ①~④ 에 C 가 등록한 팀 code 가 없고 그 반대도 — 팀 code 만 본다(영역 이름은 일반어라 템플릿 예시 문구(E23)·사전과 겹친다). 봇 답은 SP8 |
| 경계 행렬 SP4 행(A2 — 비평 반영 Q21, W39) | 개정 §6.5.8 경계 행렬 가운데 SP4 몫을 R·C 각각에서 — **설정 없음**: 주간 영역 0개 → `CONFIG_REQUIRED`·문서 0, Excel 저장 양식 없음 → 표준 양식(`X-Excel-Layout: standard`)과 그 표기 / **비활성 유형**: 비활성 영역 → 매핑 창·편집기의 새 배정 선택지에서 빠지고 과거 행은 보인다 / **데이터 있는 개명**: 영역 개명 → `area_id` 불변·같은 셀, 팀 개명 → 팀 id 불변·봇 이름 매칭(**정오표 — A2 최종 리뷰: 봇 이름 매칭 end-to-end 는 SP8, A2 는 W27 단위 테스트로 갈음**). 잘못된 설정(손상 프로파일 422)은 W22 가, 동시 설정 변경은 설정 키(SP3a)가, 영역 9개 이상은 SP6 이 덮는다 |
| `PENDING_STEPS` | `S2` 삭제, `S4: 'SP5(일)'`, `S10: 'SP5~SP8(나머지 부분 집합)'`. `tests/scripts/synthetic.test.ts` 대조 |

### 6.5 성능(A2, `docs/baseline/sp4-perf.md`)

무범위 조회를 끝까지 읽게 바꾼 영향과 팀 원천 교체의 왕복을 잰다. `scripts/perf-baseline.mjs` 의 DSN 을 `LOCAL_DB_URL` 우선으로 먼저 고친다(SP3b 알림 11). 방식은 `docs/baseline/sp3a-perf.md` 와 같다 — `next start`, 경로별 워밍업 3 + 순차 30회를 3회, 3회 p95 의 중앙값끼리 비교, 기준선(`sp3a-done` 스크래치 워크트리 3102)을 먼저 쌓고 후보(3101)를 뒤에. **비평 반영 — Q9**: 바뀐 경로(`/wbs`·`/dashboard`·`/api/export`)만, 페르소나는 admin 하나(SP3a 의 최대가 admin 대시보드 1.12 였다). member 경로는 재지 않는다.

| 시드 | 경로 | 판정 |
|---|---|---|
| 800행(지금 시드) | `/p/<pid>/wbs`·`/p/<pid>/dashboard`·`/api/export` | p95 비율 ≤ 1.20(SP3a 기준). 넘으면 `getComputedWbs` 의 쪽 읽기를 첫 쪽 count 와 합치는 등 왕복을 줄인 뒤 다시 잰다 — 넘은 채 A2 를 머지하지 않는다 |
| 1,500행 | `/p/<pid>/wbs`·`/api/export` | 기록만 — 기준선은 1,000행에서 잘려 비교가 성립하지 않는다. 화면이 200 이고 항목 수가 1,500 인지 본다. 3천 행 이상의 렌더는 SPU2 |

### 6.6 눈확인

도구는 헤드리스 Chromium(Playwright 를 `npx` 캐시로), 서버는 3101, 계정은 그 작업이 만든 임시 계정(비밀번호는 메모리만). 크기 1440×900·1280×720·768×1024·390×844. 확인 주체는 에이전트 — Phase A 의 최소 수정 화면과 B 화면 모두(D14 — 사용자 확인 §8 #4, 비평 반영 Q27). A1·A2 행은 `docs/baseline/sp4-e2e.md`, B 행은 `docs/baseline/sp4-ui.md`. B 는 한 번에 본다(비평 반영 — Q1).

| 화면(체크포인트) | 확인 |
|---|---|
| 주간 시트 — 영역 0개 / 영역 있음 / 비활성 내용 있음(A1) | 안내와 설정 링크, 영역 이름 순서, 비활성 표지, 열 머리 |
| 이월 매핑 창·넘침(A1) | 대기 목록·영역 선택·옮기지 않음·넘침 안내, 다시 대기로 온 영역 |
| 설정 '팀·업무영역' 의 주간 영역 편집기(A1) | 추가·개명·순서·비활성화·담당 팀, 이슈 영역 탭 없음 |
| 가져오기 등록 확인·사전 백업(A1) | `inheritsCommon` 전환 문구와 공용 팀 목록, 슈퍼유저 전용 문구 없음, replace 의 백업 단계(내려받기 시작 전 실행 잠금) |
| 설정 내보내기 표기·마법사 펼침 버튼(A2) | 표준/저장된 양식(날짜), 펼침 버튼 |
| WBS 단계 배지(A2) | 라벨 원문 |
| B — WBS·칸반·멤버·회의록·대시보드·현황 보고서 모달(`ReportModal.tsx` — `teamStyle` 소비처, 재검토 반영 B P3-7) × 라이트/다크 | 팀 색 슬롯·다크 대비, 색 전후 기록 |
| B — #15(개명 입력·팀 색 칩)·#23·#25·설정 팀 절(개명·'전역 팀 복사로 시작'의 전환 확인 문구 — T14)·WBS 가중치 표시 × 라이트/다크 | 개명, 실행 ID·영수증, 주간 채움형 스크롤·색 토큰(다크 대비), 가중치 미지정 표시, 전환 확인 문구 |

## 7. 완료 조건(done_when)

괄호는 근거(W = 실측 C §2, 절 = 이 문서). 모든 체크포인트는 공통 묶음(§2.1)과 로컬 태그를 포함하고, main 반영은 사람 확인 때 한다(D49).

**A1**

- [ ] 전용 스택 `db:reset`(0000 → SP4 셋) 초록, `tests/invariants/migration-files.test.ts` 초록, `settings:verify` 종료 코드 0(W45)
- [ ] 리허설(§3.6): 세 파일 각각 카탈로그 R 불일치 0·기본 권한 diff 없음·재적용 성공. `…_weekly_areas` 데이터 업그레이드 — seed_wide → smoke(전후 건수·글자 수 일치 — 머리표 포함, W19) → created_fixture(code ≠ name 영역 포함) → 롤백 → rollback_check → 재적용 → smoke(영역 신설 0 — Q33). 나머지 두 파일의 데이터 있는 업그레이드(전환 RPC 포함). 사전검사 경우마다 `WEEKLY_AREAS_PRECHECK` 로 멈추고 `max(version)` = N-1. 결과가 `sp4-e2e.md` 리허설 절에 있다
- [ ] CI 등가(부트스트랩 없이 `db reset --version 0001` → `migration up` → `test:rls`) 초록·건너뜀 0(W41·W47 ⑤)
- [ ] `tests/rls/weekly-areas.test.ts`·`command-receipts.test.ts`·`authz-carry.test.ts`·`team-convert.test.ts` 초록(W15·W17·W5 DB 층·W40·§3.5 — 교차 프로젝트·삭제·카탈로그 케이스 포함), `isolation-map.ts`·`fixture-ws.sql`·`authz-events.test.ts` 갱신(W31), `test:rls` 전체 초록·건너뜀 0, **`git diff --quiet $(git merge-base main HEAD) HEAD -- tests/rls/schema-invariants.test.ts tests/rls/workspace-isolation-cases.test.ts tests/rls/h2-table-grants.test.ts` 참**(W46·§3.1 — 비평 반영 Q24)
- [ ] W12·W13·W14·W16 단위, 넘침·원본 무행·매핑 규칙 단위(D31·§4.1.1 — Q37), W18 패리티 단위, 점검·PPT 묶음 일치(D22), 영역 0개 배너 화면 테스트(`tests/ui/weekly-sheet-no-areas.test.tsx`), 프레즌스 회귀(§1.4)
- [ ] 부정 테스트 1(`tests/negative/weekly-outputs.test.ts` — 기본 갈래 보고서 모델·봇 도구 층 포함)과 센티널 일치 규칙(`tests/negative/sentinels.test.ts`) 초록(W20·D7·D8 — Q19·Q39)
- [ ] 가져오기·팀 단위 — `import-idempotent`(동시 재전송·`profileSaved: true`·응답 모양)·`import-reads`(영수증 프로젝트 필터·사전 백업)·`team-convert`(전환 뒤 실적 편집) 초록(D4·D50·D54 — Q14·Q16·Q36)
- [ ] **데이터 손실 경로 끝까지 읽기**(D18 — Q5, **재검토 반영 — T1**): `tests/data/paging-consumers.test.ts`(A1 경로 — 쪽 크기를 줄인 가짜로 replace 백업 완전·`wbs_items` 끝까지·count 불일치 throw)·`tests/data/computed-wbs-merge.test.ts`(`item_owners` 프로젝트 필터 + 끝까지, `WbsRow.owners` 계약 불변) 초록, 그 커밋이 첫 마이그레이션 커밋보다 앞(§2.5 ① — `git log --reverse` 순서)
- [ ] **로컬 E2E 의 A1 새 단계 여섯**(`weekly-areas-required`·`weekly-carry-mapping`·`weekly-outputs`·`weekly-registered-names`·`import-idempotent`·`import-unregistered-teams`)**과 기존 단계 전부**(`import-append`·`import-replace`·`render-pages` 포함) 통과(W1·W5·W14·W17·W21, 부정 테스트 1·2 의 봇 밖 — W20·D7, 비평 반영 Q7), `docs/baseline/sp4-e2e.md` 에 기록
- [ ] 합성 S1 추가분·S2·S4(월) 통과, `git diff --quiet -- src supabase` 참(W6·W35·W36·W38)
- [ ] 열거 게이트·RPC 표 대응(`tablesInNode` — 액션·라우트 두 축)·`NULL_TABLE_ALLOW` 초록(W48·D25), 불변식 `rpc-actor-source`(D51)·`weekly-row-columns`(Q35) 초록, `registry` 의 explicit 키 대조 초록(Q15)
- [ ] `grep -rnE 'WEEKLY_SECTIONS|WEEKLY_TEAM_SECTIONS|FALLBACK_SECTION|ensureStandardRows' src` 0건, `no-runtime-constants` 의 주간 다섯 항목 없음·`FALLBACK_SECTION` 패턴(W2·W49 일부)
- [ ] `tests/invariants/no-raw-db-errors.test.ts` 가 주간 액션 파일 전부·가져오기 라우트·영역 액션·A1 이 새로 만든 DB 파일 셋(`importReceipts.ts`·`importBackup.ts`·`lib/teams/register.ts` — 재검토 반영 A F-10)에서 초록(D21 — Q20)
- [ ] 마이그레이션 커밋 셋이 각각 두 파일만이고 `Staging-verified: local db reset …` 트레일러가 `Co-Authored-By:` 바로 위(W45, `git log -1 --format='%(trailers:key=Staging-verified,valueonly)'`)
- [ ] `docs/sp2-admin-client-audit.md` 의 가져오기 라우트·영역 액션 행과 본문 절 'DEFINER RPC 가 등급을 다시 판정하는 경로' 갱신(D28 — `projectTeams.ts` 행은 B, T14), `tests/invariants/admin-scope.test.ts` 초록
- [ ] `CLAUDE.md` 의 권한 절에 SP4 가 세운 규칙 두세 줄 — 주간 영역·주간 문서 생성·가져오기·전환은 RLS 쓰기 정책 없이 DEFINER RPC 가 등급을 다시 판정한다(D17·D27·D28·D54), `module: null` 항목이 새 RPC 를 부르면 `tests/gates/_rpc-tables.ts` 에 같은 커밋으로 더한다(D25), `p_actor` 는 가드 결과(D51 의 판정 규칙) — 와 데이터 절 한 줄(테스트·리허설은 마이그레이션을 번호가 아니라 접미로 찾는다 — D12)을 A1 문서 커밋에 넣는다. CLAUDE.md 는 사용자의 작업 지시 파일이라 그 문구는 main 반영의 사람 확인 때 사용자가 본다(재검토 반영 — B P3-3. 선례: SP1 `909ee3a`·SP2 `99f7ab6`·SP3a `faa8f5b` 가 같은 SP 안에서 고쳤다)
- [ ] **화면 경계**(비평 반영 — Q25): `git diff --name-only $(git merge-base main HEAD)..HEAD -- src/app src/components` 가 §5.1 표의 파일과 비화면 파일(액션·라우트·`lib`)만 내고 UI 위험 파일 0
- [ ] 화면 파일 커밋마다 `Preview-checked:` 트레일러, 눈확인 A1 행 통과
- [ ] **W30**(비평 반영 — Q21): SP4 가 더한 코드는 주 계산 사본을 새로 만들지 않는다 — 주 키는 기존 `mondayIso`·`seoulToday` 만 거친다. Phase 최종 리뷰 체크리스트의 한 줄로 확인하고 리뷰 기록에 남긴다(정적 검사는 과잉이라 두지 않는다)
- [ ] 레인 B 캡처 시드(`scripts/ui-capture.mjs`)가 새 주간 모양으로 돌고 그 테스트가 초록(D53)
- [ ] 로컬 태그 `sp4-a1-done`

**A2**

- [ ] `grep -rln "from '@/lib/teams/master'" src` = B 의 화면 넷 + `refreshTeams` 를 쓰는 액션 셋뿐(목록을 테스트가 고정 — B 착수 때 다시 센다, Q23)
- [ ] 로컬 E2E 전체를 `next start` 로 통과 — A2 새 단계(`export-standard`·`teams-source-next-start`) 포함, 임포트 단계 409 없음(D19, KLC:56 해제)
- [ ] W22·W23(fixture 오라클과 셀 단위 — Q31)·W24·W26 초록, `grep -r LEGACY_EXCEL_PROFILE_V1 src` 0건(W25), 상태 머리 커밋이 동등성 커밋보다 앞, `export.ts` 없음·`src` 에서 `legacyBuild` import 0, 양식 감지 `[[8,'*']]`
- [ ] W8·W9·W10·W11 초록, `unsetWeightCount` 단위 초록, `overallProgress.test.ts:36-43` 정정, 운영 메모 기록(D20)
- [ ] W27·W28 초록, 개명·예약어 단위 초록
- [ ] 무범위 조회 단위(§4.6 의 A2 경로) 초록
- [ ] `tests/invariants/no-raw-db-errors.test.ts` 가 `actions/wbs.ts`·팀 액션까지 초록, 원문을 고정하던 테스트 정정(D21)
- [ ] `grep -rnE 'DEFAULT_LEVEL_LABELS|LEGACY_LABEL_ABBR|RESERVED_TEAM_NAMES' src` 0건, `no-runtime-constants` 의 SP4 항목 0·새 패턴 셋(W49)
- [ ] SP4 가 다시 쓴 주간·WBS·Excel 테스트(계획이 §2.3 의 A1·A2 테스트 목록으로 고정)에서 `grep -lE '생산계획|조업|표준화|설비및L2|관리회계' <그 목록>` 0건 — 목록 밖 적중은 범위 밖(D47·§4.8 — **재검토 반영 — T3**)
- [ ] 합성 S10 부분 — 대상 다섯·일치 규칙·교차 프로젝트 팀 code — 통과(W37·D8 — Q19·Q39), **경계 행렬 SP4 행 통과**(W39 — 비평 반영 Q21)
- [ ] 부정 테스트 2(`tests/negative/wbs-outputs.test.ts`) 초록(W20·W24)
- [ ] `docs/baseline/sp4-perf.md` 800행(바뀐 경로·admin) p95 비율 ≤ 1.20, 1,500행 기록(§6.5 — Q9)
- [ ] CR-7 단위(골격 시드가 교차 검사로 거부), 카탈로그 `wbs.excel_profile` 상태 `verified`·네 연결의 실물·진척 집계 행 갱신(W42)
- [ ] `tests/invariants/settings-writes.test.ts` 의 `history.ts` 참조 수·사유 갱신(D48 — Q39)
- [ ] **화면 경계**: A1 과 같은 `git diff --name-only` 검사
- [ ] 눈확인 A2 행 통과
- [ ] 로컬 태그 `sp4-a2-done`

**B**(마감 묶음 포함 — 비평 반영 Q1)

- [ ] `src/lib/teams/master.ts` 없음, `grep -rn "teams/master" src tests scripts` 0건, `typecheck`·`test` 초록(W4)
- [ ] `grep -nE 'team-(pmo|dt|erp|mes|mdm)' src/app/globals.css` 0건(W3 — 이미 0) 그리고 `grep -n -- '--color-team-' src/app/globals.css` 0건, `token-aliases.test.ts` 의 `ALIASES` 25·`DELETED_TOKENS` 갱신, `no-runtime-constants` 에 `teamStyle`·`team-[1-5]` 클래스 패턴(D13)
- [ ] 팀 슬롯 단위·레이아웃 팀 주입 테스트(`w/[slug]`·`p/[projectId]` — Q23) 초록, `project-isolation` 의 정적 단언이 `src/lib/teams/**` 전체에서 초록(§4.2.1 — 재검토 반영 B P3-7)
- [ ] **로컬 E2E 전체를 `next start` 로 통과**(`render-pages`·`teams-color-render` 포함 — §6.3, **재검토 반영 — T12**), `docs/baseline/sp4-e2e.md` 에 기록
- [ ] `copyGlobalTeams` 가 전환 RPC 를 쓰고 '전역 팀 복사로 시작'의 확인 문구·성공 토스트가 전환을 말한다 — 한 커밋(§5.2), `tests/actions/team-convert.test.ts` 의 B 케이스 초록, `docs/sp2-admin-client-audit.md` 의 `projectTeams.ts` 행 갱신·`admin-scope` 초록(**재검토 반영 — T14**)
- [ ] #23·#25 의 화면 테스트 초록 — 상태 계약, D52 의 화면 파일에 12px 미만·uppercase 0, 주간 채움형이 스크롤 계약 목록에 있다(W43 의 SP4 몫 — 나머지는 SPU3, E33), `no-raw-color` 의 `ALLOW` 에 주간 4파일 줄 없음(Q17)
- [ ] 이름 있는 테스트 넷 초록 — `tests/ui/import-result-receipt.test.tsx`(실행 ID·영수증 링크 — W40 의 화면 부분)·`team-rename.test.tsx`·`wbs-unset-weight.test.tsx`·`wbs-toast-dict.test.tsx`(비평 반영 — Q26)
- [ ] `ui/sp4-teams` 위에 `ui/sp4-screens` 를 쌓아 한 번에 반영, UI 위험 파일 커밋의 `Preview-checked: local … — WBS·칸반·멤버·회의록·대시보드·보고서 모달·팀 관리·가져오기·주간(라이트·다크)`(W7·W32·W33 — 보고서 모달은 B P3-7), 눈확인 B 행 한 번 통과
- [ ] 마감 묶음 — 정본 W2 grep 과 현재 식별자 가드(D13) 모두 0건, `no-runtime-constants.allow.ts` 에 `removedBy: 'SP4'` 항목 0(W49)
- [ ] `npm run accept:synthetic` 에서 S1·S2·S4(월)·S9·S10(부분)·경계 행렬 SP4 행 통과, 기록(W6)
- [ ] W30 재확인 — 마감 리뷰 체크리스트 한 줄(새 주 계산 사본 0)
- [ ] `docs/baseline/sp4-e2e.md`(로컬 E2E·리허설·운영 메모)·`sp4-effort.md`(실측 노력) 커밋, B 의 커밋을 스크래치 워크트리에서 `test`·`lint`·`typecheck`·`build` 초록
- [ ] **받는 쪽 기록**(**재검토 반영 — T13**): §9 에서 "받는 쪽 기록"이 "한 줄"인 행을 개정 문서의 해당 SP 블록(§8.1 포함)에 더한 문서 커밋, 레인 A·B 원장 알림(`projectColors.ts` 사유·CR-4 등 — 선례 H2 `5d69f0e`)
- [ ] `git tag -l sp4-done` 이 태그를 낸다(W7·W44)
- [ ] (반영 뒤 확인 — 체크포인트 뒤의 일, D49 ①) main 반영(사람 확인) 뒤 Actions 초록(W44)(재검토 반영 — B P3-5)

## 8. 사용자 확인 항목

각 항목은 권고 기본값으로 진행한다(사전 승인 규칙). "기한"은 그 체크포인트에 착수하기 전이다. #10 만 사전 승인에 넣지 않고 그때 묻는다(사용자 데이터에 되돌리기 어려운 변경). 비평 뒤 바뀐 항목 — #3(기본값의 내용), #4(Phase A 화면을 더함), #5·#6(기본값을 바꿈), #9(개정과 다르다는 사실), #10(비용 칸), #12(비용·기한을 채움), #13(A1·A2 는 UI-2 를 기다리지 않는다는 문장을 더함). 범위 재검토 뒤 바뀐 항목 — #3(그 버튼의 전환은 B 부터 — T14, 공용 팀·다른 프로젝트·이미 갈라진 프로젝트는 그대로 — A F-5·B P3-4), #5(에이전트 시간·"더 줄인다"의 절감 — B P3-4), #6(머리표 꼴·혼자인 행도 바뀜 — T4·T5), #10(머리표 꼴 — T4)(재검토 반영 — B P3-4).

| # | 질문 | 권고 기본값 | 대안 | 바꿀 때 비용 | 기한 |
|---|---|---|---|---|---|
| 1 | (R2·N2) 레인 A 에서 밀린 권한 DB 작업 셋(권한 기록이 명단의 활성 전환까지 남게, 세션의 인물 이메일 직접 쓰기 회수, 필수 설정 삭제 거부)을 SP4 의 **셋째 마이그레이션 파일**로 넣을까요? 마이그레이션 번호표에 파일이 하나 늘어 뒤 SP 번호가 한 칸씩 밀립니다 | 별도 파일 `NNNN_authz_carry`(D2) — 주간 이관과 리허설·롤백이 섞이지 않는다. 원격 DB 가 없어 번호 추가 비용 0, 셋 다 첫 원격 배포 전 필수 | 주간 영역 파일에 독립 절로 넣는다(번호 그대로) | 낮음 — 원격 전이면 두 파일을 합쳐 다시 리허설 | A1 |
| 2 | (R3·N1) 팀 색을 **팀을 만든 순서**로 테마 색 8개 가운데서 정할까요? 지금은 팀 코드 해시라 SP4 뒤 각 팀 색이 한 번 바뀝니다. 팀마다 색을 고르는 화면은 뒤로 미룹니다 | 생성 순(팔레트 자리) — 워크스페이스의 앞 다섯 팀이 서로 다른 색, 다크 모드 대비 확보(D3). DB 변경 없음 | 팀 id 해시만(앞 팀끼리 색이 겹칠 수 있다) / 지금 바로 색 선택 화면(작업 추가) | 낮음 — 슬롯 함수 한 곳 | B |
| 3 | (R4·N3 — 비평 반영 Q16) WBS 가져오기 파일에 **등록되지 않은 팀**이 있으면 늘 그 프로젝트 전용 팀으로 만들까요? 지금은 공용 팀을 쓰는 프로젝트면 워크스페이스 공용 팀을 만듭니다. 전용 팀이 처음 생기면 그 프로젝트가 쓰던 공용 팀이 화면에서 사라지므로, 등록 확인 때 쓰던 공용 팀을 **같은 코드·이름·색의 전용 팀으로 '전환'** 합니다 — 작업 담당·명단의 팀·업무영역 담당·수락 전 초대의 팀 연결도 새 팀으로 함께 옮깁니다. 설정의 '전역 팀 복사로 시작'(공용 팀 복사) 버튼도 같은 전환을 씁니다(그 버튼은 SP4 마지막 체크포인트 B 부터 — 그 전까지는 지금처럼 팀 행만 복사합니다) | 늘 전용 팀 + 상속 공용 팀 전환(D4·D54). 공용 팀은 워크스페이스 관리 화면에서만 만든다. 연결까지 옮기므로 담당 팀 멤버가 새로 가져온 작업의 실적을 그대로 고칠 수 있다 — 복사만 하면 같은 코드의 팀이 두 벌이 되어, 화면은 고칠 수 있다고 보이는데 저장이 거부된다(지금 그 버튼에도 있는 결함을 B 에서 함께 닫는다 — 재검토 반영 T14). 전환은 되돌리지 않는다. 공용 팀 자체와 다른 프로젝트는 그대로이고, 전환한 프로젝트는 그 뒤 공용 팀의 이름 바꾸기·추가·비활성을 따르지 않는다(대안 ① 은 상속을 유지한다). 이미 갈라진 프로젝트(B 전에 그 버튼으로 전용 팀을 만든 곳)는 전환하지 않고 그대로 둔다(재검토 반영 — A F-5·B P3-4) | ① 공용 팀을 쓰는 프로젝트에서는 등록을 거부하고 '워크스페이스 관리 화면에서 공용 팀으로 더하기 / 프로젝트 팀으로 전환'을 안내한다(가져오기가 한 번 멈춘다) ② 지금처럼 공용 팀을 만든다(가져오기가 워크스페이스 공용 팀을 늘린다 — 정본이 SP4 에서 없애기로 한 동작) | ①: −0.15~0.25주(전환 RPC 를 빼면 — 버튼의 기존 분열은 남고 거처는 SP5) 또는 −0.05주(전환은 버튼용으로 남김). ②: 라우트 분기·마법사 문구 — 낮음. A1 의 마이그레이션 커밋 뒤에 바꾸면 그 파일과 재리허설이 따른다 | A1 착수 전 |
| 4 | (R14·U6 — 비평 반영 Q27) SP4 화면의 눈확인을 누가 할까요? 대상은 둘입니다 — **Phase A 의 최소 수정 화면**(주간 시트의 '영역 설정 필요' 안내, 이월 매핑 창, 주간 영역 편집기, 가져오기의 팀 전환 확인과 교체 전 백업 단계, Excel 양식 표기)과 **Phase B 화면**(팀 색, 팀 이름 바꾸기, 가져오기 결과, 주간 시트). **개정은 눈확인을 사람의 게이트로 정했습니다**(개정 §6.5.9·R21) — 아래 기본값은 그와 다릅니다 | 에이전트가 헤드리스 브라우저로 확인하고 스크린샷·기록을 남긴다(SP3a 와 같다). 사용자는 SP3b UI-3 게이트에서 직접 본다 | 사용자가 A1·A2·B 체크포인트에서 목록(§6.6)을 직접 본다 / B 만 사용자가 본다 | 체크포인트마다 사람 확인을 기다린다(각 하루 안팎 — 그동안 다음 Phase 는 쌓는다, D49). main 반영 뒤에 사람이 찾은 결함은 그 트레일러를 고칠 수 없어 다음 SP 가 고친다 | A1 착수 전 |
| 5 | (N4·U7 — 비평 반영 Q8, 기본값을 바꿈) SP4 의 추정이 개정의 2.5주를 넘습니다 — 5.5~7.8주(노력 단위, 체크포인트 고정 비용 포함), 에이전트 시간으로 약 4일(SP3a 비율). 그래서 Phase B 의 화면 이행 가운데 **순수 디자인 패턴 정리만** 뒤(SPU3)로 넘기려 합니다 — 팀 관리 화면의 머리·상태 표시·글자 크기, 프로젝트 개요 위젯, 명단 화면, 주간 영역 편집기의 패턴. 이것은 **개정이 정한 SP4 목표("SP4 가 만지는 화면은 SP3b 패턴으로 끝낸다")를 고치는 일**입니다. 기능 — 팀 이름 바꾸기·팀 색·가져오기 실행 ID와 결과 링크·주간 시트 화면(색 정리 포함)·가중치 미지정 표시·오류 문구 사전 — 은 SP4 에 남깁니다 | 줄인다(D52·E33) — 넘기는 넷은 SPU3(개정 §5.9.4 끝 문단이 정한 거처). 체크포인트마다 실측을 적는다(§2.2) | 그대로 SP4 에서 모두 이행한다 / 더 줄인다 — 팀 이름 바꾸기 화면도 SP5 로(이름 바꾸기 서버 기능은 SP4 에 남는다) | '그대로'면 +0.4~0.55주(B 가 그만큼 길어진다 — 에이전트 시간으로 약 0.3일, §2.2 의 짝짓기: 0.55×5×0.11 ≈ 0.30·0.4×5×0.17 ≈ 0.34). 줄이면 넘긴 화면은 SPU3 전까지 옛 패턴이다(SPU3 은 출시 뒤가 될 수 있다). '더 줄인다'는 약 0.05~0.1주(개명 입력 하나와 그 화면 테스트 — 추정)를 더 덜고, 그동안 팀 이름은 화면에서 바꿀 수 없다(서버 기능만 있다)(재검토 반영 — B P3-4) | B 착수 전 |
| 6 | (새 — 비평 반영 Q18, 기본값을 바꿈) 기존 주간보고를 업무영역으로 옮길 때, 한 '구분' 아래 '모듈'로 나뉘어 있던 행들을 어떻게 할까요? 지금 PPT·점검은 표준 구분 아래의 모듈 행을 이미 한 페이지로 합쳐 보여 주고(비표준 구분은 '구분 · 모듈' 로 따로), 시트는 모듈을 구분 아래 작은 글씨로 보여 줍니다 | 구분 이름 하나로 영역을 만들고(개정과 같다), 모듈이 구분과 다른 행은 — **합쳐지는 행이든 혼자인 행이든** — 칸 내용 앞에 **'[모듈]' 머리글 줄**을 붙여 모듈 이름을 남긴다(D29). 점검은 이미 이 꼴(대괄호만 있는 한 줄)을 칸 안의 영역 구획으로 읽어 번호 목록도 구획마다 1부터 센다(사용자 확인 2026-08-06). 같은 문서·같은 구분의 행은 한 행으로 합친다. 영역 수가 늘지 않고 모듈 정보도 사라지지 않는다. 구분이 비면 모듈 이름이 영역 이름이 되고(머리표 없음), 둘 다 비면 '기타'. 공백뿐인 칸에는 머리표를 붙이지 않는다. 로컬 개발 데이터에만 해당(**재검토 반영 — T4·T5**) | ① 개정 그대로 — 구분 이름만, 모듈 이름은 버리고 내용만 이어 붙인다 ② 초안안 — '구분 · 모듈' 마다 영역을 따로 만든다(조합마다 활성 영역이 생겨 이후 모든 주간 문서의 행이 영구히 늘어난다) ③ 지금 PPT 와 똑같이 — 표준 구분이면 합치고 비표준이면 따로(표준 구분 이름 목록을 마이그레이션에 넣어야 해 고객 흔적 규칙·옛 이름 검사와 부딪친다 — 권하지 않는다) | 이관 SQL 의 식 하나 — 낮음. 단 **머리표는 기존 행 본문을 바꾼다 — 사용자 DB 에 적용한 뒤에는 롤백으로 지워지지 않는다**(합친 행도 다시 나뉘지 않는다 — 재검토 반영 T5) | A1 착수 전(마이그레이션 작성 전) |
| 7 | (U1) 가져오기 파일 지문·열 매핑 복원과 저장·공유 보기를 출시 뒤로 미룰까요? SP4 는 같은 실행의 중복 방지·실행 ID·결과 링크만 합니다 | 출시 뒤(개정 §8.1 #20 권고 — 답이 없어 권고로 진행 중) | 저장·공유 보기는 SPU2, 지문·매핑 복원은 SPU3(각 +0.5주) | 미루면 비용 없음 | SPU2 착수 전 |
| 8 | (U2) 첫 원격 배포(스테이징·운영)는 언제 할까요? 그 전까지 마이그레이션 번호 변경 비용이 0 이고, #1 의 셋은 그 전에 들어가야 합니다 | SP5c 뒤(개정 §8.1 #10) | 더 일찍 | 앞당기면 그 뒤로는 적용한 마이그레이션 파일을 고칠 수 없다 | SP5c 종료 |
| 9 | (새 — 비평 반영 Q22) 이월할 때 비활성 영역의 내용을 다른 영역으로 옮겨 칸이 20,000자를 넘으면 어떻게 할까요? 지금은 넘는 부분을 조용히 잘라 버립니다. **개정 문서는 지금 규칙(자름)을 그대로 쓰라고 했고, 컨트롤러 판정이 그것을 결함으로 보았습니다** — 아래 기본값은 개정과 다릅니다 | 넘으면 문서를 만들지 않고 같은 매핑 창에서 다른 영역이나 '옮기지 않음'을 고르게 한다(D31·E25) | 그대로 붙여 상한을 넘긴 칸으로 만들고, 저장할 때 줄이게 한다 / 개정대로 자른다(내용 일부가 조용히 사라진다) | 낮음 — 이월 함수 한 분기 | A1 착수 전 |
| 10 | (새 — 그때 묻는다) SP4 가 main 에 들어간 뒤 지금 쓰시는 로컬 DB(메인 스택)에 SP4 마이그레이션을 적용할까요? 주간보고의 같은 주 중복 행이 합쳐지고, '구분'이 업무영역이 되며, 모듈 이름은 내용 앞 '[모듈]' 머리글 줄로 남습니다(T4). '전역 팀 복사로 시작'(B 전의 복사 — 팀 행만 복사)을 쓴 프로젝트가 있으면 같은 코드 팀의 연결을 그 프로젝트 팀으로 옮기는 수리도 그때 함께 묻습니다(D4 — 재검토 반영 A F-5) | main 반영 뒤 적용 전 데이터를 덤프해 두고 `migration up`(리허설과 같은 절차), 결과 건수를 보고 | 적용하지 않고 `db:reset` 으로 새로 시작 | **기본값: 되돌릴 수 없다 — 덤프에서 복원만**(병합된 행·모듈 머리표·이관 뒤 바꾼 영역 이름은 롤백으로 되살아나지 않는다). 사전검사에 걸리면 그 칸을 줄인 뒤 다시 적용한다. **대안**: 메인 스택의 계정·워크스페이스·프로젝트 등 개발 데이터가 모두 지워진다(비평 반영 — Q27) | A1 main 반영 뒤(그때 묻는다) |
| 11 | (U5 — SP3b 결정에 기댐) 워크스페이스 관리자에게 공용 팀 관리 화면을 엽니다(SP3b 권고). SP4 의 팀 관리 화면 개명 입력이 그 위에 섭니다 | SP3b 기본값 그대로 | SP3b 의 대안을 고르면 SP4 B #15 의 권한 표시만 바뀐다 | 낮음 | B |
| 12 | (U8 — 기록) 위험 신호의 가중치 해석(`topWeightPhaseDelayed`, 가중치 없음 = 0)은 바꾸지 않습니다(사용자 결정 3). 진척 집계만 가중치 없음 = 1 로 맞춥니다 — 루트에 가중치가 섞인 프로젝트는 전환일부터 추세선·SPI 에 계단이 생깁니다(D20) | 사용자 결정 3 그대로 — 질문이 아니라 알림 | 위험 신호도 가중치 없음 = 1 로 맞춘다(사용자 결정 3 을 고치는 새 결정이 필요하다) | 기본값은 비용 없음. 대안은 위험 모델·대시보드 경고의 뜻이 바뀌어 SP4 밖의 별도 결정·회귀 검증이 든다 | A2 착수 전(정정이 A2 에 든다) |
| 13 | (U4 — 컨트롤러 기본값 적용 중) SP4 의 셸·화면 과제(팀 색·레이아웃 팀 주입·화면 이행)는 SP3b UI-2 가 main 에 들어간 뒤 시작합니다(SP3b D47). DB·도메인(A1·A2)은 UI-2 를 기다리지 않습니다(D49 — 비평 반영 Q38) | UI-2 먼저 — SP4 B 는 그 뒤 main 에서 자른다 | SP4 셸 과제를 먼저 머지하고 UI-2 가 그 위로 rebase(레인 B 의 창이 길어진다) | 낮음 — 순서만 바뀐다. 셸 파일 rebase 는 나중 쪽이 진다 | B 착수 전 |

U3(SP3a 에서 담당 영역 탭을 숨김)은 권고 기본값이 적용되어 닫혔고, 주간 구분 탭은 D26 이 연다.

## 9. 범위 제외·이월

받는 SP 의 블록에 적혀 있지 않은 것은 B 의 마감 묶음의 문서 커밋이 개정의 그 SP 블록에 한 줄을 더한다("받는 쪽 기록" 열 — 완료 조건은 §7 B 의 "받는 쪽 기록" 줄, 재검토 반영 T13).

| 항목 | 가는 곳 | 받는 쪽 기록 |
|---|---|---|
| 주 시작 일요일·주 키 이행, 봇 도구·라우터의 월요일 강제, `p_from_week` 의 `weekKeyOf(todayIn(tz))`, 합성 S4 의 R(일요일 키) | SP5 | 이미 있음(개정 §4.2·§4.3.2) |
| 이슈 영역 탭(편집기의 `issue_area`)·이슈 영역 code 규칙(`[A-Z0-9]{1,8}`)·채번 | SP5 | 이미 있음 |
| 이슈 영역 편집의 쓰기 길 — 세션 쓰기 정책이 없으므로(D27) `upsert_project_area`(kind `issue_area`)를 쓰고, code 규칙은 그 RPC·트리거에 더한다(비평 반영 — Q22, E26) | SP5 | SP5 블록에 한 줄 |
| 회의록 팀 루트 이름 = `teams.name` 동기 트리거·`create_team` RPC | SP5(`0017` 계열) | 이미 있음(개정 §4.7) |
| 회의록 화면의 팀 막대 패턴 이행(SP4 B 는 색 슬롯만 바꾼다) | SP5(화면 소유) | SP5 블록에 한 줄 |
| `src/lib/domain/projectColors.ts`(프로젝트 점 색 — 포트폴리오·내 회의)의 하드코딩 색(비평 반영 — Q17) | SP5(회의 화면) | SP5 블록에 한 줄. 레인 B `no-raw-color` 허용 목록의 사유("SP4(팀·영역 색 이행)")를 고친다 — 컨트롤러가 레인 B 원장에 알린다 |
| 팀을 가리키는 새 열(예: SP5 의 회의록 `team_id`) — 전환 RPC(D54)가 옮기는 열에 같은 커밋으로 더한다(카탈로그 불변식이 **잡는다 — 이름 규칙 안에서**: FK 열과 `team_ids` 배열만 본다. FK 없는 단일 uuid 열·다른 이름의 배열·jsonb 안의 팀 id 는 그 SP 가 이 RPC 와 테스트를 같은 커밋에서 고친다 — 재검토 반영 T8) | 그 열을 만드는 SP | SP5 블록에 한 줄 |
| (SP5b 로 넘기는 것은 없다 — SP4 는 `workflow.*`·상태 정의를 건드리지 않는다. SP5b 가 진척 계산을 바꿀 때 A2 의 끝까지 읽기·`weightOf` 를 그대로 쓴다) | SP5b | — |
| `carryCustom` 주입·주간 행 `custom` 열·이월 호출부의 필드 선택, 그리고 `create_weekly_report` 재정의(시드의 `custom` 통과 — 비평 반영 Q22, E28) | SP5c | 앞 셋은 이미 있음(개정 §3.6.7). SP5c 블록에 한 줄 — "§3.6.7 '주입과 호출부뿐'의 예외: `create_weekly_report` 를 다시 만들어 시드의 `custom` 을 통과시킨다" |
| 주간 PPT/Excel 양식 엔진·영역 9개 이상 페이지 나눔·템플릿 예시 문구 교체 | SP6 | 이미 있음(E23 의 실측 결과는 SP6 블록에 한 줄) |
| 외부 회의록 API 의 플랫폼 관리자 후보 `workspaces` 전량 조회(`max_rows`)(D15) | SP7 | SP7 블록에 한 줄 |
| 에이전트 WBS 가져오기(`import_wbs_upsert`·`/api/v1/wbs/import`)의 명령 원장 | SP7(외부 API 인증·재시도 계약과 함께) | SP7 블록에 한 줄 |
| 부정 테스트 1·2 의 봇 부분, 봇 플래너·verifier 도메인 파생, 조사 붙은 팀 코드('가공팀') | SP8 | 이미 있음(D7) |
| 주간 셀 저장이 `weekly_reports.updated_at` 을 올리지 않아 색인 신선도가 셀 변경을 못 보는 구멍 | SP8(증분 색인 배선) | SP8 블록에 한 줄 |
| 주간 저장 경로의 편집 상태 머신, 가져오기 결과 불명(OutcomeUnknown) 클라이언트 조회(`getImportReceipt` 를 쓴다) | SPU1 | 이미 있음 |
| WBS 그리드 쪽 나눔·가상화(3천 행), 1만 행 기준 | SPU2 | 이미 있음(SP3b D51) |
| 저장·공유 보기, 가져오기 지문·매핑 복원 | 출시 후(§8 #7) | 이미 있음 |
| #15 의 `PageHeader`·상태 계약·12px/uppercase, #19 개요 위젯·#30 명단의 패턴 이행, `ProjectAreasManager` 의 SP3b 패턴(W43 의 일부 — 비평 반영 Q8, D52·E33) | SPU3(개정 §5.9.4 끝 문단) | SPU3 블록에 한 줄. 사용자 확인 §8 #5 |
| `command_receipts` 보존·정리 규칙 — 정리 잡은 `command_receipts_reject_mutation()` 의 예외(보존 기간 지난 행)부터 설계하고, 계정 삭제 때 처리(`actor` 는 FK 가 없어 계정이 지워져도 행이 남는다)를 포함한다(비평 반영 — Q28) | SP8(개정 §4.10 알림·보존·스케줄 정책) | SP8 블록에 한 줄 |
| 옛 `import_wbs`·`replace_wbs` 의 세션 실행권 회수(멱등 우회로 — RLS 는 관리자만 통과시킨다). 같은 처지의 `import_wbs_upsert(uuid, jsonb, uuid)`(INVOKER·authenticated 실행권 — 0000 기준선, 0006 은 public·anon 만 회수 — 팀은 쓰지 않는다)도 같이(A2-1 리뷰 보안 P3) | SP9 출시 점검(ⓚ 를 서버 경로로 옮기며) | SP9 블록에 한 줄 |
| 팀 이름 규칙(D37 — 길이·예약어·겹침)과 새 code 규칙(`normalizeNewTeamCode`)이 앱에만 있다 — 앱의 팀 쓰기는 전부 service_role 인데 세션의 `teams` insert·update 정책(`wsadmin_insert_teams`·`wsadmin_update_teams`)과 `GRANT ALL … TO authenticated` 가 남아, 워크스페이스 관리자가 PostgREST 로 바로 규칙을 비킬 수 있다(code 불변만 DB 가 지킨다 — `TEAM_CODE_IMMUTABLE`). 세션 쓰기 길 회수(또는 열 단위 update)와 `check (char_length(name) between 1 and 40 and name = btrim(name))` 를 뒤 SP 의 마이그레이션으로(A2-1 리뷰 보안 P3) | SP9 출시 점검(세션 쓰기 길 회수와 함께) | SP9 블록에 한 줄 |
| 팀 추가·개명·새 code 겹침 검사의 같은 범위 팀 목록 질의가 한 응답(PostgREST `max_rows` 1,000행)이다(`projectTeams.ts`·`teams.ts` 의 겹침 대조 — 개명 쪽 기존 질의와 같은 꼴). 한 범위의 팀이 1,000개를 넘으면 뒤 팀과의 겹침을 못 보고 통과한다(3원칙 ① 과 같은 꼴 — 정확히 같은 code 는 DB 유일 제약이 막는다). 팀 이름 규칙을 DB 로 옮기면(위 행) 사라지고, 그 전이면 `fetchAllByKeyset` 으로 끝까지 읽는다(A2 최종 리뷰 완료 P2-2) | SP9 출시 점검(팀 이름 규칙의 DB 이관과 함께) | SP9 블록에 한 줄 |
| 아웃라인 저장 양식의 펼침 내보내기 — 공식 양식(코드 열 1/1.1/1.1.1)을 '양식 저장'으로 가져오면 저장 양식이 아웃라인이고, 빌더는 아웃라인 + 펼침을 거부한다(sub-act 는 부모 code 를 승계해 깊이를 늘릴 근거가 없다). SP4 A2 는 가져오기 완료 화면이 그 경우 버튼 대신 사유를 보이게만 했다(A2-2 리뷰 정확성 P2). 근본 해결은 sub-act 행에 `부모코드.n` 을 부여하는 아웃라인 펼침, 또는 라우트가 아웃라인 저장 양식 + 펼침을 표준 양식으로 대체하고 `X-Excel-Layout: standard` 로 알리는 것 — 설계가 필요하다 | SP6(양식·출력 엔진) | SP6 블록에 한 줄 |
| 가져오기의 트리 깊이 검사(단계 이름 수보다 깊은 append — 표준 내보내기는 접는다)와 접은 파일을 replace 로 되돌릴 때의 계층 변화(K13 — 비평 반영 Q28) | SP6(양식·출력 엔진) | SP6 블록에 한 줄 |
| 권한 이력 표시(`describeAuthzChange`)의 사전 이행 — SP4 는 CR-1 의 세 문구를 모듈의 한국어 상수 표에 더했다(§3.4 ② — 재검토 반영 T11) | 권한 이력 화면(설정 '기록' 범주)을 만지는 SP — 그 SP 의 i18n 과 함께 | 개정 §8.1(열린 항목)에 한 줄 |
| 명단 액션(`roster.ts` 의 `upsertRosterMember`)이 받은 팀 id 를 보이는 팀 집합(그 프로젝트의 `projectTeams` ∪ 이미 배정된 팀)으로 검사 — 지금은 모양만 본다(`isTeamIdList`, `roster.ts:116`). SP4 는 영역 액션에만 둔다(§4.1.8 — 재검토 반영 A F-5) | 명단 액션을 다시 만지는 SP(미정 — SPU3 #30 이 먼저면 그때) | 개정 §8.1(열린 항목)에 한 줄 — **닫힘: SP4 A2 X1 4e31301**(명단 저장이 `projectTeams` 원천으로 검사 — "모양만 본다"는 더는 사실이 아니다, A2 최종 리뷰 완료 P3-1) |
| 프로젝트 삭제 기능 — `area_teams_team_id_fkey`(RESTRICT)가 전용 팀이 영역에 붙은 프로젝트의 삭제를 막는다(K18 — 비평 반영 Q10). 그 기능을 여는 SP 가 같은 꼴(영역-팀에 프로젝트 직접 경로, 또는 부모 부재 면제)로 고친다 | 프로젝트 삭제를 여는 SP(미정) | 개정 §8.1(열린 항목)에 한 줄 |
| CR-4(0012 롤백이 `modules.*` 를 버려 끈 agents 가 다시 열리는 경로) — SP4 의 세 롤백은 `modules.*` 를 건드리지 않아 해당 없음(D15, 비평 반영 Q22·E29) | SP3a 롤백 설계(0012 롤백 개정) | 레인 A 원장과 개정 SP3a 블록에 한 줄 |
| 팀 코드 리터럴의 일괄 합성 치환 — SP4 가 다시 쓰지 않는 WBS·주간 계열 테스트와 라우터·골든 등 주간 밖 테스트(비평 반영 — 충실도 F-20). **A2 Excel 해석(A2 최종 리뷰 완료 P3-2)**: §7 의 "다시 쓴 테스트" 는 합성 이름으로 다시 쓴 파일이다 — A2 가 손댔어도 옛 5팀 양식을 보존 대상(W25·W26, 3단 회귀 기준)으로 쓰는 `tests/excel/{detect,export,export-with-profile,parse-with-profile,profile,split}.test.ts` 는 목록 밖이고 여기로 온다. 합성으로 다시 쓴 `export-nlevel`·적중 없는 `template` 은 목록에 든다 | SP8(봇 테스트 정비와 함께) | SP8 블록에 한 줄 |
| `mapDbError`(`src/lib/settings/errors.ts`)의 `TOKENS[token]` 객체 리터럴 조회 — DB 메시지 첫 낱말이 `constructor`·`toString`·`__proto__` 면 상태 없는 결과를 내 `project.ts`·`write.ts`·`settings.ts` 가 `{ ok: false, code: undefined }` 를 돌려준다(원문은 새지 않는다). SP4 는 `rpcFailure` 의 `typeof status` 방어만 두고 `mapDbError` 를 고치지 않았다(T6 — A1-1 리뷰 보안 P3) | SP4 A2(`Object.hasOwn(TOKENS, token)` 한 줄 — 고치면 `rpcFailure` 의 방어는 지워도 된다) | 레인 A 원장(A2 이월) — **닫힘: SP4 A2 37b5d7b**(A2 최종 리뷰 완료 P3-1) |
| `actions/wbs.ts` `addSubAct` 의 DB 오류 원문 노출(`error: ownErr.message` — 기존 결함, A1-4 리뷰 권한 P3) | SP4 A2(원문 가드 대상에 그 파일을 더하고 `failWith` 로) | 레인 A 원장(A2 이월) — **닫힘: SP4 A2 37b5d7b**(A2 최종 리뷰 완료 P3-1) |
| 가져오기 뒤 AI 색인(`ingestProject`)이 옛 팀 캐시로 만들어져 "최대 60초"가 아니라 다음 재색인까지 남는다(A1-5 리뷰 정확성 P3) | SP4 A2(ingest·knowledge·projectFacts 의 요청 범위 팀 원천 이전에서 확인) | 레인 A 원장(A2 이월) — **닫힘: SP4 A2 cae6c28**(A2 최종 리뷰 완료 P3-1) |
| A2 관찰 셋(A2 최종 리뷰 완료 P2-2 의 나머지): ① Z4 공용 팀 참조 판정이 #10 양식 저장 교차 검증의 `registered` 에 들어가지 않는다 ② 멤버 계정의 가져오기 이력 표시가 '저장일 미상'으로 보인다(이력 표 읽기 권한) ③ 옛 빌더 오라클의 워크북 수준·L=1 보강 | SP6(양식 엔진 — 양식 저장·이력 화면을 다시 만질 때) | SP6 블록에 한 줄 |

## 10. 리스크

| # | 리스크 | 담는 방법 |
|---|---|---|
| K1 | 이관이 사용자 데이터(메인 스택)의 주간보고를 합치고 바꾼다. 롤백은 병합·모듈 머리표를 되살리지 못한다 | 리허설은 전용 스택(D9·D42), 사전검사·전후 대조가 어긋나면 멈춘다(§3.2 ①⑦), 사용자 DB 는 main 반영 뒤 덤프와 함께 사용자 확인(§8 #10) |
| K2 | 테스트 하네스·리허설 도구가 DSN·컨테이너를 빠뜨리면 사용자 DB 에 픽스처를 커밋하거나 남의 카탈로그를 대조한다 | D42 — 컨테이너 env 를 첫 과제로, 계획 명령 전문에서 `supabase_db_d-flow` 0건, 모든 명령에 DSN 명시 |
| K3 | 레인 B 가 늦으면 Phase B 가 기다린다(SP3b 노력 6.4~8.0주). **SP4 B 착수 = 레인 B 의 사람 게이트 둘(UI-1 의 사용자 눈확인, UI-2b push 때의 사용자 확인 — SP3b D29) + UI-2a·UI-2b 머지 뒤**다 — SP4 안에는 사람 게이트가 없어도 SP4 완료 달력에는 레인 B 의 사람 게이트가 들어 있다(비평 반영 — Q28, 게이트 둘은 재검토 반영 — B P3-6) | A2 까지는 영향이 없다(SP3b D47 — DB·도메인은 무관). 기다리는 동안 레인 A 는 SP5 스펙·계획(브랜치 없음 — §2.1.1 ⑥). 더 길면 SP5 Phase A 구현을 당기고(전용 스택은 따로, B 게이트가 열리면 SP4 B 먼저 — §2.1.1 ⑥) UI-2 는 창 밖 머지(D49). 사용자에게 UI-1·UI-2b 게이트를 먼저 보게 하면 SP4 완료가 당겨진다. SP5 의 전제인 요청 범위 팀 원천은 A2 에서 끝난다 |
| K4 | 두 레인이 같은 파일을 고친다(§2.4) — 특히 UI-1 의 조각 개수 단언 스크립트와 `WbsGanttSheet.tsx`, 격리 맵·픽스처, 레인 B 캡처 시드(`ui-capture.mjs`)와 E2E 스크립트 | Phase A 는 UI-1 조각과 다른 줄만, 토스트 줄은 B. 캡처 시드는 A1 이 고친다(D53). E2E 단계는 이름으로 부른다(Q7). 나중 머지가 rebase 하고 `test:rls` 전체를 다시 돈다. 체크포인트 증거는 rebase 뒤 트리에서 |
| K5 | 마이그레이션 번호가 머지 순서로 바뀐다 | D12 — 번호 참조 0(머리 주석의 파일 경로 포함), rename 커밋 + 재리허설 빈 커밋, 확정 전 번호를 사용자 DB 에 적용하지 않는다 |
| K6 | 팀 원천 교체가 동기 접근자를 async 로 바꿔 AI 도구·리포지토리 시그니처가 줄줄이 바뀐다(src 33파일·테스트 54파일) | A1(세 파일)·A2(23파일)·B(화면 넷)로 나누고 공용 mock 도우미 하나. 규칙은 기존 순수 함수 그대로(D36) |
| K7 | Phase A 와 B 사이에 레이아웃만 옛 캐시를 읽는다 — 화면 팀 목록이 최대 60초 늦을 수 있다(지금과 같은 성질) | `refreshTeams` 호출을 B 까지 남긴다. 임포트·내보내기 등 판정 경로는 A 에서 요청 범위다 |
| K8 | DEFINER RPC 넷(주간 둘·가져오기·전환)이 RLS 를 건너뛴다 — 가드가 빠지면 등급 판정이 RPC 안에만 남는다 | RPC 안의 등급 재판정(D17·D28·D54), 실행권은 service_role 만, `p_actor` 는 가드 결과만(D51 — 정적 불변식), 영역 RPC 의 프로젝트 술어(§3.2 — Q11), 감사 문서 갱신, 열거 게이트·RPC 표 대응(D25) |
| K9 | **응답을 잃은 replace 는 교체 전 원본을 되살릴 수 없다 — 지금과 같다**(비평 반영 — Q6). 백업은 응답 본문에만 실리고, 같은 명령 id 재전송(바로 응답 유실의 경우)의 `duplicate` 응답에는 백업이 없다. 지금은 재시도가 replace 를 다시 돌려 이미 교체된 트리를 백업한다 — 회귀가 아니라 남은 데이터 보존 구멍이다 | 마법사가 replace 를 보내기 **전에** 읽기 액션으로 백업을 받아 내려받게 한다(D50 — 받기 전에는 실행하지 않는다). 라우트의 백업 응답은 그대로 둔다. 중복 응답의 경고 문구가 사전 백업을 가리킨다(§4.4 #9). 백업을 원장에 넣지 않는 것은 R5 의 결정이다. 중복 응답에도 뒤처리(스냅샷·색인)는 다시 돈다(§4.4 #11) |
| K10 | 무범위 조회를 끝까지 읽으면 큰 프로젝트에서 "잘린 화면"이 "느린 화면"이 된다(레인 B 기준선 3천 행) | 정확성이 먼저(원칙 ①). 800행 p95 기준·1,500행 기록(§6.5), 쪽 나눔·가상화는 SPU2 |
| K11 | null 가중치 정정 뒤 추세선·SPI·포트폴리오 변화량에 계단이 생긴다 | 혼재 루트 프로젝트만이다(D20). 운영 메모·커밋 메시지, 스냅샷은 재계산하지 않는다(개정 결정) |
| K12 | S10 이 거짓 실패를 낸다 — 등록 이름(C 의 '품질'), 템플릿 예시 문구(E23), 화면 사전의 복합어('영업일' 꼴), 짧은 영문 코드의 우연 일치(글꼴 이름·이진 파트). 마스크 목록은 `src` grep 으로 정했고 실제 HTML(RSC 페이로드 포함)은 재 보지 않았다 | D8 의 등록 이름 제외(같은 이름만), 출력 실측 과제(시트·기본 갈래 둘 다), 닫힌 마스크 목록(사전에 그 문자열이 있음을 단언), 대소문자 구분·영문 코드 경계·텍스트 파트만(§6.4), 거짓 적중 표본 단위 테스트(Q39). A2 의 S10 전에 A1 의 `render-pages` 단계가 `/p/B/weekly` 서버 렌더 HTML(RSC 페이로드 포함)을 한 번 재 `sp4-e2e.md` 에 적는다(§6.3 — 재검토 반영 B P3-2). 목록은 닫혀 있다 — 늘릴 때는 그 문자열이 정당한 사전·코드 문자열이라는 실측 근거와 존재 단언을 같은 커밋에 두고, 옛 이름 자체를 마스크하지 않는다 |
| K13 | 표준 Excel 의 깊은 트리 접기는 왕복에서 깊이를 잃는다(옛 빌더와 같은 성질) | 동등성이 판정(R16)이다. 가져오기 깊이 검사·접은 파일의 replace 계층 변화는 SP6 이 맡는다(§9 — 비평 반영 Q28) |
| K14 | 팀 이름 겹침 검사는 같은 범위 안이고 DB 제약이 없어 경합이 남는다. 공용 팀 예약어는 프로젝트 단계 이름을 보지 않는다 | 봇의 모호 거부가 범위 밖 겹침을 맡는다(D24·D37). 공용 팀 예약어의 한계는 기록(D38) |
| K15 | 주간 행 삭제와 영역 FK(restrict)의 순서 경쟁 — D23 의 직접 FK 로 없앴다(1단/2단 구조라 RI 트리거 이름 순서와 무관). 남는 조건: 영역을 지우는 캐스케이드 길이 주간 행을 지우는 길보다 짧아지면(예: `project_areas` 에 workspace FK 를 더하고 `projects → workspaces` 를 cascade 로) 다시 경쟁한다(비평 반영 — Q10) | 마이그레이션 주석에 규칙, 카탈로그 테스트가 직접 FK 를 고정(§3.5 ③), 순서 뒤집기 케이스(§3.5 ②) |
| K16 | 눈확인이 사람 게이트에서 밀린다(개정 R21) | D14 기본값(Phase A 화면 포함 — §8 #4) + 목록·도구·크기를 미리 적었다(§6.6). 사용자가 대안을 고르면 그 체크포인트의 main 반영이 사람을 기다린다(그동안 다음 Phase 는 쌓는다 — D49) |
| K17 | 추정이 실측보다 낮다(SP3a 는 개정 3주 → 스펙 4.3~6.3주). A1 은 고정 비용을 넣으면 상한 3주에 닿는다(§2.2) | 체크포인트마다 실측을 원장에 적는다. **재검토 반영 — T9**(비평 반영 Q28 의 "A 쪽 레버"는 A1 을 줄이지 못했다 — D25 첫 판은 Q9 로 이미 좁혔고 성능·두 조회는 이미 A2 다): **일을 미리 옮기지 않는다.** **발동 시점** — §2.5 ③(마이그레이션 커밋 셋 + `tests/rls/**`·리허설 초록 — A1 추정의 약 40~45%) 끝에서 실측 에이전트 시간을 A1 추정 × 9.4시간/노력주(SP3a 실측 — 비평 범위 머리)와 견주어, 남은 몫까지 3.0주를 넘을 것으로 보이면 아래를 차례로 A2(또는 B)로 넘기고 §7 의 해당 줄을 함께 옮긴다. **넘길 목록** — (a) D25 의 RPC↔표 대응(`tests/gates/_rpc-tables.ts`·`tests/invariants/_ast.ts`·`tests/gates/rpc-tables.test.ts`·`NULL_TABLE_ALLOW` 한 줄) → A2: 그동안 게이트는 지금 main 과 똑같이 RPC 쓰기를 보지 못할 뿐 새 구멍은 아니다(A1 의 null 항목 RPC 가 모듈 표에 쓰는 곳은 R25 가 허용하려는 `upsertArea` 하나) (b) 합성 S1 추가분·S2·S4(월) → A2(A2 의 S10 이 어차피 S2·S4 응답을 다시 돈다) (c) 부정 테스트 1·`tests/negative/sentinels.test.ts`·E2E `weekly-registered-names` → A2(S10 과 함께 — A1 은 §7 의 상수 grep 과 `weekly-outputs` 단계의 페이지 단언을 남긴다) (d) `copyGlobalTeams` 의 전환 RPC 연결과 그 액션 테스트 → B — **이미 기본값으로 옮겼다(T14)**. **넘기지 않는 것** — 데이터 손실 경로·마이그레이션 셋·전환 RPC 와 가져오기 경로·사전 백업(D50)·`p_actor` 불변식(D51)·레인 B 캡처 시드(D53)·주간 소비처. B 의 범위 조정은 §8 #5(결정은 사용자) |
| K18 | 프로젝트 삭제가 `area_teams_team_id_fkey`(RESTRICT)로 막힌다 — 전용 팀이 영역에 붙은 프로젝트(D4·D26·D54 로 흔해진다). 마이그레이션 순서에서 재현되고 덤프 순서에서는 반대로 통과한다(같은 순서 의존)(비평 반영 — Q10) | 앱에 삭제 경로 없음. SP4 테스트는 전용 팀을 영역에 붙이지 않은 임시 프로젝트로 — 전환을 커밋하는 케이스(전환이 영역 팀을 전용 팀으로 옮긴다)는 정리에서 그 프로젝트의 `area_teams` 를 먼저 지운다(§3.5 — 재검토 반영 T8). 프로젝트 삭제 기능을 여는 SP 가 같은 꼴로 고친다(§9 한 줄) |
| K19 | 사람 push 확인이 늦으면 체크포인트의 main 반영과 레인 B 창이 멈춘다 — SP3a 는 같은 구조에서 B·C·D 가 main 에 한 번에 들어갔다(비평 반영 — Q2) | 체크포인트 = 검증 묶음 + 로컬 태그, 확인을 기다리는 동안 다음 Phase 는 직전 체크포인트 HEAD 위에 쌓는다, 레인 B 창은 실제 main 반영 직후에 연다(D49·§2.1.1) |
| K20 | 전환 RPC 가 팀을 가리키는 열을 빠뜨리면 같은 code·다른 id 분열이 남는다(지금 FK 셋 + 초대의 `team_ids` 배열) | 카탈로그 불변식 — `teams` 를 참조하는 FK 열 ∪ `team_ids uuid[]` 열 = RPC 가 옮기는 열(§3.5)이 **잡는다 — 이름 규칙 안에서**(재검토 반영 — T8: FK 없는 단일 uuid 열·다른 이름의 배열·jsonb 안의 팀 id 는 보지 못한다). 새 열을 만드는 SP 의 받는 쪽 기록(§9) |
| K21 | `people.active` 를 service_role 로 직접(PostgREST) 바꾸면 `auth.uid()` 가 null 이고 `app.authz_actor` 를 세팅하는 RPC 도 없어, 권한 이력(`authz_events`)에 행위자가 null 인 'direct' 기록이 남는다(`NNNN_authz_carry` 의 people 분기 — A1-3 리뷰 P3). 지금 `people.active` 를 쓰는 앱 경로는 0 이라 잠재다 | 인물 비활성 액션을 만드는 SP 가 그 쓰기를 RPC 로 하고 RPC 안에서 `app.authz_actor` 를 세팅한다(people 분기는 명령 id 를 비우므로 같이 세팅해도 안전). 그때 이 줄을 닫는다 |
| K22 | 센티널 일치(`scripts/lib/sentinels.mjs`)의 거짓 음성 — 원문 문자열에 바로 `includes`·경계 정규식을 걸어 ① 퍼센트 인코딩(`href` 의 쿼리·`Content-Disposition` 의 `filename*` — 응답 헤더는 검사 대상 밖) ② HTML 숫자 문자 참조·JSON `\uXXXX`·NFD 로 분해된 한글 ③ zip XML 의 런 분할(pptx `<a:r><a:t>` 하나에 한 글자씩, xlsx 리치 텍스트) ④ 소문자로 바뀐 영문 코드(slug·`data-*`·CSS 클래스 — 대소문자 구분은 의도된 결정)를 0건으로 센다(A1-1 리뷰 보안 P3). 이스케이프 뒤 영문 코드(JSON 본문의 `\n` 뒤)는 A1 이 고쳤다 | 부정 테스트·E2E·S10 의 "0건" 은 이 한계 안의 약속이다. A2 의 S10 앞에 정규화 한 단계(NFC·안전한 `%XX` 디코드·엔티티 디코드, zip XML 은 문단(`<a:p>`·`<si>`) 안 텍스트를 이은 문자열도) + 응답을 보는 소비처의 `Content-Disposition` 검사를 판단한다. 대소문자 결정은 유지하고, 출력이 코드를 소문자로 바꾸는 경로가 없다는 실측을 한계 주석에 적는다 |

