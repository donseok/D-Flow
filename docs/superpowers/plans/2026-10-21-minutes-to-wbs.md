# 회의록 → WBS 등록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 관리자가 회의록 문단 하나, 또는 AI 요약의 「액션」 여러 건을 창 하나에서 확인만 하고 WBS 작업으로 등록하며, 등록된 작업과 회의록 원문이 양쪽에서 서로를 가리킨다.

**Architecture:** 이미 완성된 회의록→이슈 흐름의 쌍둥이. 원문 검증(`verifyMinuteIssueBlock`)은 액션 파일에서 서버 전용 라이브러리로 옮겨 두 흐름이 공유한다. 저장은 새 표 `wbs_item_links`(`issue_links` 의 쌍둥이) + service_role 전용 DEFINER RPC `create_wbs_items_from_minute`(N 줄 = 트랜잭션 1개, 등급 재판정, 중복·부모 규칙을 DB 가 다시 봄) 한 길. 준비 액션 하나가 줄 전부의 작업명·위치 후보·종료일·담당자를 AI 한 번으로 채우고, 실패하면 결정형 폴백. "등록됨" 판정은 버전이 아니라 문단 내용(block_hash).

**Tech Stack:** Next.js 15 App Router(서버 액션), Supabase(Postgres·RLS·DEFINER RPC), vitest(+ `vitest.config.rls.ts`), React 19 + Tailwind v4, remark 블록 주석.

**Spec:** `docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md` — 모든 작업은 이 설계를 따른다. 설계와 다른 곳은 아래 "설계와의 차이".

## Global Constraints

- 한국어 전용·라이트 전용. 화면 문구는 `src/lib/i18n/dict/*`(클라이언트 `useLocale().t`), 서버 액션 문구는 `src/lib/i18n/dict/serverUi.ts`(`serverTranslator()`). `.tsx`·`src/app/actions/**` 에 한국어 리터럴 금지(`tests/invariants/i18n-no-korean-literals`·`i18n-server-messages`).
- `git add -A` 금지. 마이그레이션(`supabase/migrations/*`·`rollbacks/*`·`tests/rls/*`)과 코드는 **다른 커밋**(G1). 마이그레이션 커밋은 로컬 `npm run db:reset` 초록 뒤 트레일러 `Staging-verified: local db reset <YYYY-MM-DD HH:MM>`(G4).
- `src/app/globals.css` 는 UI 위험 파일 — 이 계획 전체를 브랜치 `ui/minutes-to-wbs` 에서 하고, globals.css 를 건드린 커밋에 `Preview-checked: local <YYYY-MM-DD HH:MM> — 회의록 상세(문단 배지)` 트레일러(Task 10). push·머지·운영 DB 적용은 사람 확인 뒤.
- 상태 변형 display 유틸(`group-hover:flex`·`data-[…]:hidden` 등) 금지. 한 요소에 컨테이너 쿼리 display 와 반응형 display 혼용 금지.
- 가드는 `requireProjectAdmin(pid)`·`requireProjectMember(pid)` 만. 모듈 관문 `requireModule({ projectId }, 'minutes')` 는 **가드 다음·입력 검증 앞**, 그 결과를 조건에 써야 한다(`tests/gates/deny.test.ts`). RPC 의 `p_actor` 에는 `const g = await requireProjectAdmin(…)` 의 `g.actor.userId` 만(인라인 객체 리터럴, 뒤에 spread 없음).
- `'use server'` 파일은 async 함수와 타입만 export. `src/lib/domain/**` 는 `src/app/**` 를 import 하지 않는다.
- `minutes` 표는 `select('*')`·`minutes(*)` 임베드 금지.
- 새 표 식별자에 `atomic` 접미 금지. 새 마이그레이션은 접미(`*_minute_wbs_links.sql`)로 찾는다.
- 조회 실패를 "없음"으로 그리지 않는다: 연결 목록·위치 후보·명단을 못 읽으면 등록 창을 열지 않고 사유를 보인다.
- 작업명 상한 `WBS_NAME_MAX = 200`(`src/lib/domain/wbsValueRules.ts`), 발췌 상한 4,000자(`minuteIssueSourceExcerpt`), 한 번에 `MINUTE_WBS_ROWS_MAX = 30` 줄.

## Review Focus

1. **회의록을 고친 뒤 한꺼번에 등록** — 오타만 고친 회의록(새 버전, 같은 문단 hash)에서 창을 열면 등록된 줄이 "등록됨"으로 보이고 체크되지 않는다. (Task 5 `activeLinkedWbsItems` 테스트·Task 8 bulk 기본 체크 테스트)
2. **같은 등록을 두 번 보냄** — 「N건 등록」을 두 번 누르거나 재전송하면 두 번째는 `MINUTE_BLOCK_ALREADY_LINKED` 로 전부 거부되고 줄이 하나도 추가되지 않는다. (Task 1 RLS 테스트)
3. **준비와 등록 사이에 부모가 하위를 잃음** — `confirmParentLeaf=false` 줄의 부모가 그새 말단이 되면 RPC 가 실적을 지우지 않고 `WBS_PARENT_LEAF_UNCONFIRMED` 로 멈춘다. (Task 1 RLS 테스트)
4. **멤버가 액션을 직접 부름** — 프로젝트 멤버(관리자 아님)가 `prepareMinuteWbsDrafts`·`createWbsItemsFromMinute` 를 부르면 가드가 닫고 DB·AI 에 닿지 않는다. (Task 4 단위 테스트 + gates deny)
5. **다른 워크스페이스의 회의록** — 프로젝트 없는 회의록(워크스페이스 A)을 B 프로젝트에 등록하면 액션 검증(`verifyMinuteIssueBlock` 의 워크스페이스 불일치 — Task 2 가 옮기되 `tests/actions/issue-from-minute.test.ts` 가 그대로 지킨다)과 표 트리거(`MINUTE_WORKSPACE_MISMATCH`) 두 곳이 막는다. (Task 1 RLS 테스트)

---

## 실행 순서와 커밋

브랜치 `git switch -c ui/minutes-to-wbs` 에서 시작한다(Task 10 이 globals.css 를 건드린다). Task 1 은 마이그레이션·롤백·`tests/rls`·픽스처만 담은 단독 커밋. Task 2~9 는 각각 코드 커밋. Task 10 의 globals.css 커밋에 `Preview-checked: local …` 트레일러. 그 뒤 **사람 확인**: 운영 DB 에 0061 적용(`PROD_REF=aivjcfoeshnhqdrfteyq npm run db:apply -- supabase/migrations/0061_minute_wbs_links.sql --target prod` + `schema_migrations` 행) → `git push -u origin HEAD` → `main` ff 머지·push → `SMOKE_URL=… npm run smoke:prod`. 커밋 메시지는 한국어·"왜", 말미 attribution 은 세션 규칙대로.

사전 조건: Docker 런타임 + `npm run db:start` + `npm run env:local`(RLS 테스트가 `.env.local` 의 로컬 DB 를 쓴다).

---

## 공유 계약(작업 사이의 이름)

### 설계와의 차이(계획이 정한 것)
- **클라이언트 결정형 폴백은 두지 않는다**(설계 §4.1 마지막 줄). 등록 창은 서버가 준 위치 후보 목록 없이는 열 수 없으므로, 준비 요청이 네트워크로 실패하면 토스트로 알리고 열지 않는다. AI 꺼짐·실패의 폴백은 서버 안에서 결정형으로 한다(`mode: 'fallback'`).
- **창은 컴포넌트 하나**(`MinuteWbsRegisterModal`, `mode: 'single' | 'bulk'`) — 설계 §7 의 "컴포넌트 2개(줄 공유)" 는 한 컴포넌트의 두 모양으로 구현한다.
- **깊이 상한은 액션이 설정에서 읽어 RPC 에 `p_max_depth` 로 넘긴다**(설계 §5.3 "깊이 상한" 거부를 RPC 가 하려면 상한을 알아야 한다). 설정을 못 읽으면 등록하지 않는다.
- **진행 중인 에이전트 주문** = `agent_work_orders.status in ('ready','claimed','reported')`(활성 유일 인덱스와 같은 집합).
- **토스트에 링크**: `src/components/ui/Toast.tsx` 의 `ToastInput` 에 `action?: { label: string; href: string }` 을 더한다(지금은 링크가 없다). action 이 있는 토스트는 8,000ms 뒤 닫힌다.
- **연결 목록 조회 실패 시 문단 등록도 닫는다**(설계 §8 은 한꺼번에 창만 언급) — 둘 다 같은 목록으로 "등록됨"을 그리므로 함께 닫고 사유를 보인다.
- `?focus=<itemId>` 는 그 줄을 펼쳐 강조·스크롤만 한다(상세 패널은 열지 않는다 — 기존 동작, 바꾸지 않는다).
- `MinuteIssueSourceInput` 인터페이스는 `src/app/actions/issues.ts` 에서 **`src/lib/domain/issueMinuteSource.ts` 로 옮긴다**(클라이언트·도메인·서버가 함께 쓴다). `issues.ts` 는 같은 이름으로 재export 한다(타입 재export 는 `use-server-exports` 허용).

### 파일과 공개 이름

