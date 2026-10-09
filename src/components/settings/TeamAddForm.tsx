'use client'
// 팀 추가 입력(공용 팀·프로젝트 팀 관리 화면 공용) — 이름(필수)과 코드(선택)를 따로 받는다. 예전에는 한 칸이 이름이자 코드라 이름의
// 오타가 바꿀 수 없는 코드로 남았다. 코드를 비우면 이름에서 만든 기본값(defaultTeamCode — 액션이 저장하는 그 함수)을 아래 줄에 미리 보인다.
// 길이·예약어·겹침 판정은 서버가 한다(화면은 공백만 거른다 — TeamNameCell 과 같은 분담). 값은 부모가 든다(성공하면 부모가 비운다).
import { Plus } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { defaultTeamCode } from '@/lib/domain/teamName'

export interface TeamDraft { name: string; code: string }
export const EMPTY_TEAM_DRAFT: TeamDraft = { name: '', code: '' }

export function TeamAddForm({ value, onChange, onSubmit, pending, onCancel, autoFocus = false }: {
  value: TeamDraft
  onChange: (next: TeamDraft) => void
  onSubmit: () => void
  pending: boolean
  onCancel?: () => void
  autoFocus?: boolean
}) {
  const { t } = useLocale()
  const preview = value.code.trim() || defaultTeamCode(value.name)
  const submitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // 한글 IME 조합을 끝내는 Enter 는 제출이 아니다(TeamNameCell 과 같은 가드)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter') onSubmit()
  }
  return (
    <div data-team-add className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-secondary">
          {t('settings.teams.nameLabel')}
          <input data-team-add-name value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} onKeyDown={submitOnEnter}
            placeholder={t('settings.teams.namePlaceholder')} className="app-input w-44 max-w-full" disabled={pending} autoFocus={autoFocus} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-meta font-medium text-fg-secondary">
          {t('settings.teams.codeLabel')}
          <input data-team-add-code value={value.code} onChange={e => onChange({ ...value, code: e.target.value })} onKeyDown={submitOnEnter}
            placeholder={defaultTeamCode(value.name) || t('settings.teams.codePlaceholder')} maxLength={20}
            className="app-input w-36 max-w-full font-mono" disabled={pending} />
        </label>
        <button type="button" onClick={onSubmit} className="btn btn-primary" disabled={pending}>
          <Plus className="h-4 w-4" />{t('settings.teams.add')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn btn-ghost" disabled={pending}>{t('settings.teams.cancel')}</button>
        )}
      </div>
      <p data-team-add-hint className="max-w-prose break-words text-meta text-fg-muted">
        {preview ? t('settings.teams.codePreview').replace('{code}', preview) : t('settings.teams.codeHint')}
      </p>
    </div>
  )
}
