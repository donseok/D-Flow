'use client'
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { saveCustomFieldValues } from '@/app/actions/customFieldValues'
import { formatCustomValue, orderedFields, type CustomValues, type FieldDef, type FieldEntity, type FieldValue } from '@/lib/domain/customFields'
import { parseCustomValues, validateCustomValues, type FieldRowError } from '@/lib/domain/customFieldValues'
import type { Locale } from '@/lib/i18n/dict'
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
export const customFieldErrorText = (code: FieldRowError, ko: boolean) => {
  const messages: Partial<Record<FieldRowError, [string, string]>> = {
    required: ['필수 값을 입력하세요.', 'A value is required.'], admin_only: ['관리자만 편집할 수 있습니다.', 'Only administrators can edit this field.'],
    inactive: ['비활성 필드는 변경할 수 없습니다.', 'Inactive fields cannot be changed.'], inactive_option: ['새 비활성 옵션은 선택할 수 없습니다.', 'New inactive options cannot be selected.'],
    unknown: ['필드 설정이 변경되었습니다.', 'Field definitions have changed.'],
  }
  return messages[code]?.[ko ? 0 : 1] ?? (ko ? '필드의 형식·허용값·제한을 확인하세요.' : 'Check the field type, allowed values and limits.')
}
export function CustomFieldValuesEditor({ rowId, values, canEdit }: { rowId: string; values: unknown; canEdit: boolean }) {
  const scope = useContext(Context)
  if (!scope) return null
  const ko = scope.locale === 'ko'
  if (!scope.defs) return <p role="alert" className="text-sm text-delayed">{ko ? '추가 정보 설정을 읽을 수 없습니다. 설정을 확인하세요.' : 'Custom field settings are invalid. Check project settings.'}</p>
  if (!scope.defs.length) return null
  const parsed = parseCustomValues(values)
  if (!parsed.ok) return <p role="alert" className="text-sm text-delayed">{ko ? '추가 정보를 읽을 수 없습니다. 행을 새로 조회하세요.' : 'Custom values could not be read. Reload the row.'}</p>
  return <Editor key={rowId} scope={scope as Scope & { defs: FieldDef[] }} rowId={rowId} values={parsed.value} canEdit={canEdit} />
}
function Editor({ scope, rowId, values, canEdit }: { scope: Scope & { defs: FieldDef[] }; rowId: string; values: CustomValues; canEdit: boolean }) {
  const router = useRouter()
  const ko = scope.locale === 'ko'
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
    if (!checked.ok) { setErrors(checked.errors); setMessage(ko ? '입력값을 확인하세요.' : 'Check the input values.'); return }
    startTransition(async () => {
      try {
        const result = await saveCustomFieldValues(scope.projectId, scope.entity, rowId, base, checked.value)
        if (!result.ok) {
          setMessage(result.error); setErrors(result.fieldErrors ?? {})
          if (result.code === 'FIELD_CONFLICT') { setStale(true); router.refresh() }
          return
        }
        setBase(result.values); setDraft(result.values); setErrors({}); setStale(false)
        setMessage(ko ? '추가 정보를 저장했습니다.' : 'Custom values saved.'); router.refresh()
      } catch { setMessage(ko ? '저장 응답을 확인하지 못했습니다. 최신 행을 조회해 확인하세요.' : 'The save response is unknown. Reload the row to verify.'); router.refresh() }
    })
  }
  if (!fields.length) return null
  return <section aria-label={ko ? '추가 정보' : 'Custom fields'} className="space-y-3 border-t border-line pt-4">
    <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{ko ? '추가 정보' : 'Custom fields'}</h3>
    {fields.map(def => <div key={def.key} className="min-w-0 space-y-1">
      {editable(def) ? <CustomFieldInput def={def} value={draft[def.key]} label={`${def.label}${def.required ? ' *' : ''}`} locale={scope.locale} disabled={pending} onChange={v => change(def.key, v)} />
        : <><p className="text-xs text-ink-muted">{def.label}{!def.active ? ko ? ' (비활성)' : ' (inactive)' : ''}{def.editable_by === 'admin' && !scope.canAdmin ? ko ? ' (관리자 전용)' : ' (admin only)' : ''}</p>
          <p className="whitespace-pre-wrap break-words text-sm text-ink">{formatCustomValue(def, draft[def.key], { locale: scope.locale, yes: ko ? '예' : 'Yes', no: ko ? '아니오' : 'No', empty: '—' })}</p></>}
      {def.description && <p className="whitespace-pre-wrap break-words text-xs text-ink-subtle">{def.description}</p>}
      {errors[def.key] && <p role="alert" className="text-xs text-delayed">{def.label}: {customFieldErrorText(errors[def.key], ko)}</p>}
    </div>)}
    {stale && <p role="alert" className="text-xs text-delayed">{ko ? '행이 변경되었습니다. 작성 중인 값은 유지됩니다. 취소하면 최신 조회 값을 불러옵니다.' : 'The row changed. Your draft is preserved. Cancel to use the latest snapshot.'}</p>}
    {message && <p role="status" className="text-xs text-ink-muted">{message}</p>}
    {fields.some(editable) && <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary h-8 px-3 text-xs" disabled={!dirty || pending || stale} onClick={save}>{pending ? ko ? '저장 중…' : 'Saving…' : ko ? '추가 정보 저장' : 'Save custom fields'}</button>
      <button type="button" className="btn btn-ghost h-8 px-3 text-xs" disabled={pending || (!dirty && !stale)} onClick={reset}>{ko ? '취소' : 'Cancel'}</button>
      <button type="button" className="btn btn-ghost h-8 px-3 text-xs" disabled={pending} onClick={() => router.refresh()}>{ko ? '최신 값 조회' : 'Reload values'}</button>
    </div>}
  </section>
}