#### supabase/migrations/0061_minute_wbs_links.sql (+ supabase/rollbacks/0061_minute_wbs_links_rollback.sql) — Task 1
- 표 `public.wbs_item_links` — 열: `id uuid pk default gen_random_uuid()`, `wbs_item_id uuid not null`, `project_id uuid not null`, `link_type text not null default 'minute_block' check (= 'minute_block')`, `minute_id uuid not null`, `minute_version_id uuid not null`, `minute_version_no integer not null check (> 0)`, `source_project_id uuid`(FK 없음), `minute_title_snapshot text not null`, `minute_date_snapshot date not null`, `body_hash text not null check (btrim <> '')`, `block_index integer not null check (>= 0)`, `block_hash text not null check (btrim <> '')`, `excerpt_snapshot text not null check (btrim <> '')`, `source_kind text not null default 'manual' check (in ('manual','action'))`, `source_key text check (null or btrim <> '')`, `created_at timestamptz not null default now()`.
- FK 둘만: `wbs_item_links_item_project_fk (wbs_item_id, project_id) references wbs_items(id, project_id) on delete cascade`, `wbs_item_links_version_minute_fk (minute_version_id, minute_id) references minute_versions(id, minute_id) on delete restrict`.
- 인덱스: `(wbs_item_id, created_at)`, `(minute_id, minute_version_id, block_index, block_hash, created_at)`, `(project_id, created_at desc)`, `(source_key) where source_key is not null`, **부분 유일** `wbs_item_links_action_block_uidx (project_id, minute_id, block_hash) where source_kind = 'action'`.
- 권한·정책: `revoke all … from public, anon, authenticated; grant all … to service_role; grant select … to authenticated; enable row level security; create policy wbs_item_links_ws_read … for select to authenticated using (project_id in (select public.accessible_project_ids()))`(0006 이후의 `<표>_ws_read` 관례 — 리뷰에서 고침).
- 트리거 `wbs_item_links_minute_scope` BEFORE INSERT OR UPDATE OF minute_id, project_id — 본문은 0009 의 `issue_links_minute_scope()` 와 같은 판정(`MINUTE_WORKSPACE_MISMATCH`, 23514). **삭제 트리거 없음.**
- RPC `public.create_wbs_items_from_minute(p_project_id uuid, p_actor uuid, p_minute_id uuid, p_minute_version_id uuid, p_body_hash text, p_max_depth integer, p_rows jsonb) returns jsonb` — DEFINER, `set search_path to ''`, `set lock_timeout to '15s'`, service_role 만 실행. 반환 `[{"row":0,"item_id":"…","code":"…"}, …]`.
  - `p_rows` 원소: `{ "name", "parent_id"(uuid|null), "planned_start"(date|null), "planned_end"(date|null), "assignee_member_id"(uuid|null), "block_index", "block_hash", "excerpt", "source_kind"('manual'|'action'), "source_key"(text|null), "confirm_parent_leaf"(bool) }`.
  - 오류(`raise exception using errcode, message, detail` — detail 은 줄 번호 문자열, 줄과 무관하면 null): `22023 MINUTE_WBS_ROWS_INVALID`(배열 아님·0줄·30줄 초과·원소 모양) · `42501 WBS_ACTOR_FORBIDDEN`(관리자 아님 **또는 프로젝트 없음**) · `25001 MINUTE_WBS_ISOLATION`(잠금 뒤 read committed 가 아님 — H2 규칙 ③, 앱 경로에서는 나지 않음) · `P0002 MINUTE_NOT_FOUND`(없거나 **프로젝트의 워크스페이스 밖**) · `55000 MINUTE_ARCHIVED` · `23514 MINUTE_PROJECT_MISMATCH` · `P0002 MINUTE_VERSION_NOT_FOUND` · `22023 MINUTE_BODY_STALE` · `22023 WBS_NAME_REQUIRED`(줄) · `22023 WBS_NAME_TOO_LONG`(줄, 200자) · `P0002 WBS_PARENT_NOT_FOUND`(줄) · `23514 WBS_PARENT_SUB_ACT`(줄 — 부모가 SUB-ACT 이거나 하위에 SUB-ACT) · `23514 WBS_PARENT_WORKFLOW`(줄 — `dev_workflow` 또는 활성 주문) · `23514 WBS_PARENT_DEPTH`(줄) · `23514 WBS_PARENT_LEAF_UNCONFIRMED`(줄) · `22023 WBS_DATE_RANGE_INVALID`(줄) · `22023 WBS_ASSIGNEE_INVALID`(줄 — 활성 명단·활성 인물·같은 프로젝트 아님) · `23505 MINUTE_BLOCK_ALREADY_LINKED`(줄 — `action` 줄만).
- 사후검사 `do` 블록(`MINUTE_WBS_POSTCHECK: …`): RPC 실행권(anon·authenticated 불가, service_role 가능), DEFINER + `search_path=""`, 표 RLS 켜짐, authenticated 에 select 만, 부분 유일 인덱스 존재, `public.project_delete_unknown_references()` 가 null.

#### src/lib/domain/issueMinuteSource.ts (순수) — Task 2 에서 더한다
```ts
export interface MinuteIssueSourceInput {    // issues.ts:102 에서 옮긴다(내용 그대로)
  minuteId: string; minuteVersionId: string; bodyHash: string; blockIndex: number; blockHash: string
  kind: IssueMinuteSourceKind; selection?: { text: string; endBlockIndex: number; endBlockHash: string }
}
```

#### src/lib/minutes/verifySource.ts ('server-only') — Task 2
```ts
export interface VerifiedMinuteIssueBlock { storedBodyHash: string; block: MinuteBlock; insightLabel: string | null; draftContextText: string; selectionExcerpt: string | null }
export type MinuteIssueBlockVerification = { ok: true; value: VerifiedMinuteIssueBlock } | { ok: false; error: string }
export async function verifyMinuteIssueBlock(projectId: string, projectWorkspaceId: string | undefined, source: MinuteIssueSourceInput, logLabel: string, includeInsight?: boolean): Promise<MinuteIssueBlockVerification>
export function minuteIssueSourceExcerpt(value: string): string          // 4,000자 상한 + 안내 꼬리
```
issues.ts 에서 옮기는 것(동작 불변): `verifyMinuteIssueBlock`·`validMinuteIssueSource`·`BLOCK_HASH_RE`·`minuteIssueDraftContext`·`selectionRangeContext`·`VerifiedMinuteIssueBlock`·`MinuteIssueBlockVerification`·`minuteIssueSourceExcerpt`·`MINUTE_ISSUE_SOURCE_EXCERPT_*`.

#### src/lib/domain/minuteWbs.ts (순수, 클라이언트·서버 공용) — Task 3
```ts
export const MINUTE_WBS_ROWS_MAX = 30
export const MINUTE_WBS_SOURCE_KINDS = ['manual', 'action'] as const
export type MinuteWbsSourceKind = (typeof MINUTE_WBS_SOURCE_KINDS)[number]
export const WBS_ROOT_PARENT = '__root__'                  // 선택기의 "맨 위" 값 — 제출 때 parentId null 로 바꾼다
export const MINUTE_WBS_PROMPT_CANDIDATES_MAX = 80
/** 트리 한 줄 — getComputedWbs 의 ComputedItem 에서 뽑는다(depth 0-based) */
export interface MinuteWbsTreeRow { id: string; parentId: string | null; name: string; isOwnerSplit: boolean; actualPct: number | null; assigneeMemberId: string | null; devWorkflow: boolean; depth: number }
/** 고를 수 있는 부모 — path 는 "1 설계 › 1.2 인증" 꼴(번호 + 이름을 ' › ' 로) */
export interface MinuteWbsParentOption { id: string; path: string; depth: number; leaf: boolean; actualPct: number | null; assigneeMemberId: string | null; dependencyCount: number; childNames: string[] }
export function pickableParents(rows: readonly MinuteWbsTreeRow[], opts: { maxDepth: number | null; numbers: ReadonlyMap<string, string>; activeOrderItemIds: ReadonlySet<string>; dependencyCounts: ReadonlyMap<string, number> }): MinuteWbsParentOption[]
/** AI 후보 = 하위가 이미 있는 것만(leaf=false) */
export function recommendableParents(options: readonly MinuteWbsParentOption[]): MinuteWbsParentOption[]
/** 결정형 점수 — 2글자 이상 낱말(공백·구두점 분리, 소문자)의 겹침 수, 경로 겹침 2점·하위 이름 겹침 1점. 0점은 뺀다. 상위 limit 개 id */
export function scoreParentCandidates(text: string, options: readonly MinuteWbsParentOption[], limit?: number): string[]
/** 결정형 작업명 — insightLabel(trim) 있으면 그것, 없으면 첫 줄(마크다운 글머리·번호·'#' 제거), 공백 접기, 200자 상한 */
export function fallbackWbsName(text: string, insightLabel?: string | null): string
export interface MinuteWbsDraftRow { row: number; blockIndex: number; blockHash: string; excerpt: string; name: string; parentIds: string[]; plannedEnd: string | null; assigneeMemberId: string | null; registered: { itemId: string; code: string; name: string } | null }
export interface MinuteWbsDrafts { rows: MinuteWbsDraftRow[]; parents: MinuteWbsParentOption[]; members: { id: string; name: string }[]; mode: 'ai' | 'fallback' }
export interface MinuteWbsCreateRow { source: MinuteIssueSourceInput; name: string; parentId: string | null; plannedStart: string | null; plannedEnd: string | null; assigneeMemberId: string | null; confirmParentLeaf: boolean }
export interface MinuteLinkedWbsItem { linkId: string; itemId: string; code: string; name: string; projectId: string; minuteVersionId: string; bodyHash: string; blockIndex: number; blockHash: string; sourceKind: MinuteWbsSourceKind }
export interface WbsItemMinuteSource { linkId: string; minuteId: string; minuteVersionId: string; minuteVersionNo: number; minuteTitle: string; minuteDate: string; bodyHash: string; blockIndex: number; blockHash: string; excerpt: string; createdAt: string }
/** 현재 본문의 블록 hash 로 "등록됨"을 판정 — 버전이 달라도 같은 hash 면 그 블록 index 로 옮겨 붙인다. 안 맞는 연결은 뺀다 */
export function activeLinkedWbsItems(links: readonly MinuteLinkedWbsItem[], blocks: readonly MinuteBlock[]): MinuteLinkedWbsItem[]
```
pickableParents 규칙: 제외 — `isOwnerSplit`, 하위에 `isOwnerSplit` 이 하나라도 있는 행, `devWorkflow`, `activeOrderItemIds` 에 든 행, `!canAddChild(depth, maxDepth)`(`src/lib/domain/wbsAffordance.ts`). `leaf` = 하위 없음. 트리 순서(부모 → 자식, sort 는 입력 순서) 유지.

