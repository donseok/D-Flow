'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { uploadBrandLogo } from '@/app/actions/branding'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { BRANDING_SLOTS, type BrandingSlot } from '@/lib/settings/brandingPath'
import type { BrandingLogo } from '@/lib/settings/defs/workspace'
import { newUuid } from '@/lib/domain/uuid'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'

const EMPTY: BrandingLogo = { full: null, full_dark: null, mark: null }
const LABEL: Record<BrandingSlot, string> = { full: '기본 로고', full_dark: '어두운 배경 로고', mark: '아이콘 마크' }
const same = (a: BrandingLogo, b: BrandingLogo) => BRANDING_SLOTS.every(slot => a[slot] === b[slot])
/** 선택한 파일의 로컬 미리보기 주소 — 서버에 요청하지 않는다(저장 전 경로는 /api/brand 가 주지 않는다). 지원하지 않으면 null. */
function localPreview(file: File): string | null {
  try { return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null } catch { return null }
}
function revoke(url: string | undefined) { try { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url) } catch { /* 미리보기 정리 실패는 무시 */ } }

export function LogoEditor({ workspaceId, revision, initialLogo, invalidReason }: {
  workspaceId: string; revision: number; initialLogo: BrandingLogo | null; invalidReason?: string
}) {
  const router = useRouter()
  const [baseline, setBaseline] = useState<BrandingLogo>(initialLogo ?? EMPTY)
  const [draft, setDraft] = useState<BrandingLogo>(initialLogo ?? EMPTY)
  const [files, setFiles] = useState<Partial<Record<BrandingSlot, File>>>({})
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialLogo === null)
  const [conflict, setConflict] = useState<{ revision: number; logo: BrandingLogo | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  // 업로드 거부는 저장 실패가 아니다 — 저장 영역의 '설정을 저장하지 못했습니다' 제목 아래가 아니라 입력 자리에 보인다
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Partial<Record<BrandingSlot, string>>>({})
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  useEffect(() => () => { for (const url of Object.values(previewsRef.current)) revoke(url) }, [])
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = needsRepair || !same(baseline, draft)

  function upload(slot: BrandingSlot) {
    const file = files[slot]
    if (!file) return
    setError(null); setUploadError(null); setNotice(null)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof uploadBrandLogo>>
      try { result = await uploadBrandLogo(workspaceId, slot, file) }
      catch { setUploadError('로고 업로드 결과를 확인하지 못했습니다. 다시 시도하세요.'); return }
      if (!result.ok) { setUploadError(result.error); return }
      setDraft(current => ({ ...current, [slot]: result.path }))
      setFiles(current => ({ ...current, [slot]: undefined }))
      setNotice(`${LABEL[slot]} 업로드가 끝났습니다. 설정을 저장하면 적용됩니다.`)
    })
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(draft); setBaseRevision(result.revision); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : '로고 설정을 저장했습니다. 화면에 바로 반영됩니다.'); router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      const value = result.latest.values['branding.logo']
      setConflict({ revision: result.latest.revision, logo: value && typeof value === 'object' ? value as BrandingLogo : null })
      setUncertainPatch(null); setFieldError(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const field = result.kind === 'invalid' ? result.fieldErrors.find(e => e.key === 'branding.logo') : undefined
      setFieldError(field?.message ?? null)
      setError(field ? null : (result.kind === 'invalid' ? (result.fieldErrors[0]?.message ?? result.error) : result.error))
      setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome({ workspaceId }, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') {
        setBaseline(draft); setBaseRevision(found.outcome.revision); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null)
        setNotice('저장된 명령을 확인했습니다.'); router.refresh(); return
      }
    } catch { /* 같은 명령으로 다시 보낸다 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
  }

  function save() {
    if (!dirty && !uncertainPatch) return
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'branding.logo': draft }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-4">
    <p className="text-xs leading-5 text-ink-muted">PNG·JPEG·WebP, 256KB 이하. 업로드한 뒤 저장하면 화면에 바로 반영됩니다. 이전 파일은 삭제되지 않습니다.</p>
    {invalidReason && needsRepair && <ConfigStateNotice kind="invalid" locale="ko" keyName="branding.logo" message={invalidReason} isAdmin settingsHref="#workspace-general" />}
    <div className="grid gap-3 sm:grid-cols-3">
      {BRANDING_SLOTS.map(slot => <div key={slot} className="space-y-2 rounded-xl border border-line p-3">
        <div className="text-sm font-semibold text-ink">{LABEL[slot]}</div>
        {draft[slot] ? <>
          {draft[slot] === baseline[slot] ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/brand/${workspaceId}/${slot}`} alt={`${LABEL[slot]} 미리보기`} className="h-16 max-w-full object-contain" />
          </> : <>
            {previews[slot] && <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[slot]} alt={`${LABEL[slot]} 새 이미지 미리보기`} className="h-16 max-w-full object-contain" />
            </>}
            <p className="text-xs text-pending">새 이미지 업로드됨 · {previews[slot] ? '저장하면 적용됩니다' : '저장 후 미리보기'}</p>
          </>}
          <p className="break-all text-[11px] text-ink-subtle">{draft[slot]}</p>
        </> : <p className="text-xs text-ink-muted">설정된 이미지 없음</p>}
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${LABEL[slot]} 파일`} className="block w-full min-w-0 max-w-full text-xs text-ink-muted file:mr-2 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-xs"
          disabled={pending || !!uncertainPatch} onChange={event => {
            const picked = event.target.files?.[0]
            revoke(previews[slot]); setFiles({ ...files, [slot]: picked })
            setPreviews(current => ({ ...current, [slot]: picked ? (localPreview(picked) ?? undefined) : undefined }))
            event.target.value = ''
          }} />
        {files[slot] && <p className="break-all text-xs text-ink-muted">선택: {files[slot].name}</p>}
        {files[slot] && previews[slot] && draft[slot] === baseline[slot] && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previews[slot]} alt={`${LABEL[slot]} 선택 파일 미리보기`} className="h-16 max-w-full object-contain" />
        </>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={pending || !files[slot] || !!uncertainPatch} onClick={() => upload(slot)}>업로드</button>
          {draft[slot] && <button type="button" className="btn btn-ghost" disabled={pending || !!uncertainPatch}
            onClick={() => { setDraft({ ...draft, [slot]: null }); setError(null); setNotice(null) }}>제거</button>}
        </div>
      </div>)}
    </div>
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>다른 사용자가 로고를 바꿨습니다.</strong>
      {BRANDING_SLOTS.map(slot => <p key={slot}>{LABEL[slot]} — 내 값: {draft[slot] ?? '없음'} / 최신 값: {conflict.logo?.[slot] ?? '없음'}</p>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.logo ?? EMPTY); setBaseRevision(conflict.revision); setNeedsRepair(conflict.logo === null); setConflict(null) }}>내 값 다시 적용</button>
        {conflict.logo && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(conflict.logo!); setBaseline(conflict.logo!); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null) }}>최신 값 사용</button>}
      </div>
    </div>}
    {uploadError && <ConfigStateNotice kind="field" locale="ko" message={uploadError} />}
    {fieldError && <ConfigStateNotice kind="field" locale="ko" message={fieldError} />}
    {error && <ConfigStateNotice kind="patch" locale="ko" message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict} onClick={save}>
        {uncertainPatch ? '저장 결과 확인 및 재시도' : '로고 설정 저장'}
      </button>
    </SettingsSaveBar>
  </div>
}
