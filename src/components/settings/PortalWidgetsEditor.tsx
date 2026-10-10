'use client'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingItemCommand } from './useSettingItemCommand'
import { useLocale } from '@/components/providers/LocaleProvider'
import { MODULE_LABEL_KEY } from '@/lib/modules/labels'
import {
  defaultPortalWidgets, moveLayoutItem, parsePortalWidgets, portalWidgetDef, resolvePortalWidgets,
  type PortalWidgetId, type PortalWidgetSetting, type ResolvedWidgetSetting, type WidgetSize,
} from '@/lib/portal/widgets'

const fromLatest = (v: unknown) => { const p = parsePortalWidgets(v ?? []); return p.ok ? p.value : null }
/** 저장 형태(새 형태 — 네 칸을 모두 쓴다). 옛 형태로 저장돼 있던 값도 이 편집기에서 저장하면 새 형태가 된다 */
const toStored = (rows: readonly ResolvedWidgetSetting[]): PortalWidgetSetting => rows.map(({ id, enabled, size, inDefault }) => ({ id, enabled, size, inDefault }))

/**
 * 홈 위젯(portal.widgets — SP3b 스펙 §6.4 표, 2026-10-10 위젯 강화). 이 워크스페이스에서 쓸 수 있는 위젯(허용)과 기본 배치(순서·크기·기본으로 올릴지)를
 * 정한다. 구성원은 각자 홈을 구성하고(개인 설정), 여기서 끈 위젯은 누구에게도 보이지 않는다. 행마다 스위치와 위·아래 버튼(끌기만의 조작은 두지 않는다).
 * 초안은 저장 형태 그대로 두고(옛 형태로 읽은 값은 손대기 전까지 '바뀌지 않음'이다) 화면은 해석한 값(resolvePortalWidgets)으로 그린다.
 */
export function PortalWidgetsEditor({ workspaceId, revision, initial, invalidReason }: {
  workspaceId: string; revision: number; initial: PortalWidgetSetting | null; invalidReason?: string
}) {
  const { t } = useLocale()
  const c = useSettingItemCommand<PortalWidgetSetting>({ scope: { workspaceId }, key: 'portal.widgets', revision, initial, empty: defaultPortalWidgets(), fromLatest })
  const rows = resolvePortalWidgets(c.draft)
  const label = (id: PortalWidgetId) => t(portalWidgetDef(id).labelKey)
  const fill = (key: Parameters<typeof t>[0], id: PortalWidgetId) => t(key).replace('{id}', () => label(id))
  const move = (id: PortalWidgetId, step: -1 | 1) => { const next = moveLayoutItem(rows, id, step); if (next !== rows) c.setDraft(toStored(next)) }
  const patch = (id: PortalWidgetId, change: Partial<ResolvedWidgetSetting>) => c.setDraft(toStored(rows.map((w) => (w.id === id ? { ...w, ...change } : w))))
  const summary = (v: PortalWidgetSetting) => resolvePortalWidgets(v).map((w) =>
    `${label(w.id)}${w.enabled ? '' : t('settings.portalWidgets.offMark')}${w.enabled && w.inDefault ? ` · ${t('settings.portalWidgets.summaryDefault')} ${t(w.size === 'full' ? 'settings.portalWidgets.sizeFull' : 'settings.portalWidgets.sizeHalf')}` : ''}`).join(', ')
  const off = c.pending || c.uncertain
  return <div className="space-y-4">
    <p className="text-meta text-fg-secondary">{t('settings.portalWidgets.desc')}</p>
    <p className="text-meta text-fg-secondary">{t('settings.portalWidgets.defaultNote')}</p>
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" keyName="portal.widgets" message={invalidReason} isAdmin settingsHref="#workspace-menu" />}
    <ul aria-label={t('settings.portalWidgets.listAria')} className="space-y-2">
      {rows.map((w, i) => {
        const def = portalWidgetDef(w.id)
        return <li key={w.id} data-portal-widget-row={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius-control) bg-surface-subtle p-2">
          {/* 이름·설명은 줄어들고, 조작은 한 묶음(좁은 화면에서는 다음 줄로 내려간다) */}
          <span className="min-w-0 flex-1 basis-56">
            <span className="block text-sm text-fg">{label(w.id)}</span>
            <span className="block text-meta text-fg-secondary">{t(def.descKey)}{def.module ? ` ${t('settings.portalWidgets.moduleNote').replace('{module}', () => t(MODULE_LABEL_KEY[def.module!]))}` : ''}</span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <label className={`flex items-center gap-1.5 text-meta ${w.enabled ? 'text-fg' : 'text-fg-muted'}`}>
              <input type="checkbox" checked={w.inDefault} disabled={off || !w.enabled} aria-label={fill('settings.portalWidgets.inDefaultAria', w.id)}
                onChange={(e) => patch(w.id, { inDefault: e.target.checked })} />
              {t('settings.portalWidgets.inDefault')}
            </label>
            <select value={w.size} disabled={off || !w.enabled} aria-label={fill('settings.portalWidgets.sizeAria', w.id)} onChange={(e) => patch(w.id, { size: e.target.value as WidgetSize })}
              className="h-(--control-h) rounded-(--radius-control) border border-border-input bg-surface px-2 text-meta text-fg">
              <option value="half">{t('settings.portalWidgets.sizeHalf')}</option>
              <option value="full">{t('settings.portalWidgets.sizeFull')}</option>
            </select>
            <button type="button" role="switch" aria-checked={w.enabled} aria-label={fill('settings.portalWidgets.show', w.id)} disabled={off} onClick={() => patch(w.id, { enabled: !w.enabled })}
              className={`rounded-full px-3 py-1 text-meta font-semibold ${w.enabled ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
              {w.enabled ? t('account.notif.on') : t('account.notif.off')}
            </button>
            <button type="button" className="btn btn-ghost" aria-label={fill('settings.portalWidgets.up', w.id)} disabled={off || i === 0} onClick={() => move(w.id, -1)}>↑</button>
            <button type="button" className="btn btn-ghost" aria-label={fill('settings.portalWidgets.down', w.id)} disabled={off || i === rows.length - 1} onClick={() => move(w.id, 1)}>↓</button>
          </span>
        </li>
      })}
    </ul>
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