#### src/lib/ai/minute-wbs-draft.ts (순수) — Task 3
```ts
export const MINUTE_WBS_DRAFT_SYSTEM_PROMPT: string
export interface MinuteWbsDraftPromptInput { minuteDate: string; rows: { row: number; text: string; insightLabel: string | null; deadlineLabel: string | null }[]; candidates: { id: string; path: string; childNames: string[] }[]; members: { id: string; name: string }[]; exampleNames: string[] }
export function buildMinuteWbsDraftPrompt(input: MinuteWbsDraftPromptInput): string
export interface MinuteWbsAiRow { row: number; name: string; parentIds: string[]; plannedEnd: string | null; assigneeMemberId: string | null }
/** 관용 파싱(코드펜스·서두 제거 → 첫 '['~마지막 ']'). 모르는 row·후보 밖 parent·명단 밖 member·형식 밖 날짜는 버린다. 배열이 아니면 null */
export function parseMinuteWbsDraftResponse(raw: string, allow: { rowCount: number; candidateIds: ReadonlySet<string>; memberIds: ReadonlySet<string> }): MinuteWbsAiRow[] | null
```
프롬프트 요지(문안은 빌더): 출력은 JSON 배열만 `[{"row":0,"name":"…","parents":["id",…≤3],"end":"YYYY-MM-DD"|null,"assignee":"id"|null}]`; name 은 WBS 작업명 꼴(명사형, 40자 이내)·exampleNames 를 따라; parents 는 candidates 의 id 만, 확신 없으면 빈 배열; end 는 문단·deadlineLabel 의 날짜를 minuteDate 기준으로 해석(없으면 null); assignee 는 members 중 정확히 한 명과 맞을 때만.

#### src/app/actions/minuteWbs.ts ('use server') — Task 4
```ts
export type MinuteWbsDraftsResult = { ok: true; value: MinuteWbsDrafts } | { ok: false; error: string }
export async function prepareMinuteWbsDrafts(projectId: string, sources: MinuteIssueSourceInput[]): Promise<MinuteWbsDraftsResult>
export type MinuteWbsCreateResult = { ok: true; items: { row: number; itemId: string; code: string }[] } | { ok: false; error: string; row?: number }
export async function createWbsItemsFromMinute(projectId: string, rows: MinuteWbsCreateRow[]): Promise<MinuteWbsCreateResult>
export type WbsItemMinuteSourcesResult = { ok: true; rows: WbsItemMinuteSource[] } | { ok: false; error: string }
export async function getWbsItemMinuteSources(itemId: string): Promise<WbsItemMinuteSourcesResult>
```
순서(셋 다): 가드 → `requireModule({ projectId }, 'minutes')`(결과를 조건에) → 입력 검증 → DB. `createAdminClient()` 는 검증이 끝난 뒤에만.

#### src/lib/data/wbsLinks.ts ('server-only') — Task 5
```ts
export const getMinuteLinkedWbsItems: (minuteId: string) => Promise<{ ok: true; rows: MinuteLinkedWbsItem[] } | { ok: false; error: string }>   // react cache, 세션 클라이언트(RLS)
```

#### src/lib/minutes/blocks.ts — Task 5
`BlockMarks` 값에 `wbsCount?: number` 추가; `remarkAnnotateBlocks` 가 `data-wbs-count` 를 단다. `src/components/minutes/MarkdownView.tsx` `ANCHOR_KEYS` 에 `'data-wbs-count'`.

#### 화면 컴포넌트 — Task 6~9
```ts
// src/components/ui/Toast.tsx — ToastInput 확장
type ToastInput = { title: string; description?: string; variant?: ToastVariant; action?: { label: string; href: string } }
// src/components/minutes/WbsParentPicker.tsx
export function WbsParentPicker(props: { options: MinuteWbsParentOption[]; value: string | null /* null = 미선택, WBS_ROOT_PARENT = 맨 위 */; recommendedIds: string[]; onChange: (value: string) => void; disabled?: boolean })
// src/components/minutes/MinuteWbsRowFields.tsx
export interface MinuteWbsRowState { name: string; parentValue: string | null; plannedEnd: string; assigneeMemberId: string; confirmParentLeaf: boolean }
export function rowStateFromDraft(draft: MinuteWbsDraftRow, lastParentId: string | null): MinuteWbsRowState   // parentValue = parentIds[0] ?? lastParentId ?? null
export function MinuteWbsRowFields(props: { state: MinuteWbsRowState; draft: MinuteWbsDraftRow; parents: MinuteWbsParentOption[]; members: { id: string; name: string }[]; onChange: (next: MinuteWbsRowState) => void; disabled?: boolean })
// src/components/minutes/MinuteWbsRegisterModal.tsx
export function MinuteWbsRegisterModal(props: { open: boolean; mode: 'single' | 'bulk'; projectId: string; drafts: MinuteWbsDrafts; lastParentId: string | null; onClose: () => void; onSubmit: (rows: MinuteWbsCreateRow[]) => Promise<MinuteWbsCreateResult>; onCreated: (items: { row: number; itemId: string; code: string }[], parentId: string | null) => void })
// src/components/wbs/WbsMinuteSourceSection.tsx
export function WbsMinuteSourceSection(props: { itemId: string })
```
`MinuteViewer` 새 prop(전부 선택): `linkedWbsItems?: MinuteLinkedWbsItem[]`, `linkedWbsItemsError?: string | null`, `wbsAdminProjectIds?: string[]`.
`MinuteBlockPopover` 새 prop: `linkedWbsItems: MinuteLinkedWbsItem[]`, `wbsBusy?: boolean`, `canCreateWbs?: boolean`, `onCreateWbs?: () => void`.
`MinuteSelectionBubble` 새 prop: `canCreateWbs?: boolean`, `onCreateWbs?: (target: MinuteSelectionTarget) => void`.
`MinuteInsightCard` 새 prop: `linkedWbsItems?: MinuteLinkedWbsItem[]`, `canBulkWbs?: boolean`, `wbsBusy?: boolean`, `onBulkWbs?: () => void`.

