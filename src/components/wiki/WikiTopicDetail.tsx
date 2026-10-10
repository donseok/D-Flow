import Link from 'next/link'
import { DocumentVersionStatus } from '@/components/doc/DocumentVersionStatus'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookOpenText,
  CalendarClock,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileText,
  GitCompareArrows,
  ShieldAlert,
  UserRound,
} from 'lucide-react'
import type { DictKey} from '@/lib/i18n/dict'
import { t } from '@/lib/i18n/dict'
import type { WikiItem, WikiTopicDetailData } from '@/lib/data/wiki'
import {
  getWikiTopicTrustState,
  isClosedByPersonWikiItem,
  isConflictedWikiItem,
  isOpenWikiItem,
  type WikiTopicTrustState,
} from '@/lib/domain/wikiView'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionCard } from '@/components/ui/SectionCard'
import { formatWikiDate, WikiChangeList, WikiItemCard } from './WikiShared'
import { WikiDocumentEditor } from './WikiDocumentEditor'
import type { LocalDraftPolicy } from '@/lib/drafts/storage'
import { WikiFeedbackButtons } from './WikiFeedbackButtons'
import { WikiProposalActions } from './WikiProposalActions'
import { WikiTopicContext } from './WikiTopicContext'
import { WikiQuestionAnswerForm } from './WikiQuestionAnswerForm'
import { WikiQuestionCreateForm } from './WikiQuestionCreateForm'
import { WikiRevisionRestoreButton } from './WikiRevisionRestoreButton'

type MemoryTopic = NonNullable<WikiTopicDetailData['topic']> & {
  bodyMd?: string | null
  bodyUpdatedAt?: string | null
  bodyUpdatedBy?: string | null
  documentKind?: string | null
  verifiedAt?: string | null
  verifiedBy?: string | null
  reviewDueAt?: string | null
}

type MemoryTopicDetailData = WikiTopicDetailData & {
  proposals?: WikiItem[]
  revisions?: Array<{
    id: string
    versionNo: number
    title: string
    bodyMd: string
    editedByName: string | null
    createdAt: string
  }>
  questions?: Array<{
    id: string
    question: string
    status: string
    createdAt: string
  }>
  feedback?: Array<{
    id: string
    feedbackType: string
    resolution: string | null
    resolvedAt?: string | null
  }>
  dataTruncated?: boolean
  changesTruncated?: boolean
}

function sourceCount(items: WikiItem[]): number {
  return new Set(items.flatMap((item) => item.sources.map((source) => source.id || `${source.minuteId}:${source.blockIndex ?? ''}`))).size
}

function trustStatusMeta(state: WikiTopicTrustState) {
  if (state === 'conflict') {
    return { label: t('wiki.trust.conflict'), wrap: 'bg-danger-weak text-danger', icon: AlertTriangle }
  }
  if (state === 'review_due') {
    return { label: t('wiki.trust.reviewDue'), wrap: 'bg-pending-weak text-warning', icon: Clock3 }
  }
  if (state === 'verified') {
    return { label: t('wiki.trust.verified'), wrap: 'bg-success-weak text-success', icon: BadgeCheck }
  }
  return { label: t('wiki.trust.unverified'), wrap: 'bg-surface-subtle text-fg-secondary', icon: CircleHelp }
}

function kindLabel(kind: string | null | undefined): string {
  const labels: Record<string, DictKey> = {
    overview: 'wiki.docKind.overview',
    decision: 'wiki.docKind.decision',
    how_to: 'wiki.docKind.how_to',
    runbook: 'wiki.docKind.runbook',
    faq: 'wiki.docKind.faq',
    glossary: 'wiki.docKind.glossary',
    reference: 'wiki.docKind.reference',
  }
  const key: unknown = labels[kind ?? '']
  return t(typeof key === 'string' ? key as DictKey : 'wiki.document.unclassified')
}

