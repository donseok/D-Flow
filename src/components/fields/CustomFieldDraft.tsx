'use client'
import { CustomFieldInput } from './CustomFieldInput'
import { formatCustomValue, orderedFields, type CustomValues, type FieldDef, type FieldValue } from '@/lib/domain/customFields'
import type { FieldRowError } from '@/lib/domain/customFieldValues'
import { useLocale } from '@/components/providers/LocaleProvider'
import { t as translate, type DictKey, type Locale } from '@/lib/i18n/dict'
/** Controlled fields for a parent form's single atomic row save. */
export function CustomFieldDraft({ defs, values, base, canAdmin, creating, disabled, locale, errors, onChange }: {
  defs: FieldDef[]; values: CustomValues; base: CustomValues; canAdmin: boolean; creating: boolean; disabled: boolean; locale: Locale
  errors: Record<string, FieldRowError>; onChange: (key: string, value: FieldValue | undefined) => void
}) {
  useLocale()   // 영어 사전이 늦게 실리면 다시 그리게 구독만 한다 — 글자는 넘겨받은 locale 을 따른다
  const tr = (k: DictKey) => translate(locale, k)
  const fields = orderedFields(defs).filter(d => d.active || Object.hasOwn(values,d.key) || Object.hasOwn(base,d.key))
  if (!fields.length) return null
  return <section aria-label={tr('fields.title')} className="space-y-3 border-t border-border pt-3">
    <h3 className="text-xs font-semibold text-fg-secondary">{tr('fields.title')}</h3>
    {fields.map(d => <div key={d.key} className="space-y-1">
      {d.active && (d.editable_by !== 'admin' || canAdmin)
        ? <CustomFieldInput def={d} value={values[d.key]} label={`${d.label}${d.required ? ' *' : ''}`} locale={locale} disabled={disabled} onChange={v => onChange(d.key,v)} />
        : <><p className="text-xs text-fg-secondary">{d.label}{!d.active ? tr('fields.inactiveSuffix') : tr('fields.adminOnlySuffix')}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{formatCustomValue(d, creating && d.required ? d.default : base[d.key], { locale, yes: tr('wbs.custom.yes'), no: tr('wbs.custom.no'), empty: '—' })}</p></>}
      {d.description && <p className="whitespace-pre-wrap break-words text-xs text-fg-muted">{d.description}</p>}
      {errors[d.key] && <p role="alert" className="text-xs text-danger">{d.label}: {errors[d.key] === 'required' ? tr('fields.err.required') : tr('fields.err.checkValue')}</p>}
    </div>)}
  </section>
}
