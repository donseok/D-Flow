'use client'
// 팀 이름 칸(SP4 D37·D52, 계획 P8) — 표시 이름 + (이름이 코드와 다르면) 코드 보조 글씨 + 연필 버튼 → 그 행 안 입력(Enter 저장·Esc 취소).
// 코드는 바뀌지 않는다(엑셀·필터·봇이 쓰는 식별자). 화면은 공백만 거르고 길이·예약어·겹침은 서버 문구를 그 칸 아래 role="alert" 로 보인다.
import { useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'

const TEAM_NAME_INPUT_MAX = 40   // 서버 규칙(TEAM_NAME_MAX)과 같은 길이 — 판정은 서버가 한다

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

  async function save() {
    const name = value.trim()
    if (!name) { setError('팀 이름을 입력하세요.'); return }
    setSaving(true); setError(null)
    const r = await onRename(name)
    setSaving(false)
    if (!r.ok) { setError(r.error ?? '이름을 바꾸지 못했습니다.'); return }
    setEditing(false)
  }
  const codeLabel = chip ? <span className={`chip ${chip}`}>{team.code}</span> : <span className="text-meta text-fg-muted">{team.code}</span>

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {chip && codeLabel}
        <span className="font-medium text-fg">{team.name}</span>
        {!chip && team.name !== team.code && codeLabel}
        <button type="button" className="btn btn-ghost btn-sm" disabled={disabled} data-team-rename={team.id}
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
        <input data-team-rename-input className="app-input w-40" value={value} maxLength={TEAM_NAME_INPUT_MAX} autoFocus disabled={saving}
          aria-label={`${team.code} 팀 새 이름`} onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') setEditing(false) }} />
        <button type="button" className="btn btn-primary btn-sm" data-team-rename-save disabled={saving} onClick={() => void save()} aria-label="이름 저장">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setEditing(false)} aria-label="취소">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p role="alert" className="text-meta text-danger">{error}</p>}
    </div>
  )
}
