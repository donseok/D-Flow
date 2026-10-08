'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveCustomFieldValues } from '@/app/actions/customFieldValues'
import { getWbsCellSnapshot } from '@/app/actions/wbs'
import { ConflictResolver } from '@/components/ui/ConflictResolver'
import { classifyCasOutcome, editSessionStore } from '@/lib/sync/editSession'
import { customFieldErrorText } from '@/components/fields/CustomFieldValuesEditor'
import { formatCustomValue, type CustomValues, type FieldDef, type FieldValue } from '@/lib/domain/customFields'
import { parseCustomValues, validateCustomValues } from '@/lib/domain/customFieldValues'
import type { Locale } from '@/lib/i18n/dict'

/** 셀 안에서 고칠 수 있는 유형 — 한 줄 입력으로 끝나는 것만. 여러 줄·다중 선택은 행 높이에 들어가지 않아 상세 패널에서 고친다 */
const CELL_TYPES: readonly FieldDef['type'][] = ['text', 'number', 'date', 'boolean', 'select']
/** 시트 셀 편집 대상(개정 §3.6.9 "편집 셀은 멤버 필드만") — 활성·멤버 편집 필드 중 한 줄 유형 */
export function cellEditableField(def: FieldDef): boolean {
  return def.active && def.editable_by === 'member' && CELL_TYPES.includes(def.type)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const INPUT = 'h-6 w-full min-w-0 rounded border border-action bg-surface px-1 text-fg outline-none focus:ring-2 focus:ring-border-focus'

/**
 * WBS 시트의 사용자 정의 필드 셀(SP5c §3.6.9). 읽기 표시는 종전과 같고, 편집 가능한 셀은 클릭·Enter 로 들어가 Enter(또는 포커스 이탈)로
 * 저장하고 Esc 로 취소한다. 저장은 상세 패널과 같은 길이다 — JWT 세션 + 행의 custom 전체 CAS(saveCustomFieldValues). 다른 사람이 그 행의
 * 값을 먼저 바꿨으면 덮지 않고 알린 뒤 새로 읽는다.
 */
export function WbsCustomFieldCell({
  def, defs, projectId, rowId, custom, canEdit, canAdmin, locale, format, className, width, onError,
}: {
  def: FieldDef
  /** 그 엔티티의 정의 전부 — 행 전체 검증(필수·권한)에 쓴다 */
  defs: readonly FieldDef[]
  projectId: string
  rowId: string
  /** 그 행의 custom 전체. null = 저장값을 읽지 못함(손상) — 경고 표식만, 편집 불가 */
  custom: CustomValues | null
  /** 그 행을 이 사용자가 고칠 수 있는가(상세 패널의 '추가 정보'와 같은 판정) */
  canEdit: boolean
  canAdmin: boolean
  locale: Locale
  format: { locale: string; yes: string; no: string; empty: string }
  className: string
  width: number
  onError: (message: string) => void
}) {
  const router = useRouter()
  const ko = locale === 'ko'
  const [draft, setDraft] = useState<string | null>(null)   // null = 편집 중 아님. 입력값은 문자열로 들고 저장 때 유형으로 바꾼다
  const [busy, setBusy] = useState(false)
  const [invalid, setInvalid] = useState(false)
  // 저장 직후 서버 스냅샷이 올 때까지의 표시값 — 그 스냅샷(prop)이 바뀌면 버린다(옛 prop 을 다시 받아들이지 않는다)
  const [saved, setSaved] = useState<{ from: string; values: CustomValues } | null>(null)
  // 편집기가 닫혔다(취소·저장 끝) — 닫히며 뒤늦게 오는 blur 가 옛 값으로 다시 저장하지 않게 막는다
  const closed = useRef(true)
  const inFlight = useRef(false)
  // 저장 충돌 비교 — ref 는 상자가 포커스를 가져갈 때의 blur 저장을 막는다
  type Conflict = { latest: CustomValues; mine: string; latestText: string; base: string }
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const conflictRef = useRef<Conflict | null>(null)

  const signature = JSON.stringify(custom)
  const current = custom === null ? null : saved && saved.from === signature ? saved.values : custom
  const text = current === null ? '!' : formatCustomValue(def, current[def.key], format)
  const editable = canEdit && current !== null && cellEditableField(def)
  const editing = draft !== null

  const start = () => {
    if (!editable || editing || current === null) return
    const v = current[def.key]
    closed.current = false
    setInvalid(false)
    setDraft(v === undefined ? '' : String(v))
    editSessionStore.setSession(`wbs:${rowId}:cf:${def.key}`, 'wbs_cell', `${rowId}:cf:${def.key}`, 'editing')
  }
  const close = () => { closed.current = true; setDraft(null); setInvalid(false) }
  const cancelEdit = () => { editSessionStore.removeSession(`wbs:${rowId}:cf:${def.key}`); close() }
  const typed = (raw: string): FieldValue | undefined => {
    if (raw === '') return undefined
    if (def.type === 'number') return Number(raw)
    if (def.type === 'boolean') return raw === 'true'
    return raw
  }
  const sessionId = `wbs:${rowId}:cf:${def.key}`
  const mark = (status: 'editing' | 'saving' | 'saved' | 'failed' | 'conflict' | 'outcome_unknown') =>
    editSessionStore.setSession(sessionId, 'wbs_cell', `${rowId}:cf:${def.key}`, status)
  const shown = (v: FieldValue | undefined) => (v === undefined ? '' : formatCustomValue(def, v, format))
  // rebase: 비교에서 '내 값으로 저장'을 골랐거나 다른 칸만 바뀐 행 — 그 최신 행을 기대값으로 내 칸만 얹는다
  const commit = async (rebase?: CustomValues) => {
    if (draft === null || inFlight.current || closed.current || current === null) return
    if (conflictRef.current && !rebase) return   // 비교가 떠 있는 동안의 blur 는 저장이 아니다
    const from = rebase ?? current
    const next: CustomValues = { ...from }
    const value = typed(def.type === 'text' ? draft.trim() : draft)
    if (value === undefined) delete next[def.key]
    else next[def.key] = value
    if (same(next, from)) { if (rebase) { mark('saved'); router.refresh() } else editSessionStore.removeSession(sessionId); close(); return }
    const checked = validateCustomValues(defs, next, from, canAdmin)
    if (!checked.ok) {
      setInvalid(true)
      onError(`${def.label}: ${customFieldErrorText(checked.errors[def.key] ?? Object.values(checked.errors)[0], ko)}`)
      return
    }
    const applied = (values: CustomValues) => { mark('saved'); setSaved({ from: signature, values }); close(); router.refresh() }
    // 이 칸을 다른 사람이 바꿨다 — 편집기와 입력을 둔 채 비교를 연다
    const conflicted = (latest: CustomValues) => {
      mark('conflict')
      const c = { latest, mine: shown(value), latestText: shown(latest[def.key]), base: shown(from[def.key]) }
      conflictRef.current = c
      setConflict(c)
    }
    // 그새 바뀐 행(latest)을 어떻게 받을지 — 이 칸으로만 가린다. 이미 내 값이면 반영된 것(앞선 내 저장의 응답만 잃었다), 이 칸이 그대로면
    // 그 위에 내 칸만 얹어 한 번 더(다른 칸의 변경을 지킨다), 이 칸이 바뀌었으면 비교
    const settle = (latest: CustomValues, retried: boolean): 'applied' | 'rebase' | 'conflict' => {
      if (same(latest[def.key], value)) return 'applied'
      if (!retried && same(latest[def.key], from[def.key])) return 'rebase'
      return 'conflict'
    }
    inFlight.current = true
    setBusy(true)
    mark('saving')
    let again: CustomValues | null = null
    try {
      const result = await saveCustomFieldValues(projectId, 'wbs_item', rowId, from, checked.value)
      if (!result.ok) {
        if (result.code === 'FIELD_CONFLICT' && result.latest) {
          const how = settle(result.latest, rebase !== undefined)
          if (how === 'applied') applied(result.latest)
          else if (how === 'rebase') again = result.latest
          else conflicted(result.latest)
          return
        }
        onError(result.error)
        // 현재 값을 읽지 못한 충돌은 비교할 것이 없다 — 닫고 새로 읽는다. 그 밖의 실패는 입력을 지킨다
        if (result.code === 'FIELD_CONFLICT') { mark('conflict'); close(); router.refresh() } else { mark('failed'); setInvalid(true) }
        return
      }
      applied(result.values)
    } catch {
      // 응답 유실(§5.8.1 OutcomeUnknown) — 실패로 단정하지 않고 서버 값을 읽어 가린다
      mark('outcome_unknown')
      const snap = await getWbsCellSnapshot(rowId).catch(() => null)
      const latest = snap?.ok ? parseCustomValues(snap.custom) : null
      if (!latest?.ok) { onError(ko ? '저장 결과를 확인하지 못했습니다. 입력은 그대로 있습니다 — 다시 저장하면 반영 여부부터 확인합니다.' : 'The save result could not be confirmed. Your input is kept — saving again checks whether it was applied first.'); setInvalid(true); return }
      const outcome = classifyCasOutcome<FieldValue | undefined>({ mine: value, base: from[def.key], latest: latest.value[def.key] }, same)
      if (outcome === 'applied') applied(latest.value)
      else if (outcome === 'not_applied') { mark('failed'); setInvalid(true); onError(ko ? '저장되지 않았습니다. 입력은 그대로 있습니다 — 다시 저장하세요.' : 'Not saved. Your input is kept — save again.') }
      else conflicted(latest.value)
    } finally {
      inFlight.current = false; setBusy(false)
      if (again) void commit(again)
    }
  }
  const closeConflict = () => { conflictRef.current = null; setConflict(null) }
  const keepMine = () => { const c = conflictRef.current; if (!c) return; closeConflict(); void commit(c.latest) }
  const takeLatest = () => { closeConflict(); editSessionStore.removeSession(sessionId); close(); router.refresh() }
  const continueEdit = () => { closeConflict(); mark('editing') }
  const keys = (e: React.KeyboardEvent) => {
    // 한글 조합 중의 Enter·Esc 는 조합을 끝내는 키다 — 저장·취소로 새지 않게 한다(개정 §5.8.4, Q04. 주간 시트 useSheetGrid 와 같은 가드)
    if (e.nativeEvent.isComposing || e.keyCode === 229) { e.stopPropagation(); return }
    if (e.key === 'Enter') { e.preventDefault(); void commit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
    e.stopPropagation()
  }
  const common = {
    autoFocus: true, 'aria-label': def.label, 'aria-busy': busy, 'aria-invalid': invalid || undefined,
    onBlur: () => void commit(), onKeyDown: keys, onClick: (e: React.MouseEvent) => e.stopPropagation(),
    style: { fontSize: 'var(--wbs-cell-font, 12px)' },
  }
  const options = [...(def.options ?? [])].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))

  return (
    <div
      data-wbs-col={`cf:${def.key}`}
      title={editing || current === null ? undefined : text}
      className={`${className} ${editable && !editing ? 'cursor-pointer' : ''}`}
      style={{ width }}
      role={editable && !editing ? 'button' : undefined}
      tabIndex={editable && !editing ? 0 : undefined}
      onClick={editable ? start : undefined}
      onKeyDown={editable && !editing ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start() } } : undefined}
    >
      {!editing ? <span className={`truncate ${current === null ? 'text-danger' : ''}`}>{text}</span>
        : def.type === 'boolean' || def.type === 'select' ? (
          // disabled 는 포커스를 빼앗는다 — 저장 중에는 변경만 막는다
          <select {...common} className={INPUT} value={draft} onChange={e => { if (!busy) { setDraft(e.target.value); setInvalid(false) } }}>
            <option value="">{ko ? '미설정' : 'Not set'}</option>
            {def.type === 'boolean'
              ? <><option value="true">{format.yes}</option><option value="false">{format.no}</option></>
              : options.map(o => <option key={o.code} value={o.code} disabled={!o.active}>{o.label}{!o.active ? ko ? ' (비활성)' : ' (inactive)' : ''}</option>)}
          </select>
        ) : (
          <input {...common} className={`${INPUT} ${def.type === 'number' ? 'text-right tabular-nums' : ''}`} readOnly={busy}
            type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
            {...(def.type === 'number' ? { min: def.limits?.min, max: def.limits?.max, step: 10 ** -(def.limits?.decimals ?? 0) } : {})}
            value={draft} onChange={e => { setDraft(e.target.value); setInvalid(false) }} />
        )}
      <ConflictResolver
        open={conflict !== null}
        target={def.label}
        fields={conflict ? [{ key: def.key, label: def.label, mine: conflict.mine, latest: conflict.latestText, base: conflict.base }] : []}
        onKeepMine={keepMine}
        onTakeLatest={takeLatest}
        onContinue={continueEdit}
        busy={busy}
      />
    </div>
  )
}
