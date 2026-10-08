'use client'
import { useId } from 'react'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useLocale } from '@/components/providers/LocaleProvider'
import { areaLabel, activeIssueAreas, type IssueAreaRef } from '@/lib/domain/issueAreas'

export function IssueAreaSelect({ areas, value, onChange, required, disabled = false, canManage = false, projectId }: {
  areas: readonly IssueAreaRef[]; value: string; onChange: (value: string) => void
  required: boolean; disabled?: boolean; canManage?: boolean; projectId: string
}) {
  const id = useId()
  const { t } = useLocale()
  const active = activeIssueAreas(areas)
  const current = areas.find(a => a.id === value && !a.active)
  return <div className="space-y-2">
    <label htmlFor={id} className="block text-xs font-semibold text-fg-secondary">{t('issue.analysis.area')}{required ? ' *' : ''}</label>
    <select id={id} className="app-input" value={value} onChange={e => onChange(e.target.value)} required={required} aria-required={required} disabled={disabled} aria-describedby={disabled ? `${id}-locked` : undefined}>
      <option value="">{t('issue.analysis.areaPlaceholder')}</option>
      {active.map(a => <option key={a.id} value={a.id}>{areaLabel(a, a.id)}</option>)}
      {current && <option value={current.id} disabled>{areaLabel(current, current.id)} · {t('issue.analysis.areaInactive')}</option>}
    </select>
    {disabled && <p id={`${id}-locked`} className="text-xs text-fg-muted">{t('issue.analysis.areaLocked')}</p>}
    {required && !active.length && !disabled && !current && <StatusMessage kind="needs_setup" title={t('issue.analysis.noAreas')} detail={canManage ? undefined : t('issue.analysis.askAreaAdmin')} action={canManage ? { label: t('issue.analysis.addArea'), href: `/p/${projectId}/settings#project-team` } : undefined} />}
  </div>
}