#### 사전 키(각 작업이 더한다 — 문구는 그대로)
`src/lib/i18n/dict/minutes.ts`:
```
'min.wbs.create': 'WBS로 등록', 'min.wbs.createAnother': 'WBS로 하나 더 등록', 'min.wbs.linked': '연결된 작업', 'min.wbs.count': '작업 {n}',
'min.wbs.more': '외 {n}건', 'min.wbs.preparing': '작업 초안 준비 중…', 'min.wbs.prepareFailed': '작업 초안을 준비하지 못했습니다',
'min.wbs.linksUnavailable': '연결된 작업 목록을 읽지 못해 WBS 등록을 닫았습니다', 'min.wbs.noAdminProject': '관리자인 프로젝트가 없어 WBS로 등록할 수 없습니다',
'min.wbs.projectTitle': 'WBS 프로젝트 선택', 'min.wbs.title': 'WBS로 등록', 'min.wbs.bulkTitle': 'WBS로 한꺼번에 등록', 'min.wbs.bulkButton': 'WBS로 한꺼번에 등록',
'min.wbs.name': '작업명', 'min.wbs.parent': '넣을 위치', 'min.wbs.parentRecommended': '추천', 'min.wbs.parentSearch': '다른 위치 찾기…',
'min.wbs.parentPlaceholder': '위치를 골라 주세요', 'min.wbs.parentRoot': '맨 위(최상위)', 'min.wbs.parentNone': '고를 수 있는 위치가 없습니다',
'min.wbs.leafNotice': '이 작업은 하위 작업이 생겨 묶음 항목으로 바뀝니다.', 'min.wbs.leafActual': '실적 {n}%가 지워지고 하위 작업의 진척으로 계산됩니다.',
'min.wbs.leafAssignee': '담당자는 이 작업에만 남고 새 하위 작업에는 붙지 않습니다.', 'min.wbs.leafDeps': '선행 연결 {n}건은 이 작업에 그대로 남습니다.',
'min.wbs.leafConfirm': '확인했습니다', 'min.wbs.plannedEnd': '계획 종료일', 'min.wbs.assignee': '담당자', 'min.wbs.assigneeNone': '담당자 없음',
'min.wbs.excerpt': '원문', 'min.wbs.fallbackMode': 'AI 없이 원문에서 바로 뽑은 초안입니다. 작업명과 위치를 확인하세요.',
'min.wbs.changeParentAll': '위치 한꺼번에 바꾸기', 'min.wbs.selectedCount': '{n}건 선택', 'min.wbs.registered': '등록됨', 'min.wbs.viewInPlan': '작업 계획에서 보기',
'min.wbs.submit': '등록', 'min.wbs.submitN': '{n}건 등록', 'min.wbs.created': '작업을 등록했습니다', 'min.wbs.createdN': '작업 {n}건을 등록했습니다',
'min.wbs.rowFailed': '{n}번째 줄에서 멈췄습니다', 'min.wbs.nothingSelected': '등록할 줄을 골라 주세요', 'min.wbs.noAction': '액션 항목이 없습니다',
```
`src/lib/i18n/dict/wbs.ts`:
```
'wbs.minuteSource.title': '회의록 원문', 'wbs.minuteSource.open': '원문 위치 보기', 'wbs.minuteSource.version': '{n}판',
'wbs.minuteSource.empty': '연결된 회의록이 없습니다', 'wbs.minuteSource.error': '회의록 원문을 불러오지 못했습니다',
```
`src/lib/i18n/dict/serverUi.ts`(`srv.minuteWbs.*`): `rowsInvalid` '등록할 줄이 비었거나 30건을 넘습니다.' · `forbidden` '프로젝트 관리자만 WBS로 등록할 수 있습니다.' · `minuteNotFound` '회의록을 찾을 수 없습니다.' · `minuteArchived` '보관된 회의록에서는 등록할 수 없습니다.' · `minuteProjectMismatch` '회의록의 프로젝트와 다른 프로젝트에는 등록할 수 없습니다.' · `versionNotFound` '회의록 버전을 찾을 수 없습니다.' · `bodyStale` '회의록이 바뀌었습니다. 새로 고친 뒤 다시 시도하세요.' · `nameRequired` '작업명을 입력하세요.' · `nameTooLong` '작업명은 200자 이하여야 합니다.' · `parentNotFound` '넣을 위치를 찾을 수 없습니다. 새로 고친 뒤 다시 고르세요.' · `parentSubAct` '팀 분담 항목에는 하위 작업을 넣을 수 없습니다.' · `parentWorkflow` '업무 흐름이 켜졌거나 에이전트 주문이 진행 중인 작업에는 하위 작업을 넣을 수 없습니다.' · `parentDepth` '단계 깊이 상한에 닿아 하위 작업을 넣을 수 없습니다.' · `parentLeafUnconfirmed` '넣을 위치의 하위 작업이 그새 사라졌습니다. 영향을 확인한 뒤 다시 등록하세요.' · `dateRange` '계획 종료일이 시작일보다 앞섭니다.' · `assigneeInvalid` '담당자가 이 프로젝트의 활성 명단에 없습니다.' · `alreadyLinked` '이미 등록된 문단입니다.' · `sourceMixed` '한 번에 등록하는 줄은 같은 회의록·같은 버전이어야 합니다.' · `configUnavailable` '프로젝트 설정을 읽지 못해 등록할 수 없습니다.' · `treeUnavailable` '작업 계획을 읽지 못해 등록 창을 열 수 없습니다.' · `rosterUnavailable` '담당자 명단을 읽지 못해 등록 창을 열 수 없습니다.' · `linksUnavailable` '연결된 작업 목록을 읽지 못했습니다.' · `createFailed` 'WBS 등록에 실패했습니다.' · `sourcesUnavailable` '회의록 원문 연결을 읽지 못했습니다.' · `srv.api.importExecute.minuteLinks` '회의록 원문 연결(wbs_item_links)도 교체 시 함께 삭제되어 복구할 수 없습니다.'

---

### Task 1: 마이그레이션 0061 — 표·트리거·RPC·정책 + 롤백 + RLS 테스트

**Files:**
- Create: `supabase/migrations/0061_minute_wbs_links.sql`, `supabase/rollbacks/0061_minute_wbs_links_rollback.sql`, `tests/rls/minute-wbs-links.test.ts`
- Modify: `tests/rls/fixture-ws.sql`(A 프로젝트 연결 1행), `tests/rls/isolation-map.ts`(`A_ROW_FILTER`·`UPDATE_DENIED_BY_GRANT`)

**Interfaces:**
- Produces: 공유 계약의 표·RPC·오류 토큰.

- [ ] **Step 1: 실패하는 RLS 테스트 작성** — `tests/rls/minute-wbs-links.test.ts`(`weekly-columns.test.ts` 의 harness 꼴: `openPool`·`loadFixture`·`asService`·`asUser`·`pgError`·`F`). 공통 호출 `CALL = 'select public.create_wbs_items_from_minute($1,$2,$3,$4,$5,$6,$7::jsonb) r'`, 기본 인자 `[F.projects.a, F.users.member, F.rows.minute, F.rows.minuteVersion, 'rls-h', null, JSON.stringify(rows)]`, 기본 줄 `{ name: '로그인 API 개발', parent_id: null, planned_start: null, planned_end: '2026-10-31', assignee_member_id: null, block_index: 0, block_hash: 'blk-1', excerpt: '발췌', source_kind: 'action', source_key: null, confirm_parent_leaf: false }`.
  - `it('관리자 2줄 등록 — wbs_items 2행·wbs_item_links 2행·change_logs created 2행이 한 번에 생기고 반환이 줄 번호·id·code 를 준다')` — `expect(r).toHaveLength(2)`, `code` 가 이름 첫 토큰('로그인'), `sort_order` 가 기존 최대+1·+2.
  - `it('같은 문단의 action 재등록은 23505 MINUTE_BLOCK_ALREADY_LINKED 이고 한 줄도 남지 않는다')` — 1차 성공 뒤 같은 rows(2줄 중 하나만 중복)로 2차 호출: `toMatchObject({ code: '23505', message: 'MINUTE_BLOCK_ALREADY_LINKED', detail: '1' })`, wbs_items 수 불변.
  - `it('manual 은 같은 문단에 두 번 등록할 수 있다')`.
  - `it('멤버(dana)는 42501 WBS_ACTOR_FORBIDDEN')` — `F.users.dual`.
  - `it('body_hash 가 다르면 22023 MINUTE_BODY_STALE')`.
  - `it('하위 없는 부모(F.leaf.aDep1)에 confirm_parent_leaf 없이 넣으면 23514 WBS_PARENT_LEAF_UNCONFIRMED 이고 실적이 그대로다')` — 사전에 `update wbs_items set actual_pct = 40 where id = aDep1`.
  - `it('confirm_parent_leaf=true 면 부모 실적%가 null 이 되고 change_logs actual_pct 행(old 40, new null)이 남는다')`.
  - `it('부모가 dev_workflow 면 23514 WBS_PARENT_WORKFLOW')` — service 로 `update wbs_items set dev_workflow = true`.
  - `it('p_max_depth=1 이면 부모 밑에 넣을 때 23514 WBS_PARENT_DEPTH')` — 부모 `aDep1`(depth 0) + max 1.
  - `it('담당자가 B 명단이면 22023 WBS_ASSIGNEE_INVALID')` — `F.members.benB`.
  - `it('31줄은 22023 MINUTE_WBS_ROWS_INVALID')`.
  - `it('워크스페이스가 다른 회의록은 표 트리거가 23514 MINUTE_WORKSPACE_MISMATCH')` — `workspace-isolation-cases.test.ts:257-270` 꼴: service 로 `F.rows.nullMinute`(A, 프로젝트 없음) + `F.projects.bWs` 의 wbs_items(`F.leaf.bWs`) 로 직접 insert.
  - `it('읽기 정책 — B 멤버(ben)는 A 연결을 못 보고, A 멤버(dana)는 본다')` — `asUser` select count.
  - `it('실행권·DEFINER·search_path·authenticated 쓰기 불가')` — `has_function_privilege` 셋 + `pg_proc.prosecdef` + `has_table_privilege('authenticated','public.wbs_item_links','INSERT') = false`.
  - `it('롤백 적용 뒤 표·함수가 없고 다시 적용하면 돌아온다')` — `readdirSync('supabase/rollbacks').find(f => f.endsWith('_minute_wbs_links_rollback.sql'))` 로 찾아 `begin;`/`commit;` 을 벗겨 실행 → `to_regclass('public.wbs_item_links')` null → 마이그레이션 파일(접미로 찾음)을 다시 실행 → 존재.
