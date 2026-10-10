'use client'
// 플랫폼 관리 — 워크스페이스 한 행의 이름 바꾸기·삭제 대화상자(/admin/workspaces). 판정은 서버 액션이 다시 한다(가드 + RPC 안의 등급 재판정).
// 삭제는 되돌릴 수 없다 — 주소(slug)를 사람이 직접 적어야 확정 단추가 열리고, 서버가 그 글자를 그 워크스페이스의 주소와 다시 대조한다.
// 비어 있지 않으면 서버는 아무것도 지우지 않고 남은 것을 돌려준다 — 대화상자를 닫지 않고 그 목록을 보인다.
// 보관(0056)은 되돌릴 수 있지만 멤버 전원의 화면과 연동이 닫히는 조작이라 삭제와 같이 주소를 직접 적게 한다. 복원은 단순 확인이다.
import { useState, useTransition } from 'react'
import {
  archivePlatformWorkspace, deletePlatformWorkspace, renameWorkspace, restorePlatformWorkspace,
  type PlatformWorkspaceArchiveCode, type PlatformWorkspaceDeleteCode, type PlatformWorkspaceRestoreCode, type PlatformWorkspaceRow,
} from '@/app/actions/platformWorkspaces'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Field } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { buttonClass } from '@/components/ui/buttonStyles'
import type { DictKey } from '@/lib/i18n/dict'
import { checkArchiveReason, WORKSPACE_ARCHIVE_REASON_MAX } from '@/lib/workspace/archiveInput'
import { checkWorkspaceName, WORKSPACE_NAME_MAX } from '@/lib/workspace/createInput'
import type { WorkspaceRemainingItem } from '@/lib/workspace/deleteRemaining'
import { renameErrorKey } from '@/lib/workspace/renameErrorKey'

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

const deleteErrorKey = (code: PlatformWorkspaceDeleteCode | 'unknown'): DictKey =>
  (code === 'denied' ? 'platform.ws.err.delete_denied' : `platform.ws.err.${code}`) as DictKey

/** 보관·복원 거부 코드 → 사전 키. 같은 코드라도 조작마다 문구가 다른 것(denied·slug_mismatch)은 조작 이름을 붙인 키로 간다 */
const archiveErrorKey = (code: PlatformWorkspaceArchiveCode | 'unknown'): DictKey =>
  (code === 'denied' ? 'platform.ws.err.archive_denied' : code === 'slug_mismatch' ? 'platform.ws.err.archive_slug_mismatch' : `platform.ws.err.${code}`) as DictKey
const restoreErrorKey = (code: PlatformWorkspaceRestoreCode | 'unknown'): DictKey =>
  (code === 'denied' ? 'platform.ws.err.restore_denied' : `platform.ws.err.${code}`) as DictKey

export function RenameWorkspaceDialog({ workspace, onClose, onRenamed }: {
  workspace: PlatformWorkspaceRow
  onClose: () => void
  onRenamed: (name: string) => void
}) {
  const { t } = useLocale()
  const [name, setName] = useState(workspace.name)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event?: React.FormEvent) {
    event?.preventDefault()
    const checked = checkWorkspaceName(name)
    if (!checked.ok) { setError(t(renameErrorKey(checked.code))); return }
    if (checked.name === workspace.name) { onClose(); return }
    setError(null)
    startTransition(async () => {
      try {
        const res = await renameWorkspace(workspace.id, checked.name)
        if (!res.ok) { setError(t(renameErrorKey(res.code))); return }
        onRenamed(res.name)
      } catch (e) {
        console.error('[RenameWorkspaceDialog] 이름 변경 요청 실패:', e)
        setError(t('platform.ws.err.unknown'))
      }
    })
  }

  return (
    <Modal open onClose={onClose} title={t('platform.ws.renameTitle')} size="sm" dirty={name !== workspace.name}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
          <button type="button" data-rename-confirm onClick={() => submit()} className="btn btn-primary" disabled={pending}>
            {pending ? t('platform.ws.renameSaving') : t('common.save')}
          </button>
        </>
      }>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label={t('platform.ws.fieldName')} description={fill(t('platform.ws.renameSlugNote'), { slug: workspace.slug })} error={error}>
          {(c) => <input {...c} data-rename-input value={name} onChange={(e) => { setName(e.target.value); setError(null) }} maxLength={WORKSPACE_NAME_MAX} autoComplete="off" autoFocus />}
        </Field>
      </form>
    </Modal>
  )
}

