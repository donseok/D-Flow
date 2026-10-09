'use server'
// 이슈 조치/해결 경과 이력 — 등록·조회·취소선·완전삭제.
//
// issues.ts 와 파일을 가르는 이유: 상세 모달·이슈 액션 테스트의 mock 표면을 늘리지 않기
// 위해서다. 저 파일에 심볼을 더하면 통모킹한 테스트들이 함께 흔들린다.
//
// 이 파일은 'use server' 다 — export 하는 순간 브라우저에서 호출 가능한 엔드포인트가 된다.
// 게이트·헬퍼는 절대 export 하지 않는다.
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP, ERR_ANON, ERR_DENIED } from '@/lib/authz/errors'
import { displayNameFrom } from '@/lib/domain/display-name'
import { requireModule } from '@/lib/modules/gate'
import { emitNotification } from '@/lib/notify/emit'
import { enqueueIndexChange } from '@/lib/ai/index/enqueueChange'
import {
  canArchiveUpdate,
  canPurgeUpdate,
  ISSUE_UPDATE_BODY_MAX,
  isIssueUpdateCategory,
  type IssueUpdate,
  type IssueUpdateCategory,
  type IssueUpdateKind,
} from '@/lib/domain/issueUpdates'
import { createServerClient } from '@/lib/supabase/server'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'
import { libText } from '@/lib/i18n/serverText'

export type IssueUpdateListResult =
  | { ok: true; items: IssueUpdate[] }
  | { ok: false; error: string }

/** partial 은 "이력은 남았지만 뒷단 일부가 실패" — 성공으로 뭉개지 않고 화면에 고지한다. */
export type IssueUpdateResult =
  | { ok: true; partial?: string }
  | { ok: false; error: string }

const NAME_FALLBACK = '(이름 없음)'

/** 멘션 대상 상한. issues.ts 의 ASSIGNEES_MAX 와 같은 값 — 한 코멘트가 부를 수 있는 사람 수다. */
const MENTIONS_MAX = 20
// uuid 모양을 미리 거른다. 그냥 넘기면 Postgres 가 22P02 를 던지고, 그 실패가
// '권한을 확인할 수 없어 중단했습니다' 로 둔갑해 원인을 못 찾는다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 이력 쓰기 게이트 — 그 이슈가 속한 프로젝트의 멤버. '진행 저장'과 같은 등급이다.
 * isAdmin 을 함께 돌려주는 이유: 취소선·완전삭제 판정이 같은 왕복 안에서 끝나야
 * 액션마다 requireProjectAdmin 을 또 부르지 않는다.
 */
async function requireIssueMember(issueId: string): Promise<
  { ok: true; projectId: string; userId: string; isAdmin: boolean } | { ok: false; error: string }
> {
  const t = await serverTranslator()
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: libText(t, found.error) }
  // issues.project_id 는 not null 이지만 타입이 nullable 이다. null 이면 이력의 not null
  // 컬럼을 채울 수 없으므로 '권한 없음'이 아니라 중단한다(에러 3원칙 ②).
  if (!found.projectId) {
    console.error('[issueUpdates] 이슈의 프로젝트를 확정하지 못했습니다:', issueId)
    return { ok: false, error: ERR_LOOKUP }
  }
  const projectId = found.projectId
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  // 모듈 관문(스펙 §4.2)은 관리자 판정보다 앞 — 꺼진 모듈에 관리자 판정 왕복을 쓰지 않는다
  const mod = await requireModule({ projectId }, 'issues')
  if (!mod.ok) return { ok: false, error: mod.error }
  const admin = await requireProjectAdmin(projectId)
  return { ok: true, projectId, userId: g.actor.userId, isAdmin: admin.ok }
}

