# 포스트-SP2 하드닝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 범용성 검토 트리아지에서 "지금 적용"으로 살아남은 13과제와, 스켑틱이 찾았지만 분류되지 않았던 후보 4건(1·2·5·7)을 고친다. 원본 고객 흔적이 런타임에 남은 곳(5팀 폴백·팀 정규식·Gmail 고정·공휴일 기본값·스킬 산문)을 걷어내고, 조회 실패를 '없음'으로 위장하던 화면·라우트를 정직하게 만들며, 입력·승인·초안이 조용히 사라지거나 엇갈리는 결함을 막는다. 제7·8부 원장이 더한 4과제(15 자기 완료 승인 차단, 16 산출물 첨부 다운로드 판정, 17 회의록 상세 정직화, 18 회의록 서명 URL·첨부 삭제 정직)와 SP2 최종 리뷰의 잔여 minor 5건(과제 19)도 여기서 한다. 설정 엔진(SP3a) 없이 할 수 있는 것만 한다.

**Architecture:** 설계 변경이 아니라 기존 계약 안의 수선이다. 판정은 여전히 `src/lib/domain/authz.ts`(순수) + `src/lib/authz/**` 두 곳에서만 한다. 데이터 로더의 실패는 `members.ts:17-38` 의 `{ ok: true, rows } | { ok: false, error }` 관례로 통일하고, 순수 함수(라우터 팀 추출·SMTP 설정 해석·초안 키·프로파일 AOA)는 I/O 없이 값을 주입받는다. DB 변경은 `0010_issue_code_seq_width` 하나(함수 한 줄 + CHECK 식). 권한 하드닝 H2 의 `0011_authz_hardening` 은 이 계획 밖이다(개정 스펙 §6.2.0 — 별도 계획으로 H1 뒤에 한다). 비-UI 과제는 `main` 에 바로 커밋하고, UI 위험 파일은 과제 8(`ui/teams-no-default`)과 과제 12(`ui/shell-hardening`) 두 브랜치에만 모은다. 정본 스펙의 "선반영" 기록은 진행 중인 스펙 개정과 충돌하지 않게 과제 14(1~13·15~18 뒤)에서 한 번에 한다. 과제 19 는 스펙과 무관한 부록이다.

**Tech Stack:** Next.js 15 App Router, Supabase(Postgres 17, RLS, plpgsql), vitest(+ `vitest.config.rls.ts` 의 pg 직결 하네스), TypeScript, Tailwind v4, nodemailer, xlsx(SheetJS), 로컬 Supabase CLI 2.75 + colima.

**Spec:** `.superpowers/review-triage/triage-synthesis.md` §1(과제 1~13, 스켑틱 보정 반영 — 이 계획의 정본)과 §6(미분류 후보). 항목별 근거·스켑틱 원문은 `.superpowers/review-triage/triage-parts.json` 에 id 로 있다(종합 문서의 `P2-*` 는 JSON 에서 `D5-*`). 원 검토 문서: `docs/2026-09-26-configurability-review-and-implementation.md`. 정본 설계(개정 진행 중): `docs/superpowers/specs/2026-09-23-generic-platform-design.md`. 과제 15~18 의 정본은 제7·8부 원장 `.superpowers/review-triage/parts-7-8-synthesis.md` §2 이고, 개정 스펙 `docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` §6.2.0 이 이 넷을 H1 에 더하고 H2 를 그 뒤에 둔다. 과제 19 는 SP2 최종 리뷰가 남긴 minor 다.

**사용자 결정(2026-09-26, 구속 — 구현자가 바꾸지 않는다):**
- 공휴일은 어디에도 기본으로 넣지 않는다(DC-07 과 같은 방향). CLI 와 웹 양식 모두 빈 목록에 헤더만 둔다.
- 팔레트 전환(중립·코발트)과 다크 토글 재노출은 이후 디자인 시스템 SP 몫이다. 과제 12 는 **기존 토큰의 대비만** 고친다(`#6f645d`). 재테마하지 않는다.
- 화이트라벨 기본값(D6-§13-whitelabel)은 권고안을 채택했다. `BRAND.portalIcon` 은 명시값이 없으면 제품명이 기본값 `D-Flow` 일 때 `'flow'`, 아니면 `'monogram'` 이다. `.env.local.example` 의 `NEXT_PUBLIC_BRAND_PORTAL_ICON` 은 빈 값으로 둔다.

## Global Constraints

- **착수 조건:** SP2 가 `main` 에 들어간 뒤(컨트롤러가 `sp2-done` 태그를 찍은 뒤)에 시작한다. 각 과제의 Step 0 에서 `git merge-base --is-ancestor sp2-done HEAD && echo ok` 가 `ok` 인지 본다. 아니면 멈추고 보고한다.
- `git add -A`·`git add .`·`git add -p` 금지. 파일명을 명시해 stage 하고, 커밋 전에 `git diff --cached --stat` 으로 내 파일만 들어갔는지 본다.
- 작업 트리에 사용자가 다른 도구로 고친 미커밋 파일이 있을 수 있다(착수 시점 예: `docs/2026-09-26-configurability-review-and-implementation.md`). **절대 stage 하지 않는다.** 내가 고칠 파일이 착수 시점에 이미 dirty 면(`git status --porcelain <파일>` 이 비어 있지 않으면) 손대지 말고 멈춰 보고한다. 특히 `.env.local.example`(과제 5·7)과 `src/lib/branding.ts`(과제 7)를 확인한다.
- 구현자는 `git push`·`git fetch`·`git stash`·`git reset`·`git tag`·`SKIP_GUARD` 를 쓰지 않는다. `main` 반영·push·태그는 컨트롤러가 사람 확인 뒤에 한다. 셸에서 `cd X && a; b` 패턴을 쓰지 않는다(명령은 `&&` 로만 잇는다).
- **마이그레이션은 과제 2 의 `0010_issue_code_seq_width` 하나뿐이다.** 착수 때 `ls supabase/migrations` 로 `0009_sp2_isolation_fixes.sql`(SP2 최종 fix wave) 이 마지막인지 확인한다. 이미 `0010_*` 가 있으면 멈춘다. (H2 가 `0011`, SP3a 는 `0012` 부터 — 이 계획은 `0011` 을 쓰지 않는다.) 마이그레이션 커밋에는 `supabase/migrations/*`·`supabase/rollbacks/*` 만 담는다(G1).
- **트레일러는 파싱돼야 한다.** 커밋 본문의 마지막 문단(트레일러 블록)에 `Staging-verified: local db reset <YYYY-MM-DD HH:MM>`(G4) 또는 `Preview-checked: local <YYYY-MM-DD HH:MM> — <확인 화면>`(G2)을 두고, 그 **바로 아래 줄**(빈 줄 없이)에 `Co-Authored-By:` 를 둔다. `<일시>` 는 `date '+%Y-%m-%d %H:%M'` 출력으로 채운다. 커밋 뒤 `git log -1 --format='%(trailers:key=Staging-verified,valueonly)'`(또는 `key=Preview-checked`)이 비어 있지 않은지 확인한다. 비어 있으면 `git commit --amend` 로 트레일러 블록을 고친다.
  ```bash
  git commit -F - <<'EOF'
  <제목>

  <본문 — 왜>

  Staging-verified: local db reset 2026-09-27 14:05
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  EOF
  ```
- UI 위험 파일(`src/app/globals.css`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/app/*`)은 과제 8·12 에서만 건드리고, 각자 `ui/<주제>` 브랜치에서 한다. 원격 Preview 가 아직 없으므로(CLAUDE.md ⚠️) 로컬 `npm run dev -- -p 3101` 로 눈확인하고 `Preview-checked: local …` 트레일러를 붙인다.
- **포트 3000 은 사용자 것이다.** dev 서버는 `npm run dev -- -p 3101` 로 띄우고 끝나면 내린다(`lsof -iTCP:3101 -sTCP:LISTEN` 의 pid 를 kill).
- 디스크가 빠듯하다. 추가 워크트리는 **최대 1개**, `node_modules` 는 심볼릭 링크로 둔다(`ln -s /Users/jerry/D-Flow/node_modules <wt>/node_modules`). 워크트리를 썼으면 끝나고 `git worktree remove <wt>` 한다.
- 로컬 Supabase 스택은 하나다. `db:reset`·`test:rls` 는 과제 간 동시에 돌리지 않는다(컨트롤러가 순서를 준다). `db:reset` 뒤에는 `npm run dev:bootstrap` 을 다시 돌린다(env `BOOTSTRAP_EMAIL`·`BOOTSTRAP_PASSWORD`).
- **에러 처리 3원칙:** 조회 실패를 "데이터 없음"으로 위장하지 않는다(표시 = 로깅). 쓰기 전 선행 조회가 실패하면 중단한다. 보안 가드는 fail-closed(모르면 거부)다. 실패를 `[]` 로 바꿔 주는 래퍼를 새로 만들지 않는다(`members.ts:17` 결정).
- 새 코드·픽스처·문구에 고객명·실명·구 브랜드를 쓰지 않는다. 예시는 `Acme`·`alice`·`example.com`·`팀A` 류를 쓴다. 제조·SI 어휘(ERP/MES/L2/공정)를 **새 예시로** 쓰지 않는다. 기존 테스트 픽스처 값은 과제 8 이 `tests/fixtures/teams.ts` 로 모으기 전까지 그대로 둔다.
- `atomic` 으로 끝나는 식별자를 쓰지 않는다(CLI 2.75 문장 분할기 42601).
- 커밋 메시지는 한국어로 쓰고 "무엇"보다 "왜"를 적는다. 모든 커밋은 `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` 로 끝난다.
- 각 과제의 마지막 검증: `npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3`. vitest 는 타입을 보지 않으므로 typecheck 는 필수다. DB 를 건드린 과제는 `npm run db:reset && npm run test:rls 2>&1 | tail -4` 를 더한다. 실패를 단언 완화로 덮지 않는다.

## Review Focus

1. **엑셀 내보내기에 조용한 폴백이 0건인가.** 저장 프로파일이 있으면 접기·펼침 모두 그 프로파일로 만든다. 손상이면 422 이고 LEGACY 폴백은 없다. 저장 프로파일이 없으면 접기는 지금의 `buildWbsWorkbook`(프로젝트 팀·N단, 바이트 불변), 펼침은 409 다. LEGACY(headerRow 2) 출력은 바이트가 같아야 하고, headerRow 0·1·3 은 `parseWithProfile` 로 되읽혀야 한다. → 과제 1.
2. **0010 가 함수의 나머지를 바꾸지 않는가.** 본문은 `0000_baseline.sql:1036-1109` 그대로이고 `SET search_path TO ''` 가 유지돼야 한다. 롤백 후 카탈로그 diff 가 0 이어야 하고, 100 이상 행이 있으면 정방향·롤백 모두 멈춰야 한다. → 과제 2.
3. **TLS 가 조용히 내려가지 않는가.** 인증 + `secure=false` 면 `requireTLS: true` 다. `SMTP_SECURE`·`SMTP_PORT`·`SMTP_AUTH` 오타는 거부한다. 반환 문구에 `SMTP_` 키 이름이 없어야 한다. → 과제 5.
4. **라우터의 팀 추출이 권한 밖을 보지 않는가.** 허용 밖 pid 는 팀 캐시를 읽지 않고 `[]` 다. 캐시가 cold 면 503 이다. `'ERP MES'` 는 모호해서 추출 0 이고, 결과는 저장된 정규 코드다. → 과제 4.
5. **초안 키와 복구 순서를 같이 고쳤는가.** 키만 사용자별로 바꾸고 복구가 여전히 지우면 충돌 안내가 거짓으로 남는다. 복구만 고치면 공용 PC 에서 남의 초안이 뜬다. → 과제 10(+ 로그아웃 정리는 과제 12).
6. **승인이 사람이 본 보고에만 걸리는가.** `expectedReportId` 는 필수 인자다. 최신 보고 조회가 실패하면 중단하고, 불일치면 RPC 를 부르지 않고 `stale` 을 돌려준다. → 과제 11.
7. **5팀 기본값을 지운 뒤 provider 없는 렌더.** `createContext([])` 로 바꾸면 provider 없이 그리던 화면·테스트가 빈 팀으로 조용히 통과할 수 있다. 테스트는 `withTeams` 로 감싸고, `npm run typecheck` 를 반드시 돌린다. → 과제 8.
8. **대시보드가 WBS 없이도 팀 캐시를 건드리지 않는가.** `!hasWbs` 면 팀 캐시(`teamsForProjectSync`)를 읽지 않는다(`page.tsx:42` degraded 불변식). → 과제 9.
9. **자기 완료를 자기가 승인하는 경로가 0인가.** 비관리자는 리프 담당자 본인이거나 그 주문을 claim 한 계정이면 승인이 `ERR_SELF_APPROVAL` 이고 RPC 를 부르지 않는다. 반려·재작업은 그대로 열린다. 승인 버튼·결재 대기 배지·좌석 op 가 서버와 같은 `canApproveCompletion` 을 쓴다. → 과제 15.
10. **산출물 다운로드 판정이 Storage 정책과 같은가.** `can_attach` RPC 1회, 오류면 `unknown` 으로 막는다. `denied`·`unknown` 이면 서명을 호출하지 않고 `<a href="#">` 이 0건이다. 목록 조회 실패는 오류로 보인다. → 과제 16.
11. **회의록 상세가 서버와 같은 판정·정직한 실패를 보이는가.** 파일 목록 실패는 경고(빈 목록 아님), `canManage` = `canEditMinute`(행의 `project_id` — 회의 폴백 아님), 서명 URL TTL 60초, Storage 삭제가 1건이 아니면 행을 남긴다. → 과제 17·18.

## File Structure

| 파일 | 책임 | 과제 |
|---|---|---|
| `src/app/api/export/route.ts`, `src/lib/excel/exportWithProfile.ts`, `src/lib/excel/parseWithProfile.ts`(`toIso`), `src/components/import/downloadWbsExport.ts`(신설), `src/components/settings/ExportExcelButton.tsx`(신설), `src/components/import/ImportWizard.tsx`, `src/app/(app)/p/[projectId]/settings/page.tsx`(내보내기 버튼), `src/lib/excel/template.ts`(가이드 4번) | 엑셀 내보내기 단일 경로·headerRow·깊이 가드·텍스트 날짜 | 1 |
| `supabase/migrations/0010_issue_code_seq_width.sql`, `supabase/rollbacks/0010_issue_code_seq_width_rollback.sql`, `tests/rls/issue-code-width.test.ts` | 이슈 코드 일련번호 폭 | 2 |
| `src/lib/repositories/types.ts`, `src/lib/repositories/supabase/settings.ts`, `src/lib/ai/tools/dashboard.ts`, `src/lib/ai/chat/default-registry.ts`, `tests/fixtures/milestoneKeywords.ts`(신설), `src/lib/ai/provider.ts`, `src/lib/ai/embeddings.ts` | 봇 마일스톤 키워드·임베딩 차원 상수 | 3 |
| `src/lib/mail/transport.ts`, `.env.local.example`(메일 블록), `README.md:45` | SMTP 중립화 | 5 |
| `src/lib/data/{issues,snapshots,announcements,meetings}.ts`, `src/components/ui/LoadErrorNotice.tsx`(신설), `src/components/dashboard/{DashboardView,AnnouncementStrip(신설),ExecSummary,TrendChart,SpiPanel}.tsx`, `src/app/(app)/p/[projectId]/{dashboard,meetings,announcements}/page.tsx`, `src/app/api/report/route.ts`, `src/app/actions/{minutes,announcements}.ts`, `src/components/minutes/{MinuteMetaModal,MinuteUploadModal}.tsx`, `src/app/api/shell/route.ts`, `src/lib/ai/projectFacts.ts` | 대시보드 정직화·보고서 라우트·헤더 티커 로더 | 9 |
| `src/components/wbs/WbsGanttSheet.tsx`, `src/lib/drafts/wikiDrafts.ts`(신설), `src/components/wiki/{WikiDocumentEditor,WikiTopicDetail}.tsx`, `src/app/(app)/p/[projectId]/wiki/topics/[topicId]/page.tsx` | 편집 입력 보존 | 10 |
| `src/app/actions/{agentWork,agentHub}.ts`, `src/lib/data/{agentHub,agentSeatmap}.ts`, `src/lib/domain/{agentHub,seatmap}.ts`, `src/components/agent-hub/{ApprovalQueue,DelegationTable}.tsx`, `src/components/agents/SeatmapView.tsx`, `src/components/wbs/WbsSpecPanel.tsx` | 승인 경합(보고 id CAS) | 11 |
| `.claude/skills/dflow-wbs-nlevel/**`, `kit/README.md`, `tests/invariants/skill-domain-neutral.test.ts`(신설) | 배포 스킬 중립화 | 13 |
| `src/lib/ai/chat/{router,orchestrator}.ts`, `src/app/api/chat/v2/stream/route.ts`, `src/lib/ai/tools/weekly.ts` | 챗 라우터 팀 인식 | 4 |
| `src/lib/domain/weeklySheet.ts`, `src/lib/excel/parse.ts` → `tests/fixtures/excel/legacyParse.ts`, `src/lib/excel/validate.ts`, `src/lib/report/brand.ts`(삭제), `scripts/wbs/build-xlsx.mjs`, `src/lib/excel/template.ts`(휴일) | 도메인·스크립트 잔재 | 6 |
| `src/lib/i18n/dict/*`, `src/app/actions/wbs.ts`, `src/lib/ai/{commands/pipeline,wiki-ingest}.ts`, 설정 화면·`projects/page.tsx`·`PageHero.tsx`, `src/lib/branding.ts`, `tests/invariants/no-legacy-org.test.ts` | 문구·설정 화면·브랜드 | 7 |
| `src/lib/domain/{teams,subact,minutes,kanban}.ts`, `src/lib/excel/export.ts`, `src/lib/ai/analytics.ts`, **`src/components/app/TeamsProvider.tsx`(UI 위험)**, `tests/fixtures/teams.ts`(신설), `tests/helpers/teams-master-mock.ts`, `tests/invariants/no-default-teams.test.ts`(신설) | 5팀 기본값 런타임 제거 | 8 |
| **`src/components/app/{HeaderChrome,Sidebar,ShellStateProvider,HeaderAnnouncementTicker}.tsx`·`src/app/(app)/layout.tsx`·`src/app/globals.css`(UI 위험)**, `src/lib/domain/authz.ts`(`isAnyWorkspaceAdmin`), `src/app/login/page.tsx`, `src/components/wbs/WbsGanttSheet.tsx`(주말 라벨), `tests/css/contrast-tokens.test.ts`(신설) | 셸·토큰 UI 위험 묶음 | 12 |
| `src/lib/agent/{assignee,subtreeManager}.ts`, `src/app/actions/agentWork.ts`(`loadOrderForAdmin`), `src/lib/domain/{seatmap,agentHub}.ts`, `src/components/agent-hub/{ApprovalQueue,DelegationTable}.tsx`, `src/components/agents/seatOps.ts`, `src/lib/data/agentApprovals.ts` | 자기 완료 승인 차단(AUTH-07a) | 15 |
| `src/app/actions/attachments.ts`(`listAttachments`), `src/components/wbs/RowDetailPanel.tsx`(`AttachmentSection`), `src/components/ui/LoadErrorNotice.tsx`(`onRetry`), `src/lib/domain/types.ts`(`DeliverableAttachment.linkError`), `src/lib/i18n/dict/wbs{,.en}.ts`, `tests/actions/attachments-list.test.ts`(신설), `tests/components/wbs-row-detail-attachments.test.tsx`(신설), 목 5개 | 산출물 첨부 정직화(P7-2-DL) | 16 |
| `src/lib/data/minutes.ts`(`getMinuteDetail`), `src/app/(app)/minutes/[id]/page.tsx`, `src/components/minutes/MinuteViewer.tsx`(`filesError`), `src/lib/i18n/dict/minutes{,.en}.ts`, `tests/ui/minute-viewer-files-error.test.tsx`(신설) | 회의록 상세 정직화(P8-H1-2·3) | 17 |
| `src/lib/domain/minutes.ts`(`MINUTE_FILE_URL_TTL_SEC`), `src/app/actions/minutes.ts`(`getMinuteFileUrl`·`getMinuteVersionFileUrl`·`removeMinuteFile`), `src/lib/data/minutes.ts`(`getMinuteVersions`), `src/components/minutes/{MinuteVersionPanel,MinuteViewer}.tsx`, `src/lib/i18n/dict/minutes{,.en}.ts`, `tests/minutes/versions-lazy-sign.test.ts`·`tests/ui/minute-version-download.test.tsx`(신설) | 회의록 서명 URL·삭제 정직(P8-H1-4, P8-H1-1 최소) | 18 |
| `docs/superpowers/specs/2026-09-23-generic-platform-design.md`, `docs/superpowers/plans/2026-09-23-sp0-fork-bootstrap.md`(:37) | 스펙 선반영 기록 | 14 |
| `scripts/agent-harness-example.mjs`, `src/app/actions/teams.ts`(`listTeamsAdmin`), `src/app/(app)/admin/teams/page.tsx`, `src/lib/data/paging.ts`, `src/components/weekly/WeeklySheetView.tsx`(colgroup), `.claude/skills/dflow-work/references/api-contract.md`, `tests/scripts/agent-harness-example.test.ts`·`tests/invariants/colgroup-whitespace.test.ts`(신설) | SP2 최종 리뷰 잔여 minor | 19 |

## 의존 순서

| 웨이브 | 과제 | UI 위험 파일 | 선행 | 브랜치 |
|---|---|---|---|---|
| A | 1 Excel 내보내기 경로 통합(+ 후보 1) | 아니오 | SP2 main | `main` |
| A | 2 이슈 코드 일련번호 폭(마이그레이션 0010) | 아니오 | SP2 main | `main` |
| A | 3 봇이 설정을 무시하는 두 건 | 아니오 | SP2 main | `main` |
| A | 5 SMTP 트랜스포트 중립화 | 아니오 | SP2 main | `main` |
| A | 9 대시보드 표시 정직화(+ 후보 2·7 로더) | 아니오 | SP2 main, 3(`dashboard/page.tsx`·`projectFacts.ts` 주석이 겹친다) | `main` |
| A | 10 편집 입력 보존 | 아니오 | SP2 main | `main` |
| A | 11 에이전트 승인 경합 | 아니오 | SP2 main | `main` |
| A | 13 배포 WBS 스킬 중립화 | 아니오 | SP2 main | `main` |
| A | 15 자기 완료 승인 차단(AUTH-07a) | 아니오 | 11(`agentWork.ts`·`ApprovalQueue.tsx`·`DelegationTable.tsx`·`domain/{seatmap,agentHub}.ts` 가 겹친다) | `main` |
| A | 16 산출물 첨부 정직화(P7-2-DL) | 아니오 | 9(`LoadErrorNotice` 를 재사용·확장한다) | `main` |
| A | 17 회의록 상세 정직화(P8-H1-2·3) | 아니오 | 9(`minutes{,.en}.ts` 사전, 결과형 관례) | `main` |
| A | 18 회의록 서명 URL·삭제 정직(P8-H1-4, P8-H1-1 최소) | 아니오 | 17(`data/minutes.ts`·`MinuteViewer.tsx`·`minutes{,.en}.ts`), 9(`actions/minutes.ts`) | `main` |
| A | 19 SP2 최종 리뷰 잔여 minor(부록) | 아니오(`WeeklySheetView.tsx` 는 UI 위험 목록 밖) | SP2 main. 항목끼리 독립. 7 보다 먼저(`no-legacy-org.test.ts` 를 7 이 뒤에 고친다) | `main` |
| B | 4 챗 라우터 팀 인식 | 아니오 | SP2 teams-scope 가 main 에 있음 | `main` |
| B | 6 도메인·스크립트 잔재 | 아니오 | 4(`WEEKLY_TEAM_SECTIONS`·`tools-weekly-team` 테스트), 1(`template.ts`·`build-xlsx.mjs` 주석) | `main` |
| B | 7 문구·설정 화면·브랜드 | 아니오 | 1(`settings/page.tsx`), 6(`weeklySheet.ts`·`weeklyLint.ts` 주석 — 새 불변식이 걸린다) | `main` |
| C | 8 DEFAULT_TEAMS 런타임 제거 | **예**(`TeamsProvider.tsx`) | 1·4·6(`export.ts` 시그니처, `teams-master-mock`) | `ui/teams-no-default` |
| C | 12 셸·토큰 묶음(+ 후보 5·7 화면, 과제 10 ⑤) | **예** | 7(`projects/page.tsx`), 9(셸 라우트 필드), 10(`wikiDrafts.ts`) | `ui/shell-hardening` |
| 끝 | 14 스펙 선반영 기록 | 아니오 | 1~13·15~18 전부 + 진행 중인 스펙 개정이 main 에 있음 | `main` |

웨이브 A 안에서 파일이 겹치는 곳은 과제 3 → 9(`dashboard/page.tsx`·`projectFacts.ts`), 11 → 15(승인 경로), 9 → 16(`LoadErrorNotice`), 9 → 17 → 18(회의록 로더·뷰어·사전·액션)이다 — 뒤 과제는 앞 과제가 커밋된 뒤에 시작한다. 워크트리를 하나만 쓸 수 있으므로 컨트롤러가 A 를 두 줄로 나눠 돌린다(예: 1·2·5·13·19·10·11→15 / 3→9→16→17→18). DB 를 쓰는 과제 2 는 `db:reset`·`test:rls` 가 다른 과제와 겹치지 않게 한다. 과제 8 과 12 는 서로 다른 `ui/` 브랜치라 순서는 자유지만 같은 워크트리에서 동시에 하지 않는다.

---

## 웨이브 A

### Task 1: Excel 내보내기 경로 통합 — 저장 양식은 두 버튼 모두에, 손상·부재는 오류로 (+ 후보 1 텍스트 날짜)

항목: P1-7 / G, DC-02 / G-default-layout, §6 후보 1. UI 위험 파일 없음.

**Files:**
- Modify: `src/app/api/export/route.ts`, `src/lib/excel/exportWithProfile.ts`, `src/lib/excel/parseWithProfile.ts`(`toIso` 만), `src/lib/excel/template.ts`(가이드 4번 문구 한 줄), `scripts/wbs/build-xlsx.mjs`(헤더 주석 :18-22 만), `tests/excel/wbs-draft-import.test.ts`(헤더 주석 :6-7 만), `src/components/import/ImportWizard.tsx`(:63-67·:87-110 헬퍼 추출, :196-203, :648-663 완료 화면), `src/app/(app)/p/[projectId]/settings/page.tsx`(:236-242 버튼만), `src/lib/i18n/dict/importWizard.ts`·`importWizard.en.ts`, `src/lib/i18n/dict/settings.ts`·`settings.en.ts`
- Create: `src/components/import/downloadWbsExport.ts`, `src/components/settings/ExportExcelButton.tsx`
- Test: `tests/api/export-route.test.ts`(확장), `tests/excel/export-with-profile.test.ts`(확장), `tests/excel/parse-with-profile.test.ts`(텍스트 날짜 describe 추가), `tests/components/download-wbs-export.test.ts`(신설), `tests/ui/settings-page-teams.test.tsx`(ExportExcelButton mock 한 줄)

**Interfaces:**
```ts
// src/components/import/downloadWbsExport.ts — ImportWizard.downloadProfileExport(:87-110)를 옮기고 expand 를 인자로 받는다.
// 토스트는 호출부가 띄운다(두 호출부의 문구가 다르다). 실패 본문의 error 를 그대로 돌려준다.
export async function downloadWbsExport(
  projectId: string,
  opts: { expand: boolean },
): Promise<{ ok: true } | { ok: false; error: string | null }>

// src/components/settings/ExportExcelButton.tsx — 설정 화면(서버 컴포넌트)의 <a href> 를 대신하는 클라이언트 버튼
export function ExportExcelButton({ projectId }: { projectId: string }): JSX.Element

// src/lib/excel/exportWithProfile.ts — 시그니처 불변. buildAoaWithProfile 의 ok:false 사유가 하나 늘어난다:
//   (기존) '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다'
//   (신규) `저장된 엑셀 양식의 계층 열(${n}개)보다 WBS가 깊습니다 — 임포트 마법사에서 양식을 다시 저장하세요`
```
라우트 응답: 401·400(누락)·404·500(목록·설정 조회 실패)은 그대로다. **신규:** 저장 양식 없음 + `expand=1` → 409, 손상 양식 → 422, 빌더 거부 → 400(기존 분기에 깊이 가드가 더해진다).

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok` → `ok`. `git status --porcelain src/app/api/export src/lib/excel src/components/import src/components/settings "src/app/(app)/p/[projectId]/settings" src/lib/i18n/dict tests/api tests/excel` 이 비어 있다.

- [ ] **Step 1: 라우트 테스트 먼저 — `tests/api/export-route.test.ts` 확장**

`vi.hoisted` 의 `mocks` 에 `getProjectConfig: vi.fn()`, `buildWorkbookWithProfile: vi.fn()` 를 더하고 `:21`·`:23` 의 인라인 mock 을 그것으로 바꾼다. `beforeEach` 에 기본값을 둔다.
```ts
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/excel/exportWithProfile', () => ({ buildWorkbookWithProfile: mocks.buildWorkbookWithProfile }))
// @/lib/excel/profile 은 mock 하지 않는다 — 실제 validateProfile 로 손상 판정을 태운다.
import type { ExcelProfile } from '@/lib/excel/profile'

const get = (projectId: string, expand = false) =>
  GET(new NextRequest(`http://localhost/api/export?projectId=${projectId}${expand ? '&expand=1' : ''}`))

const SAVED: ExcelProfile = {
  version: 1, sheetName: '일정', holidaySheetName: null, headerRow: 0,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A'], [7, '팀B']], ownerMarks: { '●': 'primary', '△': 'support' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.state = { projects: [{ id: 'p-mine', name: 'Acme' }], degraded: false }
  mocks.getProjectConfig.mockResolvedValue({ levelLabels: ['단계'], excelProfile: {} })
  mocks.buildWorkbookWithProfile.mockReturnValue({ ok: true, buffer: new ArrayBuffer(4) })
})

describe('GET /api/export — 저장 양식·부재·손상', () => {
  it.each([false, true])('저장 양식은 expand=%s 에서도 그 양식으로 만들고 expandSubActs 만 다르다', async (expand) => {
    mocks.getProjectConfig.mockResolvedValue({ levelLabels: ['단계', '작업'], excelProfile: SAVED })
    const res = await get('p-mine', expand)
    expect(res.status).toBe(200)
    expect(mocks.buildWbsWorkbook).not.toHaveBeenCalled()
    const [, profile, , opts, name] = mocks.buildWorkbookWithProfile.mock.calls[0]
    expect(profile).toEqual(SAVED)
    expect(opts).toEqual({ expandSubActs: expand, levelLabels: ['단계', '작업'] })
    expect(name).toBe('Acme')
  })

  it('손상 양식은 접기·펼침 모두 422 — 어떤 빌더도 부르지 않는다(LEGACY 폴백 없음)', async () => {
    mocks.getProjectConfig.mockResolvedValue({ levelLabels: ['단계'], excelProfile: { version: 2 } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const expand of [false, true]) {
      const res = await get('p-mine', expand)
      expect(res.status).toBe(422)
      expect((await res.json()).error).toMatch(/손상.*임포트 마법사/)
    }
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    expect(mocks.buildWbsWorkbook).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it("저장 양식이 없는데 펼침이면 409 — WBS 도 읽지 않는다", async () => {
    const res = await get('p-mine', true)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toContain('프로젝트 기본값으로 저장')
    expect(mocks.buildWorkbookWithProfile).not.toHaveBeenCalled()
    expect(mocks.getComputedWbs).not.toHaveBeenCalled()
  })

  it("저장 양식이 없으면 접기는 지금처럼 buildWbsWorkbook(프로젝트 팀·단계 라벨)", async () => {
    const res = await get('p-mine')
    expect(res.status).toBe(200)
    expect(mocks.buildWbsWorkbook).toHaveBeenCalledWith([], [], 'Acme', ['A팀'], ['단계'])
  })

  it('빌더 거부는 400 과 그 사유', async () => {
    mocks.getProjectConfig.mockResolvedValue({ levelLabels: ['단계'], excelProfile: SAVED })
    mocks.buildWorkbookWithProfile.mockReturnValueOnce({ ok: false, error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' })
    const res = await get('p-mine', true)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' })
  })

  it('설정 조회 실패는 500 이고 설정은 한 번만 읽는다', async () => {
    mocks.getProjectConfig.mockRejectedValueOnce(new Error('프로젝트 설정 조회 실패: boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await get('p-mine', true)
    expect(res.status).toBe(500)
    expect(mocks.getProjectConfig).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})
```
기존 4건(:34-61)은 그대로 둔다. `:47` 의 `toContainEqual(['A팀'])` 도 계속 통과해야 한다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/api/export-route.test.ts` → 새 케이스 FAIL(409·422·저장 양식 접기 경로가 아직 없다).

- [ ] **Step 3: 순수 테스트 — `tests/excel/export-with-profile.test.ts` 끝에 추가**

```ts
import * as XLSX from 'xlsx'

/* ── (d) headerRow 존중 — 라벨 행이 profile.headerRow 위치에 오고, 같은 프로파일로 되읽힌다 ── */
describe('buildWorkbookWithProfile — headerRow 0·1·2·3 라운드트립', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: '준비', plannedStart: '2026-07-01', plannedEnd: '2026-07-10' }),
    row({ id: 'T', parentId: 'P', code: '1.1', sortOrder: 1, name: '착수', plannedStart: '2026-07-01', plannedEnd: '2026-07-03',
      owners: [{ team: '팀A', kind: 'primary' }] }),
  ]
  const items = computeTree(SRC, '2026-07-02', new Set(), { subActTeamOrder: teamOrderMap(['팀A']) })
  const COLUMNS = (headerRow: number): ExcelProfile => ({
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow,
    hierarchy: { kind: 'columns', columns: [0, 1] },
    logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
    teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
  })
  const OUTLINE = (headerRow: number): ExcelProfile => ({
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow,
    hierarchy: { kind: 'outline', column: 0 },
    logical: { extraAxis: null, code: null, name: 1, deliverable: null, start: 2, end: 3, weight: null, actualPct: null },
    teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
  })
  const readBack = (profile: ExcelProfile) => {
    const built = buildWorkbookWithProfile(items, profile, [], { expandSubActs: false }, 'Acme')
    if (!built.ok) throw new Error(built.error)
    // detect·parse 와 같은 읽기 규칙(blankrows:false) — 빈 행은 세지 않는다
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      XLSX.read(built.buffer, { type: 'array' }).Sheets.WBS, { header: 1, blankrows: false })
    const parsed = parseWithProfile(built.buffer, profile)
    if (!parsed.ok) throw new Error(parsed.error)
    return { aoa, rows: parsed.rows.map(r => [r.depth, r.name, r.plannedStart]) }
  }

  it.each([0, 1, 2, 3])('columns headerRow=%i', (h) => {
    const { aoa, rows } = readBack(COLUMNS(h))
    expect(aoa[h]).toContain('시작')
    expect(rows).toEqual([[0, '준비', '2026-07-01'], [1, '착수', '2026-07-01']])
  })
  it.each([0, 1, 2, 3])('outline headerRow=%i', (h) => {
    const { aoa, rows } = readBack(OUTLINE(h))
    expect(aoa[h]).toContain('코드')
    expect(rows).toEqual([[0, '준비', '2026-07-01'], [1, '착수', '2026-07-01']])
  })

  it('계층 열보다 깊은 WBS 는 접기·펼침 모두 ok:false — 이름이 사라진 파일을 만들지 않는다', () => {
    const deep = computeTree([
      row({ id: 'A', parentId: null, code: '1', sortOrder: 0, name: 'A' }),
      row({ id: 'B', parentId: 'A', code: '1.1', sortOrder: 1, name: 'B' }),
      row({ id: 'C', parentId: 'B', code: '1.1.1', sortOrder: 2, name: 'C' }),
    ], '2026-07-02', new Set(), OPTS)
    for (const expandSubActs of [false, true]) {
      const r = buildAoaWithProfile(deep, COLUMNS(2), { expandSubActs })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('계층 열(2개)')
    }
  })
})
```
기존 (a) "LEGACY 접기 == buildWbsAoa 셀 단위 동일"(`:24-54`)이 headerRow 2 의 바이트 불변을 계속 지킨다. 손대지 않는다.

`tests/excel/parse-with-profile.test.ts` 끝에 추가:
```ts
describe('parseWithProfile — 양식 가이드 4번의 YYYY-MM-DD 텍스트 날짜', () => {
  const P: ExcelProfile = {
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
    hierarchy: { kind: 'columns', columns: [0, 1] },
    logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: null },
    teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['L1', 'L2', '산출물', '시작', '종료'],
    ['준비', '', '', '2026-09-01', '2026-09-12'],
    ['', '착수', '', ' 2026-09-01 ', '2026-02-30'],
  ]), 'WBS')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  it('텍스트 ISO 날짜를 읽는다 — 달력에 없는 날짜는 비운다', () => {
    const r = parseWithProfile(buf, P)
    if (!r.ok) throw new Error(r.error)
    expect(r.rows.map(x => [x.plannedStart, x.plannedEnd])).toEqual([['2026-09-01', '2026-09-12'], ['2026-09-01', null]])
  })
})
```

- [ ] **Step 4: 실패 확인** — `npx vitest run tests/excel/export-with-profile.test.ts tests/excel/parse-with-profile.test.ts` → headerRow 0·1·3 과 깊이 가드, 텍스트 날짜 FAIL.

- [ ] **Step 5: 구현 — `exportWithProfile.ts`**

`buildAoaWithProfile` 에서 아웃라인+펼침 거부(`:104-106`) 바로 뒤, `hierCols` 계산(`:108`) 뒤에 깊이 가드를 둔다.
```ts
  // 계층 열보다 깊은 항목(sub-act 제외)은 접기에서 이름이 사라지고(:201-203), 펼침에서는 '세부업무' 열로 잘못 들어간다.
  // 단계 추가(LevelSettingsManager)나 더 깊은 파일의 append 임포트 뒤에 생긴다 — 조용한 손상 대신 거부한다.
  if (hierCols) {
    const tooDeep = flattenWithDepth(items, false).some(({ item, depth }) => !item.isOwnerSplit && depth >= hierCols.length)
    if (tooDeep) {
      return { ok: false, error: `저장된 엑셀 양식의 계층 열(${hierCols.length}개)보다 WBS가 깊습니다 — 임포트 마법사에서 양식을 다시 저장하세요` }
    }
  }
```
`:169-172` 의 ⚠️ 주석을 지우고 `const rows: unknown[][] = [header1, header2, header3]`(`:193`)를 다음으로 바꾼다.
```ts
  // 라벨 행(header3)은 profile.headerRow 위치에 둔다 — parseWithProfile 이 headerRow+1 부터 데이터를 읽는다.
  const rows: unknown[][] = [...headerRowsBeforeLabel(profile.headerRow, header1, header2, projectName), header3]
```
파일 아래(`buildWorkbookWithProfile` 위)에 헬퍼를 둔다.
```ts
/** 라벨 행 앞에 올 행 headerRow 개. detect·parse 는 blankrows:false 로 읽어 빈 행을 세지 않으므로 전부 비어 있지 않아야 한다.
 *  0 → 없음, 1 → [제목], 2 → [제목, 병합 타이틀](레거시 3행 헤더 — 바이트 불변), 3 이상 → 제목과 병합 타이틀 사이에 제목 반복 행.
 *  병합 타이틀이 비면(아웃라인 + 팀·산출물·일정 열 없음) 제목으로 채운다 — 비어 있으면 행이 사라져 라벨 위치가 한 칸 당겨진다. */
function headerRowsBeforeLabel(headerRow: number, header1: unknown[], header2: unknown[], projectName: string): unknown[][] {
  if (headerRow === 0) return []
  if (headerRow === 1) return [header1]
  const title2 = header2.some(c => c !== '') ? header2 : [projectName]
  const fillers = Array.from({ length: headerRow - 2 }, () => [projectName])
  return [header1, ...fillers, title2]
}
```
`buildWorkbookWithProfile` 의 ⚠️ 문단(`:251-256`)은 "headerRow 는 라벨 행 위치로 존중한다(headerRowsBeforeLabel). 계층 열보다 깊은 WBS 는 거부한다." 로 바꾼다.

- [ ] **Step 6: 구현 — `toIso` 텍스트 날짜(후보 1)와 문구**

`src/lib/excel/parseWithProfile.ts:26-37` 의 `toIso` 에 문자열 분기를 더한다.
```ts
const ISO_DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/

function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.y}-${p(d.m)}-${p(d.d)}`
  }
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).toISOString().slice(0, 10)
  }
  // 양식 가이드 4번이 허용한 'YYYY-MM-DD' 텍스트 — 달력에 있는 날짜만(2026-02-30 은 null). 그 밖의 문자열은 종전대로 null.
  if (typeof v === 'string') {
    const m = ISO_DATE_TEXT.exec(v.trim())
    if (!m) return null
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    const dt = new Date(Date.UTC(y, mo - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? m[0] : null
  }
  return null
}
```
Holiday 시트의 헤더 행('날짜')은 여전히 null 이라 건너뛴다(`:157-160`). `src/lib/excel/template.ts:44` 가이드 4번을 `['4', '시작일·종료일은 날짜 셀 또는 YYYY-MM-DD 텍스트(예: 2026-09-01). 그 밖의 형식은 빈 날짜로 읽힙니다. 상위 행 기간은 하위를 덮게 적습니다.']` 로 바꾼다. `scripts/wbs/build-xlsx.mjs:18-22` 와 `tests/excel/wbs-draft-import.test.ts:6-7` 주석은 "toIso 는 number|Date 와 'YYYY-MM-DD' 텍스트만 읽는다 — 그 밖의 문자열은 조용히 null 이 되어 일정이 사라진 채 임포트가 성공하므로, 생성기는 로컬 정오 Date 셀로 쓴다"로 고친다.

- [ ] **Step 7: 구현 — 라우트 `src/app/api/export/route.ts`**

`LEGACY_EXCEL_PROFILE_V1` import 를 지운다(`validateProfile` 만 남긴다). `:28-77` 을 다음으로 바꾼다(401·400·404·500 판정 순서 `:14-27` 은 그대로 — 팀 캐시 전에 목록 판정, cf2539b).
```ts
const ERR_PROFILE_MISSING = '저장된 엑셀 양식이 없습니다 — 임포트 마법사에서 "이 양식을 프로젝트 기본값으로 저장"을 켜고 다시 가져오세요.'
const errProfileCorrupt = (detail: string) => `저장된 엑셀 양식이 손상되었습니다: ${detail} — 임포트 마법사에서 양식을 다시 저장하세요.`

  const name = project.name
  let config: Awaited<ReturnType<typeof getProjectConfig>>
  try {
    config = await getProjectConfig(projectId)
  } catch (e) {
    // 3원칙 — 조회 실패를 '양식 없음'이나 기본 라벨로 위장하지 않는다(import/inspect 라우트와 같은 관례).
    console.error('[export] 프로젝트 설정 조회 실패:', e)
    const message = e instanceof Error ? e.message : '프로젝트 설정을 확인할 수 없습니다'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // 저장 양식이 있으면 접기·펼침 모두 그 양식으로 낸다 — 재임포트가 저장 양식을 먼저 고르므로(importWizard.ts:85) 두 버튼이
  // 다른 모양을 내면 설정 화면 파일이 되읽히지 않는다. 손상은 오류로 알린다(폴백 없음 — 에러 3원칙).
  // 저장 양식이 없으면 접기(설정 화면)는 프로젝트 팀·단계로 만드는 기본 레이아웃(buildWbsWorkbook, 바이트 불변),
  // 펼침(마법사 완료 화면)은 펼칠 양식이 없어 409 다(스펙 §3.4 "프로파일 필요, 폴백 없음"). 원본 5팀 LEGACY 는 쓰지 않는다.
  // 두 버튼 모두 fetch 로 받아 오류 본문을 토스트로 보여 준다(downloadWbsExport).
  const expand = req.nextUrl.searchParams.get('expand') === '1'
  const hasSaved = Object.keys(config.excelProfile).length > 0
  const validated = hasSaved ? validateProfile(config.excelProfile) : null
  if (validated && !validated.ok) {
    console.error('[export] 저장된 양식이 손상됨:', validated.error)
    return NextResponse.json({ error: errProfileCorrupt(validated.error) }, { status: 422 })
  }
  if (!validated && expand) return NextResponse.json({ error: ERR_PROFILE_MISSING }, { status: 409 })

  const { items, holidays } = await getComputedWbs(projectId)
  const hol = holidays.map(d => ({ date: d, name: '' }))
  let buf: ArrayBuffer
  if (validated) {
    const built = buildWorkbookWithProfile(items, validated.profile, hol, { expandSubActs: expand, levelLabels: config.levelLabels }, name)
    // 명시적 미지원(아웃라인+펼침)·양식보다 깊은 WBS — 무증상 오파싱 대신 400 과 사유.
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 })
    buf = built.buffer
  } else {
    buf = buildWbsWorkbook(items, hol, name, activeTeamCodesForProjectSync(projectId), config.levelLabels)
  }
```
(상수 둘은 파일 상단 import 아래에 둔다.) `:31-34`(바이트 불변·절대 건드리지 않는다)와 `:48-50`(알릴 채널 없음) 주석은 위 주석으로 대체된다.

- [ ] **Step 8: 클라이언트 — 헬퍼·설정 버튼·완료 화면·문구**

`src/components/import/downloadWbsExport.ts`:
```ts
/** WBS 엑셀 내보내기(/api/export)를 fetch→blob 으로 받아 내려받는다. 실패 본문의 error 를 돌려주고 토스트는 호출부가 띄운다.
 *  <a href> 로 받으면 409·422·400 JSON 이 탭에 날것으로 뜬다(설정 화면의 옛 버튼). 파일명은 Content-Disposition 의 filename*. */
export async function downloadWbsExport(
  projectId: string,
  opts: { expand: boolean },
): Promise<{ ok: true } | { ok: false; error: string | null }> {
  const qs = `projectId=${encodeURIComponent(projectId)}${opts.expand ? '&expand=1' : ''}`
  const res = await fetch(`/api/export?${qs}`)
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    return { ok: false, error: err?.error ?? null }
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? `wbs_export_${projectId}.xlsx`)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return { ok: true }
}
```
`ImportWizard.tsx`: `:63-67` 주석 블록과 `:87-110` 의 `downloadProfileExport` 를 지우고 `runExportProfile`(`:196-203`)을 바꾼다.
```ts
  async function runExportProfile() {
    setExportBusy(true)
    try {
      const r = await downloadWbsExport(projectId, { expand: true })
      if (!r.ok) toast({ title: t('importWizard.exportProfileFailedHttp'), description: r.error ?? undefined, variant: 'error' })
    } finally {
      setExportBusy(false)
    }
  }
```
완료 화면의 내보내기 패널(`:650-666`)은 `state.result.profileSaved` 일 때만 그린다. 아니면 같은 자리에 `<p className="text-xs leading-5 text-ink-muted">{t('importWizard.exportProfileNeedsSaved')}</p>` 한 줄을 둔다. 문구 `importWizard.ts:109`("이 양식 그대로")와 맞추기 위해서다 — 이번에 저장하지 않았는데 옛 저장 양식이 있으면 "이 양식"이 옛 양식을 내보내던 것도 같이 막힌다.

`src/components/settings/ExportExcelButton.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { downloadWbsExport } from '@/components/import/downloadWbsExport'

/** 설정 화면의 WBS 엑셀 내보내기(접기) — 저장 양식이 있으면 그 양식, 없으면 프로젝트 기본 레이아웃. 실패 사유는 토스트로. */
export function ExportExcelButton({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await downloadWbsExport(projectId, { expand: false })
      if (!r.ok) toast({ title: t('settings.exportFailed'), description: r.error ?? undefined, variant: 'error' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button type="button" onClick={run} disabled={busy} className="btn btn-ghost shrink-0" aria-label={t('settings.exportAria')}>
      <Download className="h-4 w-4" /> {busy ? t('settings.exporting') : t('settings.exportExcel')}
    </button>
  )
}
```
`settings/page.tsx:236-242` 의 `<a href=…>` 를 `<ExportExcelButton projectId={projectId} />` 로 바꾼다(`Download` import 가 다른 곳에서 안 쓰이면 지운다). i18n 키를 ko·en 양쪽에 추가한다(`Record<keyof ko>` 라 한쪽만 넣으면 typecheck 가 깨진다).
- `settings.exportFailed`: '내보내기에 실패했습니다' / 'Export failed'
- `settings.exporting`: '내보내는 중…' / 'Exporting…'
- `importWizard.exportProfileNeedsSaved`: '이번 가져오기에서 양식을 저장하지 않아 펼침 내보내기를 쓸 수 없습니다 — "이 양식을 프로젝트 기본값으로 저장"을 켜고 다시 가져오세요.' / 'The layout was not saved in this import, so expanded export is unavailable. Turn on "Save this layout as the project default" and import again.'

`tests/ui/settings-page-teams.test.tsx` 의 컴포넌트 mock 목록에 `vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))` 한 줄을 더한다(클라이언트 훅이 서버 렌더 테스트에서 provider 를 찾지 않게).

`tests/components/download-wbs-export.test.ts`(jsdom): `fetch` 를 stub 해 (a) 200 이면 `{ ok: true }` 이고 `a.download` 가 `filename*` 에서 푼 이름, (b) 409 JSON `{ error: 'X' }` 면 `{ ok: false, error: 'X' }` 이고 `URL.createObjectURL` 미호출, (c) JSON 이 아닌 500 이면 `{ ok: false, error: null }`, (d) `expand: true` 면 URL 에 `&expand=1`.
```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadWbsExport } from '@/components/import/downloadWbsExport'

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('409 면 본문의 error 를 돌려주고 파일을 만들지 않는다', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'X' }), { status: 409 }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await downloadWbsExport('p1', { expand: true })).toEqual({ ok: false, error: 'X' })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/export?projectId=p1&expand=1')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})
```
(나머지 세 케이스도 같은 모양으로 쓴다.)

- [ ] **Step 9: 통과·회귀**

Run: `npx vitest run tests/api/export-route.test.ts tests/excel tests/components/download-wbs-export.test.ts tests/ui/settings-page-teams.test.tsx --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint`
Expected: 실패 0. 그다음 `npx vitest run --reporter=dot 2>&1 | tail -3` 도 초록이어야 한다. `grep -rn "LEGACY_EXCEL_PROFILE_V1" src` 는 `src/lib/excel/profile.ts` 정의(와 `parseWithProfile.ts` 주석)만 남는다 — 런타임 importer 0.

- [ ] **Step 10: 로컬 확인(선택 아님 — UI 위험 파일은 아니지만 다운로드 동작을 눈으로 본다)** — `npm run dev -- -p 3101` → 설정 화면 "Excel 내보내기"가 파일을 내려받는다(저장 양식 없음 → 기본 레이아웃). 마법사로 `wbs.xlsx` 양식을 "프로젝트 기본값으로 저장"을 켜고 임포트 → 완료 화면의 펼침 내보내기 성공 → 끄고 다시 임포트 → 패널 대신 안내 한 줄. 끝나면 3101 서버를 내린다.

- [ ] **Step 11: 커밋**

```bash
git add src/app/api/export/route.ts src/lib/excel/exportWithProfile.ts src/lib/excel/parseWithProfile.ts src/lib/excel/template.ts scripts/wbs/build-xlsx.mjs src/components/import/downloadWbsExport.ts src/components/import/ImportWizard.tsx src/components/settings/ExportExcelButton.tsx "src/app/(app)/p/[projectId]/settings/page.tsx" src/lib/i18n/dict/importWizard.ts src/lib/i18n/dict/importWizard.en.ts src/lib/i18n/dict/settings.ts src/lib/i18n/dict/settings.en.ts tests/api/export-route.test.ts tests/excel/export-with-profile.test.ts tests/excel/parse-with-profile.test.ts tests/excel/wbs-draft-import.test.ts tests/components/download-wbs-export.test.ts tests/ui/settings-page-teams.test.tsx
git commit -F - <<'EOF'
fix(excel): 저장 양식은 두 내보내기 버튼 모두에 — 손상은 422, 펼칠 양식이 없으면 409, 원본 5팀 LEGACY 폴백 삭제

설정 화면 파일과 마법사 파일이 서로 다른 모양이라 재임포트(저장 양식 선채택)가 설정 화면 파일을 잘못 읽었고,
손상된 양식은 로그만 남기고 원본 5팀 열 양식으로 조용히 바뀌었다. 동작 변화:
- 저장 양식이 있으면 접기·펼침 모두 그 양식. 트리에 등장한 팀만 추가 열로 붙는다(비활성 팀도 담당이 있으면 포함).
- 양식의 headerRow 를 라벨 행 위치로 존중한다(레거시 headerRow 2 는 바이트 불변). 계층 열보다 깊은 WBS 는 400.
- 저장 양식 없음: 접기는 종전 기본 레이아웃, 펼침은 409. 마법사 완료 화면은 이번에 저장했을 때만 펼침 버튼을 보인다.
- 두 버튼 모두 fetch 로 받아 실패 사유를 토스트로 보인다.
- 양식 가이드 4번대로 'YYYY-MM-DD' 텍스트 날짜를 읽는다(그 밖의 문자열은 종전대로 빈 날짜).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

### Task 2: 이슈 코드 일련번호 100 이상 절단 — 마이그레이션 `0010_issue_code_seq_width`

항목: F-seq100. UI 위험 파일 없음. 마이그레이션과 테스트는 다른 커밋이다(G1).

**Files:**
- Create: `supabase/migrations/0010_issue_code_seq_width.sql`, `supabase/rollbacks/0010_issue_code_seq_width_rollback.sql`, `tests/rls/issue-code-width.test.ts`

**Interfaces:**
- `public.assign_issue_analysis_code()` — 시그니처·소유자·ACL(`0000:11528-11529`)·트리거 바인딩(`0000:9012`)은 그대로다. 코드 식만 `'PI-I-' || mega_code || '-' || lpad(seq, greatest(2, length(seq)), '0')` 로 바뀐다(한 자리 `01`, 두 자리 그대로, 세 자리 이상 자르지 않음).
- `issues_analysis_code_consistency_check` — 이름은 그대로, 식만 같은 폭으로 바뀐다.
- TS 쪽은 이미 자르지 않는다(`issueAnalysis.ts:167-171`, `tests/domain/issue-analysis.test.ts:101-103`) — TS 변경 없음.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `ls supabase/migrations` 의 마지막이 `0008_workspace_settings.sql` 이다. `grep -ln "assign_issue_analysis_code\|issues_analysis_code_consistency_check" supabase/migrations/000[1-8]*.sql` 이 비어 있다(0001~0008 이 이 함수·제약을 다시 정의하지 않았다). 로컬 DB: `npm run db:start`(떠 있지 않으면) → `npm run db:reset`.

- [ ] **Step 1: RLS 테스트 먼저 — `tests/rls/issue-code-width.test.ts`**

```ts
// 0010 이슈 분석 코드 폭 — 일련번호 100 이상을 자르지 않는다(PI-I-99-100). 0000 의 lpad(…, 2) 는 100 을 '10' 으로 잘라
// 10번과 코드가 겹쳤고(23505 로 그 영역이 영구 차단), CHECK 도 같은 식이라 잘린 코드를 통과시켰다.
// 픽스처 영역 '99'(fixture-ws.sql:71)·대분류 …110e(:105)·카운터 (c1,'99')(:185)를 쓴다. 전부 begin…rollback 안이라
// 카운터 조작은 남지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const MAJOR = '00000000-0000-0000-7e57-00000000110e'
const setCounter = (c: PoolClient, n: number) =>
  c.query(`update public.issue_number_counters set last_no = $2 where project_id = $1 and mega_code = '99'`, [F.projects.a, n])
const classify = async (c: PoolClient, title: string) =>
  (await c.query<{ mega_seq: string; pi_issue_code: string }>(
    `insert into public.issues (project_id, title, mega_code, major_id, sub_process, owner_department, source_type)
     values ($1, $2, '99', $3, 'rls', 'rls', 'other') returning mega_seq, pi_issue_code`,
    [F.projects.a, title, MAJOR],
  )).rows[0]

describe('0010 이슈 코드 일련번호 폭', () => {
  it('한 자리는 01, 10·99 는 그대로, 100·101 은 자르지 않는다 — 10번이 있어도 23505 없이', async () => {
    await asService(pool, async (c) => {
      await setCounter(c, 0)
      expect((await classify(c, 'seq1')).pi_issue_code).toBe('PI-I-99-01')
      await setCounter(c, 9)
      expect((await classify(c, 'seq10')).pi_issue_code).toBe('PI-I-99-10')
      await setCounter(c, 98)
      expect((await classify(c, 'seq99')).pi_issue_code).toBe('PI-I-99-99')
      const r100 = await classify(c, 'seq100')
      expect([Number(r100.mega_seq), r100.pi_issue_code]).toEqual([100, 'PI-I-99-100'])
      expect((await classify(c, 'seq101')).pi_issue_code).toBe('PI-I-99-101')
      const { rows } = await c.query<{ last_no: string }>(
        `select last_no from public.issue_number_counters where project_id = $1 and mega_code = '99'`, [F.projects.a])
      expect(Number(rows[0].last_no)).toBe(101)
    })
  })

  it('CHECK 도 같은 폭 — 트리거를 끄고 넣어도 잘린 코드는 23514, 넓힌 코드는 통과', async () => {
    await asService(pool, async (c) => {
      await c.query(`set local session_replication_role = replica`) // 트리거를 끄고 CHECK 만 본다(postgres 롤)
      const insert = `insert into public.issues (project_id, title, mega_code, mega_seq, pi_issue_code, major_id, sub_process, owner_department, source_type)
                      values ($1, 'chk', '99', 100, $2, $3, 'rls', 'rls', 'other')`
      expect(await pgError(c, insert, [F.projects.a, 'PI-I-99-10', MAJOR])).toMatchObject({ code: '23514' })
      expect(await pgError(c, insert, [F.projects.a, 'PI-I-99-100', MAJOR])).toBeNull()
    })
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm run test:rls -- tests/rls/issue-code-width.test.ts` → 첫 케이스는 `seq100` 에서 23505(`issues_project_pi_code_uidx`), 둘째 케이스는 `'PI-I-99-10'` 이 통과(잘린 CHECK)해서 FAIL.

- [ ] **Step 3: 마이그레이션 — `supabase/migrations/0010_issue_code_seq_width.sql`**

함수 본문은 이 계획에서 옮겨 적지 않는다. `sed -n '1036,1109p' supabase/migrations/0000_baseline.sql` 출력을 그대로 붙인 뒤 두 곳만 바꾼다. 첫 줄 `CREATE FUNCTION` 은 `CREATE OR REPLACE FUNCTION` 으로, 1106 행은 아래 한 줄로 바꾼다(들여쓰기 4칸 그대로). 롤백 대조(카탈로그 diff)가 본문 바이트를 비교하므로 공백을 바꾸지 않는다.
```sql
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, greatest(2, pg_catalog.length(v_seq::text)), '0');
```
(`greatest` 는 SQL 구문이라 스키마를 붙이지 않는다 — `pg_catalog.greatest` 는 구문 오류다.) 파일 전체 모양:
```sql
-- 0010_issue_code_seq_width — 이슈 분석 코드(PI-I-<영역>-<일련번호>)의 일련번호가 100 이상이면 잘리던 결함을 고친다.
--
-- 0000 의 assign_issue_analysis_code() 는 pg_catalog.lpad(v_seq::text, 2, '0') 로 코드를 만든다. lpad 는 목표 길이보다 긴
-- 문자열을 잘라 100 이 '10' 이 된다 — 같은 (프로젝트, 영역)의 10번과 코드가 겹쳐 issues_project_pi_code_uidx 가 23505 로 막고,
-- 카운터 증가도 같은 문장에서 롤백돼 그 영역은 더 분류할 수 없다(10번을 지웠다면 100번이 조용히 '-10' 을 재사용한다).
-- CHECK issues_analysis_code_consistency_check 도 같은 식이라 잘린 코드를 통과시켰다. TS(formatPiIssueCode)는 자르지 않는다.
--
-- 바꾼 것: 함수 본문의 한 줄(0000_baseline.sql:1106)과 CHECK 식을 greatest(2, length) 폭으로. 나머지 본문은 0000 그대로다.
-- CREATE OR REPLACE 는 proconfig 를 바꾸므로 SET search_path TO '' 를 다시 적는다(소유자·ACL·트리거 바인딩은 유지된다).
-- 가드: mega_seq >= 100 인 행이 있으면 멈춘다 — 그 행의 코드는 이미 잘려 있고 ISSUE_CODE_IMMUTABLE 때문에 백필할 수 없다.
-- 롤백: supabase/rollbacks/0010_issue_code_seq_width_rollback.sql.

do $$
begin
  if exists (select 1 from public.issues where mega_seq >= 100) then
    raise exception 'ISSUE_SEQ_WIDTH_PRECONDITION: mega_seq >= 100 인 이슈가 있다 — 잘린 코드를 먼저 수동으로 정리한다'
      using errcode = '23514';
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public.assign_issue_analysis_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  …(0000_baseline.sql:1041-1105 그대로)…
    'PI-I-' || new.mega_code || '-' || pg_catalog.lpad(v_seq::text, greatest(2, pg_catalog.length(v_seq::text)), '0');
  return new;
end
$$;

-- 제약은 한 ALTER TABLE 에서 지우고 같은 이름으로 다시 건다(검증은 기존 행 전부에 대해 돈다 — 위 가드로 위반 행이 없다).
alter table public.issues
  drop constraint issues_analysis_code_consistency_check,
  add constraint issues_analysis_code_consistency_check check (
    ((mega_code is null) and (mega_seq is null) and (pi_issue_code is null))
    or ((mega_code is not null) and (mega_seq is not null) and (mega_seq > 0)
        and (pi_issue_code = (('PI-I-'::text || mega_code) || '-'::text
             || pg_catalog.lpad((mega_seq)::text, greatest(2, pg_catalog.length((mega_seq)::text)), '0'::text))))
  );
```
(위 `…(…그대로)…` 는 설명일 뿐이다 — 파일에는 실제 줄을 넣는다.) CLI 가 파일 하나를 한 트랜잭션으로 적용하므로 `begin;/commit;` 을 쓰지 않는다(0006·0008 관례).

- [ ] **Step 4: 롤백 — `supabase/rollbacks/0010_issue_code_seq_width_rollback.sql`**

```sql
-- 0010_issue_code_seq_width 롤백 — 0008 적용 직후로 정확히 돌아간다(카탈로그 0 mismatch: compare-catalog.mjs diff).
-- 되돌린 상태는 결함 그대로다: 일련번호 100 이상이면 코드가 잘려 그 영역의 분류가 23505 로 막힌다.
-- 가드: mega_seq >= 100 인 행이 있으면 멈춘다 — 그 행의 'PI-I-xx-100' 코드는 원래의 lpad(…, 2) CHECK 를 어긴다.
-- 본문 출처: 0000_baseline.sql:1036-1109 원문(0001~0008 에서 바뀐 적 없음).

begin;

do $$
begin
  if exists (select 1 from public.issues where mega_seq >= 100) then
    raise exception 'ISSUE_SEQ_WIDTH_ROLLBACK_BLOCKED: mega_seq >= 100 인 이슈가 있어 원래 CHECK 로 돌아갈 수 없다'
      using errcode = '23514';
  end if;
end
$$;

<sed -n '1036,1109p' supabase/migrations/0000_baseline.sql 출력 — 첫 줄만 CREATE OR REPLACE FUNCTION 으로, 1106 은 원문 그대로>

alter table public.issues
  drop constraint issues_analysis_code_consistency_check,
  add constraint issues_analysis_code_consistency_check check (
    ((mega_code is null) and (mega_seq is null) and (pi_issue_code is null))
    or ((mega_code is not null) and (mega_seq is not null) and (mega_seq > 0)
        and (pi_issue_code = (('PI-I-'::text || mega_code) || '-'::text || lpad((mega_seq)::text, 2, '0'::text))))
  );

commit;
```
(`<…>` 줄도 설명이다 — 파일에는 실제 원문을 넣는다.)

- [ ] **Step 5: 적용·리허설·롤백 대조**

```bash
npm run db:reset                                    # 0000~0010 가 오류 없이 적용된다
npm run test:rls -- tests/rls/issue-code-width.test.ts   # PASS
npm run test:rls 2>&1 | tail -4                     # 전체 RLS 초록(다른 파일 회귀 없음)
D=$(mktemp -d)
supabase db reset --version 0008 && node supabase/rehearsal/compare-catalog.mjs capture "$D/r8"
npm run db:reset && docker exec -i supabase_db_d-flow psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/rollbacks/0010_issue_code_seq_width_rollback.sql
node supabase/rehearsal/compare-catalog.mjs capture "$D/b9" && node supabase/rehearsal/compare-catalog.mjs diff "$D/r8" "$D/b9"
npm run db:reset
```
Expected: diff "불일치 0". 불일치가 함수 본문이면 공백·줄바꿈이 원문과 다른 것이다 — `sed` 출력을 다시 붙인다. 마지막 `db:reset` 뒤 `npm run dev:bootstrap` 을 돌린다.

- [ ] **Step 6: 마이그레이션 커밋(G1 — 마이그레이션·롤백만, G4 트레일러)**

```bash
git add supabase/migrations/0010_issue_code_seq_width.sql supabase/rollbacks/0010_issue_code_seq_width_rollback.sql
git commit -F - <<'EOF'
db: 0010 이슈 분석 코드 일련번호 폭 — 100 이상을 자르지 않는다

lpad(seq, 2) 가 100 을 '10' 으로 잘라 같은 영역의 10번과 코드가 겹쳤고, 23505 와 카운터 롤백 때문에 그 영역은 더 분류할 수 없었다.
함수 한 줄과 CHECK 를 greatest(2, length) 폭으로 바꾼다(TS formatPiIssueCode 와 같은 규칙). 100 이상 행이 있으면 정방향·롤백
모두 멈춘다 — 잘린 코드는 ISSUE_CODE_IMMUTABLE 때문에 백필할 수 없다. 롤백 후 카탈로그 diff 0.

Staging-verified: local db reset <date '+%Y-%m-%d %H:%M' 출력>
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='%(trailers:key=Staging-verified,valueonly)'   # 비어 있으면 amend 로 트레일러 블록을 고친다
```

- [ ] **Step 7: 테스트 커밋**

```bash
git add tests/rls/issue-code-width.test.ts
git commit -m "test(rls): 이슈 코드 일련번호 100·101 이 잘리지 않고 CHECK 도 같은 폭인지 — 10번과 공존

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
스펙 §6.3 번호표·SP5 한 줄은 이 과제에서 고치지 않는다 — 진행 중인 스펙 개정이 SP3 를 0010 으로 민다. 과제 14 가 대조한다.

### Task 3: 봇이 설정을 무시하는 두 건 — 마일스톤 키워드는 프로젝트 설정에서, 임베딩 차원은 상수로

항목: DC-05a, COV-07. UI 위험 파일 없음.

**Files:**
- Modify: `src/lib/repositories/types.ts`(`ProjectSettingsRepository` :360), `src/lib/repositories/supabase/settings.ts`, `src/lib/ai/tools/dashboard.ts`(:1-8 import, :51-54 시그니처, :101-104), `src/lib/ai/chat/default-registry.ts:62`, `src/lib/domain/dashboard.ts`(:60-66 `LEGACY_MILESTONE_KEYWORDS` 삭제), `src/app/(app)/p/[projectId]/dashboard/page.tsx:36`(주석), `src/lib/ai/projectFacts.ts:36`(주석), `src/lib/ai/provider.ts`(:79-82, :89-92), `src/lib/ai/embeddings.ts`(:29-35 주석·문구)
- Create: `tests/fixtures/milestoneKeywords.ts`
- Test: `tests/ai/tools-dashboard.test.ts`, `tests/ai/golden/fake-repositories.ts`, `tests/ai/golden/golden-questions.test.ts:67`, `tests/ai/tools-settings.test.ts`(가짜 settings 리포에 새 메서드), `tests/repositories/settings-read.test.ts`(어댑터), `tests/ai/brief.test.ts`·`tests/domain/dashboard.test.ts`(import 경로), `tests/ai/embeddings.test.ts`, `tests/ai/active-model-info.test.ts`

**Interfaces:**
```ts
// src/lib/repositories/types.ts — ProjectSettingsRepository 에 추가(공유 WbsProjectSnapshot 은 넓히지 않는다:
// 그 스냅샷을 쓰는 도구 6개에 쿼리와 새 실패 경로가 생기고 tests/repositories/core-read.test.ts:75 가 깨진다)
import type { ProjectConfig } from '@/lib/data/projectConfig'
getProjectConfig(projectId: string): Promise<RepositoryResult<ProjectConfig>>
// 오류 코드는 기존 'PROJECT_SETTINGS_READ_FAILED'(types.ts:51) — 새 union 멤버를 만들지 않는다.

// src/lib/ai/tools/dashboard.ts
export function createGetProjectDashboardTool(
  wbs: WbsBotRepository,
  meetings: MeetingBotRepository,
  settings: Pick<ProjectSettingsRepository, 'getProjectConfig'>,
): ReadOnlyBotTool<never>

// src/lib/ai/provider.ts — 단일 출처 src/lib/ai/index/types.ts:3 의 별칭
export const EMBED_DIM = KNOWLEDGE_EMBEDDING_DIMENSIONS   // 768

// tests/fixtures/milestoneKeywords.ts — src 에서 옮긴 테스트 전용 키워드
export const FIXTURE_MILESTONE_KEYWORDS: readonly string[]
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `grep -rn "LEGACY_MILESTONE_KEYWORDS" src tests` 로 사용처가 `ai/tools/dashboard.ts`·`domain/dashboard.ts`·`dashboard/page.tsx`(주석)·`tests/ai/brief.test.ts`·`tests/domain/dashboard.test.ts` 뿐인지 본다.

- [ ] **Step 1: 테스트 먼저 — 대시보드 도구 3건 + 어댑터 1건 + 임베딩 2건**

`tests/ai/tools-dashboard.test.ts`: 기존 호출 10곳(`:91-290`)에 세 번째 인자 `settingsRepository(FIXTURE_MILESTONE_KEYWORDS)` 를 넣는다. 기존 픽스처의 '중간보고회'·'착수보고'는 하루짜리 + 산출물 리프라 키워드와 무관하게 single-day 규칙으로 잡히므로 기대값은 그대로다. 파일 위쪽에 헬퍼와 새 describe 를 둔다.
```ts
import type { ProjectConfig } from '@/lib/data/projectConfig'
import type { ProjectSettingsRepository } from '@/lib/repositories/types'
import { detectMilestones } from '@/lib/domain/dashboard'
import { computeTree } from '@/lib/domain/rollup'
import { FIXTURE_MILESTONE_KEYWORDS } from '../fixtures/milestoneKeywords'

const config = (milestoneKeywords: readonly string[]): ProjectConfig => ({
  levelLabels: ['Phase', 'Task', 'Activity'], maxDepth: null, extraAxisLabel: null,
  milestoneKeywords: [...milestoneKeywords], excelProfile: {}, stageCredits: null,
})
function settingsRepository(keywords: readonly string[] | 'fail'): Pick<ProjectSettingsRepository, 'getProjectConfig'> {
  return {
    getProjectConfig: vi.fn(async () => keywords === 'fail'
      ? repositoryError<ProjectConfig>('PROJECT_SETTINGS_READ_FAILED', true)
      : repositoryOk(config(keywords))),
  }
}
// 여러 날에 걸치고 산출물이 없는 리프 하나 — single-day 규칙에 걸리지 않아 키워드만으로 판정된다.
const oneLeaf = (name: string): WbsProjectSnapshot => ({
  ...wbsSnapshot,
  items: [wbsSnapshot.items[0], {
    id: 'leaf-x', projectId: 'p1', parentId: 'phase-1', code: '1.9', sortOrder: 9, name, biz: null, deliverable: null,
    plannedStart: '2026-07-22', plannedEnd: '2026-07-29', weight: null, actualPct: 0, owners: [], isOwnerSplit: false, updatedAt: null,
  }],
})

describe('get_project_dashboard — 마일스톤 키워드는 프로젝트 설정(project_settings)에서', () => {
  it("키워드 ['논문 제출'] 이면 그 리프가 마일스톤이고, 화면과 같은 detectMilestones 결과다", async () => {
    const snap = oneLeaf('논문 제출')
    const tool = createGetProjectDashboardTool(wbsRepository(repositoryOk(snap)), meetingRepository(repositoryOk(meetingSnapshot)), settingsRepository(['논문 제출']))
    const result = await tool.execute({ projectId: 'p1' }, context)
    if (!result.ok) throw new Error('도구가 실패했다')
    const screen = detectMilestones(computeTree(snap.items, '2026-07-20', new Set(), { subActTeamOrder: new Map() }), '2026-07-20', ['논문 제출'])
    expect(result.result.facts).toMatchObject({ milestoneName: '논문 제출', milestoneDate: screen.date, milestoneDday: screen.dday })
  })
  it("createProject 기본 키워드에서 '승인' 리프는 마일스톤이 아니다 — 옛 원본 키워드 목록을 쓰지 않는다", async () => {
    const defaults = ['마일스톤', 'milestone', '킥오프', 'kick-off', '오픈', '완료보고'] // src/app/actions/project.ts:58
    const tool = createGetProjectDashboardTool(wbsRepository(repositoryOk(oneLeaf('승인'))), meetingRepository(repositoryOk(meetingSnapshot)), settingsRepository(defaults))
    const result = await tool.execute({ projectId: 'p1' }, context)
    if (!result.ok) throw new Error('도구가 실패했다')
    expect(result.result.facts).toMatchObject({ milestoneName: null })
  })
  it('설정을 못 읽으면 DATA_SOURCE_ERROR — 기본 키워드로 대신 답하지 않는다', async () => {
    const tool = createGetProjectDashboardTool(wbsRepository(repositoryOk(wbsSnapshot)), meetingRepository(repositoryOk(meetingSnapshot)), settingsRepository('fail'))
    const result = await tool.execute({ projectId: 'p1' }, context)
    expect(result).toMatchObject({ ok: false, error: { code: 'DATA_SOURCE_ERROR', repositoryErrorCode: 'PROJECT_SETTINGS_READ_FAILED' } })
  })
})
```
`tests/repositories/settings-read.test.ts`: 어댑터의 `getProjectConfig` 가 (a) 행이 있으면 소문자 키워드로 `repositoryOk`, (b) `project_settings` 조회 `error` 면 `{ ok: false, errorCode: 'PROJECT_SETTINGS_READ_FAILED', retryable: true }` 인지 본다(파일의 기존 가짜 클라이언트 관례를 따른다).
`tests/ai/embeddings.test.ts:55-61` 의 'EMBED_DIM 오버라이드 차원도 검증한다'를 뒤집는다.
```ts
  it('EMBED_DIM env 를 바꿔도 768 로 요청·검증한다 — DB 는 vector(768) 고정', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'k')
    vi.stubEnv('EMBED_DIM', '4')
    const fetchMock = vi.fn(async () => geminiOk([0.1, 0.2, 0.3, 0.4]))
    vi.stubGlobal('fetch', fetchMock)
    const out = await embedTexts(['hello'], 'RETRIEVAL_QUERY')
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).outputDimensionality).toBe(768)
    expect(out).toBeNull()
  })
```
`:15`·`:68` 의 `vi.stubEnv('EMBED_DIM', '')` 는 지운다. `tests/ai/active-model-info.test.ts:52` 는 `vi.stubEnv('EMBED_DIM', '1536')` 으로 바꾸고 `:65` 의 `embeddingDim` 768 단언을 그대로 둔다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ai/tools-dashboard.test.ts tests/repositories/settings-read.test.ts tests/ai/embeddings.test.ts tests/ai/active-model-info.test.ts` → FAIL(세 번째 인자·메서드 없음, 차원이 env 를 따른다).

- [ ] **Step 3: 구현**

`src/lib/repositories/supabase/settings.ts` — 로더를 하나로 유지하려고 `data/projectConfig.getProjectConfig(projectId, client)` 를 재사용한다(행 없음 = `DEFAULT_PROJECT_CONFIG`, 키워드 소문자화도 그 로더가 한다).
```ts
import { getProjectConfig as loadProjectConfig } from '@/lib/data/projectConfig'

    async getProjectConfig(projectId) {
      try {
        return repositoryOk(await loadProjectConfig(projectId, client))
      } catch (e) {
        // 조회 실패를 기본 설정으로 위장하지 않는다 — 봇이 화면과 다른 마일스톤을 답하게 된다(3원칙).
        console.error('[settings-repo] 프로젝트 설정 조회 실패:', e instanceof Error ? e.message : e)
        return repositoryError('PROJECT_SETTINGS_READ_FAILED', true)
      }
    },
```
`src/lib/ai/tools/dashboard.ts` — import 에서 `LEGACY_MILESTONE_KEYWORDS` 를 빼고, 세 번째 인자를 받는다. 스코프 검사(`:76`) 바로 뒤에서 설정을 읽는다.
```ts
      // 마일스톤 키워드는 화면(대시보드·WBS·브리핑)과 같은 프로젝트 설정에서 읽는다. 못 읽으면 실패로 올린다 —
      // 기본 키워드로 대신하면 화면과 다른 마일스톤을 조용히 답한다(3원칙). 프로젝트 접근·스코프 판정 뒤에 읽는다.
      const configResult = await settings.getProjectConfig(projectId)
      if (!configResult.ok) return repositoryFailure(configResult)
```
`:101-104` 의 주석 3줄과 호출은 `const milestone = detectMilestones(roots, calculationDate, configResult.data.milestoneKeywords)` 한 줄이 된다. `default-registry.ts:62` 는 `createGetProjectDashboardTool(repositories.wbs, repositories.meetings, repositories.settings)`. `tests/ai/golden/golden-questions.test.ts:67` 도 `repos.settings` 를 넘기고, `tests/ai/golden/fake-repositories.ts` 의 settings 가짜에 `getProjectConfig` 를 더한다(키워드는 `FIXTURE_MILESTONE_KEYWORDS`). `tests/ai/tools-settings.test.ts` 등 `ProjectSettingsRepository` 로 타입된 가짜는 tsc 가 알려 주는 곳마다 `getProjectConfig: vi.fn()` 을 더한다.

`LEGACY_MILESTONE_KEYWORDS` 를 `src/lib/domain/dashboard.ts:60-66` 에서 지우고 `tests/fixtures/milestoneKeywords.ts` 로 옮긴다.
```ts
/** 테스트 전용 마일스톤 키워드 — 옛 src 상수(LEGACY_MILESTONE_KEYWORDS)의 값. 런타임은 project_settings.milestone_keywords 를 쓴다. */
export const FIXTURE_MILESTONE_KEYWORDS: readonly string[] =
  ['착수보고', '중간보고', '보고회', '마스터 플랜', 'bmt', '최종 선정', '승인', '준공', 'kick-off', '킥오프']
```
`tests/ai/brief.test.ts:3,22`·`tests/domain/dashboard.test.ts:60` 이하는 import 를 `../fixtures/milestoneKeywords` 의 `FIXTURE_MILESTONE_KEYWORDS` 로 바꾼다(식별자 치환). 거짓 주석을 고친다. `dashboard/page.tsx:36` 은 "마일스톤 키워드 등 프로젝트 설정(project_settings) — 봇 대시보드 도구도 같은 로더를 쓴다"로, `projectFacts.ts:36` 은 "프로젝트 설정(project_settings)의 마일스톤 키워드"로 바꾼다(회귀 0 주장 삭제).

`src/lib/ai/provider.ts` — `import { KNOWLEDGE_EMBEDDING_DIMENSIONS } from '@/lib/ai/index/types'`(그 모듈은 타입만 import 하므로 순환이 없다) 후:
```ts
/** 임베딩 차원 — 768 고정. vector(768)(wbs_embeddings·minute_embeddings·ai_documents)과 ai_documents 의 embedding_dimensions CHECK,
 *  pgvector HNSW 2000차원 상한에 묶여 있다. 바꾸려면 마이그레이션과 전체 재색인이 필요하다(스펙 §5.4.5) — env 로 바꾸지 않는다. */
export const EMBED_DIM = KNOWLEDGE_EMBEDDING_DIMENSIONS
```
`:82`·`:92` 의 `dim: Number(process.env.EMBED_DIM) || 768` 를 `dim: EMBED_DIM` 으로, `:80-81`·`:89-90` 주석에서 "EMBED_DIM 으로 오버라이드 가능" 을 지운다(`dim` 필드는 `health.ts:80,115` 가 읽으므로 남긴다). `embeddings.ts:35` 문구는 `` `모델 '${cfg.model}' 이 ${cfg.dim}차원 축소(outputDimensionality/dimensions)를 지원하는지 확인하세요 — 차원은 vector(${cfg.dim}) 고정입니다.` `` 로 바꾼다. `scripts/embed-repair.mjs:46` 은 이미 상수라 그대로 둔다.

- [ ] **Step 4: 통과·회귀** — `npx vitest run tests/ai tests/repositories tests/domain/dashboard.test.ts --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "LEGACY_MILESTONE_KEYWORDS\|process.env.EMBED_DIM" src` → 0건.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/repositories/types.ts src/lib/repositories/supabase/settings.ts src/lib/ai/tools/dashboard.ts src/lib/ai/chat/default-registry.ts src/lib/domain/dashboard.ts "src/app/(app)/p/[projectId]/dashboard/page.tsx" src/lib/ai/projectFacts.ts src/lib/ai/provider.ts src/lib/ai/embeddings.ts tests/fixtures/milestoneKeywords.ts tests/ai/tools-dashboard.test.ts tests/ai/golden/fake-repositories.ts tests/ai/golden/golden-questions.test.ts tests/ai/brief.test.ts tests/domain/dashboard.test.ts tests/repositories/settings-read.test.ts tests/ai/tools-settings.test.ts tests/ai/embeddings.test.ts tests/ai/active-model-info.test.ts
git commit -m "fix(ai): 봇 대시보드가 프로젝트 마일스톤 키워드를 쓰고, 임베딩 차원은 768 상수로

봇은 원본 키워드 목록을 써서 새 프로젝트에서 '오픈'·'마일스톤' 리프는 화면에만, '승인'·'준공' 리프는 봇에만 마일스톤이었다
('0058 시드와 동일' 주석은 거짓). 설정 로더(data/projectConfig)를 settings 리포지토리로 재사용하고, 못 읽으면 도구 실패로 올린다.
EMBED_DIM env 는 바꿀 수 있어 보였지만 DB 는 vector(768) 고정이라 바꾸면 색인이 조용히 실패했다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: SMTP 트랜스포트 중립화 — Gmail 암묵 기본값 제거, 조용한 TLS 강등 금지

항목: P1-9a / H-SMTP. UI 위험 파일 없음.

**Files:**
- Modify: `src/lib/mail/transport.ts`, `.env.local.example`(메일 블록 :75-81 만), `README.md:45`
- Test: `tests/mail/transport.test.ts`
- (선택, 별도 커밋) `supabase/config.toml` 의 `[inbucket]` `smtp_port = 54325` 주석 해제

**Interfaces:**
```ts
// src/lib/mail/transport.ts
export type SmtpSettings = {
  host: string; port: number; secure: boolean; requireTLS: boolean
  auth: { user: string; pass: string } | null
  fromAddress: string
}
/** env → SMTP 설정(순수, 호출 시점에 읽는다). 실패 사유(reason)는 키 이름을 담는 서버 로그 전용이다. */
export function resolveSmtpSettings(env: Record<string, string | undefined>):
  | { ok: true; settings: SmtpSettings }
  | { ok: false; kind: 'unset' | 'invalid'; reason: string }
export function getTransport(): Transport   // 시그니처 불변. ok:false 문구는 아래 둘 중 하나
export const SMTP_NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
export const SMTP_MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'
```
규칙(종합 문서 과제 5 그대로):
- `SMTP_HOST` 가 없으면 `unset`. Gmail 기본값은 없다.
- `SMTP_PORT` 는 `^\d+$` 이고 1–65535, `SMTP_SECURE` 는 `'true'|'false'` 만 허용한다. `SMTP_SECURE` 만 있으면 포트는 465/587, `SMTP_PORT` 만 있으면 `secure = port===465`, 둘 다 없으면 587·STARTTLS.
- 465+false, 587·25+true 는 `invalid`(1025·2525 평문은 허용 — 로컬 inbucket·MailHog).
- `SMTP_AUTH` 는 비었거나 정확히 `'none'`. `none` 이면 user/pass 가 비어 있어야 하고 `SMTP_FROM_ADDRESS` 가 필수다. 아니면 user/pass 둘 다 필요하다(둘 다 없으면 `unset`, 하나만이면 `invalid`).
- 인증이 있고 `secure=false` 면 `requireTLS: true`. `tls.rejectUnauthorized=false` 는 절대 넣지 않는다.
- From 은 `SMTP_FROM_ADDRESS`, 없으면 `SMTP_USER` 가 이메일 형식일 때만(`recipients.ts:24` `isValidEmail`). 둘 다 안 되면 `invalid`.
- 사용자에게는 두 문구 중 하나, 서버 로그에는 `[mail] SMTP 설정 오류: <reason>`(비밀번호는 로그에 넣지 않는다). 반환 문자열에 `SMTP_` 가 없다.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `git status --porcelain .env.local.example README.md src/lib/mail` 이 비어 있다. 비어 있지 않으면 멈춘다(다른 작업의 미커밋 hunk 가 섞여 있으면 파일 단위 stage 가 그것까지 싣는다).

- [ ] **Step 1: 테스트 먼저 — `tests/mail/transport.test.ts` 재작성**

`beforeEach` 에서 새 env 를 모두 `''` 로 스텁한다(개발자 셸의 env 가 새지 않게). `:31-40` 의 Gmail 고정 케이스는 "명시 호스트" 케이스로 바꾼다. 발신 표시명·rejected 케이스(`:42-80`)는 env 에 `SMTP_HOST`·`SMTP_PORT` 를 더해 그대로 유지한다(`from.address` 는 `SMTP_USER` 가 이메일이라 같다).
```ts
const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_AUTH', 'SMTP_FROM_ADDRESS', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM_NAME']
const env = (over: Record<string, string>) => { for (const k of KEYS) vi.stubEnv(k, over[k] ?? '') }
beforeEach(() => { createTransport.mockClear(); sendMail.mockReset(); env({}) })

it('SMTP_HOST 가 없으면 설정되지 않음 — Gmail 로 가지 않는다', () => {
  env({ SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
  expect(getTransport()).toEqual({ ok: false, error: '메일 발송이 설정되지 않았습니다.' })
  expect(createTransport).not.toHaveBeenCalled()
})
it('포트·보안이 없으면 587 STARTTLS 이고 인증이 있으면 requireTLS', () => {
  env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw' })
  expect(getTransport().ok).toBe(true)
  const opts = createTransport.mock.calls[0][0]
  expect(opts).toMatchObject({ host: 'smtp.example.com', port: 587, secure: false, requireTLS: true, auth: { user: 'a@example.com', pass: 'pw' } })
  expect(opts).not.toHaveProperty('tls')
})
it('465 는 secure', () => { /* SMTP_PORT=465 → secure:true, requireTLS 없음(false) */ })
it('SMTP_AUTH=none + 1025 평문 — auth 키가 없고 발신 주소가 필수', () => {
  env({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: 'noreply@example.com' })
  expect(getTransport().ok).toBe(true)
  const opts = createTransport.mock.calls[0][0]
  expect(opts).not.toHaveProperty('auth')
  expect(opts).toMatchObject({ port: 1025, secure: false, requireTLS: false })
})
it.each([
  [{ SMTP_PORT: '0' }], [{ SMTP_PORT: '70000' }], [{ SMTP_PORT: 'abc' }], [{ SMTP_SECURE: 'yes' }],
  [{ SMTP_PORT: '465', SMTP_SECURE: 'false' }], [{ SMTP_PORT: '587', SMTP_SECURE: 'true' }], [{ SMTP_AUTH: 'login' }],
  [{ SMTP_PASS: '' }],                                    // 부분 인증
  [{ SMTP_USER: 'apikey', SMTP_FROM_ADDRESS: '' }],      // 이메일이 아닌 USER + 발신 주소 없음
  [{ SMTP_AUTH: 'none', SMTP_FROM_ADDRESS: '' , SMTP_USER: '', SMTP_PASS: '' }],
])('잘못된 설정 %o 은 invalid — 문구에 키 이름이 없고, 키 이름은 로그에만', (over) => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  env({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@example.com', SMTP_PASS: 'pw', ...over })
  const tx = getTransport()
  expect(tx).toEqual({ ok: false, error: '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.' })
  expect(JSON.stringify(tx)).not.toContain('SMTP_')
  expect(err.mock.calls.flat().join(' ')).toMatch(/SMTP_/)
  expect(createTransport).not.toHaveBeenCalled()
  err.mockRestore()
})
it('SMTP_FROM_ADDRESS 가 발신 주소를 정한다', async () => { /* from.address === SMTP_FROM_ADDRESS */ })
```
(주석으로 남긴 두 케이스도 위와 같은 모양으로 채운다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/mail/transport.test.ts` → FAIL.

- [ ] **Step 3: 구현 — `src/lib/mail/transport.ts`**

```ts
import { isValidEmail } from './recipients'

export const SMTP_NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
export const SMTP_MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'

export function resolveSmtpSettings(env: Record<string, string | undefined>):
  | { ok: true; settings: SmtpSettings }
  | { ok: false; kind: 'unset' | 'invalid'; reason: string } {
  const v = (k: string) => env[k]?.trim() ?? ''
  const invalid = (reason: string) => ({ ok: false as const, kind: 'invalid' as const, reason })
  const host = v('SMTP_HOST')
  if (!host) return { ok: false, kind: 'unset', reason: 'SMTP_HOST 없음' }
  const portRaw = v('SMTP_PORT'), secureRaw = v('SMTP_SECURE'), authRaw = v('SMTP_AUTH')
  const user = v('SMTP_USER'), pass = v('SMTP_PASS'), fromRaw = v('SMTP_FROM_ADDRESS')

  if (secureRaw && secureRaw !== 'true' && secureRaw !== 'false') return invalid('SMTP_SECURE 는 true|false 만')
  if (portRaw && !/^\d+$/.test(portRaw)) return invalid('SMTP_PORT 가 숫자가 아님')
  const portNum = portRaw ? Number(portRaw) : null
  if (portNum !== null && (portNum < 1 || portNum > 65535)) return invalid('SMTP_PORT 범위(1-65535) 밖')
  const secure = secureRaw ? secureRaw === 'true' : portNum === 465
  const port = portNum ?? (secure ? 465 : 587)
  if (port === 465 && !secure) return invalid('SMTP_PORT 465 는 SMTP_SECURE=true')
  if ((port === 587 || port === 25) && secure) return invalid(`SMTP_PORT ${port} 는 SMTP_SECURE=false(STARTTLS)`)
  if (authRaw && authRaw !== 'none') return invalid('SMTP_AUTH 는 비우거나 none')

  let auth: SmtpSettings['auth'] = null
  if (authRaw === 'none') {
    if (user || pass) return invalid('SMTP_AUTH=none 이면 SMTP_USER·SMTP_PASS 를 비운다')
    if (!fromRaw) return invalid('SMTP_AUTH=none 이면 SMTP_FROM_ADDRESS 필수')
  } else {
    if (!user && !pass) return { ok: false, kind: 'unset', reason: 'SMTP_USER·SMTP_PASS 없음(무인증 릴레이는 SMTP_AUTH=none)' }
    if (!user || !pass) return invalid('SMTP_USER·SMTP_PASS 는 둘 다 필요')
    auth = { user, pass }
  }
  const fromAddress = fromRaw || (isValidEmail(user) ? user : '')
  if (!fromAddress || !isValidEmail(fromAddress)) return invalid('발신 주소 없음(SMTP_FROM_ADDRESS 또는 이메일 형식 SMTP_USER)')
  return { ok: true, settings: { host, port, secure, requireTLS: auth !== null && !secure, auth, fromAddress } }
}

/**
 * SMTP 트랜스포트 — 공급자 중립(회사 SMTP·Gmail·로컬 inbucket 모두 env 로). 설정이 없거나 잘못되면 **throw 하지 않고**
 * ok:false 를 낸다 — 로컬·Preview 에서 화면을 죽이지 않기 위해서다. `from` 은 이 모듈이 소유한다(호출자가 바꿀 수 없다).
 * env 는 호출 시점에 읽는다(fromName.ts 와 같은 관례). 오류의 키 이름은 서버 로그에만 — 반환 문구는 사용자에게 그대로 뜬다.
 */
export function getTransport(): Transport {
  const r = resolveSmtpSettings(process.env)
  if (!r.ok) {
    if (r.kind === 'invalid') console.error('[mail] SMTP 설정 오류:', r.reason)
    return { ok: false, error: r.kind === 'unset' ? SMTP_NOT_CONFIGURED : SMTP_MISCONFIGURED }
  }
  const s = r.settings
  const fromName = mailFromName()
  const tx = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    requireTLS: s.requireTLS,
    ...(s.auth ? { auth: s.auth } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })
  // send 는 종전 그대로 — from.address 만 s.fromAddress 로
```
`send` 안의 `from: { name: fromName, address: user }` 를 `address: s.fromAddress` 로 바꾼다. `MAIL_FROM_NAME`·`fromName.ts` 는 그대로다(SP3 에서 `branding.mail_from_name` 으로 옮긴다).

- [ ] **Step 4: 문서** — `.env.local.example` 메일 블록(:75-81)을 공급자 중립으로 바꾼다. 제목은 `# ── 메일 발송(회의 안내·프로젝트 초대) — SMTP ──` 로 한다. 키는 `SMTP_HOST= / SMTP_PORT= / SMTP_SECURE= / SMTP_AUTH= / SMTP_USER= / SMTP_PASS= / SMTP_FROM_ADDRESS=` 순서로 적고 주석으로 규칙 한 줄씩을 단다. 예시는 주석으로만 둔다: Gmail(`smtp.gmail.com` / 465 / true + 앱 비밀번호)과 로컬 inbucket(`127.0.0.1` / 54325 / false / `SMTP_AUTH=none` / `SMTP_FROM_ADDRESS=noreply@example.com` — `supabase/config.toml` 의 `smtp_port` 주석 해제 후 `npm run db:stop && npm run db:start`, 수신함은 http://127.0.0.1:54324). `MAIL_FROM_NAME`·`NEXT_PUBLIC_APP_URL` 줄은 그대로다. `scripts/lib/targets.mjs` 의 `localEnvFromStatus` 에는 넣지 않는다(`env:local` 이 개발자의 실제 SMTP 값을 덮어쓴다). `README.md:45` 항목은 "`SMTP_HOST`·`SMTP_PORT`·`SMTP_SECURE`·`SMTP_AUTH`·`SMTP_USER`·`SMTP_PASS`·`SMTP_FROM_ADDRESS`·`MAIL_FROM_NAME` — 회의 안내·초대 메일(공급자 중립 SMTP). `SMTP_HOST` 가 없으면 발송 액션이 throw 하지 않고 `{ ok: false }`" 로 바꾼다.

- [ ] **Step 5: 통과·회귀** — `npx vitest run tests/mail tests/actions --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint`(`tests/actions/project-invites-gate.test.ts` 는 `getTransport` 를 mock 하므로 그대로 통과해야 한다). `grep -rn "smtp.gmail.com" src` → 0건.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/mail/transport.ts tests/mail/transport.test.ts .env.local.example README.md
git commit -m "fix(mail): SMTP 를 공급자 중립으로 — Gmail 암묵 기본값을 없애고 TLS 가 조용히 내려가지 않게

smtp.gmail.com:465 고정이라 회사 SMTP 나 로컬 inbucket 을 쓸 수 없었다. SMTP_HOST 가 필수이고(없으면 종전 ok:false),
포트·보안·인증은 명시값을 엄격히 읽는다. 인증이 있는데 secure=false 면 requireTLS 로 평문 로그인을 막는다.
무인증 릴레이는 SMTP_AUTH=none 을 명시할 때만. 설정 오류의 키 이름은 서버 로그에만 남긴다.
로컬 .env.local 이 Gmail 을 쓰고 있었다면 SMTP_HOST=smtp.gmail.com 을 더해야 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(선택) `supabase/config.toml` 의 `# smtp_port = 54325` 주석 해제는 별도 커밋 `chore(local): inbucket SMTP 포트 54325 를 연다` 로 한다(마이그레이션 아님).

### Task 9: 대시보드 데이터 표시 정직화 (+ 후보 2 보고서 라우트, 후보 7 헤더 티커 로더)

항목: D5-§1-Dashboard, D5-§8-partial-error, §6 후보 2·7. UI 위험 파일 없음(`src/components/dashboard/*`·`src/components/ui/*`·`src/app/api/shell/route.ts`). 과제 3 다음이다(`dashboard/page.tsx:36`·`projectFacts.ts:36` 주석을 과제 3 이 고친다). 후보 7 의 **화면 쪽**(`ShellStateProvider`·`HeaderAnnouncementTicker`)은 UI 위험이라 과제 12 가 한다. 이 과제는 셸 라우트 응답에 필드만 더한다(구 클라이언트는 무시해도 깨지지 않는 추가 필드).

**Files:**
- Modify(로더): `src/lib/data/issues.ts`(`getIssuesForDashboard` :138-160), `src/lib/data/snapshots.ts`(`getSnapshots` :12-30), `src/lib/data/announcements.ts`(`getAnnouncements`·`getTopAnnouncements`), `src/lib/data/meetings.ts`(`getProjectMeetingData` :101-)
- Modify(소비처): `src/app/(app)/p/[projectId]/dashboard/page.tsx`, `src/components/dashboard/DashboardView.tsx`, `src/components/dashboard/ExecSummary.tsx`(공지 링크 제거), `src/components/dashboard/TrendChart.tsx`, `src/components/dashboard/SpiPanel.tsx`, `src/lib/ai/projectFacts.ts`, `src/app/(app)/p/[projectId]/meetings/page.tsx`, `src/app/(app)/p/[projectId]/announcements/page.tsx`, `src/app/actions/minutes.ts`(`fetchProjectMeetingsLite` :874-881), `src/components/minutes/MinuteMetaModal.tsx`·`MinuteUploadModal.tsx`(회의 드롭다운 오류 한 줄), `src/app/api/report/route.ts`, `src/app/actions/announcements.ts`(`getHeaderAnnouncements`), `src/app/api/shell/route.ts`, `src/lib/i18n/dict/dashboard{,.en}.ts`·`common{,.en}.ts`·`minutes{,.en}.ts`
- Create: `src/components/ui/LoadErrorNotice.tsx`, `src/components/dashboard/AnnouncementStrip.tsx`
- Test: `tests/lib/issues-dashboard-loader.test.ts`(뒤집기), `tests/lib/meetings-exception-embed.test.ts`(반환 모양), `tests/ui/dashboard-page-hidden-project.test.tsx`(mock 반환 모양), `tests/components/dashboard-view-partial.test.tsx`(신설), `tests/api/report-route.test.ts`(목록 판정 + 공지·회의 실패), `tests/api/shell-route.test.ts`(신설 — 셸 라우트 테스트가 아직 없다), `tests/ui/minute-meta-modal*.test.tsx`·`tests/ui/minute-upload-modal.test.tsx`(mock 반환 모양), `tests/lib/snapshots.test.ts`·`tests/lib/announcements.test.ts`(신설 — 성공·실패 두 케이스, `issues-dashboard-loader.test.ts` 의 PostgREST 체인 스텁 관례)

**Interfaces:**
```ts
// 로더는 members.ts:17-38 관례 — 실패를 결과로 돌려준다. 변형 로더나 [] 래퍼를 만들지 않는다.
export const ERR_ISSUES_LOAD = '이슈를 불러오지 못했습니다.'
export const getIssuesForDashboard: (projectId: string) =>
  Promise<{ ok: true; rows: DashboardIssue[] } | { ok: false; error: string }>
export const ERR_SNAPSHOTS_LOAD = '진척 이력을 불러오지 못했습니다.'
export function getSnapshots(projectId: string): Promise<{ ok: true; rows: SnapshotPoint[] } | { ok: false; error: string }>
export const ERR_ANNOUNCEMENTS_LOAD = '공지를 불러오지 못했습니다.'
export const getAnnouncements: (projectId: string) =>
  Promise<{ ok: true; rows: Announcement[] } | { ok: false; error: string }>
export const getTopAnnouncements: (projectId: string, limit?: number) =>
  Promise<{ ok: true; rows: AnnouncementSummary[] } | { ok: false; error: string }>
export const ERR_MEETINGS_LOAD = '회의 일정을 불러오지 못했습니다.'
export const getProjectMeetingData: (projectId: string) =>
  Promise<{ ok: true; meetings: Meeting[]; exceptions: MeetingException[] } | { ok: false; error: string }>
// (getMeetingRowExtras :235-246 의 메모·참석자 강등은 의도된 부분 표시라 그대로 둔다.)

// src/app/actions/announcements.ts
export async function getHeaderAnnouncements(projectId: string):
  Promise<{ ok: true; rows: AnnouncementSummary[] } | { ok: false; error: string }>   // 비로그인 = { ok: true, rows: [] }
// src/app/actions/minutes.ts
export async function fetchProjectMeetingsLite(projectId: string):
  Promise<{ ok: true; meetings: { id: string; title: string; meetingDate: string }[] } | { ok: false; error: string }>
// src/app/api/shell/route.ts 응답 — 필드 추가(과제 12 가 소비)
{ …기존, headerAnnouncements: AnnouncementSummary[], headerAnnouncementsFailed: boolean }

// src/components/ui/LoadErrorNotice.tsx ('use client') — role="alert" + 선택적 재시도(router.refresh())
export function LoadErrorNotice({ message, retry = true }: { message: string; retry?: boolean }): JSX.Element
// src/components/dashboard/AnnouncementStrip.tsx — ExecSummary 의 공지 링크(:67-69, :103-111)를 떼어 WBS 없이도 보이게
export function AnnouncementStrip({ projectId, announcements, today }: { projectId: string; announcements: Announcement[]; today: string }): JSX.Element | null
// DashboardView props — 실패를 구분해 받는다
announcements: Announcement[] | null      // null = 조회 실패(annError 문구는 ERR_ANNOUNCEMENTS_LOAD)
snapshots: SnapshotPoint[]; historyFailed: boolean
meetings: Meeting[] | null; meetingExceptions: MeetingException[]
issues: DashboardIssue[] | null
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 3 이 HEAD 에 있다(`grep -rn "LEGACY_MILESTONE_KEYWORDS" src` → 0건). `grep -rn "getSnapshots(\|getProjectMeetingData(\|getIssuesForDashboard(\|getAnnouncements(\|getTopAnnouncements(\|fetchProjectMeetingsLite(\|getHeaderAnnouncements(" src tests` 결과를 적어 둔다(이 과제가 바꿀 소비처 전부 — 계획 작성 시점: 대시보드·회의·공지 화면, 보고서 라우트, `projectFacts.ts`, `actions/minutes.ts`, 셸 라우트, 회의록 모달 2개, 테스트 5개).

- [ ] **Step 1: 로더 테스트 먼저(1단계 이슈·2단계 스냅샷)**

`tests/lib/issues-dashboard-loader.test.ts:50-57` 를 뒤집는다: 조회 실패 → `{ ok: false, error: '이슈를 불러오지 못했습니다.' }` + 로그 1회. 성공 케이스는 `.rows` 로 읽는다. 스냅샷 로더도 같은 모양의 두 케이스(성공 → `{ ok: true, rows }`, 실패 → `{ ok: false, error: ERR_SNAPSHOTS_LOAD }` + 로그)를 둔다.

`tests/components/dashboard-view-partial.test.tsx`(신설): `DashboardView` 는 async 서버 컴포넌트라 `renderToStaticMarkup` 을 바로 쓸 수 없다. `await DashboardView(props)` 가 돌려준 요소 트리를 순회해 자식 컴포넌트의 **타입**(함수 참조)을 모은다. `@/lib/teams/master`(`teamsForProjectSync` 를 `vi.fn` 으로 — 호출 여부를 본다)와 `@/lib/i18n/server`(`'ko'`)를 mock 한다.
```ts
import { isValidElement, type ReactElement, type ReactNode } from 'react'
const typesIn = (node: ReactNode, out = new Set<unknown>()): Set<unknown> => {
  if (Array.isArray(node)) node.forEach(n => typesIn(n, out))
  else if (isValidElement(node)) {
    out.add(node.type)
    typesIn((node as ReactElement<{ children?: ReactNode }>).props.children, out)
  }
  return out
}
```
케이스:
- (a) `items=[]` + 이슈 1건 → `EmptyState` 없음, `IssueStatusCard`·`MilestoneTimeline`·`AnnouncementStrip` 있음, `ExecSummary`·`TrendChart`·`TeamProgress`·`RiskWorklist` 없음, `teamsForProjectSync` 미호출.
- (b) 네 데이터셋(WBS·이슈·공지·회의)이 모두 비었을 때만 `EmptyState` 하나.
- (c) 정상 회귀: 기존 카드가 모두 있다.
- (d) `issues=null` → `IssueStatusCard`·`IssueTrendCard`·`IssueQueueCard` 대신 `LoadErrorNotice`(message = `ERR_ISSUES_LOAD`), `historyFailed=true` → `TrendChart` 에 `historyFailed` prop 이 전달된다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/lib/issues-dashboard-loader.test.ts tests/components/dashboard-view-partial.test.tsx` → FAIL.

- [ ] **Step 3: 구현 — 로더 1·2단계 + 대시보드 뷰**

`getIssuesForDashboard`·`getSnapshots` 를 결과형으로 바꾼다(실패: `console.error` 후 `{ ok: false, error: ERR_* }`). `getSnapshots` 의 "합성 추세선" 주석(`:18-22`)은 "실패를 결과로 돌려준다 — 추세선을 합성하지 않게 화면이 이력 실패를 안다"로 바꾼다. `src/components/ui/LoadErrorNotice.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 조회 실패 표시 — 위젯 자리에 '0건'·'데이터 없음' 대신 사유와 재시도를 둔다(에러 처리 3원칙 ①).
 *  message 는 로더의 ERR_* 문구(members.ts 의 ERR_ROSTER_LOAD 와 같은 관례). */
export function LoadErrorNotice({ message, retry = true }: { message: string; retry?: boolean }) {
  const router = useRouter()
  const { t } = useLocale()
  return (
    <div role="alert" data-load-error className="flex items-center justify-between gap-3 rounded-xl bg-delayed-weak px-4 py-3 text-sm text-delayed">
      <span>{message}</span>
      {retry && (
        <button type="button" onClick={() => router.refresh()} className="btn btn-ghost h-8 shrink-0 px-3 text-xs">
          <RotateCw className="h-3.5 w-3.5" /> {t('common.retry')}
        </button>
      )}
    </div>
  )
}
```
i18n `common.retry`('다시 시도' / 'Retry')를 `src/lib/i18n/dict/common{,.en}.ts` 에 더한다.
`dashboard/page.tsx`: 이슈·스냅샷 결과를 결과형으로 받아 뷰에 넘긴다 — `issues={issuesRes.ok ? issuesRes.rows : null}`, `snapshots={snapRes.ok ? snapRes.rows : []} historyFailed={!snapRes.ok}`(공지·회의는 Step 7 에서 `announcements={annRes.ok ? annRes.rows : null}`, `meetings={meetRes.ok ? meetRes.meetings : null} meetingExceptions={meetRes.ok ? meetRes.exceptions : []}` 로 바뀐다). `:39-42` 주석은 "WBS 가 비어도 회의·이슈·공지는 그린다 — 팀 캐시(teamsForProjectSync)는 WBS 가 있을 때만 읽는다(DashboardView)"를 더해 갱신한다.

`DashboardView.tsx`:
- `const hasWbs = items.length > 0`. `overallProgress`·`buildTrend`·`teamsForProjectSync`(`:81`,`:116` 두 곳)·`ExecSummary`·`TrendChart`/`SpiPanel`·`TeamProgress`·`RiskWorklist` 는 `hasWbs` 일 때만 계산·렌더한다.
- 조기 return(`:76-78`)을 지운다. 대신 `!hasWbs && issues !== null && issues.length === 0 && announcements.length === 0 && meetings.length === 0` 일 때만 전체 `EmptyState` 를 돌려준다(실패한 데이터셋은 '빈 것'으로 치지 않는다 — `null` 이면 그 자리에 오류가 보여야 한다. 공지·회의의 `null` 은 Step 7 에서 이 조건에 더해진다).
- **`MilestoneTimeline` 은 항상 렌더한다**(WBS 가 없으면 WBS 리프 없이 공지 마일스톤만 — `milestoneTimeline` 은 `hasWbs` 일 때만 부른다).
- `AnnouncementStrip` 을 `ExecSummary` 위에 둔다(WBS 없이도 보인다). `ExecSummary.tsx` 의 `notice` 계산·링크(`:67-69`, `:103-111`)와 `announcements` prop 은 지운다.
- WBS 자리(`!hasWbs`)에는 인라인 빈 카드(`tr('dash.wbsEmpty')` + `/p/${projectId}/wbs` 링크)를 둔다. `!hasWbs` 면 `IssueQueueCard` 는 전체 폭이다.
- `issues === null` 이면 이슈 섹션(E)과 이슈 큐 자리에 `LoadErrorNotice message={ERR_ISSUES_LOAD}`(총 0건 칩도 없다).
- 이 단계에서 `announcements`·`meetings` prop 은 옛 모양(배열)을 유지한다 — 로더가 3단계에서 결과형이 되고 `null` 분기도 그때 더한다. 그래야 1·2단계 커밋이 typecheck 초록으로 선다.
- `TrendChart`·`SpiPanel` 에 `historyFailed` 를 넘긴다. `TrendChart` 는 `historyFailed` 면 합성된 실적 선(`model.actualSeries`)을 그리지 않고, `dash.trend.noHistory` 대신 `<p role="alert" className="text-[11px] text-delayed">{tr('dash.trend.historyFailed')}</p>` 를 보인다. `SpiPanel` 은 `historyFailed` 면 주간 속도·추세 줄 대신 같은 문구를 보인다(현재 SPI 는 계획·실적으로 계산하므로 유지).
- i18n(ko·en 양쪽): `dash.wbsEmpty`('WBS 가 아직 없습니다 — WBS 화면에서 추가하거나 가져오세요.' / 'No WBS yet — add or import it on the WBS page.'), `dash.trend.historyFailed`('진척 이력을 불러오지 못해 추세선을 그리지 않았습니다.' / 'Progress history could not be loaded, so the trend line is hidden.').

`projectFacts.ts`: 스냅샷·회의 결과가 `ok:false` 면 `throw new Error('[projectFacts] ' + error)` — 파일 머리 주석대로 호출측(액션)이 잡아 `unavailable` 로 강등한다(`:6`). 명시적 unavailable 이 되는지 기존 `tests/ai/*brief*` 가 다루지 않으면, 스냅샷 실패 → `loadProjectFacts` reject 케이스를 하나 더한다.

- [ ] **Step 4: 통과 + 1·2단계 커밋**

Run: `npx vitest run tests/lib tests/components/dashboard-view-partial.test.tsx tests/ui/dashboard-page-hidden-project.test.tsx tests/ai --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint`(`dashboard-page-hidden-project.test.tsx` 의 mock 반환을 결과형으로 바꾼다).
```bash
git add src/lib/data/issues.ts src/lib/data/snapshots.ts src/components/ui/LoadErrorNotice.tsx src/components/dashboard/AnnouncementStrip.tsx src/components/dashboard/DashboardView.tsx src/components/dashboard/ExecSummary.tsx src/components/dashboard/TrendChart.tsx src/components/dashboard/SpiPanel.tsx "src/app/(app)/p/[projectId]/dashboard/page.tsx" src/lib/ai/projectFacts.ts src/lib/i18n/dict/dashboard.ts src/lib/i18n/dict/dashboard.en.ts src/lib/i18n/dict/common.ts src/lib/i18n/dict/common.en.ts tests/lib/issues-dashboard-loader.test.ts tests/lib/snapshots.test.ts tests/components/dashboard-view-partial.test.tsx tests/ui/dashboard-page-hidden-project.test.tsx
git commit -m "fix(dashboard): WBS 가 비어도 회의·이슈·공지를 그리고, 이슈·이력 조회 실패를 0건으로 위장하지 않는다

WBS 0건이면 화면 전체가 빈 상태 하나라 이슈·회의·공지가 가려졌다. 이슈 조회 실패는 '이슈 없음', 스냅샷 실패는
'이력은 지금부터 기록됩니다' + 합성 추세선으로 보였다. 로더가 실패를 결과로 돌려주고 위젯 자리에 사유·재시도를 둔다.
WBS 가 없으면 팀 캐시를 읽지 않는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
(이 커밋 시점에 공지·회의 로더는 아직 옛 모양이다 — `page.tsx` 는 `announcements`·`meetingData` 를 그대로 넘긴다.)

- [ ] **Step 5: 3단계 테스트 먼저 — 공지·회의 로더, 소비처, 보고서 라우트(후보 2), 셸(후보 7)**

- `tests/lib/meetings-exception-embed.test.ts:77-105`: 반환을 결과형으로 읽는다. 재시도까지 실패(`embed-fail-twice`) → `{ ok: false, error: ERR_MEETINGS_LOAD }`.
- 공지 로더: `getAnnouncements`·`getTopAnnouncements` 성공·실패 두 케이스씩.
- `tests/api/report-route.test.ts` — **후보 2**. `@/app/actions/project` mock 에 `listProjectsWithState` 를 더하고 `listProjects` 를 뺀다. 추가 케이스: (a) 목록에 없는 pid → 404 이고 `getComputedWbs`·`getProjectRoster`·`getAnnouncements` 미호출(판정이 조회보다 먼저), (b) `degraded: true` + 목록에 없음 → 500(조회 실패를 404 로 위장하지 않는다), (c) `source=sheet` 분기도 (a)·(b) 와 같다, (d) 공지 `{ ok: false }` → 503, (e) 회의 `{ ok: false }` → 503.
- 셸 라우트(`tests/api/shell-route.test.ts`, 신설 — `@/app/actions/{inbox,notifications,announcements}`·`@/lib/data/agentApprovals` 를 mock): `getHeaderAnnouncements` 가 `{ ok: false }` 면 응답이 `headerAnnouncements: []`, `headerAnnouncementsFailed: true`. 던지면 로그 후 같은 결과. 성공이면 `headerAnnouncementsFailed: false`.

- [ ] **Step 6: 실패 확인** — 위 파일들 FAIL.

- [ ] **Step 7: 구현 — 3단계**

- 로더 둘(`getAnnouncements`·`getTopAnnouncements`)과 `getProjectMeetingData` 를 결과형으로 바꾼다(`selectMeetings` 의 재시도까지 실패하면 `{ ok: false, error: ERR_MEETINGS_LOAD }`).
- 소비처:
  - 대시보드 `page.tsx`: 실패면 뷰에 `null` 로 넘긴다. `DashboardView` 의 `announcements`·`meetings` prop 타입을 `… | null` 로 바꾸고 분기를 더한다 — 공지가 `null` 이면 공지 마일스톤 없이 타임라인을 그리고 `AnnouncementStrip` 자리에 `LoadErrorNotice message={ERR_ANNOUNCEMENTS_LOAD}`, 회의가 `null` 이면 `MeetingSchedule` 자리에 `LoadErrorNotice message={ERR_MEETINGS_LOAD}`. 전체 `EmptyState` 조건에 `announcements !== null && meetings !== null` 을 더한다. `tests/components/dashboard-view-partial.test.tsx` 에 공지 `null`·회의 `null` 케이스를 하나씩 더한다.
  - `meetings/page.tsx:30`: 실패면 `ProjectPageShell pinned={<LoadErrorNotice message={ERR_MEETINGS_LOAD} />}` 로 두고 일정·KPI 는 빈 목록으로 그리되 KPI 값을 `'—'` 로 둔다.
  - `announcements/page.tsx:18`: 같은 방식이다. 목록 자리에 `LoadErrorNotice`, KPI 는 `'—'`.
  - `projectFacts.ts`: `ok:false` 면 throw.
  - `actions/minutes.ts` `fetchProjectMeetingsLite`: 결과형으로 바꾼다. 비로그인이면 `{ ok: true, meetings: [] }`.
  - `MinuteMetaModal.tsx:58,100`·`MinuteUploadModal.tsx:99,152`: 실패면 회의 드롭다운 아래에 `<p role="alert" className="text-xs text-delayed">{t('minutes.meetingsLoadFailed')}</p>` 를 보인다(i18n ko·en 추가: '회의 목록을 불러오지 못했습니다 — 새로고침하세요.' / 'Could not load meetings — refresh the page.'). 테스트 mock 3개는 `{ ok: true, meetings: [] }` 로 바꾼다.
- **후보 7**: `getHeaderAnnouncements` 는 `getTopAnnouncements` 결과를 그대로 돌려준다(비로그인은 `{ ok: true, rows: [] }`). `api/shell/route.ts:28` 은 다음으로 바꾼다.
  ```ts
  route ? getHeaderAnnouncements(route).catch((e: unknown) => {
    console.error('[shell] 헤더 공지 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false as const, error: '' }
  }) : Promise.resolve({ ok: true as const, rows: [] }),
  ```
  응답은 `headerAnnouncements: header.ok ? header.rows : []`, `headerAnnouncementsFailed: !header.ok` 다.
- **후보 2** — `api/report/route.ts`:
  - `listProjects` 대신 `listProjectsWithState` 를 쓰고, 프로젝트 판정을 **다른 조회보다 먼저** 한다. `export/route.ts:19-27` 과 같은 순서·문구다(없으면 404, `degraded` 면 500).
  - 그 뒤 `Promise.all` 에서 `listProjects()` 를 뺀다. `source=sheet` 분기(`:64-66`)도 같은 판정을 먼저 한다.
  - 공지·회의가 `ok:false` 면 명단(`:95-98`)처럼 로그 후 503 이다.
  - `activeTeamCodesForProjectSync` 는 판정 뒤에만 읽는다(이미 그렇다 — 순서를 유지).

- [ ] **Step 8: 통과·회귀** — `npx vitest run --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "listProjects()" src/app/api` → 0건.

- [ ] **Step 9: 로컬 확인(UI 위험 파일 아님 — 동작 확인)** — `npm run dev -- -p 3101`. WBS 없는 새 프로젝트의 대시보드에서 공지·회의·이슈가 보이는지 확인한다. 공지 1건을 쓰고 대시보드에 스트립이 뜨는지 본다. 끝나면 서버를 내린다.

- [ ] **Step 10: 3단계 커밋**

```bash
git add src/lib/data/announcements.ts src/lib/data/meetings.ts "src/app/(app)/p/[projectId]/dashboard/page.tsx" src/components/dashboard/DashboardView.tsx "src/app/(app)/p/[projectId]/meetings/page.tsx" "src/app/(app)/p/[projectId]/announcements/page.tsx" src/lib/ai/projectFacts.ts src/app/actions/minutes.ts src/components/minutes/MinuteMetaModal.tsx src/components/minutes/MinuteUploadModal.tsx src/app/api/report/route.ts src/app/actions/announcements.ts src/app/api/shell/route.ts src/lib/i18n/dict/minutes.ts src/lib/i18n/dict/minutes.en.ts tests/components/dashboard-view-partial.test.tsx tests/lib/meetings-exception-embed.test.ts tests/lib/announcements.test.ts tests/api/report-route.test.ts tests/api/shell-route.test.ts tests/ui/minute-meta-modal.test.tsx tests/ui/minute-meta-modal-project-default.test.tsx tests/ui/minute-upload-modal.test.tsx
git commit -m "fix(data): 공지·회의 조회 실패를 빈 목록으로 위장하지 않는다 — 보고서는 503, 목록 판정은 조회보다 먼저

공지·회의 로더가 실패를 결과로 돌려주고 화면·보고서·회의록 모달이 사유를 보인다. /api/report 는 목록 조회 실패를
'없는 프로젝트'(404)로 답했고 판정 전에 데이터 조회를 시작했다 — /api/export 와 같은 순서로 바꾼다.
셸 응답에 headerAnnouncementsFailed 를 더한다(헤더 티커 표시는 ui/shell-hardening 에서).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 10: 편집 입력 보존 — WBS 셀 검증·저장 실패에서 입력을 버리지 않고, 위키 초안은 사용자별로 복구 먼저

항목: D6-§2-wbscommit, D6-§7-localdraft ①~④(⑤ 로그아웃 정리는 과제 12). UI 위험 파일 없음. **키 변경과 복구 순서 수정은 한 커밋으로 같이 나간다** — 복구만 고치면 교차 사용자 노출이 실제로 생긴다.

**Files:**
- Modify: `src/components/wbs/WbsGanttSheet.tsx`(:916-964 `commit`, :974-991 `editInput`), `src/components/wiki/WikiDocumentEditor.tsx`(:89-127 키·저장소 헬퍼, :129-, 저장·복구 effect :178-204, :222-240, :271, :281, :435-446 `WikiCreateDocumentButton` 삭제), `src/components/wiki/WikiTopicDetail.tsx`(`userId` prop 전달), `src/app/(app)/p/[projectId]/wiki/topics/[topicId]/page.tsx`(`membership?.userId`), `src/lib/i18n/dict/wbs{,.en}.ts`
- Create: `src/lib/drafts/wikiDrafts.ts`
- Test: `tests/ui/wbs-leaf-task-actual-cell.test.tsx`(확장), `tests/lib/wiki-drafts.test.ts`(신설), `tests/ui/wiki-document-editor-draft.test.tsx`(신설 — 편집기 테스트가 아직 없다. `next/navigation`·액션 모듈을 mock 한다)

**Interfaces:**
```ts
// src/lib/drafts/wikiDrafts.ts — 순수(저장소는 인자로). 키를 먼저 모은 뒤 지운다(순회 중 삭제로 인덱스가 밀리지 않게).
export const WIKI_DRAFT_PREFIX = 'wiki-draft'
export function wikiDraftKey(userId: string, projectId: string, topicId: string | null): string
//   → `wiki-draft:v2:${userId}:${projectId}:${topicId ?? 'new'}`
export function clearLegacyWikiDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): number
//   → 'wiki-draft:' 로 시작하고 'wiki-draft:v2:' 가 아닌 키(사용자 없는 옛 3세그먼트)를 지우고 개수를 돌려준다
export function clearAllWikiDrafts(storage: Pick<Storage, 'length' | 'key' | 'removeItem'>): number
//   → 'wiki-draft:' 로 시작하는 키 전부(로그아웃 시 — 과제 12)
// WikiDocumentEditor props 에 추가
userId: string | null   // null 이면 초안 기능을 끈다(저장·복구 모두 안 함)
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `grep -rn "WikiCreateDocumentButton" src tests` 가 정의(`WikiDocumentEditor.tsx:435`)뿐인지 본다(호출자 0 → 삭제).

- [ ] **Step 1: WBS 셀 테스트 먼저 — `tests/ui/wbs-leaf-task-actual-cell.test.tsx` 확장**

파일의 `mount`·`actualCells` 헬퍼를 그대로 쓴다. 입력 조작은 `input` 의 `value` setter + `input` 이벤트, Enter 는 `keydown`.
- 101 입력 + Enter → `updateActual` 미호출, 입력창이 남아 있고 값 `'101'`, `aria-invalid="true"` → 100 으로 고쳐 Enter → `updateActual(…, 100, …)` 1회, 입력창이 닫힌다.
- `updateActual` 이 `{ ok: false, error: '99%까지' }` 를 돌려주면 입력창과 값이 남는다.
- `{ ok: false, conflict: true }` 면 입력창이 닫힌다(현행 유지).
- 가중치 `-1` + Enter → `updateWeight` 미호출, 입력창 유지(가중치 셀을 여는 헬퍼는 `title="wbs.editWeightTitle"` 류를 파일 관례대로 찾는다).
- 잘못된 값에서 blur 를 두 번 해도 토스트는 한 번이다(같은 초안이면 blur 는 다시 알리지 않는다).

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ui/wbs-leaf-task-actual-cell.test.tsx` → FAIL(지금은 검증 실패에서 `cancel()` 로 닫힌다).

- [ ] **Step 3: 구현 — `WbsGanttSheet.tsx`**

```ts
  // 같은 잘못된 초안을 blur 로 다시 알리지 않기 위한 기억(Enter 는 매번 알린다).
  const lastRejected = useRef<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancel = () => {
    setEdit(null)
    setDraft('')
    setInvalid(false)
    lastRejected.current = null
  }
  // 검증은 서버 호출(busy) 전에 한다 — 실패하면 편집기와 초안을 그대로 두고 알린다(입력 보존).
  // 저장 실패(!ok, 충돌 아님)도 편집기를 유지한다. 충돌은 현행대로 닫고 새로고침한다 — 편집 원본을 몰래 바꾸면
  // 사용자가 못 본 값을 덮어쓴다(COM-2 계약 소관).
  const commit = async (via: 'enter' | 'blur') => {
    if (!edit || busy) return
    const { id, field } = edit
    const reject = (msg: string) => {
      setInvalid(true)
      if (via === 'enter' || lastRejected.current !== draft) setToast({ kind: 'err', msg })
      lastRejected.current = draft
      if (via === 'enter') inputRef.current?.focus()
    }
    let run: () => Promise<{ ok: boolean; error?: string; conflict?: boolean }>
    if (field === 'actual') {
      if (draft.trim() === '') return reject(t('wbs.toastEmpty'))
      const pct = Number(draft)
      if (Number.isNaN(pct)) return reject(t('wbs.toastNumbersOnly'))
      if (pct < 0 || pct > 100) return reject(t('wbs.toastRange'))
      run = () => updateActual(id, pct, Number(editOriginal))
    } else {
      // 입력은 % 기준, 저장·충돌 비교는 1기준 원본(editOriginal). 무변경 커밋은 서버 호출 없이 닫는다.
      const origPct = editOriginal.trim() === '' ? '' : String(weightToPct(Number(editOriginal)))
      if (draft.trim() === origPct) return cancel()
      const pv = draft.trim() === '' ? null : Number(draft)
      if (pv != null && (!Number.isFinite(pv) || pv < 0)) return reject(t('wbs.toastWeightMin'))
      run = () => updateWeight(id, pv == null ? null : pv / 100, editOriginal.trim() === '' ? null : Number(editOriginal))
    }
    setInvalid(false)
    setBusy(true)
    try {
      const res = await run()
      if (res.ok) {
        setToast({ kind: 'ok', msg: t('wbs.toastSaved') })
        router.refresh()
        cancel()
      } else if (res.conflict) {
        setToast({ kind: 'err', msg: `${res.error ?? t('wbs.toastConflict')} — ${t('wbs.toastYourValue')}: ${draft}` })
        router.refresh()
        cancel()
      } else {
        setToast({ kind: 'err', msg: res.error ?? t('wbs.toastSaveFail') })
        if (via === 'enter') inputRef.current?.focus()
      }
    } finally {
      setBusy(false)
    }
  }
```
`editInput`: `ref={inputRef}`, `disabled={busy}` → `readOnly={busy}` + `aria-busy={busy}`, `aria-invalid={invalid || undefined}`, `onBlur={() => void commit('blur')}`, Enter → `void commit('enter')`, `onChange` 에서 `setInvalid(false)`. i18n 키 `wbs.toastYourValue`('입력한 값' / 'Your value')를 ko·en 에 추가한다.

- [ ] **Step 4: 위키 초안 테스트 먼저**

`tests/lib/wiki-drafts.test.ts` — 가짜 Storage(`Map` 기반, `length`/`key(i)`/`removeItem`/`getItem`/`setItem`):
- 키 모양: `wikiDraftKey('u1','p1','t1') === 'wiki-draft:v2:u1:p1:t1'`, 새 문서는 `…:new`.
- `clearLegacyWikiDrafts`: `wiki-draft:p1:t1`(옛)만 지우고 `wiki-draft:v2:u1:p1:t1`·`other-key` 는 남긴다. 연속된 옛 키 3개가 모두 지워진다(순회 중 삭제 회귀).
- `clearAllWikiDrafts`: 옛·v2 모두 지우고 `other-key` 는 남긴다.
`tests/ui/wiki-document-editor-draft.test.tsx`(jsdom):
- (a) 사용자 A 로 쓴 초안(`wiki-draft:v2:uA:p1:t1`)이 있을 때 사용자 B 로 편집에 들어가면 복구 배너가 없다.
- (b) 사용자 A 가 편집에 들어가면(아직 아무것도 안 고친 `!dirty` 상태) 배너가 뜨고 **저장소의 초안이 남아 있다** — 지금은 저장 effect 가 먼저 돌아 지운다.
- (c) 배너에서 폐기 → 저장소에서 사라진다. 복구 → 본문이 초안으로 바뀐다.
- (d) `userId=null` 이면 쓰기·읽기를 하지 않는다(`setItem` 미호출).
- (e) 마운트 시 옛 3세그먼트 키가 지워진다.

- [ ] **Step 5: 실패 확인** — `npx vitest run tests/lib/wiki-drafts.test.ts tests/ui/wiki-document-editor-draft.test.tsx` → FAIL.

- [ ] **Step 6: 구현 — 초안 모듈과 편집기**

`src/lib/drafts/wikiDrafts.ts`:
```ts
/** 위키 로컬 초안 키 — 사용자별(v2). 옛 키(wiki-draft:<pid>:<tid>)는 누가 쓴 것인지 몰라 공용 PC 에서 남의 초안이 떴다. */
export const WIKI_DRAFT_PREFIX = 'wiki-draft'
const V2 = `${WIKI_DRAFT_PREFIX}:v2:`

export function wikiDraftKey(userId: string, projectId: string, topicId: string | null): string {
  return `${V2}${userId}:${projectId}:${topicId ?? 'new'}`
}

type KeyStore = Pick<Storage, 'length' | 'key' | 'removeItem'>

/** 조건에 맞는 키를 먼저 모은 뒤 지운다 — 순회 중 삭제하면 인덱스가 당겨져 하나씩 건너뛴다. */
function removeWhere(storage: KeyStore, match: (key: string) => boolean): number {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i)
    if (k !== null && match(k)) keys.push(k)
  }
  for (const k of keys) storage.removeItem(k)
  return keys.length
}

export function clearLegacyWikiDrafts(storage: KeyStore): number {
  return removeWhere(storage, k => k.startsWith(`${WIKI_DRAFT_PREFIX}:`) && !k.startsWith(V2))
}

/** 로그아웃 시 — 이 브라우저의 위키 초안 전부. 세션 만료나 /login 진입에서는 부르지 않는다(주인의 초안을 부순다). */
export function clearAllWikiDrafts(storage: KeyStore): number {
  return removeWhere(storage, k => k.startsWith(`${WIKI_DRAFT_PREFIX}:`))
}
```
`WikiDocumentEditor.tsx`:
- `DRAFT_PREFIX`·`draftKey` 를 지우고, props 에 `userId: string | null` 을 더한다. `const storageKey = userId ? wikiDraftKey(userId, projectId, topic?.id ?? null) : null`. `readDraft`·`writeDraft`·`clearDraft` 는 `key: string | null` 을 받아 `null` 이면 아무것도 하지 않는다.
- 마운트 effect: `useEffect(() => { try { clearLegacyWikiDrafts(window.localStorage) } catch { /* 저장소를 못 쓰는 환경 */ } }, [])`.
- **복구 effect 를 저장 effect 보다 위로 옮긴다**(같은 커밋 단계에서 선언 순서대로 돈다). "이 편집 세션의 남은 초안을 사람이 처리했는가"를 ref 로 둔다 — `setDraft` 는 같은 단계의 다음 effect 에 보이지 않지만 ref 는 바로 보인다.
```ts
  // 남은 초안을 사람이 처리(복구·폐기·저장·새로 쓰기)하기 전에는 !dirty 여도 지우지 않는다 — 지우면
  // 충돌 안내("이어 쓰기로 복구", wiki.ts:236)가 거짓이 된다.
  const draftSettled = useRef(true)

  // 열 때 남아 있는 초안을 먼저 읽어 복구 배너로 제시한다(아래 저장 effect 보다 먼저 선언 — 실행 순서).
  useEffect(() => {
    if (!editing || !storageKey) { setDraft(null); return }
    const found = readDraft(storageKey)
    const pending = found && found.bodyMd !== snapshot.bodyMd ? found : null
    draftSettled.current = pending === null
    setDraft(pending)
  }, [editing, storageKey, snapshot.bodyMd])

  // 초안 저장 — 타이핑마다 쓰지 않도록 debounce 한다.
  useEffect(() => {
    if (!editing || !storageKey) return
    if (!dirty) { if (draftSettled.current) clearDraft(storageKey); return }
    draftSettled.current = true // 새로 쓰기 시작했다 — 이제 이 세션의 입력이 초안의 정본이다
    const timer = window.setTimeout(() => {
      writeDraft(storageKey, { title, bodyMd, kind, savedAt: new Date().toISOString() })
    }, DRAFT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [editing, dirty, storageKey, title, bodyMd, kind])
```
- `restoreDraft`·`discardDraft`·`cancel`·저장 성공(`:281`)에서 `draftSettled.current = true` 를 세운다. beforeunload effect 와 충돌 시 쓰기(`:271`)는 `storageKey` 가 `null` 이면 건너뛴다.
- `WikiCreateDocumentButton`(`:435-446`)은 호출자가 0 이므로 지운다.
- `WikiTopicDetail.tsx`: prop `userId: string | null` 을 받아 편집기(`:289`)에 넘긴다. `wiki/topics/[topicId]/page.tsx`: `userId={membership?.userId ?? null}`(이미 `getActorForView()` 를 읽는다, `:18-22`).

- [ ] **Step 7: 통과·회귀** — `npx vitest run tests/ui tests/lib/wiki-drafts.test.ts --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint`.

- [ ] **Step 8: 로컬 확인** — `npm run dev -- -p 3101`. WBS 실적 셀에 101 을 넣으면 입력이 남고 경고가 뜨는지, 100 으로 고치면 저장되는지 본다. 위키 문서를 편집하다 탭을 닫고 다시 열면 복구 배너가 뜨는지, 다른 계정(시크릿 창)에서는 배너가 없는지 본다.

- [ ] **Step 9: 커밋(한 커밋 — 키와 복구 순서를 같이)**

```bash
git add src/components/wbs/WbsGanttSheet.tsx src/lib/i18n/dict/wbs.ts src/lib/i18n/dict/wbs.en.ts src/lib/drafts/wikiDrafts.ts src/components/wiki/WikiDocumentEditor.tsx src/components/wiki/WikiTopicDetail.tsx "src/app/(app)/p/[projectId]/wiki/topics/[topicId]/page.tsx" tests/ui/wbs-leaf-task-actual-cell.test.tsx tests/lib/wiki-drafts.test.ts tests/ui/wiki-document-editor-draft.test.tsx
git commit -m "fix(edit): WBS 셀 검증·저장 실패에서 입력을 지키고, 위키 초안은 사용자별 키로 복구를 먼저 제시한다

101 같은 값이나 서버 거부에서 편집기가 닫혀 입력이 사라졌다. 검증을 서버 호출 전으로 옮기고 실패하면 편집기를 둔다
(충돌은 현행대로 닫고 새로고침). 위키는 초안 키에 사용자가 없어 공용 PC 에서 남의 초안이 떴고, 편집 진입 때 저장 effect 가
복구보다 먼저 돌아 초안을 지워 '이어 쓰기로 복구' 안내가 거짓이었다 — 두 수정은 따로 나가면 안 된다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 11: 에이전트 승인 경합 — 사람이 본 보고에만 승인·반려가 걸린다

항목: D6-§8-approval. UI 위험 파일 없음. 마이그레이션 없음(보고 원장은 동결 — 사전 확인으로 충분).

**Files:**
- Modify: `src/app/actions/agentWork.ts`(`ActionResult` :27, `recordReview` :191-202, `approveAgentCompletion` :212-229, `rejectAgentCompletion` :232-251), `src/app/actions/agentHub.ts`(`HubProcessOp` :128-129, `isProcessOp` :151-154, `HubProcessResult`, 실행 :302-307), `src/lib/data/agentHub.ts:15`(`REPORT_COLS` 에 `id`), `src/lib/domain/agentHub.ts`(`HubReportRow`·`HubQueueEntry`·`HubRow.order`), `src/lib/data/agentSeatmap.ts:71-72`(완료 보고 select 에 `id`), `src/lib/domain/seatmap.ts`(`ReviewRow.id`, 좌석 모델에 `reportId`), `src/components/agent-hub/ApprovalQueue.tsx:66,77`, `src/components/agent-hub/DelegationTable.tsx`(op 조립 :288 부근), `src/components/agents/SeatmapView.tsx:118-121`, `src/components/wbs/WbsSpecPanel.tsx:495,501`
- Test: `tests/agent/stage-lifecycle.test.ts`(:223 이하), `tests/agent/approval-stale.test.ts`(신설), `tests/components/agent-hub-queue.test.tsx:49,62,96,105`, `tests/components/agent-hub-table.test.tsx:277,395`, 액션 mock 들(tsc 가 알려 주는 곳)

**Interfaces:**
```ts
// src/app/actions/agentWork.ts — 'use server' export 라 직접 호출될 수 있다. 두 번째(반려는 세 번째) 인자는 필수이고 런타임에도 검사한다.
type ActionResult = { ok: boolean; error?: string; warning?: string; stale?: true }
export const ERR_REPORT_STALE = '보고가 갱신되었습니다 — 새 내용을 확인한 뒤 다시 처리하세요.'
export async function approveAgentCompletion(orderId: string, expectedReportId: string | null): Promise<ActionResult>
export async function rejectAgentCompletion(orderId: string, note: string, expectedReportId: string | null): Promise<ActionResult>
// src/app/actions/agentHub.ts
| { kind: 'approve'; orderId: string; expectedReportId: string | null }
| { kind: 'reject'; orderId: string; note: string; expectedReportId: string | null }
export type HubProcessResult =
  | { ok: true; hub: AgentHub | null; hubError?: string; warning?: string }
  | { ok: false; error: string; stale?: true }
// 로더·도메인
HubReportRow.id: string; HubQueueEntry.reportId: string | null; HubRow.order.reportId: string | null
```
`unapprove`·`rework` 는 대상이 아니다.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `grep -rn "approveAgentCompletion\|rejectAgentCompletion\|kind: 'approve'\|kind: 'reject'" src tests` 결과(계획 작성 시점: 액션 2, 허브 액션, `ApprovalQueue`, `DelegationTable`, `seatOps.ts`, `WbsSpecPanel`, 테스트 6파일)를 적어 둔다.

- [ ] **Step 1: 테스트 먼저 — `tests/agent/approval-stale.test.ts`**

`tests/agent/stage-lifecycle.test.ts` 의 admin 클라이언트 가짜·`loadOrderForAdmin` 경로 mock 관례를 그대로 쓴다. `agent_work_reports` 의 최신 completion 조회(`select('id')…order('created_at', desc).limit(1).maybeSingle()`)가 돌려줄 값을 케이스마다 바꾼다.
- (a) 최신 보고 `r2`, 기대 `r1` → `{ ok: false, stale: true, error: ERR_REPORT_STALE }`, `applyWorkflowEvent`(RPC) 미호출.
- (b) 일치(`r2`/`r2`) → RPC 1회, `recordReview` 가 `r2` 행을 update 한다.
- (c) 보고 없음(`null`/`null`) → 통과.
- (d) 최신 보고 조회 `error` → `{ ok: false }` 이고 RPC 미호출(쓰기 전 선행 조회 실패는 중단 — 3원칙 ②).
- (e) 반려 → 재보고(새 `r2`) 뒤 옛 `r1` 로 승인하면 stale.
- (f) 같은 id 로 두 번째 승인은 상태가 `approved` 라 종전 문구로 거부(`승인 가능한 상태가 아닙니다`).
- (g) `expectedReportId` 가 `undefined`(직접 호출에서 빠뜨림)·uuid 아님 → `'잘못된 요청입니다.'`, RPC 미호출.
- 반려도 (a)·(d)·(g) 를 같은 모양으로 한 번씩.
`tests/components/agent-hub-queue.test.tsx`: `runOp` 호출 단언에 `expectedReportId: 'rep-1'`(큐 픽스처에 `reportId` 추가)을 더한다. stale 응답이면 `router.refresh()`(또는 허브 재조회 콜백)가 불리는지 한 케이스.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/agent tests/components/agent-hub-queue.test.tsx` → FAIL.

- [ ] **Step 3: 구현 — 서버**

```ts
export const ERR_REPORT_STALE = '보고가 갱신되었습니다 — 새 내용을 확인한 뒤 다시 처리하세요.'

/** 주문의 최신 완료 보고 id(없으면 null). 조회 실패는 결과로 — 호출부가 쓰기 전에 중단한다(3원칙 ②). */
async function latestCompletionReportId(
  admin: AdminClient, orderId: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return { ok: false, error: `보고 조회 실패: ${error.message}` }
  return { ok: true, id: (data as { id: string } | null)?.id ?? null }
}

/** 사람이 본 보고가 지금도 최신인가 — 반려 뒤 재보고된 주문을 옛 카드로 승인·반려하지 못하게 한다. */
async function checkReportFresh(
  admin: AdminClient, orderId: string, expectedReportId: unknown,
): Promise<{ ok: true; reportId: string | null } | { ok: false; error: string; stale?: true }> {
  if (expectedReportId !== null && (typeof expectedReportId !== 'string' || !isUuidLike(expectedReportId))) {
    return { ok: false, error: '잘못된 요청입니다.' }
  }
  const latest = await latestCompletionReportId(admin, orderId)
  if (!latest.ok) return latest
  if (latest.id !== expectedReportId) return { ok: false, stale: true, error: ERR_REPORT_STALE }
  return { ok: true, reportId: latest.id }
}
```
`approveAgentCompletion(orderId, expectedReportId)` 는 `wbs_item_id` 검사(`:217`) 뒤, `applyWorkflowEvent`(`:220`) 전에 `const admin = createAdminClient(); const fresh = await checkReportFresh(admin, orderId, expectedReportId); if (!fresh.ok) return fresh` 를 둔다. `rejectAgentCompletion(orderId, note, expectedReportId)` 도 상태 검사(`:238-240`) 뒤에 같게 한다. `recordReview(admin, reportId: string | null, patch, label)` 는 검증한 id 행을 직접 update 한다(`reportId === null` 이면 기록할 보고가 없으니 로그 없이 건너뛴다). 종전처럼 다시 "최신"을 찾지 않는다(`:191-202` 가 새 보고에 approve 를 찍던 경로).

`agentHub.ts`: `HubProcessOp` 의 approve·reject 에 `expectedReportId: string | null` 을 더한다. `isProcessOp` 의 `'approve'` 분기는 `uuid(o.orderId) && (o.expectedReportId === null || uuid(o.expectedReportId))`, `'reject'` 는 거기에 `typeof o.note === 'string'`. 실행부는 `approveAgentCompletion(op.orderId, op.expectedReportId)`·`rejectAgentCompletion(op.orderId, op.note, op.expectedReportId)` 이고, `if (!r.ok) return { ok: false, error: r.error ?? '처리에 실패했습니다.', ...(r.stale ? { stale: true as const } : {}) }` 로 둔다(`r` 의 타입에 `stale?: true` 를 더한다).

로더: `data/agentHub.ts:15` `REPORT_COLS` 앞에 `id, ` 를 더하고 `HubReportRow` 에 `id: string` 을 둔다. `assembleAgentHub` 가 큐 항목·행 주문에 그 주문의 최신 completion 보고 id 를 `reportId` 로 싣는다(보고가 없으면 `null`). `agentSeatmap.ts:71-72` 의 완료 보고 select 에도 `id` 를 더하고, `domain/seatmap.ts` 의 `ReviewRow` 에 `id: string`, `latestReviewByOrder`(:155)가 고른 행의 id 를 좌석(`Seat`)에 `reportId: string | null` 로 싣는다.

- [ ] **Step 4: 구현 — 호출처 4곳**(stale 이면 새로고침한다)

- `ApprovalQueue.tsx:66,77`: `run({ kind: 'approve', orderId: q.orderId, expectedReportId: q.reportId })`, 반려도 같게 한다. 결과가 `stale` 이면 `err` 에 문구를 두고 허브 재조회(이 컴포넌트의 기존 새로고침 콜백 — 없으면 `router.refresh()`)를 부른다.
- `DelegationTable.tsx`: approve·reject op 를 만드는 곳(`:288` 부근)에 `expectedReportId: row.order?.reportId ?? null`.
- `SeatmapView.tsx:118-121`: 좌석 모델의 `reportId` 를 넘긴다.
- `WbsSpecPanel.tsx:495,501`: `order.reports` 중 마지막 `kind === 'completion'` 의 `id`(없으면 `null`)를 넘긴다. `getAgentOrderForItem` 은 이미 `id` 를 select 한다(`agentWork.ts:355`).
- `seatOps.ts` 의 op 정의는 라벨·노트 요건만 담으므로 그대로다. 실제 op 조립부가 `expectedReportId` 를 넣는지 tsc 로 확인한다.

- [ ] **Step 5: 통과·회귀** — `npx vitest run tests/agent tests/components --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0.

- [ ] **Step 6: 커밋**

```bash
git add src/app/actions/agentWork.ts src/app/actions/agentHub.ts src/lib/data/agentHub.ts src/lib/data/agentSeatmap.ts src/lib/domain/agentHub.ts src/lib/domain/seatmap.ts src/components/agent-hub/ApprovalQueue.tsx src/components/agent-hub/DelegationTable.tsx src/components/agents/SeatmapView.tsx src/components/wbs/WbsSpecPanel.tsx tests/agent/approval-stale.test.ts tests/agent/stage-lifecycle.test.ts tests/components/agent-hub-queue.test.tsx tests/components/agent-hub-table.test.tsx
git status --short tests   # 액션 mock(wbs-spec-collapsed-default·wbs-spec-edit-toggle·agent-hub-view)을 고쳤다면 그 파일도 이름으로 stage
git commit -m "fix(agent): 승인·반려는 사람이 본 보고에만 — 재보고된 주문을 옛 카드로 처리하면 stale 로 거부

서버는 상태(reported)만 CAS 해서, 반려 뒤 재보고된 주문을 새 보고를 보지 않은 채 옛 카드로 승인할 수 있었고
검토 기록은 새 보고에 찍혔다. 화면이 본 보고 id 를 필수로 보내고, 서버가 최신 보고와 대조한 뒤에만 전이한다.
최신 보고를 못 읽으면 쓰기 전에 멈춘다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 13: 배포 WBS 생성 스킬 중립화 — 제조/SI 축을 규범에서 예시로

항목: DC-06. UI 위험 파일 없음. 킷 재빌드·push 는 사람이 한다(`scripts/kit-build.sh`).

**Files:**
- Modify: `.claude/skills/dflow-wbs-nlevel/SKILL.md`(:3, :20, :29-30, :75, :104-109, :128, :143, :154-157, :162, :169-171, :201, :205-206, :209-221), `.claude/skills/dflow-wbs-nlevel/references/wbs-nlevel-md-contract.md`(:3, :8-14, :48, :57, :66, :81, :111, :114, :141, :199-259, :277-298), `.claude/skills/dflow-wbs-nlevel/references/skeleton-sample.md`, `.claude/skills/dflow-wbs-nlevel/scripts/test_wbs_nlevel_parse.py`(:38, :50 픽스처 문구만), `kit/README.md:37`
- Create: `tests/invariants/skill-domain-neutral.test.ts`

**Interfaces:**
- 골격 모드 입력 `skeleton.yaml` 에 선택 키 `interfaces: [{ key, name }]` 를 둔다. 선언한 인터페이스마다 I/F 요건 정의(분석)·I/F 상세설계(설계)·통합테스트 WP(`credit:if` Task 1개)를 만들고, 선언이 없으면 만들지 않는다.
- PL 모드는 `skeleton.yaml` 을 읽지 못한다(`SKILL.md:22-27`, structure API 는 동결 `route.ts:43,53`). 그래서 `programs.*` 의 `target`/`group` 으로 축 중립 규칙을 쓴다: 인터페이스 Task 는 I/F Subsystem 아래, WP 는 `target`(상대 시스템)당 하나, `group` 은 그 아래 선택 ACT. L2IF/ERPIF 분기는 없다.
- 가중치: `programs.*` 에 `weight`/`md` 열이 있으면 그것을, 없으면 난이도 하2/중3/상5 기본값을 쓴다. 다른 환산은 programs 파일 헤더 주석으로 고정한다(`SKILL.md:206` 의 SUB 약어와 같은 관례). 보고에 출처를 적는다.
- **바꾸지 않는 것:**
  - 새 키를 `wbs.md` frontmatter 에 넣지 않는다(parser·import `levels` 계약).
  - `owner: pmo` 토큰(`wbs-nlevel-parse.py:267`, `src/lib/wbsmd/parse.ts:246`, 계약 :60)과 `credit:if`·`if-id` 는 그대로 둔다.
  - `§import 계약 v2.2` 제목(`tests/agent/wbs-import-nlevel.test.ts:6`, `src/lib/wbsmd/parse.ts:6` 가 인용)도 그대로 둔다.
  - `api/v1/*` 경로와 동결 스킬 `/dflow-wbs` 는 건드리지 않는다.
- 예시 표시: 원본 설계 기록으로 남기는 제조 예시는 `<!-- example:start -->` … `<!-- example:end -->` 안에만 둔다. 가드 테스트는 이 구간을 건너뛴다.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `grep -rhoE 'api/v1/[a-zA-Z_/-]+' .claude/skills | sort -u > "$(mktemp -d)/api-before.txt"` 로 경로 목록을 적어 둔다.

- [ ] **Step 1: 가드 테스트 먼저 — `tests/invariants/skill-domain-neutral.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// 배포 스킬(dflow-wbs-nlevel)의 규범 산문에 원본 프로젝트의 제조·SI 축이 남지 않게 한다(DC-06).
// 원본 설계 기록으로 남기는 예시는 <!-- example:start --> … <!-- example:end --> 안에만 둔다 — 그 구간은 검사하지 않는다.
const ROOT = join(process.cwd(), '.claude/skills/dflow-wbs-nlevel')
const RESIDUE = /\b(?:ERP|MES|L2)\b|LINE-|생산운영|생산계획|물류|공정/
const EXAMPLE_BLOCK = /<!-- example:start -->[\s\S]*?<!-- example:end -->/g

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (name === '__pycache__' || name === '.pytest_cache') return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : /\.(md|py)$/.test(name) ? [p] : []
  })
}

describe('배포 스킬 dflow-wbs-nlevel — 도메인 중립', () => {
  it('예시 블록 밖에 제조·SI 축 어휘가 없다', () => {
    const hits = walk(ROOT).flatMap(f => readFileSync(f, 'utf8').replace(EXAMPLE_BLOCK, m => m.replace(/[^\n]/g, ''))
      .split('\n').map((line, i) => [line, i] as const)
      .filter(([line]) => RESIDUE.test(line))
      .map(([line, i]) => `${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`))
    expect(hits, hits.join('\n')).toEqual([])
  })
})
```
(예시 블록을 지울 때 줄바꿈은 남겨 줄 번호가 원문과 맞게 한다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/invariants/skill-domain-neutral.test.ts` → FAIL(적중 목록이 곧 작업 목록이다).

- [ ] **Step 3: 산문 수정**
  - `SKILL.md`:
    - `:171` 통합테스트 줄을 "계획·환경·데이터 · 시스템 내 통합 · **선언된 인터페이스마다 연동 테스트(credit:if)** · 결함 관리·회귀 + 완료 [M]"로 바꾼다.
    - `:169-170` 의 I/F 요건·상세설계는 "인터페이스를 선언했을 때만"으로 조건을 단다.
    - `:154-157` 질문 목록에 `interfaces` 선택 키를 더한다.
    - `:201` `target` 행은 위 PL 규칙으로, `:205` 는 가중치 규칙으로 바꾼다.
    - 예시는 중립 도메인으로 **교체**한다. 경로는 `docs/acme/<모듈>` 모양을 유지하되 모듈명·Task 예시·`depends` 에 제조 용어를 쓰지 않는다. 대상은 `:20`, `:29-30`, `:75`, `:104-109`, `:128`, `:143`, `:209-221` 이다.
    - `:162` 는 skeleton-sample 을 "예시"로 부르고 "확정 표준"이라는 말을 뺀다.
    - `PMO` 산문(`:3`, `:175-177` 의 'PMO 골격') 교체는 선택이다. 바꾼다면 과제 7 의 `WbsMarkdownImport.tsx:77`('골격')과 같은 용어를 쓰고, `:3` 의 트리거 문구('골격 WBS' 등)는 유지한다.
  - `wbs-nlevel-md-contract.md`:
    - 상단에 "규범(축 중립)" 절을 새로 둔다: "인터페이스 Subsystem 은 상대 시스템별 또는 업무별로 묶을 수 있다. 한 부모 아래 축을 섞지 않는다. 짝을 이루는 구현은 `if-id` 를 공유할 수 있다."
    - `:3`("대형 제조·IT 프로젝트")를 중립화한다.
    - 기존 MES 축 규칙·표본(`:8-14`, `:57`, `:66`, `:141`, `:199-259`)은 `<!-- example:start -->`/`<!-- example:end -->` 로 감싸고 "예시 — 원본 설계 기록"이라는 머리를 단다.
    - 원본 리포의 마이그레이션 번호·커밋 해시(`:13-14`, `:48`, `:81`, `:111`, `:114`, `:277-298`)는 지우거나 "원본 리포 기록"으로 표시한다(D-Flow 에는 없는 번호다).
  - `skeleton-sample.md`: 인터페이스가 없는 중립 예시로 교체한다. 인터페이스를 선언한 두 번째 예시가 필요하면 상대 시스템을 `외부 결재 시스템` 같은 일반명으로 쓴다.
  - `test_wbs_nlevel_parse.py:38,50`: 픽스처 문구를 중립화한다(파서 동작은 도메인 중립이라 단언은 그대로다).
  - `kit/README.md:37`: 스킬 설명에서 제조 축 표현을 뺀다.

- [ ] **Step 4: 통과·회귀**

```bash
npx vitest run tests/invariants/skill-domain-neutral.test.ts tests/agent/wbs-import-nlevel.test.ts
python3 .claude/skills/dflow-wbs-nlevel/scripts/test_wbs_nlevel_parse.py
grep -rhoE 'api/v1/[a-zA-Z_/-]+' .claude/skills | sort -u | diff - <Step 0 에서 적은 파일>   # 차이 0
```
`D=$(mktemp -d) && scripts/kit-build.sh "$D/kit"` 로 킷 빌드가 통과하는지만 확인하고 결과물은 버린다(배포는 사람이 한다).

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/dflow-wbs-nlevel/SKILL.md .claude/skills/dflow-wbs-nlevel/references/wbs-nlevel-md-contract.md .claude/skills/dflow-wbs-nlevel/references/skeleton-sample.md .claude/skills/dflow-wbs-nlevel/scripts/test_wbs_nlevel_parse.py kit/README.md tests/invariants/skill-domain-neutral.test.ts
git commit -m "docs(skill): dflow-wbs-nlevel 의 제조·SI 축을 규범에서 빼고 예시로 — 인터페이스는 선언했을 때만 만든다

배포 스킬이 L2·ERP 연동 WP 와 5모듈 MES 구성을 모든 프로젝트의 규범처럼 생성했다. 골격 모드는 skeleton.yaml 의
interfaces 선언으로, PL 모드는 programs 의 target/group 으로 축 중립 규칙을 쓴다. 원본 설계 기록은 예시 블록에 남기고
가드 테스트가 블록 밖 잔재를 막는다. parser·import 계약 토큰과 api/v1 경로는 그대로다. 킷 재빌드는 사람이 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 웨이브 B

### Task 4: 챗 라우터 팀 인식 — 원본 5팀 정규식 대신 등록된 팀 코드로 (+ 후보 3 주간 도구)

항목: P1-9b / H-router / DC-05b, §6 후보 3(`ai/tools/weekly.ts:30-33`). UI 위험 파일 없음. SP2 teams-scope(`teamViewOfScope`·`activeTeamCodesVisibleToSync`)가 main 에 있어야 한다.

**Files:**
- Modify: `src/lib/ai/chat/router.ts`(:204-208 `teamFrom`, 사용처 :358·:377·:468·:519·:538·:566, :624 `routeChatRequest`), `src/lib/ai/chat/orchestrator.ts`(`ChatOrchestratorDependencies` :44-55, :601), `src/app/api/chat/v2/stream/route.ts`(:54 뒤 스코프 검증 이후 재라우팅, :98), `src/lib/ai/tools/weekly.ts:30-33`
- Test: `tests/ai/chat-v2-router.test.ts`(:31-37, :413-417 + 신규), `tests/ai/golden/golden-questions.test.ts:107`, `tests/ai/chat-v2-route.test.ts`·`tests/ai/chat-v2-route-context.test.ts`(팀 마스터 mock + 신규), `tests/ai/tools-weekly-team.test.ts`

**Interfaces:**
```ts
// src/lib/ai/chat/router.ts — 라우터는 순수하다. master 를 import 하지 않는다(모듈 최상위 await 로 DB 를 부른다).
export type RouteChatOptions = {
  /** 프로젝트(전역 회의·회의록이면 null)의 팀 코드. 호출부가 권한 범위로 좁혀 준다. 던지면 그대로 전파한다. */
  teamCodesFor?: (projectId: string | null) => readonly string[]
}
export function routeChatRequest(input: ChatRequestV2, now?: Date, opts?: RouteChatOptions): DeterministicRoute
/** 등록된 코드 중 하나를 뽑는다(대소문자 무시 매칭, 반환은 저장된 정규 코드). 둘 이상이거나 모호하면 undefined. */
export function teamFromCodes(message: string, codes: readonly string[]): string | undefined
// src/lib/ai/chat/orchestrator.ts — 폴백 라우팅에 옵션만 통과시킨다
ChatOrchestratorDependencies.routeOptions?: RouteChatOptions
// 스트림 라우트 신규 응답: 팀 캐시 cold → 503 { code: 'TEAMS_UNAVAILABLE' }
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. `grep -n "export function teamViewOfScope" src/lib/domain/authz.ts && grep -n "export function activeTeamCodesVisibleToSync" src/lib/teams/master.ts` 가 둘 다 나온다(teams-scope 반영 확인).

- [ ] **Step 1: 라우터 테스트 먼저 — `tests/ai/chat-v2-router.test.ts`**

파일 위에 `const LEGACY_TEAMS: RouteChatOptions = { teamCodesFor: () => ['PMO', 'ERP', 'MES', '가공', 'MDM'] }`(기존 기대값을 지키는 픽스처 — 과제 8 이 `FIXTURE_TEAM_CODES` 로 바꾼다)를 두고, `:31-37`·`:413-417` 의 `routeChatRequest(…, NOW)` 에 세 번째 인자로 넘긴다. 신규:
```ts
const withTeams = (codes: string[]) => ({ teamCodesFor: vi.fn((_pid: string | null) => codes) })

describe('팀 추출 — 등록된 팀 코드로만', () => {
  it.each([
    [['Research', 'R&D', 'C++'], 'R&D 작업 현황 알려줘', 'R&D'],
    [['Research', 'R&D', 'C++'], 'C++ 작업 현황 알려줘', 'C++'],
    [['Research'], 'research 작업 현황 알려줘', 'Research'],  // 대소문자 무시, 저장된 코드로 돌려준다
    [['ERP', 'ERP 운영'], 'ERP 운영 작업 현황 알려줘', 'ERP 운영'], // 최장 일치
  ])('%j 에서 %s → team=%s', (codes, message, team) => {
    const route = routeChatRequest(request(message, context('wbs')), NOW, withTeams(codes))
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls[0].args).toMatchObject({ team })
  })
  it.each([
    [['ERP', 'MES'], 'ERP MES 작업 현황 알려줘'],   // 서로 다른 둘 — 모호
    [['팀A'], 'ERP 작업 현황 알려줘'],               // 미등록 — 도구 실패(TOOL_FAILED) 대신 필터 없음
    [['ops', 'OPS'], 'OPS 작업 현황 알려줘'],         // 대소문자만 다른 중복 — 모호
    [[], 'ERP 작업 현황 알려줘'],                     // 목록이 비면 추출 0
  ])('%j 에서 "%s" 는 팀을 뽑지 않는다', (codes, message) => {
    const route = routeChatRequest(request(message, context('wbs')), NOW, withTeams(codes))
    if (route.kind !== 'tools') throw new Error(route.kind)
    expect(route.calls[0].args).not.toHaveProperty('team')
  })
  it('페이지 필터가 메시지보다 우선이다(현행)', () => { /* context('wbs', { filters: { team: 'ZULU' } }) → team 'ZULU' */ })
  it('teamCodesFor 는 프로젝트 힌트로 부른다 — 프로젝트 화면은 그 pid, 전역 회의록은 null', () => {
    const opts = withTeams(['팀A'])
    routeChatRequest(request('팀A 작업 현황 알려줘', context('wbs')), NOW, opts)
    expect(opts.teamCodesFor).toHaveBeenCalledWith('p1')
  })
  it('legacy·clarify 경로에서는 teamCodesFor 를 부르지 않는다', () => { /* 지원 밖 페이지 → 호출 0 */ })
})
```
`tests/ai/golden/golden-questions.test.ts:107`: `routeChatRequest(testCase.request, NOW_DATE, LEGACY_TEAMS)`(같은 픽스처를 그 파일에도 둔다). 팀을 단정하는 golden 9건(`cases.ts:150,287,297,573,770,914,924,1053,1097`)이 그대로 통과해야 한다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ai/chat-v2-router.test.ts tests/ai/golden` → FAIL.

- [ ] **Step 3: 구현 — 라우터**

```ts
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 메시지에서 등록된 팀 코드 하나를 뽑는다. 경계는 공백·문자열 끝이고 소비하지 않는다 — 'ERP MES' 에서 둘 다 찾아
 *  모호로 판정하기 위해서다(소비하는 경계면 MES 를 놓친다). 긴 코드부터 교대식에 넣어 'ERP 운영' 이 'ERP' 보다 먼저 잡힌다.
 *  대소문자는 무시해 찾되 저장된 정규 코드를 돌려준다. 서로 다른 코드가 둘 이상이거나, 대소문자만 다른 코드가 함께 등록돼
 *  어느 쪽인지 모르면 뽑지 않는다 — 엉뚱한 팀으로 거르는 것보다 필터 없음이 정직하다. */
export function teamFromCodes(message: string, codes: readonly string[]): string | undefined {
  const uniq = [...new Set(codes.map(c => c.trim()).filter(Boolean))]
  if (!uniq.length) return undefined
  const byLower = new Map<string, string[]>()
  for (const c of uniq) byLower.set(c.toLowerCase(), [...(byLower.get(c.toLowerCase()) ?? []), c])
  const alt = [...uniq].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|')
  const found = new Set<string>()
  for (const m of message.matchAll(new RegExp(`(?<=^|\\s)(?:${alt})(?=\\s|$)`, 'giu'))) {
    const owners = byLower.get(m[0].toLowerCase()) ?? []
    if (owners.length !== 1) return undefined
    found.add(owners[0])
  }
  return found.size === 1 ? [...found][0] : undefined
}

function teamFrom(message: string, context: PageContextV1 | undefined, teams: readonly string[]): string | undefined {
  const filtered = stringFilter(context, 'team')
  if (filtered) return filtered
  return teamFromCodes(message, teams)
}
```
`wbsCall`·`weeklyCall`·`attendanceCall`·`minutesCall`·`membersCall`·`kanbanCall` 에 마지막 인자 `teams: readonly string[]` 를 더해 `teamFrom(…, teams)` 로 넘긴다. `routeChatRequest(input, now = new Date(), opts: RouteChatOptions = {})` 는 clarify·legacy 조기 반환을 모두 지난 뒤, `const calls = domains.map(…)` 바로 위에서 한 번만 `const teams = opts.teamCodesFor?.(projectHint(input)) ?? []` 를 부르고 각 빌더에 넘긴다. `toUpperCase` 는 지운다. `orchestrator.ts`: 의존성에 `routeOptions?: RouteChatOptions` 를 더하고 `:601` 을 `deps.route ?? routeChatRequest(request, now, deps.routeOptions)` 로 바꾼다.

- [ ] **Step 4: 라우트 테스트 먼저 — `chat-v2-route.test.ts`·`chat-v2-route-context.test.ts`**

두 파일에 `vi.mock('@/lib/teams/master', async () => (await import('../helpers/teams-master-mock')).teamsMasterMock())` 를 더한다(라우트가 master 를 import 하면 최상위 `await refreshTeams()` 가 DB 를 부른다). `chat-v2-route.test.ts` 에 신규:
- (a) 팀 캐시가 던지면(개별 테스트에서 `activeTeamCodesForProjectSync` 를 `mockImplementationOnce(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })`) → 503 `TEAMS_UNAVAILABLE`, 스트림 없음.
- (b) 대화 상태의 `lastEntities` 가 허용 밖 pid 를 가리키면 그 pid 로 `activeTeamCodesForProjectSync` 를 부르지 않는다.
- (c) 1차 라우트가 legacy(501)면 팀 캐시를 읽지 않는다(스코프 조회 전 게이트 유지).

- [ ] **Step 5: 구현 — `src/app/api/chat/v2/stream/route.ts`**

```ts
import { teamViewOfScope } from '@/lib/domain/authz'
import { activeTeamCodesForProjectSync, activeTeamCodesVisibleToSync } from '@/lib/teams/master'

  // (:75-76 스코프 검증 뒤)
  // 1차 라우팅(:54)은 I/O 없는 게이트다 — 팀 코드는 스코프를 안 뒤에만 알 수 있다. 도구 경로일 때만 다시 라우팅해 등록된
  // 팀으로 팀 인자를 뽑는다. 허용 밖 프로젝트(대화 상태의 옛 엔터티)는 팀 캐시를 읽지 않는다.
  let route = plannedRoute
  if (plannedRoute.kind === 'tools') {
    const allowed = new Set(allowedProjectIds)
    const teamCodesFor = (pid: string | null): readonly string[] => {
      if (pid === null) return activeTeamCodesVisibleToSync(teamViewOfScope({ isSuperuser, workspaceIds, allowedProjectIds }))
      return allowed.has(pid) ? activeTeamCodesForProjectSync(pid) : []
    }
    try {
      route = routeChatRequest(request, now, { teamCodesFor })
    } catch (e) {
      // 팀 마스터 cold(최초 로드 실패) — 빈 목록으로 폴백하면 팀 질문이 필터 없이 조용히 답해진다(3원칙).
      console.error('[chat-v2] 팀 목록 조회 실패:', e instanceof Error ? e.message : e)
      return jsonError('팀 정보를 확인하지 못했습니다. 잠시 후 다시 시도하세요.', 503, 'TEAMS_UNAVAILABLE')
    }
  }
```
`orchestrateChatV2` 호출의 `route: plannedRoute`(`:98`)를 `route` 로 바꾼다.

- [ ] **Step 6: 후보 3 — `src/lib/ai/tools/weekly.ts:30-33`**

미등록 팀이 원본 구분 매핑(`WEEKLY_TEAM_SECTIONS`)으로 걸러지던 것을 막는다 — 등록 여부를 먼저 본다.
```ts
function sectionsForTeam(team: string, projectId: string): ReadonlySet<string> | null {
  if (!isRegisteredTeamCodeForProject(team, projectId)) return null
  return WEEKLY_TEAM_SECTIONS[team] ?? new Set([team])
}
```
주석(`:25-28`)은 "그 프로젝트에 등록된 팀만 — 등록 팀이면 매핑이 있을 때 그 구분들, 없으면 동명 구분"으로 고친다. `tests/ai/tools-weekly-team.test.ts` 에 "미등록 'ERP' → '알 수 없는 담당팀입니다'" 케이스를 더한다(파일의 `isRegisteredTeamCodeForProject` mock 이 'ERP' 를 모르게).

- [ ] **Step 7: 통과·회귀** — `npx vitest run tests/ai --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint`. `grep -nF "PMO|ERP|MES" src/lib/ai/chat/router.ts` → 0건(옛 정규식 문자열).

- [ ] **Step 8: 커밋**

```bash
git add src/lib/ai/chat/router.ts src/lib/ai/chat/orchestrator.ts src/app/api/chat/v2/stream/route.ts src/lib/ai/tools/weekly.ts tests/ai/chat-v2-router.test.ts tests/ai/golden/golden-questions.test.ts tests/ai/chat-v2-route.test.ts tests/ai/chat-v2-route-context.test.ts tests/ai/tools-weekly-team.test.ts
git commit -m "fix(chat): 자연어 팀 추출을 등록된 팀 코드로 — 원본 5팀 정규식 폐기, 모호하면 뽑지 않는다

라우터가 (PMO|ERP|MES|가공|MDM) 정규식이라 실제 팀은 인식되지 않았고, 'ERP' 같은 일반어가 미등록 팀 인자로 넘어가
도구가 TOOL_FAILED 로 실패했다. 스코프 확인 뒤 권한 범위의 팀 코드로 다시 라우팅한다(허용 밖 pid 는 캐시를 읽지 않음,
캐시 cold 는 503). 주간 도구도 등록되지 않은 팀을 원본 구분 매핑으로 거르지 않는다. 이름·별칭 인식은 SP8.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: 도메인·스크립트 잔재 정리 — 레거시 구분 매핑·테스트 전용 구 파서·죽은 모듈·기본 공휴일

항목: P1-2b, P4-§3-parse, P4-§3-brand-comment, DC-07. UI 위험 파일 없음. 과제 4 다음이다(`WEEKLY_TEAM_SECTIONS` 와 `tools-weekly-team` 테스트가 겹친다). 과제 1 다음이다(`template.ts`·`build-xlsx.mjs` 주석이 겹친다).

**Files:**
- Modify: `src/lib/domain/weeklySheet.ts`(:17-20, :26-41, :43-69, :88-98, :100-117 주석, :155-176), `src/lib/domain/weeklyLint.ts:92-97`(주석), `src/lib/report/sheetNarrative.ts:30`(주석), `src/components/weekly/WeeklySheetView.tsx:688`(주석), `src/lib/excel/validate.ts`(:1 import, :15-48 `validateAndLink` 삭제), `src/lib/excel/parseWithProfile.ts`(:3-5, :22, :177 주석), `src/lib/excel/export.ts:6-7`(주석), `scripts/wbs/build-xlsx.mjs`(:24-30 입력 형식 문서, :35-42, :120, :133, :151-152, 요약 출력), `src/lib/excel/template.ts`(:32-35 `TEMPLATE_HOLIDAYS`)
- Move: `src/lib/excel/parse.ts` → `tests/fixtures/excel/legacyParse.ts`(+ `validateAndLink`)
- Delete: `src/lib/report/brand.ts`
- Test: `tests/domain/weeklySheet.test.ts`, `tests/ai/tools-weekly-team.test.ts:108-121`, `tests/excel/{parse,validate,edgecases,export,parse-with-profile}.test.ts`(import 12줄), `tests/excel/wbs-draft-import.test.ts`(:96-97 + 신규), `tests/excel/template.test.ts`(휴일 0건)

**Interfaces:**
```ts
// src/lib/domain/weeklySheet.ts — 삭제: LEGACY_SECTION_MAP, lookupLegacy, mapLegacySection. 남김: isWeeklySection(sectionKeyOf 가 쓴다),
// FALLBACK_SECTION, WEEKLY_TEAM_SECTIONS(MES 에서 '조업및표준화' 제거), sortWeeklyRows·rowSectionLabel·sectionKeyOf(SP4 가 바꾼다).
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[]   // 시그니처 불변
// tests/fixtures/excel/legacyParse.ts — 테스트 오라클(구 3행 헤더 파서 + validateAndLink). src 는 이 파일을 import 하지 않는다.
export { parseWbsWorkbook, buildWbsColumnMap, LEGACY_COLUMN_MAP, validateAndLink, type ParsedWbs, type ParsedRow }
// scripts/wbs/build-xlsx.mjs
export function buildWorkbook(areas, holidays = [])   // holidays: [iso, name][] — 기본 0건
// CLI 입력: { areas, holidays?: { date: 'YYYY-MM-DD', name?: string }[] }  — 한 모양뿐, toCell 로 검증
// src/lib/excel/template.ts
export const TEMPLATE_HOLIDAYS: [string, string][] = []   // Holiday 시트는 ['날짜','이름'] 헤더만
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 1·4 커밋이 HEAD 에 있다(`git log --oneline -20` 에서 두 제목 확인). `grep -rnE "report/brand|['\"]\./brand['\"]|['\"]\.\./brand['\"]" src tests scripts` → 0건(삭제 전제). `grep -rn "excel/parse'" src` → 0건(런타임 importer 없음).

- [ ] **Step 1: 테스트 먼저 — 주간 이월**

`tests/domain/weeklySheet.test.ts`:
- `:3-4` import 에서 `LEGACY_SECTION_MAP`·`mapLegacySection` 을 빼고, `row()` 픽스처 기본값(`:8`, section 'ERP'·module 'SD/LE')을 표준 구분·module `''` 로 바꾼다.
- `describe('mapLegacySection')`(`:12-55`)를 지운다.
- 합치기·다듬기·자르기 케이스(`:67-134`)는 **같은 표준 구분 2행**(예: `'관리회계'` 두 행 — 동시 백필 `data/weeklySheet.ts:25-26` 로 실제 생길 수 있다)으로 바꾼다.
- '조업및표준화 → 조업' 케이스는 "비표준 구분의 내용이 버려지지 않는다(어딘가에 붙는다)"로 바꾼다. 어느 구분에 붙는지(PMO)는 고정하지 않는다 — SP4 가 없앨 결함이다.
- `'toString'` 케이스(`:117-121`)는 유지한다(Map 은 프로토타입을 조회하지 않는다).
- `:170` 의 비표준 픽스처는 중립값(`'기타 구분'`)으로 바꾼다.
`tests/ai/tools-weekly-team.test.ts:108-121`: MES 결과에서 '조업및표준화' 를 빼고 제목·주석을 고친다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/domain/weeklySheet.test.ts tests/ai/tools-weekly-team.test.ts` → import·기대값이 어긋나 FAIL.

- [ ] **Step 3: 구현 — `weeklySheet.ts`**

`LEGACY_SECTION_MAP`(:46-69)·`lookupLegacy`(:88-91)·`mapLegacySection`(:93-98)을 지운다. `WEEKLY_TEAM_SECTIONS.MES` 에서 `'조업및표준화'` 와 그 주석(:32-34)을, `:26-29` 의 "(아래 조업및표준화 주석이 그 흔적)"을, `:19-20` 의 개편 이력을 지운다. `carryOverRows`:
```ts
/** 새 주차 이월: 결과는 항상 표준 구분 행이다. 전주 차주계획 → 금주실적, next 는 비움.
 *  같은 구분의 행이 여럿이면(동시 백필로 생길 수 있다) sortOrder 순으로 줄바꿈으로 이어붙인다.
 *  표준이 아닌 구분의 내용도 버리지 않고 첫 구분(FALLBACK_SECTION)에 붙인다 — 영역 체계는 SP4 에서 바뀐다. */
export function carryOverRows(prev: WeeklySheetRow[]): NewWeeklyRow[] {
  …(append 는 그대로)…
  for (const r of [...prev].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // Map.get 은 프로토타입을 보지 않는다 — 'toString' 같은 구분명도 폴백으로 간다.
    const target = bySection.get(r.section.trim()) ?? bySection.get(FALLBACK_SECTION)!
    …
  }
}
```
`:100` 과 `:108-112` 의 'ERP · SD/LE'·'조업및표준화' 예시는 "구분 · 모듈"·"폐지된 구분" 같은 중립 표현으로 바꾼다. 같은 방식으로 `weeklyLint.ts:92-97`, `sheetNarrative.ts:30`, `WeeklySheetView.tsx:688` 주석을 고친다.

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/domain tests/ai/tools-weekly-team.test.ts tests/report tests/data --reporter=dot 2>&1 | tail -3`.

- [ ] **Step 5: 구 파서를 테스트 픽스처로**

```bash
mkdir -p tests/fixtures/excel
git mv src/lib/excel/parse.ts tests/fixtures/excel/legacyParse.ts
```
`src/lib/excel/validate.ts` 의 `validateAndLink`(:15-48)를 잘라 `tests/fixtures/excel/legacyParse.ts` 끝에 붙인다. 그 파일은 `import type { ImportItem, ImportError } from '@/lib/excel/validate'` 로 타입을 가져온다(테스트 → src 방향은 괜찮다). 파일 머리 주석은 "구 3행 헤더 파서 — 라운드트립 테스트 오라클. 런타임 임포터는 parseWithProfile 이다"로 바꾼다. `validate.ts` 에서 `:1` 의 `import type { ParsedWbs } from './parse'` 를 지운다(`ImportItem`·`ImportError`·`splitLeafOwners` 는 남긴다). 테스트 5파일의 import 12줄을 상대 경로로 바꾼다(`@/*` 는 src 전용이다).
- `parse.test.ts:3,98`: `from '../fixtures/excel/legacyParse'`
- `validate.test.ts:2-3`: `validateAndLink`·`ParsedWbs` 모두 `'../fixtures/excel/legacyParse'`
- `edgecases.test.ts:3-5`, `export.test.ts:3-4,117`: 같은 방식
- `parse-with-profile.test.ts:6-7`: 같은 방식(`:8` 의 `ImportItem` 타입 import 는 그대로 `@/lib/excel/validate`)

주석을 고친다. `parseWithProfile.ts:3-5`("구 경로 parse.ts/validate.ts 무접촉 병행")는 "구 파서는 tests/fixtures/excel/legacyParse.ts 의 테스트 오라클로만 남았다"로 바꾼다. `:22`("parse.ts 와 동일")와 `:177`(validate.ts 의 lastPhase/lastTask)은 중립 설명으로 바꾼다. `export.ts:6-7` 은 "라운드트립은 테스트 오라클(legacyParse)로 증명하고, 런타임 임포터는 parseWithProfile"로 바꾼다. 런타임 5팀 사본(`profile.ts:150`, `domain/teams.ts`)은 남는다 — 커밋 메시지에서 "src 5팀 0건"이라고 과장하지 않는다.

- [ ] **Step 6: 죽은 모듈 삭제** — `git rm src/lib/report/brand.ts`(export `C`·`STATUS_*`·`ownersText`·`argb` 모두 사용처 0, Step 0 grep 0건).

- [ ] **Step 7: 기본 공휴일 제거(사용자 결정)**

`tests/excel/wbs-draft-import.test.ts` 먼저 바꾼다. 파일 안에 `const FIXTURE_HOLIDAYS: [string, string][] = [['2026-09-01', '창립기념일'], ['2026-12-31', '연말 휴무']]` 를 두고 기존 파싱 케이스는 `buildWorkbook(AREAS, FIXTURE_HOLIDAYS)` 로 부른다(`:96-97` 기대값을 이 픽스처에 맞춘다). 신규 케이스: `buildWorkbook(AREAS)` → `detectWorkbook` 의 `holidaySheetName === 'Holiday'` 이고 `parseWithProfile(...).holidays` 가 `[]` 다. `tests/excel/template.test.ts` 에는 "양식의 Holiday 시트는 헤더만 — 파싱 휴일 0건" 케이스를 더한다. 확인: `npx vitest run tests/excel/wbs-draft-import.test.ts tests/excel/template.test.ts` → 기본값이 아직 4일이라 FAIL.

`scripts/wbs/build-xlsx.mjs`:
- `FIXED_HOLIDAYS_2026`(:37-42)를 지운다. 음력 휴일 주석(:36)은 일반 원칙("틀린 날짜를 지어 넣지 않는다")으로 남긴다.
- `buildWorkbook(areas, holidays = [])`(:120)로 바꾸고, Holiday 시트는 비어도 `[['날짜', '이름'], ...holidays.map(([iso, name]) => [toCell(iso), name])]` 로 헤더를 쓴다.
- CLI(:151-152)는 `const { areas, holidays = [] } = JSON.parse(...)` 로 읽는다. `holidays` 가 배열이 아니면 `console.error` 후 `exit(1)` 한다. 원소는 `{ date, name }` 한 모양만 받아 `[h.date, h.name ?? '']` 로 넘긴다(`toCell` 이 형식 오류를 던진다). 요약에 `휴일 ${holidays.length}건` 을 찍는다.
- 입력 형식 문서(:24-30)에 `holidays?: { date, name }[]`(기본 없음)을 적는다.

`src/lib/excel/template.ts:32-35`: `export const TEMPLATE_HOLIDAYS: [string, string][] = []`. Holiday 시트는 이미 `['날짜', '이름']` 헤더를 쓴다(:59). 가이드 8번(:48)은 "Holiday 시트에 회사 휴일(날짜, 이름)을 적으면 계획%가 영업일 기준으로 계산됩니다. 기본으로 들어 있는 휴일은 없습니다."로 바꾼다.

- [ ] **Step 8: 통과·회귀**

```bash
npx vitest run tests/excel tests/domain tests/ai tests/report tests/data --reporter=dot 2>&1 | tail -3
npm run typecheck && npm run lint && npm run build 2>&1 | tail -2
grep -rn "LEGACY_SECTION_MAP\|SD/LE\|FI/TR\|조업 및 표준화\|FIXED_HOLIDAYS_2026" src tests scripts   # 0건
grep -rn "excel/parse'" src                                                                          # 0건
```

- [ ] **Step 9: 커밋**

```bash
git add src/lib/domain/weeklySheet.ts src/lib/domain/weeklyLint.ts src/lib/report/sheetNarrative.ts src/components/weekly/WeeklySheetView.tsx src/lib/excel/validate.ts src/lib/excel/parseWithProfile.ts src/lib/excel/export.ts tests/fixtures/excel/legacyParse.ts scripts/wbs/build-xlsx.mjs src/lib/excel/template.ts tests/domain/weeklySheet.test.ts tests/ai/tools-weekly-team.test.ts tests/excel/parse.test.ts tests/excel/validate.test.ts tests/excel/edgecases.test.ts tests/excel/export.test.ts tests/excel/parse-with-profile.test.ts tests/excel/wbs-draft-import.test.ts tests/excel/template.test.ts
git status --short src/lib/excel/parse.ts src/lib/report/brand.ts   # git mv·git rm 으로 이미 stage 됐는지 확인(D·R 표시)
git commit -m "chore: 레거시 구분 매핑·테스트 전용 구 파서·죽은 brand 모듈·기본 공휴일을 걷어낸다

포크에 존재할 수 없는 원본 SAP 모듈 매핑(LEGACY_SECTION_MAP)을 지우고 이월은 표준 구분만 본다. src 에서 테스트만 쓰던
구 3행 파서(5팀 열 리터럴 포함)를 tests/fixtures 로 옮긴다 — 런타임 5팀 사본(profile.ts·teams.ts)은 아직 남는다.
report/brand.ts 는 import 가 0건이었다. WBS 빌더 CLI 와 웹 양식이 2026 한국 공휴일을 기본으로 넣어 임포트 때 프로젝트
휴일로 upsert 됐다 — 공휴일은 어디에도 기본으로 넣지 않는다(사용자 결정 2026-09-26).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 7: 문구·설정 화면·브랜드 잔재 — 역할 표현 중립화, 재색인 권한 일치, 거짓 '최근 프로젝트', 화이트라벨 기본값

항목: DC-09, D5-residue-SmartUtility, D6-§2-recent, D6-§13-whitelabel, §6 후보 4(재색인 권한 — 종합 문서대로 이 과제). UI 위험 파일 없음. 단, `BrandMark.tsx` 는 G2 정규식 밖이지만 전역 헤더에 렌더되므로 눈확인을 관례로 한다(종합 문서 §5-6). 과제 1 다음이다(`settings/page.tsx`). 과제 6 다음이다 — 새 불변식 정규식이 `domain/weeklySheet.ts:51` 의 "(PMO)" 주석에 걸리는데, 그 주석은 과제 6 이 지운다.

**Files:**
- Modify(i18n, ko·en 동시): `src/lib/i18n/dict/settings{,.en}.ts`(:30-31·:37 / :32-33·:39 — `pmoOnlyNotice`·`pmoOnlyBadge` 삭제, `noImportPermission*` 는 사용처 0 이면 삭제), `home{,.en}.ts`(:20 `recentProjects` 삭제, :31/:29 `phName`), `wiki{,.en}.ts`(:33·:69 / :34·:68), `issues{,.en}.ts`(:77 / :78)
- Modify(코드·문구): `src/app/(app)/p/[projectId]/settings/page.tsx`(:147, :211, :216-232, :277-281, :422), `src/components/ui/PageHero.tsx:37`, `src/app/actions/wbs.ts`(:176, :310, :670, :685), `src/components/import/WbsMarkdownImport.tsx:77`, `src/lib/ai/commands/pipeline.ts:21`, `src/lib/ai/wiki-ingest.ts`(:152, :161, :166-168, :753), `src/app/(app)/projects/page.tsx`(:170, :230-247, `History` import), `src/lib/branding.ts`, `.env.local.example`(:25-27)
- Modify(주석): `src/components/settings/ReindexButton.tsx:9`, `src/components/wbs/RowDetailPanel.tsx`(:31, :44, :617, :717), `src/components/wbs/WbsGanttSheet.tsx:1273`, `src/components/dashboard/DashboardView.tsx:27`, `src/lib/domain/dashboard.ts:264`, `src/lib/domain/weeklyLint.ts:4`, `src/lib/agent/wbsImport.ts:32`, `src/components/minutes/MinuteChatPanel.tsx:156`, `src/lib/data/weeklySheet.ts:54`
- Test: `tests/invariants/no-legacy-org.test.ts`(정규식 추가), `tests/ui/settings-page-teams.test.tsx`(재색인 버튼), `tests/ui/projects-home.test.tsx`, `tests/lib/branding.test.ts`

**Interfaces:**
```ts
// src/lib/branding.ts
export const DEFAULT_PRODUCT_NAME = 'D-Flow'
/** 포털 아이콘 — 명시값 'flow'|'monogram' 이 우선이다. 비었거나 모르는 값이면 제품명이 기본(D-Flow)일 때만 flow(D 글리프),
 *  아니면 제품명 첫 글자 monogram 이다. 화이트라벨 배포가 D 글리프를 달고 나오지 않게 한다. */
export function resolvePortalIcon(raw: string | undefined, productName: string): 'flow' | 'monogram'
BRAND.portalIcon: 'flow' | 'monogram'   // = resolvePortalIcon(env, productName)
// tests/invariants/no-legacy-org.test.ts — 역할 표현만 막는다(단어 PMO 전면 금지는 하지 않는다)
const PMO_ROLE_PHRASE = /PMO ?(관리자|admins?\b|만|전용)|담당 ?팀·PMO|\(PMO\)/
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 1·6 이 HEAD 에 있다. `git status --porcelain .env.local.example src/lib/branding.ts` 가 비어 있다. `grep -rnE "PMO ?(관리자|admins?\b|만|전용)|담당 ?팀·PMO|\(PMO\)" src` 결과를 작업 목록으로 적어 둔다(과제 6 뒤라 `domain/weeklySheet.ts:51` 은 이미 없어야 한다).

- [ ] **Step 1: 테스트 먼저**

- `tests/invariants/no-legacy-org.test.ts`: `PMO_ROLE_PHRASE` 와 `it("역할 표현 'PMO 관리자/만/전용'·'(PMO)' 0건 — 권한은 프로젝트 관리자·워크스페이스 관리자다", …)` 를 더한다(`findHits(files, PMO_ROLE_PHRASE)`).
- `tests/ui/settings-page-teams.test.tsx`: `ReindexButton` mock 을 `mocks.ReindexButton = vi.fn(() => null)` 으로 바꾸고 케이스를 더한다. **슈퍼유저가 아닌 프로젝트 관리자**(`makeAdminActor('p1')`)에게 `ReindexButton` 이 그려지고, HTML 에 'PMO' 가 없어야 한다. 서버 가드가 이미 `requireProjectAdmin` 이다(`actions/chat.ts:14`, `api/chat/reindex/route.ts:19`).
- `tests/ui/projects-home.test.tsx`: 프로젝트 4개 이상 케이스를 더한다. 각 카드(프로젝트 이름)가 HTML 에 한 번씩만 나오고 `recent-title` 이 없어야 한다.
- `tests/lib/branding.test.ts`: 기존 '기본값은 D-Flow' 케이스에 `vi.stubEnv('NEXT_PUBLIC_BRAND_PORTAL_ICON', '')` 를 더하고 `portalIcon` 이 `'flow'` 인지 본다. `resolvePortalIcon` 단위 케이스 6개를 더한다:
  ```ts
  it.each([
    [undefined, 'D-Flow', 'flow'], ['', 'D-Flow', 'flow'], ['monogram', 'D-Flow', 'monogram'],
    ['', 'Acme PM', 'monogram'], ['flow', 'Acme PM', 'flow'], ['sparkle', 'Acme PM', 'monogram'],
  ])('resolvePortalIcon(%j, %s) → %s', async (raw, name, want) => {
    const { resolvePortalIcon } = await import('@/lib/branding')
    expect(resolvePortalIcon(raw, name)).toBe(want)
  })
  ```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/invariants/no-legacy-org.test.ts tests/ui/settings-page-teams.test.tsx tests/ui/projects-home.test.tsx tests/lib/branding.test.ts` → FAIL.

- [ ] **Step 3: 설정 화면** — `settings/page.tsx`:
  - 설정 화면은 관리자 전용이다(`:112` redirect). 그래서 `canMutate === isAdmin` 이고, `!canMutate` 분기는 죽은 코드다. 모두 지운다: `:211` 의 `actions` 배지, `:216-232` 삼항의 else(권한 없음 패널), `:422` 배지.
  - `:277-281` 은 조건 없이 `<ReindexButton projectId={projectId} />` 로 바꾼다(재색인 권한 UI 를 서버 가드 `requireProjectAdmin` 에 맞춘다 — 후보 4).
  - `:147` `<HeroBadge>Smart Utility</HeroBadge>` → `<HeroBadge>Settings</HeroBadge>`. `PageHero.tsx:37` 주석 예시도 `"Settings"` 로 바꾼다.
  - 사용처가 0 이 된 import(`Shield` 등)와 i18n 키(`settings.pmoOnlyBadge`·`settings.pmoOnlyNotice`, `grep` 으로 0 이면 `settings.noImportPermission`·`settings.noImportPermissionDesc`)를 ko·en 양쪽에서 지운다.

- [ ] **Step 4: 문구·예시 중립화**
  - `actions/wbs.ts:176`: `'저장 권한이 없습니다(담당 팀·관리자만 입력 가능)'`.
  - `:670`·`:685`: `'저장 권한이 없습니다(관리자만 가능)'`.
  - `:310` 주석: "— 프로젝트 관리자 전용".
  - `WbsMarkdownImport.tsx:77`: `'골격(PMO)'` → `'골격'`.
  - `pipeline.ts:21`: `'명령을 이해하지 못했어요. 예: "<작업명> 실적 80으로 올려줘"'`.
  - `wiki-ingest.ts`:
    - `:152`·`:161` 예시를 중립 대상으로 바꾼다(예: `"자산 관리 시스템"`, `"통관 확인 절차"`, `"회의실 예약 권한"`, `"비용 산출 항목"`).
    - `:166-168` 의 예시 JSON 은 `"statement":"결재 시스템과 문서 저장소 연계는 REST API 를 쓰기로 확정했다."`, `"knowledgeKey":"결재-문서 연계 방식"`, `"ownerTeam":null` 로 바꾼다.
    - `:753` user 메시지에 한 줄을 넣는다: `` `회의록 제목: ${title}\n회의일: ${minuteDate}\n[등록 팀] ${teamCodes.length ? teamCodes.join(', ') : '(없음)'}\n${catalog}\n[이번 회의록 원문]\n${source}` ``.
    - `:391` 필터는 유지한다. `prompt_version`(`:883`)을 `'wiki-v2'` 로 올릴지는 선택이다 — 올리면 커밋 메시지에 적는다.
  - placeholder(ko·en):
    - `home.phName`: '예: 신규 서비스 구축 프로젝트' / 'e.g. New service launch'
    - `wiki.ask.placeholder`·`wiki.search2.placeholder`: '예: 회의실 예약 권한은 어떻게 신청하기로 했지?' / 'For example: How do we request meeting room access?'
    - `issue.analysis.relatedSystemsPh`: '예: 결재 시스템, 문서 저장소' / 'e.g. approval system, document store'
  - 주석:
    - `ReindexButton.tsx:9` "(프로젝트 관리자)"
    - `RowDetailPanel.tsx:31,44,617,717`: "관리자", "관리자 또는 담당팀"
    - `WbsGanttSheet.tsx:1273` "(관리자)"
    - `DashboardView.tsx:27` "경영진·관리자 대시보드"
    - `domain/dashboard.ts:264` "(계획 데이터 거버넌스)"
    - `weeklyLint.ts:4` "한 구분의 줄과 다른 구분의 줄을 견주는 일은 없다"
    - `agent/wbsImport.ts:32` "I/F 대장 참조"
    - `MinuteChatPanel.tsx:156` "(각 프로젝트의 같은 이름 팀 등)"
    - `data/weeklySheet.ts:54` "새 구분(첫 구분)"
  - Step 0 목록의 나머지 적중(i18n 사전·설정 화면)은 위 Step 3 에서 지워진다. `grep` 0건이 될 때까지 고친다.

- [ ] **Step 5: '최근 프로젝트' 섹션 삭제** — `projects/page.tsx:170`(`const recent = …`)과 `:230-247` 섹션, 쓰이지 않게 된 `History` import, `home.recentProjects` 키(ko·en 동시 — `Record<keyof ko>`)를 지운다. `lastProjectId` 1건을 섞는 대안은 거짓 신호라 쓰지 않는다(진짜 최근 방문은 UX-03 로드맵).

- [ ] **Step 6: 화이트라벨 기본값** — `src/lib/branding.ts`:
```ts
export const DEFAULT_PRODUCT_NAME = 'D-Flow'

export function resolvePortalIcon(raw: string | undefined, productName: string): 'flow' | 'monogram' {
  const v = raw?.trim()
  if (v === 'flow' || v === 'monogram') return v
  return productName === DEFAULT_PRODUCT_NAME ? 'flow' : 'monogram'
}

const productName = pick(process.env.NEXT_PUBLIC_BRAND_NAME, DEFAULT_PRODUCT_NAME)

export const BRAND = {
  productName,
  /** 포털 아이콘(/projects 선적용) — resolvePortalIcon 참고. */
  portalIcon: resolvePortalIcon(process.env.NEXT_PUBLIC_BRAND_PORTAL_ICON, productName),
  …(tagline·copyright 그대로)…
} as const
```
`.env.local.example:25-27` 은 `NEXT_PUBLIC_BRAND_PORTAL_ICON=`(빈 값)으로 둔다. 주석은 "메인 포털 아이콘: 비우면 제품명이 기본(D-Flow)일 때 flow(D 글리프), 아니면 monogram(제품명 첫 글자). flow/monogram 으로 고정할 수 있다. 파비콘은 SP3 branding 설정에서 다룬다."로 바꾼다. 파비콘·apple-icon(`src/app/icon.tsx:3`, `apple-icon.tsx`)의 D 고정은 **이 과제에서 고치지 않는다** — SP3 `branding.logo_storage_path` 에 묶는다(과제 14 가 스펙에 적는다).

- [ ] **Step 7: 통과·회귀 + 눈확인** — `npx vitest run --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint`. `npm run dev -- -p 3101` 로 다음을 본다.
  - `/projects`: '최근 프로젝트' 섹션이 없고, 기본 제품명이면 D 글리프다. 라이트·다크(개발자 도구에서 `<html class="dark">`) × 390·768·1280px 로 본다 — 포털 아이콘 커밋(83a9f39)이 하지 않은 눈확인이다(종합 문서 §5-3).
  - `NEXT_PUBLIC_BRAND_NAME=Acme PM npm run dev -- -p 3101` 로 다시 띄우면 monogram 'A' 다.
  - 설정 화면: 'Settings' 배지가 보이고, 프로젝트 관리자(슈퍼유저 아님) 계정에서 재색인 버튼이 보인다.
  끝나면 서버를 내린다.

- [ ] **Step 8: 커밋**

```bash
git add "src/app/(app)/p/[projectId]/settings/page.tsx" src/components/ui/PageHero.tsx src/app/actions/wbs.ts src/components/import/WbsMarkdownImport.tsx src/lib/ai/commands/pipeline.ts src/lib/ai/wiki-ingest.ts "src/app/(app)/projects/page.tsx" src/lib/branding.ts .env.local.example src/lib/i18n/dict/settings.ts src/lib/i18n/dict/settings.en.ts src/lib/i18n/dict/home.ts src/lib/i18n/dict/home.en.ts src/lib/i18n/dict/wiki.ts src/lib/i18n/dict/wiki.en.ts src/lib/i18n/dict/issues.ts src/lib/i18n/dict/issues.en.ts src/components/settings/ReindexButton.tsx src/components/wbs/RowDetailPanel.tsx src/components/wbs/WbsGanttSheet.tsx src/components/dashboard/DashboardView.tsx src/lib/domain/dashboard.ts src/lib/domain/weeklyLint.ts src/lib/agent/wbsImport.ts src/components/minutes/MinuteChatPanel.tsx src/lib/data/weeklySheet.ts tests/invariants/no-legacy-org.test.ts tests/ui/settings-page-teams.test.tsx tests/ui/projects-home.test.tsx tests/lib/branding.test.ts
git commit -m "chore(ui): 역할 문구를 프로젝트·워크스페이스 관리자로, 재색인 버튼을 서버 권한에 맞추고, 화이트라벨 기본 아이콘을 제품명으로

'PMO 관리자 전용' 배지·문구와 ERP/MES 예시가 원본 조직을 전제했다(불변식으로 역할 표현을 막는다 — 단어 금지는 아님).
설정 화면의 재색인 버튼은 슈퍼유저에게만 보였지만 서버는 프로젝트 관리자를 허용한다. '최근 프로젝트'는 최근 생성 3개로
아래 목록과 중복이었다. 제품명을 바꿔도 포털 아이콘이 D 글리프였다 — 명시값이 없으면 제품명으로 정한다(파비콘은 SP3).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 웨이브 C — UI 위험(각자 `ui/` 브랜치)

### Task 8: DEFAULT_TEAMS 런타임 제거 — 5팀 기본값을 테스트 픽스처로

항목: DC-01a. **UI 위험**(`src/components/app/TeamsProvider.tsx`) — 브랜치 `ui/teams-no-default`. `TeamsProvider` 가 상수를 import 하므로 한 브랜치에서 전부 처리한다. 과제 1(`export.ts` 호출 형태)·4(`teams-master-mock` 을 쓰는 라우트 테스트)·6(`legacyParse` 픽스처) 다음이다.

**Files:**
- Modify: `src/lib/domain/teams.ts`(:19-29 삭제), `src/components/app/TeamsProvider.tsx`(:3-8), `src/lib/excel/export.ts`(:3, :56-60, :104-108), `src/lib/ai/analytics.ts`(:11, :212-216), `src/lib/domain/kanban.ts`(:2, :42), `src/lib/domain/subact.ts`(:2-5, :21-24), `src/lib/domain/minutes.ts`(:2, :12, :153-159 `validateMinuteInput` 삭제)
- Create: `tests/fixtures/teams.ts`, `tests/invariants/no-default-teams.test.ts`
- Modify(테스트, 대부분 기계적): `tests/helpers/teams-master-mock.ts`와 `DEFAULT_TEAMS|DEFAULT_TEAM_CODES|SUB_ACT_TEAMS` 를 import 하는 테스트 28파일(계획 작성 시점 `grep -rln` 결과), 누락 인자를 명시할 호출(`kanban`·`subact`·`export`·`split`·`validate`·`analytics`), provider 없이 렌더하던 UI 테스트(`wbs-subact-add`·`wbs-subact-display`·`minute-upload-modal`·`minute-chat-scope`·`attendance-member-pickers`·`deep-link-params`·`minutes-view-tree-toggle` 등 — 실행해서 확정), `tests/ui/teams-provider.test.tsx`, 과제 4 가 둔 라우터 테스트의 `LEGACY_TEAMS`

**Interfaces:**
```ts
// tests/fixtures/teams.ts — JSX 없이(.ts) createElement 로 감싼다
export const FIXTURE_TEAMS: readonly Team[]           // 옛 DEFAULT_TEAMS 의 값 그대로(id 'default-*' 도 그대로 — 기대값 보존)
export const FIXTURE_TEAM_CODES: readonly TeamCode[]  // = FIXTURE_TEAMS.map(t => t.code)
export function withTeams(ui: ReactNode, teams: readonly Team[] = FIXTURE_TEAMS): ReactElement
// src — 기본 인자를 필수로
groupByOwner(items: ComputedItem[], teams: readonly TeamCode[]): KanbanColumn[]
availableSubActTeams(children: …, teams: readonly TeamCode[]): TeamCode[]
buildWbsAoa(items: ComputedItem[], projectName: string, teamCodes: readonly TeamCode[], levelLabels?: readonly string[]): unknown[][]
buildWbsWorkbook(items: ComputedItem[], holidays: { date: string; name: string }[], projectName: string,
                 teamCodes: readonly TeamCode[], levelLabels?: readonly string[]): ArrayBuffer
answerByTeam(a: ProjectAnalysis, members: ProjectMember[], teams: readonly TeamCode[]): string
// 삭제: DEFAULT_TEAMS, DEFAULT_TEAM_CODES, SUB_ACT_TEAMS, minutes.TEAM_CODES, validateMinuteInput(src 호출자 0)
const TeamsContext = createContext<readonly Team[]>([])   // provider 없으면 팀 없음 — 5팀으로 보이지 않는다
```

- [ ] **Step 0: 착수 확인·브랜치** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 1·4·6 이 main 에 있다. `git switch -c ui/teams-no-default`. `grep -rn "DEFAULT_TEAMS\|DEFAULT_TEAM_CODES\|SUB_ACT_TEAMS\|validateMinuteInput" src` 와 `grep -rln "DEFAULT_TEAMS\|DEFAULT_TEAM_CODES\|SUB_ACT_TEAMS" tests` 를 적어 둔다(작업 목록).

- [ ] **Step 1: 가드 테스트 먼저 — `tests/invariants/no-default-teams.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

// 원본 5팀 폴백은 런타임에 두지 않는다(DC-01a) — 팀은 팀 마스터(DB)만 본다. 테스트 픽스처는 tests/fixtures/teams.ts.
describe('5팀 기본값 런타임 0건', () => {
  it('src 에 DEFAULT_TEAMS·DEFAULT_TEAM_CODES·SUB_ACT_TEAMS 가 없다', () => {
    const hits = walk(join(process.cwd(), 'src')).flatMap(f => readFileSync(f, 'utf8').split('\n')
      .map((line, i) => [line, i] as const)
      .filter(([line]) => /\b(DEFAULT_TEAMS|DEFAULT_TEAM_CODES|SUB_ACT_TEAMS)\b/.test(line))
      .map(([line, i]) => `${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`))
    expect(hits, hits.join('\n')).toEqual([])
  })
})
```
`tests/ui/teams-provider.test.tsx` 는 "provider 가 없으면 빈 목록"을 기대하도록 뒤집는다. 실패 확인: `npx vitest run tests/invariants/no-default-teams.test.ts tests/ui/teams-provider.test.tsx` → FAIL.

- [ ] **Step 2: 픽스처**

```ts
// tests/fixtures/teams.ts
import { createElement, type ReactElement, type ReactNode } from 'react'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'
import type { TeamCode } from '@/lib/domain/types'

/** 테스트 전용 팀 — 옛 런타임 기본값(DEFAULT_TEAMS, 2026-07 5팀)의 값을 그대로 옮겼다. 런타임은 팀 마스터(DB)만 본다.
 *  워크스페이스가 없는 픽스처라 workspaceId 는 '' 다(어떤 워크스페이스 접근자에도 걸리지 않는다). */
export const FIXTURE_TEAMS: readonly Team[] = [
  { id: 'default-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-erp', code: 'ERP', sortOrder: 1, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-mes', code: 'MES', sortOrder: 2, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-gagong', code: '가공', sortOrder: 3, active: true, progressVisible: true, projectId: null, workspaceId: '' },
  { id: 'default-mdm', code: 'MDM', sortOrder: 4, active: true, progressVisible: false, projectId: null, workspaceId: '' },
]
export const FIXTURE_TEAM_CODES: readonly TeamCode[] = FIXTURE_TEAMS.map(t => t.code)

/** provider 없이 렌더하던 컴포넌트 테스트용 — 전역 mock 대신 명시적으로 감싼다. */
export function withTeams(ui: ReactNode, teams: readonly Team[] = FIXTURE_TEAMS): ReactElement {
  return createElement(TeamsProvider, { teams }, ui)
}
```
`tests/helpers/teams-master-mock.ts:1` 은 `import { FIXTURE_TEAMS } from '../fixtures/teams'` 로 바꾸고 본문의 `DEFAULT_TEAMS` 를 `FIXTURE_TEAMS` 로 바꾼다(주석도). Step 0 의 테스트 28파일은 `DEFAULT_TEAMS`→`FIXTURE_TEAMS`, `DEFAULT_TEAM_CODES`→`FIXTURE_TEAM_CODES` 로, import 를 상대 경로(`../fixtures/teams`, golden 은 `../../fixtures/teams`)로 바꾼다. 과제 4 의 `LEGACY_TEAMS`(라우터·golden 테스트)는 `{ teamCodesFor: () => FIXTURE_TEAM_CODES }` 로 바꾼다.

- [ ] **Step 3: src — 상수 삭제와 필수 인자**

`domain/teams.ts:19-29` 를 지운다. `TeamsProvider.tsx` 는 import 에서 `DEFAULT_TEAMS` 를 빼고 `createContext<readonly Team[]>([])` 로 바꾸며, 머리 주석을 "미제공 시 빈 목록 — 팀은 (app)/layout 이 주입한다"로 고친다. `subact.ts` 는 `SUB_ACT_TEAMS` 를 지우고 `availableSubActTeams(children, teams)` 로 필수화한다. `minutes.ts` 는 `TEAM_CODES`(:12)와 `validateMinuteInput`(:153-159, src 호출자 0)을 지우고 `:276` 주석의 "validateMinuteInput 관례"를 "validateMinuteFields 관례"로 바꾼다. `kanban.ts:42`, `analytics.ts:215` 는 기본값을 지운다. `export.ts` 는 `buildWbsAoa(items, projectName, teamCodes, levelLabels = [...])`·`buildWbsWorkbook(items, holidays, projectName, teamCodes, levelLabels = [...])` 로 앞쪽 기본 인자도 없앤다(`:3` import 삭제). src 호출처(`export/route.ts`, `KanbanBoard.tsx:162`, `RowDetailPanel.tsx:116`, `ai/tools/kanban.ts:81`, `ai/knowledge.ts:121`)는 이미 값을 넘긴다 — typecheck 로 확인한다.

- [ ] **Step 4: 타입 → 테스트 순으로 고친다**

```bash
npm run typecheck 2>&1 | grep -E "error TS" | cut -d'(' -f1 | sort -u   # 누락 인자 호출이 있는 테스트 파일 목록
```
나온 호출에 인자를 명시한다(`FIXTURE_TEAM_CODES`, `'WBS'` 등 — 기대값이 바뀌지 않게 옛 기본값과 같은 값). 그다음 `npx vitest run --reporter=dot 2>&1 | tail -20` 에서 팀이 비어 실패하는 UI 테스트를 `withTeams(<컴포넌트 … />)` 로 감싼다. 단언을 완화하지 않는다.

- [ ] **Step 5: 통과** — `npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3` → 실패 0. `grep -rn "DEFAULT_TEAMS\|DEFAULT_TEAM_CODES\|SUB_ACT_TEAMS" src` → 0건(가드와 같은 결과).

- [ ] **Step 6: 눈확인(트레일러 근거)** — `npm run db:reset`(다른 과제와 겹치지 않을 때) → `npm run dev:bootstrap` → `npm run dev -- -p 3101`. 공용 팀 2개를 가진 프로젝트를 만든 뒤 다음 화면을 본다.
  - `/minutes`: 담당 팀 필터·업로드 모달의 팀 선택
  - `/p/<id>/wbs`: 세부업무(SUB-ACT) 추가의 팀 목록
  - `/p/<id>/kanban`: 담당 보기의 열
  - `/p/<id>/attendance`: 팀 필터
  팀 목록이 그 프로젝트 팀으로만 나오고 원본 5팀이 보이지 않아야 한다. 끝나면 서버를 내린다.

- [ ] **Step 7: 커밋(트레일러 필수)**

```bash
git add src/lib/domain/teams.ts src/components/app/TeamsProvider.tsx src/lib/excel/export.ts src/lib/ai/analytics.ts src/lib/domain/kanban.ts src/lib/domain/subact.ts src/lib/domain/minutes.ts tests/fixtures/teams.ts tests/invariants/no-default-teams.test.ts tests/helpers/teams-master-mock.ts tests/ui/teams-provider.test.tsx
git status --short tests   # Step 2·4 에서 고친 테스트 파일을 이 목록에서 하나씩 이름으로 stage 한다(작업 트리의 남의 파일은 넣지 않는다)
git commit -F - <<'EOF'
ui(teams): 원본 5팀 기본값을 런타임에서 걷어낸다 — provider 가 없으면 팀 없음, 5팀은 테스트 픽스처로

TeamsProvider 기본값과 도메인 함수의 기본 인자가 원본 5팀(PMO/ERP/MES/가공/MDM)이라, 주입을 빠뜨린 화면·호출이
조용히 원본 팀으로 동작했다. 기본 인자를 필수로 바꾸고, 호출자가 없던 validateMinuteInput 은 지운다.
테스트는 tests/fixtures/teams.ts 의 FIXTURE_TEAMS·withTeams 로 명시한다. 가드가 src 재유입을 막는다.

Preview-checked: local <date '+%Y-%m-%d %H:%M' 출력> — /minutes, /p/[id]/wbs, /p/[id]/kanban, /p/[id]/attendance 팀 목록
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log -1 --format='%(trailers:key=Preview-checked,valueonly)'   # 비어 있으면 amend
```
`main` 반영(`git switch main && git merge --ff-only ui/teams-no-default`)과 push 는 컨트롤러가 사람 확인 뒤에 한다.

### Task 12: 셸·토큰 UI 위험 묶음 — 브레드크럼·사이드바 어포던스·대비·로그아웃 초안 정리·헤더 티커 실패 표시

항목: D5-§3-breadcrumb, D5-§3/§8-sidebar-affordances, D5-§5-contrast-now / D6-§5-contrast-current, D6-§7-localdraft ⑤, §6 후보 5(사이드바 보조 글자·주말 라벨 대비), §6 후보 7 의 화면 쪽. **UI 위험**(`HeaderChrome.tsx`·`Sidebar.tsx`·`ShellStateProvider.tsx`·`HeaderAnnouncementTicker.tsx`·`(app)/layout.tsx`·`globals.css`) — 브랜치 `ui/shell-hardening`. SP2 결정 U2 에 따라 SP2 머지 뒤, 과제 7(`projects/page.tsx`)·9(셸 응답 필드)·10(`wikiDrafts.ts`) 다음이다. **재테마 금지**: 토큰 값은 대비를 맞추는 만큼만 바꾸고, 팔레트·다크 토글은 건드리지 않는다(사용자 결정).

**Files:**
- Modify: `src/lib/domain/authz.ts`(`isAnyWorkspaceAdmin` 추가), `src/app/(app)/projects/page.tsx:176`(인라인 판정 교체), `src/app/(app)/layout.tsx`(identity `canCreateProject`, Sidebar prop), `src/components/app/Sidebar.tsx`(:75 props, :225-229, :267, :271-275), `src/components/app/HeaderChrome.tsx`(:27-30 `SECTION_LABEL`, :33-41 `HeaderIdentity`, :85-86 `signOut`), `src/components/app/ShellStateProvider.tsx`(`headerAnnouncementsFailed`), `src/components/app/HeaderAnnouncementTicker.tsx`, `src/app/globals.css`(:54, :75, :92), `src/app/login/page.tsx`(:50, :165, :181, :199, :215, :235), `src/components/wbs/WbsGanttSheet.tsx:1456`, `src/lib/i18n/dict/announcements{,.en}.ts`
- Create: `tests/css/contrast-tokens.test.ts`, `tests/ui/sidebar-affordances.test.tsx`, `tests/ui/header-chrome-signout.test.tsx`
- Test: `tests/domain/authz.test.ts`, `tests/ui/header-chrome-breadcrumb.test.tsx`, `tests/ui/header-announcement-ticker.test.tsx`

**Interfaces:**
```ts
// src/lib/domain/authz.ts — 프로젝트 생성 어포던스(createProject 가드 requireWorkspaceAdmin 과 같은 축)
export function isAnyWorkspaceAdmin(actor: Actor | null): boolean   // = superuser ∨ adminWorkspaceIds(actor).size > 0
// src/components/app/HeaderChrome.tsx
export interface HeaderIdentity { …기존; canCreateProject?: boolean }   // degraded 는 false
// src/components/app/Sidebar.tsx
Sidebar({ projects, showUsage = false, showPortfolio = false, canCreateProject = false })
// src/components/app/ShellStateProvider.tsx
ShellState.headerAnnouncementsFailed: boolean   // 셸 응답 필드(과제 9). 옛 응답(필드 없음)은 false
// globals.css 토큰(라이트만 — 다크 값 유지)
--color-ink-subtle: #6f645d;  --color-pending: #6f645d;  --color-sidebar-ink-subtle: #9a8f85;
```
대비 실측(WCAG 상대 휘도, 계획 작성 시 계산):
- `#6f645d`: canvas 5.02, surface 5.53, surface-2 4.89, sheet-head 4.68, pending-weak 4.68, weekend 4.72, holiday-band 4.64. 이전 `#7a6f68` 은 4.27 / 4.70 / 4.16 / 3.98 / 3.98 / 4.01 / 3.95 였다.
- 사이드바 `#9a8f85`: sidebar 5.73, sidebar-2 5.34, sidebar-3 4.67(이전 `#877d73` 4.50 / 4.19 / 3.66).
- 주말·휴일 날짜 라벨 `text-delayed/70` 은 sheet-head 위 2.45 다. `text-delayed` 원색도 3.63 이라 토큰 값을 바꾸지 않고는 AA 를 못 맞춘다. 그래서 **라벨은 `text-ink-subtle font-semibold`** 로 바꾼다(4.68·4.72·4.64). 주말·휴일 구분은 이미 칠해지는 배경 밴드(`--color-weekend`·`--color-holiday-band`)가 맡는다.

- [ ] **Step 0: 착수 확인·브랜치** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 7·9·10 이 main 에 있다(`src/lib/drafts/wikiDrafts.ts` 존재, `api/shell/route.ts` 에 `headerAnnouncementsFailed`). `git switch -c ui/shell-hardening`.

- [ ] **Step 1: 테스트 먼저**
  - `tests/domain/authz.test.ts`: `isAnyWorkspaceAdmin` — 워크스페이스 관리자 true, 멤버만 false, 프로젝트 명단 admin 이지만 워크스페이스 멤버 false(생성 권한은 워크스페이스 관리자), 슈퍼유저 true, null false.
  - `tests/ui/header-chrome-breadcrumb.test.tsx`: `it.each([['/p/p1/agents', '에이전트'], ['/p/p1/agents/office', '에이전트'], ['/p/p1/import', '임포트 마법사']])` — 섹션 단계가 보인다(파일의 `mocks.pathname` 관례).
  - `tests/ui/sidebar-affordances.test.tsx`(기존 `sidebar-sync.test.tsx` 의 렌더 하네스를 따른다):
    - `canCreateProject` 없음(멤버·degraded) → `aria-label="common.newProject"` 링크 없음. `true` → 있음.
    - `/projects` 에서 홈 링크에 `aria-current="page"` 가 있고, `aria-current` 를 가진 링크가 정확히 1개다.
    - '전체 프로젝트' 중복 링크가 없다(`href="/projects"` 인 side-link 가 홈 하나 — 상단 '모두 보기'(:144)는 별개).
  - `tests/ui/header-chrome-signout.test.tsx`: 로그아웃 버튼 클릭 → `localStorage` 의 `wiki-draft:v2:u1:p1:t1`·`wiki-draft:p1:t1` 이 사라지고 `other` 키는 남으며, `auth.signOut` 이 그 **뒤에** 불린다(호출 순서 기록).
  - `tests/ui/header-announcement-ticker.test.tsx`: 셸 상태가 `headerAnnouncementsFailed: true` 면 `role="status"` 로 `ann.tickerFailed` 문구가 보이고 공지 링크는 없다.
  - `tests/css/contrast-tokens.test.ts`:
    ```ts
    import { readFileSync } from 'node:fs'
    import { join } from 'node:path'
    import { describe, expect, it } from 'vitest'

    // 라이트 테마 본문 텍스트 조합이 WCAG AA(4.5:1)를 넘는지 — 토큰 값을 바꿀 때 회귀를 잡는다(다크는 이후 디자인 시스템 SP).
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const start = css.indexOf('@theme {')
    const theme = css.slice(start, css.indexOf('}', start))
    const token = (name: string): string => {
      const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)
      if (!m) throw new Error(`토큰 없음: ${name}`)
      return m[1]
    }
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

    const PAIRS: [string, string][] = [
      ['ink-subtle', 'canvas'], ['ink-subtle', 'surface'], ['ink-subtle', 'surface-2'], ['ink-subtle', 'sheet-head'],
      ['ink-subtle', 'weekend'], ['ink-subtle', 'holiday-band'],
      ['pending', 'pending-weak'], ['pending', 'canvas'], ['pending', 'surface'],
      ['sidebar-ink-subtle', 'sidebar'], ['sidebar-ink-subtle', 'sidebar-2'], ['sidebar-ink-subtle', 'sidebar-3'],
    ]
    describe('라이트 토큰 대비 — 본문 텍스트 4.5:1', () => {
      it.each(PAIRS)('%s on %s', (fg, bg) => { expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5) })
      it('로그인 화면에 옛 보조 글자 하드코딩(#7a6f68)이 없다', () => {
        expect(readFileSync(join(process.cwd(), 'src/app/login/page.tsx'), 'utf8')).not.toMatch(/#7a6f68/i)
      })
      it('간트 주말·휴일 날짜 라벨은 반투명 위험색을 쓰지 않는다', () => {
        expect(readFileSync(join(process.cwd(), 'src/components/wbs/WbsGanttSheet.tsx'), 'utf8')).not.toContain('text-delayed/70')
      })
    })
    ```
  실패 확인: `npx vitest run tests/domain/authz.test.ts tests/ui/header-chrome-breadcrumb.test.tsx tests/ui/sidebar-affordances.test.tsx tests/ui/header-chrome-signout.test.tsx tests/ui/header-announcement-ticker.test.tsx tests/css/contrast-tokens.test.ts` → FAIL.

- [ ] **Step 2: 구현 — 권한·셸**
  - `authz.ts`(판정은 이 파일과 `src/lib/authz/**` 두 곳에서만 한다):
    ```ts
    /** 어느 워크스페이스든 관리자인가 — 프로젝트 생성 어포던스(사이드바 '+'·포털 버튼). 서버 가드는 대상 워크스페이스의
     *  requireWorkspaceAdmin(actions/project.ts:71)이다. 명단 admin 은 생성 권한이 아니다. */
    export function isAnyWorkspaceAdmin(actor: Actor | null): boolean {
      if (!actor) return false
      return actor.isSuperuser || adminWorkspaceIds(actor).size > 0
    }
    ```
  - `projects/page.tsx:176` 의 `(actor.isSuperuser || [...actor.workspaceRoles.keys()].some(w => isWorkspaceAdmin(actor, w)))` 를 `isAnyWorkspaceAdmin(actor)` 로 바꾼다.
  - `(app)/layout.tsx` identity 에 `canCreateProject: isAnyWorkspaceAdmin(actor)` 를 더한다(degraded 분기는 `false`). `<Sidebar … canCreateProject={identity?.canCreateProject ?? false} />` 로 넘긴다.
  - `Sidebar.tsx`: props 에 `canCreateProject = false` 를 더하고 '+ 새 프로젝트'(:225-229)를 `canCreateProject &&` 로 감싼다. 홈 링크(:267)에 `aria-current={pathname === '/projects' ? 'page' : undefined}` 를 단다. 중복 '전체 프로젝트'(:271-275)와 쓰이지 않게 된 `FolderOpen` import 를 지운다(`nav.allProjects` 키는 `HeaderChrome.tsx:320`·포털이 쓰므로 유지).
  - `HeaderChrome.tsx`:
    - `SECTION_LABEL` 에 `agents: '에이전트', import: '임포트 마법사'` 두 리터럴만 더한다(= `nav.projectAgents`·`importWizard.heroTitleSuffix`). `t()` 전환은 라벨이 바뀌고 기존 mock 이 깨지므로 SP3 레지스트리 파생 때 한다.
    - `HeaderIdentity` 에 `canCreateProject?: boolean` 을 더한다.
    - `signOut` 은 `auth.signOut()` 전에 `try { clearAllWikiDrafts(window.localStorage) } catch { /* 저장소를 못 쓰는 환경 */ }` 를 부른다. 세션 만료·`/login` 진입·`InviteRedeemCard` 에는 넣지 않는다 — 주인의 초안을 부순다.
  - `ShellStateProvider.tsx`: `ShellPayload` 에 `headerAnnouncementsFailed?: boolean` 을, 상태 `headerAnnouncementsFailed` 를 더한다. 프로젝트 응답에서 `setHeaderAnnouncementsFailed(data.headerAnnouncementsFailed === true)` 로 두고, 프로젝트를 벗어나면 `false` 로 되돌린다. 컨텍스트 값에 싣는다.
  - `HeaderAnnouncementTicker.tsx`: `projectId && wide && headerAnnouncementsFailed` 면 링크 대신 상태 칩을 그린다. 래퍼는 기존과 같은 컨테이너 쿼리 display 만 쓴다(반응형 display 와 섞지 않는다 — CLAUDE.md CSS 규칙).
    ```tsx
    <span role="status" className="hidden min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[13px] text-delayed @[15rem]:flex">
      <Megaphone className="h-3.5 w-3.5 shrink-0" />{t('ann.tickerFailed')}
    </span>
    ```
    i18n `ann.tickerFailed`('공지를 불러오지 못했습니다' / 'Could not load announcements')를 ko·en 에 더한다.

- [ ] **Step 3: 구현 — 대비(재테마 아님)**
  - `globals.css` 라이트 `@theme`: `--color-ink-subtle`(:54)·`--color-pending`(:75) → `#6f645d`, `--color-sidebar-ink-subtle`(:92) → `#9a8f85`. `.dark` 값은 그대로다(dark brand-weak 3.93 은 선택 후속 — 디자인 시스템 SP).
  - `login/page.tsx` 6곳(:50 placeholder, :165, :181, :199, :215, :235)의 `#7a6f68` 은 `#6f645d` 로 바꾼다. 로그인은 밝은 고정 배경이라 다크 토큰(`text-ink-subtle`)을 쓰면 다크 모드에서 대비가 떨어지므로 hex 를 유지한다. `hover:text-[#4a4440]` 은 그대로다.
  - `WbsGanttSheet.tsx:1456`: `'text-delayed/70'` → `'font-semibold text-ink-subtle'`.

- [ ] **Step 4: 통과** — `npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3`(`tests/css/breakpoint-safety-net.test.ts` 포함 초록 — `@theme` 에 `--breakpoint-*` 를 더하지 않았다).

- [ ] **Step 5: 눈확인(트레일러 근거)** — `npm run dev -- -p 3101`. 다음을 본다.
  - 멤버 / 워크스페이스 관리자 / 슈퍼유저 × 사이드바 펼침·접힘: '+' 는 관리자·슈퍼유저에게만 보이고, 홈 활성 표시가 하나이며, '전체 프로젝트' 중복이 없다.
  - md 이상 폭에서 `/p/<id>/agents`·`/p/<id>/agents/office`·`/p/<id>/import` 의 브레드크럼 단계.
  - `/projects`, 간트 헤더(주말·휴일 날짜 라벨 — `WbsGanttSheet.tsx:1438,1456`), 설정 화면 배지, 로그인 화면의 보조 글자 대비. 라이트만 본다(다크 값은 바꾸지 않았다).
  - 로그아웃 뒤 개발자 도구 Local Storage 에 `wiki-draft:` 키가 없다.
  - 헤더 티커: 공지 있는 프로젝트에서 정상 순환한다(실패 표시는 단위 테스트로 대신한다 — 로컬에서 공지 조회만 실패시키기 어렵다).
  스크린샷 경로와 일시를 보고서에 적는다. 끝나면 서버를 내린다.

- [ ] **Step 6: 커밋(각 커밋 트레일러 필수)**

UI 위험 파일을 건드리는 커밋마다 `Preview-checked` 가 있어야 한다(G2). 세 커밋으로 나눈다.
```bash
git add src/lib/domain/authz.ts "src/app/(app)/projects/page.tsx" "src/app/(app)/layout.tsx" src/components/app/Sidebar.tsx src/components/app/HeaderChrome.tsx tests/domain/authz.test.ts tests/ui/header-chrome-breadcrumb.test.tsx tests/ui/sidebar-affordances.test.tsx tests/ui/header-chrome-signout.test.tsx
git commit -F - <<'EOF'
ui(shell): 새 프로젝트 '+' 는 생성 권한자에게만, 홈 aria-current·중복 링크 정리, 에이전트·임포트 브레드크럼, 로그아웃 때 위키 초안 정리

생성 권한이 없는 사용자에게도 '+' 가 보였고(누르면 포털에서 막힘), 홈 링크에 현재 위치 표시가 없었고 /projects 링크가 둘이었다.
/agents·/import 에서 브레드크럼 화면 단계가 빠졌다. 공용 PC 에서 다음 사용자에게 위키 초안이 남지 않게 로그아웃 때 지운다.

Preview-checked: local <date '+%Y-%m-%d %H:%M' 출력> — 사이드바(멤버·관리자·슈퍼유저 × 펼침·접힘), /p/[id]/agents·/agents/office·/import 브레드크럼, 로그아웃
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git add src/app/globals.css src/app/login/page.tsx src/components/wbs/WbsGanttSheet.tsx tests/css/contrast-tokens.test.ts
git commit -F - <<'EOF'
ui(tokens): 보조 글자·보류 상태·사이드바 보조 글자의 대비를 AA 로 — 값만 조정, 재테마 아님

ink-subtle/pending(#7a6f68)은 canvas·sheet-head·pending-weak 위에서 4.5:1 미만(3.95~4.27), 사이드바 보조 글자는 3.66,
간트 주말 라벨(delayed/70)은 2.45 였다. 같은 색상 계열에서 명도만 낮추고, 주말 라벨은 배경 밴드로 구분한다.
팔레트 전환·다크 토글은 디자인 시스템 SP 몫이다(사용자 결정 2026-09-26).

Preview-checked: local <date '+%Y-%m-%d %H:%M' 출력> — /projects, /p/[id]/wbs 간트 헤더, 설정 배지, /login
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git add src/components/app/ShellStateProvider.tsx src/components/app/HeaderAnnouncementTicker.tsx src/lib/i18n/dict/announcements.ts src/lib/i18n/dict/announcements.en.ts tests/ui/header-announcement-ticker.test.tsx
git commit -F - <<'EOF'
ui(ticker): 헤더 공지 조회 실패를 '공지 없음'으로 숨기지 않고 표시한다

셸 응답의 headerAnnouncementsFailed(데이터 쪽은 앞선 커밋)를 받아 티커 자리에 실패 상태를 보인다.

Preview-checked: local <date '+%Y-%m-%d %H:%M' 출력> — 헤더 티커(공지 있는 프로젝트 순환 정상)
Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
for c in $(git rev-list --reverse main..HEAD); do git log -1 --format='%h %(trailers:key=Preview-checked,valueonly)' "$c"; done   # 세 줄 모두 값이 있어야 한다
```
`main` 반영과 push 는 컨트롤러가 사람 확인 뒤에 한다.

---

## 웨이브 A 추가 — 제7·8부 원장(과제 15~18)

제7·8부 원장(`.superpowers/review-triage/parts-7-8-synthesis.md` §2)이 H1 에 더한 네 과제다. 모두 웨이브 A 이고 마이그레이션과 UI 위험 파일이 없다. 번호는 과제 14 뒤에 붙였지만 실행은 선행 과제(11·9·17) 다음이다(의존 순서 표). 과제 14 가 이 넷의 선반영 기록까지 한다. 추가 노력은 약 3~4일이다.

### Task 15: 자기 완료 승인 차단 — 자기 담당·자기 착수 완료는 다른 사람이 승인한다 (AUTH-07a)

항목: 제7부 AUTH-07a(원장 §1 — 07b 설정형 자기 승인 금지는 비목표). UI 위험 파일 없음. 마이그레이션 없음. **과제 11 다음**이다 — `agentWork.ts`·`ApprovalQueue.tsx`·`DelegationTable.tsx`·`domain/{seatmap,agentHub}.ts` 를 과제 11 이 먼저 고친다.

결함: 승인 자격 `loadOrderForAdmin`(`agentWork.ts:80-99`)은 `requireSubtreeManagerOrAdmin`(`subtreeManager.ts:29-46`)만 부른다. 주석(`agentWork.ts:75-78`, `assignee.ts:24-28`)은 "리프 담당자 본인은 승인하지 못한다"고 적었지만 판정은 strict 조상만 본다. 그래서 (a) 부모와 리프의 담당자가 같은 멤버면 그 멤버가 서브트리 관리자 자격으로 자기 완료를 승인하고, (b) 미배정 리프는 누구나 claim 할 수 있어(`api/v1/agent/work/[id]/claim/route.ts:50-54`) 상위 담당자가 자기 에이전트로 착수한 주문을 스스로 승인한다.

**Files:**
- Modify(서버): `src/lib/agent/assignee.ts`(`subtreeStanding` 신설 — `isSubtreeManager` :40-60 의 1회 읽기를 옮기고 `isSubtreeManager` 는 그 래퍼로. 주석 :24-28 정정), `src/lib/agent/subtreeManager.ts`(`ERR_SELF_APPROVAL`·`requireCompletionApprover`), `src/app/actions/agentWork.ts`(`loadOrderForAdmin` :80-99 — select 에 `claimed_by_user_id`, 새 가드. 주석 :75-78 정정)
- Modify(어포던스): `src/lib/domain/seatmap.ts`(`canApproveCompletion`, `Seat.canApprove`, `assembleSeatmap` 의 권한 계산 :272-279), `src/lib/domain/agentHub.ts`(`HubRow.canApprove`·`HubQueueEntry.canApprove`), `src/components/agent-hub/ApprovalQueue.tsx`(:58-71), `src/components/agent-hub/DelegationTable.tsx`(:391-394), `src/components/agents/seatOps.ts`(`mayRun`·`SeatOpsInput`·`opsFor`), `src/lib/data/agentApprovals.ts`(`countApprovable`·`getPendingApprovalCount`)
- Test: `tests/agent/subtree-manager.test.ts`, `tests/actions/agent-work-actions.test.ts`, `tests/domain/seatmap.test.ts`, `tests/domain/agent-hub.test.ts`, `tests/components/agents-seat-ops.test.ts`, `tests/components/agent-hub-queue.test.tsx`, `tests/data/agent-approvals.test.ts`, 허브·좌석 픽스처(`canApprove` 가 필수 필드라 tsc 가 알려 주는 곳)

**Interfaces:**
```ts
// src/lib/agent/assignee.ts — 한 번의 wbs_items 읽기로 조상 판정과 리프 담당자를 함께 돌려준다(추가 왕복 없음).
export interface SubtreeStanding {
  /** strict 조상 중 담당자가 나인 노드가 있다(= 종전 isSubtreeManager). */
  manager: boolean
  /** 대상 항목 행이 이 프로젝트 조회 결과에 있다. false 면 승인 판정은 거부한다(fail-closed). */
  leafFound: boolean
  /** 대상 항목 자신의 담당자(명단 행 id). 미배정이면 null. */
  leafAssigneeMemberId: string | null
}
export async function subtreeStanding(
  admin: AdminClient, args: { itemId: string; projectId: string; myMemberIds: readonly string[] },
): Promise<SubtreeStanding>                                  // 조회 실패는 throw(종전 계약)
export async function isSubtreeManager(admin: AdminClient, args: { itemId: string; projectId: string; myMemberIds: readonly string[] }): Promise<boolean>
// = myMemberIds 가 비면 조회 없이 false, 아니면 (await subtreeStanding(…)).manager — 기존 호출·테스트 무변경

// src/lib/agent/subtreeManager.ts
export const ERR_SELF_APPROVAL = '자기 담당이거나 자기가 착수한 항목의 완료는 승인할 수 없습니다 — 다른 관리자나 상위 담당자에게 요청하세요.'
export async function requireCompletionApprover(
  itemId: string, projectId: string, opts: { claimedByUserId: string | null },
): Promise<SubtreeGuardResult>
// 관리자 → 통과(추가 조회 없음). 비관리자: 멤버 아님 → 그 가드 오류. 명단 0행·리프 행 없음·서브트리 관리자 아님 → ERR_NOT_SUBTREE_MANAGER.
// 리프 담당자가 나 ∨ claimedByUserId === 나 → ERR_SELF_APPROVAL. 조회 throw → 거부.

// src/lib/domain/seatmap.ts — 서버 가드와 같은 축(순수). 허브·좌석·배지가 같이 쓴다.
export function canApproveCompletion(r: { isAdmin: boolean; subtreeManager: boolean; assigneeMine: boolean; claimedByMe: boolean }): boolean
// = r.isAdmin || (r.subtreeManager && !r.assigneeMine && !r.claimedByMe)
Seat.canApprove: boolean             // assembleSeatmap: isAdmin = adminProjectIds.has(pid), claimedByMe = 주문 claimed_by_user_id === 보는 사람
HubRow.canApprove: boolean           // assembleAgentHub: isAdmin = viewer.isAdmin, claimedByMe = picked?.claimed_by_user_id === viewer.userId
HubQueueEntry.canApprove: boolean    // 같은 식, 큐의 주문 o 로

// src/components/agents/seatOps.ts
export const ERR_SELF_APPROVAL_HINT = '자기 담당·자기 착수 항목의 완료는 다른 관리자나 상위 담당자가 승인합니다.'
export function mayRun(seat: Pick<Seat, 'canManage' | 'assigneeMine' | 'canApprove'>, spec: SeatOpSpec): boolean   // approve 는 seat.canApprove 만 본다
export type SeatOpsInput = Pick<Seat, 'state' | 'canManage' | 'assigneeMine' | 'canApprove'> & { resumeRequestedAt?: string | null }

// src/lib/data/agentApprovals.ts
export function countApprovable(
  orders: ReadonlyArray<{ wbs_item_id: string | null; claimed_by_user_id: string | null }>,
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[]; userId: string },
): number
```
`requireSubtreeManagerOrAdmin`·`loadOrderForReview` 는 그대로다 — 반려·승인 취소·재작업(되돌리는 결정)은 계속 담당자 본인·서브트리 관리자에게 열린다. 중단(stop)·단계 조정도 그대로다.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 11 이 HEAD 에 있다(`grep -c "expectedReportId" src/app/actions/agentWork.ts` 가 1 이상). `grep -rn "isSubtreeManager\|isSubtreeManagerOf\|loadOrderForAdmin\|canManage" src tests` 결과를 적어 둔다(계획 작성 시점: 서버 가드 2파일, 허브·좌석 도메인 2, 컴포넌트 4, 배지 로더 1, 테스트 7파일).

- [ ] **Step 1: 테스트 먼저 — 서버 가드**

`tests/agent/subtree-manager.test.ts` 에 `describe('requireCompletionApprover — 완료 승인 자격(자기 승인 금지)')` 를 더한다. 같은 파일의 `fakeAdmin`(트리·로스터)과 `mocks.requireProjectAdmin`·`requireProjectMember` 를 그대로 쓴다. 액터는 `user-1`, 로스터는 `[{ id: 'm-mine' }]` 이 기본이다.
- (a) 부모(MID)와 리프(LEAF)의 담당자가 모두 `m-mine` → `{ ok: false, error: ERR_SELF_APPROVAL }`.
- (b) 미배정 리프, 부모 담당자 `m-mine`, `claimedByUserId: 'user-1'`(= 액터) → `ERR_SELF_APPROVAL`.
- (c) 같은 트리, `claimedByUserId: 'user-2'`(남) → `{ ok: true, actor: { userId: 'user-1' }, isAdmin: false }`.
- (d) 관리자 → `isAdmin: true`, `requireProjectMember`·`admin.from` 미호출.
- (e) 리프 행이 트리에 없음 → `{ ok: false, error: ERR_NOT_SUBTREE_MANAGER }`.
- (f) 조상 조회 오류 → `ok: false`(fail-closed). 로스터 0행 → `ERR_NOT_SUBTREE_MANAGER` 이고 조상 조회(`wbs_items`)가 없다.
- `subtreeStanding` 단위 두 케이스: 리프 담당자·`leafFound` 를 조상 판정과 한 번의 조회로 돌려준다(`admin.from` 1회). 기존 `isSubtreeManager` 케이스(:64-133)는 **수정 없이** 초록이어야 한다.

`tests/actions/agent-work-actions.test.ts`:
- `vi.mock('@/lib/agent/assignee', …)`(:22)에 `subtreeStanding: mocks.subtreeStanding` 을 더한다. 기본값은 `{ manager: false, leafFound: true, leafAssigneeMemberId: null }` 이다. 승인 경로의 기존 두 케이스(:189-214 "서브트리 관리자면 허용", "조상 조회 throw")는 `isSubtreeManager` 대신 `subtreeStanding` 을 준다 — 반려 계열 케이스는 여전히 `isSubtreeManager` 를 쓴다.
- 승인 `ORDER` 픽스처(:94)에 `claimed_by_user_id: null` 을 더한다.
- (g) 비관리자·서브트리 관리자인데 `leafAssigneeMemberId` 가 내 명단 id → `{ ok: false, error: ERR_SELF_APPROVAL }`, `rpcCalls` 0, `agent_work_reports` 조회 0(과제 11 의 보고 대조보다 먼저 거부한다).
- (h) 주문 `claimed_by_user_id` 가 액터 → 같은 거부, RPC 0.
- (i) 같은 멤버(리프 담당자 본인)의 반려 → 성공, RPC 1회 `p_event: 'reject'` — 되돌리는 결정은 계속 열려 있다.

- [ ] **Step 2: 테스트 먼저 — 어포던스·배지**

- `tests/domain/seatmap.test.ts`: `canApproveCompletion` 표 — 관리자는 늘 true, 서브트리 관리자 ∧ ¬담당 ∧ ¬claim 일 때만 true, 셋 중 하나라도 걸리면 false. `assembleSeatmap` 좌석: 부모·리프 담당자가 같은 뷰어면 `canManage: true, canApprove: false`, 뷰어가 claim 한 주문도 `canApprove: false`, 관리자 좌석은 `canApprove: true`.
- `tests/domain/agent-hub.test.ts`: `rows[].canApprove`·`queue[].canApprove` 가 같은 규칙이다(뷰어 `userId` 와 주문 `claimed_by_user_id` 대조).
- `tests/components/agents-seat-ops.test.ts`: `who()` 도우미(:8)에 세 번째 인자 `canApprove`(기본 `canManage && !assigneeMine`)를 둔다. `opsFor({ state: 'WAIT', canManage: true, canApprove: false, assigneeMine: false })` → approve 는 `allowed: false`, `why` 가 `ERR_SELF_APPROVAL_HINT`, reject 는 허용.
- `tests/components/agent-hub-queue.test.tsx`: `canManage: true, canApprove: false` 카드에 `[data-queue-approve]` 가 없고 반려 버튼(`[data-queue-reject-open]`)은 있다.
- `tests/data/agent-approvals.test.ts`: 주문 픽스처(:6)에 `claimed_by_user_id` 를 더한다. 비관리자 배지 수에서 자기 담당 리프·자기 claim 주문이 빠진다. 관리자 수는 그대로다.

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/agent/subtree-manager.test.ts tests/actions/agent-work-actions.test.ts tests/domain/seatmap.test.ts tests/domain/agent-hub.test.ts tests/components/agents-seat-ops.test.ts tests/components/agent-hub-queue.test.tsx tests/data/agent-approvals.test.ts` → FAIL.

- [ ] **Step 4: 구현 — 서버 가드**

`assignee.ts`:
```ts
export async function subtreeStanding(
  admin: AdminClient,
  args: { itemId: string; projectId: string; myMemberIds: readonly string[] },
): Promise<SubtreeStanding> {
  const { data, error } = await admin
    .from('wbs_items').select('id, parent_id, assignee_member_id').eq('project_id', args.projectId)
  if (error) throw new Error(`조상 조회 실패: ${error.message}`)
  const byId = new Map(((data ?? []) as AncestorRow[]).map(r => [r.id, r]))
  const leaf = byId.get(args.itemId)
  const mine = new Set(args.myMemberIds)
  const visited = new Set<string>()
  let manager = false
  let cur = leaf?.parent_id ?? null
  while (cur !== null && !visited.has(cur)) {
    visited.add(cur)
    const row = byId.get(cur)
    if (!row) break // 사슬이 끊기면 더 올라가지 않는다(fail-closed 방향)
    if (row.assignee_member_id && mine.has(row.assignee_member_id)) { manager = true; break }
    cur = row.parent_id
  }
  return { manager, leafFound: leaf !== undefined, leafAssigneeMemberId: leaf?.assignee_member_id ?? null }
}

export async function isSubtreeManager(
  admin: AdminClient,
  args: { itemId: string; projectId: string; myMemberIds: readonly string[] },
): Promise<boolean> {
  if (args.myMemberIds.length === 0) return false
  return (await subtreeStanding(admin, args)).manager
}
```
주석 `:24-28` 은 "리프 자신의 담당자는 조상 판정에 넣지 않는다. 자기 완료 승인 금지는 `requireCompletionApprover`(subtreeManager.ts)가 `leafAssigneeMemberId` 와 주문의 claim 계정으로 시행한다" 로 바꾼다.

`subtreeManager.ts`:
```ts
export const ERR_SELF_APPROVAL = '자기 담당이거나 자기가 착수한 항목의 완료는 승인할 수 없습니다 — 다른 관리자나 상위 담당자에게 요청하세요.'

/**
 * 완료 승인(approve) 자격 — 관리자, 또는 서브트리 관리자이면서 그 리프의 담당자 본인도 그 주문을 claim 한 계정도 아닌 사람
 * (분리 원칙: 자기 완료를 자기가 승인하지 못한다 — 제7부 AUTH-07a). 반려·승인 취소·재작업은 requireSubtreeManagerOrAdmin·
 * loadOrderForReview 그대로다 — 되돌리는 결정은 담당자 본인에게도 열려 있다.
 * 리프 행을 찾지 못하면 담당자를 확인할 수 없으므로 거부한다. 조회가 던져도 거부한다(fail-closed).
 */
export async function requireCompletionApprover(
  itemId: string, projectId: string, opts: { claimedByUserId: string | null },
): Promise<SubtreeGuardResult> {
  const a = await requireProjectAdmin(projectId)
  if (a.ok) return { ok: true, actor: { userId: a.actor.userId }, isAdmin: true }
  const m = await requireProjectMember(projectId)
  if (!m.ok) return { ok: false, error: m.error }
  const admin = createAdminClient()
  try {
    const mine = await myMemberIds(admin, { userId: m.actor.userId, projectId })
    if (mine.length === 0) return { ok: false, error: ERR_NOT_SUBTREE_MANAGER }
    const s = await subtreeStanding(admin, { itemId, projectId, myMemberIds: mine })
    if (!s.leafFound || !s.manager) return { ok: false, error: ERR_NOT_SUBTREE_MANAGER }
    const assigneeMine = s.leafAssigneeMemberId !== null && mine.includes(s.leafAssigneeMemberId)
    if (assigneeMine || opts.claimedByUserId === m.actor.userId) return { ok: false, error: ERR_SELF_APPROVAL }
    return { ok: true, actor: { userId: m.actor.userId }, isAdmin: false }
  } catch (e) {
    console.error('[subtreeManager] 승인 자격 판정 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '승인 자격 판정에 실패했습니다.' }
  }
}
```

`agentWork.ts` `loadOrderForAdmin`: select 를 `'id, project_id, status, wbs_item_id, claimed_by_user_id'` 로 넓히고(반환 order 타입에 `claimed_by_user_id: string | null` 을 더한다), `wbs_item_id` 가 있으면 `requireCompletionApprover(row.wbs_item_id, row.project_id, { claimedByUserId: row.claimed_by_user_id })` 를 부른다. `wbs_item_id` null 이면 종전대로 관리자만이다. 주석 `:75-78` 은 "리프 담당자 본인·그 주문을 claim 한 계정은 제외 — requireCompletionApprover 가 시행한다" 로 고친다(종전 문구는 isSubtreeManager 가 리프를 안 본다는 사실만으로 분리가 된다고 적었다).

- [ ] **Step 5: 구현 — 어포던스·배지**

- `seatmap.ts`: `canApproveCompletion` 을 `isSubtreeManagerOf` 옆에 둔다. `Seat` 에 `canApprove: boolean`(주석: "완료 승인 어포던스 — 서버 requireCompletionApprover 와 같은 축") 을 더하고, `assembleSeatmap` 의 권한 계산(:272-279)을 다음처럼 바꿔 `toSeat` 의 `rights` 로 넘긴다.
  ```ts
  const isAdminP = adminProjectIds.has(o.project_id)
  const subtree = item !== undefined && isSubtreeManagerOf(item.id, ancestorById, myMemberIds)
  const assigneeMine = item?.assignee_member_id != null && myMemberIds.has(item.assignee_member_id)
  const rights = {
    canManage: isAdminP || subtree, assigneeMine,
    canApprove: canApproveCompletion({ isAdmin: isAdminP, subtreeManager: subtree, assigneeMine, claimedByMe: viewerId !== undefined && o.claimed_by_user_id === viewerId }),
  }
  ```
- `agentHub.ts`: 행은 `canApprove: canApproveCompletion({ isAdmin: viewer.isAdmin, subtreeManager: canManage, assigneeMine, claimedByMe: picked?.claimed_by_user_id === viewer.userId })`, 큐는 같은 식을 주문 `o` 로. 두 인터페이스에 필드와 주석을 더한다.
- `ApprovalQueue.tsx`: 승인 버튼 조건 `(isAdmin || q.canManage)`(:64)를 `q.canApprove` 로 바꾼다. 안내 줄(:71)은 `!q.canApprove` 일 때 보이고, `q.canManage` 면 "자기 담당·자기 착수 항목은 다른 관리자나 상위 담당자가 승인합니다. 반려로 보고를 물릴 수는 있습니다.", 아니면 종전 문구다. 바깥 조건(:58)과 반려 버튼은 그대로다. 파일 머리 주석(:2-3)에 자기 승인 금지를 더한다.
- `DelegationTable.tsx`(:394): `.filter(b => b.kind === 'approve' ? r.canApprove : b.who === 'admin' ? (isAdmin || r.canManage) : (isAdmin || r.assigneeMine || r.canManage))`. 머리 주석(:52-53)을 같은 뜻으로 고친다.
- `seatOps.ts`: `mayRun` 은 `spec.kind === 'approve'` 면 `seat.canApprove` 만 본다. `opsFor` 의 `why` 는 approve 가 막혔고 `seat.canManage` 면 `ERR_SELF_APPROVAL_HINT`, 그 밖은 종전대로다. 머리 주석(:3-6)의 approve 줄을 "관리자 또는 (서브트리 관리자 ∧ 리프 담당자·claim 계정 아님) — requireCompletionApprover" 로 고친다. `opsFor(seat)` 호출처(`DetailPanel.tsx:52`·`SeatOpsBar.tsx:23`)는 `Seat` 를 그대로 넘기므로 바뀌지 않는다.
- `agentApprovals.ts`: `getPendingApprovalCount` 의 주문 select 를 `'wbs_item_id, claimed_by_user_id'` 로 넓히고, `countApprovable(rows, items, { isAdmin: false, memberIds, userId: actor.userId })` 로 부른다. `countApprovable` 은 주문마다 `canApproveCompletion({ isAdmin: false, subtreeManager: isSubtreeManagerOf(…), assigneeMine: 리프 담당자 ∈ mine, claimedByMe: o.claimed_by_user_id === viewer.userId })` 를 센다. 리프가 트리에 없으면 세지 않는다(서버의 `leafFound` 거부와 같다).

- [ ] **Step 6: 통과·회귀** — `npx vitest run tests/agent tests/actions tests/domain tests/components tests/data --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "requireSubtreeManagerOrAdmin" src/app/actions/agentWork.ts` 는 `loadOrderForReview` 한 곳만 남는다.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/agent/assignee.ts src/lib/agent/subtreeManager.ts src/app/actions/agentWork.ts src/lib/domain/seatmap.ts src/lib/domain/agentHub.ts src/components/agent-hub/ApprovalQueue.tsx src/components/agent-hub/DelegationTable.tsx src/components/agents/seatOps.ts src/lib/data/agentApprovals.ts tests/agent/subtree-manager.test.ts tests/actions/agent-work-actions.test.ts tests/domain/seatmap.test.ts tests/domain/agent-hub.test.ts tests/components/agents-seat-ops.test.ts tests/components/agent-hub-queue.test.tsx tests/data/agent-approvals.test.ts
git status --short tests   # tsc 가 알려 준 픽스처(canApprove 필수 필드)를 고쳤다면 그 파일도 이름으로 stage
git commit -m "fix(agent): 자기 담당·자기 착수 완료는 스스로 승인하지 못한다 — 승인 가드와 버튼·배지·좌석이 같은 판정

승인 자격이 strict 조상만 봐서, 부모와 리프의 담당자가 같거나 미배정 리프를 내가 claim 했으면 서브트리 관리자 자격으로
자기 완료를 승인할 수 있었다. 주석이 말한 분리 원칙이 시행되지 않았다(제7부 AUTH-07a). 비관리자는 그 리프의 담당자
본인이거나 그 주문의 claim 계정이면 승인을 거부한다. 반려·재작업은 그대로 열어 둔다. 레거시 비밀로 claim 한 주문
(claimed_by_user_id null)은 claim 계정을 알 수 없어 담당자 검사만 받는다 — SP7 자격증명 행에서 닫는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

한계(보고서에도 적는다): 레거시 비밀 claim 주문은 담당자 검사만 받는다(→ SP7). 관리자의 자기 승인 금지(AUTH-07b)는 비목표다(개정 스펙 SP5b 범위 제외).

### Task 16: 산출물 첨부 정직화 — 목록 실패는 오류로, 다운로드 링크는 Storage 정책이 허락할 때만 (P7-2-DL)

항목: 제7부 P7-2-DL(원장 §1). UI 위험 파일 없음(`src/components/wbs/*`·`src/components/ui/*`). 마이그레이션 없음. **과제 9 다음**이다 — 과제 9 가 만든 `LoadErrorNotice` 를 재사용하고 선택 prop `onRetry` 를 더한다.

결함: `listAttachments`(`attachments.ts:38-66`)는 로그인만 확인하고 select 오류를 버린다(`:46-50` — `data` 만 읽는다). 비로그인은 로그 후 `[]`(`:41-44`), 서명 실패도 `url: null` 로 삼킨다(`:53`). 화면(`RowDetailPanel.tsx:728`)은 예외를 `[]` 로 바꾸고 `href={a.url ?? '#'}`(`:788`)로 죽은 링크를 그린다. 다운로드(서명)는 Storage 읽기 정책 `can_attach`(`0007_storage_realtime.sql:86-88`)를 통과해야 하는데 목록은 전 멤버에게 열려 있어, 조회 전용 사용자에게 눌러도 안 열리는 링크가 보인다. 다운로드 = `can_attach` 는 정본 `:860` 에서 결정됐고 개정 스펙 §8.2 ② 가 유지를 확정했다.

**Files:**
- Modify: `src/app/actions/attachments.ts`(`listAttachments` :38-66), `src/lib/domain/types.ts`(`DeliverableAttachment` :87-96 에 `linkError?: boolean`), `src/components/wbs/RowDetailPanel.tsx`(`AttachmentSection` :718-795), `src/components/ui/LoadErrorNotice.tsx`(선택 prop `onRetry`), `src/lib/i18n/dict/wbs{,.en}.ts`
- Test: `tests/actions/attachments-list.test.ts`(신설), `tests/components/wbs-row-detail-attachments.test.tsx`(신설 — `tests/components/wbs-row-detail-overview.test.tsx` 의 렌더·목 관례), 목 5개의 `listAttachments` 반환 모양: `tests/ui/wbs-subact-add.test.tsx:19`, `tests/ui/wbs-leaf-actual.test.tsx:19`, `tests/components/wbs-row-detail-overview.test.tsx:17`, `tests/components/wbs-deliverable-upload-path.test.tsx:23`, `tests/components/wbs-dependency-readiness-panel.test.tsx:22`

**Interfaces:**
```ts
// src/app/actions/attachments.ts ('use server' — 문구 상수는 export 하지 않고 모듈 안 const 로 둔다. 타입 export 는 된다)
export type AttachmentDownload = 'allowed' | 'denied' | 'unknown'
export type AttachmentList =
  | { ok: true; rows: DeliverableAttachment[]; download: AttachmentDownload }
  | { ok: false; error: string }        // 비로그인·select 오류. 로그를 남긴다
export async function listAttachments(itemId: string): Promise<AttachmentList>
// 다운로드 판정: sb.rpc('can_attach', { item: itemId }) 1회 — Storage 읽기 정책과 같은 함수(0003:315, authenticated EXECUTE).
//   true → 'allowed', false → 'denied', 오류 → 'unknown'(로그. fail-closed — 서명하지 않는다)
// 서명: 'allowed' ∧ 행 ≥ 1 일 때만 createSignedUrls(경로 배열, 3600) 1회. 행별 실패는 그 행 url null + linkError true.
//   호출 전체가 실패하면 모든 행 linkError(로그). TTL 3600 은 현행 유지다(회의록 TTL 은 과제 18).

// src/lib/domain/types.ts
interface DeliverableAttachment { …; url?: string | null; linkError?: boolean }

// src/components/ui/LoadErrorNotice.tsx — onRetry 가 있으면 router.refresh() 대신 그것을 부른다(클라이언트 로더 재시도)
export function LoadErrorNotice({ message, retry = true, onRetry }: { message: string; retry?: boolean; onRetry?: () => void }): JSX.Element
```
`canAttach` prop 은 업로드·삭제 어포던스에만 쓴다. 다운로드 판정에는 쓰지 않는다 — `WbsGanttSheet.tsx:2079` 의 `canAttach={!readOnly && …}` 는 읽기 전용 보기에서 false 라 다운로드 가능 여부와 다르다.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 9 가 HEAD 에 있다(`test -f src/components/ui/LoadErrorNotice.tsx && echo ok`). `grep -rn "listAttachments" src tests` 결과를 적어 둔다(계획 작성 시점: 액션·`RowDetailPanel`, 테스트 목 5개).

- [ ] **Step 1: 테스트 먼저 — 액션**

`tests/actions/attachments-list.test.ts`(신설). `tests/actions/attachments-path.test.ts` 의 목 관례(`@/lib/auth`·`@/lib/authz`·`@/lib/supabase/server`)를 쓴다. 가짜 서버 클라이언트가 `from('deliverable_attachments')` 체인(`select`·`eq`·`order` → thenable), `rpc('can_attach', …)`, `storage.from('deliverables').createSignedUrls(paths, 3600)` 를 흉내 내고 호출을 기록한다.
- (a) `can_attach` false(조회 전용) → `{ ok: true, rows: [행], download: 'denied' }`, 행 `url` null, `createSignedUrls` 미호출.
- (b) select 오류 → `{ ok: false, error: '첨부 목록을 불러오지 못했습니다.' }` + `console.error` 1회, rpc·서명 미호출.
- (c) rpc 오류 → `download: 'unknown'`, 서명 미호출, 로그.
- (d) 비로그인 → `ok: false`(로그), DB 미호출.
- (e) `can_attach` true, 두 행 중 하나만 서명 실패 → `createSignedUrls` 1회(경로 2개), 실패한 행만 `linkError: true`·`url: null`.
- (f) 행 0개 + allowed → 서명 미호출, `{ ok: true, rows: [], download: 'allowed' }`.

- [ ] **Step 2: 테스트 먼저 — 화면**

`tests/components/wbs-row-detail-attachments.test.tsx`(신설): `RowDetailPanel` 을 `wbs-row-detail-overview.test.tsx` 와 같은 목으로 그리고, `listAttachments` 목이 케이스마다 결과를 준다.
- `denied` → 파일명은 보이지만 링크가 아니다(`a[href="#"]` 0개, 파일명 요소가 `<a>` 가 아님). `wbs.attachDownloadDenied` 안내가 보인다.
- `ok: false` → `[role="alert"]` 에 오류 문구. 재시도 버튼을 누르면 `listAttachments` 가 한 번 더 불린다(`onRetry`).
- `unknown` → `wbs.attachDownloadUnknown` 경고와 재시도, 링크 없음.
- `allowed` + url → `<a href="https://signed.example.com/…">`. `linkError` 행은 링크 없이 `wbs.attachLinkFail`.
- `listAttachments` 가 던지면 오류 상태다(빈 목록 문구가 아니다).
목 5개는 `{ ok: true, rows: [], download: 'allowed' }` 를 돌려주게 바꾼다.

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/actions/attachments-list.test.ts tests/components/wbs-row-detail-attachments.test.tsx` → FAIL.

- [ ] **Step 4: 구현 — 액션**

```ts
const ERR_LIST = '첨부 목록을 불러오지 못했습니다.'

/**
 * 항목의 첨부 목록(최신순)과 다운로드 판정. 목록은 그 항목을 읽을 수 있으면 보이고(RLS), 다운로드(서명)는 Storage 읽기 정책과
 * 같은 can_attach 로 판정한다 — 조회 전용 사용자에게 막힐 링크를 주지 않는다(정본 :860, 개정 스펙 §8.2 ②).
 * 조회 실패를 빈 목록으로 위장하지 않는다(3원칙 ①). 판정 오류는 unknown 으로 두고 서명하지 않는다(fail-closed).
 */
export async function listAttachments(itemId: string): Promise<AttachmentList> {
  if (!(await getSession())) {
    console.error('[listAttachments] 비로그인 호출')
    return { ok: false, error: ERR_LIST }
  }
  const sb = await createServerClient()
  const { data, error } = await sb.from('deliverable_attachments').select('*')
    .eq('wbs_item_id', itemId).order('created_at', { ascending: false })
  if (error) {
    console.error('[listAttachments] 첨부 조회 실패:', error.message)
    return { ok: false, error: ERR_LIST }
  }
  const { data: can, error: canErr } = await sb.rpc('can_attach', { item: itemId })
  if (canErr) console.error('[listAttachments] 다운로드 권한 판정 실패 — 서명하지 않는다:', canErr.message)
  const download: AttachmentDownload = canErr ? 'unknown' : can === true ? 'allowed' : 'denied'
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const urlOf = new Map<string, string | null>()
  let signFailed = false
  if (download === 'allowed' && rows.length > 0) {
    const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
      .createSignedUrls(rows.map(r => r.file_path as string), 3600)
    if (signErr) { console.error('[listAttachments] 서명 URL 일괄 발급 실패:', signErr.message); signFailed = true }
    for (const s of signed ?? []) if (s.path) urlOf.set(s.path, s.error ? null : s.signedUrl)
  }
  return {
    ok: true, download,
    rows: rows.map(r => {
      const url = download === 'allowed' && !signFailed ? (urlOf.get(r.file_path as string) ?? null) : null
      return {
        id: r.id as string, wbsItemId: r.wbs_item_id as string, fileName: r.file_name as string,
        filePath: r.file_path as string, size: (r.size as number) ?? null, mime: (r.mime as string) ?? null,
        createdAt: r.created_at as string, url,
        ...(download === 'allowed' && url === null ? { linkError: true } : {}),
      }
    }),
  }
}
```

- [ ] **Step 5: 구현 — 화면**

- `LoadErrorNotice.tsx`: `onRetry?: () => void` 를 받아 버튼의 `onClick` 을 `onRetry ?? (() => router.refresh())` 로 둔다. 기존 호출(과제 9)은 그대로다.
- `RowDetailPanel.tsx` `AttachmentSection`:
  - 상태를 `useState<AttachmentList | null>(null)` 로 바꾼다. `load` 의 `.catch` 는 `console.error` 후 `setList({ ok: false, error: t('wbs.attachLoadFail') })` 다(빈 목록이 아니다).
  - `list === null` → 로딩, `!list.ok` → `<LoadErrorNotice message={list.error} onRetry={() => { setList(null); load() }} />`, 행 0 → 종전 빈 문구.
  - 행이 있으면 `download === 'denied'` 일 때 목록 위에 `t('wbs.attachDownloadDenied')`(보조 글자), `'unknown'` 이면 `<LoadErrorNotice message={t('wbs.attachDownloadUnknown')} onRetry={…} />`.
  - 각 행: `list.download === 'allowed' && a.url` 이면 종전 `<a href={a.url} target="_blank" rel="noreferrer">`, 아니면 같은 자리 `<span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={a.fileName}>`. `a.linkError` 면 크기 옆에 `<span className="shrink-0 text-[11px] text-delayed">{t('wbs.attachLinkFail')}</span>`. **`'#'` 링크는 두지 않는다.**
  - 업로드·삭제 버튼은 종전대로 `canAttach` 로만 가린다.
- i18n(ko·en 양쪽): `wbs.attachLoadFail`('첨부 목록을 불러오지 못했습니다.' / 'Could not load attachments.'), `wbs.attachDownloadDenied`('다운로드는 담당 팀과 관리자만 할 수 있습니다.' / 'Only the owning team and admins can download.'), `wbs.attachDownloadUnknown`('다운로드 권한을 확인하지 못했습니다 — 다시 시도하세요.' / 'Could not check download permission — try again.'), `wbs.attachLinkFail`('링크 생성 실패' / 'Link failed').

- [ ] **Step 6: 통과·회귀** — `npx vitest run tests/actions tests/components tests/ui --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "?? '#'" src/components/wbs` → 0건.

- [ ] **Step 7: 커밋**

```bash
git add src/app/actions/attachments.ts src/lib/domain/types.ts src/components/wbs/RowDetailPanel.tsx src/components/ui/LoadErrorNotice.tsx src/lib/i18n/dict/wbs.ts src/lib/i18n/dict/wbs.en.ts tests/actions/attachments-list.test.ts tests/components/wbs-row-detail-attachments.test.tsx tests/ui/wbs-subact-add.test.tsx tests/ui/wbs-leaf-actual.test.tsx tests/components/wbs-row-detail-overview.test.tsx tests/components/wbs-deliverable-upload-path.test.tsx tests/components/wbs-dependency-readiness-panel.test.tsx
git commit -m "fix(wbs): 산출물 첨부 목록 실패를 빈 목록으로 두지 않고, 다운로드 링크는 Storage 정책(can_attach)이 허락할 때만

목록 액션이 select 오류를 버리고 비로그인·서명 실패를 빈 결과로 돌려줬다. 화면은 예외를 [] 로 바꾸고 '#' 링크를 그렸다.
조회 전용 사용자에게는 눌러도 열리지 않는 링크가 보였다. 결과형으로 실패를 드러내고, 다운로드는 Storage 읽기 정책과 같은
can_attach RPC 로 판정한다(오류면 unknown — 막는다). 조회 전용의 다운로드 불가는 현행 결정 그대로다(정본 :860).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 17: 회의록 상세 정직화 — 파일 목록 실패를 드러내고, 관리 버튼은 서버와 같은 판정으로 (P8-H1-2·H1-3)

항목: 제8부 P8-H1-2·P8-H1-3(원장 §1). UI 위험 파일 없음. 마이그레이션 없음. **과제 9 다음**이다(같은 `minutes{,.en}.ts` 사전, 로더 결과형 관례).

결함:
- `getMinuteDetail`(`data/minutes.ts:161-198`)은 파일 목록 조회 실패를 로그만 남기고 빈 목록으로 진행한다(`:179-181`). 뷰어는 첨부·본문 파일이 '없는' 회의록으로 그린다. `tests/minutes/read-parallel.test.ts:120-132` 가 이 동작을 고정한다.
- 상세 페이지 `canManage`(`minutes/[id]/page.tsx:75-79`)에는 멤버 전제가 없어 명단에서 빠진 작성자에게도 버튼이 열린다. 관리자 판정도 `detail.minute.projectId`(회의 폴백 — `data/minutes.ts:64-65`)로 한다. 서버 `checkOwner` 는 `canEditMinute`(`authz.ts:114-119`, 행의 `project_id`)라 화면이 연 버튼을 서버가 거부한다.

**Files:**
- Modify: `src/lib/data/minutes.ts`(`getMinuteDetail`), `src/app/(app)/minutes/[id]/page.tsx`(`canManage` :75-79, `files`·`filesError` 전달, `isProjectAdmin` import 삭제), `src/components/minutes/MinuteViewer.tsx`(prop `filesError`, 머리 영역 경고 한 줄), `src/lib/i18n/dict/minutes{,.en}.ts`
- Test: `tests/minutes/read-parallel.test.ts`(:120-132 뒤집기, 성공 케이스의 `.files` 모양), `tests/ui/roster-load-error-pages.test.tsx`(회의록 상세 목 반환 모양 + 관리 어포던스 네 경우), `tests/ui/minute-viewer-files-error.test.tsx`(신설 — `tests/ui/minute-viewer-folder-path.test.tsx` 의 목 관례), `fetchMinuteDetail` 목(`tests/ui/minutes-explorer-leaf-edit.test.tsx:19` 등 tsc 가 알려 주는 곳)

**Interfaces:**
```ts
// src/lib/data/minutes.ts (서버 데이터 모듈 — 상수 export 가능)
export const ERR_MINUTE_FILES_LOAD = '첨부 목록을 불러오지 못했습니다.'
export type MinuteFilesResult = { ok: true; rows: MinuteFile[] } | { ok: false; error: string }
export const getMinuteDetail: (id: string) => Promise<{ minute: Minute; files: MinuteFilesResult } | null>
// 본문 조회 실패 = throw, 행 없음 = null 은 그대로. 파일 실패 = { ok: false, error: ERR_MINUTE_FILES_LOAD } + 로그.
// fetchMinuteDetail(actions/minutes.ts:846) 은 이 모양을 그대로 넘긴다 — 소비처 MinutesExplorer 는 .minute 만 읽는다.

// MinuteViewer props
files: MinuteFile[]              // 그대로(실패면 [])
filesError?: string | null       // 신설 — 실패 사유. historicalVersion 이면 그리지 않는다

// src/app/(app)/minutes/[id]/page.tsx — 서버 checkOwner 와 같은 판정(행의 project_id·workspace_id, 회의 폴백 아님)
const canManage = !requestedVersion && !detail.minute.archivedAt
  && !!detail.minute.workspaceId
  && canEditMinute(m, {
    created_by: detail.minute.createdBy ?? null,
    project_id: detail.minute.ownProjectId ?? null,
    workspace_id: detail.minute.workspaceId,
  })
```
'내용 .md' 버튼(`MinuteViewer.tsx:728-732`, `downloadBodyMd`)은 그대로 둔다 — 파일 목록이 실패해도 본문 텍스트는 받을 수 있다.

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 9 가 HEAD 에 있다(`grep -c "minutes.meetingsLoadFailed" src/lib/i18n/dict/minutes.ts` 가 1). `grep -rn "getMinuteDetail(\|fetchMinuteDetail(" src tests` 결과를 적어 둔다.

- [ ] **Step 1: 테스트 먼저**

- `tests/minutes/read-parallel.test.ts:120-132` 를 뒤집는다: 파일 조회 오류 → `result.files` 가 `{ ok: false, error: ERR_MINUTE_FILES_LOAD }`, 로그 1회, `result.minute` 은 그대로. 성공 케이스의 `.files` 단언은 `{ ok: true, rows: [...] }` 로 읽는다.
- `tests/ui/roster-load-error-pages.test.tsx`: `getMinuteDetail` 목(:46-50)을 `mocks.getMinuteDetail` 로 올리고, 기본 반환을 `{ minute: { …, workspaceId: WS, ownProjectId: PID }, files: { ok: true, rows: [] } }` 로 바꾼다(`WS` 는 `../fixtures/actor`). `describe('회의록 상세 — 관리 어포던스(canManage)는 서버 checkOwner 와 같다')` 를 더한다.
  - 명단 없는 작성자: 액터 `makeActor({ userId: 'u1' })`(워크스페이스 member, 명단 없음), 작성자 `u1`, `ownProjectId: PID` → 뷰어 props `canManage === false`.
  - 액터 null → `false`.
  - 회의 폴백 프로젝트의 관리자: `ownProjectId: null`, `projectId: PID`(회의 폴백), 작성자 `u9`, 액터 `makeAdminActor(PID)` → `false`(무프로젝트 회의록은 슈퍼유저만 — SP1 스펙 §3.5).
  - 멤버인 작성자: `makeMemberActor(PID)`(userId `u1`), 작성자 `u1`, `ownProjectId: PID` → `true`.
  - 파일 실패: `files: { ok: false, error: ERR_MINUTE_FILES_LOAD }` → 뷰어 props `files` 는 `[]`, `filesError` 는 그 문구.
- `tests/ui/minute-viewer-files-error.test.tsx`(신설): `filesError="…"` → `[role="alert"]` 에 사전 키 `min.detail.filesLoadFailed` 가 있고 '내용 .md' 버튼(`min.detail.downloadBody`)이 있다. `historicalVersion` 을 주면 경고가 없다. 픽스처 팀 코드는 `PMO` 처럼 중립 값을 쓴다.

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/minutes/read-parallel.test.ts tests/ui/roster-load-error-pages.test.tsx tests/ui/minute-viewer-files-error.test.tsx` → FAIL.

- [ ] **Step 3: 구현**

`getMinuteDetail`:
```ts
  // 파일 목록은 부가 정보라 본문은 계속 보여 준다. 다만 실패를 빈 목록으로 위장하지 않는다(3원칙 ①) — 뷰어가 경고를 띄운다.
  let files: MinuteFilesResult
  if (fsErr) {
    console.error('[getMinuteDetail] 파일 목록 조회 실패:', fsErr.message)
    files = { ok: false, error: ERR_MINUTE_FILES_LOAD }
  } else {
    files = { ok: true, rows: (fs ?? []).map((f: Row) => ({ /* 종전 매핑 그대로 */ })) }
  }
```
머리 주석 "파일 목록(서명 URL 없이 메타만)"은 그대로 두고, "본문이 실패·부재면 파일 결과는 버린다" 문장은 유지한다.

`page.tsx`: 위 Interfaces 의 `canManage` 로 바꾸고 `import { canEditMinute } from '@/lib/domain/authz'` 로 교체한다(`isProjectAdmin` import 삭제). 주석(:75)은 "서버 checkOwner 와 같은 canEditMinute — 행의 project_id·workspace_id 로 판정한다(회의 폴백 projectId 아님). 멤버가 아닌 작성자·무프로젝트 회의록의 비슈퍼유저에게는 버튼을 열지 않는다" 로 바꾼다. 뷰어에는 `files={detail.files.ok ? detail.files.rows : []} filesError={detail.files.ok ? null : detail.files.error}` 를 넘긴다(이슈 명단의 `issueMembers`·`issueMembersError` 와 같은 관례).

`MinuteViewer.tsx`: `filesError?: string | null` 을 받는다. `{err && …}`(:774) 옆에 `{filesError && !historicalVersion && <p role="alert" className="text-sm text-delayed">{t('min.detail.filesLoadFailed')}</p>}` 를 둔다. i18n(ko·en): `min.detail.filesLoadFailed`('첨부 목록을 불러오지 못했습니다 — 새로고침하세요.' / 'Could not load attachments — refresh the page.').

- [ ] **Step 4: 통과·회귀** — `npx vitest run tests/minutes tests/ui --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -n "isProjectAdmin" "src/app/(app)/minutes/[id]/page.tsx"` → 0건.

- [ ] **Step 5: 로컬 확인(UI 위험 파일 아님 — 동작 확인)** — `npm run dev -- -p 3101`. 명단 member 인 작성자와 다른 프로젝트 관리자 계정으로 같은 회의록 상세를 열어, 앞의 계정에게만 공유·수정·본문 교체·삭제 버튼이 보이는지 확인한다. 끝나면 서버를 내린다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/data/minutes.ts "src/app/(app)/minutes/[id]/page.tsx" src/components/minutes/MinuteViewer.tsx src/lib/i18n/dict/minutes.ts src/lib/i18n/dict/minutes.en.ts tests/minutes/read-parallel.test.ts tests/ui/roster-load-error-pages.test.tsx tests/ui/minute-viewer-files-error.test.tsx
git status --short tests   # tsc 가 알려 준 fetchMinuteDetail 목을 고쳤다면 그 파일도 이름으로 stage
git commit -m "fix(minutes): 상세의 파일 목록 실패를 빈 목록으로 두지 않고, 관리 버튼은 서버 checkOwner 와 같은 canEditMinute 로

파일 목록 조회가 실패하면 로그만 남기고 첨부가 없는 회의록처럼 그렸다. 관리 버튼은 멤버 전제 없이 작성자에게 열렸고,
회의 폴백 프로젝트의 관리자에게도 열렸다 — 서버는 행의 project_id 로 판정하므로 누르면 거부됐다. 로더가 파일 결과를
결과형으로 돌려주고 뷰어가 경고를 띄운다. 버튼은 canEditMinute(행의 project_id·workspace_id)로 판정한다.
탐색기 canMoveLeaf 의 같은 결함은 SP5 Phase B 에서 맞춘다(개정 스펙).

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

범위 밖(후속 기록): `MinutesExplorer.tsx:217` `canMoveLeaf` 가 같은 결함(회의 폴백 프로젝트·멤버 전제 없음)을 가진다 — 개정 스펙 SP5 Phase B 에 적었다.

### Task 18: 회의록 서명 URL 60초·클릭 시 발급, 첨부 삭제는 Storage 삭제를 확인한 뒤 (P8-H1-4, P8-H1-1 최소)

항목: 제8부 P8-H1-4, P8-H1-1(최소 수정 — 근본 수정은 H2-g 의 버킷 entity 별 정책). UI 위험 파일 없음. 마이그레이션 없음. **과제 17 다음**이다(`data/minutes.ts`·`MinuteViewer.tsx`·`minutes{,.en}.ts`). `actions/minutes.ts` 는 과제 9 가 먼저 고친다.

결함:
- 회의록 파일 서명 URL 이 3600초다(`actions/minutes.ts:867`, 버전 파일 `data/minutes.ts:264-274`). 버전 파일은 상세 화면을 그릴 때마다 전부 서명한다 — 권한을 회수해도 이미 받은 페이지의 링크가 1시간 산다. 이 회수 창이 어디에도 적혀 있지 않다.
- `removeMinuteFile`(`actions/minutes.ts:790-812`)은 Storage `remove` 결과를 보지 않고(`:806-807` 은 오류만 로그) 행을 지운다. `remove` 는 RLS 가 막아도 오류 없이 빈 배열을 돌려준다. 버킷 삭제 정책("minutes bucket delete": 소유자 ∨ 워크스페이스 관리자, `0007_storage_realtime.sql`)이 행 삭제 정책(`can_manage_minute` — 프로젝트 관리자 포함, `0007:116-123`)보다 좁아, 프로젝트 관리자가 남의 첨부를 지우면 행만 사라지고 객체가 고아로 남는다. 지금은 UI 에 첨부 삭제 진입점이 없어 도달하지 않는다(호출처는 `tests/actions/minutes-workspace-scope.test.ts:343` 뿐) — 그래서 실패를 드러내는 최소 수정만 하고 service_role 로 우회하는 경로는 만들지 않는다.

**Files:**
- Modify: `src/lib/domain/minutes.ts`(TTL 상수 — `actions/minutes.ts:1` 이 `'use server'` 라 거기서는 상수를 export 할 수 없다), `src/app/actions/minutes.ts`(`getMinuteFileUrl` :852-870, 신설 `getMinuteVersionFileUrl`, `removeMinuteFile` :790-812), `src/lib/data/minutes.ts`(`getMinuteVersions` :250-287 — 서명 제거), `src/components/minutes/MinuteVersionPanel.tsx`(`downloadHref` → `hasFile` + `onDownload`), `src/components/minutes/MinuteViewer.tsx`(두 패널 :802-806·:815-819 에 `onDownload`), `src/lib/i18n/dict/minutes{,.en}.ts`
- Test: `tests/actions/minutes-workspace-scope.test.ts`(TTL·버전 URL·삭제 — `fakeClient` 확장), `tests/minutes/versions-lazy-sign.test.ts`(신설 — `tests/minutes/read-parallel.test.ts` 의 `queryBuilder` 관례), `tests/ui/minute-version-download.test.tsx`(신설 — `tests/ui/minute-version-panel-collapse.test.tsx` 의 렌더 관례), 버전 픽스처에 `downloadHref` 가 있으면 `hasFile` 로(tsc 가 알려 주는 곳)

**Interfaces:**
```ts
// src/lib/domain/minutes.ts
/** 회의록 파일 서명 URL 의 유효 시간(초). 발급할 때마다 RLS("minutes bucket read")를 다시 검사한다 — 권한을 회수하면
 *  새 URL 은 즉시 막히지만 이미 발급한 URL 은 이 시간까지 유효하다(회수 창). 보관(archived) 상태는 발급을 막지 않는다 —
 *  보관은 편집 잠금이지 열람 잠금이 아니다. actions/minutes.ts 는 'use server' 라 상수를 여기 둔다. */
export const MINUTE_FILE_URL_TTL_SEC = 60

// src/app/actions/minutes.ts
export async function getMinuteFileUrl(fileId: string): Promise<{ ok: boolean; url?: string; error?: string }>   // TTL 만 바뀐다
export async function getMinuteVersionFileUrl(minuteId: string, versionId: string):
  Promise<{ ok: true; url: string } | { ok: false; error: string }>
// 세션 클라이언트(RLS)로 minute_versions(file_path, file_name)를 minute_id·id 로 읽고 같은 TTL·download 이름으로 서명한다.
// 비로그인 '로그인 필요', 조회 오류 FILE_LOOKUP_FAILED_MSG(로그), 행·파일 없음 '원본 파일이 없습니다.', 서명 실패 'URL 발급 실패'(로그).
export async function removeMinuteFile(fileId: string): Promise<MinuteActionResult>   // 모양 불변, 판정만 정직해진다

// src/components/minutes/MinuteVersionPanel.tsx
export type MinuteVersionListItem = { …; fileName?: string | null; hasFile?: boolean; viewHref?: string | null }   // downloadHref 삭제
export type MinuteVersionPanelProps = {
  …; onDownload?: (versionId: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
}
// src/lib/data/minutes.ts getMinuteVersions — 서명하지 않는다. hasFile = file_path 가 있다. MinuteViewer 가
// onDownload={versionId => getMinuteVersionFileUrl(minute.id, versionId)} 를 두 패널에 넘긴다.
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 과제 17 이 HEAD 에 있다(`grep -c "ERR_MINUTE_FILES_LOAD" src/lib/data/minutes.ts` 가 1 이상). `grep -rn "createSignedUrl\|downloadHref\|removeMinuteFile" src tests` 결과를 적어 둔다.

- [ ] **Step 1: 테스트 먼저 — 액션**(`tests/actions/minutes-workspace-scope.test.ts`)

- `fakeClient`(:98-110)를 넓힌다. (1) 표 결과에 배열 큐(`TableResult[]`)를 허용한다 — 같은 표를 여러 번 부르면 순서대로 꺼내고 마지막 값을 유지한다. (2) `storage.from(bucket)` 이 `createSignedUrl`·`remove` 호출을 `storageCalls` 에 기록하고 주입한 결과를 돌려준다. 기존 케이스는 단일 결과 그대로 통과해야 한다.
- `getMinuteFileUrl`: `createSignedUrl(path, 60, { download: 'a.pdf' })` 로 호출된다(`MINUTE_FILE_URL_TTL_SEC`).
- `getMinuteVersionFileUrl(M, 'v-1')`: `minute_versions` 행의 `file_path`·`file_name` 으로 같은 TTL·download 서명을 한다. `file_path` null → `{ ok: false, error: '원본 파일이 없습니다.' }`, 서명 미호출. 조회 오류 → 조회 실패 문구(`FILE_DOWN`), 서명 미호출.
- `removeMinuteFile`(액터 `inA`, 작성자 본인이라 `checkOwner` 통과):
  - `remove → { data: [], error: null }` → `ok: false`(첨부 삭제 실패 문구), `db.calls.minute_files` 에 `delete` 가 없다.
  - `remove → 1건`, 행 삭제 `select('id')` → `[]` → `ok: false`(기록 삭제 실패 문구).
  - `remove → 1건`, 행 삭제 → `[{ id: 'file-1' }]` → `{ ok: true }`.

- [ ] **Step 2: 테스트 먼저 — 버전 목록·패널**

- `tests/minutes/versions-lazy-sign.test.ts`(신설): 가짜 클라이언트에 `storage` 를 두지 않는다 — `getMinuteVersions` 가 접근하면 곧 실패한다. 결과의 `hasFile` 은 `file_path` 유무이고 `downloadHref` 필드가 없다.
- `tests/ui/minute-version-download.test.tsx`(신설): `hasFile: true` + `onDownload` 가 `{ ok: true, url }` → 버튼을 누르면 `window.open(url, '_blank', 'noopener,noreferrer')` 1회. `{ ok: false, error }` → `[role="alert"]` 에 사유. `hasFile: false` → 버튼 없이 `min.version.noFile`. `onDownload` 가 없으면 버튼이 없다.

- [ ] **Step 3: 실패 확인** — `npx vitest run tests/actions/minutes-workspace-scope.test.ts tests/minutes/versions-lazy-sign.test.ts tests/ui/minute-version-download.test.tsx` → FAIL.

- [ ] **Step 4: 구현 — 상수·액션**

- `domain/minutes.ts` 에 위 상수를 둔다.
- `getMinuteFileUrl`: `3600` 을 `MINUTE_FILE_URL_TTL_SEC` 로, 머리 주석 "(3600초)" 를 "(MINUTE_FILE_URL_TTL_SEC — 발급 때 RLS 재검사, 회수 창 = TTL)" 로.
- `getMinuteVersionFileUrl`: 위 Interfaces 대로 `getMinuteFileUrl` 과 같은 모양으로 쓴다(`getSession` → 세션 클라이언트 조회 → 서명).
- `removeMinuteFile` 의 Storage 삭제부(:805-809)를 다음으로 바꾼다.
  ```ts
  // remove 는 RLS 가 막아도 오류 없이 빈 배열을 돌려준다 — 0건을 성공으로 읽고 행을 지우면 고아 객체가 남는다(P8-H1-1).
  // 권한 불일치(버킷 삭제 = 소유자·ws 관리자, 행 삭제 = can_manage_minute)의 근본 수정은 H2-g 다. 여기서는 실패를 드러낸다.
  const { data: removed, error: rmErr } = await sb.storage.from(BUCKET).remove([f.file_path as string])
  if (rmErr || (removed ?? []).length !== 1) {
    console.error('[removeMinuteFile] Storage 삭제 실패 — 행을 남긴다:', rmErr?.message ?? `${(removed ?? []).length}건 삭제`)
    return { ok: false, error: '첨부 파일을 지우지 못했습니다 — 권한이나 저장소 상태를 확인한 뒤 다시 시도하세요.' }
  }
  const { data: gone, error } = await sb.from('minute_files').delete().eq('id', fileId).select('id')
  if (error) return { ok: false, error: error.message }
  if ((gone ?? []).length === 0) {
    console.error('[removeMinuteFile] 행 삭제 0건(객체는 지워짐):', fileId)
    return { ok: false, error: '첨부 기록을 지우지 못했습니다 — 새로고침한 뒤 확인하세요.' }
  }
  ```

- [ ] **Step 5: 구현 — 버전 목록·패널**

- `getMinuteVersions`: 서명 블록(:264-274)을 지우고 `hasFile: filePath !== null` 을 싣는다. 머리 주석 "파일이 있으면 한 시간 유효한 다운로드 URL을 함께 발급한다" 를 "서명하지 않는다 — 원본 파일은 클릭할 때 getMinuteVersionFileUrl 로 발급한다(TTL MINUTE_FILE_URL_TTL_SEC)" 로 바꾼다. `Promise.all(… async …)` 은 동기 `map` 이 된다.
- `MinuteVersionPanel.tsx`: `downloadHref` 를 `hasFile` 로 바꾸고 `onDownload` 를 받는다. `hasFile && onDownload` 면 종전 링크 자리에 같은 모양의 `<button type="button">` 을 두고, 누르면 `onDownload(version.id)` → `ok` 면 `window.open(url, '_blank', 'noopener,noreferrer')`, 아니면 그 항목 아래 `<p role="alert" className="mt-1 text-xs text-delayed">{error}</p>`. 진행 중에는 버튼을 잠근다. `!hasFile` 이면 종전 `min.version.noFile` 문구다.
- `MinuteViewer.tsx`: 두 패널에 `onDownload={versionId => getMinuteVersionFileUrl(minute.id, versionId)}` 를 넘긴다(import 는 기존 `@/app/actions/minutes` 묶음에).
- i18n(ko·en): 실패 문구는 액션이 돌려준 것을 그대로 쓴다. 버튼 이름표 `min.version.downloadAria`('원본 파일 받기' / 'Download original file').

- [ ] **Step 6: 통과·회귀** — `npx vitest run tests/actions tests/minutes tests/ui --reporter=dot 2>&1 | tail -3 && npm run typecheck && npm run lint` → 실패 0. `grep -rn "createSignedUrl" src/lib/data/minutes.ts` → 0건, `grep -rn "3600" src/app/actions/minutes.ts` → 0건.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/domain/minutes.ts src/app/actions/minutes.ts src/lib/data/minutes.ts src/components/minutes/MinuteVersionPanel.tsx src/components/minutes/MinuteViewer.tsx src/lib/i18n/dict/minutes.ts src/lib/i18n/dict/minutes.en.ts tests/actions/minutes-workspace-scope.test.ts tests/minutes/versions-lazy-sign.test.ts tests/ui/minute-version-download.test.tsx
git status --short tests   # 버전 픽스처(downloadHref → hasFile)를 고쳤다면 그 파일도 이름으로 stage
git commit -m "fix(minutes): 회의록 파일 서명 URL 을 60초·클릭 시 발급으로, 첨부 삭제는 Storage 삭제 1건을 확인한 뒤에만

서명 URL 이 3600초였고 버전 원본은 화면을 그릴 때마다 서명돼, 권한을 회수해도 받은 링크가 1시간 살았다(회수 창이
문서에도 없었다). 발급 때 RLS 를 다시 보므로 TTL 을 60초로 줄이고 버전 원본은 누를 때 발급한다. 첨부 삭제는
remove 가 RLS 에 막혀도 빈 배열만 돌려주는데 그 결과를 보지 않고 행을 지웠다 — 이제 1건이 아니면 행을 남기고 실패로 답한다.
권한 불일치의 근본 수정은 H2(버킷 정책 entity 별 분리)다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 마무리

### Task 14: 정본 스펙에 선반영·오기 정정 기록 — 진행 중인 스펙 개정과 한 번에 대조

과제 1~13·15~18 이 스펙 문장을 선반영했거나, 스펙의 옛 서술이 틀렸음을 확인했다(종합 문서 §2.3-21 "정본 표 정정", 제7·8부 원장 §2). 각 과제에서 스펙을 고치면 진행 중인 스펙 개정과 충돌하므로 여기서 한 번에 한다. 문서 커밋만 한다(마이그레이션·코드 없음).

**Files:**
- Modify: `docs/superpowers/specs/2026-09-23-generic-platform-design.md`, `docs/superpowers/plans/2026-09-23-sp0-fork-bootstrap.md`(:37 조정표 한 줄)

- [ ] **Step 0: 착수 조건** — 과제 1~13·15~18 이 main 에 있고, 진행 중인 스펙 개정(`docs/superpowers/specs/2026-09-27-platform-revision-configurability-design.md` — H2 를 `0011_authz_hardening` 으로, SP3a 를 `0012` 부터로 미는 개정)이 main 에 들어왔다. 개정본의 줄 번호는 아래와 다를 수 있으니 **문구로 찾는다**. 개정이 이미 기록한 항목은 건너뛴다(두 번 쓰지 않는다).

- [ ] **Step 1: 대조·기록** — 아래 표의 각 행에 대해 개정본에 같은 뜻이 있는지 확인하고, 없으면 그 절에 한 줄로 더한다. 결과(있음/추가/해당 절 없음)를 보고서에 행마다 적는다.

| 과제 | 스펙 위치(개정 전 기준) | 기록할 내용 |
|---|---|---|
| 1 | §3.4 표 `wbs.excel_profile` 행(:1446), `export/route.ts` 행(:1532) | "라우트 부분 선반영: 저장 양식은 접기·펼침 모두, 손상 422, 양식 없음+펼침 409, LEGACY 폴백 삭제. SP4 는 읽기 원천만 `wbs.excel_profile` 로 바꾸고 `LEGACY_EXCEL_PROFILE_V1` 을 픽스처로 옮긴다." `parse.ts:20 LEGACY_COLUMN_MAP` 언급은 지운다(과제 6) |
| 2 | §6.3 번호표(:3113-3128)와 `0009_settings` 참조(:1068, :2897, :2929, :2959, :3002, :3147, :3159), SP5 이슈 영역(:2964) | 0009 = `0009_sp2_isolation_fixes`(SP2 최종 fix), 0010 = `0010_issue_code_seq_width`(포스트-SP2), H2 가 0011(`0011_authz_hardening`), SP3a 는 0012 부터(개정이 이미 했으면 확인만). SP5 에 "코드 일련번호는 SQL·TS 모두 최소 2자리·절단 금지(F-seq100)" |
| 3 | §5.4.5 임베딩(:2660) | `EMBED_DIM` env 삭제 완료 — `provider.ts` 의 `EMBED_DIM = KNOWLEDGE_EMBEDDING_DIMENSIONS`(768) |
| 4 | §3.4 `router.ts` 행(:1580), §5.4.3(:2640) | "코드 기반 팀 추출 선반영(스코프 안 팀 코드·모호 거부·캐시 cold 503). SP8 은 이름·별칭 인식" |
| 5 | §5.5.1 SMTP 행(:2676), §5.5.2 ⑥(:2696) | 5.5.1 행 완료 표시. ⑥ 에 `SMTP_AUTH`(none)·`SMTP_FROM_ADDRESS` 추가, "SMTP_HOST 필수, Gmail 기본값 없음, 인증+비TLS 는 requireTLS". 발신명(`mail_from_name`)의 설정 이전은 SP3 그대로 |
| 6 | §3.4 `LEGACY_SECTION_MAP` 행(:1528), SP4(:2935) | :1528 선반영 완료. :2935 에서 삭제 대상은 `WEEKLY_TEAM_SECTIONS`·`FALLBACK_SECTION` 만 |
| 6 | §3.4 `parse.ts` 행(:1574), :1446, :2975 | 구 파서 `tests/fixtures/excel/legacyParse.ts` 로 이동 완료(SP0 에서 밀렸던 것). :2975 Asia/Seoul 목록에서 `lib/excel/parse.ts` 제외 |
| 6 | TEAM_COLOR 행(:50, :403, :1442, :1545, :2797) | `report/brand.ts` 는 사용처 0 이라 삭제됨 — TEAM_COLOR 해소 |
| 6 | SP0 계획 `docs/superpowers/plans/2026-09-23-sp0-fork-bootstrap.md:37` | 조정표의 `LEGACY_COLUMN_MAP` 판단 정정(런타임 importer 없음 → 포스트-SP2 에서 픽스처로 이동). `DEFAULT_TEAMS` 부분은 아래 과제 8 행 |
| 6 | (결정 기록) 달력 절 또는 SP5 | "공휴일은 어디에도 기본으로 넣지 않는다(사용자 결정 2026-09-26) — CLI·웹 양식 빈 목록" |
| 7 | §3.4 브랜드 행(:2797) 또는 설계 개정 12(branding) | `NEXT_PUBLIC_BRAND_PORTAL_ICON` 은 비면 제품명으로 자동 결정. 파비콘·apple-icon 의 D 고정은 SP3 `branding.logo_storage_path` 로 흡수 |
| 8 | §3.4 `DEFAULT_TEAMS` 행 모순(:1519 대 :1551·:2798) | 런타임 제거 완료(TeamsProvider `[]`, 기본 인자 필수, 픽스처 `tests/fixtures/teams.ts`). :2798 "런타임 importer 없음"은 틀렸었다(TeamsProvider 가 import 했다)고 정정 |
| 12 | 디자인 시스템 절(개정이 새로 만든 §2.5 토큰 부분) 또는 UI-1 매핑표 | "ink-subtle/pending → text-muted 로 매핑, 라이트 값 #6f645d(AA 실측), 사이드바 보조 #9a8f85. 간트 주말 라벨은 배경 밴드로 구분" — 절이 아직 없으면 보고서에만 남긴다 |
| 10·11·12 | §6.5 Q01~Q14(개정이 넣었으면) | Q03(과제 12)·Q04(과제 10)·Q09(과제 11)가 지금 버그로 고쳐졌다고 표시 |
| 15 | 정본에는 에이전트 승인 자격 절이 없다 — 개정 스펙 §3.0 승인 행·§6.2.0 H1 표 15 행(확인만) | "완료 승인 = 관리자 ∨ (서브트리 관리자 ∧ 리프 담당자 본인 아님 ∧ 그 주문의 claim 계정 아님). 반려·재작업은 담당자 본인도 가능. 레거시 비밀 claim(`claimed_by_user_id` null)은 담당자 검사만 — SP7". 정본에 자리가 없으면 보고서에만 남긴다 |
| 16 | §2 Storage 정책 표 `deliverables` 행(:860) | "읽기(다운로드)는 서버 목록 액션도 같은 `can_attach` 로 판정한다(RPC 1회, 오류면 막음). 조회 전용 사용자는 목록만 보고 다운로드하지 못한다 — 현행 유지(개정 스펙 §8.2 ②)" |
| 17 | 회의록 편집 자격을 적은 절(§2 권한 모델 — `canEditMinute` 서술이 있으면), 없으면 개정 스펙 §6.2.0 H1 표 17 행(확인만) | "회의록 상세의 관리 어포던스는 서버 `checkOwner` 와 같은 `canEditMinute`(행의 `project_id`·`workspace_id` — 회의 폴백 아님). 파일 목록 조회 실패는 빈 목록이 아니라 경고" |
| 18 | §2 Storage 정책 표 `minutes` 행(:861), §5 R3 행(:2729 '서명 URL 발급') | "회의록 파일 서명 URL TTL 60초(`MINUTE_FILE_URL_TTL_SEC`) — 발급 때 RLS 재검사, 회수 창 = TTL, 보관은 발급을 막지 않는다. 버전 원본은 클릭 시 발급. 첨부 삭제는 Storage 삭제 1건을 확인한 뒤에만 행을 지운다(버킷·행 삭제 권한 불일치의 근본 수정은 H2-g)" |

- [ ] **Step 2: 커밋**

```bash
git add docs/superpowers/specs/2026-09-23-generic-platform-design.md docs/superpowers/plans/2026-09-23-sp0-fork-bootstrap.md
git commit -m "docs(spec): 포스트-SP2 하드닝의 선반영·정정을 정본 스펙에 기록한다

엑셀 라우트·팀 추출·SMTP·임베딩 차원·레거시 구분 매핑·구 파서·brand.ts·DEFAULT_TEAMS·공휴일 기본값·포털 아이콘,
그리고 제7·8부 원장의 승인 분리·산출물 다운로드 판정·회의록 편집 어포던스·회의록 서명 URL TTL 을
이미 반영했거나 옛 서술이 틀렸음을 확인했다. 이후 SP 가 사라진 대상을 다시 계획하지 않게 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## 부록 — SP2 최종 리뷰 잔여 minor

### Task 19: SP2 최종 리뷰 잔여 minor — 레거시 GET 신원, 팀 목록 오류 문구, 페이징 문구, colgroup 공백, 스킬 문서의 옛 표

항목: SP2 최종 리뷰가 남긴 minor 다섯(트리아지·원장 밖). 웨이브 A. UI 위험 파일 없음 — `WeeklySheetView.tsx` 는 `src/components/weekly/` 라 목록(`src/app/globals.css`·`src/app/layout.tsx`·`src/app/(app)/layout.tsx`·`src/components/app/*`) 밖이고, `admin/teams/page.tsx` 도 밖이다. 마이그레이션 없음. 항목끼리 파일이 겹치지 않으므로 순서는 자유이고 커밋은 항목마다 하나다. 과제 14 의 스펙 기록 대상이 아니다(스킬 문서 한 줄은 개정 스펙 §7.7 에 적혀 있다).

**Files:**
- (a) Modify `scripts/agent-harness-example.mjs:27` · Test `tests/scripts/agent-harness-example.test.ts`(신설)
- (b) Modify `src/app/actions/teams.ts:140-143`(`listTeamsAdmin`), `src/app/(app)/admin/teams/page.tsx:27`·`:51-62`(`TeamsLoadError`) · Test `tests/actions/teams-actions.test.ts:187-205`, `tests/ui/admin-teams-page-load-error.test.tsx:29-35`
- (c) Modify `src/lib/data/paging.ts:38` · Test `tests/data/paging.test.ts:36-38`
- (d) Modify `src/components/weekly/WeeklySheetView.tsx:664-672` · Test `tests/invariants/colgroup-whitespace.test.ts`(신설)
- (e) Modify `.claude/skills/dflow-work/references/api-contract.md:77` · Test `tests/invariants/no-legacy-org.test.ts`(스킬 문서 케이스 추가)

**Interfaces:**
```ts
// (a) scripts/agent-harness-example.mjs:27 — 레거시 시크릿 읽기는 ?user_email= 이 필수다(routeShared.ts:89-100, 없으면 400 identity_required)
const { orders } = await api(`/agent/work?project_id=${AGENT_PROJECT}&user_email=${encodeURIComponent(AGENT_EMAIL)}`)

// (b) src/app/actions/teams.ts — 'use server' 라 문구는 모듈 안 const(export 하지 않는다). PostgREST 원문은 로그에만 남긴다
const ERR_TEAMS_LIST = '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
// src/app/(app)/admin/teams/page.tsx
function TeamsLoadError({ title, detail }: { title: string; detail?: string })   // detail 은 선택
// :27 → if (!list.ok) return <TeamsLoadError title={list.error} />   (제목 한 번 — 머리글 중복 없음)

// (c) src/lib/data/paging.ts:38 — throw 계약은 그대로, 문구만 재시도 안내로
throw new Error(`${label} 목록을 끝까지 읽지 못했습니다(${out.length}/${total}건) — 읽는 중에 행이 바뀌었거나 응답이 잘렸습니다. 잠시 후 다시 시도하세요.`)
```

- [ ] **Step 0: 착수 확인** — `git merge-base --is-ancestor sp2-done HEAD && echo ok`. 아래 여섯 파일이 dirty 가 아니다: `git status --porcelain scripts/agent-harness-example.mjs src/app/actions/teams.ts "src/app/(app)/admin/teams/page.tsx" src/lib/data/paging.ts src/components/weekly/WeeklySheetView.tsx .claude/skills/dflow-work/references/api-contract.md` 가 비어 있다. `grep -rn "잘려 왔습니다" src tests` 결과를 적어 둔다(계획 작성 시점: `paging.ts:38`·`paging.test.ts:37`).

- [ ] **Step 1: (a) 레퍼런스 하네스의 레거시 GET 에 신원을 붙인다**

테스트 먼저: `tests/scripts/agent-harness-example.test.ts`(신설)가 스크립트 파일을 읽어 `/agent/work?project_id=` 를 부르는 줄에 `user_email=` 이 있는지 본다(정적 검사 — 스크립트는 최상위 `await` 와 env 로 돌아 단위 실행하지 않는다). 실패 확인 → `:27` 을 위 Interfaces 로 바꾼다(`encodeURIComponent` 는 `+` 가 든 주소를 지킨다). 머리 주석(:3-6)의 사용 예는 그대로다(`AGENT_EMAIL` 이 이미 필수 env 다). 통과 확인 → 커밋.
```bash
git add scripts/agent-harness-example.mjs tests/scripts/agent-harness-example.test.ts
git commit -m "fix(scripts): 레퍼런스 하네스의 레거시 작업 목록 조회에 user_email 을 붙인다

SP2 가 레거시 시크릿 읽기에 ?user_email= 을 필수로 만들었는데(없으면 400 identity_required) 예시 하네스의
GET /agent/work 는 신원 없이 불러 첫 호출에서 멈췄다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 2: (b) 팀 목록 오류에 PostgREST 원문을 싣지 않고, 머리글을 두 번 쓰지 않는다**

테스트 먼저:
- `tests/actions/teams-actions.test.ts:201` → `{ ok: false, error: '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' }`. 반환에 `boom` 이 없고, 로그(`console.error`)에는 `boom` 이 있다.
- `tests/ui/admin-teams-page-load-error.test.tsx:30-32` → 목이 위 문구를 돌려주면 출력에 `팀 목록을 불러오지 못했습니다` 가 **정확히 한 번** 있다(`out.split('팀 목록을 불러오지 못했습니다').length - 1 === 1`). `role="alert"` 는 그대로, `TeamsManager` 미호출도 그대로다.
실패 확인 → 구현: `teams.ts:142` 가 `ERR_TEAMS_LIST` 를 돌려준다(원문은 이미 `:141` 로그에 있다). `page.tsx:27` 은 `<TeamsLoadError title={list.error} />`, `TeamsLoadError` 는 `detail` 이 있을 때만 둘째 줄을 그린다. 워크스페이스를 정할 수 없는 분기(:22-23)는 제목·사유 두 줄 그대로다. 가드 거부(`g.error`)는 그 문구가 제목이 된다. 통과 확인 → 커밋.
```bash
git add src/app/actions/teams.ts "src/app/(app)/admin/teams/page.tsx" tests/actions/teams-actions.test.ts tests/ui/admin-teams-page-load-error.test.tsx
git commit -m "fix(teams): 팀 목록 조회 오류에 DB 원문을 싣지 않고, 오류 카드 머리글이 두 번 찍히지 않게 한다

listTeamsAdmin 이 PostgREST 오류 원문을 사용자 문구에 붙였고, 페이지가 같은 머리글을 제목과 본문에 두 번 보였다.
원문은 로그에만 남기고 사용자에게는 재시도 안내 한 줄을 보인다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3: (c) 페이징 행 수 불일치를 재시도할 수 있는 문구로**

테스트 먼저: `tests/data/paging.test.ts:37` 을 `.rejects.toThrow('projects 목록을 끝까지 읽지 못했습니다(3/4건)')` 로 바꾸고, 같은 호출에 `.rejects.toThrow('잠시 후 다시 시도하세요')` 단언을 하나 더한다. 실패 확인 → `paging.ts:38` 을 위 Interfaces 문구로 바꾼다. 머리 주석(:17)의 throw 조건 서술은 그대로다. `grep -rn "잘려 왔습니다" src tests` → 0건. 통과 확인 → 커밋.
```bash
git add src/lib/data/paging.ts tests/data/paging.test.ts
git commit -m "fix(data): 페이지 읽기의 행 수 불일치를 '잘려 왔습니다' 대신 재시도 안내로 알린다

총합과 읽은 행 수가 다르면 throw 하는 계약은 그대로다. 다만 원인(읽는 중 변경·응답 잘림)과 할 일(다시 시도)을
문구에 담아, 이 오류를 그대로 보이는 화면·API 가 사용자에게 뜻 모를 문장을 내지 않게 한다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: (d) 주간 시트 colgroup 안의 공백 텍스트 노드를 없앤다**

`WeeklySheetView.tsx:667-671` 은 `<col className="w-[10%]" />    {/* 구분 */}` 처럼 같은 줄의 `<col>` 과 주석 사이에 공백이 있다. JSX 는 같은 줄의 공백을 텍스트 노드로 남기므로 `<colgroup>` 의 자식에 공백 텍스트가 생기고, React 가 "whitespace text nodes cannot be a child of `<colgroup>`" hydration 오류를 낸다(`IssuesView.tsx:214-226` 처럼 주석을 `colgroup` 밖에 두면 생기지 않는다).

테스트 먼저: `tests/invariants/colgroup-whitespace.test.ts`(신설)가 `walk(join(process.cwd(), 'src'))`(`tests/invariants/_walk.ts`)의 `.tsx` 를 읽어, `<col … />` 뒤에 같은 줄에서 공백과 다른 내용이 이어지는 줄(`/<col\b[^>]*\/>[ \t]+\S/`)을 모은다. 기대는 0건이다. 실패 확인(`WeeklySheetView.tsx` 5줄) → 구현: 열 설명을 `<table>` 위 주석(:664)의 다음 줄로 옮기고 `<col>` 줄에는 아무것도 두지 않는다.
```tsx
          {/* 구분 1단(업무영역 11개) + 내용 4열. 모듈 열과 행 구조 편집은 없다 — 구분당 1행 고정. */}
          {/* 열 폭: 구분 10% · 금주 내용 27% · 금주 이슈 19% · 차주 내용 26% · 차주 이슈 18%(합 100). colgroup 안에는 주석·공백을
              두지 않는다 — 공백 텍스트 노드가 colgroup 의 자식이 되면 hydration 오류가 난다. */}
          <table className="w-full table-fixed border-collapse bg-white text-[13px] text-black">
            <colgroup>
              <col className="w-[10%]" />
              <col className="w-[27%]" />
              <col className="w-[19%]" />
              <col className="w-[26%]" />
              <col className="w-[18%]" />
            </colgroup>
```
(:664 첫 주석의 "업무영역 11개" 정정은 SP4 몫이다 — 개정 스펙 §7.2 E29. 여기서는 문장을 바꾸지 않는다.) 통과 확인. 가능하면 로컬 확인: `npm run dev -- -p 3101` 로 주간 시트를 열어 브라우저 콘솔에 위 hydration 오류가 없는지 본다(샌드박스에 라이브 브라우저가 없으면 건너뛰고 그 사실을 보고한다). 커밋.
```bash
git add src/components/weekly/WeeklySheetView.tsx tests/invariants/colgroup-whitespace.test.ts
git commit -m "fix(weekly): 주간 시트 colgroup 안의 공백 텍스트 노드를 없애 hydration 오류를 막는다

<col /> 과 같은 줄의 열 설명 주석 사이 공백이 colgroup 의 자식 텍스트 노드가 되어 React 가 hydration 오류를 냈다.
열 폭 설명은 표 위 주석으로 옮기고, 같은 패턴이 다시 들어오지 않게 소스 가드를 둔다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: (e) 스킬 계약 문서의 옛 `project_roles` 서술을 현행 판정으로**

테스트 먼저: `tests/invariants/no-legacy-org.test.ts` 에 `it('스킬 문서(.claude/skills/**/*.md)에도 레거시 식별자 0건')` 을 더한다. `readdirSync(join(process.cwd(), '.claude/skills'), { recursive: true })` 에서 `.md` 만 골라 같은 `findHits(files, LEGACY_IDENT)` 로 본다(`walk()` 는 `.ts/.tsx` 만 모은다). 실패 확인(`api-contract.md:77` 1건) → `:77` 을 다음으로 바꾼다.
```md
- PAT는 `project_id` 지정 시 그 프로젝트만. 멤버십: PAT principal은 모든 조회·쓰기에서 그 프로젝트의 멤버 이상이어야 한다 — 플랫폼 관리자, 그 워크스페이스 관리자(승계), 명단 `project_members.access_role` 이 'admin'·'member' 인 사람(서버 `isProjectMember`). 아니면 404.
```
(옛 `project_roles` 표는 0003 에서 폐기됐다.) 통과 확인 → 커밋.
```bash
git add .claude/skills/dflow-work/references/api-contract.md tests/invariants/no-legacy-org.test.ts
git commit -m "docs(skill): API 계약 문서의 PAT 멤버십 서술을 폐기된 project_roles 에서 현행 판정으로 고친다

0003 에서 project_roles 표가 폐기됐는데 dflow-work 계약 문서가 여전히 그 표를 멤버십 근거로 적었다. 서버의
isProjectMember(플랫폼 관리자·워크스페이스 관리자 승계·명단 access_role)로 바꾸고, 스킬 문서도 옛 조직 모델
식별자 가드에 넣는다.

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: 전체 회귀** — `npm run typecheck && npm run lint && npx vitest run --reporter=dot 2>&1 | tail -3` → 실패 0. `git log --oneline -5` 에 위 다섯 커밋이 있고 각 커밋의 파일이 그 항목 것뿐이다(`git show --stat HEAD~4..HEAD`).

---

## 완료 조건 대조

| 완료 조건 | 과제 |
|---|---|
| src 에 원본 5팀 폴백·정규식·기본 인자 0건(`DEFAULT_TEAMS` 가드, 라우터 정규식 삭제) — 런타임 5팀 사본은 `LEGACY_EXCEL_PROFILE_V1`(테스트 전용 importer)만 남는다 | 4, 8, 1 |
| 조회 실패가 '없음'으로 보이는 곳 0(엑셀 손상, 대시보드 4데이터셋, 공지·회의 화면, 보고서, 헤더 티커, 봇 설정, 산출물 첨부 목록, 회의록 파일 목록) | 1, 3, 9, 12, 16, 17 |
| 입력·승인·초안이 조용히 사라지거나 엇갈리지 않음 | 10, 11, 12 |
| 이슈 코드 100 이상 공존(RLS), 롤백 카탈로그 diff 0 | 2 |
| Gmail·공휴일·제조 축 기본값 0 | 5, 6, 13 |
| 역할 문구 불변식·화이트라벨 기본값·재색인 권한 일치 | 7 |
| AA 대비 테스트(라이트) | 12 |
| UI 위험 커밋마다 `Preview-checked`, 마이그레이션 커밋 `Staging-verified`(파싱 확인) | 2, 8, 12 |
| 자기 완료 승인 0 — 서버 가드·승인 버튼·결재 대기 배지·좌석 op 가 같은 판정(`canApproveCompletion`) | 15 |
| 산출물 다운로드 링크 = Storage 정책(`can_attach`), `href="#"` 0건 | 16 |
| 회의록 관리 어포던스 = 서버 `canEditMinute`, 서명 URL TTL 60초·버전 원본 클릭 시 발급, Storage 삭제 실패 시 행 유지 | 17, 18 |
| SP2 최종 리뷰 잔여 minor 5건(레거시 GET 신원·팀 목록 오류 문구·페이징 문구·colgroup 공백·스킬 문서의 옛 표) | 19 |
| 스펙 선반영 기록 | 14 |

## Self-Review

**1. 종합 문서 §1 항목 → 과제(누락 0).**

| 종합 문서 항목(id) | 과제 |
|---|---|
| P1-7 / G | 1 |
| DC-02 / G-default-layout | 1 |
| F-seq100 | 2 |
| DC-05a | 3 |
| COV-07 | 3 |
| P1-9b / H-router / DC-05b | 4 |
| P1-9a / H-SMTP | 5 |
| P1-2b | 6 |
| P4-§3-parse | 6 |
| P4-§3-brand-comment | 6(파일째 삭제) |
| DC-07 | 6(사용자 결정: 기본 공휴일 없음) |
| DC-09 | 7 |
| D5-residue-SmartUtility | 7 |
| D6-§2-recent | 7 |
| D6-§13-whitelabel | 7(권고안 채택 — 사용자 결정) |
| DC-01a | 8 |
| D5-§1-Dashboard | 9 |
| D5-§8-partial-error | 9(1·2·3단계) |
| D6-§2-wbscommit | 10 |
| D6-§7-localdraft ①~④ / ⑤ | 10 / 12 |
| D6-§8-approval | 11 |
| D5-§3-breadcrumb | 12 |
| D5-§3/§8-sidebar-affordances | 12 |
| D5-§5-contrast-now / D6-§5-contrast-current | 12(`#6f645d`, 재테마 없음 — 사용자 결정) |
| DC-06 | 13 |
| §6 후보 1(양식 가이드 텍스트 날짜) | 1(`toIso` 가 ISO 텍스트를 읽고, 가이드 문구가 한계를 밝힌다) |
| §6 후보 2(`/api/report` 목록 판정) | 9(3단계) |
| §6 후보 3(주간 도구 미등록 팀) | 4(Step 6 — 종합 문서가 지정한 과제) |
| §6 후보 4(재색인 권한 불일치) | 7(Step 3 — 종합 문서가 지정한 과제) |
| §6 후보 5(사이드바 보조 글자·주말 라벨 대비) | 12 |
| §6 후보 6(봇의 프로젝트 기간 근사) | 제외(지시대로) |
| §6 후보 7(`getTopAnnouncements` 실패 → 빈 결과) | 9(로더·셸 필드) + 12(티커 표시) |
| §5-2(`portalIcon` 테스트 누락)·§5-3(`/projects` 눈확인)·§5-6(BrandMark 눈확인 관례) | 7 |
| 과제별 "기록"(spec §3.4·§5.4·§5.5·§6.3·SP0 조정표) | 14 |

후보 1 은 `toIso` 수정(가이드가 약속한 대로 읽기)을 택했다. 가이드 문구만 고치는 대안보다 사용자에게 덜 놀랍기 때문이다. 그 밖의 문자열이 빈 날짜가 되는 종전 동작은 가이드에 명시했고, 엄격한 오류로 바꾸는 것은 범위 밖이다.

**1-2. 제7·8부 원장 §2 항목과 SP2 최종 리뷰 잔여 → 과제(누락 0).**

| 항목(id) | 과제 |
|---|---|
| AUTH-07a(자기 완료 승인) | 15(07b 설정형은 비목표) |
| P7-2-DL(산출물 첨부 다운로드·목록 실패) | 16 |
| P8-H1-2(회의록 파일 목록 실패) · P8-H1-3(관리 어포던스 판정) | 17 |
| P8-H1-4(서명 URL TTL·렌더 시 서명) · P8-H1-1(삭제 결과 무시 — 최소 수정) | 18(근본 수정은 H2-g) |
| 원장 §2 "Task 14 에 15~18 선반영 기록" | 14(표 15~18 행) |
| SP2 최종 리뷰 minor (a) 레거시 GET `user_email` · (b) 팀 목록 오류 원문·머리글 중복 · (c) 페이징 문구 · (d) colgroup 공백 · (e) 스킬 문서 `project_roles` | 19 Step 1~5 |

원장의 H2 항목(AUTH-04·12·10a·01b·09a, P8-H2-1~3)은 마이그레이션이 필요해 이 계획 밖이다(개정 스펙 §6.2.0 H2, `0011_authz_hardening`).

**2. 자리표시자 점검.**
- "TBD·나중에·적절히 처리" 같은 문구는 없다.
- 이 계획이 의도적으로 "파일에서 그대로 복사하라"고 지시한 곳은 두 군데다. 과제 2 의 함수 본문(`sed -n '1036,1109p'`)과 과제 13 의 산문 예시 교체 내용이다. 앞의 것은 롤백 카탈로그 대조가 본문 바이트를 비교해서 계획에 옮겨 적으면 공백이 틀어질 위험이 크기 때문이다. 뒤의 것은 산문 재작성이라 규칙(인터페이스 절)과 가드 테스트로 결과를 고정했기 때문이다.
- 실행해서 확정하는 목록이 네 곳 있다. 과제 8 의 provider 없는 UI 테스트, 과제 3·11·15·17·18 의 mock·픽스처 파일(새 필수 필드·반환 모양), 과제 14 의 개정본 줄 번호다. 각각 확정 명령(`typecheck`·`vitest`·`git status --short tests`·문구 검색)을 적었다.
- 커밋 본문의 `<date '+%Y-%m-%d %H:%M' 출력>` 은 커밋 시각이라 미리 쓸 수 없다.

**3. 이름 일관성(과제 간 공유 식별자).**
- `downloadWbsExport`(1) — `ExportExcelButton`·`ImportWizard` 가 같은 이름으로 쓴다.
- `0010_issue_code_seq_width`(2·14).
- `ProjectSettingsRepository.getProjectConfig`(3) — 대시보드 도구 세 번째 인자 `Pick<…, 'getProjectConfig'>`.
- `FIXTURE_MILESTONE_KEYWORDS`(3)와 `FIXTURE_TEAMS`·`FIXTURE_TEAM_CODES`·`withTeams`(8)는 같은 `tests/fixtures/*` 명명 관례를 따른다. 과제 4 의 임시 `LEGACY_TEAMS` 는 과제 8 이 `FIXTURE_TEAM_CODES` 로 바꾼다.
- `RouteChatOptions.teamCodesFor`·`teamFromCodes`(4) — 스트림 라우트와 오케스트레이터 `routeOptions` 가 같은 타입이다.
- `SMTP_NOT_CONFIGURED`·`SMTP_MISCONFIGURED`·`resolveSmtpSettings`(5).
- `ERR_ISSUES_LOAD`·`ERR_SNAPSHOTS_LOAD`·`ERR_ANNOUNCEMENTS_LOAD`·`ERR_MEETINGS_LOAD`·`LoadErrorNotice`(9) — `members.ts` 의 `ERR_ROSTER_LOAD` 관례를 따른다.
- 셸 응답 필드 `headerAnnouncementsFailed`(9 → 12, `ShellState` 같은 이름).
- `wikiDraftKey`·`clearLegacyWikiDrafts`·`clearAllWikiDrafts`(10 → 12 `signOut`).
- `expectedReportId`·`reportId`·`ERR_REPORT_STALE`·`stale`(11).
- `isAnyWorkspaceAdmin`·`canCreateProject`(12) — `projects/page.tsx` 와 레이아웃이 같은 판정을 쓴다.
- `DEFAULT_PRODUCT_NAME`·`resolvePortalIcon`(7).
- 예시 블록 표지 `<!-- example:start -->`/`<!-- example:end -->`(13).
- `subtreeStanding`·`requireCompletionApprover`·`ERR_SELF_APPROVAL`(서버)과 `canApproveCompletion`·`canApprove`·`ERR_SELF_APPROVAL_HINT`(허브·좌석·배지)(15) — `requireSubtreeManagerOrAdmin`·`ERR_NOT_SUBTREE_MANAGER` 는 그대로다.
- `AttachmentList`·`AttachmentDownload`(`'allowed'|'denied'|'unknown'`)·`DeliverableAttachment.linkError`(16), `LoadErrorNotice` 의 `onRetry`(9 → 16).
- `MinuteFilesResult`·`ERR_MINUTE_FILES_LOAD`·뷰어 prop `filesError`(17 → 18 이 같은 로더·뷰어를 쓴다).
- `MINUTE_FILE_URL_TTL_SEC`·`getMinuteVersionFileUrl`·`MinuteVersionListItem.hasFile`·`MinuteVersionPanelProps.onDownload`(18).

**4. 순서 검증.**
- 같은 파일을 두 과제가 만지면 앞 과제가 끝난 뒤에 뒤 과제가 시작한다.
  - `settings/page.tsx`: 1 → 7
  - `template.ts`·`build-xlsx.mjs`: 1 → 6
  - `weeklySheet.ts`·`weeklyLint.ts`: 6 → 7
  - `WbsGanttSheet.tsx`: 10 → 7 → 12
  - `dashboard/page.tsx`·`projectFacts.ts`: 3 → 9
  - `DashboardView.tsx`: 9 → 7
  - `projects/page.tsx`: 7 → 12
  - `teams-master-mock.ts`: 4 → 8
  - `export.ts` 호출 형태: 1 → 8
  - `agentWork.ts`·`ApprovalQueue.tsx`·`DelegationTable.tsx`·`domain/{seatmap,agentHub}.ts`: 11 → 15
  - `LoadErrorNotice.tsx`: 9 → 16
  - `actions/minutes.ts`: 9 → 18
  - `data/minutes.ts`·`MinuteViewer.tsx`·`minutes{,.en}.ts`: (9 →) 17 → 18
  - `domain/minutes.ts`: 18(웨이브 A) → 8(웨이브 C)
  - `src/lib/i18n/dict/{wbs,minutes}{,.en}.ts`: 16·17·18(웨이브 A) → 7(웨이브 B)
  - `tests/invariants/no-legacy-org.test.ts`: 19(웨이브 A) → 7(웨이브 B)
  - 과제 14 는 15~18 뒤다(선반영 기록 대상). 과제 19 의 소스 파일은 다른 과제와 겹치지 않는다(가드 테스트 하나만 7 과 겹친다 — 위).
- UI 위험 파일은 8·12 에만 있다(15~19 는 없다 — `WeeklySheetView.tsx`·`admin/teams/page.tsx` 는 목록 밖).
- 마이그레이션은 2 의 하나뿐이다. H2 의 `0011_authz_hardening` 은 이 계획 밖이다.

