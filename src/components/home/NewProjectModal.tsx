'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, FolderPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { createProject } from '@/app/actions/project'
import { isValidDateRange } from '@/lib/domain/validate'
import { validateLevelSettings } from '@/lib/domain/levelSettings'
import { useLocale } from '@/components/providers/LocaleProvider'

/**
 * 워크스페이스 홈의 "새 프로젝트 시작" 트리거 + 다이얼로그.
 * 'WORKSPACE DIALOG / 새 프로젝트' 모달.
 * 데모 모드에서는 createProject가 no-op이지만 닫기/새로고침은 정상 동작한다.
 */
export function NewProjectModal({
  label,
  className = 'inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-4 text-sm font-semibold text-hero-ink backdrop-blur transition hover:bg-white/20',
}: {
  label?: string
  className?: string
}) {
  const { t } = useLocale()
  const router = useRouter()
  const levelsHintId = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [levels, setLevels] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName('')
    setDescription('')
    setStart('')
    setEnd('')
    setLevels('')
    setError(null)
  }

  function close() {
    if (busy) return
    setOpen(false)
    reset()
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    if (!isValidDateRange(start || null, end || null)) {
      setError(t('home.errEndBeforeStart'))
      return
    }
    const labels = levels.split(/[,>\n]/).map(s => s.trim()).filter(Boolean)
    // 서버 액션(createProject)과 같은 순수 함수로 미리 검증한다 — 프로덕션 빌드는 서버 액션이
    // throw 한 메시지를 클라이언트에 전달하지 않으므로(React Flight 가 digest 만 보낸다),
    // 여기서 막지 않으면 사용자는 원인 불명의 일반 에러만 본다.
    const lv = validateLevelSettings({ labels, currentTreeMaxDepth: null })
    if (!lv.ok) {
      setError(lv.error)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createProject(trimmed, start || null, end || null, description.trim() || null, lv.labels)
      router.refresh()
      setOpen(false)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('home.errCreateFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        {label ?? t('home.newProjectStart')}
      </button>

      <Modal
        open={open}
        onClose={close}
        eyebrow="Workspace dialog"
        title={t('common.newProject')}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim() || !levels.trim() || busy}>
              <FolderPlus className="h-4 w-4" />
              {busy ? t('home.creating') : t('home.createProject')}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm leading-6 text-ink-muted">
            {t('home.newProjectDesc')}
          </p>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
              {t('home.fieldName')} <span className="text-delayed">*</span>
            </span>
            <input
              className="app-input"
              placeholder={t('home.phName')}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') submit()
              }}
            />
          </label>

          {/* 힌트를 label 밖에 두되 입력 바로 아래 붙도록 묶는다 — 형제로 두면 space-y-4 간격이 벌어진다. */}
          <div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">
                {t('home.fieldLevels')} <span aria-hidden="true" className="text-delayed">*</span>
              </span>
              <input
                className="app-input"
                placeholder={t('home.phLevels')}
                value={levels}
                onChange={e => setLevels(e.target.value)}
                required
                aria-required="true"
                aria-describedby={levelsHintId}
              />
            </label>
            <span id={levelsHintId} className="mt-1 block text-xs text-ink-subtle">{t('home.hintLevels')}</span>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('home.fieldDesc')}</span>
            <textarea
              className="app-textarea min-h-[84px]"
              placeholder={t('home.phDesc')}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('home.fieldStart')}</span>
              <input type="date" className="app-input px-2.5 text-sm" value={start} onChange={e => setStart(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-muted">{t('home.fieldEnd')}</span>
              <input type="date" className="app-input px-2.5 text-sm" value={end} min={start || undefined} onChange={e => setEnd(e.target.value)} />
            </label>
          </div>

          {error && (
            <p className="rounded-xl border border-delayed/30 bg-delayed-weak px-3 py-2 text-xs font-medium text-delayed">{error}</p>
          )}
        </div>
      </Modal>
    </>
  )
}
