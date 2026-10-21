# 회의록 → WBS 등록 — 설계 (2026-10-21)

| 항목 | 내용 |
|---|---|
| 상태 | **설계 승인(2026-10-21).** builder check 1회 반영 뒤 사용자가 이대로 진행을 결정. 구현 계획은 `docs/superpowers/plans/2026-10-21-minutes-to-wbs.md` |
| 크기 | 설계 문서가 필요한 프로젝트 — 마이그레이션 1(표 1 + RPC 1) · 액션 2 · 회의록 화면 3곳 · WBS 상세 1곳 · 매뉴얼 2편 · 테스트 |
| 기준 코드 | main `5d509006` |
| 본보기 | 이미 완성된 **회의록 → 이슈 등록** 흐름(§9 조사 기록). 이 기능은 그 쌍둥이다 |

## 1. 의도와 이유

회의 중 "이 기능(프로그램)은 필요하겠다"는 얘기가 나오면 지금은 회의가 끝난 뒤 WBS 화면에서 **손으로 다시 등록**한다.
회의 한 번에 이런 항목이 **보통 서너 건 이상** 나온다(사용자). 다시 입력하는 수고가 크고, 짐작건대 그보다 더 아픈 건
회의에서 나온 일이 WBS 에 안 올라가 잊히는 것이다.

**설계 원칙(사용자 요구): 사람이 등록하기 편해야 한다.** 이 문서에서는 이것을 "사람은 확인만 하고, 고르고 채우는 일은
시스템이 미리 해 둔다"로 풀었다 — 등록 창이 열리는 순간 작업명·넣을 위치·일정·담당자가 이미 채워져 있고, 사람은 고치거나
그대로 「등록」을 누른다.

## 2. 목표 · 비목표 · 실패 조건

**목표**
- 회의록 문단 하나를 WBS 작업 하나로 등록한다 — 클릭 세 번(문단 → 「WBS로 등록」 → 「등록」).
- 회의록의 AI 「액션」 항목 여러 개를 **한 번에** WBS 작업으로 등록한다.
- 등록된 작업과 회의록 원문이 양쪽에서 서로를 가리킨다(회의록 문단의 WBS 표시 ↔ WBS 작업의 「회의록 원문」).

**비목표(이번에 하지 않는다)**
- 멤버의 등록·"등록 요청" 흐름. WBS 작업 추가는 지금처럼 프로젝트 관리자 전용이다.
- 등록 창에서 담당팀(주관·지원), 가중치, 산출물, Biz, 선행 연결, 업무 흐름 단계를 받는 것. 등록 뒤 WBS 화면에서 지금 하던 대로 고친다.
- 「결정」·「기한」·「리스크」 항목의 목록화. 「기한」은 날짜 미리 채우기에만 쓴다(§4.3).
- 기존 `addWbsItem`(WBS 화면의 수동 추가) 리팩터링. 그 경로는 그대로 둔다.
- 등록한 작업을 회의록이 바뀔 때 따라 고치는 동기화. 연결은 등록 순간의 버전·문단을 가리키는 스냅샷이다(이슈와 같다).

**실패 조건(동작은 해도 실패다)**
- WBS 에 정리 안 된 줄이 쌓이는 것 — 「미분류」·「회의록 발의」 같은 임시 묶음 항목을 만들지 않는다.
- 등록이 기존 데이터를 조용히 망가뜨리는 것 — 특히 하위 없는 작업 밑에 넣을 때 그 작업의 직접 실적%가 말없이 사라지는 것(§5.3).
- 한꺼번에 등록이 일부만 들어가 무엇이 빠졌는지 모르게 되는 것.
- AI 추천을 사람이 확인하지 않고 그대로 저장되게 하는 것 — 저장은 항상 사람이 「등록」을 눌러야 한다.

## 3. 사용자 흐름

### 3.1 한 건 등록 — 문단에서

- **진입**: 문단을 누르면 뜨는 팝오버(`MinuteBlockPopover`)와 드래그 선택 버블(`MinuteSelectionBubble`)에 「WBS로 등록」 단추를
  「이슈로 등록」 옆에 둔다. 제목 줄(heading)은 등록할 수 없다(이슈와 같은 규칙). 지난 버전 보기·보관된 회의록에서는 단추가 없다
  (이슈와 같은 규칙 — 현재 버전에서만).
