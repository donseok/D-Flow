'use client'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingItemCommand } from './useSettingItemCommand'
import {
  DEFAULT_LOCAL_DRAFTS, LOCAL_DRAFTS_RETENTION_MAX, LOCAL_DRAFTS_RETENTION_MIN, parseLocalDraftsSetting, type LocalDraftsSetting,
} from '@/lib/settings/defs/security'

const fromLatest = (v: unknown) => { const p = parseLocalDraftsSetting(v ?? DEFAULT_LOCAL_DRAFTS); return p.ok ? p.value : null }
const summary = (v: LocalDraftsSetting) => (v.allowed ? `허용 · ${v.retention_days}일 보존` : '허용 안 함')

/**
 * 로컬 초안 정책(security.local_drafts — 개정 §5.8.5·§2.8.1) — 허용 스위치와 보존기간(1~30일). 저장 규약은 useSettingItemCommand
 * (expectedRevision CAS·409 비교·결과 불명 재확인). 끄면 편집 화면이 초안을 쓰지도 읽지도 않는다 — 이미 남은 초안은 로그아웃 때 지워진다.
 */
export function LocalDraftsEditor({ workspaceId, revision, initial, invalidReason }: {
  workspaceId: string; revision: number; initial: LocalDraftsSetting | null; invalidReason?: string
}) {
  const c = useSettingItemCommand<LocalDraftsSetting>({ scope: { workspaceId }, key: 'security.local_drafts', revision, initial, empty: { ...DEFAULT_LOCAL_DRAFTS }, fromLatest })
  const off = c.pending || c.uncertain
  const days = c.draft.retention_days
  const daysValid = Number.isInteger(days) && days >= LOCAL_DRAFTS_RETENTION_MIN && days <= LOCAL_DRAFTS_RETENTION_MAX
  return <div className="space-y-4">
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" locale="ko" keyName="security.local_drafts" message={invalidReason} isAdmin settingsHref="#workspace-security" />}
    <div className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
      <span className="min-w-0 flex-1 text-sm text-fg">이 브라우저에 초안 남기기</span>
      <button type="button" role="switch" aria-checked={c.draft.allowed} aria-label="로컬 초안 허용" disabled={off}
        onClick={() => c.setDraft({ ...c.draft, allowed: !c.draft.allowed })}
        className={`shrink-0 rounded-full px-3 py-1 text-meta font-semibold ${c.draft.allowed ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
        {c.draft.allowed ? '켜짐' : '꺼짐'}
      </button>
    </div>
    <label className="block max-w-xs">
      <span className="mb-1 block text-meta font-semibold text-fg-secondary">보존 기간(일)</span>
      <input type="number" inputMode="numeric" className="app-input" aria-label="초안 보존 기간(일)" aria-invalid={!daysValid}
        min={LOCAL_DRAFTS_RETENTION_MIN} max={LOCAL_DRAFTS_RETENTION_MAX} step={1} disabled={off || !c.draft.allowed}
        value={Number.isNaN(days) ? '' : days}
        onChange={(e) => c.setDraft({ ...c.draft, retention_days: e.target.value === '' ? Number.NaN : Number(e.target.value) })} />
      <span className="mt-1 block text-meta text-fg-secondary">
        {daysValid ? `${LOCAL_DRAFTS_RETENTION_MIN}~${LOCAL_DRAFTS_RETENTION_MAX}일. 이 기간이 지난 초안은 다음에 편집 화면을 열 때 지워집니다.` : `${LOCAL_DRAFTS_RETENTION_MIN}~${LOCAL_DRAFTS_RETENTION_MAX} 사이의 정수를 넣으세요.`}
      </span>
    </label>
    {!c.draft.allowed && <p className="text-meta text-fg-secondary">끄면 편집 화면이 초안을 저장하지도 되살리지도 않습니다. 이미 브라우저에 남은 초안은 각 사람이 로그아웃할 때 지워집니다.</p>}
    {c.fieldError && <ConfigStateNotice kind="field" locale="ko" message={c.fieldError} />}
    {c.conflict && <ConflictCompare rows={[{ key: 'security.local_drafts', label: '로컬 초안', mine: daysValid ? summary(c.draft) : '입력 오류', latest: c.conflict.value ? summary(c.conflict.value) : '설정 손상' }]}
      onMine={c.keepMine} onLatest={c.useLatest} latestAvailable={!!c.conflict.value} />}
    {c.error && <ConfigStateNotice kind="patch" locale="ko" message={c.error} />}
    <SettingsSaveBar notice={c.notice}>
      <button type="button" className="btn btn-primary" aria-label="로컬 초안 정책 저장" disabled={c.pending || !daysValid || (!c.dirty && !c.uncertain) || !!c.conflict} onClick={c.save}>
        {c.uncertain ? '저장 결과 확인 및 재시도' : '로컬 초안 정책 저장'}
      </button>
    </SettingsSaveBar>
  </div>
}
