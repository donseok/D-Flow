'use client'

import { useEffect, useState, useTransition } from 'react'
import { Trash2, Unlink } from 'lucide-react'
import { upsertRosterMember, removeRosterMember } from '@/app/actions/roster'
import type { EffectiveRoleView } from '@/lib/domain/authz'
import type { RosterMember } from '@/lib/data/memberSelect'
import {
  accessRoleLabel, draftFromMember, isDraftDirty, validateDraft, type AccessRole, type RosterDraft,
} from '@/lib/domain/roster'
import { TeamMultiSelect, type TeamOption } from './TeamMultiSelect'
import { useTeamLabel } from '@/components/app/TeamsProvider'

export const ROSTER_COLUMNS = 9

/** 외부 인력 안내 — 배지 title 과 권한 셀이 같은 문구를 쓴다. */
export const UNLINKED_HINT = '로그인 계정과 연결되지 않은 사람입니다. 계정이 있어야 권한을 줄 수 있습니다.'

/** 계정이 연결되지 않은 사람(외부 인력) — 권한을 받을 수 없고, 로그인해도 '나'로 이어지지 않는다. */
function UnlinkedBadge() {
  return (
    <span className="chip shrink-0 bg-surface-subtle text-fg-secondary" data-unlinked-badge title={UNLINKED_HINT}>
      <Unlink className="h-3 w-3" aria-hidden />계정 미연결
    </span>
  )
}

function NameCell({ member, children }: { member: RosterMember; children?: React.ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {children ?? <span className="font-medium text-fg">{member.name}</span>}
      {member.kind === 'external' && <UnlinkedBadge />}
    </span>
  )
}

function EffectiveRoleCell({ member, effective }: { member: RosterMember; effective: EffectiveRoleView }) {
  return <td data-effective-role={member.id} className="py-2.5 pr-3 text-xs text-fg-secondary">
    {effective.kind === 'unknown' ? '확인 불가' : effective.kind === 'external' ? accessRoleLabel(member.accessRole)
      : <>{({ admin: '관리자', member: '멤버', viewer: '조회 전용' })[effective.role]}
        {effective.inherited && <span className="ml-1 chip text-fg-secondary">워크스페이스 관리자에서 상속</span>}</>}
  </td>
}

/** 읽기 전용 행 — 비관리자 화면, 또는 관리자 행을 고칠 수 없는 프로젝트 관리자. */
export function RosterReadRow({ member, note, effective = { kind: 'unknown' } }: { member: RosterMember; note?: string; effective?: EffectiveRoleView }) {
  const teamLabelOf = useTeamLabel()   // 칩 글자는 팀 이름(범위 밖·비활성 팀은 code 그대로)
  return (
    <tr className={`border-b border-border/60 align-top ${member.active ? '' : 'opacity-60'}`} data-roster-row={member.id}>
      <td className="py-2.5 pr-3"><NameCell member={member} /></td>
      <td className="py-2.5 pr-3 text-fg-secondary">{member.email ?? '—'}</td>
      <td className="py-2.5 pr-3">
        {member.teams.length === 0 ? <span className="text-fg-muted">—</span> : (
          <span className="flex flex-wrap gap-1">
            {member.teams.map((t, i) => (
              <span key={t.id} title={teamLabelOf(t.code)} className={`chip max-w-[12rem] truncate bg-surface-subtle ${i === 0 ? 'font-semibold text-fg' : 'text-fg-secondary'}`}>{teamLabelOf(t.code)}</span>
            ))}
          </span>
        )}
      </td>
      <td className="py-2.5 pr-3 text-xs text-fg-secondary">{member.roleLabel ?? '—'}</td>
      <td className="py-2.5 pr-3 text-xs text-fg-secondary">{member.title ?? '—'}</td>
      <td className="py-2.5 pr-3 text-xs text-fg-secondary">{accessRoleLabel(member.accessRole)}</td>
      <EffectiveRoleCell member={member} effective={effective} />
      <td className="py-2.5 pr-3 text-xs text-fg-secondary">{member.active ? '활성' : '비활성'}</td>
      <td className="py-2.5 text-xs text-fg-muted">{note ?? ''}</td>
    </tr>
  )
}

/**
 * 편집 행 — 초안을 들고 있다가 저장 한 번에 upsertRosterMember(RPC 한 트랜잭션)로 보낸다.
 * 이메일은 인물의 신원이라 여기서 바꾸지 않는다(RPC 가 기존 인물의 이메일을 무시한다).
 */
