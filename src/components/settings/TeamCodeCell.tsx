'use client'
// 팀 코드 칸(팀 유연화 2단계) — 코드 + 연필 버튼 → 확인 모달(새 코드 입력 + 옛 엑셀 파일 경고). 공용 팀·프로젝트 팀 관리 화면이 같이 쓴다.
// 코드는 엑셀 팀 열·가져오기·필터가 쓰는 식별자라 바꾸면 이미 내보낸 파일과 어긋난다 — 그래서 이름처럼 그 자리에서 바로 고치지 않고
// 한 번 멈춰 알린 뒤 바꾼다. 화면은 빈 값·같은 값만 거르고 길이·예약어·겹침은 서버 문구를 입력 아래 role="alert" 로 보인다(TeamNameCell 과 같은 분담).
import { useId, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'

export function TeamCodeCell({ team, disabled, onChange }: {
  team: { id: string; code: string; name: string }
  disabled: boolean
  /** 성공하면 부모가 알림·새로고침을 한다. 실패 문구는 이 모달이 보인다 */
  onChange: (code: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(team.code)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)          // 같은 틱의 Enter·클릭 재진입 가드(state 는 다음 렌더에야 보인다)
  const inputRef = useRef<HTMLInputElement>(null)
  const errorId = useId()
  const warnId = useId()

  const close = () => { if (!savingRef.current) setOpen(false) }

  async function save() {
    if (savingRef.current) return
    const code = value.trim()
    if (!code) { setError(t('settings.teams.codeEmpty')); inputRef.current?.focus(); return }
    if (code === team.code) { setError(t('settings.teams.codeSame')); inputRef.current?.focus(); return }
    savingRef.current = true; setSaving(true); setError(null)
    try {
      const r = await onChange(code)
      if (!r.ok) { setError(r.error ?? t('settings.teams.codeFailed')); inputRef.current?.focus(); return }
      setOpen(false)
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span data-team-code className="max-w-[12rem] truncate font-mono text-xs text-fg-secondary" title={`${t('settings.teams.codeTitle')}: ${team.code}`}>{team.code}</span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} data-team-code-edit={team.id}
        aria-label={t('settings.teams.codeEdit').replace('{name}', team.name)}
        onClick={() => { setValue(team.code); setError(null); setOpen(true) }}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <Modal open={open} onClose={close} title={t('settings.teams.codeDialogTitle')} size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={close}>{t('settings.teams.cancel')}</button>
            <button type="button" className="btn btn-primary" data-team-code-save disabled={saving} onClick={() => void save()}>
              {saving ? t('settings.teams.codeSaving') : t('settings.teams.codeSave')}
            </button>
          </>
        }>
        <div className="space-y-3">
          <p className="text-sm leading-6 text-fg-secondary">
            {t('settings.teams.codeDialogDesc').replace('{name}', team.name).replace('{code}', team.code)}
          </p>
          <label className="flex flex-col gap-1 text-sm font-medium text-fg">
            {t('settings.teams.codeNewLabel')}
            {/* 저장 중 잠금은 disabled 가 아니라 readOnly+aria-busy — disabled 는 포커스를 body 로 떨어뜨린다(TeamNameCell 과 같다) */}
            <input ref={inputRef} data-team-code-input className="app-input font-mono" value={value} autoFocus maxLength={20} readOnly={saving}
              aria-busy={saving || undefined} aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${warnId}` : warnId}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // 한글 IME 조합을 끝내는 Enter 는 저장이 아니다
                if (e.nativeEvent.isComposing || e.keyCode === 229) return
                if (e.key === 'Enter') void save()
              }} />
          </label>
          {error && <p id={errorId} role="alert" className="text-sm text-danger">{error}</p>}
          <p id={warnId} data-team-code-warn className="rounded-lg bg-warning-weak px-3 py-2 text-sm leading-6 text-fg">
            {t('settings.teams.codeDialogWarn')}
          </p>
        </div>
      </Modal>
    </div>
  )
}