- [ ] **Step 2: 실패 확인** — Run: `npm run test:rls -- tests/rls/minute-wbs-links.test.ts` — Expected: FAIL(`function public.create_wbs_items_from_minute … does not exist`).
- [ ] **Step 3: 마이그레이션 작성** — 공유 계약의 표·FK·인덱스·권한·정책·트리거·RPC·사후검사. RPC 본문 순서:
  1. 인자 검증(`p_rows` 배열·1~30·원소 객체·필수 키 형), 행위자 `actor_is_project_admin(p_actor, p_project_id)` 아니면 `WBS_ACTOR_FORBIDDEN`.
  2. `pg_advisory_xact_lock(hashtext('create_wbs_items_from_minute:' || p_project_id::text))` — 같은 프로젝트의 동시 등록을 직렬화(sort_order·중복 판정).
  3. 회의록·버전 검사 — 0030 RPC 187~225줄과 같은 판정(`for share`, 보관·프로젝트 불일치·버전·body_hash) → `v_version_no`·`v_title`·`v_date`·`v_version_project_id`.
  4. 줄 루프(인덱스 i): 이름 trim·빈값·200자 → 부모(있으면 같은 프로젝트에서 `for update`; `is_owner_split` 또는 하위에 `is_owner_split` → `WBS_PARENT_SUB_ACT`; `dev_workflow` 또는 활성 주문 → `WBS_PARENT_WORKFLOW`; 재귀 CTE 로 깊이(0-based) 를 구해 `p_max_depth is not null and depth + 1 >= p_max_depth` → `WBS_PARENT_DEPTH`; 하위 수 0 이고 `confirm_parent_leaf` 가 아니면 `WBS_PARENT_LEAF_UNCONFIRMED`) → 날짜 순서 → 담당자(활성 `project_members` + 활성 `people`, 같은 프로젝트) → `source_kind='action'` 이면 기존 연결 `exists(... project_id, minute_id, block_hash, source_kind='action')` → `MINUTE_BLOCK_ALREADY_LINKED`.
  5. 줄 루프 2(쓰기): 부모 하위 수 0 이고 `actual_pct is not null` → `update … set actual_pct = null, updated_at = now()` + `change_logs(p_actor, parent, 'actual_pct', old::text, null)`(같은 부모에 두 줄이 오면 첫 줄에서만). `sort_order = coalesce(max,0)+1`(같은 부모의 앞 줄 insert 가 보이므로 매번 max). `code` = `coalesce(nullif((regexp_split_to_array(v_name, '[.\s]'))[1], ''), v_name)`. `insert into wbs_items (project_id, parent_id, code, sort_order, name, planned_start, planned_end, assignee_member_id)` → `insert into wbs_item_links (…)` 0030 의 열과 같게(`source_project_id = v_version_project_id`) → `change_logs(p_actor, item, 'created', null, v_name)` → 결과 배열에 추가.
  6. `return v_result`.
- [ ] **Step 4: 롤백 작성** — `drop function public.create_wbs_items_from_minute(uuid, uuid, uuid, uuid, text, integer, jsonb); drop trigger …; drop function public.wbs_item_links_minute_scope(); drop table public.wbs_item_links;` (연결이 1행이라도 있으면 `WBS_LINKS_ROLLBACK_BLOCKED` 로 거부 — 0060 롤백 꼴).
- [ ] **Step 5: 픽스처·isolation-map** — `fixture-ws.sql` 132줄(issue_links) 아래에 `wbs_item_links` 1행(id `…112d`, wbs_item `F.leaf.aErp`, project `c1`, minute `…1103`, version `…1104`, version_no 1, 'RLS 회의록', '2026-09-01', 'rls-h', 0, 'rls-w', 'rls 발췌', source_kind 'manual'). `isolation-map.ts`: `A_ROW_FILTER` 에 `wbs_item_links: inAP`, `UPDATE_DENIED_BY_GRANT` 에 `'wbs_item_links'`.
- [ ] **Step 6: 리셋·테스트** — Run: `npm run db:reset` — Expected: 끝까지 초록(사후검사 통과). Run: `npm run test:rls` — Expected: 전부 PASS(`workspace-isolation`·`h2-table-grants`·`schema-invariants`·`project-delete`·새 파일 포함).
- [ ] **Step 7: 커밋(마이그레이션 단독)**
```bash
git add supabase/migrations/0061_minute_wbs_links.sql supabase/rollbacks/0061_minute_wbs_links_rollback.sql tests/rls/minute-wbs-links.test.ts tests/rls/fixture-ws.sql tests/rls/isolation-map.ts
git commit -m "0061 — 회의록 문단을 WBS 작업에 잇는 표와 한 트랜잭션 등록 RPC

issue_links 는 issue_id NOT NULL 이라 WBS 에 쓸 수 없다. 같은 꼴의 wbs_item_links 를 두고,
N 줄을 한 번에 넣는 DEFINER RPC 가 등급·회의록 버전·부모 규칙(SUB-ACT·흐름·깊이·말단 확인)을
다시 본다. action 줄의 중복은 부분 유일 인덱스가 막는다(두 번 눌러도 안전).

Staging-verified: local db reset <YYYY-MM-DD HH:MM>"
```

### Task 2: 원문 검증을 서버 라이브러리로 옮긴다

**Files:**
- Create: `src/lib/minutes/verifySource.ts`
- Modify: `src/app/actions/issues.ts`(102-115·200-300·303-440·930-940 을 옮기고 import), `src/lib/domain/issueMinuteSource.ts`(`MinuteIssueSourceInput` 추가)

**Interfaces:**
- Produces: 공유 계약의 `verifyMinuteIssueBlock`·`minuteIssueSourceExcerpt`·`MinuteIssueSourceInput`.

- [ ] **Step 1: 기존 테스트가 초록인지 확인** — Run: `npx vitest run tests/actions/issue-from-minute.test.ts tests/ui/minute-issue-draft-flow.test.tsx` — Expected: PASS(기준선).
- [ ] **Step 2: 옮기기** — `MinuteIssueSourceInput` 을 `issueMinuteSource.ts` 로(issues.ts 는 `export type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'`). 검증 묶음을 `verifySource.ts`('server-only' import 첫 줄)로 본문 그대로 옮기고 `export`. issues.ts 는 `import { verifyMinuteIssueBlock, minuteIssueSourceExcerpt } from '@/lib/minutes/verifySource'`. 옮기는 코드의 `serverTranslator`·`createServerClient`·`splitMinuteBlocks`·`matchMinuteSelection` import 도 따라간다.
- [ ] **Step 3: 확인** — Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run tests/actions tests/ui/minute-issue-draft-flow.test.tsx tests/invariants/use-server-exports.test.ts tests/invariants/domain-layering.test.ts` — Expected: PASS.
- [ ] **Step 4: 커밋** — `git add src/lib/minutes/verifySource.ts src/app/actions/issues.ts src/lib/domain/issueMinuteSource.ts` / 메시지: "회의록 원문 검증을 액션 밖으로 — WBS 등록이 같은 검증을 쓰되 서버 액션으로 노출되지 않게".

### Task 3: 순수 함수 — 위치 후보·점수·폴백·AI 프롬프트/파싱

**Files:**
- Create: `src/lib/domain/minuteWbs.ts`, `src/lib/ai/minute-wbs-draft.ts`, `tests/domain/minute-wbs.test.ts`, `tests/ai/minute-wbs-draft.test.ts`

**Interfaces:**
- Consumes: `canAddChild`(`src/lib/domain/wbsAffordance.ts`), `MinuteBlock`(`src/lib/minutes/blocks.ts`), `MinuteIssueSourceInput`(Task 2).
- Produces: 공유 계약의 도메인·AI 모듈 전부.

- [ ] **Step 1: 실패하는 도메인 테스트** — `tests/domain/minute-wbs.test.ts`:
  - `pickableParents` — 트리 `[A(묶음) > A1(말단, actual 40), B(SUB-ACT 부모) > B1(is_owner_split), C(dev_workflow 말단), D(말단, 활성 주문)]`, `maxDepth 3`: 결과 id 는 `['A','A1']`; `A.leaf=false`·`A1.leaf=true`·`A1.actualPct=40`; `A.path='1 A'`·`A1.path='1 A › 1.1 A1'`; `maxDepth 1` 이면 `[]`; `dependencyCounts` 가 `dependencyCount` 로.
  - `recommendableParents` — leaf=false 만.
  - `scoreParentCandidates('로그인 API 개발 일정', …)` — 경로에 '로그인' 이 든 후보가 하위 이름에만 든 후보보다 앞, 0점 제외, limit 2.
  - `fallbackWbsName` — label 우선; 없으면 `'- [ ] **로그인** API\n둘째 줄'` → `'로그인 API'`; 201자 → 200자.
  - `activeLinkedWbsItems` — 다른 버전 id 라도 hash 가 현재 블록에 있으면 그 index 로 옮겨 포함, 없는 hash 는 제외.
- [ ] **Step 2: 실패하는 AI 테스트** — `tests/ai/minute-wbs-draft.test.ts`: `parseMinuteWbsDraftResponse` — 코드펜스·서두 섞인 응답 파싱; `row` 범위 밖·후보 밖 parent·명단 밖 assignee·`'2026-13-01'` 버림(줄은 남김); 배열 아님 → null; `name` 200자 자름. `buildMinuteWbsDraftPrompt` — 결과에 후보 id·멤버 id·minuteDate·exampleNames 가 들어 있고 candidates 가 `MINUTE_WBS_PROMPT_CANDIDATES_MAX` 개를 넘지 않는다.
- [ ] **Step 3: 실패 확인** — Run: `npx vitest run tests/domain/minute-wbs.test.ts tests/ai/minute-wbs-draft.test.ts` — Expected: FAIL(모듈 없음).
- [ ] **Step 4: 구현** — 공유 계약의 시그니처대로. `scoreParentCandidates` 낱말 분리: `/[^\p{L}\p{N}]+/u`, 2글자 이상, 소문자.
- [ ] **Step 5: 통과 확인** — 같은 명령 — Expected: PASS. Run: `npx vitest run tests/invariants/domain-layering.test.ts` — PASS.
- [ ] **Step 6: 커밋** — "회의록→WBS 초안의 순수 규칙 — 위치 후보·결정형 점수·폴백 작업명·AI 응답 파싱".

### Task 4: 서버 액션 `minuteWbs.ts` — 준비·등록·상세 출처

**Files:**
- Create: `src/app/actions/minuteWbs.ts`, `tests/actions/minute-wbs.test.ts`
- Modify: `src/lib/i18n/dict/serverUi.ts`(`srv.minuteWbs.*`), `tests/gates/manifest.ts`, `tests/gates/_tables.ts`(`wbs_item_links: 'minutes'`), `tests/invariants/index-enqueue-wiring.test.ts`(`WIRED`), `tests/invariants/rpc-actor-source.test.ts`(`P_ACTOR_RPCS` 에 `'create_wbs_items_from_minute'`), `docs/sp2-admin-client-audit.md`(표 행 1)

**Interfaces:**
- Consumes: `verifyMinuteIssueBlock`·`minuteIssueSourceExcerpt`(Task 2), 도메인·AI(Task 3), `getComputedWbs`(`src/lib/data/wbs.ts`), `loadOutlineNumbers(sb, projectId)`(`src/lib/data/wbsOutline.ts`), `getProjectConfig`+`levelDepthOf`(`src/lib/settings/projectConfig.ts`), `getProjectRoster`(`src/lib/data/members.ts`), `aiAvailable`, `generateAnswer`(`src/lib/ai/llm.ts`), `makeMinuteIssueSourceKey`·`minuteSelectionKeyHash`, `applyWorkflowEvent`(`src/lib/agent/workflowEvent.ts`)·`emitNotification`(`src/lib/notify/emit.ts`)·`ensureOrderForWorkflowLeaf`(`src/lib/agent/ensureOrder.ts`), `enqueueIndexChange`, `recordProgressSnapshot`, `rpcFailure`·`tokenTable`·`failWith`(`src/lib/errors/dbFail.ts`).
- Produces: 공유 계약의 액션 셋.

- [ ] **Step 1: 실패하는 단위 테스트** — `tests/actions/minute-wbs.test.ts`(`tests/actions/issue-from-minute.test.ts` 의 hoisted mock 꼴: `@/lib/authz`·`@/lib/supabase/server`·`@/lib/supabase/admin`·`@/lib/ai/llm`·`next/cache`·`next/server`(`after`)·`@/lib/data/wbs`·`@/lib/data/wbsOutline`·`@/lib/settings/projectConfig`·`@/lib/data/members`·`@/lib/minutes/verifySource`·`@/lib/agent/workflowEvent`·`@/lib/notify/emit`·`@/lib/agent/ensureOrder`; 행위자 `makeAdminActor('project-1')`·`makeMemberActor('project-1')` from `tests/fixtures/actor`):
  - `prepareMinuteWbsDrafts`: 멤버 → `{ ok:false }` 이고 `createServerClient`·`generateAnswer` 호출 0; 모듈 꺼짐(`vi.mocked(requireModule).mockResolvedValue({ ok:false, error: ERR_MODULE_DISABLED })`) → 그 오류, DB 0; 소스의 minuteId 가 섞이면 `srv.minuteWbs.sourceMixed`; 트리 조회 reject → `treeUnavailable`; 설정 reject → `configUnavailable`; AI 응답 정상 → `mode:'ai'`, 줄의 `parentIds` 가 후보 안, `registered` 는 `wbs_item_links` 조회(block_hash 일치)로 채움; `generateAnswer` null → `mode:'fallback'`, 이름은 `fallbackWbsName`, parentIds 는 `scoreParentCandidates`; `aiAvailable` false → `generateAnswer` 호출 0.
  - `createWbsItemsFromMinute`: 멤버 → 거부·admin 클라이언트 0; 검증 실패 줄 → `{ ok:false, row }` 이고 RPC 0; 정상 → `admin.rpc('create_wbs_items_from_minute', { p_project_id, p_actor: 'user-1', p_minute_id, p_minute_version_id, p_body_hash, p_max_depth, p_rows })` 1회, `p_rows[i].excerpt` 가 4,000자 상한 적용, `source_key` 가 `makeMinuteIssueSourceKey` 값; RPC 오류 `{ message:'WBS_PARENT_LEAF_UNCONFIRMED', details:'1', code:'23514' }` → `{ ok:false, error: t('srv.minuteWbs.parentLeafUnconfirmed'), row: 1 }`; 성공 뒤 `enqueueIndexChange` 가 줄 수만큼의 배열로 1회, 담당자 있는 줄만 `applyWorkflowEvent`→`emitNotification`→`ensureOrderForWorkflowLeaf` 순으로 호출되고 그 중 하나가 reject 해도 `{ ok:true }`.
  - `getWbsItemMinuteSources`: `resolveProjectId` 실패 → 그 오류; 멤버 통과 → 세션 클라이언트 `wbs_item_links` 조회 결과를 `WbsItemMinuteSource` 로.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/actions/minute-wbs.test.ts` — Expected: FAIL.
