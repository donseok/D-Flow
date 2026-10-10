// 셀 범위 붙여넣기·지우기의 저장 실행 — 새 저장 모델을 만들지 않는다. 계획(planCellWrites)이 고른 칸을 열마다의 기존 길로 보낸다:
//   산출물·계획일(관리자)  → 일괄 저장(wbsBulk): 행 단위 원자 저장 + updated_at CAS
//   산출물(멤버)          → updateDeliverable(값, 화면이 본 값)
//   가중치 · 실적%        → updateWeight · updateActual(값, 화면이 본 값)
//   사용자 정의 필드       → saveCustomFieldValues(행 custom 전체 CAS) — 행마다 한 번
// 어느 길이든 화면이 본 값이 서버와 다르면 쓰지 않는다(개정 §5.8 — 무통보 덮어쓰기 0건). 충돌한 칸은 모아 돌려주고 호출부가 요약해 보인다
// (칸마다 비교 상자를 띄우지 않는다). 한 칸의 실패가 나머지를 막지 않는다 — 부분 성공을 그대로 돌려준다.
import { updateActual, updateDeliverable, updateWeight } from '@/app/actions/wbs'
import { bulkPasteWbsItems, createWbsBulkSnapshot } from '@/app/actions/wbsBulk'
import { saveCustomFieldValues } from '@/app/actions/customFieldValues'
import type { WbsBulkChanges, WbsBulkSnapshotRow, WbsBulkTarget } from '@/lib/domain/wbsBulk'
import type { CustomValues, FieldDef } from '@/lib/domain/customFields'
import { validateCustomValues } from '@/lib/domain/customFieldValues'
import type { RangeWrite } from '@/lib/domain/wbsCellRange'
import { wbsToastText } from '@/lib/wbs/actionErrors'
import type { DictKey } from '@/lib/i18n/dict'

export interface RangeWriteOutcome {
  written: RangeWrite[]
  /** 서버 값이 이미 내 값이었다 — 쓰지 않았고 충돌도 아니다 */
  already: RangeWrite[]
  /** 화면이 본 값과 서버 값이 달랐다 — 쓰지 않았다 */
  conflicts: RangeWrite[]
  failed: { write: RangeWrite; message: string }[]
}

export interface RangeWriteDeps {
  projectId: string
  /** 프로젝트 관리자 — 일괄 저장 길(wbsBulk)은 관리자 전용이다 */
  admin: boolean
  customDefs: readonly FieldDef[]
  canAdminFields: boolean
  t: (key: DictKey) => string
}

type BulkWrite = Extract<RangeWrite, { kind: 'deliverable' | 'date' }>
type CustomWrite = Extract<RangeWrite, { kind: 'custom' }>
/** 표의 열 → 일괄 저장의 필드 */
const BULK_FIELD = { deliverable: 'deliverable', pstart: 'plannedStart', pend: 'plannedEnd' } as const
/** 일괄 저장 액션이 한 번에 받는 행 수(bulkPasteWbsItems 의 상한) */
const BULK_ROWS = 200
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const sameWeight = (a: number | null, b: number | null) => (a == null || b == null ? a == null && b == null : Number(a) === Number(b))

