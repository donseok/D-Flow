'use client'
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { saveCustomFieldValues } from '@/app/actions/customFieldValues'
import { formatCustomValue, orderedFields, type CustomValues, type FieldDef, type FieldEntity, type FieldValue } from '@/lib/domain/customFields'
import { parseCustomValues, validateCustomValues, type FieldRowError } from '@/lib/domain/customFieldValues'
import { useLocale } from '@/components/providers/LocaleProvider'
import { t as translate, type DictKey, type Locale } from '@/lib/i18n/dict'
import { CustomFieldInput } from './CustomFieldInput'

type Scope = { projectId: string; entity: FieldEntity; defs: FieldDef[] | null; canAdmin: boolean; locale: Locale }
const Context = createContext<Scope | null>(null)
export function CustomFieldsProvider({ children, ...scope }: Scope & { children: ReactNode }) {
  return <Context.Provider value={scope}>{children}</Context.Provider>
}
/** Read-only access to the surrounding field scope (null outside a provider), for list columns. */
export function useCustomFieldScope() { return useContext(Context) }
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k)
/** 필드 오류 코드 → 사용자 문구(상세 패널·시트 셀이 같이 쓴다) */
const FIELD_ERROR_KEY: Partial<Record<FieldRowError, DictKey>> = {
  required: 'fields.err.required', admin_only: 'fields.err.adminOnly', inactive: 'fields.err.inactive', inactive_option: 'fields.err.inactiveOption', unknown: 'fields.err.unknown',
}
export const customFieldErrorText = (code: FieldRowError, locale: Locale) => translate(locale, FIELD_ERROR_KEY[code] ?? 'fields.err.format')
export function CustomFieldValuesEditor({ rowId, values, canEdit }: { rowId: string; values: unknown; canEdit: boolean }) {
  useLocale()   // 영어 사전이 늦게 실리면 다시 그리게 구독만 한다 — 글자는 범위(scope)의 locale 을 따른다
  const scope = useContext(Context)
  if (!scope) return null
  const tr = (k: DictKey) => translate(scope.locale, k)
  if (!scope.defs) return <p role="alert" className="text-sm text-danger">{tr('fields.defsInvalid')}</p>
  if (!scope.defs.length) return null
  const parsed = parseCustomValues(values)
  if (!parsed.ok) return <p role="alert" className="text-sm text-danger">{tr('fields.valuesInvalid')}</p>
  return <Editor key={rowId} scope={scope as Scope & { defs: FieldDef[] }} rowId={rowId} values={parsed.value} canEdit={canEdit} />
}
function Editor({ scope, rowId, values, canEdit }: { scope: Scope & { defs: FieldDef[] }; rowId: string; values: CustomValues; canEdit: boolean }) {
  useLocale()   // 위와 같다(구독만)
  const router = useRouter()
  const tr = (k: DictKey) => translate(scope.locale, k)
  const [base, setBase] = useState(values)
  const [draft, setDraft] = useState(values)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, FieldRowError>>({})
  const [stale, setStale] = useState(false)
  const signature = JSON.stringify(values)
  const seen = useRef(signature)
  const dirty = JSON.stringify(base) !== JSON.stringify(draft)
  // Only a new server snapshot can replace a pristine form. A successful local save must not adopt old props again.
  useEffect(() => {
    if (seen.current === signature) return
    seen.current = signature
    if (dirty || pending) setStale(JSON.stringify(base) !== signature)
    else { setBase(values); setDraft(values); setStale(false); setErrors({}) }
  }, [signature, values, dirty, pending, base])
  const fields = orderedFields(scope.defs).filter(d => d.active || own(draft, d.key))
  const editable = (def: FieldDef) => canEdit && def.active && (def.editable_by !== 'admin' || scope.canAdmin)
  const change = (key: string, v: FieldValue | undefined) => {
    setDraft(prev => { const next = { ...prev }; if (v === undefined) delete next[key]; else next[key] = v; return next })
    setErrors({}); setMessage(null)
  }
  const reset = () => { setBase(values); setDraft(values); setStale(false); setErrors({}); setMessage(null) }
  const save = () => {
    if (!dirty || pending || !canEdit) return
    const checked = validateCustomValues(scope.defs, draft, base, scope.canAdmin)
    if (!checked.ok) { setErrors(checked.errors); setMessage(tr('fields.checkInput')); return }
    startTransition(async () => {
      try {
        const result = await saveCustomFieldValues(scope.projectId, scope.entity, rowId, base, checked.value)
        if (!result.ok) {
          setMessage(result.error); setErrors(result.fieldErrors ?? {})
          if (result.code === 'FIELD_CONFLICT') { setStale(true); router.refresh() }
          return
        }
        setBase(result.values); setDraft(result.values); setErrors({}); setStale(false)
        setMessage(tr('fields.saved')); router.refresh()
      } catch { setMessage(tr('fields.saveUnknown')); router.refresh() }
    })
  }
  if (!fields.length) return null
  return <section aria-label={tr('fields.title')} className="space-y-3 border-t border-border pt-4">
    <h3 className="text-xs font-semibold text-fg-secondary">{tr('fields.title')}</h3>
    {fields.map(def => <div key={def.key} className="min-w-0 space-y-1">
      {editable(def) ? <CustomFieldInput def={def} value={draft[def.key]} label={`${def.label}${def.required ? ' *' : ''}`} locale={scope.locale} disabled={pending} onChange={v => change(def.key, v)} />
        : <><p className="text-xs text-fg-secondary">{def.label}{!def.active ? tr('fields.inactiveSuffix') : ''}{def.editable_by === 'admin' && !scope.canAdmin ? tr('fields.adminOnlySuffix') : ''}</p>
          <p className="whitespace-pre-wrap break-words text-sm text-fg">{formatCustomValue(def, draft[def.key], { locale: scope.locale, yes: tr('wbs.custom.yes'), no: tr('wbs.custom.no'), empty: '—' })}</p></>}
      {def.description && <p className="whitespace-pre-wrap break-words text-xs text-fg-muted">{def.description}</p>}
      {errors[def.key] && <p role="alert" className="text-xs text-danger">{def.label}: {customFieldErrorText(errors[def.key], scope.locale)}</p>}
    </div>)}
    {stale && <p role="alert" className="text-xs text-danger">{tr('fields.stale')}</p>}
    {message && <p role="status" className="text-xs text-fg-secondary">{message}</p>}
    {fields.some(editable) && <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary h-8 px-3 text-xs" disabled={!dirty || pending || stale} onClick={save}>{pending ? tr('fields.saving') : tr('fields.save')}</button>
      <button type="button" className="btn btn-ghost h-8 px-3 text-xs" disabled={pending || (!dirty && !stale)} onClick={reset}>{tr('common.cancel')}</button>
      <button type="button" className="btn btn-ghost h-8 px-3 text-xs" disabled={pending} onClick={() => router.refresh()}>{tr('fields.reload')}</button>
    </div>}
  </section>
}
