'use client'

import { useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, FolderPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { createProject, getProjectCopySource } from '@/app/actions/project'
import { isValidDateRange } from '@/lib/domain/validate'
import { validateLevelSettings } from '@/lib/domain/levelSettings'
import { useLocale } from '@/components/providers/LocaleProvider'
import { newUuid } from '@/lib/domain/uuid'

/**
 * 워크스페이스 홈의 "새 프로젝트 시작" 트리거 + 다이얼로그.
 * 'WORKSPACE DIALOG / 새 프로젝트' 모달.
 * 데모 모드에서는 createProject가 no-op이지만 닫기/새로고침은 정상 동작한다.
 */
export function NewProjectModal({
  workspaceId,
  copyCandidates = [],
  label,
  className = 'btn btn-primary',
  defaultOpen = false,
}: {
  /** 만들 워크스페이스 — 슬러그 워크스페이스(SP3b D26). 서버 컴포넌트가 loadWorkspaceScope 결과로 정해 넘긴다. */
  workspaceId: string
  copyCandidates?: { id: string; name: string }[]
  label?: string
  className?: string
  /** 첫 렌더에 열려 있다 — `?new=1` 로 들어온 화면(시작 화면·전환기의 '새 프로젝트' 링크) */
  defaultOpen?: boolean
}) {
  const { t } = useLocale()
  const router = useRouter()
  const levelsHintId = useId()
  const [open, setOpen] = useState(defaultOpen)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [levels, setLevels] = useState('')
  const [mode, setMode] = useState<'blank' | 'copy'>('blank')
  const [copyFromProjectId, setCopyFromProjectId] = useState('')
  const [sourceReady, setSourceReady] = useState(false)
  const sourceRequest = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 요청 번호 — 모달이 열릴 때 하나 만들어 재시도에도 같은 값을 쓴다(결과 불명 재전송이 중복 생성이 되지 않게)
  const [commandId, setCommandId] = useState(() => newUuid())

  function reset() {
    sourceRequest.current += 1
    setName('')
    setDescription('')
    setStart('')
    setEnd('')
    setLevels('')
    setMode('blank')
    setCopyFromProjectId('')
    setSourceReady(false)
    setError(null)
    setCommandId(newUuid())
  }

  function chooseMode(next: 'blank' | 'copy') {
    sourceRequest.current += 1
    setMode(next)
    setCopyFromProjectId('')
    setSourceReady(false)
    setLevels('')
    setError(null)
    setCommandId(newUuid())
  }

  async function chooseSource(projectId: string) {
    const request = ++sourceRequest.current
    setCopyFromProjectId(projectId)
    setSourceReady(false)
    setLevels('')
    setError(null)
    setCommandId(newUuid())
    if (!projectId) return
    try {
      const result = await getProjectCopySource(workspaceId, projectId)
      if (request !== sourceRequest.current) return
      if (!result.ok) {
        const keys = result.fieldErrors?.map(field => field.key).join(', ')
        setError(keys ? `${result.error} (${keys})` : result.error)
        return
      }
      setLevels(result.levelLabels.join(', '))
      setSourceReady(true)
    } catch {
      if (request === sourceRequest.current) setError('복사 원본 설정을 불러오지 못했습니다.')
    }
  }

  /** `?new=1` 로 열린 모달을 닫으면 주소에서 그 쿼리를 뺀다 — 새로고침·뒤로 가기에 다시 열리지 않게(나머지 쿼리는 그대로) */
  function dropNewQuery() {
    if (!defaultOpen || typeof window === 'undefined') return
    const u = new URL(window.location.href)
    if (!u.searchParams.has('new')) return
    u.searchParams.delete('new')
    router.replace(`${u.pathname}${u.search}${u.hash}`, { scroll: false })
  }

  function close() {
    if (busy) return
    setOpen(false)
    reset()
    dropNewQuery()
  }

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed || busy || (mode === 'copy' && !sourceReady)) return
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
      const r = await createProject({
        workspaceId, name: trimmed, startDate: start || null, endDate: end || null,
        description: description.trim() || null, levelLabels: lv.labels, commandId,
        copyFromProjectId: mode === 'copy' ? copyFromProjectId : null,
      })
      if (!r.ok) {
        // 같은 번호로 다른 내용을 보냈다 — 입력을 고쳐 다시 누르면 새 요청으로 나가게 번호를 바꾼다. 그 밖의 실패는 같은 번호로 재시도한다.
        if (r.code === 'COMMAND_REUSED') setCommandId(newUuid())
        setError(r.fieldErrors?.length ? `${r.error} (${r.fieldErrors.map(field => field.key).join(', ')})` : r.error)
        return
      }
      router.refresh()
      setOpen(false)
      reset()
      dropNewQuery()
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
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim() || !levels.trim() || busy || (mode === 'copy' && !sourceReady)}>
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

          {copyCandidates.length > 0 && <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-ink-muted">시작 방법</legend>
            <div className="flex flex-wrap gap-4 text-sm text-ink">
              <label className="flex items-center gap-2"><input type="radio" name="project-start-mode" checked={mode === 'blank'} onChange={() => chooseMode('blank')} />빈 값으로 시작</label>
              <label className="flex items-center gap-2"><input type="radio" name="project-start-mode" checked={mode === 'copy'} onChange={() => chooseMode('copy')} />기존 프로젝트에서 복사</label>
            </div>
          </fieldset>}
          {mode === 'copy' && <div className="space-y-2">
            <label className="block text-xs font-semibold text-ink-muted" htmlFor="copy-source-project">복사 원본 프로젝트</label>
            <select id="copy-source-project" className="app-input" value={copyFromProjectId} onChange={event => void chooseSource(event.target.value)}>
              <option value="">프로젝트를 선택하세요</option>
              {copyCandidates.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <p className="text-xs leading-5 text-ink-muted">복사합니다: 설정 값·팀·업무영역. 복사하지 않습니다: 멤버·WBS·회의록·이슈.</p>
          </div>}

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
            <p role="alert" className="rounded-xl border border-delayed/30 bg-delayed-weak px-3 py-2 text-xs font-medium text-delayed">{error}</p>
          )}
        </div>
      </Modal>
    </>
  )
}