export function DeleteWorkspaceDialog({ workspace, onClose, onDeleted }: {
  workspace: PlatformWorkspaceRow
  onClose: () => void
  onDeleted: (name: string) => void
}) {
  const { t } = useLocale()
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<WorkspaceRemainingItem[] | null>(null)
  const [pending, startTransition] = useTransition()
  // 적은 글자가 주소와 한 글자도 다르지 않아야 한다 — 다듬지 않는다(서버도 같은 대조를 다시 한다)
  const matches = typed === workspace.slug

  function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!matches || pending) return
    setError(null)
    setRemaining(null)
    startTransition(async () => {
      try {
        const res = await deletePlatformWorkspace(workspace.id, typed)
        if (!res.ok) {
          setError(t(deleteErrorKey(res.code)))
          setRemaining(res.code === 'not_empty' ? res.remaining ?? null : null)
          return
        }
        onDeleted(res.workspace.name)
      } catch (e) {
        console.error('[DeleteWorkspaceDialog] 삭제 요청 실패:', e)
        setError(t('platform.ws.err.unknown'))
      }
    })
  }

  return (
    <Modal open onClose={onClose} title={t('platform.ws.deleteTitle')} size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
          <button type="button" data-delete-confirm onClick={() => submit()} className={buttonClass('danger')} disabled={pending || !matches}>
            {pending ? t('platform.ws.deleting') : t('platform.ws.deleteSubmit')}
          </button>
        </>
      }>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm font-semibold text-fg" data-delete-target>
          {fill(t('platform.ws.deleteTarget'), { name: workspace.name, slug: workspace.slug })}
        </p>
        <p className="text-sm font-medium text-danger">{t('platform.ws.deleteWarn')}</p>
        <p className="text-sm leading-6 text-fg-secondary">{t('platform.ws.deleteRule')}</p>
        <Field label={fill(t('platform.ws.deleteConfirmField'), { slug: workspace.slug })}>
          {(c) => <input {...c} data-delete-slug value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={63}
            autoComplete="off" autoCapitalize="none" spellCheck={false} />}
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        {remaining && (
          <div data-delete-remaining className="rounded-xl border border-border bg-surface-subtle px-4 py-3">
            <p className="text-sm font-semibold text-fg">{t('platform.ws.remainingTitle')}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-fg-secondary">
              {remaining.map((item) => (
                <li key={item.key === 'other' ? `other:${item.table}` : item.key}>
                  {fill(t(`platform.ws.remaining.${item.key}` as DictKey), { n: item.count, table: item.table ?? '' })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </form>
    </Modal>
  )
}

export function ArchiveWorkspaceDialog({ workspace, onClose, onArchived }: {
  workspace: PlatformWorkspaceRow
  onClose: () => void
  /** unchanged: 그 사이 다른 관리자가 이미 보관했다 — 쓰지 않았고 화면만 맞춘다 */
  onArchived: (name: string, unchanged: boolean) => void
}) {
  const { t } = useLocale()
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 적은 글자가 주소와 한 글자도 다르지 않아야 한다 — 다듬지 않는다(서버도 같은 대조를 다시 한다)
  const matches = typed === workspace.slug

  function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!matches || pending) return
    const checked = checkArchiveReason(reason)
    if (!checked.ok) { setError(t(archiveErrorKey(checked.code))); return }
    setError(null)
    startTransition(async () => {
      try {
        const res = await archivePlatformWorkspace(workspace.id, typed, checked.reason)
        if (!res.ok) { setError(t(archiveErrorKey(res.code))); return }
        onArchived(res.workspace.name, res.unchanged)
      } catch (e) {
        console.error('[ArchiveWorkspaceDialog] 보관 요청 실패:', e)
        setError(t('platform.ws.err.unknown'))
      }
    })
  }

  return (
    <Modal open onClose={onClose} title={t('platform.ws.archiveTitle')} size="md" dirty={reason !== ''}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
          <button type="button" data-archive-confirm onClick={() => submit()} className={buttonClass('danger')} disabled={pending || !matches}>
            {pending ? t('platform.ws.archiving') : t('platform.ws.archiveSubmit')}
          </button>
        </>
      }>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm font-semibold text-fg" data-archive-target>
          {fill(t('platform.ws.deleteTarget'), { name: workspace.name, slug: workspace.slug })}
        </p>
        <p className="text-sm leading-6 text-fg">{t('platform.ws.archiveEffect')}</p>
        <p className="text-sm leading-6 text-fg-secondary">{t('platform.ws.archiveKeep')}</p>
        <Field label={fill(t('platform.ws.archiveConfirmField'), { slug: workspace.slug })}>
          {(c) => <input {...c} data-archive-slug value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={63}
            autoComplete="off" autoCapitalize="none" spellCheck={false} />}
        </Field>
        <Field label={t('platform.ws.archiveReasonField')} description={t('platform.ws.archiveReasonHint')}>
          {(c) => <textarea {...c} data-archive-reason rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            maxLength={WORKSPACE_ARCHIVE_REASON_MAX} />}
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </form>
    </Modal>
  )
}

export function RestoreWorkspaceDialog({ workspace, onClose, onRestored }: {
  workspace: PlatformWorkspaceRow
  onClose: () => void
  onRestored: (name: string, unchanged: boolean) => void
}) {
  const { t } = useLocale()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await restorePlatformWorkspace(workspace.id)
        if (!res.ok) { setError(t(restoreErrorKey(res.code))); return }
        onRestored(res.workspace.name, res.unchanged)
      } catch (e) {
        console.error('[RestoreWorkspaceDialog] 복원 요청 실패:', e)
        setError(t('platform.ws.err.unknown'))
      }
    })
  }

  return (
    <Modal open onClose={onClose} title={t('platform.ws.restoreTitle')} size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
          <button type="button" data-restore-confirm onClick={submit} className="btn btn-primary" disabled={pending}>
            {pending ? t('platform.ws.restoring') : t('platform.ws.restoreSubmit')}
          </button>
        </>
      }>
      <div className="space-y-3">
        <p className="text-sm font-semibold text-fg" data-restore-target>
          {fill(t('platform.ws.deleteTarget'), { name: workspace.name, slug: workspace.slug })}
        </p>
        <p className="text-sm leading-6 text-fg-secondary">{t('platform.ws.restoreEffect')}</p>
        {workspace.archiveReason && (
          <p className="text-sm leading-6 text-fg-secondary" data-restore-reason>{fill(t('platform.ws.archiveReasonNote'), { reason: workspace.archiveReason })}</p>
        )}
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </div>
    </Modal>
  )
}
