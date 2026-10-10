'use client'
// 에이전트 허브 클라이언트 루트 — 상태 줄 → 위임 표 → 승인 큐. 폴링 없음(조작 화면).
// 좌석 층은 /agents/office 가 그린다(2026-09-14 스튜디오 분리). 위임 체크는 묶음 저장 응답에 실린 허브로 교체하고(재조회 없음),
// 그 밖의 변경 뒤 refreshAgentHub 1회, 탭이 다시 보이면 1회. 실패는 마지막 데이터 유지 + 상단 표시. 페이지 전체 refresh 금지(허브 스펙 §7).
// 표에서 이름을 누르면 WBS 상세 패널(RowDetailPanel)을 이 화면 위에 그대로 띄운다(2026-09-15) — WBS 페이지로 이동하지 않는다.
// 그 패널이 요구하는 계산된 WBS 데이터(ComputedItem·의존·일정)는 서버 페이지가 허브와 함께 실어 준다.
import type { PredecessorGate } from '@/lib/domain/agentWork'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentHub } from '@/lib/domain/agentHub'
import type { ComputedItem, ProjectMember, TaskDependency } from '@/lib/domain/types'
import { actorFromView, isProjectAdmin, type ProjectActorView } from '@/lib/domain/authz'
import { computeDependencySchedule } from '@/lib/domain/dependencySchedule'
import { calendarOf } from '@/lib/domain/calendar'
import type { CalendarInput } from '@/lib/calendar/load'
import { canAttachDeliverable, canEditDeliverable } from '@/lib/domain/permissions'
import { refreshAgentHub } from '@/app/actions/agentHub'
import { useWbsRealtimeBurst } from '@/lib/hooks/useWbsRealtimeBurst'
import { applyWbsChange } from '@/lib/domain/wbsRealtime'
import { RowDetailPanel } from '@/components/wbs/RowDetailPanel'
import { StageLabelsProvider } from '@/components/wbs/StageLabelsProvider'
import type { StageLabels } from '@/lib/settings/defs/project'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { useLocale } from '@/components/providers/LocaleProvider'
import { KO_LOCALE } from '@/lib/i18n/format'
import { fill } from '@/components/agents/labelKeys'
import { HubStatusBar } from './HubStatusBar'
import { AgentFrame, type HeroTile } from './AgentFrame'
import { DelegationTable, type HubFilter } from './DelegationTable'
import { ApprovalQueue } from './ApprovalQueue'

const hhmmss = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString(KO_LOCALE, { hour12: false, timeZone })
const EMPTY_REFS: string[] = [] // 매 렌더 새 리터럴이면 패널 readiness useMemo 가 매번 다시 돈다 — 모듈 상수로 고정.

/** RowDetailPanel 이 요구하는 계산된 WBS 묶음 — WBS 페이지가 WbsGanttSheet 에 넘기는 것과 같은 데이터(서버 페이지가 로드). */
export type HubWbsBundle = {
  items: ComputedItem[]
  dependencies: TaskDependency[]
  unresolvedDepends: Record<string, string[]>
  /** 프로젝트 달력(직렬화 꼴 — RSC 경계) — 실시간 재계산·의존성 일정의 근무일 판정 */
  calendar: CalendarInput
  today: string
  /** 단계 이름 — null 이면 손상·부재다. 상세 패널만 쓰므로 허브는 그리고 패널 자리에 levelsError 를 띄운다(개정 §2.5) */
  levelLabels: string[] | null
  /** 추가 축 이름(core.extra_axis_label) — 상세 패널의 변경 이력이 쓴다. null 은 기본 문구 */
  extraAxisLabel?: string | null
  levelsError: { error: string; key: string } | null
  /** 달력 손상(A-4 리뷰 N3) — 상세 패널 데이터를 계산할 수 없다. 허브는 그리고 패널 자리에 이 사유를 띄운다(FN-8). 정상이면 null */
  calendarError: { error: string; key: string } | null
  maxDepth: number | null
  members: ProjectMember[]
  /** 명단 조회 실패 사유 — null 이면 정상. 실패면 members 는 비어 있고 표 위에 사유를 띄운다(0명으로 위장하지 않는다). */
  membersError: string | null
  actorView: ProjectActorView | null
  /** 선행 기준·승인 주문 축(SP5b D21) — 상세 패널의 spec 선행 판정 재료. 옛 호출부·시험은 생략할 수 있다(reached·승인 축 없음) */
  predecessorGate?: PredecessorGate
  approvedItemIds?: readonly string[]
  /** 프로젝트의 단계 이름(SP5b W2) — 없으면 기본 이름 */
  stageLabels?: StageLabels | null
}

/** 트리를 전위 순서로 평탄화 — 색인·일정 계산용(WbsGanttSheet 의 지역 flatten 과 같은 규칙). */
function flattenComputed(items: ComputedItem[]): ComputedItem[] {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => { out.push(n); walk(n.children) })
  walk(items)
  return out
}

