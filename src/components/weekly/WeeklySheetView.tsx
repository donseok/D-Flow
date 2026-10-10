'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, Sparkles } from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import {
  areaGroupOf, mergeRefreshedRows, mergeServerRow, orderAreas, rowLabel, WEEKLY_CELL_KEYS, WEEKLY_CELL_MAX,
  WEEKLY_CELL_LABEL, CELL_FIELD,
  type WeeklyArea, type WeeklySheetRow, type WeeklyCellKey, type WeeklyCellEdit,
} from '@/lib/domain/weeklySheet'
import { type CellAddr } from '@/lib/domain/sheetSelection'
import { dropUndoCells, emptyUndo, pushUndo, undo as undoOp, redo as redoOp, type UndoState } from '@/lib/domain/sheetUndo'
import {
  createWeeklyReport, prepareWeeklyCellRewrite, saveWeeklyCell, saveWeeklyCells, saveWeeklyTitle,
  type WeeklyActionResult, type WeeklyBatchResult, type WeeklyRewriteInput,
} from '@/app/actions/weekly'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useToast } from '@/components/ui/Toast'
import { buildPresenceMap, onlinePeers } from '@/lib/domain/sheetPresence'
import { PresenceStrip } from '@/components/app/PresenceStrip'
import { useSheetGrid } from './useSheetGrid'
import { WeeklyLintPanel } from './WeeklyLintPanel'
import { WeeklyAiRewriteModal, type WeeklyAiRewriteItem } from './WeeklyAiRewriteModal'
import { CarryMappingModal, mergeCarrySources } from './CarryMappingModal'
import type { CarryMapping, CarryOverflow, CarryPending } from '@/lib/domain/weeklyCarry'
import { usePresence } from './usePresence'
import { SheetCell, type BatchChip, type CellStatus } from './SheetCell'
import { ConflictResolver } from '@/components/ui/ConflictResolver'
import { editSessionStore, type EditStatus } from '@/lib/sync/editSession'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'
import {
  buildWeeklyRewriteSelection, prepareApplicableWeeklyRewriteEdits, type WeeklyRewriteTarget,
} from '@/lib/domain/weeklyRewrite'
import type { CustomValues } from '@/lib/domain/customFields'
import { formatCustomValue, orderedFields } from '@/lib/domain/customFields'
import { parseCustomValues } from '@/lib/domain/customFieldValues'
import { CustomFieldValuesEditor, useCustomFieldScope } from '@/components/fields/CustomFieldValuesEditor'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

/** 헤더 동기화 표시(§5.8.3)로 올리는 셀 상태 — error 는 실패, 응답을 잃은 저장은 outcome_unknown */
const SESSION_STATUS: Record<CellStatus, EditStatus> = { editing: 'editing', saving: 'saving', saved: 'saved', error: 'failed', conflict: 'conflict' }
const DEBOUNCE_MS = 1500
const CELL_MAX = WEEKLY_CELL_MAX // 셀 1개 상한(도메인 단일 출처) — 배치 로컬 클램프용
const BATCH_MAX = 500    // 한 배치 최대 edit 수(BE와 동일) — 사전 검사용

const COLS: { key: WeeklyCellKey; label: string }[] =
  WEEKLY_CELL_KEYS.map(key => ({ key, label: WEEKLY_CELL_LABEL[key] }))

/** DB 행 payload(snake) → WeeklySheetRow. Realtime payload 매핑용(영역 id — 스펙 §4.1.7). */
function fromRecord(r: Record<string, unknown>): WeeklySheetRow {
  return {
    id: String(r.id), reportId: String(r.report_id), areaId: String(r.area_id ?? ''),
    thisContent: String(r.this_content ?? ''), thisIssue: String(r.this_issue ?? ''),
    nextContent: String(r.next_content ?? ''), nextIssue: String(r.next_issue ?? ''),
    custom: (r.custom as CustomValues | null) ?? null,
  }
}