/**
 * issues.resolution_note 파생 미러 재계산 — 최신 '살아있는' note 본문을 부모에 복사한다.
 *
 * "방금 쓴 body 복사"가 아니라 재계산인 이유는 셋이다.
 *   (1) 취소선·완전삭제 뒤에도 미러가 맞아야 한다. 안 그러면 화면에서 지운 문장을
 *       AI RAG(ai/index/content.ts:290)가 계속 인용한다.
 *   (2) 재계산은 미러를 자기 교정 가능하게 만든다 — read-committed 하에서 동시 등록은
 *       여전히 경합할 수 있다(A 의 SELECT 가 B 의 행을 놓치고 A 의 UPDATE 가 B 보다
 *       늦게 적용되면 오래된 본문이 남는다). 그 경우도 다음 성공적인 쓰기가 다시
 *       재계산하면서 수렴한다 — race-free 가 아니라 self-healing 이다.
 *   (3) 이력이 0건이면 빈 문자열이어야 한다 — NULL 은 0041:38 NOT NULL 위반(23502)이다.
 *
 * updated_at 을 함께 미는 것은 필수다. issues 엔 updated_at 트리거가 없고(0041:14-15),
 * 안 밀면 0031:172-176 의 신선도 게이트가 재색인을 return 0 으로 스킵한다.
 *
 * payload 에 이 두 키 말고는 절대 넣지 않는다 — major_id 가 섞이면 0062:202
 * ISSUE_MAJOR_UNSET_FORBIDDEN 으로 터진다. 트리거는 동일값 rewrite 를 통과시키므로
 * DB 가 이 규칙을 지켜주지 않는다.
 *
 * 반환: 성공이면 null, 실패면 사유 문자열(replaceAssignees 관례).
 */
async function syncResolutionNoteMirror(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
): Promise<string | null> {
  const t = await serverTranslator()
  const { data, error } = await sb
    .from('issue_updates')
    .select('body')
    .eq('issue_id', issueId)
    .eq('kind', 'note')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) {
    console.error('[issueUpdates] 미러 재계산용 조회 실패:', error.message)
    return ERR_LOOKUP
  }
  const latest = (data?.[0]?.body as string | undefined) ?? ''

  const { data: updated, error: upErr } = await sb
    .from('issues')
    .update({ resolution_note: latest, updated_at: new Date().toISOString() })
    .eq('id', issueId)
    .select('id')
  if (upErr) {
    console.error('[issueUpdates] 미러 갱신 실패:', upErr.message)
    return upErr.message
  }
  if (!updated?.length) {
    console.error('[issueUpdates] 미러 갱신이 0행입니다:', issueId)
    return t('err.issueNotFound')
  }
  // 해결 메모는 색인 본문에 든다 — 범위(프로젝트)는 행에서 읽는다
  await enqueueIndexChange({ domain: 'issues', entityId: issueId })
  return null
}

function mapRow(r: Record<string, unknown>): IssueUpdate {
  return {
    id: r.id as string,
    issueId: r.issue_id as string,
    kind: r.kind as IssueUpdate['kind'],
    category: (r.category as IssueUpdateCategory | null) ?? null,
    body: r.body as string,
    mentionedMemberIds: (r.mentioned_member_ids as string[] | null) ?? [],
    authorUserId: (r.author_user_id as string | null) ?? null,
    authorName: r.author_name as string,
    createdAt: r.created_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
    archivedByName: (r.archived_by_name as string | null) ?? null,
  }
}

/**
 * 이력 목록(오래된 순). 조회는 로그인 사용자 전체에 열려 있다(이슈 본문·첨부와 동일).
 *
 * 빈 배열이 아니라 에러 채널을 둔 이유: 여기서 실패를 [] 로 뭉개면 사용자는 "아무도 아무
 * 조치도 안 했다"고 읽는다. 조치 이력이 사라진 것처럼 보이는 것이 최악이다(에러 3원칙 ①).
 */
