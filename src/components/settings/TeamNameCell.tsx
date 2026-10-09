'use client'
// 팀 이름 칸(SP4 D37·D52, 계획 P8) — 표시 이름 + 연필 버튼 → 그 행 안 입력(Enter 저장·Esc 취소). 긴 이름은 줄이고 title 로 전부 보인다.
// 코드는 바뀌지 않는다(엑셀·필터·봇이 쓰는 식별자) — 표의 코드 열(관리 화면)이 따로 보인다. 화면은 공백만 거르고 길이·예약어·겹침은 서버 문구를 그 칸 아래 role="alert" 로 보인다.
// 입력에 maxLength 를 두지 않는다 — 40자를 넘는 붙여넣기가 조용히 잘린 채 저장되지 않고 서버의 길이 문구로 거부되게(B-2 리뷰 P3. 서버는
// NFKC 뒤 코드 포인트로 센다 — 화면이 UTF-16 으로 따로 세면 두 기준이 어긋난다).
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'

export function TeamNameCell({ team, disabled, onRename }: {
  team: { id: string; code: string; name: string }
  disabled: boolean
  onRename: (name: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const { t } = useLocale()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(team.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)          // 렌더 전에 같은 틱으로 두 번 오는 Enter·클릭의 재진입 가드(state 는 다음 렌더에야 보인다)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef(false)
  const errorId = useId()

  // 편집이 끝나면(저장·취소) 포커스를 그 행의 연필 버튼으로 돌린다 — 입력이 사라져 body 로 떨어지지 않게
  useEffect(() => {
    if (!editing && returnFocus.current) { returnFocus.current = false; triggerRef.current?.focus() }
  }, [editing])
  const finish = () => { returnFocus.current = true; setEditing(false) }

  async function save() {
    if (savingRef.current) return
    const name = value.trim()
    if (!name) { setError(t('settings.teamName.required')); return }
    savingRef.current = true; setSaving(true); setError(null)
    try {
      const r = await onRename(name)
      // 거부되면 고쳐 입력하도록 입력에 포커스를 둔다 — 저장 버튼으로 저장했다면 꺼진 버튼에 남은 포커스를 데려온다(B-4 리뷰 I2)
      if (!r.ok) { setError(r.error ?? t('settings.teamName.failed')); inputRef.current?.focus(); return }
      finish()
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <span className="max-w-[16rem] truncate font-medium text-fg" title={team.name}>{team.name}</span>
        <button ref={triggerRef} type="button" className="btn btn-ghost btn-sm" disabled={disabled} data-team-rename={team.id}
          aria-label={t('settings.teamName.rename').replace('{name}', String(team.name))} onClick={() => { setValue(team.name); setError(null); setEditing(true) }}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {/* 저장 중 잠금은 disabled 가 아니라 readOnly+aria-busy — disabled 는 포커스를 body 로 떨어뜨린다(focus fixup, B-4 리뷰 I2) */}
        <input ref={inputRef} data-team-rename-input className="app-input w-40" value={value} autoFocus readOnly={saving}
          aria-busy={saving || undefined} aria-label={t('settings.teamName.newName').replace('{code}', String(team.code))} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합을 끝내는 Enter 는 저장이 아니다(브라우저에 따라 keydown 이 두 번 온다 — Safari 는 keyCode 229)
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape' && !savingRef.current) finish()   // 저장 중 Esc 는 무시 — 응답이 닫힌 칸에 떨어지지 않게
          }} />
        <button type="button" className="btn btn-primary btn-sm" data-team-rename-save disabled={saving} onClick={() => void save()} aria-label={t('settings.teamName.save')}>
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={finish} aria-label={t('common.cancel')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p id={errorId} role="alert" className="text-meta text-danger">{error}</p>}
    </div>
  )
}