- **보이는 사람**: 회의록의 프로젝트가 정해져 있으면 그 프로젝트의 관리자에게만. 프로젝트가 없는 회의록이면 같은 워크스페이스에서
  관리자인 프로젝트가 하나라도 있는 사람에게만 보인다.
- **프로젝트 없는 회의록**: 이슈처럼 프로젝트 선택 창이 먼저 뜬다. 후보는 **내가 관리자인 프로젝트**만.
- **등록 창**:
  ```
  ┌ WBS로 등록 ─────────────────────────────┐
  │ 작업명   [로그인 API 개발           ]   │  필수 — AI 초안
  │ 넣을 위치 ● 2. 개발 › 2.1 인증 (추천)   │  필수 — AI 1순위 미리 선택
  │          ○ 2.3 회원관리  ○ 다른 위치 찾기… │  후보 2개 + 트리 검색
  │ ▸ 일정·담당자 (문단에서 찾음: 10/31, 김OO) │  선택 — 찾은 값이 있으면 펼친 채로
  │ 원문: "김OO이 10/31까지 로그인 API…"     │  읽기 전용 발췌
  │                         [취소] [등록]    │
  └─────────────────────────────────────────┘
  ```
  필수 칸은 **작업명과 넣을 위치 둘뿐**이다. 일정(계획 시작·종료)과 담당자는 비워도 등록된다.
- **같은 문단을 다시 등록**: 이미 연결된 작업이 있으면 팝오버에 「연결된 작업」 목록이 보이고 단추 문구가 「WBS로 하나 더 등록」으로 바뀐다
  (이슈의 `createAnother` 와 같은 꼴). 막지는 않는다 — 한 문단에서 작업 둘이 나올 수 있다.
- **등록 뒤**: 성공 토스트에 「작업 계획에서 보기」 → `/p/<projectId>/wbs?focus=<itemId>`(이미 지원하는 focus 파라미터).

### 3.2 한꺼번에 등록 — AI 요약 카드에서

- **진입**: 회의록 AI 요약 카드(`MinuteInsightCard`) 머리에 「WBS로 한꺼번에 등록」 단추. 보이는 조건은 §3.1 의 관리자 조건 +
  현재 버전에 「액션」 항목이 하나 이상 있을 때. AI 요약이 없는(꺼졌거나 아직 안 만든) 회의록에는 뜨지 않는다 — 문단별 등록은 그대로 된다.
- **목록**: 「액션」 항목이 붙은 문단 하나가 한 줄이다(한 문단에 액션이 둘 붙는 일은 없다 — `minute_insights` 가 (minute, block, kind) 유일).
  ```
  ┌ WBS로 한꺼번에 등록 ─────────────────────────────────────┐
  │ [위치 한꺼번에 바꾸기 ▾]                         4건 선택 │
  │ ☑ 로그인 API 개발    │ 2.1 인증 (추천) ▾   │ 10/31 │ 김OO │
  │ ☑ 권한 화면 시안     │ 3.2 화면설계 (추천) ▾│  –   │  –   │
  │ ☑ 성능 테스트 계획   │ 4. 테스트 (추천) ▾   │ 11/7 │  –   │
  │ ☐ 서버 증설 검토     │ 위치를 골라 주세요 ▾  │      │      │
  │ ─ 백업 정책 정리     등록됨 · 작업 계획에서 보기          │
  │                                  [취소] [4건 등록]       │
  └──────────────────────────────────────────────────────────┘
  ```
  - **처음 체크 상태**: 아직 연결된 작업이 없고 추천 위치가 있는 줄은 체크, 추천 위치가 없는 줄은 체크 해제(위치를 고르면 자동 체크).
  - **이미 등록된 줄**: 회색, 체크 불가, 「작업 계획에서 보기」 링크. (그 문단을 또 올리고 싶으면 §3.1 의 「하나 더 등록」을 쓴다.)
    "등록됨" 판정은 §5.6 — 회의록을 고친 뒤에도 문단 내용이 같으면 등록된 것으로 본다.
  - **줄마다** 작업명·위치·종료일·담당자를 고칠 수 있다. 원문 발췌는 줄을 펼치거나 마우스를 올리면 보인다.
  - **「위치 한꺼번에 바꾸기」**: 체크된 줄 전부의 위치를 한 번에 바꾼다(한 회의의 액션은 대개 같은 갈래에 몰린다는 짐작).
  - 순서는 회의록 문단 순서. 같은 위치로 가는 줄들은 그 순서대로 위치의 맨 뒤에 붙는다.
