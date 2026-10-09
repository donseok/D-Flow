'use client'
import { useId } from 'react'
import type { FieldDef, FieldValue } from '@/lib/domain/customFields'
import { useLocale } from '@/components/providers/LocaleProvider'
import { t as translate, type DictKey, type Locale } from '@/lib/i18n/dict'

/** Seven typed controls, shared by field defaults and row editors. Absence stays distinct from false/0. */
export function CustomFieldInput({ def, value, onChange, disabled = false, label, emptyLabel, locale = 'ko' }: {
  def: FieldDef; value: FieldValue | undefined; onChange: (value: FieldValue | undefined) => void
  disabled?: boolean; label?: string; emptyLabel?: string; locale?: Locale
}) {
  useLocale()   // 영어 사전이 늦게 실리면 다시 그리게 구독만 한다 — 글자는 넘겨받은 locale 을 따른다
  const id = useId()
  const tr = (k: DictKey) => translate(locale, k)
  const name = label ?? def.label
  const options = [...(def.options ?? [])].sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))
  if (def.type === 'multiselect') return <fieldset disabled={disabled} className="space-y-2">
    <legend className="text-xs text-fg-secondary">{name}</legend>
    {options.map(o => <label key={o.code} className="flex items-center gap-2 text-sm text-fg">
      <input type="checkbox" checked={Array.isArray(value) && value.includes(o.code)} disabled={!o.active && !(Array.isArray(value) && value.includes(o.code))}
        onChange={e => onChange(e.target.checked ? [...(Array.isArray(value) ? value : []), o.code] : (Array.isArray(value) ? value : []).filter(c => c !== o.code))} />
      {o.label}{!o.active && <span className="text-xs text-fg-muted">{tr('fields.inactive')}</span>}
    </label>)}
  </fieldset>
  return <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-xs text-fg-secondary">{name}
    {def.type === 'boolean' ? <select aria-label={name} id={id} className="app-input" disabled={disabled} value={value === undefined ? '' : String(value)}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
      <option value="">{emptyLabel ?? (tr('wbs.custom.unset'))}</option><option value="true">{tr('wbs.custom.yes')}</option><option value="false">{tr('wbs.custom.no')}</option>
    </select> : def.type === 'select' ? <select aria-label={name} id={id} className="app-input" disabled={disabled} value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value || undefined)}>
      <option value="">{emptyLabel ?? (tr('wbs.custom.unset'))}</option>{options.map(o => <option key={o.code} value={o.code} disabled={!o.active}>{o.label}{!o.active ? tr('fields.inactiveSuffix') : ''}</option>)}
    </select> : def.type === 'multiline' ? <textarea aria-label={name} id={id} className="app-input min-h-24" disabled={disabled} value={typeof value === 'string' ? value : ''}
      onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} />
      : <input aria-label={name} id={id} className="app-input" disabled={disabled} type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : 'text'}
        {...(def.type === 'number' ? { min: def.limits?.min, max: def.limits?.max, step: 10 ** -(def.limits?.decimals ?? 0) } : {})}
        value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        onChange={e => onChange(e.target.value === '' ? undefined : def.type === 'number' ? Number(e.target.value) : e.target.value)} />}
  </label>
}