export async function listIssueUpdates(issueId: string): Promise<IssueUpdateListResult> {
  if (!(await getSession())) {
    console.error('[listIssueUpdates] 비로그인 호출')
    return { ok: false, error: ERR_ANON }
  }
  // 모듈 관문(스펙 §4.2) — 이슈 행의 프로젝트로 판정한다
  const scope = await resolveProjectId('issues', issueId)
  if (!scope.ok || !scope.projectId) return { ok: false, error: scope.ok ? ERR_LOOKUP : scope.error }
  const mod = await requireModule({ projectId: scope.projectId }, 'issues')
  if (!mod.ok) return { ok: false, error: mod.error }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issue_updates')
    .select('id, issue_id, kind, category, body, mentioned_member_ids, author_user_id, author_name, created_at, archived_at, archived_by_name')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) {
    console.error('[listIssueUpdates] 이력 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  return { ok: true, items: (data ?? []).map(mapRow) }
}

/** 이력 등록 — 프로젝트 멤버. kind 는 보내지 않는다(컬럼 grant 밖이라 42501 이 된다). */
export async function addIssueUpdate(
  issueId: string,
  input: { body: string; category: IssueUpdateCategory | null; mentionedMemberIds: string[] },
): Promise<IssueUpdateResult> {
  const t = await serverTranslator()
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  const body = input.body.trim()
  if (body.length === 0) return { ok: false, error: t('srv.issueUpdates.enterContent') }
  if (body.length > ISSUE_UPDATE_BODY_MAX) {
    return { ok: false, error: fill(t('srv.issueUpdates.contentMustCharactersFewer'), { issueUpdateBodyMax: ISSUE_UPDATE_BODY_MAX }) }
  }
  if (input.category !== null && !isIssueUpdateCategory(input.category)) {
    return { ok: false, error: t('srv.issueUpdates.unknownCategory') }
  }
  if (!Array.isArray(input.mentionedMemberIds)
      || input.mentionedMemberIds.some(id => typeof id !== 'string' || !UUID_RE.test(id))) {
    return { ok: false, error: t('srv.issueUpdates.mentionTargetNotValid') }
  }
  if (input.mentionedMemberIds.length > MENTIONS_MAX) {
    return { ok: false, error: fill(t('srv.issueUpdates.upPeopleCanMentionedOnce'), { mentionsMax: MENTIONS_MAX }) }
  }

  const user = await getSession()
  if (!user) return { ok: false, error: ERR_ANON }

  const sb = await createServerClient()

  // 멘션 대상 선행 검증 — uuid[] 컬럼이라 FK 를 걸 수 없다(replaceAssignees 와 같은 처리).
  // 남의 프로젝트 멤버 id 를 꽂아 알림을 보내는 경로를 여기서 끊는다.
  let mentioned: string[] = []
  if (input.mentionedMemberIds.length > 0) {
    const { data, error } = await sb
      .from('project_members')
      .select('id, people!inner(active)')
      .in('id', input.mentionedMemberIds)
      .eq('project_id', g.projectId)
      .eq('active', true)
      .eq('people.active', true)
    if (error) {
      console.error('[addIssueUpdate] 멘션 대상 검증 실패:', error.message)
      return { ok: false, error: ERR_LOOKUP }
    }
    mentioned = (data ?? []).map((r: { id: string }) => r.id)
  }

  const { data: inserted, error } = await sb
    .from('issue_updates')
    .insert({
      issue_id: issueId,
      project_id: g.projectId,
      category: input.category,
      body,
      mentioned_member_ids: mentioned,
      author_user_id: user.id,
      author_name: displayNameFrom(user.user_metadata, user.email) ?? NAME_FALLBACK,
    })
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!inserted) {
    console.error('[addIssueUpdate] 이력 INSERT 가 0행입니다:', issueId)
    return { ok: false, error: t('srv.issueUpdates.couldNotSaveUpdate') }
  }
  const updateId = inserted.id as string

  // 알림 — 담당자에게. member 축 그대로 넘긴다: 클라이언트에도 이 액션에도 다른 사람의
  // auth uuid 가 없고(domain/types.ts:69), emit.ts:28-36 이 project_members 조인으로
  // user_id 를 풀고 작성자 본인 제외까지 처리한다.
  let notifyErr: string | null = null
  const { data: issueRow, error: issueErr } = await sb
    .from('issues').select('title').eq('id', issueId).maybeSingle()
  if (issueErr) {
    console.error('[addIssueUpdate] 알림용 이슈 제목 조회 실패:', issueErr.message)
    notifyErr = t('srv.issueUpdates.couldNotSendNotification')
  }
  const { data: assignees, error: asgErr } = await sb
    .from('issue_assignees').select('member_id').eq('issue_id', issueId)
  if (asgErr) {
    console.error('[addIssueUpdate] 알림용 담당자 조회 실패:', asgErr.message)
    notifyErr = t('srv.issueUpdates.couldNotSendNotification')
  }
  const recipients = (assignees ?? []).map((a: { member_id: string }) => a.member_id)
  // 멘션이 담당자보다 우선한다 — 두 알림을 다 받으면 중복이다.
  const mentionSet = new Set(mentioned)
  const assigneeOnly = recipients.filter(id => !mentionSet.has(id))

  // 제목·담당자 조회 실패는 둘 다 막는다 — 그걸 모르면 어느 알림도 제대로 만들 수 없다.
  // 반면 발행 실패는 서로를 막지 않는다. 두 알림은 수신자 집합이 겹치지 않는 독립 사건이라,
  // 담당자 알림의 일시적 실패가 멘션 알림까지 삼키면 안 된다.
  const failed: string[] = []
  if (notifyErr === null) {
    if (assigneeOnly.length > 0) {
      const emitted = await emitNotification({
        type: 'issue.update',
        projectId: g.projectId,
        actorUserId: g.userId,
        entityType: 'issue',
        entityId: issueId,
        payload: {
          title: (issueRow?.title as string | undefined) ?? '이슈',
          detail: '조치 경과가 등록되었습니다',
          href: `/p/${g.projectId}/issues?focus=${issueId}`,
        },
        recipientMemberIds: assigneeOnly,
        dedupeKey: `issue.update:${issueId}:${updateId}`,
      })
      if (!emitted.ok) failed.push(t('err.assignee'))
    }
    if (mentioned.length > 0) {
      const emitted = await emitNotification({
        type: 'issue.mention',
        projectId: g.projectId,
        actorUserId: g.userId,
        entityType: 'issue',
        entityId: issueId,
        payload: {
          title: (issueRow?.title as string | undefined) ?? '이슈',
          detail: '조치 경과에서 회원님을 언급했습니다',
          href: `/p/${g.projectId}/issues?focus=${issueId}`,
        },
        recipientMemberIds: mentioned,
        dedupeKey: `issue.mention:${issueId}:${updateId}`,
      })
      if (!emitted.ok) failed.push(t('srv.issueUpdates.mention'))
    }
    if (failed.length > 0) notifyErr = fill(t('srv.issueUpdates.couldNotSendNotification2'), { failed: failed.join('·') })
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  const partial = [
    mirrorErr ? fill(t('srv.issueUpdates.couldNotApplySummary'), { mirrorErr }) : null,
    notifyErr,
  ].filter(Boolean).join(' ')
  if (partial) return { ok: true, partial: fill(t('srv.issueUpdates.updateSaved'), { partial }) }
  return { ok: true }
}

/** 취소선·삭제 대상 행을 읽어 권한을 판정한다. 조회 실패를 '없음'으로 위장하지 않는다. */
async function loadTargetRow(
  sb: Awaited<ReturnType<typeof createServerClient>>,
  issueId: string,
  updateId: string,
): Promise<
  { ok: true; kind: IssueUpdateKind; authorUserId: string | null; archivedAt: string | null }
  | { ok: false; error: string }
> {
  const t = await serverTranslator()
  // uuid 모양을 미리 거른다 — 안 그러면 addIssueUpdate 의 멘션 id 와 같은 이유로
  // Postgres 가 22P02 를 던지고 '권한을 확인할 수 없어 중단했습니다' 로 둔갑한다.
  if (!UUID_RE.test(updateId)) return { ok: false, error: t('srv.issueUpdates.updateNotFound') }
  // issue_id 를 함께 조건에 넣는 이유: 호출자가 남의 이슈의 이력 id 를 보내도
  // 이 이슈의 권한으로 처리되지 않게 한다(게이트는 issueId 기준으로 통과했다).
  const { data, error } = await sb
    .from('issue_updates')
    .select('id, kind, author_user_id, archived_at')
    .eq('id', updateId)
    .eq('issue_id', issueId)
    .maybeSingle()
  if (error) {
    console.error('[issueUpdates] 대상 이력 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!data) return { ok: false, error: t('srv.issueUpdates.updateNotFound') }
  return {
    ok: true,
    kind: data.kind as IssueUpdateKind,
    authorUserId: (data.author_user_id as string | null) ?? null,
    archivedAt: (data.archived_at as string | null) ?? null,
  }
}

/** 취소선 처리 — 내용은 남기고 지웠다는 사실만 표시한다. */
export async function archiveIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult> {
  const t = await serverTranslator()
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: ERR_ANON }

  const sb = await createServerClient()
  const row = await loadTargetRow(sb, issueId, updateId)
  if (!row.ok) return { ok: false, error: libText(t, row.error) }
  // 상태 자동 기록은 사람이 쓴 글이 아니라 감사 흔적이다. 상태를 바꾼 본인이 그 기록을
  // 스스로 지울 수 있으면 남길 값어치가 없다. UI 는 버튼을 숨기지만 관문은 여기다.
  if (row.kind !== 'note') return { ok: false, error: t('srv.issueUpdates.statusChangeRecordsCannotStruck') }
  if (!canArchiveUpdate({ authorUserId: row.authorUserId }, g.userId, g.isAdmin)) {
    return { ok: false, error: ERR_DENIED }
  }
  if (row.archivedAt !== null) return { ok: false, error: t('srv.issueUpdates.updateAlreadyStruckOut') }

  // CAS + .select() — RLS 거부·경합으로 0행이어도 supabase-js 는 error 를 주지 않는다.
  // issue_id 도 조건에 넣는다 — purgeIssueUpdate 와 같은 이중 방어. 오늘은 issue_id 가
  // 컬럼 grant 밖이라 이 창에서 행을 다른 이슈로 옮길 수 없지만, grant 목록이 넓어지면
  // loadTargetRow 가 확인한 소속과 실제 UPDATE 대상이 갈릴 수 있다 — 주 방어선은
  // loadTargetRow, 이건 심층 방어다.
  const { data: updated, error } = await sb
    .from('issue_updates')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: g.userId,
      archived_by_name: displayNameFrom(user.user_metadata, user.email) ?? NAME_FALLBACK,
    })
    .eq('id', updateId)
    .eq('issue_id', issueId)
    .is('archived_at', null)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated?.length) {
    console.error('[archiveIssueUpdate] 취소선 UPDATE 가 0행입니다:', updateId)
    return { ok: false, error: t('srv.issueUpdates.anotherUserHandledFirst') }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) return { ok: true, partial: fill(t('srv.issueUpdates.struckOutButSummaryCould'), { mirrorErr }) }
  return { ok: true }
}

