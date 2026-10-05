'use client'
import { CustomFieldInput } from './CustomFieldInput'
import { formatCustomValue, orderedFields, type CustomValues, type FieldDef, type FieldValue } from '@/lib/domain/customFields'
import type { FieldRowError } from '@/lib/domain/customFieldValues'
import type { Locale } from '@/lib/i18n/dict'
/** Controlled fields for a parent form's single atomic row save. */
export function CustomFieldDraft({ defs, values, base, canAdmin, creating, disabled, locale, errors, onChange }: {
  defs: FieldDef[]; values: CustomValues; base: CustomValues; canAdmin: boolean; creating: boolean; disabled: boolean; locale: Locale
  errors: Record<string, FieldRowError>; onChange: (key: string, value: FieldValue | undefined) => void
}) {
  const ko = locale === 'ko'
  const fields = orderedFields(defs).filter(d => d.active || Object.hasOwn(values,d.key) || Object.hasOwn(base,d.key))
  if (!fields.length) return null
  return <section aria-label={ko ? '추가 정보' : 'Custom fields'} className="space-y-3 border-t border-line pt-3">
    <h3 className="text-xs font-semibold text-ink-muted">{ko ? '추가 정보' : 'Custom fields'}</h3>
    {fields.map(d => <div key={d.key} className="space-y-1">
      {d.active && (d.editable_by !== 'admin' || canAdmin)
        ? <CustomFieldInput def={d} value={values[d.key]} label={`${d.label}${d.required ? ' *' : ''}`} locale={locale} disabled={disabled} onChange={v => onChange(d.key,v)} />
        : <><p className="text-xs text-ink-muted">{d.label}{!d.active ? ko ? ' (비활성)' : ' (inactive)' : ko ? ' (관리자 전용)' : ' (admin only)'}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{formatCustomValue(d, creating && d.required ? d.default : base[d.key], { locale, yes: ko ? '예' : 'Yes', no: ko ? '아니오' : 'No', empty: '—' })}</p></>}
      {d.description && <p className="whitespace-pre-wrap break-words text-xs text-ink-subtle">{d.description}</p>}
      {errors[d.key] && <p role="alert" className="text-xs text-delayed">{d.label}: {errors[d.key] === 'required' ? ko ? '필수 값을 입력하세요.' : 'A value is required.' : ko ? '값과 편집 권한을 확인하세요.' : 'Check the value and editing permission.'}</p>}
    </div>)}
  </section>
}