export function AgentHubView({ initial, wbs, timeZone, showTimeZone = false }: {
  initial: AgentHub; wbs: HubWbsBundle
  /** 시각을 찍을 시간대(프로젝트 calendar.timezone) — 서버가 내려준다 */
  timeZone: string
  /** 시각 뒤에 시간대 이름을 붙인다 — 프로젝트 달력을 못 읽어 기준 UTC 로 찍을 때(A-4 리뷰 N3, 라벨이 사실이게) */
  showTimeZone?: boolean
}) {
  const { t } = useLocale()
  const [hub, setHub] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  // 관리자는 프로젝트 전체를 관리하니 all, 멤버는 자기 담당부터.
  const [filter, setFilter] = useState<HubFilter>(initial.viewer.isAdmin ? 'all' : 'mine')
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  // 이름 클릭으로 연 상세 패널 대상 — WBS 항목 id.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const inflight = useRef(false)
  /* 상세 패널이 읽는 계산된 트리. 서버 페이지가 준 값을 미러링하고 실시간 신호로 그 행만 고친다.
     서버가 새 트리를 주면(경로 전환) 그쪽이 정본이라 덮어쓴다 — 렌더 중에 맞추는 React 표준 패턴. */
  const [wbsItems, setWbsItems] = useState(wbs.items)
  const [seenWbsItems, setSeenWbsItems] = useState(wbs.items)
  if (seenWbsItems !== wbs.items) {
    setSeenWbsItems(wbs.items)
    setWbsItems(wbs.items)
  }

  const applyHub = useCallback((h: AgentHub) => { setHub(h); setNowMs(Date.parse(h.fetchedAt)); setError(null) }, [])
  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const r = await refreshAgentHub(hub.projectId)
      if (r.ok) applyHub(r.hub)
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [hub.projectId, applyHub])

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])

  // 실시간(0098) — 에이전트가 단계를 올리면 탭을 보고 있지 않아도 큐가 따라온다.
  // **부분 패치가 아니라 재조회**인 이유: 승인 대기 카드는 주문 상태·보고 본문(agent·percent·
  // summary·links)·서브트리 관리자 판정으로 조립되는데 트리거 페이로드에는 그 정보가 없다.
  // 새 보고로 카드가 "뜨는" 것이 이 화면에서 가장 값진 실시간이라, 제거만 되는 부분 패치로는
  // 반쪽이 된다. refreshAgentHub 1회면 추가·갱신·제거를 모두 덮는다(페이지 전체 refresh 아님, §7).
  // 대시보드보다 짧게 잡는다 — 조작 화면이라 체감이 중요하고, 서버 액션 1회는 RSC 전량
  // 재렌더보다 훨씬 싸며, 보는 사람이 그 프로젝트 관리자 몇뿐이라 쇄도 위험이 작다.
  //
  // 상세 패널 데이터(wbs.items)는 서버 페이지가 실어 준 값이라 refreshAgentHub 로 갱신되지 않는다.
  // 허브만 바뀌고 패널이 낡으면 같은 화면이 서로 다른 숫자를 보여준다. 그쪽은 행 정체성이 있으니
  // 같은 구독에서 즉시 부분 패치한다(채널은 하나만 연다).
  const cal = useMemo(() => calendarOf(wbs.calendar), [wbs.calendar])
  useWbsRealtimeBurst({
    projectId: hub.projectId,
    run: () => { void refresh() },
    delayMs: 1_000, maxWaitMs: 5_000, jitterMs: 2_000,
    onChange: payload => setWbsItems(cur =>
      applyWbsChange(cur, payload, { today: wbs.today, calendar: cal }) ?? cur),
  })
  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => { const tick = window.setInterval(() => setNowMs(n => n + 1000), 1000); return () => window.clearInterval(tick) }, [])

  // 상세 패널 데이터 — WBS 페이지(WbsGanttSheet)와 같은 계산. 허브 갱신과 무관하게 서버 페이지 데이터로 고정된다.
  const allFlat = useMemo(() => flattenComputed(wbsItems), [wbsItems])
  const itemById = useMemo(() => new Map(allFlat.map(i => [i.id, i])), [allFlat])
  const schedule = useMemo(
    () => computeDependencySchedule(
      allFlat.map(i => ({ id: i.id, plannedStart: i.plannedStart, plannedEnd: i.plannedEnd, actualPct: i.rolledActualPct })),
      wbs.dependencies, wbs.today, cal,
    ),
    [allFlat, wbs.dependencies, wbs.today, cal],
  )
  const actor = useMemo(() => actorFromView(wbs.actorView, hub.projectId), [wbs.actorView, hub.projectId])
  const isAdmin = isProjectAdmin(actor, hub.projectId)
  const selectedItem = selectedId ? itemById.get(selectedId) ?? null : null
  const tzTag = showTimeZone ? ` (${timeZone})` : ''

  const c = hub.counters
  const tiles: HeroTile[] = [
    { key: 'delegated', label: t('agentHub.tile.delegated'), value: c.delegated, color: 'var(--color-border-input)', valueColor: 'var(--color-fg)', bar: false },
    { key: 'ready', label: t('agentHub.tile.ready'), value: c.ready, color: 'var(--color-pending)' },
    { key: 'working', label: t('agentHub.tile.working'), value: c.working, color: 'var(--color-progress)' },
    { key: 'waiting', label: t('agents.state.wait'), value: c.waiting, color: 'var(--color-warning)' },
    // 막힘은 대기의 부분집합(선행 대기·에이전트 꺼짐) — 막대에 넣으면 이중으로 센다.
    { key: 'stuck', label: t('agentHub.tile.stuck'), value: c.stuck, color: 'var(--color-danger)', bar: false },
  ]
  const lede = (
    <>
      {t('agentHub.lede.before')}<b>{fill(t('agentHub.lede.count'), { n: c.delegated })}</b>{t('agentHub.lede.mid')}<b>{fill(t('agentHub.lede.count'), { n: c.working })}</b>{t('agentHub.lede.after')}
      {c.waiting > 0 && <> <em>{fill(t('agentHub.lede.waiting'), { n: c.waiting })}</em></>}
    </>
  )
  const tools = (
    <>
      <HubStatusBar projectId={hub.projectId} registered={hub.registered} enabled={hub.enabled}
        watchers={hub.watchers} isAdmin={hub.viewer.isAdmin} />
      <div className="ml-auto flex items-center gap-2 text-xs text-fg-secondary">
        <span data-hub-stamp className={error ? 'text-warning' : ''}>
          {error
            ? fill(t('agents.stamp.fail'), { time: `${hhmmss(error.at, timeZone)}${tzTag}`, message: error.message })
            : fill(t('agents.stamp.ok'), { time: `${hhmmss(hub.fetchedAt, timeZone)}${tzTag}` })}
        </span>
        <button type="button" data-hub-refresh className="btn btn-ghost h-8 px-2 text-xs" onClick={() => { void refresh() }}>{t('agentHub.refresh')}</button>
      </div>
    </>
  )

  return (
    <StageLabelsProvider labels={wbs.stageLabels}>
    <AgentFrame projectId={hub.projectId} projectName={hub.projectName} title={t('agentHub.title')} lede={lede} tiles={tiles} tools={tools}>
      <div className="space-y-4">
        {wbs.membersError && <RosterLoadError error={wbs.membersError} />}
        <DelegationTable rows={hub.rows} projectId={hub.projectId} isAdmin={hub.viewer.isAdmin} filter={filter} onFilter={setFilter}
          nowMs={nowMs} onHub={applyHub} onChanged={refresh} onSelect={setSelectedId} />
        <ApprovalQueue queue={hub.queue} projectId={hub.projectId} isAdmin={hub.viewer.isAdmin} onHub={applyHub} onChanged={refresh} timeZone={timeZone} showTimeZone={showTimeZone} />
        {selectedId && wbs.calendarError && (
          <div data-hub-detail-unavailable>
            <ConfigLoadError error={wbs.calendarError.error} keyName={wbs.calendarError.key} />
          </div>
        )}
        {selectedItem && wbs.levelLabels === null && (
          <div data-hub-detail-unavailable>
            <ConfigLoadError error={wbs.levelsError?.error ?? ''} keyName={wbs.levelsError?.key ?? 'core.level_labels'} />
          </div>
        )}
        {/* [RF5] 근무일을 찾지 못하면 일정 계산을 건너뛴다 — 간트와 같은 문구로 그 사유를 보인다(A-3 리뷰 P3) */}
        {selectedItem && schedule.calendarError && <p role="status" data-hub-no-workday className="text-[12px] text-danger">{t('wbs.noWorkday')}</p>}
        {selectedItem && wbs.levelLabels !== null && (
          <RowDetailPanel
            item={selectedItem}
            timeZone={timeZone}
            allItems={allFlat}
            dependencies={wbs.dependencies}
            schedule={schedule.byId.get(selectedItem.id)}
            // 패널에서 이름·일정 등을 고치면 표의 그 행이 낡는다(hub 는 useState 라 페이지 refresh 로 갱신되지 않는다).
            // 닫을 때 허브만 1회 재조회해 표를 맞춘다 — 페이지 전체 재렌더는 하지 않는다(§7).
            onClose={() => { setSelectedId(null); void refresh() }}
            editable={isAdmin}
            canAttach={canAttachDeliverable(selectedItem, actor, hub.projectId)}
            canEditDeliverable={canEditDeliverable(selectedItem, actor, hub.projectId)}
            projectId={hub.projectId}
            workspaceId={wbs.actorView?.workspaceId ?? null}
            levelLabels={wbs.levelLabels}
            extraAxisLabel={wbs.extraAxisLabel}
            maxDepth={wbs.maxDepth}
            members={wbs.members}
            predecessorGate={wbs.predecessorGate}
            approvedItemIds={wbs.approvedItemIds}
            onSelectItem={setSelectedId}
            unresolvedRefs={wbs.unresolvedDepends[selectedItem.id] ?? EMPTY_REFS}
          />
        )}
      </div>
    </AgentFrame>
    </StageLabelsProvider>
  )
}
