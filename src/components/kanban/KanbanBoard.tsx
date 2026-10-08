'use client'

import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Layers, Users, Columns3, Search, Inbox, GitBranch } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { actorFromView, isProjectAdmin, type ProjectActorView } from '@/lib/domain/authz'
import { canEditActual } from '@/lib/domain/permissions'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import {
  groupByPhase, groupByOwner, groupByProgress, groupByFlow, bucketOf, dueSignal, leafPaths,
  lensCards, applyQuickFilters, sortCards, FLOW_STAGE_KEYS,
  type KanbanColumn, type ProgressBucket, type QuickFilters, type FlowStageKey,
} from '@/lib/domain/kanban'
import { isStageCode, stageLabelKo, type StageCode } from '@/lib/domain/stageLabels'
import { type ApprovalStepDef, DEFAULT_STEP_CODE } from '@/lib/domain/approvalSteps'
import { setWbsStage, approveWbsStep } from '@/app/actions/wbsAssign'
import { resolveDrop } from '@/lib/domain/kanban-drop'
import { statusOf } from '@/lib/domain/progress'
import { updateActual, getWbsCellSnapshot } from '@/app/actions/wbs'
import { wbsToastText } from '@/lib/wbs/actionErrors'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes, useTeams } from '@/components/app/TeamsProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { classifyCasOutcome, editSessionStore } from '@/lib/sync/editSession'
import { ConflictResolver } from '@/components/ui/ConflictResolver'
import { KanbanCard } from './KanbanCard'
import { ProgressPopover } from './ProgressPopover'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'

type Mode = 'progress' | 'flow' | 'phase' | 'owner'

// 표시 전용 매핑 — 도메인(src/lib/domain/kanban.ts)이 만드는 한국어 컬럼 제목을 번역 키로 변환.
// 매핑에 없는 값(동적 팀명·담당자명·Phase명)은 원본 그대로 표시한다.
const COLUMN_TITLE_KEY: Record<string, DictKey> = {
  '시작전': 'status.not_started',
  '진행중': 'status.in_progress',
  '지연': 'status.delayed',
  '완료': 'status.done',
  '미배정': 'kanban.unassigned',
  '미착수': 'wbs.stageNoneOption',
  '할당됨': 'wbs.stageAs',
  '작업 중': 'wbs.stageIp',
  '검수 대기': 'wbs.stageIm',
}

