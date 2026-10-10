'use client'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import {
  getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch,
} from '@/app/actions/settings'
import { migrateVocabCode } from '@/app/actions/vocab'
import { newUuid } from '@/lib/domain/uuid'
import type { DictKey } from '@/lib/i18n/dict'
import {
  COUNTS_AS, ISSUE_CATEGORIES, RESERVED_SOURCE, VOCAB_CODE_RE, VOCAB_COLORS, VOCAB_COLOR_CLASS, activeVocab, defaultVocab, parseVocab, vocabChangeError,
  vocabLabel, type VocabEntry, type VocabKey,
} from '@/lib/settings/vocab'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 편집 행 — 저장 값의 모든 필드를 느슨하게 들고 있다가 저장 때 키의 모양으로 다시 짠다(순서 = sort·rank) */
type Row = Record<string, unknown> & { code: string; label: string; active: boolean; isNew?: boolean }

const hasField = (key: VocabKey, field: 'short' | 'color' | 'counts_as' | 'category' | 'selectable' | 'announce_default') => {
  switch (field) {
    case 'short': case 'counts_as': case 'selectable': return key === 'attendance.types'
    case 'category': return key === 'workflow.issue_statuses'
    case 'color': return key === 'attendance.types' || key === 'meetings.categories' || key === 'issues.severities' || key === 'workflow.issue_statuses'
    case 'announce_default': return key === 'meetings.categories'
  }
}
/** 순서대로 정렬된 저장 값 → 편집 행 */
function toRows(key: VocabKey, list: readonly VocabEntry[]): Row[] {
  const ordered = [...list].sort((a, b) => {
    const ka = 'rank' in a ? a.rank : 'sort' in a ? a.sort : 0
    const kb = 'rank' in b ? b.rank : 'sort' in b ? b.sort : 0
    return ka - kb
  })
  return ordered.map(e => ({ ...e } as Row))
}
/** 편집 행 → 저장 값(키의 모양). 순서가 sort(1부터)·rank(1부터)가 된다 */
function toValue(key: VocabKey, rows: readonly Row[]): unknown[] {
  return rows.map((r, i) => {
    const base = { code: r.code.trim(), label: r.label, active: r.active }
    switch (key) {
      case 'attendance.types':
        return { ...base, short: String(r.short ?? r.label), color: r.color ?? 'neutral', counts_as: r.counts_as ?? 'work', selectable: r.selectable !== false, sort: i + 1 }
      case 'meetings.categories':
        return { ...base, color: r.color ?? 'neutral', sort: i + 1, announce_default: r.announce_default === true }
      case 'issues.severities':
        return { ...base, rank: i + 1, color: r.color ?? 'neutral' }
      case 'workflow.issue_statuses':
        return { ...base, category: r.category ?? 'open', color: r.color ?? 'neutral', sort: i + 1 }
      default:
        return { ...base, sort: i + 1 }
    }
  })
}

/**
 * 어휘 편집기(SP5 B4 묶음4) — 한 키의 목록. code 는 만든 뒤 바꾸지 않고(입력 칸 없음), 이름·순서·색·사용 여부·키별 속성을 고친다.
 * 저장은 설정 명령(CAS·명령 id·불확실 결과 재확인 — AttachmentPolicyEditor 와 같은 꼴), 검증은 순수 parseVocab·vocabChangeError 이고
 * 서버가 다시 검증한다. 기록이 있는 code 를 지우거나 근태 집계 분류를 바꾸면 DB 가 건수와 함께 거부한다(CONFIG_IN_USE) —
 * 그때 그 code 의 기록을 다른 활성 항목으로 옮기는 이관 명령(migrateVocabCode)을 연다. 옮긴 뒤 같은 편집으로 다시 저장한다.
 */