- [ ] **Step 3: 구현** — `prepareMinuteWbsDrafts`: `const g = await requireProjectAdmin(projectId)` → `requireModule` → 소스 배열 검증(1~30, 같은 minuteId·minuteVersionId·bodyHash) → 각 소스 `verifyMinuteIssueBlock(projectId, g.actor.projectWorkspace.get(projectId), s, 'prepareMinuteWbsDrafts', true)`(제목 줄은 거부) → 병렬로 트리(`getComputedWbs` → `MinuteWbsTreeRow[]`; 평탄화는 `children` 재귀), 번호(`loadOutlineNumbers`), 설정(`levelDepthOf(await getProjectConfig(projectId))`), 활성 주문 id(세션 클라이언트로 `agent_work_orders` where project_id, status in 3종), 의존 수(세션 클라이언트로 `task_dependencies` predecessor/successor 집계), 명단(`getProjectRoster` 활성만), 기존 연결(`wbs_item_links` where minute_id·project_id → block_hash → 첫 {itemId, code, name}; 이름·코드는 `wbs_items` 임베드), 기한 라벨(`minute_insights` where minute_id·body_hash·kind='deadline') — **하나라도 실패하면 그 사유로 중단**. 후보 = `recommendableParents(pickableParents(...))`; 프롬프트 후보 = 줄마다 `scoreParentCandidates(text, 후보, 20)` 의 합집합을 앞에, 남은 자리는 트리 순서로 채워 80개. `aiAvailable({ projectId }, { module: 'minutes' })` 이면 `generateAnswer(MINUTE_WBS_DRAFT_SYSTEM_PROMPT, [{ role:'user', content: prompt }], { timeoutMs: 20_000, maxOutputTokens: 4_096, allowModelFallback: false, retries: 0, retryRateLimit: false })` → 파싱. 폴백 줄 = `fallbackWbsName` + `scoreParentCandidates(…, 3)` + 종료일·담당자 null. 예시 이름 = 말단 작업 이름 앞 20개.
  `createWbsItemsFromMinute`: 가드 → 관문 → 줄 검증(1~30, 같은 회의록·버전, `name` trim·200, 날짜 `/^\d{4}-\d{2}-\d{2}$/`·순서, uuid 꼴) → 각 줄 `verifyMinuteIssueBlock(… 'createWbsItemsFromMinute')` → 설정 깊이 → `createAdminClient().rpc(...)` → 오류는 `rpcFailure(error, tokenTable(OWN, t), t)`(OWN 은 공유 계약의 토큰 → `srv.minuteWbs.*` 키; 없으면 `failWith('minuteWbs.create', error, t('srv.minuteWbs.createFailed'))`), `row = /^\d+$/.test(error.details ?? '') ? Number(error.details) : undefined` → 성공 뒤 `enqueueIndexChange(items.map(...))` 1회, 담당자 줄마다 도우미 셋(try/catch, 로그만), `after(() => recordProgressSnapshot(projectId))`, `revalidatePath('/(app)/p/[projectId]', 'layout')`, `revalidatePath('/(app)/w/[slug]/minutes/[id]', 'page')`.
  `getWbsItemMinuteSources`: `resolveProjectId('wbs_items', itemId)` → `requireProjectMember` → `requireModule` → 세션 클라이언트 `wbs_item_links` select(`created_at` 오름차순).
- [ ] **Step 4: 등록부** — manifest: `[\`${A('minuteWbs')}#prepareMinuteWbsDrafts\`]: { guard: 'projectAdmin', module: 'minutes', sample: [P, []] }`, `createWbsItemsFromMinute` 같은 꼴 `sample: [P, []]`, `[\`${A('minuteWbs')}#getWbsItemMinuteSources\`]: { guard: 'projectMember', module: 'minutes', sample: [U] }`. `_tables.ts` 에 `wbs_item_links: 'minutes'`. `index-enqueue-wiring` `WIRED` 에 `'src/app/actions/minuteWbs.ts': { createWbsItemsFromMinute: 1 }`. `rpc-actor-source` `P_ACTOR_RPCS` 에 추가. 감사 표 행: `| src/app/actions/minuteWbs.ts | 세션 가드 뒤 id 스코프 | requireProjectAdmin(pid) 뒤 회의록 버전·블록을 세션 클라이언트로 검증한 다음에만 service_role RPC(등급 재판정)를 부른다 |`.
- [ ] **Step 5: 통과 확인** — Run: `npx vitest run tests/actions/minute-wbs.test.ts tests/gates tests/invariants` — Expected: PASS.
- [ ] **Step 6: 커밋** — "회의록→WBS 준비·등록 액션 — AI 한 번으로 줄 전부를 채우고 RPC 한 번으로 저장".

### Task 5: 데이터 로더·페이지 배선·문단 표시 데이터

**Files:**
- Create: `src/lib/data/wbsLinks.ts`, `tests/data/wbs-links.test.ts`
- Modify: `src/lib/minutes/blocks.ts`(`wbsCount`·`data-wbs-count`), `src/components/minutes/MarkdownView.tsx`(`ANCHOR_KEYS`), `src/app/(app)/w/[slug]/minutes/[id]/page.tsx`, `src/components/minutes/MinuteViewer.tsx`(prop 3·`activeLinkedWbs`·marks), `tests/minutes/blocks.test.ts`(있으면 — 없으면 `tests/minutes/remark-annotate.test.ts` 신규)