- **저장은 전부 또는 전무**: 한 줄이라도 거부되면 아무것도 저장하지 않는다. 거부된 줄을 빨갛게 표시하고 사유를 줄 밑에 쓴다.
  입력한 값은 창에 그대로 남는다.
- **등록 뒤**: 「N건 등록했습니다」 토스트 + 「작업 계획에서 보기」(첫 작업으로 focus).

### 3.3 등록 뒤 양쪽 표시

- **회의록 쪽**
  - 문단 표시: 이슈 개수 배지 옆에 WBS 작업 개수 배지(`BlockMarks` 에 `wbsCount`, `remarkAnnotateBlocks`).
  - 팝오버 「연결된 작업」: 코드·이름 최대 2개 + 「외 N건」, 각각 `/p/<pid>/wbs?focus=<id>` 링크(이슈 목록과 같은 모양).
  - AI 요약 카드 머리: 이슈 칩 옆에 「WBS N건」 칩, 펼치면 연결된 작업 목록(원문 위치로 이동).
- **WBS 쪽**: 작업 상세 패널(`RowDetailPanel`)에 「회의록 원문」 구역 — 회의록 제목·날짜 스냅샷, 발췌, 「원문 위치 보기」
  (회의록을 그 문단 위치로 연다 — 이슈 상세의 원문 링크와 같은 앵커 방식). 연결이 여럿이면 모두 나열.
- 연결은 **그 프로젝트를 볼 수 있는 사람**에게만 보인다(이슈 연결과 같은 RLS).

## 4. 미리 채우기 (AI 초안)

두 흐름 모두 **한 번의 준비 요청**으로 줄 전부의 초안을 받는다(한 건 등록은 줄 1개짜리 목록). 줄마다 AI 를 따로 부르지 않는다.

### 4.1 작업명
- AI 가 문단(선택 영역이면 선택 발췌)과 그 문단의 insight label 을 보고 **짧은 작업명**을 만든다 — WBS 의 기존 작업명 꼴(명사형, "~ 개발/설계/검토")을 따르도록 기존 이름 몇 개를 예로 준다.
- 상한은 `wbsNameViolation`(`WBS_NAME_MAX`) 안. 넘으면 서버가 자른다.
- 폴백(AI 꺼짐·실패): insight label → 없으면 문단 첫 줄, 상한 안으로 자름. 이슈의 `issueDraftFromBlock` 처럼 클라이언트 결정형 폴백도 둔다.

### 4.2 넣을 위치 추천 — 가장 중요한 칸
- **후보 집합**: 이 프로젝트 WBS 에서
  - **이미 하위 작업이 있는 묶음 항목**이고,
  - 자기 자신이 SUB-ACT(`is_owner_split`)가 아니며,
  - 하위에 SUB-ACT 가 섞여 있지 않고,
  - 단계 깊이 상한 안에서 하위를 더 둘 수 있는 항목(`canAddChild` · `levelDepthOf` — WBS 화면의 「하위 추가」와 같은 판정).
  각 후보는 경로 문자열("2. 개발 › 2.1 인증")과 하위 작업 이름 몇 개를 함께 AI 에 준다(비슷한 형제가 있는 곳이 좋은 위치라는 신호).
- AI 는 줄마다 **후보 id 최대 3개**를 순위대로 돌려준다. 서버는 후보 집합 밖의 id 를 버린다.
- **트리가 클 때**: 후보가 많으면 결정형 점수(작업명·문단 낱말과 경로·하위 이름의 겹침)로 상위 일부만 AI 에 넘긴다. 상한 값은 빌더 몫.
- 폴백(AI 꺼짐·실패): 같은 결정형 점수로 상위 3개. 점수가 모두 0 이면 추천 없음.
- **추천이 없을 때**: 이 회의록 화면에서 마지막으로 고른 위치를 쓴다(화면 상태로만 기억 — 저장하지 않는다). 그것도 없으면 빈 칸("위치를 골라 주세요").
- **「다른 위치 찾기」**: 프로젝트 WBS 트리 검색(이름·코드). 여기서는 후보 집합 밖의 항목도 고를 수 있다 — 맨 위(최상위)와
  **하위가 없는 작업**도 포함. 고를 수 없는 것: SUB-ACT 자신, SUB-ACT 가 섞인 부모, 깊이 상한에 닿은 항목(수동 추가와 같다),
  그리고 **업무 흐름이 켜진(`dev_workflow`) 작업과 진행 중인 에이전트 주문이 있는 작업**(진행 중인 말단 일을 묶음으로 바꾸면
  흐름·주문의 전제가 깨진다 — 회의록 창에서는 그 사정이 보이지 않으므로 아예 후보에서 뺀다).
