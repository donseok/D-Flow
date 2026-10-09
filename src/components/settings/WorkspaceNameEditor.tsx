'use client'
// 워크스페이스 설정 '일반' — 워크스페이스 이름. 설정 키가 아니라 워크스페이스 행의 이름이라 설정 편집기(revision·이력)와 따로 저장한다
// (renameWorkspace — 그 워크스페이스의 관리자, RPC 가 등급을 다시 판정한다). 주소(slug)는 여기서 바꾸지 않는다.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { renameWorkspace } from '@/app/actions/platformWorkspaces'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Field } from '@/components/ui/Field'
import { checkWorkspaceName, WORKSPACE_NAME_MAX } from '@/lib/workspace/createInput'
import { renameErrorKey } from '@/lib/workspace/renameErrorKey'

export function WorkspaceNameEditor({ workspaceId, slug, initialName }: { workspaceId: string; slug: string; initialName: string }) {
  const { t } = useLocale()
  const router = useRouter()
  const [saved, setSaved] = useState(initialName)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()
  const dirty = name.trim() !== saved

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setDone(false)
    const checked = checkWorkspaceName(name)
    if (!checked.ok) { setError(t(renameErrorKey(checked.code))); return }
    setError(null)
    startTransition(async () => {
      try {
        const res = await renameWorkspace(workspaceId, checked.name)
        if (!res.ok) { setError(t(renameErrorKey(res.code))); return }
        setSaved(res.name)
        setName(res.name)
        setDone(true)
        // 머리·전환기·탭 제목이 새 이름을 읽게 한다
        router.refresh()
      } catch (e) {
        console.error('[WorkspaceNameEditor] 이름 변경 요청 실패:', e)
        setError(t('platform.ws.err.unknown'))
      }
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-workspace-name-editor noValidate>
      <Field label={t('platform.ws.nameField.label')} description={t('platform.ws.nameField.desc').replace('{slug}', slug)} error={error}>
        {(c) => <input {...c} value={name} onChange={(e) => { setName(e.target.value); setDone(false) }} maxLength={WORKSPACE_NAME_MAX} autoComplete="off" />}
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending || !dirty}>
          {pending ? t('platform.ws.renameSaving') : t('common.save')}
        </button>
        {done && <p role="status" className="text-meta text-fg-secondary">{t('platform.ws.nameField.saved')}</p>}
      </div>
    </form>
  )
}