**Interfaces:**
- Consumes: `MinuteLinkedWbsItem`·`activeLinkedWbsItems`(Task 3), `adminProjectIds`(`src/lib/domain/authz.ts`).
- Produces: `getMinuteLinkedWbsItems`; `MinuteViewer` 의 `activeLinkedWbs: MinuteLinkedWbsItem[]`(현재 블록 index 로 옮긴 것)와 `wbsEnabled: boolean`(= `!historicalVersion && !minute.archivedAt && !linkedWbsItemsError && (고정 프로젝트 ? wbsAdminProjectIds 포함 : wbsAdminProjectIds.length > 0)` — 지난 버전·보관 회의록에서는 단추가 없다), `marks[i].wbsCount`.

- [ ] **Step 1: 실패하는 테스트** — `tests/data/wbs-links.test.ts`: 세션 클라이언트 mock 으로 `getMinuteLinkedWbsItems('m1')` 이 `from('wbs_item_links').select('id, wbs_item_id, project_id, minute_version_id, body_hash, block_index, block_hash, source_kind, wbs_items!wbs_item_links_item_project_fk(code, name)')…eq('minute_id','m1').eq('link_type','minute_block').order('created_at')` 를 부르고 행을 `MinuteLinkedWbsItem` 로 매핑; `error` 면 `{ ok:false, error }`(빈 배열로 위장하지 않음). remark 테스트: `remarkAnnotateBlocks({ 0: { wbsCount: 2 } })` 가 `data-wbs-count="2"` 를 단다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/data/wbs-links.test.ts tests/minutes` — Expected: FAIL.
- [ ] **Step 3: 구현** — 로더(`react cache`, `createServerClient`), blocks.ts·MarkdownView. 페이지: 첫 `Promise.all` 에 `getMinuteLinkedWbsItems(id)` 합류; `linkedWbsItems = mods.has('minutes') && r.ok ? r.rows : []`, `linkedWbsItemsError = r.ok ? null : r.error`(실패는 `console.error`); `wbsAdminProjectIds = m ? (m.isSuperuser ? projects.map(p => p.id) : adminProjectIds(m).filter(id => projects.some(p => p.id === id))) : []`; 셋을 `MinuteViewer` 에 넘긴다. 뷰어: `activeLinkedWbs = useMemo(() => activeLinkedWbsItems(linkedWbsItems, blocks))`, marks 에 `wbsCount`, `wbsEnabled` 계산(아직 소비처 없음 — Task 7 가 쓴다).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/data/wbs-links.test.ts tests/minutes tests/ui && npx tsc --noEmit -p tsconfig.json` — Expected: PASS.
- [ ] **Step 5: 커밋** — "회의록 화면이 연결된 WBS 작업을 읽어 문단에 표시 데이터를 단다 — 판정은 버전이 아니라 문단 내용".

### Task 6: 공용 조각 — 토스트 링크·위치 선택기·줄 편집 칸

**Files:**
- Create: `src/components/minutes/WbsParentPicker.tsx`, `src/components/minutes/MinuteWbsRowFields.tsx`, `tests/ui/wbs-parent-picker.test.tsx`, `tests/ui/minute-wbs-row-fields.test.tsx`
- Modify: `src/components/ui/Toast.tsx`, `src/lib/i18n/dict/minutes.ts`(`min.wbs.*` 전부), `tests/ui/toast.test.tsx`(있으면 — 없으면 신규)

**Interfaces:**
- Consumes: Task 3 타입·`WBS_ROOT_PARENT`.
- Produces: 공유 계약의 세 컴포넌트와 `rowStateFromDraft`.