- **하위가 없는 작업을 고르면**: 그 작업이 묶음 항목으로 바뀐다는 안내와 함께 영향을 **모두** 보이고 확인을 받는다(§5.3):
  직접 입력한 실적%가 있으면 "실적 N%가 지워지고 하위 작업의 진척으로 계산됩니다", 담당자가 있으면 "담당자 OO 은 이 작업에만 남고
  새 하위 작업에는 붙지 않습니다", 선행·후행 연결이 있으면 "선행 연결 N건은 이 작업에 그대로 남습니다". 확인한 사실은 줄 데이터에
  실려 서버로 간다(`confirmParentLeaf`).

### 4.3 일정
- 같은 문단에 「기한」 insight 가 붙어 있거나 문단에 구체적 날짜 표현이 있으면, AI 가 회의 날짜(`minute_date`)를 기준으로 날짜를 해석해 **계획 종료일**을 채운다("다음 주 금요일" 포함).
- 계획 시작일은 채우지 않는다(내 판단 — 근거 없는 계획 데이터를 만들지 않는다). 사람이 넣으면 넣은 대로.
- 폴백: 채우지 않는다. 날짜가 형식에 맞지 않거나 시작 > 종료면 서버가 버린다.

### 4.4 담당자
- AI 가 문단의 사람 이름을 **이 프로젝트의 활성 명단**(project_members 활성 + people 활성)과 맞춰 본다. 정확히 한 명과 맞을 때만 채운다. 애매하면 비운다.
- 폴백: 채우지 않는다. 명단 밖의 id 는 서버가 버린다.

## 5. 저장 규칙

### 5.1 권한·관문
- 가드: `requireProjectAdmin(projectId)` — 준비·등록 두 액션 모두(멤버는 AI 초안도 받지 않는다).
- 모듈 관문: `requireModule({ projectId }, 'minutes')` — 가드 다음, 입력 검증 앞. WBS 는 core 라 관문이 없다.
- RPC 안에서 `actor_is_project_admin(p_actor, p_project_id)` 로 등급을 다시 판정한다. `p_actor` 는 가드 결과의 `g.actor.userId` 만.
- AI 사용 여부는 `aiAvailable({ projectId }, { module: 'minutes' })`.
- 서버는 클라이언트가 보낸 원문을 믿지 않는다 — 이슈의 `verifyMinuteIssueBlock` 처럼 버전 본문을 다시 분할해 블록 index·hash·발췌를 검증한다.

### 5.2 한 트랜잭션
- 등록 1회(1건이든 N건이든) = RPC 1회 = 트랜잭션 1개. 작업 행, 원문 연결 행, 변경 이력('created')이 함께 들어가거나 함께 안 들어간다.
- 거부 사유는 줄 번호와 함께 돌려줘 화면이 그 줄을 표시할 수 있게 한다.
- 상한: 한 번에 30줄(AI 요약의 항목 상한 `ITEMS_CAP` 과 같다).

### 5.3 위치 규칙(수동 추가 `addWbsItem` 과 같은 결과가 나와야 한다)
- 부모는 같은 프로젝트의 항목이거나 최상위(null). 부모가 SUB-ACT 이거나 부모의 하위에 SUB-ACT 가 섞여 있으면 거부.
- `sort_order` 는 그 부모 아래 맨 뒤부터 차례로. 같은 부모로 가는 줄이 여럿이면 회의록 문단 순서대로 이어 붙인다.
- `code` 는 수동 추가와 같은 규칙(이름의 첫 토큰).
- **하위가 없던 부모에 첫 자식이 들어가면** 부모의 직접 실적%를 같은 트랜잭션에서 지우고 그 변경도 이력에 남긴다(`discardRolledUpActual` 과 같은 결과).
  단 **그 줄에 `confirmParentLeaf` 가 없으면 거부**한다(`WBS_PARENT_LEAF_UNCONFIRMED`) — 준비 때는 하위가 있던 부모가 등록 사이에
  하위를 잃었다면 아무도 경고를 보지 못했으므로, 지우지 않고 멈춘다. 플래그가 있는데 그새 하위가 생겼으면 지울 것이 없으니 그냥 넣는다.