export function KanbanBoard({
  projectId,
  items,
  actorView,
  today,
  readOnly = false,
  stageLabels = null,
  approvalSteps = null,
  levelLabels = null,
}: {
  projectId: string
  items: ComputedItem[]
  /** 이 프로젝트 스코프의 직렬화 가능한 권한 스냅샷 — Actor(Map)는 RSC 경계를 못 넘는다. */
  actorView: ProjectActorView | null
  today: string
  /** 데모 모드 등에서 편집 어포던스 비활성화 */
  readOnly?: boolean
  stageLabels?: Readonly<Partial<Record<string, string>>> | null
  approvalSteps?: readonly ApprovalStepDef[] | null
  /** 프로젝트 단계 이름(core.level_labels) — 1레벨 묶음 탭·빈 화면 문구가 그 이름을 쓴다. 못 받으면 유형 중립 문구 */
  levelLabels?: readonly string[] | null
}) {
  const router = useRouter()
  const { t } = useLocale()
  const topLevelLabel = levelLabels?.[0] ?? t('kanban.topLevelFallback')
  const { toast } = useToast()
  const teamCodes = useTeamCodes()
  const teams = useTeams()
  const searchParams = useSearchParams()
  // 묶음 기준은 ?group(D36). ?view는 작업 계획 보기(sheet·timeline·board)다.
  const group = searchParams.get('group')
  const urlMode: Mode = group === 'flow' || group === 'phase' || group === 'owner' ? group : 'progress'
  const [mode, setMode] = useState<Mode>(urlMode)
  useEffect(() => setMode(urlMode), [urlMode])
  // 렌즈 기본값 — 관리자 이상이거나 이 프로젝트 명단 팀이 없으면 전체, 그 외(팀 소속 멤버 등)는 내 팀부터.
  // 내 팀 = 이 프로젝트 명단의 팀 전부(한 사람 여러 팀 — 0003). 계정 전역 팀은 더 이상 없다.
  const actor = useMemo(() => actorFromView(actorView, projectId), [actorView, projectId])
  const myTeams = useMemo(() => actorView?.rosterTeamCodes ?? [], [actorView])
  const [lens, setLens] = useState<'myTeam' | 'all'>(() =>
    isProjectAdmin(actor, projectId) || myTeams.length === 0 ? 'all' : 'myTeam')
  const [quick, setQuick] = useState<QuickFilters>({ overdue: false, dueThisWeek: false, inProgress: false, notStarted: false })
  const toggleQuick = (k: keyof QuickFilters) => setQuick(q => ({ ...q, [k]: !q[k] }))
  // ?team= 은 검색어 초기값으로 소비한다 — 칸반 검색 대상에 담당팀 코드가 포함되며,
  // 검색창에 그대로 보여 사용자가 지울 수 있다(숨은 필터 금지).
  const [query, setQuery] = useState(() => {
    const team = searchParams.get('team')
    return team && teamCodes.includes(team) ? team : ''
  })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [confirmCard, setConfirmCard] = useState<ComputedItem | null>(null)
  const [promptState, setPromptState] = useState<{ card: ComputedItem; suggested: number } | null>(null)
  const [override, setOverride] = useState<Record<string, number>>({})
  const [stageOverride, setStageOverride] = useState<Record<string, string | null>>({})
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [failedMoves, setFailedMoves] = useState<Record<string, { attemptedPct: number; prevPct: number; error: string }>>({})
  const [liveMsg, setLiveMsg] = useState('')
  // 이동 충돌 비교(개정 §5.8) — 카드는 의도한 위치에 둔 채 내 값·서버 값을 보인다
  const [moveConflict, setMoveConflict] = useState<{ card: ComputedItem; mine: number; latest: number; base: number } | null>(null)
  // 화면이 내려가면 실패 표시도 사라진다 — 끝나지 않은 이동 세션이 헤더에 영영 남지 않게 걷는다
  useEffect(() => () => {
    editSessionStore.removeWhere(x => x.surface === 'kanban' && x.status !== 'saving' && x.status !== 'saved')
  }, [])
  // 같은 카드에 대한 commit 재진입 방지(더블클릭 등으로 두 번째 요청이 첫 번째보다 먼저 읽는 prev가
  // 이미 낙관적 override로 오염되는 것을 막는다) — 렌더와 무관한 동기 가드라 ref로 관리.
  const inFlightRef = useRef<Set<string>>(new Set())
  // 원본 items(override 미적용) 리프 조회 맵 — 재조정 시 "서버가 이 override를 아직 반영했는지" 판단용.
  const rawLeafById = useMemo(() => {
    const m = new Map<string, ComputedItem>()
    const walk = (ns: ComputedItem[]) => ns.forEach(n => { m.set(n.id, n); walk(n.children) })
    walk(items)
    return m
  }, [items])
  // 서버 데이터가 새로 오면, 서버 값이 아직 따라오지 못한 override만 남기고 나머지는 비운다(재조정).
  // savingIds는 여기서 일괄 리셋하지 않는다 — 카드별로 commit의 finally가 소유한다.
  useEffect(() => {
    setOverride(prev => {
      if (Object.keys(prev).length === 0) return prev
      const next: Record<string, number> = {}
      for (const [id, val] of Object.entries(prev)) {
        const leaf = rawLeafById.get(id)
        if (!leaf || leaf.rolledActualPct !== val) next[id] = val // 서버가 아직 이 값을 반영하지 않음 → 유지
      }
      return next
    })
  }, [rawLeafById])
  useEffect(() => {
    setStageOverride(prev => {
      if (Object.keys(prev).length === 0) return prev
      const next: Record<string, string | null> = {}
      for (const [id, val] of Object.entries(prev)) {
        const leaf = rawLeafById.get(id)
        if (!leaf || (leaf.stage ?? null) !== val) next[id] = val
      }
      return next
    })
  }, [rawLeafById])
  useBotPageContext({
    domain: 'kanban',
    projectId,
    view: mode,
    search: query || null,
    filters: {
      ...(lens === 'myTeam' ? { lens: 'myTeam' } : {}),
      ...(Object.entries(quick).filter(([, v]) => v).reduce((a, [k]) => ({ ...a, [k]: true }), {})),
    },
  })

  const isProgress = mode === 'progress'
  const isFlow = mode === 'flow'
  const editable = !readOnly && (isProgress || isFlow)
  const cardEditable = (card: ComputedItem) => editable && canEditActual(card, actor, projectId)

  // 최초 방문 코치마크 — 진행 뷰(편집 가능) 진입 시 1회, localStorage 플래그로 재노출 방지.
  const COACH_KEY = 'kanban.coach.v1'
  const [showCoach, setShowCoach] = useState(false)
  useEffect(() => {
    if (editable && typeof window !== 'undefined' && !window.localStorage.getItem(COACH_KEY)) setShowCoach(true)
  }, [editable])
  const dismissCoach = () => {
    setShowCoach(false)
    try { window.localStorage.setItem(COACH_KEY, '1') } catch {}
  }

  // 낙관적 override를 items 트리에 입힌 뷰. 저장 확정 전까지 카드가 즉시 옮겨 보이게 한다.
  const viewItems = useMemo<ComputedItem[]>(() => {
    const hasPct = Object.keys(override).length > 0
    const hasStage = Object.keys(stageOverride).length > 0
    if (!hasPct && !hasStage) return items
    const map = (ns: ComputedItem[]): ComputedItem[] => ns.map(n => {
      let updated = n
      if (!n.children.length) {
        if (override[n.id] !== undefined) {
          const pct = override[n.id]
          updated = { ...updated, actualPct: pct, rolledActualPct: pct, status: statusOf(pct, n.plannedPct, n.plannedStart, today) }
        }
        if (stageOverride[n.id] !== undefined) {
          updated = { ...updated, stage: stageOverride[n.id] }
        }
      }
      if (n.children.length) return { ...updated, children: map(n.children) }
      return updated
    })
    return map(items)
  }, [items, override, stageOverride, today])

  const cardById = useMemo(() => {
    const m = new Map<string, ComputedItem>()
    const walk = (ns: ComputedItem[]) => ns.forEach(n => { m.set(n.id, n); walk(n.children) })
    walk(viewItems)
    return m
  }, [viewItems])

  // 리프 id → 조상 이름 배열(카드 breadcrumb 표시용).
  const pathById = useMemo(() => leafPaths(viewItems), [viewItems])

  const baseColumns = useMemo<KanbanColumn[]>(() => {
    if (mode === 'flow') return groupByFlow(viewItems, stageLabels, approvalSteps)
    if (mode === 'owner') return groupByOwner(viewItems, teamCodes, teams)
    if (mode === 'phase') return groupByPhase(viewItems)
    return groupByProgress(viewItems)
  }, [mode, viewItems, stageLabels, approvalSteps, teamCodes, teams])

  const columns = useMemo<KanbanColumn[]>(() => {
    const q = query.trim().toLowerCase()
    return baseColumns.map(col => {
      let cards = lensCards(col.cards, lens, myTeams)
      cards = applyQuickFilters(cards, quick, today)
      if (q) cards = cards.filter(card => `${card.name} ${card.code} ${card.owners.map(o => o.team).join(' ')}`.toLowerCase().includes(q))
      cards = sortCards(cards, today)
      return { ...col, cards, count: cards.length }
    })
  }, [baseColumns, lens, quick, query, myTeams, today])

  // 데이터는 있으나(items.length>0) 렌즈/빠른필터/검색으로 모든 컬럼이 걸러진 상태 — 데이터 0건과 구분해 안내한다.
  const filteredEmpty = items.length > 0 && columns.every(c => c.cards.length === 0)

  // 실적% 반영 — 낙관적으로 먼저 옮기고, 실패하면 의도한 위치 보존 및 재시도 액션 제공(D6-§2-kanban).
  // prev는 원시값(반올림 금지): 반올림하면 (a) 소수 실적(예: 99.6%)에서 가드가 조기 무력화돼 카드가 100%에 영영 못 닿고,
  // (b) updateActual의 CAS가 DB 원시값과 반올림값을 비교해 오탐 충돌을 낸다.
  // expected: 비교에서 '내 값으로 저장'을 고른 재저장 — 사용자가 본 서버 값(최신)을 기대값으로 쓴다.
  async function commit(card: ComputedItem, pct: number, expected?: { latest: number }) {
    const prev = expected ? expected.latest : card.rolledActualPct
    if (prev === pct && !expected) {
      // 재시도인데 서버가 이미 그 값이다(그새 반영·새로고침) — 남은 실패 표시만 걷는다
      if (failedMoves[card.id]) dismissMove(card.id)
      return
    }
    if (inFlightRef.current.has(card.id)) return           // 같은 카드 재진입 방지(더블클릭 등)
    inFlightRef.current.add(card.id)
    const sessionId = `kanban:${card.id}`
    setOverride(o => ({ ...o, [card.id]: pct }))            // 낙관적 이동 보존
    setSavingIds(s => new Set(s).add(card.id))
    editSessionStore.setSession(sessionId, 'kanban', card.id, 'saving')
    const applied = () => {
      // 성공 확정 — 실패 상태 해제 및 세션 동기화
      setFailedMoves(f => { const n = { ...f }; delete n[card.id]; return n })
      editSessionStore.setSession(sessionId, 'kanban', card.id, 'saved')
      setLiveMsg(`${card.name} ${pct}%`)
      router.refresh() // 성공 확정 — 새 items 도착 시 useEffect가 override 비움
    }
    // D6-§2-kanban: 실패해도 카드는 의도한 위치에 남고 재시도·원위치를 고른다
    const failedWith = (errMsg: string, status: 'failed' | 'outcome_unknown' = 'failed') => {
      setFailedMoves(f => ({ ...f, [card.id]: { attemptedPct: pct, prevPct: prev, error: errMsg } }))
      editSessionStore.setSession(sessionId, 'kanban', card.id, status, { error: { kind: status === 'failed' ? 'server_reject' : 'outcome_unknown', message: errMsg } })
      toast({ title: t('kanban.saveFailedTitle'), description: errMsg, variant: 'error' })
    }
    // 그새 다른 사람이 바꿨다(개정 §5.8, Q05) — 카드는 의도한 위치에 둔 채 내 값·서버 값을 나란히 보이고 고르게 한다
    const conflicted = (latest: number) => {
      setFailedMoves(f => ({ ...f, [card.id]: { attemptedPct: pct, prevPct: prev, error: t('kanban.conflict') } }))
      editSessionStore.setSession(sessionId, 'kanban', card.id, 'conflict', { error: { kind: 'conflict', message: t('kanban.conflict') } })
      setMoveConflict({ card, mine: pct, latest, base: prev })
    }
    const sameValue = (a: number | null, b: number | null) => Number(a ?? 0) === Number(b ?? 0)
    try {
      let res: Awaited<ReturnType<typeof updateActual>>
      try {
        res = await updateActual(card.id, pct, prev)   // CAS: expectedCurrent = 현재값
      } catch {
        // 응답 유실(§5.8.1 OutcomeUnknown, Q10) — 실패로 단정하지 않고, 다시 보내지도 않고, 서버 값을 읽어 가린다
        editSessionStore.setSession(sessionId, 'kanban', card.id, 'outcome_unknown')
        const snap = await getWbsCellSnapshot(card.id).catch(() => null)
        if (!snap?.ok) return failedWith(t('common.outcomeUnknown'), 'outcome_unknown')
        const outcome = classifyCasOutcome<number | null>({ mine: pct, base: prev, latest: snap.actualPct }, sameValue)
        if (outcome === 'applied') return applied()
        if (outcome === 'conflict') return conflicted(Number(snap.actualPct ?? 0))
        return failedWith(t('common.outcomeNotApplied'))
      }
      if (res.ok) return applied()
      if (res.conflict && res.latest !== undefined) {
        // 서버 값이 이미 내 값이다 = 앞선 내 이동이 반영돼 있었다(응답만 잃었다) — 충돌이 아니다
        if (sameValue(res.latest, pct)) return applied()
        return conflicted(Number(res.latest ?? 0))
      }
      const errMsg = res.conflict ? t('kanban.conflict')
        : res.code === 'actual_locked' ? t('wbs.actualLocked')
          : res.code === 'approval_required' ? t('wbs.err.approvalRequired')
            : wbsToastText(t, res.error, 'kanban.errChange')
      failedWith(errMsg)
      if (res.conflict) router.refresh()
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(card.id); return n })
      inFlightRef.current.delete(card.id)
    }
  }
  const dismissMove = (cardId: string) => {
    setOverride(o => { const n = { ...o }; delete n[cardId]; return n })
    setFailedMoves(f => { const n = { ...f }; delete n[cardId]; return n })
    editSessionStore.removeSession(`kanban:${cardId}`)
  }

  async function handleMoveStage(card: ComputedItem, nextStageKey: FlowStageKey) {
    const currentStage = (card.stage && isStageCode(card.stage)) ? card.stage : 'none'
    if (currentStage === nextStageKey) return
    const nextStage: StageCode | null = nextStageKey === 'none' ? null : nextStageKey

    if (inFlightRef.current.has(card.id)) return
    inFlightRef.current.add(card.id)
    const sessionId = `kanban-stage:${card.id}`
    setStageOverride(prev => ({ ...prev, [card.id]: nextStage }))
    setSavingIds(s => new Set(s).add(card.id))
    editSessionStore.setSession(sessionId, 'kanban', card.id, 'saving')

    try {
      const res = await setWbsStage(card.id, nextStage)
      if (!res.ok) {
        setStageOverride(prev => {
          const copy = { ...prev }
          delete copy[card.id]
          return copy
        })
        const errMsg = res.error || t('kanban.errChange')
        toast({
          title: t('kanban.saveFailedTitle'),
          description: errMsg,
          variant: 'error',
        })
        editSessionStore.setSession(sessionId, 'kanban', card.id, 'failed', {
          error: { kind: 'server_reject', message: errMsg },
        })
        return
      }
      editSessionStore.setSession(sessionId, 'kanban', card.id, 'saved')
      setLiveMsg(`${card.name} 단계 변경: ${nextStage ?? '미착수'}`)
      router.refresh()
    } catch {
      setStageOverride(prev => {
        const copy = { ...prev }
        delete copy[card.id]
        return copy
      })
      const errMsg = t('kanban.saveFailedTitle') || '저장에 실패했습니다.'
      toast({ title: errMsg, variant: 'error' })
      editSessionStore.setSession(sessionId, 'kanban', card.id, 'failed', {
        error: { kind: 'server_reject', message: errMsg },
      })
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(card.id); return n })
      inFlightRef.current.delete(card.id)
    }
  }

  async function handleApproveStep(card: ComputedItem) {
    if (inFlightRef.current.has(card.id)) return
    inFlightRef.current.add(card.id)
    const sessionId = `kanban-approve:${card.id}`
    setSavingIds(s => new Set(s).add(card.id))
    editSessionStore.setSession(sessionId, 'kanban', card.id, 'saving')

    try {
      const stepCode = approvalSteps?.[0]?.code ?? DEFAULT_STEP_CODE
      const res = await approveWbsStep(card.id, stepCode)
      if (!res.ok) {
        const errMsg = res.error || t('kanban.errChange')
        toast({
          title: t('kanban.saveFailedTitle'),
          description: errMsg,
          variant: 'error',
        })
        editSessionStore.setSession(sessionId, 'kanban', card.id, 'failed', {
          error: { kind: 'server_reject', message: errMsg },
        })
        return
      }
      editSessionStore.setSession(sessionId, 'kanban', card.id, 'saved')
      setLiveMsg(`${card.name} 승인 완료`)
      router.refresh()
    } catch {
      const errMsg = t('kanban.saveFailedTitle') || '승인에 실패했습니다.'
      toast({ title: errMsg, variant: 'error' })
      editSessionStore.setSession(sessionId, 'kanban', card.id, 'failed', {
        error: { kind: 'server_reject', message: errMsg },
      })
    } finally {
      setSavingIds(s => { const n = new Set(s); n.delete(card.id); return n })
      inFlightRef.current.delete(card.id)
    }
  }

  function handleMoveBucket(card: ComputedItem, targetBucket: ProgressBucket) {
    const r = resolveDrop(card, targetBucket)
    if (r.kind === 'noop') return
    if (r.kind === 'set') commit(card, r.pct)
    else if (r.kind === 'confirm-reset') setConfirmCard(card)
    else if (r.kind === 'prompt') setPromptState({ card, suggested: r.suggested })
  }

  function handleDrop(e: DragEvent<HTMLDivElement>, columnKey: string) {
    e.preventDefault()
    setDragOverKey(null)
    const id = e.dataTransfer.getData('text/plain')
    setDraggingId(null)
    const card = id ? cardById.get(id) : undefined
    if (!card || !cardEditable(card)) return
    const r = resolveDrop(card, columnKey as ProgressBucket)
    if (r.kind === 'noop') return
    if (r.kind === 'set') commit(card, r.pct)
    else if (r.kind === 'confirm-reset') setConfirmCard(card)
    else if (r.kind === 'prompt') setPromptState({ card, suggested: r.suggested })
  }

  const stepCard = (card: ComputedItem, delta: number) =>
    commit(card, Math.max(0, Math.min(100, Math.round(card.rolledActualPct) + delta)))
  const startCard = (card: ComputedItem) => setPromptState({ card, suggested: 30 })
  const reopenCard = (card: ComputedItem) => setPromptState({ card, suggested: 90 })
  const openInWbs = (card: ComputedItem) => router.push(`/p/${projectId}/wbs?view=sheet&focus=${card.id}`)

  if (items.length === 0) {
    return (
      <div data-kanban-board><EmptyState
        icon={Inbox}
        title={t('kanban.emptyTitle')}
        description={t('kanban.emptyDesc').replace('{level}', topLevelLabel)}
      /></div>
    )
  }

  return (
    // 헤드(툴바·안내)는 고정하고 보드만 남은 높이를 채운다 — 세로 스크롤은 컬럼 안에서만 일어난다.
    <div data-kanban-board data-kanban-group={mode} className="flex h-full min-h-0 flex-col gap-4">
      {/* 툴바 */}
      <div className="flex shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SegmentedTabs<Mode>
          value={mode}
          onChange={setMode}
          tabs={[
            { key: 'progress', label: t('kanban.byProgress'), icon: Columns3 },
            { key: 'flow', label: t('kanban.byFlow'), icon: GitBranch },
            { key: 'phase', label: t('kanban.byPhase').replace('{level}', topLevelLabel), icon: Layers },
            { key: 'owner', label: t('kanban.byOwner'), icon: Users },
          ]}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SegmentedTabs<'myTeam' | 'all'>
            size="sm"
            value={lens}
            onChange={setLens}
            tabs={[
              { key: 'myTeam', label: t('kanban.lensMyTeam') },
              { key: 'all', label: t('kanban.lensAll') },
            ]}
          />
          {/* 빠른 필터 — 다중 선택. 일정(지연·이번주마감)과 진척(진행중·미착수)은 서로 다른 갈래라
              AND로 좁히고, 같은 갈래 안(진행중·미착수)은 OR로 합친다. 구분선으로 갈래를 눈에 보이게. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['overdue', 'kanban.qfOverdue', 'schedule'],
              ['dueThisWeek', 'kanban.qfDueThisWeek', 'schedule'],
              ['inProgress', 'kanban.qfInProgress', 'bucket'],
              ['notStarted', 'kanban.qfNotStarted', 'bucket'],
            ] as [keyof QuickFilters, DictKey, 'schedule' | 'bucket'][]).map(([k, label, group], i, arr) => (
              <Fragment key={k}>
                {i > 0 && arr[i - 1][2] !== group && (
                  <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
                )}
                <button
                  type="button"
                  aria-pressed={quick[k]}
                  title={t(group === 'bucket' ? 'kanban.qfBucketHint' : 'kanban.qfScheduleHint')}
                  onClick={() => toggleQuick(k)}
                  className={`badge transition cursor-pointer ${quick[k] ? 'bg-action text-action-fg font-semibold' : 'bg-surface-subtle text-fg-secondary hover:text-fg hover:bg-surface-hover'}`}
                >{t(label)}</button>
              </Fragment>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('kanban.searchPlaceholder')}
              aria-label={t('kanban.searchPlaceholder')}
              className="app-input pl-9 sm:w-56"
            />
          </div>
          {savingIds.size > 0 && <span className="text-meta text-fg-muted">{t('kanban.saving')}</span>}
        </div>
      </div>

      {/* 조회 전용 힌트(phase·owner 뷰일 때) */}
      {(mode === 'phase' || mode === 'owner') && !readOnly && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-border/80 bg-surface-subtle/50 px-3.5 py-2 text-[12px] text-fg-muted">
          {t('kanban.readOnlyHint')}
        </div>
      )}

      {/* 흐름 뷰 안내 */}
      {mode === 'flow' && !readOnly && (
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-border/80 bg-surface-subtle/50 px-3.5 py-2 text-[12px] text-fg-muted">
          {t('kanban.flowReadOnlyHint')}
        </div>
      )}

      {/* 최초 방문 코치마크(진행 뷰) */}
      {showCoach && editable && (
        <div className="flex shrink-0 items-start justify-between gap-3 rounded-xl border border-action/25 bg-action-soft px-3.5 py-2.5">
          <div>
            <p className="text-[13px] font-semibold text-action">{t('kanban.coachTitle')}</p>
            <p className="mt-0.5 text-[12px] text-fg-secondary">{t('kanban.coachDesc')}</p>
          </div>
          <button className="btn btn-ghost btn-sm shrink-0" onClick={dismissCoach}>{t('kanban.coachDismiss')}</button>
        </div>
      )}

      {/* 필터 결과 0건 안내(데이터 자체는 있음) */}
      {filteredEmpty && (
        <div className="shrink-0 rounded-xl border border-dashed border-border/80 px-4 py-3 text-center text-[12px] text-fg-muted">
          <span className="font-medium text-fg">{t('kanban.noMatchTitle')}</span> · {t('kanban.noMatchDesc')}
        </div>
      )}

      {/* 보드 */}
      <div className="flex min-h-0 flex-1 items-start gap-4 overflow-x-auto pb-2">
        {columns.map(col => {
          const draggingCard = draggingId ? cardById.get(draggingId) : undefined
          // 표시 시점에만 한국어 컬럼 제목을 번역 — 도메인의 Record 키('미배정' 등)는 건드리지 않는다.
          const titleKey = COLUMN_TITLE_KEY[col.title]
          const displayTitle = titleKey ? t(titleKey) : col.title
          const isDropZone = editable && isProgress // 진행 모드일 때만 드롭 대상 (흐름 모드는 드래그 없음)
          // 드래그 중인 카드를 이 컬럼이 받을 수 있을 때만 활성 하이라이트.
          const accepts = isDropZone && (!draggingCard || resolveDrop(draggingCard, col.key as ProgressBucket).kind !== 'noop')
          const active = accepts && dragOverKey === col.key && draggingId !== null
          return (
            <div
              key={col.key}
              onDragOver={isDropZone ? e => { if (accepts) { e.preventDefault(); setDragOverKey(col.key) } } : undefined}
              onDragLeave={isDropZone ? () => setDragOverKey(k => (k === col.key ? null : k)) : undefined}
              onDrop={isDropZone ? e => handleDrop(e, col.key) : undefined}
              className={`card flex max-h-full w-[290px] min-w-[290px] flex-col p-3 transition bg-surface/90
                ${active ? 'border-action ring-2 ring-border-focus' : 'border-border/70'}`}
            >
              <header className="flex flex-col gap-1 px-1 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${col.accentDot ?? 'bg-action'}`} />
                    <h3 className="truncate text-[13px] font-semibold text-fg tracking-tight" title={displayTitle}>{displayTitle}</h3>
                  </div>
                  <span className="badge shrink-0 bg-surface-subtle text-fg-secondary font-semibold tabular-nums">{col.count}</span>
                </div>
                {col.subtitle && (
                  <p className="truncate pl-4.5 text-meta text-fg-muted" data-testid="kanban-col-subtitle" title={col.subtitle}>
                    {col.subtitle}
                  </p>
                )}
              </header>

              <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-0.5">
                {col.cards.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 py-8 text-center text-[12px] text-fg-muted">
                    {isDropZone ? t('kanban.dropHere') : t('kanban.noTasks')}
                  </div>
                ) : (
                  col.cards.map(card => {
                    const canEdit = cardEditable(card)
                    const canDrag = canEdit && isProgress
                    const b = bucketOf(card.rolledActualPct)
                    const curStage = (card.stage && isStageCode(card.stage)) ? card.stage : 'none'
                    const stageOpts = isFlow ? FLOW_STAGE_KEYS.map(k => {
                      const titles: Record<FlowStageKey, string> = {
                        none: stageLabels?.none || stageLabelKo(null),
                        as: stageLabels?.as || stageLabelKo('as'),
                        ip: stageLabels?.ip || stageLabelKo('ip'),
                        im: stageLabels?.im || stageLabelKo('im'),
                        xx: stageLabels?.xx || stageLabelKo('xx'),
                      }
                      return {
                        key: k,
                        label: titles[k],
                        current: curStage === k,
                      }
                    }) : undefined
                    const bucketOpts = isProgress ? ([
                      { key: 'not_started' as const, label: t('status.not_started'), current: b === 'not_started' },
                      { key: 'in_progress' as const, label: t('status.in_progress'), current: b === 'in_progress' },
                      { key: 'done' as const, label: t('status.done'), current: b === 'done' },
                    ]) : undefined

                    return (
                      <KanbanCard
                        key={card.id}
                        card={card}
                        bucket={b}
                        pathLabel={pathById.get(card.id)?.[0]}
                        due={dueSignal(card.plannedEnd, card.rolledActualPct, today)}
                        draggable={canDrag}
                        editable={canEdit}
                        stageOptions={stageOpts}
                        onMoveStage={canEdit && isFlow ? (k) => void handleMoveStage(card, k as FlowStageKey) : undefined}
                        bucketOptions={bucketOpts}
                        onMoveBucket={canEdit && isProgress ? (k) => handleMoveBucket(card, k) : undefined}
                        onApprove={canEdit && isFlow && card.stage === 'im' ? () => void handleApproveStep(card) : undefined}
                        dragging={draggingId === card.id}
                        saving={savingIds.has(card.id)}
                        failed={failedMoves[card.id] ? {
                          error: failedMoves[card.id].error,
                          // 그려진 카드는 낙관 이동이 입혀져 있다(실적% = 의도한 값) — 기준은 서버가 준 원본 값이어야 재시도가 실제로 나간다
                          onRetry: () => void commit(rawLeafById.get(card.id) ?? card, failedMoves[card.id].attemptedPct),
                          onDismiss: () => dismissMove(card.id),
                        } : undefined}
                        onOpen={() => openInWbs(card)}
                        onStart={canDrag ? () => startCard(card) : undefined}
                        onStep={canDrag ? d => stepCard(card, d) : undefined}
                        onComplete={canDrag ? () => commit(card, 100) : undefined}
                        onReopen={canDrag ? () => reopenCard(card) : undefined}
                        onDragStart={canDrag ? e => {
                          e.dataTransfer.setData('text/plain', card.id)
                          e.dataTransfer.effectAllowed = 'move'
                          setDraggingId(card.id)
                        } : undefined}
                        onDragEnd={() => setDraggingId(null)}
                      />
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 스크린리더 진행률 변경 확정 안내 — 시각적으로는 숨김 */}
      <div aria-live="polite" className="sr-only">{liveMsg}</div>
      <ConflictResolver
        open={!!moveConflict}
        target={moveConflict?.card.name}
        fields={moveConflict ? [{ key: 'actual', label: t('wbs.colActualPct'), mine: `${moveConflict.mine}%`, latest: `${moveConflict.latest}%`, base: `${moveConflict.base}%` }] : []}
        onKeepMine={() => { const c = moveConflict; if (!c) return; setMoveConflict(null); void commit(c.card, c.mine, { latest: c.latest }) }}
        onTakeLatest={() => { const c = moveConflict; if (!c) return; setMoveConflict(null); dismissMove(c.card.id); router.refresh() }}
        onContinue={() => setMoveConflict(null)}
      />

      <Modal
        open={confirmCard !== null}
        onClose={() => setConfirmCard(null)}
        title={t('kanban.resetTitle')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button className="btn btn-ghost" onClick={() => setConfirmCard(null)}>{t('kanban.cancel')}</button>
            <button className="btn btn-primary" onClick={() => { if (confirmCard) commit(confirmCard, 0); setConfirmCard(null) }}>{t('kanban.resetConfirm')}</button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-fg-secondary">{t('kanban.resetDesc')}</p>
      </Modal>

      {promptState && (
        <ProgressPopover
          open
          title={t('kanban.progressTitle')}
          initial={promptState.suggested}
          onClose={() => setPromptState(null)}
          onSubmit={pct => { commit(promptState.card, pct); setPromptState(null) }}
        />
      )}
    </div>
  )
}
