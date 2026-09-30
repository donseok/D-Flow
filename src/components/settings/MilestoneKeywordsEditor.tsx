'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import type { Locale } from '@/lib/i18n/dict'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'

const lines = (text: string) => text.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
const display = (values: readonly string[]) => values.join('\n')

export function MilestoneKeywordsEditor({ projectId, revision, initial, source, invalidReason, locale = 'ko' }: {
  projectId: string; revision: number; initial: string[]; source: string; invalidReason?: string; locale?: Locale
}) {
  const router = useRouter()
  const [text, setText] = useState(() => display(initial))
  const [baseline, setBaseline] = useState(() => display(initial))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [repair, setRepair] = useState(Boolean(invalidReason))
  const [conflict, setConflict] = useState<{ revision: number; latest: string[] | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [pending, startTransition] = useTransition()
  const dirty = repair || text !== baseline

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateProjectSettings(projectId, patch) } catch { /* 이력에서 결과 확인 */ }
    if (result?.ok) {
      setBaseline(text); setBaseRevision(result.revision); setRepair(false); setConflict(null); setUncertainPatch(null)
      setReviewing(false)
      setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '마일스톤 키워드를 저장했습니다. 대시보드에 즉시 적용됩니다.')
      router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['core.milestone_keywords']
      setConflict({ revision: result.latest.revision,
        latest: result.latest.invalidKeys.includes('core.milestone_keywords') ? null : Array.isArray(value) ? value as string[] : null })
      setUncertainPatch(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const fieldMessage = result.kind === 'invalid' ? result.fieldErrors.find(e => e.key === 'core.milestone_keywords')?.message : undefined
      setFieldError(fieldMessage ?? null)
      setError(fieldMessage ? null : result.error)
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ projectId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(text); setBaseRevision(found.outcome.revision); setRepair(false); setUncertainPatch(null); setFieldError(null)
        setNotice(found.outcome.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령으로 재시도 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if (!dirty && !uncertainPatch) return
    const values = lines(text)
    if (values.length > 50 || values.some(value => value.length > 40)) {
      setFieldError('키워드는 최대 50개, 각 40자까지 입력할 수 있습니다.'); return
    }
    if (!reviewing && !uncertainPatch) { setError(null); setReviewing(true); return }
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'core.milestone_keywords': values }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor="milestone-keywords" className="text-sm font-semibold text-ink">마일스톤 키워드</label>
      <span className="text-xs text-ink-subtle">{repair ? '설정 손상' : source} · 즉시 적용</span>
    </div>
    <p className="text-xs text-ink-muted">작업 이름에 포함된 단어로 대시보드의 마일스톤을 표시합니다. 비우면 마커가 표시되지 않습니다.</p>
    {repair && <ConfigStateNotice kind="invalid" locale={locale} keyName="core.milestone_keywords" message={invalidReason}
      isAdmin settingsHref="#milestone-keywords" />}
    <textarea id="milestone-keywords" className="input min-h-28 w-full text-sm" value={text}
      disabled={pending || !!uncertainPatch} onChange={event => { setText(event.target.value); setReviewing(false); setError(null); setFieldError(null); setNotice(null) }} placeholder="한 줄에 한 키워드" />
    {fieldError && <ConfigStateNotice kind="field" locale={locale} message={fieldError} />}
    <p className="text-[11px] text-ink-subtle">저장 시 소문자로 바뀝니다.</p>
    {reviewing && !conflict && !uncertainPatch && <section aria-label="변경 내용 검토" className="space-y-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <h3 className="font-semibold text-ink">변경 내용 검토</h3>
      <p className="text-ink-muted">현재: {lines(baseline).join(', ') || '없음'}</p>
      <p className="text-ink-muted">변경: {lines(text).join(', ') || '없음'}</p>
      <p className="text-ink-muted">저장하면 대시보드의 마일스톤 판정이 즉시 다시 계산됩니다. WBS 작업의 저장값은 바뀌지 않습니다.</p>
      <button type="button" className="btn btn-secondary" onClick={() => setReviewing(false)}>계속 수정</button>
    </section>}
    {conflict && <ConflictCompare rows={[{ key: 'keywords', label: '마일스톤 키워드',
      mine: lines(text).join(', '), latest: conflict.latest?.join(', ') ?? '설정 손상',
    }]} latestAvailable={conflict.latest !== null}
      onMine={() => { setBaseline(display(conflict.latest ?? [])); setBaseRevision(conflict.revision); setReviewing(false); setConflict(null) }}
      onLatest={() => { const next = display(conflict.latest ?? []); setText(next); setBaseline(next); setBaseRevision(conflict.revision); setRepair(false); setReviewing(false); setConflict(null) }} />}
    {error && <ConfigStateNotice kind="patch" locale={locale} message={error} />}
    {notice && <p role="status" className="text-sm text-done">{notice}</p>}
    <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict} onClick={save}>
      {uncertainPatch ? '저장 결과 확인 및 재시도' : reviewing ? '검토 후 저장' : '변경 내용 검토'}
    </button>
  </div>
}