- 부모가 업무 흐름이 켜진 작업이거나 진행 중인 에이전트 주문이 있으면 거부(§4.2 의 제외 조건을 RPC 가 다시 본다).
- 준비와 등록 사이에 트리가 바뀌었으면(부모가 지워짐, SUB-ACT 가 생김, 깊이 상한) 그 줄을 거부한다 — 추측으로 다른 곳에 넣지 않는다.

### 5.4 회의록 쪽 검사(이슈 RPC 와 같다)
- 회의록이 없음·보관됨 → 거부. 회의록에 프로젝트가 있고 등록 대상 프로젝트와 다르면 거부.
- 버전이 그 회의록의 것이 아니거나 body_hash 가 다르면(낡은 화면) 거부 — "회의록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요".
- 회의록 워크스페이스와 프로젝트 워크스페이스가 다르면 거부(표 트리거 — `issue_links_minute_scope` 와 같은 꼴).

### 5.5 등록 뒤 처리(액션 — 트랜잭션 밖)
- 작업마다 색인 큐(`enqueueIndexChange`), 진척 스냅샷 1회(`recordProgressSnapshot`), `revalidatePath` — `addWbsItem` 과 같게.
- **담당자를 지정한 줄**은 기존 담당자 지정(`setWbsAssignee`)의 부수효과를 그대로 따른다 — 같은 순서로 같은 도우미 셋을 부른다:
  `applyWorkflowEvent('assign')` → `emitNotification('work.assigned')` → `ensureOrderForWorkflowLeaf`. 셋은 이미 따로 있는 함수라
  `setWbsAssignee` 를 고치지 않는다. 새 작업은 `dev_workflow` 가 꺼진 채 생기므로 실제로는 알림 하나만 나간다. 실패는 로그만 남기고
  등록 성공은 유지한다(`setWbsAssignee` 와 같은 원칙).
- 담당자 열(`assignee_member_id`) 자체는 RPC 가 행을 만들 때 넣는다(명단 검증은 RPC 안에서도 다시).

### 5.6 "등록됨" 판정과 중복 방지
- 회의록을 고치면 버전이 바뀌고 AI 요약도 다시 만들어진다. 이슈 연결은 현재 버전과 id·hash 가 모두 맞을 때만 "연결됨"으로 그리는데
  (`MinuteViewer` 의 `activeLinkedIssues`), WBS 에 그 규칙을 그대로 쓰면 오타 하나 고친 뒤 한꺼번에 등록 창이 모든 줄을 미등록으로
  보여 **한 번 더 누르면 전부 중복**된다. §2 의 실패 조건이다.
- 그래서 WBS 연결은 **문단 내용(block_hash)** 으로 판정한다: 그 회의록(`minute_id`)·그 프로젝트에 같은 `block_hash` 의 연결이
  있으면 버전이 달라도 "등록됨"이다(문단 표시·팝오버 목록·한꺼번에 창 모두). 문단 내용을 고치면 hash 가 바뀌어 새 문단으로 보인다 —
  그 한계는 받아들인다(이슈와 같다).
- **RPC 도 막는다**: `source_kind = 'action'` 줄은 같은 (project_id, minute_id, block_hash) 연결이 이미 있으면 거부한다
  (`MINUTE_BLOCK_ALREADY_LINKED`, 줄 번호 포함). 두 번 누름·재전송을 DB 가 잡는다. 표에는 그 조건의 **부분 유일 인덱스**를 둔다
  (`where source_kind = 'action'`). `manual`(문단·선택 등록)은 「하나 더 등록」을 허용하므로 유일 조건이 없다.
- **WBS 바꿔치기 가져오기**(`replace_wbs` — `wbs_items` 전부 삭제)는 CASCADE 로 연결을 함께 지운다. 변경 이력이 사라진다고 이미
  경고하는 자리(`REPLACE_WARNINGS`, `src/app/api/import/execute/route.ts`)에 "회의록 연결도 사라집니다"를 더한다. 그 뒤 회의록에서
  보면 전부 미등록으로 보이는데, 작업 자체가 새로 들어온 것이므로 맞는 상태다.

## 6. 데이터

