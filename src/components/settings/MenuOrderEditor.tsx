'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { NAV_GROUP_OF, NAV_ITEM_IDS, type NavGroupId, type NavItemId } from '@/lib/nav/ids'
import { NAV_DEFAULT_LABEL_KEY } from '@/lib/nav/registry'
import type { NavMenuSetting } from '@/lib/settings/defs/workspace'
import { newUuid } from '@/lib/domain/uuid'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

const GROUPS: readonly { id: NavGroupId; label: DictKey }[] = [
  { id: 'ws.main', label: 'settings.menu.group.wsMain' }, { id: 'ws.shared', label: 'settings.menu.group.wsShared' },
  { id: 'ws.ops', label: 'settings.menu.group.wsOps' }, { id: 'ws.platform', label: 'settings.menu.group.wsPlatform' },
  { id: 'p.overview', label: 'settings.menu.group.pOverview' }, { id: 'p.plan', label: 'settings.menu.group.pPlan' },
  { id: 'p.collab', label: 'settings.menu.group.pCollab' }, { id: 'p.team', label: 'settings.menu.group.pTeam' },
  { id: 'p.settings', label: 'settings.menu.group.pSettings' },
]
// 기본 이름은 사이드바와 같은 원천(nav/registry 의 NAV_DEFAULT_LABEL_KEY)에서 꺼낸다 — 여기 표를 따로 두지 않는다(BUG-25)
const nameKey = (id: NavItemId): DictKey => NAV_DEFAULT_LABEL_KEY[id]
const EMPTY: NavMenuSetting = { order: [], labels: {} }

function ordered(menu: NavMenuSetting): NavItemId[] {
  const rank = new Map(menu.order.map((id, i) => [id, i]))
  return GROUPS.flatMap(group => NAV_ITEM_IDS.filter(id => NAV_GROUP_OF[id] === group.id).sort((a, b) => {
    const ar = rank.get(a), br = rank.get(b)
    if (ar !== undefined && br !== undefined) return ar - br
    if (ar !== undefined) return -1
    if (br !== undefined) return 1
    return NAV_ITEM_IDS.indexOf(a) - NAV_ITEM_IDS.indexOf(b)
  }))
}
const same = (a: NavMenuSetting, b: NavMenuSetting) => JSON.stringify(a) === JSON.stringify(b)
function fromLatest(value: unknown): NavMenuSetting | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const v = value as Partial<NavMenuSetting>
  return Array.isArray(v.order) && typeof v.labels === 'object' && v.labels !== null ? v as NavMenuSetting : null
}