/**
 * 취소선 되돌리기. 이 경로가 없으면 클릭 한 번이 사실상 영구 삭제가 된다
 * (WikiItemActions.tsx:33-36 의 규칙).
 */
export async function unarchiveIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult> {
  const t = await serverTranslator()
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  const sb = await createServerClient()
  const row = await loadTargetRow(sb, issueId, updateId)
  if (!row.ok) return { ok: false, error: libText(t, row.error) }
  // 상태 자동 기록은 사람이 쓴 글이 아니라 감사 흔적이다. 상태를 바꾼 본인이 그 기록을
  // 스스로 지울 수 있으면 남길 값어치가 없다. UI 는 버튼을 숨기지만 관문은 여기다.
  if (row.kind !== 'note') return { ok: false, error: t('srv.issueUpdates.statusChangeRecordsCannotStruck') }
  if (!canArchiveUpdate({ authorUserId: row.authorUserId }, g.userId, g.isAdmin)) {
    return { ok: false, error: ERR_DENIED }
  }
  if (row.archivedAt === null) return { ok: false, error: t('srv.issueUpdates.updateNotStruckOut') }

  // 셋을 한꺼번에 NULL 로 — 0087 의 with check 가 "전부 NULL 이거나, 본인이 그은 것"만 통과시킨다.
  // issue_id 도 조건에 넣는다 — archiveIssueUpdate 와 같은 이중 방어(purgeIssueUpdate 참조).
  const { data: updated, error } = await sb
    .from('issue_updates')
    .update({ archived_at: null, archived_by: null, archived_by_name: null })
    .eq('id', updateId)
    .eq('issue_id', issueId)
    .not('archived_at', 'is', null)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!updated?.length) {
    console.error('[unarchiveIssueUpdate] 되돌리기 UPDATE 가 0행입니다:', updateId)
    return { ok: false, error: t('srv.issueUpdates.anotherUserHandledFirst') }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) return { ok: true, partial: fill(t('srv.issueUpdates.restoredButSummaryCouldNot'), { mirrorErr }) }
  return { ok: true }
}