### 6.1 새 표 `wbs_item_links` — `issue_links` 의 쌍둥이
- 열: `issue_links` 와 같은 원문 열(minute_id · minute_version_id · minute_version_no · source_project_id · minute_title_snapshot ·
  minute_date_snapshot · body_hash · block_index · block_hash · excerpt_snapshot · source_kind · source_key · created_at) + `wbs_item_id` · `project_id` · `link_type`('minute_block' 고정).
- `source_kind`: `'manual' | 'action'`(문단·선택 등록은 manual, 한꺼번에 등록은 action). 키는 `makeMinuteIssueSourceKey` 와 같은 계약을 쓴다 — 이름이 이슈 전용이면 공용 이름으로 옮기는 것은 빌더 몫.
- 참조: (wbs_item_id, project_id) → `wbs_items(id, project_id)` **ON DELETE CASCADE**(작업을 지우면 연결도 사라진다),
  (minute_version_id, minute_id) → `minute_versions` **RESTRICT**(이슈와 같다).
- 권한: RLS 켬. 읽기 정책 `project_id in (select public.accessible_project_ids())`(이슈 연결과 같다). authenticated 는 SELECT 만, 쓰기는 service_role 만.
- 트리거: 워크스페이스 일치 검사(BEFORE INSERT OR UPDATE OF minute_id, project_id). **삭제 트리거는 두지 않는다**.
- 인덱스: 이슈 연결과 같은 꼴(작업별, 회의록 블록별, 프로젝트별, source_key) + **부분 유일** `(project_id, minute_id, block_hash) where source_kind = 'action'`(§5.6).
- 프로젝트 삭제: CASCADE 로 wbs_items 를 따라가고 비-CASCADE 참조가 표를 **가리키지** 않으므로 `project_delete_unknown_references()` 목록은
  바뀌지 않아야 한다 — `tests/rls/project-delete.test.ts` 로 확인한다.

### 6.2 새 RPC `create_wbs_items_from_minute`
- SECURITY DEFINER, `search_path ''`, service_role 만 실행(public·anon·authenticated 회수).
- 인자: 프로젝트, 행위자, 회의록 id·버전 id·body_hash, 줄 배열(jsonb — 작업명·부모 id·계획 시작·종료·담당자·block_index·block_hash·발췌·source_kind·source_key·`confirmParentLeaf`).
- 반환: 줄 번호 · 작업 id · 코드.
- 오류 코드는 이슈 RPC 의 꼴(`MINUTE_*`, `WBS_*`)을 따르고 줄 번호를 detail 에 싣는다.
- `wbs_items` INSERT 는 흐름 다섯 열을 비운 새 행이라 `guard_workflow_columns` 와 부딪치지 않는다(service_role 이기도 하다).

### 6.3 마이그레이션
- `supabase/migrations/0061_minute_wbs_links.sql` + `supabase/rollbacks/0061_minute_wbs_links_rollback.sql`. 테스트는 접미 `*_minute_wbs_links.sql` 로 찾는다.
- 사후 검사 블록(이 리포 마이그레이션의 관례)으로 RPC 의 DEFINER·search_path·실행권, 표의 RLS·권한을 확인한다.

## 7. 서버 액션 · 화면 · 문서

- **액션 2개**(새 파일 `src/app/actions/minuteWbs.ts` 가 자연스럽다 — 위치는 빌더 몫):
  - `prepareMinuteWbsDrafts(projectId, minuteRef, sources[])` → 줄마다 { 작업명, 위치 후보 ≤3, 계획 종료일?, 담당자? } + 후보 트리(검색용).
    캐시 키는 이슈 초안처럼 버전·블록·hash·프롬프트 해시를 넣는다.
  - `createWbsItemsFromMinute(projectId, minuteRef, rows[])` → RPC 호출 → 등록 뒤 처리(§5.5).
  - 둘 다 `tests/gates/manifest.ts` 에 `guard: 'projectAdmin', module: 'minutes'` 로 등록.
- **회의록 화면**: `MinuteViewer`(조율 — 이슈 흐름의 requestId 취소 규칙을 그대로), `MinuteBlockPopover`·`MinuteSelectionBubble`(단추),
  `MinuteInsightCard`(한꺼번에 단추·칩), 새 등록 창 컴포넌트 2개(한 건·여러 건 — 줄 컴포넌트를 공유). 회의록 페이지 서버 컴포넌트가
  연결된 작업과 "내가 관리자인 프로젝트" 정보를 내려준다.