export function WeeklySheetView({
  projectId, weekStart, prevWeek, nextWeek, weekLabel, weekTitle, thisRange, nextRange, projectName,
  report, areas, initialRows, hasCarrySource, me, canEditCells, canCreateRound,
}: {
  projectId: string
  weekStart: string
  /** 이전·다음 주 키 — 서버가 프로젝트 규칙의 키 함수로 계산한다(과도기 주 6·8일, D35). 클라이언트는 ±7일로 다시 계산하지 않는다 */
  prevWeek: string
  nextWeek: string
  weekLabel: string
  weekTitle: string   // '7월 2주차' — 시트 제목 행용
  thisRange: string   // '7/6~7/10' — 금주실적 헤더
  nextRange: string   // '7/13~7/17' — 차주계획 헤더
  projectName: string
  report: { id: string; title: string } | null
  /** 프로젝트의 주간 영역(비활성 포함) — 행 라벨·실시간 병합의 순서·빈 시트 설명이 쓴다. */
  areas: WeeklyArea[]
  /** 페이지가 visibleRows 로 정한 표시 집합과 순서(D32). */
  initialRows: WeeklySheetRow[]
  hasCarrySource: boolean
  me: { id: string; name: string } | null // 프레즌스 신원 — 서버(getSession)에서 전달
  /** 셀·제목 편집 자격 = isProjectMember. saveWeeklyCell(s)·saveWeeklyTitle 의 requireProjectMember 미러. */
  canEditCells: boolean
  /** 주차 문서(회차) 생성 자격 = isProjectAdmin. createWeeklyReport 의 requireProjectAdmin 미러. */
  canCreateRound: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [rows, setRows] = useState<WeeklySheetRow[]>(initialRows)
  const fieldScope = useCustomFieldScope()
  const customDefs = useMemo(() => fieldScope?.defs ?? [], [fieldScope?.defs])
  const customListDefs = useMemo(
    () => orderedFields(customDefs).filter(d => d.active && d.show_in_list),
    [customDefs],
  )
  const customFormat = useMemo(() => ({
    yes: t('weekly.custom.yes'),
    no: t('weekly.custom.no'),
    empty: '—',
  }), [t])
  const [selectedCustomRowId, setSelectedCustomRowId] = useState<string | null>(null)
  const selectedCustomRow = useMemo(
    () => (selectedCustomRowId ? rows.find(r => r.id === selectedCustomRowId) ?? null : null),
    [rows, selectedCustomRowId],
  )
  const [lintOpen, setLintOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiItems, setAiItems] = useState<WeeklyAiRewriteItem[]>([])
  const [hasFocusedCell, setHasFocusedCell] = useState(false)
  const aiTargetsRef = useRef<WeeklyRewriteTarget[]>([])
  const aiRequestRef = useRef(0)
  const [status, setStatus] = useState<Record<string, CellStatus>>({}) // key = `${rowId}:${cellKey}`
  const dirtyRef = useRef<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const retriedRef = useRef<Set<string>>(new Set())
  // ── 값 CAS(SPU1, 개정 §5.8 — 무통보 덮어쓰기 0건) ──
  // baseRef: 칸이 dirty 가 될 때의 값 = 내가 마지막으로 확인한 서버 값. 저장은 이것을 기대값으로 보낸다(다르면 서버가 쓰지 않는다).
  // conflictRef: 충돌한 칸의 서버 현재 값(비교 대기). 정하기 전에는 그 칸을 다시 보내지 않는다 — 입력은 dirty 로 남는다.
  // sentRef: 그 칸에 내가 보낸 값들(확인돼 깨끗해질 때까지). '충돌'로 돌아온 서버 값이 이 가운데 하나면 남의 변경이 아니라 내 앞선 저장이다
  //   — 응답을 잃은 저장(Q10)이나 겹쳐 나간 단건·배치가 먼저 반영된 것이라 비교 없이 그 위에서 이어 쓴다.
  // unknownRef: 응답을 잃은 칸(헤더에 '확인 필요'로 올린다). cellFlightRef: 단건 저장이 가는 중인 칸 — 겹쳐 보내지 않는다(응답 처리가 이어 보낸다).
  const baseRef = useRef<Map<string, string>>(new Map())
  const conflictRef = useRef<Map<string, string>>(new Map())
  const sentRef = useRef<Map<string, Set<string>>>(new Map())
  const unknownRef = useRef<Set<string>>(new Set())
  const cellFlightRef = useRef<Set<string>>(new Set())
  const [conflictQueue, setConflictQueue] = useState<string[]>([])   // 비교 상자에 띄울 칸(앞이 지금 보이는 것)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const areasRef = useRef(areas)
  areasRef.current = areas
  // 점검 묶음 — 키 = 영역 id, 라벨 = 행 라벨(D22). 영역이 바뀔 때만 새로 만든다(점검 패널의 재계산 키).
  const lintGroupOf = useMemo(() => areaGroupOf(areas), [areas])
  const [isPending, startTransition] = useTransition()
  // 이월 매핑 라운드(스펙 §5.1) — 주차에 묶는다: 창이 열린 채 다른 주차로 옮기면(뒤로 가기 포함) 그 창을 그리지 않는다.
  const [carry, setCarry] = useState<{
    weekStart: string; round: number; sources: CarryPending[]; overflow: CarryOverflow[]; mapping: CarryMapping
  } | null>(null)
  const reportId = report?.id ?? null
  useBotPageContext({
    domain: 'weekly',
    projectId,
    selectedEntity: reportId ? { type: 'weekly_report', id: reportId } : null,
    weekStart,
  })

  // ── 멀티셀 편집 레이어 상태 ──
  const cellRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map())  // `${rowId}:${col}` → 활성 포커스 관리(Design B)
  const undoRef = useRef<UndoState>(emptyUndo)                          // 셀 값 undo/redo(D3 — 구조 변경 제외)
  const editSessionRef = useRef<{ key: string; baseline: string; wasDirty: boolean } | null>(null) // 편집 세션 원값 스냅샷
  const batchInFlightRef = useRef(0)                                    // 진행 중 배치 수(0이면 칩 정리)
  const batchShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null) // 진행 칩 300ms delayed-show
  const lastFailedBatchRef = useRef<WeeklyCellEdit[] | null>(null)      // 칩 '재시도'용 마지막 실패 배치
  const [batchChip, setBatchChip] = useState<BatchChip | null>(null)   // 활성 셀 집계 칩(§5)
  const [batchActive, setBatchActive] = useState(false)                // true면 per-cell 배지 억제

  const registerCell = useCallback((key: string, el: HTMLTextAreaElement | null) => {
    if (el) cellRefs.current.set(key, el)
    else cellRefs.current.delete(key)
  }, [])

  // 삭제된 행의 dirty 키·디바운스 타이머·저장 상태 정리 — 잔류하면 flushPendingSaves가
  // 영영 비지 않아 주간보고 PPT 내보내기가 세션 내내 차단된다(리뷰 확정 결함).
  const cleanupRowKeys = useCallback((rowId: string) => {
    for (const key of WEEKLY_CELL_KEYS) {
      const k = `${rowId}:${key}`
      dirtyRef.current.delete(k)
      retriedRef.current.delete(k)
      baseRef.current.delete(k)
      conflictRef.current.delete(k)
      sentRef.current.delete(k)
      unknownRef.current.delete(k)
      const t = timersRef.current.get(k)
      if (t) { clearTimeout(t); timersRef.current.delete(k) }
    }
    setConflictQueue(q => (q.some(k => k.startsWith(`${rowId}:`)) ? q.filter(k => !k.startsWith(`${rowId}:`)) : q))
    setStatus(s => {
      if (!WEEKLY_CELL_KEYS.some(key => `${rowId}:${key}` in s)) return s
      const next = { ...s }
      for (const key of WEEKLY_CELL_KEYS) delete next[`${rowId}:${key}`]
      return next
    })
  }, [])

  // 서버 refetch(라우터 refresh) 반영 — dirty 셀은 로컬 유지(스펙 §5). 같은 문서 안에서는 지금 보이는 행을 빼지 않는다(D32 —
  // 다시 거른 집합에서 빠진 행은 그새 마지막 칸이 빈 비활성 영역 행이다. 행 삭제는 실시간 DELETE 가 맡는다).
  // 문서가 바뀌면(주차 이동·문서 생성) 받은 집합으로 바꾸고 옛 행의 dirty·타이머·상태를 정리한다.
  const rowsReportRef = useRef(reportId)
  useEffect(() => {
    const sameReport = rowsReportRef.current === reportId
    rowsReportRef.current = reportId
    if (!sameReport) {
      const serverIds = new Set(initialRows.map(r => r.id))
      for (const l of rowsRef.current) if (!serverIds.has(l.id)) cleanupRowKeys(l.id)
    }
    setRows(local => mergeRefreshedRows(sameReport ? local : [], initialRows, areasRef.current, dirtyRef.current))
  }, [initialRows, reportId, cleanupRowKeys])

  // 주차/프로젝트 전환(reportId 변경) 시 편집 레이어 세션 초기화 — 컴포넌트가 key 없이 유지되므로
  // 잔존 시 주차 B에서 Ctrl+Z가 주차 A의 rowId를 서버로 되돌려 화면 밖 데이터를 파괴한다(F1, 블로킹).
  useEffect(() => {
    undoRef.current = emptyUndo
    lastFailedBatchRef.current = null
    editSessionRef.current = null
    aiRequestRef.current += 1
    aiTargetsRef.current = []
    setBatchChip(null)
    setBatchActive(false)
    setHasFocusedCell(false)
    setAiOpen(false)
    setAiBusy(false)
    setAiError(null)
    setAiItems([])
  }, [reportId])

  // Realtime 구독 — 행 단위 이벤트를 셀 단위 병합
  // 의존성은 reportId(원시값)만 사용한다. report는 서버 렌더마다 새 객체라
  // 그걸 deps에 넣으면 SUBSCRIBED → refresh → 새 report 참조 → effect 재실행 → …
  // 무한 재구독 루프에 빠진다.
  useEffect(() => {
    if (!reportId) return
    const sb = createBrowserClient()
    let subscribedOnce = false
    const channel = sb
      .channel(`weekly-rows-${reportId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'weekly_report_rows', filter: `report_id=eq.${reportId}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string }).id
            if (oldId) { cleanupRowKeys(oldId); setRows(rs => rs.filter(r => r.id !== oldId)) }
            return
          }
          const server = fromRecord(payload.new as Record<string, unknown>)
          // 표시 집합은 페이지를 읽을 때 정했다 — 다시 계산하지 않는다(D32). 모르는 영역의 행(D44)과 비활성으로 아는 영역의 빈 새 행
          // (그새 재활성 — RPC 는 활성 영역에만 행을 넣는다)은 그리지 않고 영역 목록을 다시 받는다. refresh 판정은 '없는 행'에만 걸리고
          // 병합이 그런 행을 더하는 일은 없으므로 렌더 시점의 rowsRef 로 충분하다.
          if (mergeServerRow(rowsRef.current, server, areasRef.current, dirtyRef.current).refresh) { router.refresh(); return }
          setRows(rs => mergeServerRow(rs, server, areasRef.current, dirtyRef.current).rows)
        })
      .subscribe(st => {
        if (st !== 'SUBSCRIBED') return
        // 최초 구독은 SSR props로 이미 최신 상태라 refetch 불필요.
        // 두 번째 이후(연결 끊김→재연결)에만 누락분을 보정한다(스펙 §5).
        if (!subscribedOnce) { subscribedOnce = true; return }
        router.refresh()
      })
    return () => { sb.removeChannel(channel) }
  }, [reportId, router, cleanupRowKeys])

  // 칸을 dirty 로 — 처음 dirty 가 되는 순간의 값(= 서버에서 받은 값)을 기대값으로 잡아 둔다. 낙관 적용보다 먼저 부른다.
  const markDirty = useCallback((k: string, current: string) => {
    if (!dirtyRef.current.has(k)) baseRef.current.set(k, current)
    dirtyRef.current.add(k)
  }, [])
  // 충돌 — 쓰지 않았다. 입력은 dirty 로 둔 채(실시간 값이 덮지 않는다) 비교 상자를 띄우고, 그 칸의 되돌리기 이력을 버린다(§5.8.6)
  const raiseConflict = useCallback((k: string, latest: string) => {
    conflictRef.current.set(k, latest)
    unknownRef.current.delete(k)
    retriedRef.current.delete(k)
    undoRef.current = dropUndoCells(undoRef.current, new Set([k]))
    setStatus(s => ({ ...s, [k]: 'conflict' }))
    setConflictQueue(q => (q.includes(k) ? q : [...q, k]))
  }, [])
  const noteSent = useCallback((k: string, value: string) => {
    const set = sentRef.current.get(k)
    if (set) set.add(value)
    else sentRef.current.set(k, new Set([value]))
  }, [])
  /** 충돌 응답을 가린다 — 서버 값이 이미 내 값이면 반영된 것, 내가 앞서 보낸 값이면 그 위에서 이어 쓴다, 아니면 진짜 충돌 */
  const settleConflict = useCallback((k: string, latest: string, sent: string): 'applied' | 'rebased' | 'conflict' => {
    if (latest === sent) { unknownRef.current.delete(k); return 'applied' }
    if (sentRef.current.get(k)?.has(latest)) { unknownRef.current.delete(k); baseRef.current.set(k, latest); return 'rebased' }
    raiseConflict(k, latest)
    return 'conflict'
  }, [raiseConflict])

  const commit = useCallback((rowId: string, key: WeeklyCellKey) => {
    if (!canEditCells) return // 조회 전용 — 서버도 거부하지만 저장 배지를 띄우고 실패하는 왕복을 만들지 않는다
    const k = `${rowId}:${key}`
    const timer = timersRef.current.get(k)
    if (timer) { clearTimeout(timer); timersRef.current.delete(k) }
    const row = rowsRef.current.find(r => r.id === rowId)
    if (!row) { cleanupRowKeys(rowId); return } // 삭제된 행 — dirty 잔류 시 PPT flush가 영구 차단됨
    if (!dirtyRef.current.has(k)) return
    if (conflictRef.current.has(k)) return // 비교에서 정하기 전에는 다시 보내지 않는다(입력은 남아 있다)
    // 그 칸의 단건 저장이 가는 중이면 겹쳐 보내지 않는다 — 같은 기대값의 두 저장은 뒤엣것이 앞엣것과 충돌한다. 응답 처리가 달라진 값을 이어 보낸다
    if (cellFlightRef.current.has(k)) return
    const sent = row[CELL_FIELD[key]]
    const expected = baseRef.current.get(k)
    cellFlightRef.current.add(k)
    noteSent(k, sent)
    setStatus(s => ({ ...s, [k]: 'saving' }))
    // .catch: 오프라인·전송 계층 예외를 ok:false로 흡수 → 아래 error/재시도 경로로 합류(미포착 시 dirty·상태 영구 잔류, F2).
    // 응답을 잃은 저장은 반영됐을 수도 있다 — 보낸 값을 적어 두고, 재시도(같은 기대값의 CAS)가 그 값을 만나면 반영으로 가린다(Q10).
    saveWeeklyCell(projectId, rowId, key, sent, expected)
      .catch((): WeeklyActionResult => { unknownRef.current.add(k); return { ok: false, error: t('weekly.sheet.networkError') } })
      .then(res => {
      cellFlightRef.current.delete(k)
      const now = rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]]
      const saved = () => {
        retriedRef.current.delete(k)
        unknownRef.current.delete(k)
        if (now === sent) { dirtyRef.current.delete(k); baseRef.current.delete(k); sentRef.current.delete(k); setStatus(s => ({ ...s, [k]: 'saved' })) }
        else { baseRef.current.set(k, sent); commit(rowId, key) } // 전송 중 재수정 — dirty 유지한 채 재저장(기대값은 방금 쓴 값)
      }
      if (!res.ok) {
        if (res.gone) { // 서버가 '행 삭제됨' 확정 — 재시도 대신 로컬 행·상태 정리
          cleanupRowKeys(rowId)
          setRows(rs => rs.filter(r => r.id !== rowId))
          return
        }
        if (res.conflict) {
          const how = settleConflict(k, res.latest ?? '', sent)
          if (how === 'applied') saved()
          else if (how === 'rebased') commit(rowId, key)
          return
        }
        setStatus(s => ({ ...s, [k]: 'error' }))
        if (!retriedRef.current.has(k)) {
          retriedRef.current.add(k)
          const prev = timersRef.current.get(k)
          if (prev) clearTimeout(prev)
          timersRef.current.set(k, setTimeout(() => commit(rowId, key), 2000)) // 자동 재시도 1회
        } else toast({ title: t('weekly.sheet.saveFailed'), description: res.error, variant: 'error' })
        return
      }
      saved()
    })
  }, [projectId, toast, cleanupRowKeys, canEditCells, settleConflict, noteSent, t])

  // PPT 내보내기 직전 미저장 셀 flush — export fetch와 blur commit이 경합하면 서버가
  // 저장 전 스냅샷으로 PPT를 만들 수 있다. 남은 dirty 키를 즉시 commit(디바운스 우회)하고
  // 전부 저장될 때까지 폴링. 5초를 넘기면 중단(false)하고 안내 — 불완전 PPT 방지가 목적.
  const flushPendingSaves = useCallback((): Promise<boolean> => {
    // 충돌한 칸은 정하기 전에 저장되지 않는다 — 기다려도 끝나지 않으니 바로 알린다
    if (conflictRef.current.size) {
      toast({ title: t('weekly.export.abortedTitle'), description: t('weekly.export.abortedConflict'), variant: 'error' })
      return Promise.resolve(false)
    }
    for (const k of dirtyRef.current) {
      const [rowId, key] = k.split(':') as [string, WeeklyCellKey]
      commit(rowId, key)
    }
    if (!dirtyRef.current.size) return Promise.resolve(true)
    return new Promise(resolve => {
      const start = Date.now()
      const poll = () => {
        if (!dirtyRef.current.size) { resolve(true); return }
        if (Date.now() - start >= 5000) {
          toast({ title: t('weekly.export.abortedTitle'), description: t('weekly.export.abortedSaving'), variant: 'error' })
          resolve(false)
          return
        }
        setTimeout(poll, 100)
      }
      poll()
    })
  }, [commit, toast, t])

  const onCellChange = (rowId: string, key: WeeklyCellKey, value: string) => {
    if (!canEditCells) return // 조회 전용 — 로컬 값도 바꾸지 않는다(저장되지 않은 편집이 남으면 화면이 거짓말을 한다)
    const k = `${rowId}:${key}`
    markDirty(k, rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]] ?? '')
    // 저장 전 초안 — 헤더가 '동기화됨'을 보이지 않게 한다(§5.8.3). 충돌 표시는 지우지 않는다
    setStatus(s => (s[k] === 'editing' || s[k] === 'conflict' ? s : { ...s, [k]: 'editing' }))
    setRows(rs => rs.map(r => (r.id === rowId ? { ...r, [CELL_FIELD[key]]: value } : r)))
    const prev = timersRef.current.get(k)
    if (prev) clearTimeout(prev)
    timersRef.current.set(k, setTimeout(() => commit(rowId, key), DEBOUNCE_MS))
  }

  // 회차 생성(스펙 §4.1.3·§5.1, D43). 이월이 비활성 영역의 대기 내용을 만나면 CARRY_PENDING — 매핑 창을 열고 같은 액션을 매핑과
  // 다시 부른다. 대기 영역은 라운드마다 모은다(mergeCarrySources) — 넘침만 돌아온 응답(대기 목록이 빔)에도 고칠 줄이 남아야 한다.
  // 다시 대기로 온 영역(그새 비활성 — Q37)은 고른 값을 지워 다시 고르게 하고, 영역 목록을 새로 받는다(router.refresh — 창의 선택지).
  // 그 밖의 실패는 결과의 고정 문구를 토스트로만 보인다(D45 — 원문은 서버 로그).
  const startReport = (carryOver: boolean, mapping?: CarryMapping) =>
    startTransition(async () => {
      const res = await createWeeklyReport(projectId, weekStart, carryOver, mapping)
      if (res.ok) { setCarry(null); router.refresh(); return }
      if ('pending' in res) {
        const again = new Set(res.pending.map(p => p.areaId))
        const kept: CarryMapping = Object.fromEntries(Object.entries(mapping ?? {}).filter(([areaId]) => !again.has(areaId)))
        setCarry(c => {
          const prev = c?.weekStart === weekStart ? c : null
          return {
            weekStart, round: (prev?.round ?? 0) + 1,
            sources: mergeCarrySources(prev?.sources ?? [], res.pending),
            overflow: res.overflow, mapping: kept,
          }
        })
        router.refresh()
        return
      }
      toast({ title: t('weekly.sheet.createFailed'), description: res.error, variant: 'error' })
    })

  // 재시도 직전 edits 재구성 — 여전히 dirty이고 행이 존재하는 키만 유지, content는 rowsRef 현재값으로 재스냅샷.
  // 그 사이 성공한 단건 저장을 stale 값으로 역전하지 않게(F4). 결과가 비면 되돌릴 것 없음 → 호출측이 성공 처리.
  const rebuildForRetry = useCallback((edits: WeeklyCellEdit[]): WeeklyCellEdit[] => {
    const out: WeeklyCellEdit[] = []
    for (const e of edits) {
      const k = `${e.rowId}:${e.cellKey}`
      if (!dirtyRef.current.has(k) || conflictRef.current.has(k)) continue
      const row = rowsRef.current.find(r => r.id === e.rowId)
      if (!row) continue
      out.push({ rowId: e.rowId, cellKey: e.cellKey, content: row[CELL_FIELD[e.cellKey]] })
    }
    return out
  }, [])

  // ── 배치 실행기(계약 §2 ①~⑥) — 붙여넣기/범위삭제/채우기/undo·redo가 공유. 단건 commit과 동일한
  //    dirty/status/timer/flush/Realtime 시맨틱 유지(회귀 #1·#2·#3의 핵심). ──
  const runBatch = useCallback((editsRaw: WeeklyCellEdit[], opts: { undoable: boolean }) => {
    if (!canEditCells) return // 조회 전용 — 붙여넣기·범위삭제·채우기·undo/redo 전부 진입 불가(그리드도 막지만 이중으로)
    if (editsRaw.length === 0) return
    if (editsRaw.length > BATCH_MAX) { // §6-E 사전 검사(로컬 클램프 전 원본 크기)
      toast({ title: t('weekly.sheet.pasteTooLargeTitle'), variant: 'error',
        description: t('weekly.sheet.pasteTooLargeDesc').replace('{n}', String(BATCH_MAX)) })
      return
    }
    let clamped = false // §6-D 로컬 CELL_MAX 클램프
    const edits = editsRaw.map(e => (e.content.length > CELL_MAX ? (clamped = true, { ...e, content: e.content.slice(0, CELL_MAX) }) : e))
    if (clamped) toast({ title: t('weekly.sheet.clampedTitle'), variant: 'info', description: t('weekly.sheet.clampedDesc') })

    // undo용 before 스냅샷(③ 낙관 적용 전 현재 값). 사라진 행은 스킵.
    const before: WeeklyCellEdit[] = []
    if (opts.undoable) {
      for (const e of edits) {
        const row = rowsRef.current.find(r => r.id === e.rowId)
        if (row) before.push({ rowId: e.rowId, cellKey: e.cellKey, content: row[CELL_FIELD[e.cellKey]] })
      }
    }
    // ① per-cell 디바운스/재시도 타이머 클리어(회귀 #1)
    for (const e of edits) {
      const k = `${e.rowId}:${e.cellKey}`
      const t = timersRef.current.get(k)
      if (t) { clearTimeout(t); timersRef.current.delete(k) }
      retriedRef.current.delete(k)
    }
    // ② dirty 마킹(반드시 ③ 낙관 적용보다 먼저 — 인바운드 Realtime 클로버링 방지, 회귀 #2)
    // 기대값: 보통은 처음 dirty 가 될 때의 값. undo·redo 의 역명령은 "지금 서버 값 = 내가 쓴 값"을 싣고 온다(§5.8.6) — 그것이 이긴다.
    // 사용자가 새 값을 넣는 배치는 그 칸의 미결 충돌 위에 쓰는 것이 아니다 — 충돌은 비교에서만 푼다(여기서는 그 칸을 보내지 않는다).
    for (const e of edits) {
      const k = `${e.rowId}:${e.cellKey}`
      if (e.expected !== undefined) { baseRef.current.set(k, e.expected); dirtyRef.current.add(k) }
      else markDirty(k, rowsRef.current.find(r => r.id === e.rowId)?.[CELL_FIELD[e.cellKey]] ?? '')
    }
    // ③ 로컬 rows 낙관 적용 + status 'saving'(textarea 자동 높이는 value 변화로 재계산, 회귀 #7)
    setRows(rs => rs.map(r => {
      const mine = edits.filter(e => e.rowId === r.id)
      if (mine.length === 0) return r
      const next = { ...r }
      for (const e of mine) next[CELL_FIELD[e.cellKey]] = e.content
      return next
    }))
    setStatus(s => { const n = { ...s }; for (const e of edits) { const k = `${e.rowId}:${e.cellKey}`; if (!conflictRef.current.has(k)) n[k] = 'saving' } return n })
    // ④ undo 스택 push(undoable만 — undo/redo 유발 배치는 생략, 계약 §2-④)
    if (opts.undoable && before.length) {
      const keys = new Set(before.map(b => `${b.rowId}:${b.cellKey}`))
      const after = edits.filter(e => keys.has(`${e.rowId}:${e.cellKey}`))
      undoRef.current = pushUndo(undoRef.current, { before, after })
    }
    // 배치 칩(§5): 진행 칩 300ms delayed-show, per-cell 배지 억제
    batchInFlightRef.current += 1
    setBatchActive(true)
    if (batchShowTimerRef.current) clearTimeout(batchShowTimerRef.current)
    batchShowTimerRef.current = setTimeout(() => {
      if (batchInFlightRef.current > 0) setBatchChip({ phase: 'saving', count: edits.length })
    }, 300)

    // ⑤ 서버 호출 + 전송 시점 값 스냅샷(sent). send는 재시도마다 edits/sent를 새로 받는다(F4).
    const settle = () => {
      batchInFlightRef.current = Math.max(0, batchInFlightRef.current - 1)
      if (batchInFlightRef.current === 0 && batchShowTimerRef.current) { clearTimeout(batchShowTimerRef.current); batchShowTimerRef.current = null }
    }
    const send = (rawEdits: WeeklyCellEdit[], attempt: number) => {
      // 미결 충돌 칸은 보내지 않는다. 기대값은 보내는 순간의 baseRef(재시도는 그 사이 확인된 값을 다시 읽는다)
      const sendEdits = rawEdits
        .filter(e => !conflictRef.current.has(`${e.rowId}:${e.cellKey}`))
        .map(e => ({ rowId: e.rowId, cellKey: e.cellKey, content: e.content, expected: baseRef.current.get(`${e.rowId}:${e.cellKey}`) }))
      if (sendEdits.length === 0) { settle(); setBatchChip(null); if (batchInFlightRef.current === 0) setBatchActive(false); return }
      const sent = new Map(sendEdits.map(e => [`${e.rowId}:${e.cellKey}`, e.content]))
      for (const [k, sv] of sent) noteSent(k, sv)
      // .catch: 오프라인·전송 계층 예외를 ok:false로 흡수 → 실패 경로(재시도·에러 칩)로 합류. 미포착 시
      // batchInFlightRef 미복귀·batchActive 영구 true·dirty 영구 잔류로 flush가 매번 타임아웃(F2).
      // 응답을 잃은 배치는 반영됐을 수도 있다 — 보낸 값을 적어 두고 재시도의 CAS 가 그 값을 만나면 반영으로 가린다(Q10).
      saveWeeklyCells(projectId, sendEdits)
        .catch((): WeeklyBatchResult => { for (const k of sent.keys()) unknownRef.current.add(k); return { ok: false, error: t('weekly.sheet.networkError') } })
        .then(res => {
          // ⑥ 응답 처리
          if (res.ok) {
            settle()
            lastFailedBatchRef.current = null
            const gone = new Set(res.goneRowIds ?? [])
            for (const g of gone) cleanupRowKeys(g)
            if (gone.size) setRows(rs => rs.filter(r => !gone.has(r.id)))
            // 기대값이 어긋나 쓰지 않은 칸 — 가려서(반영됨·내 앞선 저장 위·진짜 충돌) 잇는다. 나머지 칸은 저장됐다
            const unsaved = new Set<string>()
            for (const c of res.conflicts ?? []) {
              const k = `${c.rowId}:${c.cellKey}`
              const sv = sent.get(k)
              if (sv === undefined) continue
              const how = settleConflict(k, c.latest, sv)
              if (how === 'applied') continue
              unsaved.add(k)
              if (how === 'rebased') timersRef.current.set(k, setTimeout(() => commit(c.rowId, c.cellKey), 0))
            }
            for (const [k, sv] of sent) {
              const [rowId, key] = k.split(':') as [string, WeeklyCellKey]
              if (gone.has(rowId) || unsaved.has(k)) continue
              unknownRef.current.delete(k)
              const now = rowsRef.current.find(r => r.id === rowId)?.[CELL_FIELD[key]]
              if (now === sv) { dirtyRef.current.delete(k); baseRef.current.delete(k); sentRef.current.delete(k); setStatus(s => ({ ...s, [k]: 'saved' })) }
              else baseRef.current.set(k, sv)
              // 다르면(비행 중 재편집) dirty 유지 — per-cell 타이머가 마저 저장(단건 commit과 동형). 기대값은 방금 쓴 값
            }
            if (batchInFlightRef.current === 0) {
              setBatchChip({ phase: 'saved', count: sendEdits.length - unsaved.size }) // 저장됨 최소 800ms 유지 후 정리
              setTimeout(() => {
                setBatchChip(c => (c && c.phase === 'saved' ? null : c))
                if (batchInFlightRef.current === 0) setBatchActive(false)
              }, 800)
            }
          } else {
            setStatus(s => { const n = { ...s }; for (const k of sent.keys()) n[k] = 'error'; return n }) // dirty 유지
            if (attempt === 0) { // 자동 재시도 1회 — 그 사이 성공한 단건 저장을 stale 값으로 역전하지 않게 현재값 재스냅샷(F4)
              setTimeout(() => {
                const next = rebuildForRetry(sendEdits)
                if (next.length === 0) { settle(); setBatchChip(null); if (batchInFlightRef.current === 0) setBatchActive(false); return }
                send(next, 1)
              }, 2000)
              return
            }
            settle()
            lastFailedBatchRef.current = sendEdits
            setBatchChip({ phase: 'error', count: sendEdits.length })
            setBatchActive(false) // 억제 해제 — per-cell 재시도 배지 재개(칩은 활성 셀에 배치 재시도로 상주). batchActive 영구 true 방지.
            toast({ title: t('weekly.sheet.saveFailed'), variant: 'error', description: t('weekly.sheet.batchFailedDesc') })
          }
        })
    }
    send(edits, 0)
  }, [projectId, toast, cleanupRowKeys, rebuildForRetry, canEditCells, markDirty, settleConflict, commit, noteSent, t])

  const retryBatch = useCallback(() => {
    const failed = lastFailedBatchRef.current
    if (!failed) return
    lastFailedBatchRef.current = null
    setBatchChip(null)
    const next = rebuildForRetry(failed) // 현재값 재스냅샷 + 이미 저장된/사라진 셀 제외(F4)
    if (next.length === 0) { setBatchActive(false); return } // 되돌릴 것 없음 → 성공 처리
    runBatch(next, { undoable: false }) // 재시도는 새 undo 엔트리를 만들지 않음
  }, [runBatch, rebuildForRetry])

  // 되돌리기(§5.8.6, 결정 35) — 낙관 기록은 그대로 두되 서버가 확인한 배치만 되돌린다(칸이 아직 dirty 면 저장·충돌 대기 중이다).
  // 역명령은 "지금 서버 값 = 내가 쓴 값"을 기대값으로 싣는 CAS 다 — 그새 다른 사람이 바꿨으면 덮지 않고 충돌(비교)로 간다.
  const confirmed = useCallback((cells: WeeklyCellEdit[]): boolean => {
    if (!cells.some(e => dirtyRef.current.has(`${e.rowId}:${e.cellKey}`))) return true
    toast({ title: t('weekly.sheet.undoNotYetTitle'), description: t('weekly.sheet.undoNotYetDesc'), variant: 'info' })
    return false
  }, [toast, t])
  const inverse = (apply: WeeklyCellEdit[], written: WeeklyCellEdit[]): WeeklyCellEdit[] => {
    const mine = new Map(written.map(e => [`${e.rowId}:${e.cellKey}`, e.content]))
    return apply.map(e => ({ ...e, expected: mine.get(`${e.rowId}:${e.cellKey}`) }))
  }
  const requestUndo = useCallback((): boolean => {
    const top = undoRef.current.past.at(-1)
    if (!top || !confirmed(top.after)) return false
    const r = undoOp(undoRef.current)
    if (!r) return false
    undoRef.current = r.state
    runBatch(inverse(r.apply, top.after), { undoable: false })
    return true
  }, [runBatch, confirmed])
  const requestRedo = useCallback((): boolean => {
    const top = undoRef.current.future.at(-1)
    if (!top || !confirmed(top.before)) return false
    const r = redoOp(undoRef.current)
    if (!r) return false
    undoRef.current = r.state
    runBatch(inverse(r.apply, top.before), { undoable: false })
    return true
  }, [runBatch, confirmed])

  // 비교의 세 선택(§5.8.1 Conflict) — 내 값으로 저장(본 서버 값을 기대값으로 한 번) · 서버 값 받기(쓰지 않는다) · 계속 편집(입력 유지, 표시는 남는다)
  const conflictKey = conflictQueue[0] ?? null
  const dequeue = (k: string) => setConflictQueue(q => q.filter(x => x !== k))
  const keepMine = (k: string) => {
    const latest = conflictRef.current.get(k)
    if (latest === undefined) { dequeue(k); return }
    const [rowId, key] = k.split(':') as [string, WeeklyCellKey]
    conflictRef.current.delete(k)
    baseRef.current.set(k, latest)
    dequeue(k)
    commit(rowId, key)
  }
  const takeLatest = (k: string) => {
    const latest = conflictRef.current.get(k)
    const [rowId, key] = k.split(':') as [string, WeeklyCellKey]
    conflictRef.current.delete(k)
    dequeue(k)
    if (latest === undefined) return
    const t = timersRef.current.get(k); if (t) { clearTimeout(t); timersRef.current.delete(k) }
    dirtyRef.current.delete(k)
    baseRef.current.delete(k)
    sentRef.current.delete(k)
    setRows(rs => rs.map(r => (r.id === rowId ? { ...r, [CELL_FIELD[key]]: latest } : r)))
    setStatus(s => { if (!(k in s)) return s; const n = { ...s }; delete n[k]; return n })
    router.refresh() // dirty 인 동안 막아 둔 실시간 값이 더 있었을 수 있다 — 서버 값을 다시 받는다
  }
  const openCompare = (k: string) => { if (conflictRef.current.has(k)) setConflictQueue(q => [k, ...q.filter(x => x !== k)]) }

  // 셀 상태를 헤더 동기화 표시로 올린다(§5.8.3 — 미저장·저장 중·실패·충돌이 있으면 '동기화됨'이 아니다). 사라진 칸은 걷는다
  const syncedStatusRef = useRef<Record<string, CellStatus>>({})
  useEffect(() => {
    const prev = syncedStatusRef.current
    for (const [k, st] of Object.entries(status)) {
      if (prev[k] === st) continue
      const state: EditStatus = st === 'error' && unknownRef.current.has(k) ? 'outcome_unknown' : SESSION_STATUS[st]
      editSessionStore.setSession(`weekly:${k}`, 'weekly_cell', k, state)
    }
    for (const k of Object.keys(prev)) if (!(k in status)) editSessionStore.removeSession(`weekly:${k}`)
    syncedStatusRef.current = status
  }, [status])
  useEffect(() => () => {
    editSessionStore.removeWhere(x => x.surface === 'weekly_cell' && x.status !== 'saving' && x.status !== 'saved')
  }, [])

  // 편집 세션 진입 — baseline/wasDirty 스냅샷(Esc 복원·undo push 판정용). 덮어쓰기 초기화는 훅이 담당.
  const beginEdit = useCallback((addr: CellAddr) => {
    const k = `${addr.rowId}:${addr.col}`
    if (editSessionRef.current?.key === k) return // 같은 셀에 진행 중 세션 — baseline 재캡처 금지(R-1: IME 폴백 등 재진입 레이스 구조적 차단)
    const row = rowsRef.current.find(r => r.id === addr.rowId)
    editSessionRef.current = { key: k, baseline: row ? row[CELL_FIELD[addr.col]] : '', wasDirty: dirtyRef.current.has(k) }
  }, [])

  // 편집 세션 종료 — cancel=원값 복원(회귀 #12), commit=변경 시 undo 크기1 push(AC6.5) + 즉시 저장.
  const endEdit = useCallback((addr: CellAddr, opts: { cancel: boolean }) => {
    const k = `${addr.rowId}:${addr.col}`
    const sess = editSessionRef.current
    if (!sess || sess.key !== k) return // 이미 소비됨/다른 셀
    editSessionRef.current = null
    const cur = rowsRef.current.find(r => r.id === addr.rowId)?.[CELL_FIELD[addr.col]] ?? ''
    if (opts.cancel) {
      if (cur !== sess.baseline) {
        // 로컬 원값 복원 + 서버 재영속화(AC3.2). 편집 세션 중 1.5s 디바운스 commit이 이미 입력값을 서버에
        // 저장했을 수 있고, 그러면 자기 Realtime 에코가 dirty 없음으로 입력값을 재채택해 취소가 무효화된다.
        setRows(rs => rs.map(r => (r.id === addr.rowId ? { ...r, [CELL_FIELD[addr.col]]: sess.baseline } : r)))
        markDirty(k, cur) // 재영속화 우선 — wasDirty=false여도 dirty를 지우지 않는다. 기대값은 지금 값(그새 저장됐다면 서버가 가진 값)
        const t = timersRef.current.get(k); if (t) clearTimeout(t)
        // 0ms 지연: 위 setRows 플러시 후 rowsRef가 baseline을 반영한 다음 commit이 그 값을 전송하게 하는 장치.
        // 서버에 저장분이 없어도 동일 값 멱등 재저장 1회라 무해.
        timersRef.current.set(k, setTimeout(() => commit(addr.rowId, addr.col), 0))
      } else if (!sess.wasDirty) { // 변경 없음 + 진입 시 clean → dirty/타이머/상태 흔적 제거(회귀 #12)
        dirtyRef.current.delete(k)
        baseRef.current.delete(k)
        const t = timersRef.current.get(k); if (t) { clearTimeout(t); timersRef.current.delete(k) }
        setStatus(s => { if (!(k in s)) return s; const n = { ...s }; delete n[k]; return n })
      }
      return
    }
    if (cur !== sess.baseline) {
      undoRef.current = pushUndo(undoRef.current, {
        before: [{ rowId: addr.rowId, cellKey: addr.col, content: sess.baseline }],
        after: [{ rowId: addr.rowId, cellKey: addr.col, content: cur }],
      })
    }
    commit(addr.rowId, addr.col) // 디바운스 우회 즉시 저장
  }, [commit, markDirty])

  const handleCellBlur = useCallback((addr: CellAddr) => {
    const k = `${addr.rowId}:${addr.col}`
    if (editSessionRef.current && editSessionRef.current.key === k) endEdit(addr, { cancel: false })
    else commit(addr.rowId, addr.col)
  }, [endEdit, commit])

  const grid = useSheetGrid({
    rows, enabled: !!report && rows.length > 0, readOnly: !canEditCells, cellRefs,
    runBatch, requestUndo, requestRedo, beginEdit, endEdit, toast,
  })

  const requestAiRewrite = useCallback(async (targets: WeeklyRewriteTarget[]) => {
    if (!canEditCells || targets.length === 0) return
    const requestId = aiRequestRef.current + 1
    aiRequestRef.current = requestId
    aiTargetsRef.current = targets
    setAiOpen(true)
    setAiBusy(true)
    setAiError(null)
    setAiItems([])

    const inputs: WeeklyRewriteInput[] = targets.map(target => ({
      rowId: target.rowId,
      cellKey: target.cellKey,
      content: target.original,
    }))
    try {
      const result = await prepareWeeklyCellRewrite(projectId, inputs)
      if (aiRequestRef.current !== requestId) return
      setAiBusy(false)
      if (!result.ok) {
        setAiError(result.error)
        return
      }

      const source = new Map(targets.map(target => [`${target.rowId}:${target.cellKey}`, target]))
      const items = result.edits.flatMap(edit => {
        const target = source.get(`${edit.rowId}:${edit.cellKey}`)
        if (!target || edit.original !== target.original) return []
        return [{ ...edit, section: target.section, label: target.label }]
      })
      if (items.length !== targets.length) {
        setAiError(t('weekly.ai.err.mismatch'))
        setAiItems([])
        return
      }
      setAiItems(items)
    } catch {
      if (aiRequestRef.current !== requestId) return
      setAiBusy(false)
      setAiError(t('weekly.ai.err.network'))
    }
  }, [canEditCells, projectId, t])

  const openAiRewrite = useCallback(() => {
    if (!hasFocusedCell || !grid.rect) {
      toast({ title: t('weekly.ai.selectFirstTitle'), description: t('weekly.ai.selectFirstDesc'), variant: 'info' })
      return
    }
    const targets = buildWeeklyRewriteSelection(rowsRef.current, grid.rect, r => rowLabel(r, areasRef.current))
    if (targets.length === 0) {
      toast({ title: t('weekly.ai.noContentTitle'), description: t('weekly.ai.noContentDesc'), variant: 'info' })
      return
    }
    setAiItems([])
    void requestAiRewrite(targets)
  }, [grid.rect, hasFocusedCell, requestAiRewrite, toast, t])

  const retryAiRewrite = useCallback(() => {
    const latest = aiTargetsRef.current.flatMap(target => {
      const row = rowsRef.current.find(candidate => candidate.id === target.rowId)
      if (!row) return []
      const original = row[CELL_FIELD[target.cellKey]]
      return original.trim() ? [{ ...target, original }] : []
    })
    if (latest.length === 0) {
      setAiError(t('weekly.ai.err.noSource'))
      return
    }
    void requestAiRewrite(latest)
  }, [requestAiRewrite, t])

  const closeAiRewrite = useCallback(() => {
    aiRequestRef.current += 1
    aiTargetsRef.current = []
    setAiOpen(false)
    setAiBusy(false)
    setAiError(null)
    setAiItems([])
  }, [])

  const applyAiRewrite = useCallback((candidates: Parameters<typeof prepareApplicableWeeklyRewriteEdits>[1]) => {
    const applicable = prepareApplicableWeeklyRewriteEdits(rowsRef.current, candidates)
    if (!applicable.ok) {
      setAiError(t('weekly.ai.err.changed'))
      return
    }
    if (applicable.edits.length === 0) {
      toast({ title: t('weekly.ai.nothingToApply'), variant: 'info' })
      return
    }
    runBatch(applicable.edits, { undoable: true })
    closeAiRewrite()
  }, [closeAiRewrite, runBatch, toast, t])

  // 프레즌스 — 같은 주차 문서를 보는 다른 사용자의 위치/편집 상태(구글시트의 색상 커서 대응).
  // 훅 규칙: 아래 빈 상태(StatusMessage) 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  const presencePeers = usePresence({
    projectId, reportId, me,
    active: rows.length ? grid.sel.active : null,
    editing: grid.sel.editing,
    enabled: !!report && !!me,
  })
  const presenceByCell = useMemo(
    () => buildPresenceMap(presencePeers, me?.id ?? ''),
    [presencePeers, me?.id],
  )
  const online = useMemo(() => {
    // 본인 포함 전원 표시(사용자 결정). 본인은 presence 동기화 전에도 즉시 보이게 로컬로 선두 고정.
    const others = onlinePeers(presencePeers).filter(o => o.userId !== me?.id)
    return me ? [{ userId: me.id, name: me.name }, ...others] : others
  }, [presencePeers, me?.id, me?.name]) // eslint-disable-line react-hooks/exhaustive-deps -- me는 원시값으로 구독(객체 참조는 렌더마다 새것)

  // 언마운트 시 디바운스/재시도 타이머 정리 — 정리 안 하면 사라진 컴포넌트에 setState 호출됨.
  // 훅 규칙: 아래 빈 상태(StatusMessage) 조기 return보다 반드시 먼저 호출(렌더마다 훅 순서 고정).
  useEffect(() => () => {
    aiRequestRef.current += 1
    for (const t of timersRef.current.values()) clearTimeout(t)
    timersRef.current.clear()
    if (batchShowTimerRef.current) clearTimeout(batchShowTimerRef.current)
  }, [])

  // ── 문서 없음: StatusMessage + 시작 버튼 2종(스펙 §3 — 자동 생성 금지). 활성 영역이 없으면 시작할 수 없다(W1 — 액션도 CONFIG_REQUIRED) ──
  // 설정의 팀·업무영역 절(#project-team)은 관리자에게만 보인다 — 생성 자격(canCreateRound = isProjectAdmin)과 같은 술어라 그때만 링크를 둔다.
  // 상태 두 갈래(문서 없음·행 없음)는 시트 상자가 없다 — 채움형에서 main 이 닫히므로 짧은 높이(확대·가로 폰)에서 아래 버튼에
  // 닿게 루트가 스스로 세로 스크롤한다(B-4 리뷰 I1). 본문 갈래는 시트 상자가 유일한 스크롤 상자라 루트에 두지 않는다.
  const areaSettingsHref = `/p/${projectId}/settings#project-team`
  if (!report) {
    const activeAreaNames = orderAreas(areas.filter(a => a.active)).map(a => a.name)
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        <WeekNav projectId={projectId} weekStart={weekStart} prevWeek={prevWeek} nextWeek={nextWeek} weekLabel={weekLabel} exportDisabled onBeforeExport={flushPendingSaves} />
        {activeAreaNames.length === 0 ? (
          <StatusMessage
            kind="needs_setup"
            title={t('weekly.setup.title')}
            detail={canCreateRound
              ? t('weekly.setup.detailAdmin')
              : t('weekly.setup.detailMember')}
            action={canCreateRound ? { label: t('weekly.setup.action'), href: areaSettingsHref } : undefined}
          />
        ) : (
          // 회차 생성은 시트의 구조를 만드는 일이라 관리자 몫(createWeeklyReport=requireProjectAdmin).
          // 권한이 없으면 버튼 대신 '누가 만들어야 하는지'를 알린다 — 눌러서 거부당해 알게 하지 않는다.
          // StatusMessage 의 다음 행동은 하나뿐이라 두 시작 버튼은 그 아래 줄에 둔다(계획 P10).
          <div className="space-y-3">
            <StatusMessage
              kind="empty"
              title={t('weekly.empty.title').replace('{week}', () => weekLabel)}
              detail={canCreateRound
                ? t('weekly.empty.detailAdmin').replace('{n}', String(activeAreaNames.length)).replace('{names}', () => activeAreaNames.join('·'))
                : t('weekly.empty.detailMember')}
            />
            {canCreateRound && (
              <div className="flex gap-2">
                {hasCarrySource && (
                  <button className="btn btn-primary" disabled={isPending} onClick={() => startReport(true)}>
                    {t('weekly.empty.startCarry')}
                  </button>
                )}
                <button className="btn btn-ghost" disabled={isPending} onClick={() => startReport(false)}>
                  {t('weekly.empty.startBlank')}
                </button>
              </div>
            )}
          </div>
        )}
        {carry && carry.weekStart === weekStart && (
          <CarryMappingModal
            key={carry.round}
            open
            pending={carry.sources}
            overflow={carry.overflow}
            areas={areas}
            mapping={carry.mapping}
            busy={isPending}
            onSubmit={mapping => startReport(true, mapping)}
            onClose={() => setCarry(null)}
          />
        )}
      </div>
    )
  }

  // ── 문서는 있는데 보일 행이 0개([RF4] — 옛 보상 삭제가 실패한 잔재, 또는 영역이 모두 비활성이고 행이 다 비었다).
  //    RPC 는 같은 주 문서가 있으면 아무것도 바꾸지 않으므로(D33) 다시 만들 길은 없다 — 활성 영역을 저장하면 RPC 가 이번 주 이후
  //    문서에 행을 넣고(§3.2) 실시간으로 이 화면에 들어온다(mergeServerRow — 그때 표가 나타난다).
  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
        <WeekNav projectId={projectId} weekStart={weekStart} prevWeek={prevWeek} nextWeek={nextWeek} weekLabel={weekLabel} exportDisabled onBeforeExport={flushPendingSaves} />
        <StatusMessage
          kind="needs_setup"
          title={t('weekly.noRows.title').replace('{week}', () => weekLabel)}
          detail={canCreateRound
            ? t('weekly.noRows.detailAdmin')
            : t('weekly.noRows.detailMember')}
          action={canCreateRound ? { label: t('weekly.setup.action'), href: areaSettingsHref } : undefined}
        />
      </div>
    )
  }

  // ── 구글시트 복제 룩: 종이(surface) + 얇은 테두리 + 옅은 2단 헤더 + 병합 셀.
  //    시트도 테마 토큰을 따른다(SP4 B, D52).
  // 2단 머리의 금주실적·차주계획 × 내용·이슈 및 주요 이벤트(핵심 4열)와 기본 제목(▣ 주간업무보고)은 제품 고정이다 — 사전으로 옮기지 않는다(개정 §2.9)
  const HDR = 'border border-border-input bg-surface-subtle px-1 py-1.5 text-center text-[13px] font-bold text-fg'

  // 선택/채우기 사각 — 셀 단위 틴트·외곽선·핸들을 선언적으로 그린다(측정 없음, 회귀 #7).
  const gr = grid.rect
  const fp = grid.fillPreview
  const isMulti = !!gr && (gr.bottom > gr.top || gr.right > gr.left)

  // 온라인 스트립 — 같은 주차를 보는 사용자를 원형 아바타로 겹쳐 표시(공용 PresenceStrip).
  const presenceStrip = <PresenceStrip online={online} meId={me?.id} />

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <WeekNav
        projectId={projectId}
        weekStart={weekStart}
        prevWeek={prevWeek}
        nextWeek={nextWeek}
        weekLabel={weekLabel}
        exportDisabled={false}
        onBeforeExport={flushPendingSaves}
        presence={presenceStrip}
        onAiRewrite={canEditCells ? openAiRewrite : undefined}
        aiRewriteDisabled={!hasFocusedCell}
        onLint={() => setLintOpen(true)}
      />
      <div className="isolate min-h-0 flex-1 overflow-auto">
        <div className={`min-w-[1240px] rounded-(--radius-panel) bg-surface p-1.5 ring-1 ring-border/80 ${grid.dragging === 'fill' ? 'cursor-crosshair select-none' : grid.dragging === 'select' ? 'cursor-cell select-none' : ''}`}>
          {/* 제목 행 — 레퍼런스 시트의 B1. 자유 편집(''이면 기본 제목 합성). key로 주차 전환 시 초기화 */}
          <TitleEditor
            key={report.id}
            initial={report.title}
            fallback={`▣ 주간업무보고 - ${projectName}(${weekTitle})`}
            readOnly={!canEditCells}
            onSave={async (title, expected) => {
              const res = await saveWeeklyTitle(projectId, report.id, title, expected)
              // 그새 다른 사람이 제목을 바꿨다 — 실패 토스트가 아니라 비교로 잇는다(SPU1, 개정 §5.8)
              if (res.conflict && res.latest !== undefined) return { conflict: res.latest }
              if (!res.ok) { toast({ title: t('weekly.sheet.titleSaveFailed'), description: res.error, variant: 'error' }); return false }
              router.refresh()
              return true
            }}
            onReload={() => router.refresh()}
          />
          {/* 업무영역 1단(영역마다 1행) + 내용 4열. 행 구조 편집은 없다 — 영역 추가·비활성은 프로젝트 설정의 업무영역에서. */}
          {/* 열 폭: 업무영역 10% · 금주 내용 27% · 금주 이슈 19% · 차주 내용 26% · 차주 이슈 18%(합 100). colgroup 안에는 주석·공백을
              두지 않는다 — 공백 텍스트 노드가 colgroup 의 자식이 되면 hydration 오류가 난다. */}
          <table className="w-full table-fixed border-collapse bg-surface text-[13px] text-fg">
            <colgroup>
              {[
                <col key="__area" className="w-[10%]" />,
                <col key="__thisContent" className="w-[27%]" />,
                <col key="__thisIssue" className="w-[19%]" />,
                <col key="__nextContent" className="w-[26%]" />,
                <col key="__nextIssue" className="w-[18%]" />,
                ...customListDefs.map(d => <col key={`cf:${d.key}`} className="w-[140px]" />),
              ]}
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className={HDR}>{t('weekly.sheet.areaHeader')}</th>
                <th colSpan={2} className={HDR}>금주실적({thisRange})</th>
                <th colSpan={2} className={HDR}>차주계획({nextRange})</th>
                {customListDefs.map(d => (
                  <th key={d.key} rowSpan={2} className={HDR}>{d.label}</th>
                ))}
              </tr>
              <tr>
                <th className={HDR}>내용</th>
                <th className={HDR}>이슈 및 주요 이벤트</th>
                <th className={HDR}>내용</th>
                <th className={HDR}>이슈 및 주요 이벤트</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // 라벨은 영역 이름(비활성 영역은 표지) — 점검 패널 머리글(areaGroupOf)과 같은 규칙(rowLabel)이다.
                const rowName = rowLabel(r, areas)
                return (
                <tr key={r.id}>
                  <td className="border border-border-input px-1 py-1.5 text-center align-middle text-[13px] font-bold text-fg">
                    <div className="flex flex-col items-center justify-center gap-1">
                      <div>{rowName}</div>
                      {customDefs.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSelectedCustomRowId(r.id)}
                          className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-xs font-normal text-fg-muted hover:bg-surface-hover hover:text-fg"
                          title={t('weekly.custom.edit')}
                        >
                          {t('weekly.custom.button')}
                        </button>
                      )}
                    </div>
                  </td>
                  {COLS.map((c, j) => {
                    const addr: CellAddr = { rowId: r.id, col: c.key }
                    const active = grid.sel.active.rowId === r.id && grid.sel.active.col === c.key
                    const inRange = !!gr && i >= gr.top && i <= gr.bottom && j >= gr.left && j <= gr.right
                    const inFill = !!fp && i >= fp.top && i <= fp.bottom && j >= fp.left && j <= fp.right
                    const bg = fp && inFill && !inRange ? 'bg-surface-selected/60'
                      : isMulti && inRange && !active ? 'bg-surface-selected' : 'bg-surface'
                    return (
                      // h-px: td에 명시 높이를 줘야 내부 h-full/min-h-full이 행 실제 높이로 해석된다(표 셀 스트레치 관례).
                      // 없으면 입력창이 자기 내용만큼만 높아져, 옆 셀이 큰 행에서 포커스 링이 셀 일부만 감싼다.
                      <td key={c.key} className={`h-px border border-border-input p-0 align-top ${bg}`}>
                        <SheetCell
                          addr={addr}
                          value={r[CELL_FIELD[c.key]]}
                          ariaLabel={`${c.label}, ${rowName}`}
                          status={status[`${r.id}:${c.key}`]}
                          isActive={active}
                          editing={active && grid.sel.editing}
                          showBorder={isMulti && inRange}
                          edgeTop={!!gr && i === gr.top} edgeRight={!!gr && j === gr.right}
                          edgeBottom={!!gr && i === gr.bottom} edgeLeft={!!gr && j === gr.left}
                          showFillBorder={!!fp && inFill}
                          fillTop={!!fp && i === fp.top} fillRight={!!fp && j === fp.right}
                          fillBottom={!!fp && i === fp.bottom} fillLeft={!!fp && j === fp.left}
                          showFillHandle={canEditCells && !!gr && i === gr.bottom && j === gr.right && !grid.sel.editing && grid.dragging !== 'fill'}
                          readOnly={!canEditCells}
                          batchActive={batchActive}
                          chip={active ? batchChip : null}
                          peers={presenceByCell.get(`${r.id}:${c.key}`) ?? null}
                          register={registerCell}
                          onChange={v => onCellChange(r.id, c.key, v)}
                          onBlur={e => { handleCellBlur(addr); grid.onCellBlurEvent(e) }}
                          onRetry={() => commit(r.id, c.key)}
                          onCompare={() => openCompare(`${r.id}:${c.key}`)}
                          onChipRetry={retryBatch}
                          onMouseDown={e => grid.onCellMouseDown(e, addr)}
                          onMouseEnter={() => grid.onCellMouseEnter(addr)}
                          onFocus={() => { setHasFocusedCell(true); grid.onCellFocus(addr) }}
                          onDoubleClick={grid.onCellDoubleClick}
                          onKeyDown={grid.onCellKeyDown}
                          onCopy={grid.onCellCopy}
                          onCut={grid.onCellCut}
                          onPaste={grid.onCellPaste}
                          onCompositionStart={grid.onCompositionStart}
                          onCompositionEnd={grid.onCompositionEnd}
                          onFillHandleMouseDown={grid.onFillHandleMouseDown}
                        />
                      </td>
                    )
                  })}
                  {customListDefs.map(d => {
                    const parsed = parseCustomValues(r.custom ?? {})
                    const text = parsed.ok ? formatCustomValue(d, parsed.value[d.key], customFormat) : '!'
                    return (
                      <td
                        key={d.key}
                        onClick={() => setSelectedCustomRowId(r.id)}
                        className="cursor-pointer border border-border-input px-2 py-1 text-center align-middle hover:bg-surface-hover/50 text-[13px]"
                        title={`${d.label}: ${text} ${t('weekly.custom.clickToEdit')}`}
                      >
                        <span className="truncate">{text}</span>
                      </td>
                    )
                  })}
                </tr>
                )
              })}
            </tbody>
          </table>
          {/* 단축키 안내 — 셀 내 줄바꿈은 눌러보기 전엔 알 수 없어서 표에 붙여 노출한다. */}
          <p className="pt-1.5 text-xs text-fg-secondary">
            {t('weekly.sheet.hint.newlineLead')}<kbd className="rounded border border-border px-1 font-sans">Alt</kbd>
            <span className="px-0.5">+</span>
            <kbd className="rounded border border-border px-1 font-sans">Enter</kbd>
            <span className="px-1 text-fg-muted">{t('weekly.sheet.hint.mac')}</span>
            {t('weekly.sheet.hint.enterLead')}<kbd className="rounded border border-border px-1 font-sans">Enter</kbd>{t('weekly.sheet.hint.enterTail')}
          </p>
          {/* 선택/배치 결과 방송(§7) — 시각적 숨김 */}
          <div aria-live="polite" className="sr-only">{grid.live}</div>
        </div>
      </div>
      <WeeklyLintPanel
        open={lintOpen}
        rows={rows}
        groupOf={lintGroupOf}
        canApply={canEditCells}
        onClose={() => setLintOpen(false)}
        onApply={edits => runBatch(edits, { undoable: true })}
        onGoToCell={(rowId, col) => grid.focusCell({ rowId, col })}
      />
      <WeeklyAiRewriteModal
        open={aiOpen}
        busy={aiBusy}
        error={aiError}
        items={aiItems}
        onClose={closeAiRewrite}
        onRetry={retryAiRewrite}
        onApply={applyAiRewrite}
      />
      {(() => {
        // 저장 충돌 비교(개정 §5.8, Q05) — 내 입력은 칸에 그대로 있고, 서버의 현재 값과 나란히 보인다
        const k = conflictKey
        const [rowId, key] = (k ?? ':').split(':') as [string, WeeklyCellKey]
        const row = k ? rows.find(r => r.id === rowId) : undefined
        const latest = k ? conflictRef.current.get(k) : undefined
        const open = !!k && !!row && latest !== undefined
        return (
          <ConflictResolver
            open={open}
            target={row ? rowLabel(row, areas) : undefined}
            fields={open ? [{ key, label: WEEKLY_CELL_LABEL[key], mine: row![CELL_FIELD[key]], latest: latest!, base: baseRef.current.get(k!) }] : []}
            onKeepMine={() => k && keepMine(k)}
            onTakeLatest={() => k && takeLatest(k)}
            onContinue={() => k && dequeue(k)}
          />
        )
      })()}
      {selectedCustomRow && (
        <Modal
          open={!!selectedCustomRowId}
          onClose={() => setSelectedCustomRowId(null)}
          title={t('weekly.custom.modalTitle').replace('{area}', () => rowLabel(selectedCustomRow, areas))}
          size="md"
        >
          <div className="p-4">
            <CustomFieldValuesEditor
              rowId={selectedCustomRow.id}
              values={selectedCustomRow.custom}
              canEdit={canEditCells}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}

function WeekNav({
  projectId, weekStart, prevWeek, nextWeek, weekLabel, exportDisabled, onBeforeExport, presence,
  onAiRewrite, aiRewriteDisabled = false, onLint,
}: {
  projectId: string; weekStart: string; prevWeek: string; nextWeek: string; weekLabel: string; exportDisabled: boolean
  onBeforeExport: () => Promise<boolean>
  presence?: React.ReactNode // 온라인 사용자 스트립(프레즌스) — 내보내기 버튼 왼쪽
  onAiRewrite?: () => void   // 현재 선택 셀 AI 미리보기. 조회 전용·빈 시트에서는 넘기지 않는다.
  aiRewriteDisabled?: boolean
  onLint?: () => void        // 주간보고 점검 패널 열기. 시트가 없는 빈 상태에서는 점검할 것이 없어 넘기지 않는다.
}) {
  const { t } = useLocale()
  const base = `/p/${projectId}/weekly`
  return (
    // 채움형(SP4 B) — main 은 스크롤하지 않고 시트 상자가 스크롤한다. 이 줄은 늘 보이고, 셀 오버레이(배지·핸들 z-30)는
    // 시트 상자의 isolate 안에 갇힌다. 좁은 화면(390)에서는 줄을 바꿔 감싼다 — main 이 닫혀 옆으로 넘친 내보내기 버튼에 닿을 길이 없다.
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 pb-1 pt-1">
      <div className="flex items-center gap-1 rounded-(--radius-control) border border-border/80 bg-surface p-0.5">
        <Link href={`${base}?week=${prevWeek}`} className="btn btn-ghost h-8 w-8 p-0" aria-label={t('weekly.nav.prev')}>
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <span className="min-w-36 text-center text-xs font-semibold tabular-nums text-fg">{weekLabel}</span>
        <Link href={`${base}?week=${nextWeek}`} className="btn btn-ghost h-8 w-8 p-0" aria-label={t('weekly.nav.next')}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {presence}
        <div className="flex flex-wrap items-center gap-2">
          {/* 내보내기 전에 점검하는 순서가 자연스러워 왼쪽에 둔다. */}
          {onAiRewrite && (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={aiRewriteDisabled}
              onClick={onAiRewrite}
              title={aiRewriteDisabled ? t('weekly.ai.selectHint') : undefined}
              data-weekly-ai-rewrite
            >
              <Sparkles className="mr-1 h-4 w-4 text-action" />{t('weekly.ai.title')}
            </button>
          )}
          {onLint && <button type="button" className="btn btn-ghost" onClick={onLint}>{t('weekly.lint.title')}</button>}
          <ExportSummaryPptButton projectId={projectId} />
          <ExportPptButton projectId={projectId} weekStart={weekStart} disabled={exportDisabled} onBeforeExport={onBeforeExport} />
        </div>
      </div>
    </div>
  )
}

/** PPT 응답을 blob으로 받아 파일 저장. 실패(400 등)는 Toast로 안내(스펙 §7). */
async function downloadPpt(url: string, fallbackName: string, toast: ReturnType<typeof useToast>['toast'], t: (k: DictKey) => string) {
  const res = await fetch(url)
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    toast({ title: t('weekly.export.failed'), description: err?.error ?? t('weekly.export.errorStatus').replace('{status}', String(res.status)), variant: 'error' })
    return
  }
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') ?? ''
  const name = decodeURIComponent(cd.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? fallbackName)
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = name
  a.click()
  URL.revokeObjectURL(objectUrl)
}

