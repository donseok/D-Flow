'use client'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingItemCommand } from './useSettingItemCommand'
import {
  DEFAULT_LOCAL_DRAFTS, LOCAL_DRAFTS_RETENTION_MAX, LOCAL_DRAFTS_RETENTION_MIN, parseLocalDraftsSetting, type LocalDraftsSetting,
} from '@/lib/settings/defs/security'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

type T = (k: DictKey) => string

const fromLatest = (v: unknown) => { const p = parseLocalDraftsSetting(v ?? DEFAULT_LOCAL_DRAFTS); return p.ok ? p.value : null }
const summary = (v: LocalDraftsSetting, t: T) => (v.allowed ? t('settings.localDrafts.allowedSummary').replace('{retention_days}', String(v.retention_days)) : t('settings.localDrafts.notAllowed'))

/**
 * 로컬 초안 정책(security.local_drafts — 개정 §5.8.5·§2.8.1) — 허용 스위치와 보존기간(1~30일). 저장 규약은 useSettingItemCommand
 * (expectedRevision CAS·409 비교·결과 불명 재확인). 끄면 편집 화면이 초안을 쓰지도 읽지도 않는다 — 이미 남은 초안은 로그아웃 때 지워진다.
 */
export function LocalDraftsEditor({ workspaceId, revision, initial, invalidReason }: {
  workspaceId: string; revision: number; initial: LocalDraftsSetting | null; invalidReason?: string
}) {
  const { t } = useLocale()
  const c = useSettingItemCommand<LocalDraftsSetting>({ scope: { workspaceId }, key: 'security.local_drafts', revision, initial, empty: { ...DEFAULT_LOCAL_DRAFTS }, fromLatest })
  const off = c.pending || c.uncertain
  const days = c.draft.retention_days
  const daysValid = Number.isInteger(days) && days >= LOCAL_DRAFTS_RETENTION_MIN && days <= LOCAL_DRAFTS_RETENTION_MAX
  return <div className="space-y-4">
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" keyName="security.local_drafts" message={invalidReason} isAdmin settingsHref="#workspace-security" />}
    <div className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
      <span className="min-w-0 flex-1 text-sm text-fg">{t('settings.localDrafts.keep')}</span>
      <button type="button" role="switch" aria-checked={c.draft.allowed} aria-label={t('settings.localDrafts.allowAria')} disabled={off}
        onClick={() => c.setDraft({ ...c.draft, allowed: !c.draft.allowed })}
        className={`shrink-0 rounded-full px-3 py-1 text-meta font-semibold ${c.draft.allowed ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
        {c.draft.allowed ? t('account.notif.on') : t('account.notif.off')}
      </button>
    </div>
    <label className="block max-w-xs">
      <span className="mb-1 block text-meta font-semibold text-fg-secondary">{t('settings.localDrafts.retention')}</span>
      <input type="number" inputMode="numeric" className="app-input" aria-label={t('settings.localDrafts.retentionAria')} aria-invalid={!daysValid}
        min={LOCAL_DRAFTS_RETENTION_MIN} max={LOCAL_DRAFTS_RETENTION_MAX} step={1} disabled={off || !c.draft.allowed}
        value={Number.isNaN(days) ? '' : days}
        onChange={(e) => c.setDraft({ ...c.draft, retention_days: e.target.value === '' ? Number.NaN : Number(e.target.value) })} />
      <span className="mt-1 block text-meta text-fg-secondary">
        {daysValid ? t('settings.localDrafts.rangeHint').replace('{LOCAL_DRAFTS_RETENTION_MIN}', String(LOCAL_DRAFTS_RETENTION_MIN)).replace('{LOCAL_DRAFTS_RETENTION_MAX}', String(LOCAL_DRAFTS_RETENTION_MAX)) : t('settings.localDrafts.rangeError').replace('{LOCAL_DRAFTS_RETENTION_MIN}', String(LOCAL_DRAFTS_RETENTION_MIN)).replace('{LOCAL_DRAFTS_RETENTION_MAX}', String(LOCAL_DRAFTS_RETENTION_MAX))}
      </span>
    </label>
    {!c.draft.allowed && <p className="text-meta text-fg-secondary">{t('settings.localDrafts.offNote')}</p>}
    {c.fieldError && <ConfigStateNotice kind="field" message={c.fieldError} />}
    {c.conflict && <ConflictCompare rows={[{ key: 'security.local_drafts', label: t('settings.security.local_drafts.label'), mine: daysValid ? summary(c.draft, t) : t('settings.localDrafts.inputError'), latest: c.conflict.value ? summary(c.conflict.value, t) : t('settings.notify.policy.corrupted') }]}
      onMine={c.keepMine} onLatest={c.useLatest} latestAvailable={!!c.conflict.value} />}
    {c.error && <ConfigStateNotice kind="patch" message={c.error} />}
    <SettingsSaveBar notice={c.notice}>
      <button type="button" className="btn btn-primary" aria-label={t('settings.localDrafts.save')} disabled={c.pending || !daysValid || (!c.dirty && !c.uncertain) || !!c.conflict} onClick={c.save}>
        {c.uncertain ? t('settings.workflow.retry') : t('settings.localDrafts.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
