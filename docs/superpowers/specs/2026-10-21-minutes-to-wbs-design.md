# 회의록 → WBS 등록 — 브레인스토밍 조사 기록 (2026-10-21)

| 항목 | 내용 |
|---|---|
| 상태 | **설계 전.** 요구 확인 + 코드 조사 완료, 사용자 답 대기 질문 3개(§4). 설계가 확정되면 이 파일을 그대로 설계 스펙으로 승격한다 |
| 크기 | 설계 문서가 필요한 프로젝트(마이그레이션 1 + RPC 1 + 액션 2 + 화면 3곳 + 매뉴얼 + 테스트) |
| 이어가기 | `/superpowers:brainstorming` 으로 §4 질문부터 재개 → 답을 §3 에 반영 → builder check → `superpowers:writing-plans` |
| 조사 기준 | main `4c529107` (2026-10-21) |

## 1. 요구 (사용자 말)

- 회의 중 "이 기능 또는 이 프로그램은 필요하겠다"는 얘기가 나오면 지금은 회의가 끝난 뒤 WBS 화면에서 **수작업으로 다시 등록**한다. 그러지 않고 **회의록 안에서 바로 WBS 항목으로 등록**하고 싶다.
- (짐작, 미확인) 다시 입력하는 수고보다 "회의 때 나온 건데 WBS 에 안 올라가서 잊히는" 쪽이 더 아프다.

## 2. 코드 조사 결과

### 2.1 본보기 — 회의록 → 이슈 흐름(이미 완성돼 있음)

WBS 넘기기는 이 흐름의 쌍둥이로 만든다.

- **진입**: 문단 클릭 팝오버 `src/components/minutes/MinuteBlockPopover.tsx`(「하이라이트」·「이슈로 등록」, 연결 이슈 목록) + 드래그 선택 버블 `MinuteSelectionBubble.tsx`. 조율은 `MinuteViewer.tsx` — `beginIssueCreateFrom(origin)` → `prepareMinuteIssueDraft` → 이슈 폼 → `createIssueFromMinuteBlock`. 회의록에 프로젝트가 없으면 **프로젝트 선택 창**이 먼저 뜬다(`continueWithProject`). 제목 줄(heading)은 등록 불가.
- **액션** `src/app/actions/issues.ts`
  - `prepareMinuteIssueDraft(projectId, source)` — `requireProjectMember` + `requireModule(['issues','minutes'])` → 서버가 버전 본문을 다시 분할해 블록 검증(`verifyMinuteIssueBlock`) → AI 가 제목·내용 초안(캐시 키 `minute-issue-draft-v5:…`), 실패 시 클라이언트 결정형 폴백(`issueDraftFromBlock`).
  - `createIssueFromMinuteBlock(projectId, input, source)` — 같은 가드·관문 → 검증 → service_role RPC `create_issue_from_minute_block`(0030, DEFINER) 이 이슈·담당·원문 링크를 **한 트랜잭션**으로 저장. 발췌 상한 4,000자(`minuteIssueSourceExcerpt`).
- **원문 앵커** `src/lib/minutes/blocks.ts` — mdast 루트 블록 단위(`index` + `fnv1a64(정규화 텍스트)` hash, `draftText`). 키 계약 `src/lib/domain/issueMinuteSource.ts` — `makeMinuteIssueSourceKey`(minute:version:index:hash:kind[:sel:selHash]), kind `manual|action|risk`.
- **저장 표** `issue_links`(0000 기준선): issue_id·project_id·link_type('minute_block' 고정 check)·minute_id·minute_version_id·minute_version_no·source_project_id·minute_title_snapshot·minute_date_snapshot·body_hash·block_index·block_hash·excerpt_snapshot·source_kind·source_key. **issue_id NOT NULL 이라 WBS 에 재사용 불가.**
- **표시**: 문단에 이슈 개수 배지(`BlockMarks.issueCount`, `remarkAnnotateBlocks`), 팝오버 「연결된 이슈」 링크(`/p/[id]/issues?focus=`), 이슈 상세 「회의록 원문 · 원문 위치 보기」.
- **AI 요약** `minute_insights`(kind `decision|action|deadline|risk`, 블록 단위, `MinuteInsightCard.tsx`) — 「액션」 블록이 자연스러운 WBS 후보. 이슈 초안은 insight label 을 제목 후보로 쓴다.
- **매뉴얼**: `src/content/manual/07-meetings-minutes.md` 「이슈로 등록하기」, `05-issues.md` 「회의록에서 이슈 만들기」.

### 2.2 WBS 쪽

