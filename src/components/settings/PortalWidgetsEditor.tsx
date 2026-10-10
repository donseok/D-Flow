'use client'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingItemCommand } from './useSettingItemCommand'
import { useLocale } from '@/components/providers/LocaleProvider'
import { PORTAL_WIDGETS, defaultPortalWidgets, parsePortalWidgets, type PortalWidgetId, type PortalWidgetSetting } from '@/lib/portal/widgets'

const COLUMNS = [{ id: 'main', label: 'settings.portalWidgets.colMain' }, { id: 'side', label: 'settings.portalWidgets.colSide' }] as const
const columnOf = new Map(PORTAL_WIDGETS.map((w) => [w.id, w.column]))
const labelKeyOf = new Map(PORTAL_WIDGETS.map((w) => [w.id, w.labelKey]))
const fromLatest = (v: unknown) => { const p = parsePortalWidgets(v ?? []); return p.ok ? p.value : null }

/**
 * 홈 위젯(portal.widgets — SP3b 스펙 §6.4 표, 네 연결 ②) — 행마다 스위치와 위·아래 버튼(끌기만의 조작은 두지 않는다).
 * 열 배치는 제품 고정이라(D25) 같은 열 안에서만 옮긴다. 보내는 값은 항목마다 { id, enabled } 둘뿐이다(여분 필드는 서버가 거부).
 */
export function PortalWidgetsEditor({ workspaceId, revision, initial, invalidReason }: {
  workspaceId: string; revision: number; initial: PortalWidgetSetting | null; invalidReason?: string
}) {
  const { t } = useLocale()
  const c = useSettingItemCommand<PortalWidgetSetting>({ scope: { workspaceId }, key: 'portal.widgets', revision, initial, empty: defaultPortalWidgets(), fromLatest })
  const label = (id: PortalWidgetId) => t(labelKeyOf.get(id)!)
  const move = (id: PortalWidgetId, step: -1 | 1) => {
    const col = columnOf.get(id)
    const sib = c.draft.filter((w) => columnOf.get(w.id) === col)
    const to = sib.findIndex((w) => w.id === id) + step
    if (to < 0 || to >= sib.length) return
    const next = [...c.draft]
    const a = next.findIndex((w) => w.id === id), b = next.findIndex((w) => w.id === sib[to].id)
    ;[next[a], next[b]] = [next[b], next[a]]
    c.setDraft(next)
  }
  const toggle = (id: PortalWidgetId) => c.setDraft(c.draft.map((w) => (w.id === id ? { id: w.id, enabled: !w.enabled } : w)))
  const summary = (v: PortalWidgetSetting) => v.map((w) => `${label(w.id)}${w.enabled ? '' : t('settings.portalWidgets.offMark')}`).join(', ')
  const off = c.pending || c.uncertain
  return <div className="space-y-4">
    <p className="text-meta text-fg-secondary">{t('settings.portalWidgets.desc')}</p>
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" keyName="portal.widgets" message={invalidReason} isAdmin settingsHref="#workspace-menu" />}
    {COLUMNS.map((col) => {
      const rows = c.draft.filter((w) => columnOf.get(w.id) === col.id)
      return <fieldset key={col.id} role="group" aria-label={t(col.label)} className="rounded-(--radius-panel) border border-border p-3">
        <legend className="px-1 text-meta font-semibold text-fg-secondary">{t(col.label)}</legend>
        <ul className="space-y-2">
          {rows.map((w, i) => <li key={w.id} className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
            {/* 이름은 줄어들고(390 에서 조작이 다음 줄로 밀리지 않게) 조작 셋은 한 묶음 */}
            <span className="min-w-0 flex-1 text-sm text-fg">{label(w.id)}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" role="switch" aria-checked={w.enabled} aria-label={t('settings.portalWidgets.show').replace('{id}', String(label(w.id)))} disabled={off} onClick={() => toggle(w.id)}
                className={`rounded-full px-3 py-1 text-meta font-semibold ${w.enabled ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
                {w.enabled ? t('account.notif.on') : t('account.notif.off')}
              </button>
              <button type="button" className="btn btn-ghost" aria-label={t('settings.portalWidgets.up').replace('{id}', String(label(w.id)))} disabled={off || i === 0} onClick={() => move(w.id, -1)}>↑</button>
              <button type="button" className="btn btn-ghost" aria-label={t('settings.portalWidgets.down').replace('{id}', String(label(w.id)))} disabled={off || i === rows.length - 1} onClick={() => move(w.id, 1)}>↓</button>
            </span>
          </li>)}
        </ul>
      </fieldset>
    })}
    {c.fieldError && <ConfigStateNotice kind="field" message={c.fieldError} />}
    {c.conflict && <ConflictCompare rows={[{ key: 'portal.widgets', label: t('settings.portal.widgets.label'), mine: summary(c.draft), latest: c.conflict.value ? summary(c.conflict.value) : t('settings.notify.policy.corrupted') }]}
      onMine={c.keepMine} onLatest={c.useLatest} latestAvailable={!!c.conflict.value} />}
    {c.error && <ConfigStateNotice kind="patch" message={c.error} />}
    <SettingsSaveBar notice={c.notice}>
      <button type="button" className="btn btn-primary" aria-label={t('settings.portalWidgets.save')} disabled={c.pending || (!c.dirty && !c.uncertain) || !!c.conflict} onClick={c.save}>
        {c.uncertain ? t('settings.workflow.retry') : t('settings.portalWidgets.save')}
      </button>
    </SettingsSaveBar>
  </div>
}