- **WBS 화면**: `RowDetailPanel` 에 「회의록 원문」 구역.
- **가져오기 API**: `src/app/api/import/execute/route.ts` 의 `REPLACE_WARNINGS` 에 회의록 연결 유실 경고 1줄(§5.6).
- **문구**: 한국어 사전(`src/lib/i18n/dict/minutes.ts`·`wbs` 사전)에만.
- **매뉴얼**: `07-meetings-minutes.md` 에 「WBS로 등록하기」「한꺼번에 등록하기」, `04-wbs.md` 상세 패널에 「회의록 원문」. 매뉴얼 빌드 갱신.

## 8. 제약 (CLAUDE.md)

- 마이그레이션 커밋과 코드 커밋을 나눈다(G1). 로컬 `npm run db:reset` 초록 → `Staging-verified:` 트레일러(G4).
- main push 전에 운영 DB 에 0061 을 먼저 적용하고 `schema_migrations` 행을 넣는다.
- 바꾸는 화면 파일 중 UI 위험 파일(`globals.css`·레이아웃·`src/components/app/*`)은 없을 예정이다. 생기면 브랜치 규칙을 따른다.
- 상태 변형 display 유틸(`group-hover:flex` 등)을 쓰지 않는다(반응형 안전망).
- 에러 처리 3원칙: 후보 트리·명단·연결 조회 실패를 "없음"으로 그리지 않는다 — 위치 후보를 못 읽으면 등록 창을 열지 않고 사유를 보인다.
  연결 목록을 못 읽으면 "등록됨" 판정을 할 수 없으므로 한꺼번에 등록 창도 열지 않는다.

## 9. 빌더에게 맡기는 것

- 등록 창의 세부 배치·반응형(좁은 화면에서 여러 줄 표를 카드로 접는 방식 등), 트리 검색 UI.
- 결정형 위치 점수의 공식과 AI 에 넘길 후보 상한.
- AI 프롬프트 문안과 캐시 키 버전 이름.
- 원문 키 함수를 공용 이름으로 옮길지.
- 액션·컴포넌트 파일 이름과 위치.

## 10. 결정 기록

**사용자 결정 (2026-10-21)**
- 설계 기준은 "사람이 등록하기 편한 방향"이고, 방향 제안은 Claude 에게 맡긴다.
- 한꺼번에 등록을 **첫 단계에 포함**한다(회의 한 번에 보통 서너 건 이상).
- 「기한」은 목록 줄로 넣지 않고 같은 문단의 날짜를 채우는 데만 쓴다.

**Claude 제안 — 사용자가 이의 없이 진행 (2026-10-21)**
- 진입은 이슈 등록과 같은 자리(팝오버·선택 버블) + AI 요약 카드.
- 필수 칸은 작업명·위치 둘. 위치는 AI 가 미리 고르고 후보 2개 + 검색.
- 임시 묶음 항목(미분류 바구니)을 만들지 않는다.
- 프로젝트 관리자 전용(WBS 추가 규칙과 일치).
- 한꺼번에 등록은 전부 또는 전무.

**Claude 판단 — 문서 작성 중 정함 (검토 바람)**
- 위치 추천 후보는 이미 하위가 있는 묶음 항목만. 하위 없는 작업은 검색으로만, 실적이 있으면 경고 후 확인(§4.2·§5.3).
- 계획 시작일은 채우지 않는다(§4.3).
- 담당자는 활성 명단과 정확히 한 명이 맞을 때만 채운다(§4.4).
- 담당자 지정의 부수효과는 `setWbsAssignee` 가 쓰는 도우미 셋을 같은 순서로 부른다 — 기존 액션은 고치지 않는다(§5.5).
- 같은 문단의 재등록은 막지 않고 「하나 더 등록」으로 허용한다(이슈와 같다).
- 한 번에 30줄 상한.
- "마지막으로 고른 위치"는 화면 상태로만 기억한다.