export function VocabEditor({ projectId, vocabKey, value, invalid = false, revision, canEdit }: {
  projectId: string
  vocabKey: VocabKey
  /** 저장된(또는 기본) 목록. 손상이면 null 과 invalid=true(제품 기본값으로 시작 — 저장이 복구) */
  value: readonly VocabEntry[] | null
  invalid?: boolean
  revision: number
  canEdit: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const start = useMemo(() => toRows(vocabKey, value ?? (defaultVocab(vocabKey) as readonly VocabEntry[])), [vocabKey, value])
  const [rows, setRows] = useState<Row[]>(start)
  const [baseline, setBaseline] = useState<Row[]>(start)
  const [baseRevision, setBaseRevision] = useState(revision)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [inUse, setInUse] = useState<{ code: string; count: number } | null>(null)
  const [target, setTarget] = useState('')
  const [newCode, setNewCode] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [repaired, setRepaired] = useState(!invalid)
  const [pending, startTransition] = useTransition()

  const draftValue = toValue(vocabKey, rows)
  const parsed = parseVocab(vocabKey, draftValue)
  const ruleError = parsed.ok ? vocabChangeError(vocabKey, value ? [...value] as never : undefined, parsed.value as never) : null
  const dirty = !repaired || JSON.stringify(rows) !== JSON.stringify(baseline)
  const locked = !canEdit || pending || !!uncertainPatch
  const isFixed = (code: string) => vocabKey === 'issues.sources' && code === RESERVED_SOURCE
  const savedCodes = new Set(baseline.map(r => r.code))
  const tr = (k: string) => t(k as DictKey)

  function change(i: number, patch: Partial<Row>) {
    setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r))); setError(''); setNotice('')
  }
  function move(i: number, d: -1 | 1) {
    setRows(prev => {
      const j = i + d
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next
    })
  }
  function remove(i: number) { setRows(prev => prev.filter((_, j) => j !== i)); setError(''); setNotice('') }
  function add() {
    const code = newCode.trim()
    if (!VOCAB_CODE_RE.test(code)) { setError(tr('settings.vocab.addCode')); return }
    if (rows.some(r => r.code === code)) { setError(`'${code}' — ${tr('settings.vocab.code')}`); return }
    const label = newLabel.trim() || code
    const extra: Record<string, unknown> = {}
    if (hasField(vocabKey, 'short')) Object.assign(extra, { short: label.slice(0, 10), counts_as: 'work', selectable: true })
    if (hasField(vocabKey, 'color')) extra.color = 'neutral'
    if (hasField(vocabKey, 'category')) extra.category = 'open'
    if (hasField(vocabKey, 'announce_default')) extra.announce_default = false
    setRows(prev => [...prev, { code, label, active: true, isNew: true, ...extra }])
    setNewCode(''); setNewLabel(''); setError('')
  }

  function applied(rev: number, message: string) {
    const clean = rows.map(r => { const c = { ...r }; delete c.isNew; return c })
    setRows(clean); setBaseline(clean); setBaseRevision(rev); setRepaired(true)
    setUncertainPatch(null); setError(''); setInUse(null); setNotice(message)
    router.refresh()
  }
  async function submit(patch: SettingsPatch): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 명령 이력에서 반영 여부를 확인한다 */ }
    if (result?.ok) { applied(result.revision, tr('settings.vocab.saved')); return }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      setUncertainPatch(null)
      // 기록이 있는 code — 건수와 함께 이관을 연다(CONFIG_IN_USE 의 키 오류, 0023 settings_ref_check)
      const fe = result.kind === 'invalid' ? result.fieldErrors.find(f => f.key === vocabKey && f.code && f.refCount) : undefined
      if (fe?.code && fe.refCount) {
        setInUse({ code: fe.code, count: fe.refCount })
        setTarget(migrateTargets(fe.code)[0]?.code ?? '')
      }
      setError(fe?.message ?? result.error)
      return
    }
    try {
      const outcome = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (outcome.ok && outcome.outcome.status === 'applied') { applied(outcome.outcome.revision, tr('settings.vocab.confirmed')); return }
    } catch { /* 같은 명령을 다시 보내도록 보류한다 */ }
    setUncertainPatch(patch); setError(tr('settings.vocab.uncertain'))
  }
  function save() {
    if (!parsed.ok) { setError(parsed.error); return }
    if (ruleError) { setError(ruleError); return }
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { [vocabKey]: parsed.value }, unset: [] }
    setError(''); setNotice(''); setInUse(null)
    startTransition(() => { void submit(patch) })
  }
  function migrate() {
    if (!inUse || !target) return
    const from = inUse.code
    startTransition(async () => {
      const r = await migrateVocabCode(projectId, vocabKey, from, target).catch(() => null)
      if (!r) { setError(tr('settings.vocab.uncertain')); return }
      if (!r.ok) { setError(r.error); return }
      setInUse(null); setError(''); setNotice(tr('settings.vocab.migrated').replace('{n}', String(r.moved)))
      router.refresh()
    })
  }

  // 이관 대상 = 저장된 목록의 활성 항목 중 옮기는 code 가 아닌 것(DB 는 저장된 목록의 활성 항목만 받는다 — 새 항목이면 먼저 저장이 필요).
  // 이슈 표시 상태는 같은 범주만(SP5b D3 — DB 가 SETTINGS_CODE_CATEGORY_MISMATCH 로 거부한다)
  function migrateTargets(code: string): VocabEntry[] {
    const fromCategory = baseline.find(r => r.code === code)?.category
    return activeVocab(baseline.map(r => r as unknown as VocabEntry))
      .filter(e => e.code !== code && (vocabKey !== 'workflow.issue_statuses' || (e as unknown as Row).category === fromCategory))
  }
  const targets = inUse ? migrateTargets(inUse.code) : []
  const label = (code: string) => vocabLabel(vocabKey, rows as unknown as VocabEntry[], code, t)

  return <div className="space-y-3" data-vocab-editor={vocabKey}>
    {invalid && !repaired && <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{tr('settings.vocab.invalid')}</p>}
    {/* relative — 머리의 sr-only(절대 위치) 칸이 이 스크롤 상자를 빠져나가 문서 폭을 밀지 않게(390 실측) */}
    <div className="relative overflow-x-auto">
      <table className="data-table w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="px-2 py-2">{tr('settings.vocab.order')}</th>
            <th className="px-2 py-2">{tr('settings.vocab.code')}</th>
            <th className="px-2 py-2">{tr('settings.vocab.label')}</th>
            {hasField(vocabKey, 'short') && <th className="px-2 py-2">{tr('settings.vocab.short')}</th>}
            {hasField(vocabKey, 'color') && <th className="px-2 py-2">{tr('settings.vocab.color')}</th>}
            {hasField(vocabKey, 'counts_as') && <th className="px-2 py-2">{tr('settings.vocab.countsAs')}</th>}
            {hasField(vocabKey, 'category') && <th className="px-2 py-2">{tr('settings.vocab.category')}</th>}
            {hasField(vocabKey, 'selectable') && <th className="px-2 py-2">{tr('settings.vocab.selectable')}</th>}
            {hasField(vocabKey, 'announce_default') && <th className="px-2 py-2">{tr('settings.vocab.announce')}</th>}
            <th className="px-2 py-2">{tr('settings.vocab.active')}</th>
            <th className="px-2 py-2"><span className="sr-only">{tr('settings.vocab.remove')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const fixed = isFixed(r.code)
            const canDelete = !fixed && (vocabKey !== 'issues.cause_categories' || !savedCodes.has(r.code))
            const color = typeof r.color === 'string' && r.color in VOCAB_COLOR_CLASS ? (r.color as keyof typeof VOCAB_COLOR_CLASS) : 'neutral'
            return <tr key={r.code} className="border-b border-border/60 last:border-0" data-vocab-row={r.code}>
              <td className="whitespace-nowrap px-2 py-1.5">
                <button type="button" className="btn btn-ghost h-7 w-7 p-0" aria-label={`${tr('settings.vocab.up')} ${r.code}`} disabled={locked || i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" className="btn btn-ghost h-7 w-7 p-0" aria-label={`${tr('settings.vocab.down')} ${r.code}`} disabled={locked || i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
              </td>
              <td className="px-2 py-1.5 font-mono text-xs text-fg-secondary">{r.code}</td>
              <td className="px-2 py-1.5"><input className="app-input h-8 min-w-[7rem]" aria-label={`${tr('settings.vocab.label')} ${r.code}`} value={r.label} disabled={locked} onChange={e => change(i, { label: e.target.value })} /></td>
              {hasField(vocabKey, 'short') && <td className="px-2 py-1.5"><input className="app-input h-8 w-20" aria-label={`${tr('settings.vocab.short')} ${r.code}`} value={String(r.short ?? '')} disabled={locked} onChange={e => change(i, { short: e.target.value })} /></td>}
              {hasField(vocabKey, 'color') && <td className="px-2 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${VOCAB_COLOR_CLASS[color].dot}`} aria-hidden />
                  <select className="app-input h-8" aria-label={`${tr('settings.vocab.color')} ${r.code}`} value={color} disabled={locked} onChange={e => change(i, { color: e.target.value })}>
                    {VOCAB_COLORS.map(c => <option key={c} value={c}>{tr(`settings.vocab.color.${c}`)}</option>)}
                  </select>
                </span>
              </td>}
              {hasField(vocabKey, 'counts_as') && <td className="px-2 py-1.5">
                <select className="app-input h-8" aria-label={`${tr('settings.vocab.countsAs')} ${r.code}`} value={String(r.counts_as ?? 'work')} disabled={locked} onChange={e => change(i, { counts_as: e.target.value })}>
                  {COUNTS_AS.map(c => <option key={c} value={c}>{tr(`settings.vocab.countsAs.${c}`)}</option>)}
                </select>
              </td>}
              {hasField(vocabKey, 'category') && <td className="px-2 py-1.5">
                <select className="app-input h-8" aria-label={`${tr('settings.vocab.category')} ${r.code}`} value={String(r.category ?? 'open')} disabled={locked} onChange={e => change(i, { category: e.target.value })}>
                  {ISSUE_CATEGORIES.map(c => <option key={c} value={c}>{tr(`issue.status.${c}`)}</option>)}
                </select>
              </td>}
              {hasField(vocabKey, 'selectable') && <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${tr('settings.vocab.selectable')} ${r.code}`} checked={r.selectable !== false} disabled={locked} onChange={e => change(i, { selectable: e.target.checked })} /></td>}
              {hasField(vocabKey, 'announce_default') && <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${tr('settings.vocab.announce')} ${r.code}`} checked={r.announce_default === true} disabled={locked} onChange={e => change(i, { announce_default: e.target.checked })} /></td>}
              <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label={`${tr('settings.vocab.active')} ${r.code}`} checked={r.active} disabled={locked || fixed} title={fixed ? tr('settings.vocab.fixed') : undefined} onChange={e => change(i, { active: e.target.checked })} /></td>
              <td className="px-2 py-1.5 text-right">
                <button type="button" className="btn btn-ghost h-7 w-7 p-0 text-danger" aria-label={`${tr('settings.vocab.remove')} ${r.code}`}
                  title={fixed ? tr('settings.vocab.fixed') : !canDelete ? tr('settings.vocab.causeNoDelete') : undefined}
                  disabled={locked || !canDelete} onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></button>
              </td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    {canEdit && <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tr('settings.vocab.addCode')}
        <input className="app-input h-8 w-44 font-mono" value={newCode} disabled={locked} onChange={e => setNewCode(e.target.value.toLowerCase())} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tr('settings.vocab.addLabel')}
        <input className="app-input h-8 w-40" value={newLabel} disabled={locked} onChange={e => setNewLabel(e.target.value)} />
      </label>
      <button type="button" className="btn btn-ghost h-8" disabled={locked || !newCode.trim()} onClick={add}>{tr('settings.vocab.add')}</button>
    </div>}
    {inUse && <div role="group" aria-label={tr('settings.vocab.migrate')} className="flex flex-wrap items-end gap-2 rounded-lg border border-border px-3 py-2">
      <span className="text-sm text-fg">{label(inUse.code)} · {inUse.count}</span>
      {targets.length === 0 && <span className="text-xs text-danger">{tr('settings.vocab.noSameCategory')}</span>}
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tr('settings.vocab.migrateTo')}
        <select className="app-input h-8" value={target} disabled={pending} onChange={e => setTarget(e.target.value)}>
          {targets.map(e => <option key={e.code} value={e.code}>{label(e.code)}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-primary h-8" disabled={pending || !target} onClick={migrate}>{tr('settings.vocab.migrate')}</button>
    </div>}
    {!parsed.ok && <p role="alert" className="text-sm text-danger">{parsed.error}</p>}
    {parsed.ok && ruleError && <p role="alert" className="text-sm text-danger">{ruleError}</p>}
    {error && parsed.ok && !ruleError && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    <button type="button" className="btn btn-primary" disabled={!canEdit || pending || !dirty || !parsed.ok || !!ruleError} onClick={save}>
      {pending ? '…' : uncertainPatch ? tr('settings.vocab.retry') : tr('settings.vocab.save')}
    </button>
  </div>
}