/** 완전 삭제 — 프로젝트 관리자만. 되돌릴 수 없다. */
export async function purgeIssueUpdate(issueId: string, updateId: string): Promise<IssueUpdateResult> {
  const t = await serverTranslator()
  const g = await requireIssueMember(issueId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!canPurgeUpdate(g.isAdmin)) return { ok: false, error: ERR_DENIED }

  const sb = await createServerClient()
  const row = await loadTargetRow(sb, issueId, updateId)
  if (!row.ok) return { ok: false, error: libText(t, row.error) }

  // SPU1(SP5b 이월): 상태 변경 기록은 감사 로그 보존을 위해 완전 삭제 불가
  if (row.kind === 'status') {
    return { ok: false, error: t('srv.issueUpdates.statusChangeRecordsCannotDeleted') }
  }

  const { data: gone, error } = await sb
    .from('issue_updates')
    .delete()
    .eq('id', updateId)
    .eq('issue_id', issueId)
    .select('id')
  if (error) return { ok: false, error: error.message }
  if (!gone?.length) {
    console.error('[purgeIssueUpdate] DELETE 가 0행입니다:', updateId)
    return { ok: false, error: t('srv.issueUpdates.couldNotDelete') }
  }

  const mirrorErr = await syncResolutionNoteMirror(sb, issueId)
  revalidatePath(`/p/${g.projectId}/issues`)
  if (mirrorErr) return { ok: true, partial: fill(t('srv.issueUpdates.deletedButSummaryCouldNot'), { mirrorErr }) }
  return { ok: true }
}