export function MenuOrderEditor({ workspaceId, revision, initialMenu, invalidReason }: {
  workspaceId: string; revision: number; initialMenu: NavMenuSetting | null; invalidReason?: string
}) {
  const { t } = useLocale()
  const router = useRouter()
  const [baseline, setBaseline] = useState<NavMenuSetting>(initialMenu ?? EMPTY)
  const [draft, setDraft] = useState<NavMenuSetting>(initialMenu ?? EMPTY)
  const [displayOrder, setDisplayOrder] = useState<NavItemId[]>(() => ordered(initialMenu ?? EMPTY))
  const [baseRevision, setBaseRevision] = useState(revision)
  const [needsRepair, setNeedsRepair] = useState(initialMenu === null)
  const [conflict, setConflict] = useState<{ revision: number; menu: NavMenuSetting | null } | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const dirty = needsRepair || !same(baseline, draft)
  const badLabel = Object.entries(draft.labels).find(([, label]) => !label || label.length > 20 || /[<>]/.test(label))

  function move(id: NavItemId, step: -1 | 1) {
    const group = NAV_GROUP_OF[id]
    const siblings = displayOrder.filter(x => NAV_GROUP_OF[x] === group)
    const from = siblings.indexOf(id), to = from + step
    if (to < 0 || to >= siblings.length) return
    const next = [...displayOrder]
    const a = next.indexOf(id), b = next.indexOf(siblings[to])
    ;[next[a], next[b]] = [next[b], next[a]]
    setDisplayOrder(next)
    setDraft(current => ({ ...current, order: next }))
  }

  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await updateWorkspaceSettings(workspaceId, patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) {
      setBaseline(draft); setBaseRevision(result.revision); setNeedsRepair(false); setUncertainPatch(null); setFieldError(null)
      setNotice(result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.menu.saved')); router.refresh(); return
    }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, menu: fromLatest(result.latest.values['navigation.menu']) })
      setUncertainPatch(null); setFieldError(null); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const field = result.kind === 'invalid' ? result.fieldErrors.find(e => e.key === 'navigation.menu') : undefined
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
    } catch { /* 같은 명령으로 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch); setError(t('settings.rootFolders.uncertain'))
  }

  function save() {
    if ((!dirty && !uncertainPatch) || badLabel) return
    setError(null); setFieldError(null); setNotice(null)
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set: { 'navigation.menu': draft }, unset: [] }
    startTransition(async () => submit(patch))
  }

  return <div className="space-y-5">
    <p className="text-xs leading-5 text-fg-secondary">{t('settings.menu.desc')}</p>
    {invalidReason && needsRepair && <ConfigStateNotice kind="invalid" keyName="navigation.menu" message={invalidReason} isAdmin settingsHref="#workspace-menu" />}
    {GROUPS.map(group => <section key={group.id} className="rounded-xl border border-border p-3">
      <h3 className="mb-3 text-sm font-semibold text-fg">{t(group.label)}</h3>
      <div className="space-y-2">
        {displayOrder.filter(id => NAV_GROUP_OF[id] === group.id).map((id, index, siblings) => <div key={id} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-subtle p-2">
          <span className="min-w-24 text-sm text-fg">{t(nameKey(id))}</span>
          <span className="text-meta text-fg-muted">{id}</span>
          <input aria-label={t('settings.menu.nameOf').replace('{id}', t(nameKey(id)))} className="app-input ml-auto w-36 text-sm" maxLength={20}
            placeholder={t(nameKey(id))} value={draft.labels[id] ?? ''} disabled={pending || !!uncertainPatch}
            onChange={event => { const value = event.target.value; setDraft(current => {
              const labels = { ...current.labels }; if (value) labels[id] = value; else delete labels[id]
              return { ...current, labels }
            }) }} />
          <button type="button" className="btn btn-ghost" aria-label={t('settings.portalWidgets.up').replace('{id}', t(nameKey(id)))} disabled={pending || !!uncertainPatch || index === 0} onClick={() => move(id, -1)}>↑</button>
          <button type="button" className="btn btn-ghost" aria-label={t('settings.portalWidgets.down').replace('{id}', t(nameKey(id)))} disabled={pending || !!uncertainPatch || index === siblings.length - 1} onClick={() => move(id, 1)}>↓</button>
        </div>)}
      </div>
    </section>)}
    {badLabel && <ConfigStateNotice kind="field" message={t('settings.menu.badLabel').replace('{badLabel}', String(badLabel[0]))} />}
    {fieldError && <ConfigStateNotice kind="field" message={fieldError} />}
    {conflict && <div role="alert" className="space-y-2 rounded-xl border border-pending/30 bg-pending-weak p-4 text-sm">
      <strong>{t('settings.menu.conflict')}</strong>
      <p>{t('settings.menu.mine')} {draft.order.join(', ') || t('settings.menu.defaultOrder')}</p>
      <p>{t('settings.menu.latest')} {conflict.menu?.order.join(', ') || t('settings.menu.corruptedOrDefault')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => { setBaseline(conflict.menu ?? EMPTY); setBaseRevision(conflict.revision); setNeedsRepair(conflict.menu === null); setConflict(null) }}>{t('settings.conflict.reapplyMine')}</button>
        {conflict.menu && <button type="button" className="btn btn-ghost" onClick={() => { setDraft(conflict.menu!); setBaseline(conflict.menu!); setDisplayOrder(ordered(conflict.menu!)); setBaseRevision(conflict.revision); setNeedsRepair(false); setConflict(null) }}>{t('settings.conflict.useLatest')}</button>}
      </div>
    </div>}
    {error && <ConfigStateNotice kind="patch" message={error} />}
    <SettingsSaveBar notice={notice}>
      <button type="button" className="btn btn-primary" disabled={pending || (!dirty && !uncertainPatch) || !!badLabel || !!conflict} onClick={save}>
        {uncertainPatch ? t('settings.workflow.retry') : t('settings.menu.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
