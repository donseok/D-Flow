'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { upsertRosterMember } from '@/app/actions/roster'
import type { RosterMember } from '@/lib/data/memberSelect'
import { isAdminAccessRole, type EffectiveRoleView, type ProjectActorView } from '@/lib/domain/authz'
import { canGrantAdmin, emptyDraft, ERR_DUPLICATE_EMAIL, findRosterByEmail, rosterDraftErrorText, validateDraft } from '@/lib/domain/roster'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'
import { RosterEditRow, RosterReadRow, ROSTER_COLUMNS } from './RosterRow'
import type { TeamOption } from './TeamMultiSelect'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

const ADMIN_ROW_LOCKED_KEY = 'roster.adminRowLocked' satisfies DictKey

/**
 * 명단 관리 — 행 = 사람(people), 한 사람에 여러 팀·대표 팀·역할 라벨·직함·권한(없음/멤버/관리자)·활성.
 * 권한과 명단은 한 행이다(0003) — 저장은 행마다 upsertRosterMember 한 번(RPC 한 트랜잭션).
 * 관리자 부여·회수는 워크스페이스 관리자 이상에게만 열린다(canGrantAdmin). 가드와 RPC 가 다시 판정한다.
 * canEdit=false(프로젝트 관리자 아님)면 같은 표를 읽기 전용으로 그린다.
 */
