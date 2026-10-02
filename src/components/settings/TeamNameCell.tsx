'use client'
// 팀 이름 칸(SP4 D37·D52, 계획 P8) — 표시 이름 + (이름이 코드와 다르면) 코드 보조 글씨 + 연필 버튼 → 그 행 안 입력(Enter 저장·Esc 취소).
// 코드는 바뀌지 않는다(엑셀·필터·봇이 쓰는 식별자). 화면은 공백만 거르고 길이·예약어·겹침은 서버 문구를 그 칸 아래 role="alert" 로 보인다.
// 입력에 maxLength 를 두지 않는다 — 40자를 넘는 붙여넣기가 조용히 잘린 채 저장되지 않고 서버의 길이 문구로 거부되게(B-2 리뷰 P3. 서버는
// NFKC 뒤 코드 포인트로 센다 — 화면이 UTF-16 으로 따로 세면 두 기준이 어긋난다).
import { useEffect, useId, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'

export function TeamNameCell({ team, disabled, onRename, chip }: {
  team: { id: string; code: string; name: string }
  disabled: boolean
  onRename: (name: string) => Promise<{ ok: boolean; error?: string }>
  /** 팀 색 견본(#15 — teamSlot(row).chip). 없으면 코드를 칩 없이 쓴다 */
  chip?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(team.name)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)          // 렌더 전에 같은 틱으로 두 번 오는 Enter·클릭의 재진입 가드(state 는 다음 렌더에야 보인다)
  const triggerRef = useRef<HTMLButtonElement>(null)
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
    if (!name) { setError('팀 이름을 입력하세요.'); return }
    savingRef.current = true; setSaving(true); setError(null)
    try {
      const r = await onRename(name)
      if (!r.ok) { setError(r.error ?? '이름을 바꾸지 못했습니다.'); return }
      finish()
    } finally {
      savingRef.current = false; setSaving(false)
    }
  }
  const codeLabel = chip ? <span className={`chip ${chip}`}>{team.code}</span> : <span className="text-meta text-fg-muted">{team.code}</span>

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {chip && codeLabel}
        <span className="font-medium text-fg">{team.name}</span>
        {!chip && team.name !== team.code && codeLabel}
        <button ref={triggerRef} type="button" className="btn btn-ghost btn-sm" disabled={disabled} data-team-rename={team.id}
          aria-label={`${team.name} 이름 바꾸기`} onClick={() => { setValue(team.name); setError(null); setEditing(true) }}>
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        {chip && codeLabel}
        <input data-team-rename-input className="app-input w-40" value={value} autoFocus disabled={saving}
          aria-label={`${team.code} 팀 새 이름`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 한글 IME 조합을 끝내는 Enter 는 저장이 아니다(브라우저에 따라 keydown 이 두 번 온다 — Safari 는 keyCode 229)
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') finish()
          }} />
        <button type="button" className="btn btn-primary btn-sm" data-team-rename-save disabled={saving} onClick={() => void save()} aria-label="이름 저장">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={finish} aria-label="취소">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p id={errorId} role="alert" className="text-meta text-danger">{error}</p>}
    </div>
  )
}
