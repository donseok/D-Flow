'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  getSettingsCommandOutcome, updateProjectSettings, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch,
} from '@/app/actions/settings'
import { newUuid } from '@/lib/domain/uuid'
import { MINUTES_ATTACHMENT_MAX_BYTES, MINUTES_ATTACHMENTS_MAX_COUNT } from '@/lib/domain/minutes'
import { DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy, type AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { formatBytes } from '@/lib/minutes/attachmentQueue'
import { useLocale } from '@/components/providers/LocaleProvider'

const KEY = 'minutes.attachments'
const MB = 1024 * 1024

/** 화면 입력(MB·쉼표 목록) — 저장 값(바이트·배열|null)과 분리해 둔다. 입력 중의 빈칸·소수가 저장 값을 깨지 않게. */
interface Draft {
  enabled: boolean
  previewEnabled: boolean
  maxFileMb: string
  maxCount: string
  maxTotalMb: string
  extMode: 'any' | 'list'
  extText: string
}

const mbText = (bytes: number) => String(Math.round((bytes / MB) * 100) / 100)
function toDraft(p: AttachmentPolicy): Draft {
  return {
    enabled: p.enabled, previewEnabled: p.previewEnabled,
    maxFileMb: mbText(p.maxFileBytes), maxCount: String(p.maxCount), maxTotalMb: mbText(p.maxTotalBytes),
    extMode: p.allowedExtensions === null ? 'any' : 'list', extText: (p.allowedExtensions ?? []).join(', '),
  }
}
/** MB 입력 → 바이트. 운영 상한(정확히 20MB = 20,971,520)을 반올림 오차 없이 맞추려고 2자리 반올림 뒤 정수 바이트. 숫자가 아니면 NaN(파서가 거부). */
const mbToBytes = (text: string) => {
  const n = Number(text.trim())
  return text.trim() === '' || !Number.isFinite(n) ? Number.NaN : Math.round(n * MB)
}
export function draftToRaw(d: Draft): unknown {
  return {
    enabled: d.enabled, previewEnabled: d.previewEnabled,
    maxFileBytes: mbToBytes(d.maxFileMb), maxCount: d.maxCount.trim() === '' ? Number.NaN : Number(d.maxCount),
    maxTotalBytes: mbToBytes(d.maxTotalMb),
    // 목록 모드의 빈 입력은 [](모두 거부)다 — null(제한 없음)과 다르다. 소문자로만 맞추고 나머지 형식 검사는 파서가 한다.
    allowedExtensions: d.extMode === 'any' ? null
      : d.extText.split(/[\s,]+/).map(s => s.replace(/^\./, '').trim().toLowerCase()).filter(Boolean),
  }
}

/**
 * 회의록 첨부 정책 편집기(SP5 B3 과제9) — 워크스페이스·프로젝트 설정에 같은 컴포넌트를 쓴다. 저장은 설정 명령(useSettingsCommand 와 같은
 * CAS·명령 id·불확실 결과 재확인)이고 검증은 순수 파서(parseAttachmentPolicy — 운영 상한·총량 관계·확장자 형식)다. 서버가 다시 검증한다.
 * 저장된 값이 손상이면 제품 기본값으로 시작해 저장으로 고치게 한다(복구 경로). future_only — 기존 첨부는 건드리지 않는다.
 */
export function AttachmentPolicyEditor({ scope, policy, invalid = false, revision, canEdit }: {
  scope: { projectId: string } | { workspaceId: string }
  /** 저장된(또는 기본) 정책. 손상이면 null 과 invalid=true. */
  policy: AttachmentPolicy | null
  invalid?: boolean
  revision: number
  canEdit: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const start = policy ?? DEFAULT_ATTACHMENT_POLICY
  const [draft, setDraft] = useState<Draft>(() => toDraft(start))
  const [baseline, setBaseline] = useState<Draft>(() => toDraft(start))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [repaired, setRepaired] = useState(!invalid)
  const [pending, startTransition] = useTransition()
  const parsed = parseAttachmentPolicy(draftToRaw(draft))
  // 손상 값은 같은 입력이어도 저장해야 고쳐진다 — 기본값과 같아도 dirty 로 본다.
  const dirty = !repaired || JSON.stringify(draft) !== JSON.stringify(baseline)
  const locked = !canEdit || pending || !!uncertainPatch

  const run = (patch: SettingsPatch) => 'projectId' in scope
    ? updateProjectSettings(scope.projectId, patch)
    : updateWorkspaceSettings(scope.workspaceId, patch)
  function applied(next: AttachmentPolicy, rev: number, message: string) {
    const d = toDraft(next)
    setBaseline(d); setDraft(d); setBaseRevision(rev); setRepaired(true)
    setUncertainPatch(null); setError(''); setNotice(message)
    router.refresh()
  }
  async function submit(patch: SettingsPatch, next: AttachmentPolicy): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await run(patch) } catch { /* 명령 이력에서 반영 여부를 확인한다 */ }
    if (result?.ok) { applied(next, result.revision, t('settings.minAtt.saved')); return }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) { setError(result.error); setUncertainPatch(null); return }
    try {
      const outcome = await getSettingsCommandOutcome(scope, patch.commandId)
      if (outcome.ok && outcome.outcome.status === 'applied') { applied(next, outcome.outcome.revision, t('settings.minAtt.confirmed')); return }
    } catch { /* 같은 명령을 다시 보내도록 보류한다 */ }
    setUncertainPatch(patch); setError(t('settings.minAtt.uncertain'))
  }
  function save() {
    if (!parsed.ok) { setError(parsed.error); return }
    const next = parsed.value
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { [KEY]: next }, unset: [] }
    setError(''); setNotice('')
    startTransition(() => { void submit(patch, (patch.set[KEY] as AttachmentPolicy | undefined) ?? next) })
  }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(prev => ({ ...prev, [key]: value })); setError(''); setNotice('') }

  return <div className="space-y-4" data-attachment-policy-editor>
    {invalid && !repaired && <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{t('settings.minAtt.invalid')}</p>}
    <div className="flex flex-wrap gap-x-6 gap-y-2">
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={draft.enabled} disabled={locked} onChange={e => change('enabled', e.target.checked)} />{t('settings.minAtt.enabled')}
      </label>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" checked={draft.previewEnabled} disabled={locked} onChange={e => change('previewEnabled', e.target.checked)} />{t('settings.minAtt.preview')}
      </label>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{t('settings.minAtt.maxFile')}
        <input className="app-input" inputMode="decimal" aria-label={t('settings.minAtt.maxFile')} value={draft.maxFileMb} disabled={locked} onChange={e => change('maxFileMb', e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{t('settings.minAtt.maxCount')}
        <input className="app-input" inputMode="numeric" aria-label={t('settings.minAtt.maxCount')} value={draft.maxCount} disabled={locked} onChange={e => change('maxCount', e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">{t('settings.minAtt.maxTotal')}
        <input className="app-input" inputMode="decimal" aria-label={t('settings.minAtt.maxTotal')} value={draft.maxTotalMb} disabled={locked} onChange={e => change('maxTotalMb', e.target.value)} />
      </label>
    </div>
    <p className="text-xs text-fg-muted">
      {t('settings.minAtt.limits').replace('{max}', formatBytes(MINUTES_ATTACHMENT_MAX_BYTES)).replace('{count}', String(MINUTES_ATTACHMENTS_MAX_COUNT))}
    </p>
    <fieldset className="space-y-2">
      <legend className="text-xs text-fg-secondary">{t('settings.minAtt.extMode')}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg">
        <label className="flex items-center gap-2"><input type="radio" name="min-att-ext" checked={draft.extMode === 'any'} disabled={locked} onChange={() => change('extMode', 'any')} />{t('settings.minAtt.extAny')}</label>
        <label className="flex items-center gap-2"><input type="radio" name="min-att-ext" checked={draft.extMode === 'list'} disabled={locked} onChange={() => change('extMode', 'list')} />{t('settings.minAtt.extList')}</label>
      </div>
      {draft.extMode === 'list' && <>
        <input className="app-input" aria-label={t('settings.minAtt.extList')} placeholder={t('settings.minAtt.extPlaceholder')} value={draft.extText} disabled={locked} onChange={e => change('extText', e.target.value)} />
        {parsed.ok && parsed.value.allowedExtensions?.length === 0 && <p className="text-xs text-danger">{t('settings.minAtt.extEmpty')}</p>}
      </>}
    </fieldset>
    <p className="text-xs text-fg-secondary">{t('settings.minAtt.futureOnly')}</p>
    {!parsed.ok && <p role="alert" className="text-sm text-danger">{parsed.error}</p>}
    {error && parsed.ok && <p role="alert" className="text-sm text-danger">{error}</p>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    <button type="button" className="btn btn-primary" disabled={!canEdit || pending || !dirty || !parsed.ok} onClick={save}>
      {pending ? '…' : uncertainPatch ? t('settings.minAtt.retry') : t('settings.minAtt.save')}
    </button>
  </div>
}