export function RosterEditRow({ projectId, member, effective = { kind: 'unknown' }, teamOptions, canGrantAdmin, highlighted, onChanged }: {
  projectId: string
  member: RosterMember
  effective?: EffectiveRoleView
  teamOptions: readonly TeamOption[]
  canGrantAdmin: boolean
  highlighted: boolean
  onChanged: () => void
}) {
  const base = draftFromMember(member)
  const baseKey = JSON.stringify(base)
  const [draft, setDraft] = useState<RosterDraft>(base)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  // 저장·새로고침으로 원본이 바뀌면 초안을 다시 맞춘다. 다른 행 저장으로 인한 재렌더는 원본 키가 같아
  // 돌지 않으므로 이 행의 편집 중 값은 남는다.
  useEffect(() => { setDraft(JSON.parse(baseKey) as RosterDraft) }, [baseKey])

  const set = <K extends keyof RosterDraft>(k: K, v: RosterDraft[K]) => { setDraft(d => ({ ...d, [k]: v })); setError(null) }
  const dirty = isDraftDirty(draft, member)
  // 팀 후보 = 이 프로젝트의 활성 팀 + 이미 소속된 팀(비활성이어도 저장 때 조용히 빠지지 않게).
  const options = [
    ...teamOptions,
    ...member.teams.filter(t => !teamOptions.some(o => o.id === t.id)).map(t => ({ id: t.id, code: t.code })),
  ]

  function save() {
    const v = validateDraft(draft)
    if (!v.ok) { setError(v.error); return }
    startTransition(async () => {
      const res = await upsertRosterMember(projectId, v.input)
      if (!res.ok) { setError(res.error); return }
      setError(null)
      onChanged()
    })
  }

  function remove() {
    startTransition(async () => {
      const res = await removeRosterMember(member.id)
      setConfirmDelete(false)
      if (!res.ok) { setError(res.error); return }
      onChanged()
    })
  }

  const who = member.name
  const unlinked = member.kind === 'external'
  return (
    <>
      <tr
        id={`roster-row-${member.id}`}
        data-roster-row={member.id}
        className={`border-b border-border/60 align-top ${draft.active ? '' : 'opacity-60'} ${highlighted ? 'bg-action-soft/40' : ''}`}
      >
        <td className="py-2 pr-3">
          <NameCell member={member}>
            <input className="app-input h-8 w-28 text-xs" aria-label={`${who} 이름`} value={draft.name}
              disabled={pending} onChange={e => set('name', e.target.value)} />
          </NameCell>
        </td>
        <td className="py-2 pr-3 text-fg-secondary">{member.email ?? '—'}</td>
        <td className="py-2 pr-3">
          <TeamMultiSelect options={options} value={draft.teamIds} label={`${who} 팀`} disabled={pending}
            onChange={ids => set('teamIds', ids)} />
        </td>
        <td className="py-2 pr-3">
          <input className="app-input h-8 w-24 text-xs" aria-label={`${who} 역할 라벨`} placeholder="역할" value={draft.roleLabel}
            disabled={pending} onChange={e => set('roleLabel', e.target.value)} />
        </td>
        <td className="py-2 pr-3">
          <input className="app-input h-8 w-24 text-xs" aria-label={`${who} 직함`} placeholder="직함" value={draft.title}
            disabled={pending} onChange={e => set('title', e.target.value)} />
        </td>
        <td className="py-2 pr-3">
          <select className="app-input h-8 w-auto text-xs" aria-label={`${who} 권한`} value={draft.accessRole ?? ''}
            disabled={pending} title={unlinked ? UNLINKED_HINT : undefined}
            onChange={e => set('accessRole', (e.target.value || null) as AccessRole | null)}>
            <option value="">{accessRoleLabel(null)}</option>
            {/* 외부 인력은 계정이 없어 권한을 받을 수 없다 — 트리거(PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT)가 거부하기 전에 막는다. */}
            <option value="member" disabled={unlinked}>{accessRoleLabel('member')}</option>
            <option value="admin" disabled={unlinked || !canGrantAdmin}>
              {accessRoleLabel('admin')}{!unlinked && !canGrantAdmin ? ' (워크스페이스 관리자 전용)' : ''}
            </option>
          </select>
          {unlinked && <p className="mt-1 max-w-[12rem] text-meta leading-4 text-fg-muted" data-unlinked-access-hint>{UNLINKED_HINT}</p>}
        </td>
        <EffectiveRoleCell member={member} effective={effective} />
        <td className="py-2 pr-3">
          <label className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
            <input type="checkbox" aria-label={`${who} 활성`} checked={draft.active} disabled={pending}
              onChange={e => set('active', e.target.checked)} />
            활성
          </label>
        </td>
        <td className="py-2">
          <span className="flex items-center gap-1.5">
            <button type="button" className="btn btn-primary h-8 px-3 text-xs" disabled={pending || !dirty} onClick={save}>
              {pending ? '저장 중…' : '저장'}
            </button>
            {confirmDelete ? (
              <>
                <button type="button" className="btn btn-ghost h-8 px-2 text-xs text-danger" disabled={pending} onClick={remove}>삭제 확인</button>
                <button type="button" className="btn btn-ghost h-8 px-2 text-xs" disabled={pending} onClick={() => setConfirmDelete(false)}>취소</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost h-8 px-2 text-xs" aria-label={`${who} 삭제`} disabled={pending}
                onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </span>
        </td>
      </tr>
      {error && (
        <tr data-roster-error={member.id}>
          <td colSpan={ROSTER_COLUMNS} className="pb-2 pt-0">
            <p role="alert" className="text-xs font-medium text-danger">{error}</p>
          </td>
        </tr>
      )}
    </>
  )
}