export async function runRangeWrites(writes: readonly RangeWrite[], deps: RangeWriteDeps): Promise<RangeWriteOutcome> {
  const out: RangeWriteOutcome = { written: [], already: [], conflicts: [], failed: [] }
  const { t, projectId } = deps
  const fail = (ws: readonly RangeWrite[], message: string) => { for (const write of ws) out.failed.push({ write, message }) }
  // 응답을 받지 못한 저장 — 반영됐는지 모른다. 실패로 단정하지 않고 "확인하지 못함"으로 적는다(호출부가 화면을 다시 읽는다)
  const unknown = t('wbs.range.unknown')

  /* ── 1) 일괄 저장 길: 산출물·계획일(관리자) ──
     일괄 저장의 CAS 는 행의 updated_at 이다. 화면의 행에는 그 값이 늘 있지 않으므로(선택 필드) 지금 서버 스냅샷을 읽어 두 번 가린다:
     ① 스냅샷 값이 화면이 본 값과 다르면 그 행은 충돌(쓰지 않는다) ② 스냅샷 뒤에 바뀌었으면 RPC 가 updated_at 으로 거부한다.
     한 행의 칸은 같이 반영되거나 같이 남는다(시작·종료일의 짝 검증이 행 단위다). */
  const bulk = new Map<string, BulkWrite[]>()
  const rest: RangeWrite[] = []
  for (const w of writes) {
    if (deps.admin && (w.kind === 'deliverable' || w.kind === 'date')) bulk.set(w.rowId, [...(bulk.get(w.rowId) ?? []), w])
    else rest.push(w)
  }
  const bulkRows = [...bulk.entries()]
  for (let at = 0; at < bulkRows.length; at += BULK_ROWS) {
    const chunk = bulkRows.slice(at, at + BULK_ROWS)
    const all = chunk.flatMap(([, ws]) => ws)
    let snapshot: Awaited<ReturnType<typeof createWbsBulkSnapshot>>
    try { snapshot = await createWbsBulkSnapshot(projectId, chunk.map(([id]) => id)) } catch { fail(all, unknown); continue }
    // 쓰기 전 선행 조회가 실패하면 쓰지 않는다(에러 처리 3원칙)
    if (!snapshot.ok) { fail(all, snapshot.error); continue }
    const seen = new Map<string, WbsBulkSnapshotRow>(snapshot.rows.map(r => [r.id, r]))
    const ops: { target: WbsBulkTarget; changes: WbsBulkChanges; cells: BulkWrite[] }[] = []
    for (const [rowId, ws] of chunk) {
      const now = seen.get(rowId)
      if (!now) { fail(ws, t('wbs.toastSaveFail')); continue }
      const live = ws.filter(w => now[BULK_FIELD[w.col]] !== w.value)   // 서버가 이미 내 값인 칸은 쓸 것이 없다
      for (const w of ws) if (!live.includes(w)) out.already.push(w)
      if (live.some(w => now[BULK_FIELD[w.col]] !== w.expected)) { out.conflicts.push(...live); continue }
      if (live.length === 0) continue
      const changes: WbsBulkChanges = {}
      for (const w of live) changes[BULK_FIELD[w.col]] = w.value === null ? { mode: 'clear' } : { mode: 'set', value: w.value }
      ops.push({ target: { id: now.id, updatedAt: now.updatedAt }, changes, cells: live })
    }
    if (ops.length === 0) continue
    let res: Awaited<ReturnType<typeof bulkPasteWbsItems>>
    try { res = await bulkPasteWbsItems(projectId, ops.map(({ target, changes }) => ({ target, changes }))) } catch { fail(ops.flatMap(o => o.cells), unknown); continue }
    const ok = new Set(res.succeeded)
    const bad = new Map(res.failed.map(f => [f.itemId, f]))
    for (const op of ops) {
      const why = bad.get(op.target.id)
      if (ok.has(op.target.id)) out.written.push(...op.cells)
      else if (why?.reason === 'conflict') out.conflicts.push(...op.cells)
      else fail(op.cells, why?.message ?? res.error ?? t('wbs.toastSaveFail'))
    }
  }

  /* ── 2) 칸마다의 길: 그 열의 기존 단건 액션을 화면이 본 값과 함께 차례로 부른다 ── */
  const customs = new Map<string, CustomWrite[]>()
  for (const w of rest) {
    if (w.kind === 'custom') { customs.set(w.rowId, [...(customs.get(w.rowId) ?? []), w]); continue }
    try {
      if (w.kind === 'weight') {
        const res = await updateWeight(w.rowId, w.value, w.expected)
        if (res.ok) out.written.push(w)
        else if (res.conflict) (res.latest !== undefined && sameWeight(res.latest, w.value) ? out.already : out.conflicts).push(w)
        else fail([w], wbsToastText(t, res.error, 'wbs.toastSaveFail'))
      } else if (w.kind === 'actual') {
        const res = await updateActual(w.rowId, w.value, w.expected)
        if (res.ok) out.written.push(w)
        else if (res.conflict) (res.latest !== undefined && Number(res.latest ?? 0) === w.value ? out.already : out.conflicts).push(w)
        // 흐름으로 잠긴 실적(위임·점유 항목의 100, 승인 단계 ≥2)은 서버만 안다 — 거부 사유를 사전 문구로 옮겨 싣는다(인라인 편집과 같은 문구)
        else fail([w], res.code === 'actual_locked' ? t('wbs.actualLocked') : res.code === 'approval_required' ? t('wbs.err.approvalRequired') : wbsToastText(t, res.error, 'wbs.toastSaveFail'))
      } else if (w.kind === 'deliverable') {
        // 멤버(자기 팀 담당 항목) — 일괄 저장 길은 관리자 전용이라 산출물 단건 액션으로 간다
        const res = await updateDeliverable(w.rowId, w.value, w.expected)
        if (res.ok) out.written.push(w)
        else if (res.conflict) out.conflicts.push(w)
        else fail([w], res.error ?? t('wbs.toastSaveFail'))
      } else {
        // 계획일은 관리자만 계획에 들어온다 — 여기 닿으면 판정이 어긋난 것이라 쓰지 않는다
        fail([w], t('wbs.range.why.denied'))
      }
    } catch { fail([w], unknown) }
  }

  /* 사용자 정의 필드 — 행의 custom 전체가 기대값이라 한 행의 칸을 한 번에 쓴다. 그새 행이 바뀌었으면(FIELD_CONFLICT + latest) 내 칸마다 가린다:
     이미 내 값이면 반영된 것, 내 칸이 그대로면(다른 칸만 바뀌었다) 그 최신 행 위에 한 번만 다시 얹고(다른 칸의 변경을 지킨다), 내 칸이 바뀌었으면 충돌.
     셀 편집기(WbsCustomFieldCell)의 settle 과 같은 규칙이다. */
  for (const [rowId, cells] of customs) {
    let base: CustomValues = cells[0].expected
    let pending = cells
    try {
      for (let attempt = 0; attempt < 2 && pending.length; attempt++) {
        const next: CustomValues = { ...base }
        for (const c of pending) { if (c.value === undefined) delete next[c.key]; else next[c.key] = c.value }
        const checked = validateCustomValues(deps.customDefs, next, base, deps.canAdminFields)
        if (!checked.ok) { fail(pending, t('fields.err.format')); pending = []; break }
        const res = await saveCustomFieldValues(projectId, 'wbs_item', rowId, base, checked.value)
        if (res.ok) { out.written.push(...pending); pending = []; break }
        if (res.code !== 'FIELD_CONFLICT') { fail(pending, res.error); pending = []; break }
        const latest = res.latest
        // 현재 값을 읽지 못한 충돌, 또는 한 번 다시 얹고도 또 바뀐 행 — 더 따라가지 않는다
        if (!latest || attempt > 0) { out.conflicts.push(...pending); pending = []; break }
        const retry: CustomWrite[] = []
        for (const c of pending) {
          if (same(latest[c.key], c.value)) out.already.push(c)
          else if (same(latest[c.key], base[c.key])) retry.push(c)
          else out.conflicts.push(c)
        }
        base = latest
        pending = retry
      }
    } catch { fail(pending, unknown) }
  }
  return out
}
