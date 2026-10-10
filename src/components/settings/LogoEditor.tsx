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
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

const EMPTY: BrandingLogo = { full: null, full_dark: null, mark: null }
// 편집하는 슬롯 — full_dark(어두운 배경 로고)는 라이트 전용 결정(2026-10-10)으로 쓰이지 않는다. 저장 형태의 세 슬롯은 그대로라
// (Storage 정책·설정 파서가 같은 모양을 본다) 그 칸은 값을 건드리지 않고 그대로 실어 보낸다.
type ShownSlot = Exclude<BrandingSlot, 'full_dark'>
const SHOWN_SLOTS = BRANDING_SLOTS.filter((slot): slot is ShownSlot => slot !== 'full_dark')
const LABEL: Record<ShownSlot, DictKey> = { full: 'settings.logo.slot.full', mark: 'settings.logo.slot.mark' }
const same = (a: BrandingLogo, b: BrandingLogo) => BRANDING_SLOTS.every(slot => a[slot] === b[slot])
/** 선택한 파일의 로컬 미리보기 주소 — 서버에 요청하지 않는다(저장 전 경로는 /api/brand 가 주지 않는다). 지원하지 않으면 null. */
function localPreview(file: File): string | null {
  try { return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null } catch { return null }
}
function revoke(url: string | undefined) { try { if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url) } catch { /* 미리보기 정리 실패는 무시 */ } }

export function LogoEditor({ workspaceId, revision, initialLogo, invalidReason }: {
  workspaceId: string; revision: number; initialLogo: BrandingLogo | null; invalidReason?: string
}) {
  const { t } = useLocale()
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

  function upload(slot: ShownSlot) {
    const file = files[slot]
    if (!file) return
    setError(null); setUploadError(null); setNotice(null)
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof uploadBrandLogo>>
      try { result = await uploadBrandLogo(workspaceId, slot, file) }
      catch { setUploadError(t('settings.logo.uploadUncertain')); return }
      if (!result.ok) { setUploadError(result.error); return }
      setDraft(current => ({ ...current, [slot]: result.path }))
      setFiles(current => ({ ...current, [slot]: undefined }))
      setNotice(t('settings.logo.uploaded').replace('{slot}', t(LABEL[slot])))
    })
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(draft); setBaseRevision(result.revision); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.logo.saved')); router.refresh(); return
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
        setNotice(t('settings.save.confirmed')); router.refresh(); return
      }
    } catch { /* 같은 명령으로 다시 보낸다 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch)
    setError(t('settings.rootFolders.uncertain'))
  }

  function save() {
    if (!dirty && !uncertainPatch) return
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'branding.logo': draft }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-4">
    <p className="text-xs leading-5 text-fg-secondary">{t('settings.logo.desc')}</p>
    {invalidReason && needsRepair && <ConfigStateNotice kind="invalid" locale="ko" keyName="branding.logo" message={invalidReason} isAdmin settingsHref="#workspace-general" />}
    <div className="grid gap-3 sm:grid-cols-2">
      {SHOWN_SLOTS.map(slot => <div key={slot} className="space-y-2 rounded-xl border border-border p-3">
        <div className="text-sm font-semibold text-fg">{t(LABEL[slot])}</div>
        {draft[slot] ? <>
          {draft[slot] === baseline[slot] ? <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/brand/${workspaceId}/${slot}`} alt={t('settings.logo.preview').replace('{slot}', t(LABEL[slot]))} className="h-16 max-w-full object-contain" />
          </> : <>
            {previews[slot] && <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[slot]} alt={t('settings.logo.newPreview').replace('{slot}', t(LABEL[slot]))} className="h-16 max-w-full object-contain" />
            </>}
            <p className="text-xs text-pending">{t('settings.logo.uploadedMark')} {previews[slot] ? t('settings.logo.appliesOnSave') : t('settings.logo.previewAfterSave')}</p>
          </>}
          <p className="break-all text-meta text-fg-muted">{draft[slot]}</p>
        </> : <p className="text-xs text-fg-secondary">{t('settings.logo.noImage')}</p>}
        <input type="file" accept="image/png,image/jpeg,image/webp" aria-label={t('settings.logo.fileOf').replace('{slot}', t(LABEL[slot]))} className="block w-full min-w-0 max-w-full text-xs text-fg-secondary file:mr-2 file:rounded-lg file:border file:border-border file:bg-surface-subtle file:px-2 file:py-1 file:text-xs"
          disabled={pending || !!uncertainPatch} onChange={event => {
            const picked = event.target.files?.[0]
            revoke(previews[slot]); setFiles({ ...files, [slot]: picked })
            setPreviews(current => ({ ...current, [slot]: picked ? (localPreview(picked) ?? undefined) : undefined }))
            event.target.value = ''
          }} />
        {files[slot] && <p className="break-all text-xs text-fg-secondary">{t('settings.logo.selected').replace('{name}', String(files[slot].name))}</p>}
        {files[slot] && previews[slot] && draft[slot] === baseline[slot] && <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previews[slot]} alt={t('settings.logo.selectedPreview').replace('{slot}', t(LABEL[slot]))} className="h-16 max-w-full object-contain" />
        </>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost" disabled={pending || !files[slot] || !!uncertainPatch} onClick={() => upload(slot)}>{t('settings.logo.upload')}</button>
          {draft[slot] && <button type="button" className="btn btn-ghost" disabled={pending || !!uncertainPatch}
            onClick={() => { setDraft({ ...draft, [slot]: null }); setError(null); setNotice(null) }}>{t('settings.logo.remove')}</button>}
        </div>
      </div>)}
    </div>
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>{t('settings.logo.conflict')}</strong>
      {SHOWN_SLOTS.map(slot => <p key={slot}>{t(LABEL[slot])} {t('settings.logo.mine')} {draft[slot] ?? t('common.none')} {t('settings.logo.latest')} {conflict.logo?.[slot] ?? t('common.none')}</p>)}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.logo ?? EMPTY); setBaseRevision(conflict.revision); setNeedsRepair(conflict.logo === null); setConflict(null) }}>{t('settings.conflict.reapplyMine')}</button>
        {conflict.logo && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(conflict.logo!); setBaseline(conflict.logo!); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null) }}>{t('settings.conflict.useLatest')}</button>}
      </div>
    </div>}
    {uploadError && <ConfigStateNotice kind="field" locale="ko" message={uploadError} />}
    {fieldError && <ConfigStateNotice kind="field" locale="ko" message={fieldError} />}
    {error && <ConfigStateNotice kind="patch" locale="ko" message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!conflict} onClick={save}>
        {uncertainPatch ? t('settings.workflow.retry') : t('settings.logo.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
