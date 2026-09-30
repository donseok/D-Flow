'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { previewSettingsImpact, type SettingsImpactResult } from '@/app/actions/settingsPreview'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { NON_CORE_MODULES, type ModuleId } from '@/lib/modules/defaults'
import { newUuid } from '@/lib/domain/uuid'
import type { Locale } from '@/lib/i18n/dict'
import { ConfigStateNotice } from './ConfigStateNotice'

const LABEL: Record<Exclude<ModuleId, 'dashboard' | 'wbs' | 'members' | 'settings'>, string> = {
  kanban: '칸반', meetings: '회의', weekly: '주간보고', issues: '이슈', wiki: '위키',
  announcements: '공지', attendance: '근태', agents: '에이전트', minutes: '회의록',
  minutes_integration: '회의록 외부 연동', chatbot: '챗봇', portfolio: '포트폴리오', usage: '사용 현황',
}

const sameIds = (a: readonly ModuleId[], b: readonly ModuleId[]) => a.length === b.length && a.every(id => b.includes(id))
type Conflict = { revision: number; allowed: ModuleId[] | null }

export function ModuleAllowEditor({ workspaceId, initialAllowed, revision, invalidReason, requiredMissing = false, locale = 'ko' }: {
  workspaceId: string; initialAllowed: ModuleId[] | null; revision: number; invalidReason?: string; requiredMissing?: boolean; locale?: Locale
}) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<ModuleId[]>(initialAllowed ?? [])
  const [selected, setSelected] = useState<ModuleId[]>(initialAllowed ?? [])
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialAllowed === null)
  // 저장은 됐지만 백필이 실패한 상태 — 같은 값을 새 명령으로 다시 저장해야 백필이 다시 돈다
  const [needsResync, setNeedsResync] = useState(false)
  const [review, setReview] = useState<Extract<SettingsImpactResult, { ok: true }> | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = needsRepair || needsResync || !sameIds(baseline, selected)

  function toggle(id: ModuleId) {
    setSelected(NON_CORE_MODULES.filter(m => m === id ? !selected.includes(m) : selected.includes(m)))
    setReview(null)
    setConflict(null)
    setError(null)
    setFieldError(null)
  }

  function inspect() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      let result: SettingsImpactResult
      try { result = await previewSettingsImpact(workspaceId, selected) }
      catch { setError('변경 영향을 확인하지 못했습니다. 다시 시도하세요.'); return }
      if (!result.ok) { setError(result.error); return }
      // 충돌은 문서 revision 이 아니라 이 키의 값으로 본다 — 같은 문서의 다른 편집기를 먼저 저장해도 revision 만 오른다.
      const latestSame = result.before === null ? needsRepair : sameIds(result.before, baseline)
      if (!latestSame) {
        setConflict({ revision: result.revision, allowed: result.before })
        return
      }
      setBaseRevision(result.revision)
      setReview(result)
    })
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 결과 불명 — 이력에서 판정 */ }
    if (result?.ok) {
      setBaseline(selected)
      setBaseRevision(result.revision)
      setNeedsRepair(false)
      setNeedsResync(false)
      setFieldError(null)
      setReview(null)
      setUncertainPatch(null)
      setNotice(result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '모듈 허용 목록을 저장했습니다.')
      router.refresh()
      return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['modules.allowed']
      setConflict({ revision: result.latest.revision, allowed: Array.isArray(value) ? value as ModuleId[] : null })
      setReview(null)
      setUncertainPatch(null)
      return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      setReview(null)
      setUncertainPatch(null)
      if (result.kind === 'unavailable' && result.appliedRevision !== undefined) {
        // 값은 저장됐다 — 그 revision 을 기준으로 채택하고, 같은 값 재저장(백필 재시도)을 열어 둔다
        setBaseline(selected); setBaseRevision(result.appliedRevision); setNeedsRepair(false); setNeedsResync(true)
        setError(result.error); router.refresh(); return
      }
      setFieldError(result.kind === 'invalid' ? (result.fieldErrors.find(e => e.key === 'modules.allowed')?.message ?? null) : null)
      setError(result.kind === 'invalid' && result.fieldErrors.some(e => e.key === 'modules.allowed') ? null : result.error)
      return
    }
    // 응답 유실은 명령 이력을 먼저 확인한다.
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(selected)
        setBaseRevision(found.outcome.revision)
        setNeedsRepair(false)
        setNeedsResync(false)
        setFieldError(null)
        setReview(null)
        setUncertainPatch(null)
        setNotice('저장된 명령을 확인했습니다.')
        router.refresh()
        return
      }
    } catch { /* 조회 불명도 같은 명령으로 다시 보낸다 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 결과를 다시 확인하세요.')
  }

  function save() {
    if (!review && !uncertainPatch) return
    setError(null)
    startTransition(async () => {
      await submit(uncertainPatch ?? {
        expectedRevision: baseRevision, commandId: newUuid(), set: { 'modules.allowed': selected }, unset: [],
      })
    })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-ink-muted">프로젝트 관리자가 켤 수 있는 모듈을 고릅니다. 허용에서 빼도 기존 데이터는 삭제되지 않습니다.</p>
      {needsRepair && (invalidReason || requiredMissing) && <ConfigStateNotice kind={requiredMissing ? 'required' : 'invalid'} locale={locale}
        keyName="modules.allowed" message={invalidReason} isAdmin settingsHref="#workspace-modules" />}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {NON_CORE_MODULES.map(id => (
          <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2.5 text-sm text-ink">
            <input type="checkbox" checked={selected.includes(id)} disabled={pending || !!uncertainPatch} onChange={() => toggle(id)} />
            <span>{LABEL[id as keyof typeof LABEL]}</span>
            <span className="ml-auto text-[11px] text-ink-subtle">{id}</span>
          </label>
        ))}
      </div>
      {fieldError && <ConfigStateNotice kind="field" locale={locale} message={fieldError} />}
      {conflict && (
        <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
          <strong>다른 사용자가 허용 목록을 바꿨습니다.</strong>
          <p>내 선택: {selected.map(id => LABEL[id as keyof typeof LABEL]).join(', ') || '없음'}</p>
          <p>최신 값: {conflict.allowed === null ? '설정 손상 — 복구 필요' : conflict.allowed.map(id => LABEL[id as keyof typeof LABEL]).join(', ') || '없음'}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.allowed ?? []); setNeedsRepair(conflict.allowed === null); setBaseRevision(conflict.revision); setConflict(null); setError(null) }}>내 값 다시 검토</button>
            {conflict.allowed !== null && <button type="button" className="btn btn-ghost" onClick={() => { setSelected(conflict.allowed!); setBaseline(conflict.allowed!); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null); setError(null) }}>최신 값 사용</button>}
          </div>
        </div>
      )}
      {review && (
        <div className="space-y-2 rounded-xl border border-brand-ring bg-brand-weak/30 p-4 text-sm">
          <strong>변경 내용 검토</strong>
          <p>추가: {selected.filter(id => !baseline.includes(id)).map(id => LABEL[id as keyof typeof LABEL]).join(', ') || '없음'}</p>
          <p>제외: {baseline.filter(id => !selected.includes(id)).map(id => LABEL[id as keyof typeof LABEL]).join(', ') || '없음'}</p>
          {review.impact === null ? <p>기존 허용 목록이 손상되어 영향 수를 계산할 수 없습니다. 저장하면 새 선택으로 복구됩니다.</p> : <>
            <p>영향받는 프로젝트: {review.impact.affectedProjects}개</p>
            {review.impact.removed.map(row => <p key={row.moduleId}>{LABEL[row.moduleId as keyof typeof LABEL]}: {row.projectCount}개 프로젝트</p>)}
          </>}
          <p>데이터는 삭제되지 않으며, 저장 직후 프로젝트 모듈 설정에 반영되고, 메뉴 표시는 다음 셸 갱신부터 바뀝니다.</p>
        </div>
      )}
      {error && <ConfigStateNotice kind="patch" locale={locale} message={error} />}
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" disabled={pending || !dirty || !!conflict || !!uncertainPatch} onClick={inspect}>변경 내용 검토</button>
        {(review || uncertainPatch) && <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>{uncertainPatch ? '저장 결과 확인 및 재시도' : '변경 저장'}</button>}
      </div>
      {notice && <p role="status" className="text-sm text-done">{notice}</p>}
    </div>
  )
}