**Claude 판단 — builder check 뒤 (2026-10-21, 검토 바람)**
- "등록됨"은 버전이 아니라 문단 내용(block_hash)으로 판정한다. 한꺼번에 등록(`action`)은 같은 문단의 중복을 DB 유일 인덱스와 RPC 가 막는다(§5.6).
- WBS 바꿔치기 가져오기는 연결을 지우되 경고 한 줄을 더한다(§5.6).
- 업무 흐름이 켜진 작업·진행 중 에이전트 주문이 있는 작업은 부모로 고를 수 없다. 하위 없는 작업을 고르면 실적·담당자·선행 연결 영향을
  모두 보이고 확인을 받으며, 그 확인(`confirmParentLeaf`)이 없으면 RPC 가 실적을 지우지 않고 거부한다(§4.2·§5.3).
- 위치 후보는 깊이 상한(`canAddChild`)도 본다(§4.2).

---

## 부록 A. 조사 기록 (main `4c529107`, 2026-10-21)

### A.1 본보기 — 회의록 → 이슈 흐름
- **진입**: 문단 클릭 팝오버 `src/components/minutes/MinuteBlockPopover.tsx`(「하이라이트」·「이슈로 등록」, 연결 이슈 목록) + 드래그 선택 버블 `MinuteSelectionBubble.tsx`. 조율은 `MinuteViewer.tsx` — `beginIssueCreateFrom(origin)` → `prepareMinuteIssueDraft` → 이슈 폼 → `createIssueFromMinuteBlock`. 회의록에 프로젝트가 없으면 프로젝트 선택 창이 먼저 뜬다(`continueWithProject`). 낡은 요청은 `issueProjectRequestRef`(requestId)로 취소.
- **액션** `src/app/actions/issues.ts` — `prepareMinuteIssueDraft`(가드 → 모듈 관문 → `verifyMinuteIssueBlock` → AI 초안, 캐시 키 `minute-issue-draft-v5:…`), `createIssueFromMinuteBlock`(같은 가드·관문 → 검증 → service_role RPC `create_issue_from_minute_block`(0030, DEFINER)이 이슈·담당·원문 링크를 한 트랜잭션으로). 발췌 상한 4,000자.
- **원문 앵커** `src/lib/minutes/blocks.ts`(mdast 루트 블록 — index + `fnv1a64` hash). 키 계약 `src/lib/domain/issueMinuteSource.ts`.
- **저장 표** `issue_links`(0000) — `issue_id NOT NULL` 이라 WBS 에 재사용 불가. RLS 읽기는 0006 에서 `accessible_project_ids()` 로 좁혔고, 0009 가 워크스페이스 일치 트리거(`issue_links_minute_scope`)를 붙였다.
- **AI 요약** `minute_insights`(`src/lib/ai/minutes-insights.ts`) — kind 4종: decision(확정 결정), action(담당자가 할 일), deadline(구체적 기한·일정 약속), risk. (minute, block, kind) 유일, 항목 상한 30.
- **테스트**: `tests/actions/issue-from-minute.test.ts`, `tests/rls/minute-issue-custom-fields.test.ts`, `tests/ui/minute-issue-draft-flow.test.tsx`, `tests/rls/isolation-map.ts`, `tests/gates/_tables.ts`, `tests/invariants/index-enqueue-wiring.test.ts`.

### A.2 WBS 쪽
- **수동 추가** `src/app/actions/wbs.ts` `addWbsItem(projectId, parentId, name)` — `requireProjectAdmin`, 이름만, 형제 조회 실패는 중단, SUB-ACT 섞인 부모 거부, `sort_order` 채번, code = 이름 첫 토큰, `change_logs` 'created', 색인 큐, 첫 자식이면 `discardRolledUpActual`(부모 직접 실적% 지움), `recordProgressSnapshot`.
- **담당자** `src/app/actions/wbsAssign.ts` `setWbsAssignee` — 활성 명단 검증, 쓰기 뒤 `applyWorkflowEvent('assign')`, `work.assigned` 알림, `ensureOrderForWorkflowLeaf`.
- **일정** `updateWbsFields` — 시작 > 종료 거부, 선행 연결이 있는 작업은 날짜를 비울 수 없음.
- `wbs_items` 는 `(id, project_id)` 유일 제약이 있어 복합 FK 가 가능하다. 흐름 다섯 열은 RPC 전용(0026).
- WBS 페이지는 `?focus=<itemId>` 를 이미 지원한다(`src/app/(app)/p/[projectId]/wbs/page.tsx`).
- 프로젝트 삭제(0058)의 `project_delete_unknown_references()` 는 projects 를 캐스케이드로 따라가는 표를 **가리키는** 비-CASCADE 참조와 삭제 트리거만 잡는다.