export function RosterManager({ projectId, rows, teamOptions, actorView, canEdit, effectiveRoles = {} }: {
  projectId: string
  rows: RosterMember[]
  effectiveRoles?: Record<string, EffectiveRoleView>
  /** 이 프로젝트에서 고를 수 있는 활성 팀(resolveTeamsForProject 규칙). */
  teamOptions: TeamOption[]
  actorView: ProjectActorView | null
  canEdit: boolean
}) {
  const router = useRouter()
  const { t: tr } = useLocale()
  const grantAdmin = canGrantAdmin(actorView)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<RosterMember | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  /** 방금 추가한 행과 입력한 이름 — 이메일이 워크스페이스의 기존 인물과 맞으면 그 인물(기존 이름)이 명단에 오른다. */
  const [added, setAdded] = useState<{ memberId: string; typedName: string } | null>(null)
  /** 같은 이름 경고를 한 번 본 이름 — 그 이름으로 다시 누르면 통과시킨다 */
  const [sameNameAck, setSameNameAck] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  useBotPageContext({ domain: 'members', projectId })

  function add(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null); setDuplicate(null); setAdded(null)
    const v = validateDraft({ ...emptyDraft(), name, email })
    if (!v.ok) { setAddError(rosterDraftErrorText(tr, v.error)); return }
    // 같은 이메일이 이미 명단에 있으면 RPC 는 그 사람의 행을 찾아 덮어쓴다 — 새 사람으로 오해하지 않게 먼저 막고 그 행으로 안내한다.
    const dup = findRosterByEmail(rows, email)
    if (dup) { setAddError(rosterDraftErrorText(tr, ERR_DUPLICATE_EMAIL)); setDuplicate(dup); return }
    // 이름만 같은 사람은 막지 않는다(동명이인) — 다만 같은 사람을 두 번 넣는 실수가 흔해 한 번 묻는다(2026-10-12 UAT TEAM-06).
    // 같은 이름으로 한 번 더 누르면 그대로 추가한다.
    const typed = v.input.name.trim()
    if (sameNameAck !== typed && rows.some(r => r.name.trim() === typed)) {
      setSameNameAck(typed)
      setAddError(tr('roster.add.sameName').replace('{name}', () => typed))
      return
    }
    setSameNameAck(null)
    startTransition(async () => {
      const res = await upsertRosterMember(projectId, v.input)
      if (!res.ok) { setAddError(res.error); return }
      setName(''); setEmail('')
      setAdded({ memberId: res.memberId, typedName: v.input.name })
      setHighlightId(res.memberId)
      router.refresh()
    })
  }

  // 새로고침된 명단에서 방금 추가한 행의 저장된 이름이 입력과 다르면, 새 사람이 아니라 기존 인물이 올라왔다는 사실을 알린다.
  const addedRow = added ? rows.find(r => r.id === added.memberId) ?? null : null
  const existingNotice = addedRow && addedRow.name !== added?.typedName
    ? tr('roster.addedExisting').replace('{name}', () => String(addedRow.name)) : null

  function selectExisting(m: RosterMember) {
    setHighlightId(m.id)
    setAddError(null); setDuplicate(null)
    document.getElementById(`roster-row-${m.id}`)?.scrollIntoView({ block: 'center' })
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="data-table w-full min-w-[880px] text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">{tr('roster.col.name')}</th>
              <th className="py-2 pr-3">{tr('roster.col.email')}</th>
              <th className="py-2 pr-3">{tr('roster.col.teams')}</th>
              <th className="py-2 pr-3">{tr('roster.col.roleLabel')}</th>
              <th className="py-2 pr-3">{tr('roster.col.title')}</th>
              <th className="py-2 pr-3">{tr('roster.col.access')}</th>
              <th className="py-2 pr-3">{tr('roster.col.effective')}</th>
              <th className="py-2 pr-3">{tr('roster.col.status')}</th>
              <th className="relative py-2"><span className="sr-only">{tr('roster.col.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={ROSTER_COLUMNS} className="py-4 text-center text-fg-muted">
                  {tr('roster.empty')}{canEdit ? tr('roster.emptyAddHint') : ''}
                </td>
              </tr>
            )}
            {rows.map(m => {
              if (!canEdit) return <RosterReadRow key={m.id} member={m} effective={effectiveRoles[m.id] ?? { kind: 'unknown' }} />
              // 관리자 행은 표시 필드까지 워크스페이스 관리자만 고친다(RPC PROJECT_MEMBER_ADMIN_SLOT·RLS admin_write_member_rows).
              if (isAdminAccessRole(m.accessRole) && !grantAdmin) return <RosterReadRow key={m.id} member={m} effective={effectiveRoles[m.id] ?? { kind: 'unknown' }} note={tr(ADMIN_ROW_LOCKED_KEY)} />
              return (
                <RosterEditRow key={m.id} projectId={projectId} member={m} effective={effectiveRoles[m.id] ?? { kind: 'unknown' }} teamOptions={teamOptions}
                  canGrantAdmin={grantAdmin} highlighted={highlightId === m.id} onChanged={() => router.refresh()} />
              )
            })}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <form onSubmit={add} className="rounded-xl border border-border bg-surface-subtle/40 p-3" aria-label={tr('roster.add')}>
          <div className="flex flex-wrap items-center gap-2">
            <UserPlus className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <input className="app-input h-8 w-40 text-xs" aria-label={tr('roster.add.nameLabel')} placeholder={tr('roster.col.name')} value={name}
              disabled={pending} onChange={e => { setName(e.target.value); setAddError(null); setDuplicate(null); setAdded(null); setSameNameAck(null) }} />
            <input className="app-input h-8 w-56 text-xs" aria-label={tr('roster.add.emailLabel')} placeholder={tr('roster.add.emailPlaceholder')}
              value={email} disabled={pending} onChange={e => { setEmail(e.target.value); setAddError(null); setDuplicate(null); setAdded(null) }} />
            <button type="submit" className="btn btn-primary h-8 px-3 text-xs" disabled={pending || !name.trim()}>
              {pending ? tr('roster.adding') : tr('roster.add')}
            </button>
          </div>
          <p className="mt-2 text-xs text-fg-muted">
            {tr('roster.add.note')}{!name.trim() && ` ${tr('roster.add.nameHint')}`}
          </p>
          {existingNotice && <p role="status" className="mt-2 text-xs font-medium text-fg">{existingNotice}</p>}
          {addError && (
            <p role="alert" className="mt-2 text-xs font-medium text-danger">
              {addError}
              {duplicate && (
                <button type="button" className="ml-2 underline" onClick={() => selectExisting(duplicate)}>
                  {duplicate.name}{tr('roster.selectSuffix')}
                </button>
              )}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