function TrustPanel({
  projectId,
  topic,
  items,
  canContribute,
  trustState,
  timeZone,
}: {
  projectId: string
  topic: MemoryTopic
  items: WikiItem[]
  canContribute: boolean
  trustState: WikiTopicTrustState
  timeZone: string
}) {
  const status = trustStatusMeta(trustState)
  const reviewDue = trustState === 'review_due'
  const StatusIcon = status.icon

  return (
    <SectionCard title={t('wiki.trust.title')} icon={BadgeCheck}>
      <div className={`flex items-center gap-2 rounded-xl px-3 py-3 ${status.wrap}`}>
        <StatusIcon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-sm font-semibold">{status.label}</span>
      </div>
      <dl className="mt-4 space-y-3 text-xs">
        <div className="flex items-start gap-2">
          <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <dt className="text-fg-muted">{t('wiki.trust.owner')}</dt>
          <dd className="ml-auto text-right font-medium text-fg">{topic.ownerTeam ?? t('wiki.noOwner')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <dt className="text-fg-muted">{t('wiki.trust.type')}</dt>
          <dd className="ml-auto text-right font-medium text-fg">{kindLabel(topic.documentKind)}</dd>
        </div>
        <div className="flex items-start gap-2">
          <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <dt className="text-fg-muted">{t('wiki.trust.lastVerified')}</dt>
          <dd className="ml-auto text-right font-medium text-fg">{topic.verifiedAt ? formatWikiDate(topic.verifiedAt, false, timeZone) : t('wiki.trust.never')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <dt className="text-fg-muted">{t('wiki.trust.nextReview')}</dt>
          <dd className={`ml-auto text-right font-medium ${reviewDue ? 'text-warning' : 'text-fg'}`}>{topic.reviewDueAt ? formatWikiDate(topic.reviewDueAt, false, timeZone) : t('wiki.trust.notScheduled')}</dd>
        </div>
        <div className="flex items-start gap-2">
          <BookOpenText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
          <dt className="text-fg-muted">{t('wiki.trust.sources')}</dt>
          <dd className="ml-auto text-right font-medium text-fg">{sourceCount(items)}</dd>
        </div>
      </dl>
      {canContribute && <div className="mt-4 border-t border-border pt-4"><WikiFeedbackButtons projectId={projectId} topicId={topic.id} /></div>}
    </SectionCard>
  )
}

function OpenLoops({ items, questions, projectId, topicId, canCurate, canAnswer, timeZone, minutesBase }: { items: WikiItem[]; questions: NonNullable<MemoryTopicDetailData['questions']>; projectId: string; topicId: string; canCurate: boolean; canAnswer: boolean; timeZone: string; minutesBase?: string }) {
  if (items.length === 0 && questions.length === 0) return <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-fg-secondary">{t('wiki.topic.noOpen')}</p>
  return (
    <div className="space-y-3">
      {questions.map((question) => (
        <article key={question.id} className="rounded-xl border border-border bg-surface px-4 py-3 shadow-[var(--shadow-sm)]">
          <div className="flex items-center gap-2"><CircleHelp className="h-4 w-4 text-pending" aria-hidden /><span className="chip bg-pending-weak text-pending">{t('wiki.kind.question')}</span></div>
          <p className="mt-2 text-sm font-medium leading-6 text-fg">{question.question}</p>
          <p className="mt-1 text-meta text-fg-muted">{formatWikiDate(question.createdAt, false, timeZone)}</p>
          {canAnswer && <WikiQuestionAnswerForm projectId={projectId} topicId={topicId} questionId={question.id} />}
        </article>
      ))}
      {items.map((item) => <WikiItemCard key={item.id} item={item} showEvidence curateProjectId={canCurate ? projectId : undefined} timeZone={timeZone} minutesBase={minutesBase} />)}
    </div>
  )
}

function EvidenceAccordion({ items, projectId, canCurate, timeZone, minutesBase }: { items: WikiItem[]; projectId: string; canCurate: boolean; timeZone: string; minutesBase?: string }) {
  return (
    <details className="card group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:hidden sm:px-6">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-action-soft text-action"><BookOpenText className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{t('wiki.evidence.title')}</h3>
        </div>
        <span className="chip bg-surface-subtle text-fg-secondary">{items.length}</span>
        <ChevronDown className="h-4 w-4 text-fg-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-border px-5 py-5 sm:px-6">
        <p className="mb-3 text-xs leading-5 text-fg-secondary">{t('wiki.evidence.desc')}</p>
        {items.length > 0
          ? <div className="space-y-3">{items.map((item) => <WikiItemCard key={item.id} item={item} showEvidence curateProjectId={canCurate ? projectId : undefined} timeZone={timeZone} minutesBase={minutesBase} />)}</div>
          : <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-fg-secondary">{t('wiki.noItems')}</p>}
      </div>
    </details>
  )
}

export function WikiTopicDetail({
  projectId,
  data: rawData,
  canCurate = false,
  canEditDocuments = canCurate,
  canVerifyDocuments = canEditDocuments,
  userId,
  timeZone,
  minutesBase,
  draftPolicy,
}: {
  projectId: string
  data: WikiTopicDetailData
  canCurate?: boolean
  canEditDocuments?: boolean
  canVerifyDocuments?: boolean
  /** 편집기 로컬 초안의 주인. null 이면 초안 기능이 꺼진다. 필수 — 빠뜨리면 초안이 조용히 꺼지므로 호출부가 명시한다. */
  userId: string | null
  /** instant(갱신·검증·질문·변경 시각)를 찍을 시간대(프로젝트 calendar.timezone) — 서버가 내려준다 */
  timeZone: string
  /** 근거·변경의 회의록 링크 기준 경로 — 페이지가 슬러그 워크스페이스로 만든 '/w/<s>/minutes'(D38 ①, 과제 35). 없으면 영구 링크 형식 */
  minutesBase?: string
  /** 워크스페이스의 로컬 초안 정책(security.local_drafts, 개정 §5.8.5). 필수 — 페이지가 못 읽었으면 DRAFTS_OFF_POLICY 를 넘긴다 */
  draftPolicy: LocalDraftPolicy
}) {
  const data = rawData as MemoryTopicDetailData
  if (!data.topic) {
    return (
      <div className="space-y-4">
        <Link href={`/p/${projectId}/wiki`} className="inline-flex items-center gap-1.5 text-sm font-medium text-action hover:text-action-hover"><ArrowLeft className="h-4 w-4" />{t('wiki.backHome')}</Link>
        <EmptyState icon={BookOpenText} title={data.available ? t('wiki.topic.notFound') : t('wiki.empty.title')} description={data.available ? t('wiki.topic.notFoundDesc') : t('wiki.empty.desc')} action={<Link href={`/p/${projectId}/wiki`} className="btn btn-ghost"><ArrowLeft className="h-4 w-4" />{t('wiki.backHome')}</Link>} />
      </div>
    )
  }

  const topic = data.topic as MemoryTopic
  const items = data.items.filter((item) => !isClosedByPersonWikiItem(item))
  const openItems = items.filter(isOpenWikiItem)
  const evidenceItems = items.filter((item) => !isOpenWikiItem(item))
  const proposals = (data.proposals ?? []).filter((item) => item.reviewState === 'pending')
  const questions = (data.questions ?? []).filter((question) => !['answered', 'resolved', 'closed'].includes(question.status))
  const outdatedFlagged = (data.feedback ?? []).some((feedback) => (
    feedback.feedbackType === 'outdated'
    && !feedback.resolvedAt
    && !['resolved', 'dismissed', 'closed'].includes(feedback.resolution ?? '')
  ))
  const conflict = topic.conflictCount > 0 || items.some(isConflictedWikiItem)
  const conflictCount = Math.max(topic.conflictCount, conflict ? 1 : 0)
  const trustState = getWikiTopicTrustState({
    verifiedAt: topic.verifiedAt,
    reviewDueAt: topic.reviewDueAt,
    hasConflict: conflict,
    hasUnresolvedOutdatedFeedback: outdatedFlagged,
  })
  const trustStatus = trustStatusMeta(trustState)
  const TrustStatusIcon = trustStatus.icon
  const extensionReady = data.readState === 'ready'
  const canWriteMemory = extensionReady && canEditDocuments
  // 0079 신규 기능(AI 제안 검토)만 스키마 준비를 기다린다.
  const canReviewMemory = extensionReady && canCurate
  // 항목 큐레이션(보관·해결·잠금·확정)은 0048/0053 RPC 라 이미 운영에 있다 —
  // 0079 미적용 기간에 기존 기능까지 막지 않는다.
  const canCurateLegacy = canCurate
  const canVerifyMemory = extensionReady && canVerifyDocuments

  return (
    <div className="space-y-5">
      <WikiTopicContext topicId={topic.id} />
      <Link href={`/p/${projectId}/wiki`} className="inline-flex items-center gap-1.5 text-sm font-medium text-action hover:text-action-hover"><ArrowLeft className="h-4 w-4" />{t('wiki.backHome')}</Link>

      {!extensionReady && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/25 bg-danger-weak/45 px-4 py-3 text-sm" role="alert">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div>
            <div className="font-semibold text-fg">{data.readState === 'error' ? t('wiki.read.errorTitle') : t('wiki.read.schemaTitle')}</div>
            <p className="mt-0.5 leading-5 text-fg-secondary">{data.readState === 'error' ? t('wiki.read.errorDesc') : t('wiki.read.schemaDesc')}</p>
          </div>
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {topic.documentKind && <span className="chip bg-action-soft text-action">{kindLabel(topic.documentKind)}</span>}
              <span className={`chip ${trustStatus.wrap}`}><TrustStatusIcon className="h-3 w-3" />{trustStatus.label}</span>
            </div>
            <DocumentVersionStatus currentVersionNo={data.revisions?.[0]?.versionNo ?? null}
              viewingVersionNo={data.revisions?.[0]?.versionNo ?? null} publicationState="saved" className="mt-2" />
            <h2 className="mt-2 text-xl font-bold tracking-tight text-fg sm:text-2xl">{topic.title}</h2>
            <p className="mt-1.5 text-sm text-fg-secondary">{topic.ownerTeam ?? t('wiki.noOwner')}<span className="mx-2 text-border-focus">·</span>{t('wiki.updatedAt')} {formatWikiDate(topic.bodyUpdatedAt ?? topic.lastChangedAt, false, timeZone)}</p>
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-2">
            <div className="rounded-xl border border-border/70 bg-surface-subtle px-3 py-2 text-center"><div className="text-lg font-bold tabular-nums text-fg">{sourceCount(items)}</div><div className="text-meta text-fg-muted">{t('wiki.trust.sources')}</div></div>
            <div className="rounded-xl border border-warning/20 bg-pending-weak px-3 py-2 text-center"><div className="text-lg font-bold tabular-nums text-pending">{openItems.length}</div><div className="text-meta text-pending">{t('wiki.state.open')}</div></div>
            <div className={`rounded-xl border px-3 py-2 text-center ${conflictCount > 0 ? 'border-danger/20 bg-danger-weak' : 'border-success/20 bg-success-weak'}`}><div className={`text-lg font-bold tabular-nums ${conflictCount > 0 ? 'text-danger' : 'text-success'}`}>{conflictCount}</div><div className={`text-meta ${conflictCount > 0 ? 'text-danger' : 'text-success'}`}>{t('wiki.state.conflict')}</div></div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <SectionCard title={t('wiki.document.canonicalTitle')} icon={FileText}>
            <WikiDocumentEditor
              key={topic.bodyUpdatedAt ?? 'empty-document'}
              projectId={projectId}
              userId={userId}
              timeZone={timeZone}
              draftPolicy={draftPolicy}
              topic={{
                id: topic.id,
                title: topic.title,
                bodyMd: topic.bodyMd,
                bodyUpdatedAt: topic.bodyUpdatedAt,
                documentKind: topic.documentKind,
              }}
              canEdit={canWriteMemory}
              canVerify={canVerifyMemory}
            />
          </SectionCard>

          {proposals.length > 0 && (
            <SectionCard title={t('wiki.proposal.title')} icon={AlertTriangle} actions={<span className="chip bg-pending-weak text-pending">{proposals.length}</span>}>
              <p className="-mt-2 mb-3 text-xs leading-5 text-fg-secondary">{t('wiki.proposal.desc')}</p>
              <div className="space-y-3">
                {proposals.map((item) => (
                  <div key={item.id}>
                    <WikiItemCard item={item} showEvidence timeZone={timeZone} minutesBase={minutesBase} />
                    {canReviewMemory && <WikiProposalActions projectId={projectId} topicId={item.topicId} itemId={item.id} />}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          <EvidenceAccordion items={evidenceItems} projectId={projectId} canCurate={canCurateLegacy} timeZone={timeZone} minutesBase={minutesBase} />
        </div>

        <div className="space-y-5 xl:sticky xl:top-(--frame-sticky-top)">
          <TrustPanel projectId={projectId} topic={topic} items={items} canContribute={canWriteMemory} trustState={trustState} timeZone={timeZone} />
          <SectionCard title={t('wiki.section.open.memoryTitle')} icon={ShieldAlert} actions={<span className="chip bg-pending-weak text-pending">{openItems.length + questions.length}</span>}>
            <p className="-mt-2 mb-3 text-xs text-fg-secondary">{t('wiki.section.open.memoryDesc')}</p>
            <OpenLoops items={openItems} questions={questions} projectId={projectId} topicId={topic.id} canCurate={canCurateLegacy} canAnswer={canWriteMemory} timeZone={timeZone} minutesBase={minutesBase} />
            {canWriteMemory && <WikiQuestionCreateForm projectId={projectId} topicId={topic.id} />}
          </SectionCard>
        </div>
      </div>

      <details className="card group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 marker:hidden sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-action-soft text-action"><GitCompareArrows className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0 flex-1"><h3 className="text-sm font-semibold text-fg">{t('wiki.section.timeline.memoryTitle')}</h3></div>
          <span className="chip bg-surface-subtle text-fg-secondary">{data.changes.length}</span><ChevronDown className="h-4 w-4 text-fg-muted transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-border px-5 py-5 sm:px-6">
          {(data.revisions ?? []).length > 0 && (
            <div className="mb-5">
              <h4 className="text-xs font-semibold text-fg">{t('wiki.history.documentRevisions')}</h4>
              <ol className="mt-2 space-y-2">
                {(data.revisions ?? []).map((revision) => (
                  <li key={revision.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-border bg-surface-subtle/55 px-3 py-2 text-xs">
                    <span className="font-semibold text-fg">v{revision.versionNo} · {revision.title}</span>
                    {revision.editedByName && <span className="text-fg-secondary">{revision.editedByName}</span>}
                    <time className={canWriteMemory ? 'text-fg-muted' : 'ml-auto text-fg-muted'}>{formatWikiDate(revision.createdAt, true, timeZone)}</time>
                    {canWriteMemory
                      && (revision.title !== topic.title || revision.bodyMd !== (topic.bodyMd ?? ''))
                      && (
                      <WikiRevisionRestoreButton
                        projectId={projectId}
                        topicId={topic.id}
                        revisionId={revision.id}
                        versionNo={revision.versionNo}
                        expectedUpdatedAt={topic.bodyUpdatedAt ?? null}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <WikiChangeList changes={data.changes} timeZone={timeZone} minutesBase={minutesBase} />
          {(data.changesTruncated || data.dataTruncated) && <p className="mt-3 rounded-lg bg-pending-weak px-3 py-2 text-xs text-pending">{t('wiki.changes.truncated')}</p>}
        </div>
      </details>
    </div>
  )
}