/** 주간보고요약 PPT — WBS 기반 요약 보고서(WBS 메뉴 보고서 모달의 PPT와 동일 산출물)를 이
 *  페이지에서 바로 다운로드. 시트 데이터를 읽지 않으므로 flush·시트 유무와 무관하게 항상 활성. */
function ExportSummaryPptButton({ projectId }: { projectId: string }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const onExport = async () => {
    setBusy(true)
    try {
      await downloadPpt(`/api/report?projectId=${projectId}&format=pptx`, 'weekly_report.pptx', toast, t)
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn btn-ghost" disabled={busy} onClick={onExport}>
      <Download className="mr-1 h-4 w-4" />{t('weekly.export.summary')}
    </button>
  )
}

/** 주간보고 PPT — 프로젝트의 주간 PPT 양식(forms.weekly_report_pptx — 없으면 제품 기본 양식)을 채워 다운로드.
 *  fetch로 받아 400(빈 시트 등)을 Toast로 안내(스펙 §7). onBeforeExport로 미저장 셀을 먼저
 *  flush — false(중단)면 fetch 없이 종료. */
function ExportPptButton({ projectId, weekStart, disabled, onBeforeExport }: {
  projectId: string; weekStart: string; disabled: boolean; onBeforeExport: () => Promise<boolean>
}) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const onExport = async () => {
    setBusy(true)
    try {
      const canExport = await onBeforeExport()
      if (!canExport) return
      await downloadPpt(
        `/api/report?projectId=${projectId}&format=pptx&source=sheet&week=${weekStart}`,
        `weekly_${weekStart}.pptx`, toast, t,
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <button className="btn btn-primary" disabled={disabled || busy} onClick={onExport}>
      <Download className="mr-1 h-4 w-4" />{t('weekly.export.detail')}
    </button>
  )
}

/** 시트 제목 편집기 — 레퍼런스 B1 룩(볼드·검정)의 borderless input. blur 시 변경분만 저장.
 *  기본 제목과 같은 값은 ''로 저장해 주차가 바뀌어도 기본 제목이 자연히 따라오게 한다.
 *  savedRef는 저장 '성공' 후에만 전진 — 실패 시 같은 값 blur로 재시도가 가능해야 한다(리뷰 확정).
 *  서버 제목 변경(타 사용자)은 router.refresh로 내려온 initial을 비포커스 상태에서만 채택.
 *  저장은 내가 마지막으로 확인한 서버 제목(savedRef)을 기대값으로 싣는다(SPU1, 개정 §5.8) — 그새 남이 바꿨으면 서버가 쓰지 않고, 여기서
 *  비교(ConflictResolver)를 띄운다. 입력은 그대로 둔다. */
function TitleEditor({ initial, fallback, readOnly, onSave, onReload }: {
  initial: string; fallback: string; readOnly: boolean
  /** expected — 저장 꼴의 기대값(기본 제목이면 ''). 충돌이면 서버의 현재 제목(저장 꼴)을 돌려준다 */
  onSave: (title: string, expected: string) => Promise<boolean | { conflict: string }>
  /** '서버 값 받기' 뒤 화면을 다시 읽는다 */
  onReload?: () => void
}) {
  const { t } = useLocale()
  const [v, setV] = useState(initial || fallback)
  const savedRef = useRef(initial || fallback)
  const focusedRef = useRef(false)
  const [conflict, setConflict] = useState<{ mine: string; latest: string; base: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // 비교가 떠 있는 동안은 입력이 포커스를 잃어도 편집 중이다 — 내려온 서버 제목으로 입력을 덮지 않는다
  const conflictOpenRef = useRef(false)
  conflictOpenRef.current = conflict !== null
  useEffect(() => {
    const server = initial || fallback
    if (!focusedRef.current && !conflictOpenRef.current && server !== savedRef.current) { savedRef.current = server; setV(server) }
  }, [initial, fallback])
  const stored = (shown: string) => (shown === fallback ? '' : shown)
  /** next(화면 꼴)를 저장한다 — 기대값은 savedRef(내가 확인한 서버 제목). 충돌이면 비교를 연다 */
  const save = async (next: string) => {
    const res = await onSave(stored(next), stored(savedRef.current))
    if (res === true) { savedRef.current = next; return }
    if (res !== false) setConflict({ mine: next, latest: res.conflict || fallback, base: savedRef.current })
  }
  const onBlur = async () => {
    focusedRef.current = false
    if (readOnly) return // saveWeeklyTitle 은 requireProjectMember — 조회 전용은 저장 시도조차 하지 않는다
    const t = v.trim()
    if (t === '') setV(fallback)
    const next = t === '' || t === fallback ? fallback : t
    if (next === savedRef.current) return
    await save(next)
  }
  /** 내 값으로 저장 — 방금 본 서버 제목을 기대값으로 한 번만 다시 쓴다(또 어긋나면 비교가 새 값으로 다시 열린다) */
  const keepMine = async () => {
    if (!conflict) return
    const { mine, latest } = conflict
    savedRef.current = latest
    setConflict(null); setBusy(true)
    await save(mine)
    setBusy(false)
  }
  /** 서버 값 받기 — 쓰지 않고 입력을 서버 제목으로 바꾼다 */
  const takeLatest = () => {
    if (!conflict) return
    savedRef.current = conflict.latest
    setV(conflict.latest)
    setConflict(null)
    onReload?.()
  }
  return (
    <>
      <input
        value={v} onChange={e => setV(e.target.value)} onBlur={onBlur}
        onFocus={() => { focusedRef.current = true }}
        readOnly={readOnly} maxLength={200} aria-label={t('weekly.sheet.titleLabel')}
        className="w-full border-0 bg-surface px-0.5 pb-1.5 pt-0.5 text-[15px] font-extrabold text-fg outline-none placeholder:text-fg-muted focus:outline focus:outline-2 focus:-outline-offset-1 focus:outline-border-focus"
      />
      <ConflictResolver
        open={!!conflict}
        fields={conflict ? [{ key: 'title', label: t('weekly.sheet.titleLabel'), mine: conflict.mine, latest: conflict.latest, base: conflict.base }] : []}
        onKeepMine={() => void keepMine()} onTakeLatest={takeLatest} onContinue={() => setConflict(null)} busy={busy}
      />
    </>
  )
}
