'use client'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsPatch } from '@/app/actions/settings'
import { backfillCustomField, getCustomFieldUsage, purgeCustomField, type FieldCommandInput, type FieldUsage } from '@/app/actions/customFields'
import { FIELD_ENTITIES, FIELD_TYPES, orderedFields, parseFieldDefs, validateCustomValue, type FieldDef, type FieldEntity, type FieldLimits, type FieldType, type FieldValue } from '@/lib/domain/customFields'
import { VOCAB_COLORS, type VocabColor } from '@/lib/settings/vocab'
import { newUuid } from '@/lib/domain/uuid'
import { t as translate, type DictKey} from '@/lib/i18n/dict'
import { CustomFieldInput } from '@/components/fields/CustomFieldInput'

type FieldState = { value: readonly FieldDef[] | null; error?: string; enabled: boolean }
export function CustomFieldsSettings({ projectId, states, revision, canEdit }: {
  projectId: string; states: Record<FieldEntity, FieldState>; revision: number; canEdit: boolean;
}) {
  const tl = (k: DictKey) => translate(k)
  const [entity, setEntity] = useState<FieldEntity>('wbs_item')
  const [busy, setBusy] = useState(false)
  const names = { wbs_item: 'WBS', issue: tl('nav.issues'), weekly_row: tl('nav.weekly') }
  return <div data-custom-fields-settings className="space-y-4">
    <div role="tablist" aria-label={tl('settings.fields.fieldEntity')} className="flex flex-wrap gap-2">
      {FIELD_ENTITIES.map(e => <button key={e} type="button" role="tab" aria-selected={e === entity} aria-controls={`fields-${e}`}
        id={`fields-tab-${e}`} className={e === entity ? 'btn btn-primary' : 'btn'} disabled={busy && e !== entity} onClick={() => setEntity(e)}>{names[e]}</button>)}
    </div>
    <div role="tabpanel" id={`fields-${entity}`} aria-labelledby={`fields-tab-${entity}`}>
      {!states[entity].enabled ? <p role={states[entity].error ? "alert" : "status"} className="text-sm text-fg-secondary">{states[entity].error ?? tl('settings.fields.enableThisModuleToManage')}</p>
        : <FieldManager key={`${entity}-${revision}`} projectId={projectId} entity={entity} initial={states[entity].value} initialError={states[entity].error}
          revision={revision} canEdit={canEdit} onBusy={setBusy} />}
    </div>
  </div>
}