- **추가 액션** `src/app/actions/wbs.ts` `addWbsItem(projectId, parentId, name)` — `requireProjectAdmin`. **이름만** 받는다(코드는 이름의 첫 토큰, `wbsNameViolation` 상한). 형제 조회 실패는 중단, 부모 자식에 SUB-ACT(`is_owner_split`)가 섞여 있으면 거부, `sort_order` 채번, `change_logs` 'created', 색인 큐(`enqueueIndexChange`), 첫 자식이면 부모의 직접 실적 정리(`discardRolledUpActual`), `recordProgressSnapshot`. 화면 진입: 최상위는 `WbsAddButton`(이벤트 → `WbsGanttSheet.tsx` ~1376), 하위는 `RowDetailPanel.tsx` ~321(「하위 추가」 이름 입력).
- **`wbs_items` 열**: name·parent_id·code·sort_order·planned_start/end·deliverable·biz·weight·actual_pct·assignee_member_id·external_ref·category·priority·tags·spec·level_idx·milestone … **흐름 5열(stage·review_round·review_steps·dev_workflow·tags)은 RPC 전용**(0026 `guard_workflow_columns`) — 새 행은 흐름 꺼진 빈 행이면 INSERT 허용.
- **권한**: 작업 추가·삭제는 **프로젝트 관리자만**(매뉴얼 `04-wbs.md` 「누가 무엇을 할 수 있나요」). 이슈 등록은 멤버.
- **모듈**: WBS 는 core(`module: null`), 회의록은 워크스페이스 모듈 → 새 액션은 `module: 'minutes'` 로 `tests/gates/manifest.ts` 에 등록. 가드가 projectAdmin 이면 note 불필요.
- **연결 표 없음** → 새 표(가칭 `wbs_item_links`, `issue_links` 와 같은 열 + `wbs_item_id`) + DEFINER RPC(가칭 `create_wbs_item_from_minute_block`, service_role 전용, `actor_is_project_admin(p_actor, …)` 재판정) 필요. 다음 마이그레이션 **0061**(접미 이름으로 참조, `supabase/rollbacks/0061_*_rollback.sql` 동반). `p_actor` 는 가드의 `g.actor.userId` 만(`tests/invariants/rpc-actor-source.test.ts`).
- 프로젝트 삭제(0058 `delete_project`)가 projects 를 따라가는 표를 열거한다 — 새 표는 CASCADE 로 두거나 `project_delete_unknown_references()` 목록을 같은 마이그레이션에서 고친다(`tests/rls/project-delete.test.ts`).

## 3. 제안 뼈대 (짐작 포함, 미승인)

1. 팝오버·선택 버블에 **「WBS로 등록」** 버튼을 이슈 버튼 옆에 둔다. 제목 줄 제외·프로젝트 선택 창·낡은 요청 취소(requestId) 규칙은 이슈와 동일.
2. `prepareMinuteWbsDraft(projectId, source)` — 블록 검증 재사용, AI 가 **작업명(짧게)** 초안. 실패 시 결정형 폴백(insight label 또는 첫 줄, 상한 안으로 자름).
3. **작은 등록 창**: 작업명(필수) + **상위 항목 선택**(필수, 프로젝트 WBS 트리 검색 — SUB-ACT 와 SUB-ACT 섞인 부모는 후보에서 제외) + 선택 칸(계획 시작/종료·담당자·산출물 — §4-1 답에 따라). 저장 뒤 토스트에 「작업 계획에서 보기」 링크.
4. `createWbsItemFromMinuteBlock(projectId, input, source)` — `requireProjectAdmin`(§4-2 답에 따라) + `requireModule({projectId}, 'minutes')` → 검증 → RPC 가 `wbs_items` INSERT + `wbs_item_links` INSERT + `change_logs` 를 한 트랜잭션으로. `addWbsItem` 의 형제·SUB-ACT·채번 규칙을 RPC 안에서 같은 꼴로 적용(코드 쪽 `addWbsItem` 과 두 길이 생기므로 규칙을 한 곳에 모을지 결정 필요). 액션은 성공 뒤 색인 큐·스냅샷·revalidate 를 `addWbsItem` 과 같게.
5. **표시**: 회의록 문단에 WBS 배지(`BlockMarks` 에 `wbsCount`), 팝오버 「연결된 작업」 링크(`/p/[id]/wbs?focus=<itemId>` — 기존 focus 파라미터 지원 여부 확인), WBS 상세 패널에 「회의록 원문 · 원문 위치 보기」(이슈 상세의 컴포넌트 재사용 검토).
6. 매뉴얼 `07-meetings-minutes.md`(「WBS로 등록하기」)·`04-wbs.md`(상세 패널 출처) 갱신 + `manual:build`.
7. 테스트: gates manifest·RLS(새 표 읽기 정책 — 프로젝트 조회 가능자, 쓰기는 service_role 만)·`rpc-actor-source`·`_rpc-tables`(core 가 아니므로 불필요할 수 있음)·단위(초안 폴백·키 계약·트리 후보 필터)·`db:reset` 리허설.

## 4. 사용자 답 대기 질문 (중요 순)

1. **상위 항목과 칸**: 지금 손으로 WBS 에 올릴 때 **어느 줄 밑에 넣을지 어떻게 정하고**, 등록하는 순간에 **꼭 채우는 칸**은 무엇인가? → 등록 창의 모양(트리 선택기 vs 고정 "회의록 발의" 단계, 일정·담당 칸 포함 여부)을 정한다.
2. **누가**: 관리자만(WBS 규칙과 일치, 권고 기본값) vs 멤버도 가능(그러면 WBS 추가 권한 규칙에 예외가 생긴다).
3. **단위**: 한 번에 문단 하나(이슈와 동일, 권고) vs AI 「액션」 항목 여러 개를 골라 한꺼번에(범위 커짐 — 2단계 후보).

기본 포함 예정(사용자가 빼지 않는 한): 회의록 쪽 배지·연결 링크, WBS 쪽 출처 표시, 같은 문단에서 두 번 등록 시 「별도 등록」 안내(이슈와 동일).

## 5. 결정 기록

(아직 없음 — §4 답을 받으면 여기에 날짜와 함께 적는다.)
