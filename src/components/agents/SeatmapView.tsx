'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useScope } from '@/components/app/ScopeContext'
import { wsHref } from '@/lib/workspace/paths'
import type { Seat, Seatmap, SeatmapScope } from '@/lib/domain/seatmap'
import { seatmapChannelProjectIds } from '@/lib/domain/seatmap'
import { refreshSeatmap } from '@/app/actions/agentSeatmap'
import { runHubProcessOp, type HubProcessOp } from '@/app/actions/agentHub'
import { useLocale } from '@/components/providers/LocaleProvider'
import { KO_LOCALE } from '@/lib/i18n/format'
import { OfficeNav } from './OfficeNav'
import { AttentionBand } from './AttentionBand'
import { FloorCard } from './FloorCard'
import { LaneBoard } from './LaneBoard'
import { DetailPanel, type NoteDraft } from './DetailPanel'
import { opSpec, type SeatOpKind } from './seatOps'
import { fill } from './labelKeys'
import { SeatmapRealtime } from './SeatmapRealtime'
import { IconAgentView, IconApprove, IconChat, IconFloorView, IconLaneView } from './icons'
import { OfficeChatterContext } from './SeatSpeech'
import { RosterBoard, rosterHero, useRoster } from './RosterBoard'
import { AgentFrame, type HeroTile } from '@/components/agent-hub/AgentFrame'
import css from './seatmap.module.css'

function findSeat(map: Seatmap, orderId: string | null): { seat: Seat; floorName: string; zoneLabel: string } | null {
  if (!orderId) return null
  for (const f of map.floors) for (const z of f.zones) for (const s of z.seats) {
    if (s.orderId === orderId) return { seat: s, floorName: f.name, zoneLabel: `${z.code} ${z.name}` }
  }
  return null
}

const hhmmss = (iso: string, timeZone: string) => new Date(iso).toLocaleTimeString(KO_LOCALE, { hour12: false, timeZone })

/** 평면도(지켜보는 화면) · 상태 레인(처리하는 화면) · 에이전트(누가 어느 PC 어느 자리에서 일하는가, 2026-09-18). */
type OfficeView = 'floor' | 'lane' | 'agent'
const VIEW_KEY = 'dflow.office.view'
/** '완료 포함' — 평면도에 머지 완료(최근 7일) 좌석까지 그릴지. 보기와 같이 이 브라우저에만 기억한다. */
const DONE_KEY = 'dflow.office.done'
/** 잡담 켬/끔 — 끈 사람만 '0' 을 남긴다. 값이 없으면 켬(토글이 생기기 전 동작). */
const CHATTER_KEY = 'dflow.office.chatter'

/** 좌석표 클라이언트 루트. 30초 폴링, 숨긴 탭은 쉬고 다시 보이면 즉시 1회. 실패는 마지막 데이터 유지 + 표시.
 *  projectId 가 있으면 프로젝트 스튜디오(/p/[id]/agents/office): 재조회를 그 층으로 좁히고 전체 스튜디오 링크를 보인다.
 *  없으면 전체 좌석표(/w/[slug]/agents) — workspaceId 가 재조회 범위다(없으면 액션이 권한 없음으로 거절한다 — 넓히지 않는다).
 *  보기는 셋이다 — 에이전트(기본)·평면도(지켜보는 화면)·상태 레인(처리하는 화면). 결재는 평면도·상태 레인의 좌석에 붙는다. */