type BulkCommand = { kind: 'backfill'; input: FieldCommandInput & { value: FieldValue } } | { kind: 'purge'; input: FieldCommandInput & { expectedCount: number } }
function FieldManager({ projectId, entity, initial, initialError, revision, canEdit, onBusy }: {
  projectId: string; entity: FieldEntity; initial: readonly FieldDef[] | null; initialError?: string
  revision: number; canEdit: boolean; onBusy: (busy: boolean) => void
}) {
  const router = useRouter()
  const tl = useCallback((k: DictKey) => translate(k), [])
  const [draft, setDraft] = useState<FieldDef[]>(() => orderedFields(initial ?? []))
  const [baseline, setBaseline] = useState(draft)
  const [origins, setOrigins] = useState<(string | null)[]>(draft.map(d => d.key))
  const [baseRevision, setRevision] = useState(revision)
  const [selected, setSelected] = useState(0)
  const [usage, setUsage] = useState<FieldUsage | null>(null)
  const [usageError, setUsageError] = useState('')
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [uncertain, setUncertain] = useState<SettingsPatch | null>(null)
  const [bulk, setBulk] = useState<BulkCommand | null>(null)
  const [purgeCount, setPurgeCount] = useState('')
  const [purgeOpen, setPurgeOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const drag = useRef<number | null>(null)
  const usageRequest = useRef(0)
  const mounted = useRef(true)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const locked = !canEdit || pending || !!uncertain || !!bulk || initial === null
  const parsed = parseFieldDefs(entity, draft)
  const field = draft[selected]
  const stored = field && origins[selected] !== null ? baseline.find(d => d.key === origins[selected]) : undefined
  const count = usage && field ? (Object.hasOwn(usage.counts, field.key) ? usage.counts[field.key] : 0) : null
  const missing = usage && count !== null ? usage.total - count : null
  const selectionRequiredBlocked = !field?.required && (missing === null || missing > 0)
  const types: Record<FieldType, string> = { text: tl('settings.fields.type.text'), multiline: tl('settings.fields.type.multiline'), number: tl('settings.fields.type.number'), date: tl('settings.fields.type.date'), boolean: tl('settings.fields.type.boolean'), select: tl('settings.fields.type.select'), multiselect: tl('settings.fields.type.multiselect') }
  useEffect(() => { onBusy(dirty || pending || !!uncertain || !!bulk); return () => onBusy(false) }, [dirty, pending, uncertain, bulk, onBusy])
  useEffect(() => {
    const request = ++usageRequest.current
    let live = true; mounted.current = true
    void getCustomFieldUsage(projectId, entity).then(r => {
      if (!live || request !== usageRequest.current) return
      setLoadingUsage(false)
      if (r.ok) { setUsage(r.usage); setUsageError('') } else { setUsage(null); setUsageError(r.error) }
    }).catch(() => { if (live) { setLoadingUsage(false); setUsage(null); setUsageError(tl('settings.fields.couldNotLoadUsageCounts')) } })
    return () => { live = false; mounted.current = false }
  }, [projectId, entity, tl])
  async function refreshUsage() {
    const request = ++usageRequest.current
    setLoadingUsage(true)
    try {
      const r = await getCustomFieldUsage(projectId, entity)
      if (!mounted.current || request !== usageRequest.current) return
      if (r.ok) { setUsage(r.usage); setUsageError('') } else { setUsage(null); setUsageError(r.error) }
    } catch { if (mounted.current && request === usageRequest.current) { setUsage(null); setUsageError(tl('settings.fields.couldNotLoadUsageCounts')) } }
    finally { if (mounted.current && request === usageRequest.current) setLoadingUsage(false) }
  }
  function change(patch: Partial<FieldDef>) {
    setDraft(ds => ds.map((d, i) => i === selected ? { ...d, ...patch } : d)); setError(''); setNotice(''); setPurgeOpen(false)
  }
  function changeLimit(key: keyof FieldLimits, value: number | string | undefined) {
    const limits = { ...field.limits }
    if (value === undefined) delete limits[key]
    else Object.assign(limits, { [key]: value })
    change({ limits })
  }
  function changeType(type: FieldType) {
    const next = { ...field, type }; delete next.default; delete next.limits; delete next.options
    if (type === 'select' || type === 'multiselect') next.options = [{ code: 'option_1', label: tl('settings.fields.option1'), sort: 0, active: true }]
    setDraft(ds => ds.map((d, i) => i === selected ? next : d)); setError(''); setNotice(''); setPurgeOpen(false)
  }
  function changeDefault(value: FieldValue | undefined) {
    const next = { ...field }
    if (value === undefined) delete next.default; else next.default = value
    setDraft(ds => ds.map((d, i) => i === selected ? next : d)); setError(''); setNotice('')
  }
  function move(from: number, to: number) {
    if (locked || to < 0 || to >= draft.length || from === to) return
    const next = [...draft], chosen = draft[selected]
    next.splice(to, 0, next.splice(from, 1)[0])
    const nextOrigins = [...origins]; nextOrigins.splice(to, 0, nextOrigins.splice(from, 1)[0]); setOrigins(nextOrigins)
    setSelected(next.indexOf(chosen)); setDraft(next.map((d, i) => ({ ...d, sort: i }))); setPurgeOpen(false)
  }
  function add() {
    let n = 1; while (draft.some(d => d.key === `field_${n}`)) n++
    setDraft(ds => [...ds, { key: `field_${n}`, label: tl('settings.fields.newField'), description: '', type: 'text', required: false,
      editable_by: 'member', show_in_list: false, searchable: false, ...(entity === 'weekly_row' ? { carry_over: false } : {}), sort: ds.length, active: true }])
    setOrigins(xs => [...xs, null]); setSelected(draft.length); setError(''); setNotice(''); setPurgeOpen(false)
  }
  function adopted(defs: FieldDef[], nextRevision: number, message: string) {
    setDraft(defs); setBaseline(defs); setOrigins(defs.map(d => d.key)); setRevision(nextRevision); setUncertain(null); setBulk(null); setPurgeOpen(false); setPurgeCount('')
    setSelected(i => Math.max(0, Math.min(i, defs.length - 1))); setError(''); setNotice(message); router.refresh(); void refreshUsage()
  }
  async function submit(patch: SettingsPatch) {
    const next = patch.set[`fields.${entity}`] as FieldDef[]
    try {
      const r = await updateProjectSettings(projectId, patch)
      if (r.ok) { adopted(next, r.revision, tl('settings.fields.fieldSettingsSaved')); return }
      if ('appliedRevision' in r && r.appliedRevision !== undefined) { adopted(next, r.appliedRevision, tl('settings.fields.fieldSettingsSaved')); setError(r.error); return }
      if (r.kind !== 'unavailable' || !r.retryable) { setUncertain(null); setError(r.error); return }
    } catch { /* resolve the immutable command outcome before permitting another command */ }
    try {
      const r = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (r.ok && r.outcome.status === 'applied') { adopted(next, r.outcome.revision, tl('settings.fields.confirmedSavedFieldSettings')); return }
    } catch { /* keep the exact patch for an idempotent retry */ }
    setUncertain(patch); setError(tl('settings.fields.couldNotConfirmTheSave'))
  }
  function save() {
    if (!uncertain && !parsed.ok) { setError(parsed.error); return }
    const patch = uncertain ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { [`fields.${entity}`]: parsed.ok ? parsed.value : [] }, unset: [] }
    setError(''); setNotice(''); startTransition(async () => { await submit(patch) })
  }
  async function runBulk(command: BulkCommand) {
    try {
      const r = command.kind === 'backfill' ? await backfillCustomField(projectId, entity, command.input) : await purgeCustomField(projectId, entity, command.input)
      if (!r.ok) { setError(r.error); if (!r.retryable) { setBulk(null); if (r.code === 'CONFIG_STALE' || r.code === 'CONFIG_CONFLICT') { setPurgeOpen(false); router.refresh(); void refreshUsage() } }; return }
      const next = command.kind === 'purge' ? baseline.filter(d => d.key !== command.input.key)
        : baseline.map(d => d.key === command.input.key ? { ...d, required: true, default: d.default ?? command.input.value } : d)
      adopted(next, r.revision, command.kind === 'purge' ? tl('settings.fields.fieldDeleted') : tl('settings.fields.filledRowsAndMadeThe').replace('{count}', String(r.count)))
    } catch { setError(tl('settings.fields.couldNotConfirmTheOutcome')) }
  }
  function execute(command: BulkCommand) { setBulk(command); setError(''); setNotice(''); startTransition(async () => { await runBulk(command) }) }
  const txt = (name: string, value: string, onChange: (v: string) => void, disabled = locked) => <label className="flex min-w-0 flex-col gap-1 text-xs text-fg-secondary">{name}<input className="app-input" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} /></label>
  const num = (name: string, key: keyof FieldLimits, value: number | undefined) => <label className="flex flex-col gap-1 text-xs text-fg-secondary">{name}<input type="number" className="app-input" value={value ?? ''} disabled={locked} onChange={e => changeLimit(key, e.target.value === '' ? undefined : Number(e.target.value))} /></label>
  if (initial === null) return <p role="alert" className="text-sm text-danger">{initialError ?? tl('settings.fields.fieldSettingsAreInvalidContact')}</p>
  return <div className="space-y-4" data-field-manager={entity}>
    <p className="text-xs text-fg-secondary">{tl('settings.fields.fieldKeysAndOptionCodes')}</p>
    {usageError && <div role="alert" className="text-sm text-danger">{usageError} <button type="button" className="btn" disabled={pending || loadingUsage} onClick={() => void refreshUsage()}>{tl('settings.fields.reloadCounts')}</button></div>}
    <div className="grid gap-4 md:grid-cols-[minmax(10rem,1fr)_minmax(0,3fr)]">
      <div className="space-y-2">
        <ol className="space-y-2">{draft.map((d, i) => <li key={i} className="rounded-lg border border-border p-2" draggable={!locked}
          onDragStart={() => { drag.current = i }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (drag.current !== null) move(drag.current, i); drag.current = null }}>
          <button type="button" className="w-full text-left text-sm text-fg" aria-current={selected === i ? 'true' : undefined} disabled={pending || !!uncertain || !!bulk}
            onClick={() => { setSelected(i); setPurgeOpen(false); setPurgeCount('') }}>{d.label || d.key}{!d.active ? tl('settings.fields.inactive') : ''}</button>
          <div className="mt-1 flex gap-2"><button type="button" className="text-xs text-fg-secondary" aria-label={`${d.label} ${tl('settings.fields.up')}`} disabled={locked || i === 0} onClick={() => move(i, i - 1)}>↑</button><button type="button" className="text-xs text-fg-secondary" aria-label={`${d.label} ${tl('settings.fields.down')}`} disabled={locked || i === draft.length - 1} onClick={() => move(i, i + 1)}>↓</button></div>
        </li>)}</ol>
        <button type="button" className="btn" disabled={locked || draft.length >= 60} onClick={add}>{tl('settings.fields.addField')}</button>
      </div>
      {field ? <div className="space-y-4 min-w-0">
        <div className="grid gap-3 sm:grid-cols-2">
          {txt(tl('settings.fields.fieldKey'), field.key, key => change({ key }), locked || origins[selected] !== null)}
          {txt(tl('settings.fields.label'), field.label, label => change({ label }))}
          <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tl('meet.form.category')}<select aria-label={tl('meet.form.category')} className="app-input" value={field.type} disabled={locked} onChange={e => changeType(e.target.value as FieldType)}>{FIELD_TYPES.map(t => <option key={t} value={t}>{types[t]}</option>)}</select></label>
          <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tl('settings.fields.editableBy')}<select aria-label={tl('settings.fields.editableBy')} className="app-input" value={field.editable_by} disabled={locked} onChange={e => change({ editable_by: e.target.value as FieldDef['editable_by'] })}><option value="member">{tl('att.col.member')}</option><option value="admin">{tl('wbs.roleAdmin')}</option></select></label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tl('home.fieldDesc')}<textarea className="app-input" value={field.description} disabled={locked} onChange={e => change({ description: e.target.value })} /></label>
        <div className="flex flex-wrap gap-4 text-sm text-fg">
          {(['active', 'show_in_list', 'searchable', ...(entity === 'weekly_row' ? ['carry_over'] as const : [])] as const).map(k => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!field[k]} disabled={locked} onChange={e => change({ [k]: e.target.checked })} />{({ active: tl('settings.forms.active'), show_in_list: tl('settings.fields.showInList'), searchable: tl('settings.fields.searchable'), carry_over: tl('settings.fields.carryForward') })[k]}</label>)}
          <label className="flex items-center gap-2"><input type="checkbox" checked={field.required} disabled={locked || selectionRequiredBlocked} onChange={e => change({ required: e.target.checked })} />{tl('account.notif.required')}</label>
        </div>
        {(field.type === 'text' || field.type === 'multiline') && num(tl('settings.fields.maximumLength'), 'maxLength', field.limits?.maxLength)}
        {field.type === 'number' && <div className="grid gap-3 sm:grid-cols-2">{num(tl('settings.fields.minimum'), 'min', field.limits?.min)}{num(tl('settings.fields.maximum'), 'max', field.limits?.max)}{num(tl('settings.fields.decimals04'), 'decimals', field.limits?.decimals)}{txt(tl('settings.fields.unit'), field.limits?.unit ?? '', v => changeLimit('unit', v || undefined))}</div>}
        {field.type === 'multiselect' && num(tl('settings.fields.maximumSelections'), 'maxItems', field.limits?.maxItems)}
        {(field.type === 'select' || field.type === 'multiselect') && <fieldset disabled={locked} className="space-y-2"><legend className="mb-2 text-sm font-semibold text-fg">{tl('settings.fields.options')}</legend>
          {(field.options ?? []).map((o, i) => <div key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
            {txt(tl('agentHub.col.code'), o.code, code => change({ options: field.options!.map((x, n) => n === i ? { ...x, code } : x) }), locked || !!stored?.options?.some(x => x.code === o.code))}
            {txt(tl('settings.fields.optionLabel'), o.label, label => change({ options: field.options!.map((x, n) => n === i ? { ...x, label } : x) }))}
            <label className="flex flex-col gap-1 text-xs text-fg-secondary">{tl('settings.fields.color')}<select aria-label={tl('settings.fields.color')} className="app-input" value={o.color ?? ''} onChange={e => change({ options: field.options!.map((x, n) => { if (n !== i) return x; const next = { ...x }; if (!e.target.value) delete next.color; else next.color = e.target.value as VocabColor; return next }) })}><option value="">{tl('settings.fields.default')}</option>{VOCAB_COLORS.map(c => <option key={c} value={c}>{({ done: tl('settings.vocab.color.done'), brand: tl('settings.vocab.color.brand'), progress: tl('settings.vocab.color.progress'), delayed: tl('settings.vocab.color.delayed'), accent: tl('pages.uiStates.accent.purple'), pending: tl('pages.uiStates.accent.orange'), neutral: tl('settings.vocab.color.neutral') })[c]}</option>)}</select></label>
            <label className="flex items-center gap-2 text-sm text-fg"><input type="checkbox" checked={o.active} onChange={e => change({ options: field.options!.map((x, n) => n === i ? { ...x, active: e.target.checked } : x) })} />{tl('settings.fields.activeOption')}</label>
            <div className="flex gap-3"><button type="button" className="btn" disabled={i === 0} aria-label={`${o.label} ${tl('settings.fields.optionUp')}`} onClick={() => { const options = [...field.options!]; [options[i - 1], options[i]] = [options[i], options[i - 1]]; change({ options: options.map((x, n) => ({ ...x, sort: n })) }) }}>↑</button>
              <button type="button" className="btn" onClick={() => change({ options: field.options!.filter((_, n) => n !== i) })}>{tl('settings.fields.removeOption')}</button></div>
          </div>)}
          <button type="button" className="btn" disabled={(field.options?.length ?? 0) >= 100} onClick={() => { let n = 1; while (field.options?.some(o => o.code === `option_${n}`)) n++; change({ options: [...field.options!, { code: `option_${n}`, label: tl('settings.fields.option').replace('{n}', String(n)), sort: field.options!.length, active: true }] }) }}>{tl('settings.fields.addOption')}</button>
        </fieldset>}
        <div className="space-y-2"><CustomFieldInput def={field} value={field.default} label={tl('settings.fields.defaultValue')} disabled={locked} onChange={changeDefault} />
          <button type="button" className="btn" disabled={locked || field.default === undefined} onClick={() => changeDefault(undefined)}>{tl('settings.fields.clearDefault')}</button>
        </div>
        <p className="text-xs text-fg-secondary">{loadingUsage ? tl('settings.fields.loadingUsage') : count === null ? tl('settings.fields.usageUnavailable') : tl('settings.fields.rowsWithAValueMissing').replace('{total}', String(usage!.total)).replace('{count}', String(count)).replace('{missing}', String(missing))}</p>
        {selectionRequiredBlocked && <p className="text-xs text-fg-secondary">{tl('settings.fields.saveTheFieldThenFill')}</p>}
        {stored && <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" disabled={locked || dirty || stored.required || stored.default === undefined || validateCustomValue(stored, stored.default) !== null || missing === null}
            onClick={() => { if (stored.default !== undefined) execute({ kind: 'backfill', input: { expectedRevision: baseRevision, commandId: newUuid(), key: stored.key, value: stored.default } }) }}>{tl('settings.fields.fillMissingValuesAndMake')}</button>
          <button type="button" className="btn" disabled={locked || dirty || count === null || loadingUsage} onClick={() => { setPurgeOpen(true); setPurgeCount('') }}>{tl('settings.fields.deleteFieldAndValues')}</button>
        </div>}
        {!stored && <button type="button" className="btn" disabled={locked} onClick={() => { setDraft(ds => ds.filter((_, i) => i !== selected)); setOrigins(xs => xs.filter((_, i) => i !== selected)); setSelected(0) }}>{tl('settings.fields.discardNewField')}</button>}
        {purgeOpen && count !== null && stored && <div role="group" aria-label={tl('settings.fields.confirmFieldDeletion')} className="space-y-3 rounded-lg border border-danger/30 p-4">
          <p className="text-sm text-danger">{tl('settings.fields.deleteAndValuesEnterThe').replace('{label}', String(stored.label)).replace('{count}', String(count))}</p>
          {txt(tl('settings.fields.valueCountToDelete'), purgeCount, setPurgeCount)}
          <button type="button" className="btn" disabled={locked || dirty || loadingUsage || purgeCount !== String(count)} onClick={() => execute({ kind: 'purge', input: { expectedRevision: baseRevision, commandId: newUuid(), key: stored.key, expectedCount: count } })}>{tl('settings.fields.permanentlyDeleteField')}</button>
          <button type="button" className="btn" disabled={pending || !!bulk} onClick={() => setPurgeOpen(false)}>{tl('wsAccounts.remove.cancel')}</button>
        </div>}
      </div> : <p className="text-sm text-fg-secondary">{tl('settings.fields.noCustomFields')}</p>}
    </div>
    {!parsed.ok && <p role="alert" className="text-sm text-danger">{parsed.error}</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}{notice && <p role="status" className="text-sm text-success">{notice}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={!canEdit || pending || !!bulk || (!uncertain && (!dirty || !parsed.ok))} onClick={save}>{uncertain ? tl('settings.workflow.retry') : tl('settings.fields.saveFieldSettings')}</button>
      {bulk && <button type="button" className="btn" disabled={pending} onClick={() => execute(bulk)}>{tl('settings.fields.confirmOrRetryBulkChange')}</button>}
      {dirty && !uncertain && !bulk && <button type="button" className="btn" disabled={pending} onClick={() => { setDraft(baseline); setOrigins(baseline.map(d => d.key)); setSelected(0); setError(''); setPurgeOpen(false) }}>{tl('settings.fields.discardChanges')}</button>}
    </div>
  </div>
}