- [ ] **Step 1: 실패하는 테스트**(jsdom + `createRoot`/`act`, `useLocale` 은 키 반환 mock):
  - picker: 추천 id 들이 `min.wbs.parentRecommended` 칩과 함께 맨 위 라디오로, 첫 추천이 선택; 검색 입력에 '인증' 을 치면 path 에 '인증' 든 옵션만; `WBS_ROOT_PARENT` 옵션이 있다; 옵션 0개면 `min.wbs.parentNone`.
  - row fields: `rowStateFromDraft(draft, null).parentValue === draft.parentIds[0]`, `parentIds` 비면 `lastParentId`; leaf 옵션을 고르면 `min.wbs.leafNotice` + actual 있으면 `min.wbs.leafActual` + assignee 있으면 `min.wbs.leafAssignee` + deps>0 이면 `min.wbs.leafDeps` 가 보이고 체크박스가 `confirmParentLeaf` 를 올린다; 묶음 옵션이면 안내가 없다.
  - toast: `action` 이 있으면 `<a href>` 가 그려지고 8,000ms 뒤 닫힌다(`vi.useFakeTimers`).
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/wbs-parent-picker.test.tsx tests/ui/minute-wbs-row-fields.test.tsx tests/ui/toast.test.tsx` — Expected: FAIL.
- [ ] **Step 3: 구현** — Toast: `ToastCard` 에 `item.action` 이면 `next/link` 로 링크(`pointer-events-auto`), 닫힘 지연 `action ? 8000 : AUTO_DISMISS_MS`. Picker: 라디오(추천 ≤3 + 마지막 선택) + 「다른 위치 찾기…」 토글 → 검색 입력 + `<select size>` 또는 목록(옵션 `path`, leaf 는 `·` 표시). RowFields: 작업명 `maxLength={WBS_NAME_MAX}`, picker, 날짜 `<input type="date">`, 담당자 `<select>`(`min.wbs.assigneeNone` 기본), leaf 안내 블록 + 체크박스. 사전 키 추가.
- [ ] **Step 4: 통과 확인** — 같은 명령 + `npx vitest run tests/invariants/i18n-no-korean-literals.test.ts tests/css` — Expected: PASS.
- [ ] **Step 5: 커밋** — "WBS 등록 창의 공용 조각 — 위치 선택기(추천 우선)·줄 편집 칸(말단 영향 확인)·링크 달린 토스트".

### Task 7: 한 건 등록 — 창·팝오버·선택 버블·뷰어 조율

**Files:**
- Create: `src/components/minutes/MinuteWbsRegisterModal.tsx`, `tests/ui/minute-wbs-flow.test.tsx`
- Modify: `src/components/minutes/MinuteViewer.tsx`, `src/components/minutes/MinuteBlockPopover.tsx`, `src/components/minutes/MinuteSelectionBubble.tsx`

**Interfaces:**
- Consumes: Task 4 액션, Task 5 `activeLinkedWbs`·`wbsEnabled`, Task 6 조각.
- Produces: 뷰어 함수 `beginWbsCreateFrom(origin: IssueOrigin)`, `beginWbsBulk()`(Task 8 가 채움 — 여기서는 선언만), 상태 `wbsModal: { mode: 'single' | 'bulk'; projectId: string; drafts: MinuteWbsDrafts } | null`, `lastWbsParentId`.

- [ ] **Step 1: 실패하는 흐름 테스트** — `tests/ui/minute-wbs-flow.test.tsx`(`minute-issue-draft-flow.test.tsx` 의 mock·stub 을 복사; `@/app/actions/minuteWbs` 를 mock; 팝오버 stub 에 `data-testid="wbs-create"` 단추): 고정 프로젝트 + `wbsAdminProjectIds=['p1']` 에서 문단 클릭 → 「WBS로 등록」 → `prepareMinuteWbsDrafts('p1', [source])` 1회(source 의 kind 는 블록 insight kind, 제목 줄은 단추 비활성) → 모달 열림·`mode:'single'` → 등록 → `createWbsItemsFromMinute('p1', [{ name, parentId, …, confirmParentLeaf:false }])` → `toast` 가 `action.href === '/p/p1/wbs?focus=<itemId>'`; `wbsAdminProjectIds=[]` 면 단추가 없다; `linkedWbsItemsError` 면 단추가 없고 머리에 `min.wbs.linksUnavailable`; 프로젝트 없는 회의록은 `min.wbs.projectTitle` 선택 창이 먼저 뜨고 옵션이 `wbsAdminProjectIds` 뿐; 준비 실패 → `min.wbs.prepareFailed` 토스트, 모달 안 열림; 낡은 요청(requestId) 은 모달을 열지 않는다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/minute-wbs-flow.test.tsx` — Expected: FAIL.
- [ ] **Step 3: 구현** — Modal(`Modal size="md"`, 제목 `min.wbs.title`, dirty 확인): 줄 1개 `MinuteWbsRowFields` + 원문 발췌(읽기 전용) + `mode:'fallback'` 이면 `min.wbs.fallbackMode` notice; 등록 단추는 이름·위치가 있고(leaf 면 확인까지) 있을 때만; `onSubmit` 실패 `row` 가 있으면 그 줄을 빨갛게 + 오류 문구, 입력 유지. 팝오버: 「이슈로 등록」 아래 「WBS로 등록」(`canCreateWbs`, 연결 있으면 `createAnother`), 「연결된 작업」 목록(≤2 + `min.wbs.more`, href `/p/${projectId}/wbs?focus=${itemId}`). 버블: 두 번째 단추(폭 180 → 2단추일 때 300). 뷰어: `beginIssueCreateFrom` 과 같은 뼈대의 `beginWbsCreateFrom`(requestId 취소·고정 프로젝트·선택 창 재사용 — 기존 선택 창에 `pickerFor: 'issue' | 'wbs'` 상태를 더해 옵션을 거른다), `onCreated` 에서 토스트(`min.wbs.created`, action `min.wbs.viewInPlan`) + `lastWbsParentId` 갱신 + `router.refresh()`.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ui && npx tsc --noEmit -p tsconfig.json && npm run lint` — Expected: PASS.
- [ ] **Step 5: 커밋** — "회의록 문단 하나를 WBS 작업으로 — 이슈 등록과 같은 자리에서 작업명·위치가 채워진 창 하나".

### Task 8: 한꺼번에 등록 — AI 요약 카드에서

**Files:**
- Modify: `src/components/minutes/MinuteWbsRegisterModal.tsx`(bulk 모양), `src/components/minutes/MinuteInsightCard.tsx`, `src/components/minutes/MinuteViewer.tsx`(`beginWbsBulk`), `tests/ui/minute-wbs-flow.test.tsx`(bulk 케이스), `tests/ui/minute-wbs-register-modal.test.tsx`(신규)

**Interfaces:**
- Consumes: Task 7.

- [ ] **Step 1: 실패하는 테스트** — 모달(bulk) 단독: 줄 4개(2 추천 있음·1 추천 없음·1 `registered`) → 체크는 추천 있는 2개만, 등록된 줄은 회색·체크 불가·`min.wbs.viewInPlan` 링크, 머리 `min.wbs.selectedCount` '2'; 「위치 한꺼번에 바꾸기」로 고른 값이 체크된 줄 전부에 들어간다; 체크 0 이면 단추 비활성(`min.wbs.nothingSelected`); `onSubmit` 이 `{ ok:false, row:1 }` 이면 1번 줄 강조·값 유지; 성공 → `onCreated(items, 공통 parentId|null)`. 뷰어: 요약 카드 stub 의 `data-testid="wbs-bulk"` → `prepareMinuteWbsDrafts(pid, 액션 블록 전부(kind:'action'))` → `mode:'bulk'`; 액션 0개면 단추 없음; 성공 토스트 `min.wbs.createdN`.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/minute-wbs-register-modal.test.tsx tests/ui/minute-wbs-flow.test.tsx` — Expected: FAIL.
- [ ] **Step 3: 구현** — 모달 bulk: `Modal size="lg"`, 머리 줄(위치 한꺼번에 바꾸기 = `WbsParentPicker` 를 팝오버/인라인로 + 선택 수), 줄 표(체크·`MinuteWbsRowFields` compact·원문은 펼침), 등록된 줄은 `opacity`+링크. 카드: 머리에 `min.wbs.bulkButton`(`canBulkWbs && 액션 ≥1`), 이슈 칩 옆 `min.wbs.count` 칩, 펼치면 「연결된 작업」 목록(원문 위치 이동 + 링크). 뷰어: `beginWbsBulk` — 소스 = `annotations.insights.filter(kind==='action')` 중 현재 블록 hash 가 맞는 것(`blocks[i].hash === insight.blockHash`), `kind:'action'`; `canBulkWbs = wbsEnabled && 고정 프로젝트 있음`(프로젝트 없는 회의록은 선택 창 뒤 bulk).
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ui tests/invariants/i18n-no-korean-literals.test.ts && npx tsc --noEmit -p tsconfig.json` — Expected: PASS.
- [ ] **Step 5: 커밋** — "AI 요약의 액션 항목을 한 번에 WBS 작업으로 — 전부 또는 전무, 등록된 줄은 다시 올리지 않는다".

### Task 9: WBS 상세 패널 「회의록 원문」 + 가져오기 경고

**Files:**
- Create: `src/components/wbs/WbsMinuteSourceSection.tsx`, `tests/ui/wbs-minute-source-section.test.tsx`
- Modify: `src/components/wbs/RowDetailPanel.tsx`(821 첨부 뒤·824 이력 앞), `src/lib/i18n/dict/wbs.ts`, `src/app/api/import/execute/route.ts`(`REPLACE_WARNINGS`), `src/lib/i18n/dict/serverUi.ts`(`srv.api.importExecute.minuteLinks`), `tests/api/import-execute*.test.ts`(경고 수 고정 테스트가 있으면 갱신)

**Interfaces:**
- Consumes: `getWbsItemMinuteSources`(Task 4), `minuteSourceHref`(`src/lib/minutes/source.ts`), `useMinuteLinks().list`.

- [ ] **Step 1: 실패하는 테스트** — 섹션: 열리면 `getWbsItemMinuteSources(itemId)` 1회; `{ ok:true, rows:[…] }` → 제목·날짜·`wbs.minuteSource.version` 칩·발췌(`line-clamp-3`)·`wbs.minuteSource.open` 링크 href 가 `minuteSourceHref(minuteId, {blockIndex, blockHash, bodyHash}, minuteVersionId, base)`; `rows:[]` → 섹션 자체를 그리지 않음(빈 안내 없이); `{ ok:false }` → `wbs.minuteSource.error`. 가져오기: replace 응답 warnings 에 새 문구가 든다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui/wbs-minute-source-section.test.tsx tests/api` — Expected: FAIL.
- [ ] **Step 3: 구현** — `AttachmentSection`(RowDetailPanel 866) 꼴의 지역 상태 + `useEffect` 로드; 모양은 `IssueModals.tsx` 426-448 의 원문 카드. `REPLACE_WARNINGS` 에 키 추가.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run tests/ui tests/api tests/invariants && npx tsc --noEmit -p tsconfig.json` — Expected: PASS.
- [ ] **Step 5: 커밋** — "WBS 작업 상세에서 회의록 원문으로 돌아간다 — 바꿔치기 가져오기가 연결을 지운다는 경고도 함께".

### Task 10: 문단 배지 CSS·매뉴얼·전체 검증·눈확인

**Files:**
- Modify: `src/app/globals.css`(343-356 이슈 배지 아래), `src/content/manual/07-meetings-minutes.md`(「이슈로 등록하기」 뒤), `src/content/manual/04-wbs.md`(「작업 상세 패널 열기」 안), `src/content/manual/chapters.generated.json`(빌드 산출)

- [ ] **Step 1: CSS** — `.minutes-md [data-wbs-count]` 는 이슈 배지와 같은 꼴(왼쪽 선 `--color-success`, `::before content: '▤ ' attr(data-wbs-count)`, `bg-success text-success-fg`); 둘 다 있을 때 겹치지 않게 `[data-issue-count][data-wbs-count]::before` 의 `right` 를 띄운다(`3rem`, hl 까지 있으면 `5.5rem`); 목록 특례 `:is(ul, ol):is([data-ins], [data-issue-count], [data-wbs-count])`. Run: `npx vitest run tests/css` — PASS.
- [ ] **Step 2: 매뉴얼** — `07-meetings-minutes.md` 에 `### WBS로 등록하기`(누가: 프로젝트 관리자, 회의록 기능 켜짐; 문단 하나 → 창의 칸 셋 설명; 넣을 위치의 추천·다른 위치 찾기·하위 없는 작업을 고를 때 안내; 등록 뒤 표시) + `### 한꺼번에 등록하기`(AI 요약 카드 단추, 체크·위치 한꺼번에 바꾸기, 전부 또는 전무, 등록된 줄). `04-wbs.md` 「작업 상세 패널 열기」 목록에 **회의록 원문** 항목. 금칙어(RPC·RLS·API·모듈·DB…) 없이. Run: `npm run manual:build && npx vitest run tests/manual` — PASS.
- [ ] **Step 3: 전체 검증** — Run: `npm run lint && npm run test && npm run build` — Expected: 전부 초록. Run: `npm run test:rls` — PASS.
- [ ] **Step 4: 눈확인(로컬)** — `npm run dev:bootstrap`(리셋했으면) → `npm run dev` → 회의록 하나에 액션 문단 3개 이상 넣고: ① 문단 팝오버 「WBS로 등록」 → 창의 추천 위치·작업명 → 등록 → 토스트 링크로 WBS 이동·강조 ② 요약 카드 「WBS로 한꺼번에 등록」 → 체크 기본값·위치 한꺼번에 바꾸기 → 등록 ③ 회의록으로 돌아와 문단 배지(이슈 배지와 겹침 없음)·팝오버 「연결된 작업」 ④ WBS 상세 패널 「회의록 원문」 → 「원문 위치 보기」 ⑤ 회의록 오타 수정 뒤 한꺼번에 창에서 등록된 줄이 회색 ⑥ 좁은 폭(390px)에서 bulk 창. 확인 시각을 적는다.
- [ ] **Step 5: 커밋(트레일러)**
```bash
git add src/app/globals.css src/content/manual/07-meetings-minutes.md src/content/manual/04-wbs.md src/content/manual/chapters.generated.json
git commit -m "회의록 문단의 WBS 배지와 매뉴얼 — 등록 여부가 본문에서 보이게

Preview-checked: local <YYYY-MM-DD HH:MM> — 회의록 상세(문단 배지·팝오버·한꺼번에 창), WBS 상세 패널(회의록 원문)"
```
- [ ] **Step 6: 사람에게 넘긴다** — 운영 DB 적용(`db:apply` 0061 + `schema_migrations` 행) → `git push -u origin HEAD` → GitHub Actions 초록 확인 → `main` ff 머지·push → `SMOKE_URL=https://d-flow-eight.vercel.app npm run smoke:prod`. 이 단계는 실행하지 않고 보고만 한다.