export function SeatmapView({ initial, pollMs = 30_000, projectId, projectName, workspaceId = null, timeZone }: {
  initial: Seatmap; pollMs?: number; projectId?: string; projectName?: string; workspaceId?: string | null
  /** 시각·사무실 대사(계절·점심)의 시간대 — 프로젝트 스튜디오는 프로젝트, 전역은 세션 유일 워크스페이스(viewTimezone) */
  timeZone: string
}) {
  const { t } = useLocale()
  const [map, setMap] = useState(initial)
  const [error, setError] = useState<{ at: string; message: string } | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.fetchedAt))
  const [scope, setScope] = useState<SeatmapScope>(initial.scope)
  // 기본은 에이전트 보기다(2026-09-19). 서버 렌더와 어긋나지 않도록 localStorage 는 마운트 뒤에 읽는다.
  const [view, setView] = useState<OfficeView>('agent')
  const [withDone, setWithDone] = useState(false)
  const [chatter, setChatter] = useState(true)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [note, setNote] = useState<NoteDraft | null>(null)
  const [opError, setOpError] = useState<string | null>(null)
  const scopeRef = useRef(scope)
  const inflight = useRef(false)
  // 사유를 쓰는 동안 폴링이 그 좌석을 목록에서 지우면 쓰던 글이 조용히 사라진다 — 초안이 열려 있으면 자동 갱신을 쉰다.
  const noteRef = useRef<NoteDraft | null>(null)
  useEffect(() => { noteRef.current = note }, [note])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY)
      if (saved === 'lane' || saved === 'floor' || saved === 'agent') setView(saved)
      if (window.localStorage.getItem(DONE_KEY) === '1') setWithDone(true)
      if (window.localStorage.getItem(CHATTER_KEY) === '0') setChatter(false)
    } catch { /* 값이 없거나 접근이 막혀도 기본 보기로 그린다 */ }
  }, [])
  const pickView = useCallback((next: OfficeView) => {
    setView(next)
    try { window.localStorage.setItem(VIEW_KEY, next) } catch { /* 기억하지 못해도 화면은 돈다 */ }
  }, [])
  // 층 순서가 폴링마다 바뀌어도 구독을 다시 맺지 않도록 문자열 키로 고정한다.
  const channelKey = seatmapChannelProjectIds(map, projectId).join(',')
  const channelIds = useMemo(() => (channelKey ? channelKey.split(',') : []), [channelKey])
  /** 층별 doneCount 의 합 — 토글 라벨과 안내 문구가 같은 수를 쓴다. */
  const doneTotal = map.floors.reduce((n, f) => n + f.doneCount, 0)
  const toggleDone = useCallback(() => {
    setWithDone(prev => {
      const next = !prev
      try { window.localStorage.setItem(DONE_KEY, next ? '1' : '0') } catch { /* 기억하지 못해도 화면은 돈다 */ }
      return next
    })
  }, [])

  const toggleChatter = useCallback(() => {
    setChatter(prev => {
      const next = !prev
      try { window.localStorage.setItem(CHATTER_KEY, next ? '1' : '0') } catch { /* 기억하지 못해도 화면은 돈다 */ }
      return next
    })
  }, [])

  /** force = 사람이 부른 갱신(범위 전환·결재 직후). 자동 폴링만 양보한다 — 결재 뒤 갱신이 폴링과
   *  겹쳤다고 건너뛰면 처리는 됐는데 화면이 최대 30초 옛 상태로 남아 사용자가 다시 누르게 된다. */
  const refresh = useCallback(async (want?: SeatmapScope, force = false) => {
    if (want) { scopeRef.current = want; setScope(want) }
    if (!force && noteRef.current !== null) return
    if (inflight.current) {
      if (!force) return
      // 사람이 부른 갱신은 앞선 폴링이 끝나기를 기다렸다가 다시 읽는다.
      for (let i = 0; i < 40 && inflight.current; i++) await new Promise(r => setTimeout(r, 100))
      if (inflight.current) return
    }
    inflight.current = true
    try {
      const r = projectId === undefined ? await refreshSeatmap(scopeRef.current, undefined, workspaceId ?? undefined) : await refreshSeatmap(scopeRef.current, projectId)
      if (r.ok) { setMap(r.seatmap); setNowMs(Date.parse(r.seatmap.fetchedAt)); setError(null) }
      else setError({ at: new Date().toISOString(), message: r.error })
    } catch (e) {
      setError({ at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) })
    } finally { inflight.current = false }
  }, [projectId, workspaceId])

  /** 결재 실행 — 실패는 삼키지 않고 상세 패널에 그대로 띄운다(에러 3원칙). 성공하면 좌석표를 다시 읽는다. */
  const runOp = useCallback(async (seat: Seat, kind: SeatOpKind, text: string) => {
    setBusyOrderId(seat.orderId)
    setOpError(null)
    // 승인·반려는 좌석이 본 최신 완료 보고를 싣는다 — 그 사이 재보고됐으면 서버가 stale 로 거부한다(H1 Task 11).
    const op: HubProcessOp = kind === 'approve' ? { kind, orderId: seat.orderId, expectedReportId: seat.reportId }
      : kind === 'reject' ? { kind, orderId: seat.orderId, note: text, expectedReportId: seat.reportId }
      : kind === 'rework' ? { kind, orderId: seat.orderId, note: text }
      : { kind, orderId: seat.orderId }
    try {
      const r = await runHubProcessOp(seat.projectId, op)
      // 실패는 상세 패널에만 자리가 있다 — 좌석에서 바로 누른 op 였다면 그 좌석을 열어 보여 준다.
      // stale 이면 좌석표를 다시 읽어 새 보고를 보여 준다(쓰던 사유는 그대로 둔다).
      if (!r.ok) {
        setOpError(r.error); setSelected(seat.orderId)
        if (r.stale) await refresh(undefined, true)
        return
      }
      setNote(null)
      // 처리는 허브를 돌려주지만 스튜디오가 쥔 것은 좌석표다 — 한 번 더 읽어야 화면이 맞는다.
      if (r.hubError) { setOpError(r.hubError); setSelected(seat.orderId) }
      await refresh(undefined, true)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e))
      setSelected(seat.orderId)
    } finally { setBusyOrderId(null) }
  }, [refresh])

  /**
   * 좌석·패널에서 op 버튼을 누른 순간 — 사유가 필요한 op 는 곧바로 보내지 않고 입력을 연다.
   * 되돌리기 어려운 op(중단)도 같은 자리에 확인 상자를 열어 한 번 더 묻는다(브라우저 confirm() 금지).
   * 그 밖의 op(승인·승인 취소·이어서 시작)는 상세를 열지 않는다 — 결재하려고 누른 것이지
   * 상세를 보려고 누른 것이 아니다. 실패했을 때만 runOp 가 그 좌석을 열어 사유를 보여 준다.
   */
  const onOp = useCallback((seat: Seat, kind: SeatOpKind) => {
    setOpError(null)
    if (opSpec(kind).needsNote || opSpec(kind).needsConfirm) {
      setSelected(seat.orderId) // 사유 입력이 상세 패널 안에 있다
      setNote(prev => (prev && prev.orderId === seat.orderId && prev.kind === kind)
        ? prev // 같은 op 를 다시 눌러도 쓰던 글을 지우지 않는다
        : { orderId: seat.orderId, kind, text: '' })
      return
    }
    setNote(null)
    void runOp(seat, kind, '')
  }, [runOp])

  useEffect(() => {
    let timer: number | null = null
    const start = () => { if (timer === null) timer = window.setInterval(() => { void refresh() }, pollMs) }
    const stop = () => { if (timer !== null) { window.clearInterval(timer); timer = null } }
    const onVis = () => { if (document.visibilityState === 'hidden') stop(); else { void refresh(); start() } }
    document.addEventListener('visibilitychange', onVis)
    if (document.visibilityState !== 'hidden') start()
    return () => { stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [refresh, pollMs])

  // 경과 시간 표시만 1초마다 — 데이터는 건드리지 않는다.
  useEffect(() => {
    const tick = window.setInterval(() => setNowMs(n => n + 1000), 1000)
    return () => window.clearInterval(tick)
  }, [])

  const sel = useMemo(() => findSeat(map, selected), [map, selected])
  const popRef = useRef<HTMLDivElement>(null)
  const closeDetail = useCallback(() => { setSelected(null); setNote(null); setOpError(null) }, [])
  // Escape 로 닫고, 열릴 때 카드로 포커스를 옮긴다. 뒤 화면은 가리지 않으므로 스크롤은 막지 않는다.
  useEffect(() => {
    if (sel === null) return
    popRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDetail() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sel === null, closeDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  // 에이전트 보기 재료 — 훅이라 보기와 무관하게 늘 부른다(좌석표가 바뀔 때만 다시 묶는다).
  const roster = useRoster(map)
  const range = useScope()   // 화면 안 링크의 범위(D38 ①) — 없으면 옛 형식(스텁이 해석, D5)
  const tools = (
    <>
      {projectId !== undefined && <Link href={range?.workspace ? wsHref(range.workspace.slug, 'agents') : '/agents'} data-office-all-link className={css.allLink}>{t('agents.nav.all')}</Link>}
      <div className={css.viewSeg} role="group" aria-label={t('agents.view.aria')}>
        <button type="button" data-view="agent" aria-pressed={view === 'agent'} onClick={() => pickView('agent')}><IconAgentView />{t('agents.view.agent')}</button>
        <button type="button" data-view="floor" aria-pressed={view === 'floor'} onClick={() => pickView('floor')}><IconFloorView />{t('agents.view.floor')}</button>
        <button type="button" data-view="lane" aria-pressed={view === 'lane'} onClick={() => pickView('lane')}><IconLaneView />{t('agents.view.lane')}</button>
      </div>
      {/* 완료 포함은 평면도에서만 뜻이 있다 — 상태 레인은 "빈자리 · 완료" 레인이 늘 안고 있고, 에이전트 보기는 좌석이 아니다.
          보기 전환은 조작 줄 왼쪽에 고정돼(.toolsLight) 이 버튼이 빠져도 밀리지 않는다. */}
      {view === 'floor' && (
        <button type="button" className={css.doneToggle} data-done-toggle aria-pressed={withDone}
          title={t('agents.done.toggleTitle')}
          onClick={toggleDone}>
          <IconApprove />{t('agents.done.toggle')}{doneTotal > 0 ? ` ${doneTotal}` : ''}
        </button>
      )}
      {/* 잡담은 세 보기 모두에 말풍선이 있어 늘 보인다. 꺼도 팀원 보고·단계 말풍선(업무)은 남는다. */}
      <button type="button" className={css.doneToggle} data-chatter-toggle aria-pressed={chatter}
        title={chatter
          ? t('agents.chatter.onTitle')
          : t('agents.chatter.offTitle')}
        onClick={toggleChatter}>
        <IconChat />{chatter ? t('agents.chatter.on') : t('agents.chatter.off')}
      </button>
      <div className={css.scope} role="group" aria-label={t('agents.scope.aria')}>
        <button type="button" aria-pressed={scope === 'mine'} onClick={() => { void refresh('mine', true) }}>{t('agents.scope.mine')}</button>
        <button type="button" aria-pressed={scope === 'all'} onClick={() => { void refresh('all', true) }}>{t('agents.scope.all')}</button>
      </div>
      <div className={`${css.stamp} ${error ? css.stampBad : ''}`}>
        {error ? <span data-error="">{fill(t('agents.stamp.fail'), { time: hhmmss(error.at, timeZone), message: error.message })}</span> : <span>{fill(t('agents.stamp.ok'), { time: hhmmss(map.fetchedAt, timeZone) })}{projectId ? '' : ` (${timeZone})`}</span>}
      </div>
    </>
  )
  const body = (
    <>
      <AttentionBand items={map.attention} onSelect={setSelected} />
      <main className={css.stage}>
        {view === 'agent' ? <RosterBoard roster={roster} nowMs={nowMs} timeZone={timeZone} /> : (
        <section className={css.floors} data-view={view} aria-label={view === 'floor' ? t('agents.floors.aria') : t('agents.lanes.aria')}>
          {map.floors.length === 0 && (projectId !== undefined
            ? (map.scope === 'mine'
              ? <p className={css.doneNote}>{t('agents.empty.projectMine')}</p>
              : <p className={css.doneNote}>{t('agents.empty.projectAll')}</p>)
            : map.scope === 'mine'
              ? <p className={css.doneNote}>{t('agents.empty.allMine')}</p>
              : <p className={css.doneNote}>{t('agents.empty.allAll')}</p>)}
          {view === 'floor'
            ? map.floors.map(f => (
              <FloorCard key={f.id} floor={f} selectedId={selected} nowMs={nowMs} busyOrderId={busyOrderId} withDone={withDone} onSelect={setSelected} onOp={onOp} />
            ))
            : map.floors.length > 0 && (
              <LaneBoard map={map} selectedId={selected} nowMs={nowMs} busyOrderId={busyOrderId}
                showFloorName={projectId === undefined} onSelect={setSelected} onOp={onOp} />
            )}
          {view === 'floor' && !withDone && doneTotal > 0 && (
            <p className={css.doneNote}>
              {fill(t('agents.doneNote.before'), { n: doneTotal })}{' '}
              <button type="button" className={css.zoneFold} data-goto-done onClick={toggleDone}>{t('agents.doneNote.withDone')}</button>
              {t('agents.doneNote.or')}
              <button type="button" className={css.zoneFold} data-goto-lane onClick={() => pickView('lane')}>{t('agents.doneNote.lane')}</button>
              {t('agents.doneNote.after')}
            </p>
          )}
        </section>
        )}
      </main>
      {/* 상세와 결재는 떠 있는 카드로 — 뒤 화면을 가리지 않는다(어두운 백드롭 없음). 좌석 무대가
          그대로 보이는 채로 고른 좌석의 상세만 위로 올라온다. 카드 디자인은 옛 오른쪽 패널 그대로다.
          닫으면 선택과 쓰던 사유를 함께 비운다 — 초안만 남으면 폴링이 계속 쉰다. */}
      {sel !== null && (
        <div className={css.popWrap} role="dialog" aria-label={fill(t('agents.detail.aria'), { code: sel.seat.code })}>
          <button type="button" className={css.popScrim} tabIndex={-1} aria-hidden="true" onClick={closeDetail} />
          <div className={css.pop} ref={popRef} tabIndex={-1}>
            <DetailPanel
              seat={sel.seat} floorName={sel.floorName} zoneLabel={sel.zoneLabel} nowMs={nowMs}
              busy={busyOrderId === sel.seat.orderId}
              note={note} opError={opError} onOp={onOp} onClose={closeDetail}
              onNoteChange={text => setNote(prev => (prev ? { ...prev, text } : prev))}
              onNoteConfirm={() => { if (note) void runOp(sel.seat, note.kind, note.text) }}
              onNoteCancel={() => { setNote(null); setOpError(null) }}
            />
          </div>
        </div>
      )}
      {/* 범례는 좌석 색 설명이라 평면도·상태 레인에서만 — 에이전트 보기는 책상마다 상태 이름을 적는다. */}
      {view !== 'agent' && <footer className={css.legend}>
        <ul>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />{t('agents.legend.active')}</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)', borderColor: 'var(--sm-warn)' }} />{t('agents.legend.stale')}</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-empty)', borderColor: 'var(--sm-warn)' }} />{t('agents.legend.offline')}</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-active)' }} />{t('agents.state.blocked')}</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-wait)' }} />{t('agents.state.wait')}</li>
          <li><i className={css.sw} style={{ background: 'var(--sm-reject)' }} />{t('agents.state.rejected')}</li>
          <li><i className={css.sw} style={{ borderStyle: 'dashed' }} />{t('agents.state.ready')}</li>
        </ul>
        <p>{t('agents.legend.help')}</p>
      </footer>}
    </>
  )
  const realtime = <SeatmapRealtime projectIds={channelIds} run={() => { void refresh() }} />

  // 두 스튜디오 모두 에이전트 화면의 공통 헤더(AgentFrame)를 쓰고, 이 화면에만 있는 조작부는 헤더 아래 줄로 뺀다.
  // 프로젝트 스튜디오는 헤더에 위임·승인|에이전트 스튜디오 탭을, 전체 스튜디오(/agents)는 층(프로젝트) 칩을 단다(2026-09-18).
  const c = map.counters
  const officeTiles: HeroTile[] = [
    { key: 'active', label: t('agents.state.active'), value: c.active, color: '#5DB1E5' },
    { key: 'idle', label: t('agents.state.wait'), value: c.idle, color: '#F0B068' },
    { key: 'offline', label: t('agents.tile.offline'), value: c.offline, color: '#6b7580', valueColor: '#b7bfba' },
    // 감시 중은 좌석이 아니라 감시자 수 — 다른 축이라 막대에서 뺀다.
    { key: 'standby', label: t('agents.tile.standby'), value: c.standby, color: '#3F8F58', valueColor: '#7fd29a', bar: false },
  ]
  const attention = map.attention.length > 0 && <> <em>{fill(t('agents.lede.attention'), { n: map.attention.length })}</em></>
  const officeLede = projectId !== undefined
    ? <>{t('agents.lede.before')}<b>{fill(t('agents.lede.count'), { n: c.active })}</b>{t('agents.lede.afterFloor')}{attention}</>
    : <>{t('agents.lede.before')}<b>{fill(t('agents.lede.count'), { n: c.active })}</b>{t('agents.lede.mid')}<b>{fill(t('agents.lede.floors'), { n: map.floors.length })}</b>{t('agents.lede.afterAll')}{attention}</>
  // 에이전트 보기는 헤더도 자리 기준 숫자로 바꾼다(작업 PC · 결정 대기 · 무응답 · 끊김 · 빈자리).
  const hero = view === 'agent' ? rosterHero(roster, t) : { tiles: officeTiles, lede: officeLede }
  const floorsNav = map.floors.map(f => ({ id: f.id, name: f.name }))
  return (
    <AgentFrame
      {...(projectId !== undefined ? { projectId } : { nav: tone => <OfficeNav floors={floorsNav} tone={tone} /> })}
      projectName={projectName ?? t('agents.frame.allProjects')} title={projectId !== undefined ? t('agents.title.office') : t('agents.title.officeAll')}
      lede={hero.lede} tiles={hero.tiles}
      tools={<div className={css.toolsLight}>{tools}</div>}>
      <div className={css.root}>
        {realtime}
        <OfficeChatterContext.Provider value={chatter}>{body}</OfficeChatterContext.Provider>
      </div>
    </AgentFrame>
  )
}
