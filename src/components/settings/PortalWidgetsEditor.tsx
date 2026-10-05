'use client'
import { ConflictCompare } from './ConflictCompare'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingItemCommand } from './useSettingItemCommand'
import { useLocale } from '@/components/providers/LocaleProvider'
import { PORTAL_WIDGETS, defaultPortalWidgets, parsePortalWidgets, type PortalWidgetId, type PortalWidgetSetting } from '@/lib/portal/widgets'

const COLUMNS = [{ id: 'main', label: '주 열' }, { id: 'side', label: '보조 열' }] as const
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
  const summary = (v: PortalWidgetSetting) => v.map((w) => `${label(w.id)}${w.enabled ? '' : '(꺼짐)'}`).join(', ')
  const off = c.pending || c.uncertain
  return <div className="space-y-4">
    <p className="text-meta text-fg-secondary">홈에 보일 위젯과 열 안의 순서를 정합니다. 각 사람은 홈에서 위젯을 숨길 수 있습니다.</p>
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" locale="ko" keyName="portal.widgets" message={invalidReason} isAdmin settingsHref="#workspace-menu" />}
    {COLUMNS.map((col) => {
      const rows = c.draft.filter((w) => columnOf.get(w.id) === col.id)
      return <fieldset key={col.id} role="group" aria-label={col.label} className="rounded-(--radius-panel) border border-border p-3">
        <legend className="px-1 text-meta font-semibold text-fg-secondary">{col.label}</legend>
        <ul className="space-y-2">
          {rows.map((w, i) => <li key={w.id} className="flex items-center gap-2 rounded-(--radius-control) bg-surface-subtle p-2">
            {/* 이름은 줄어들고(390 에서 조작이 다음 줄로 밀리지 않게) 조작 셋은 한 묶음 */}
            <span className="min-w-0 flex-1 text-sm text-fg">{label(w.id)}</span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" role="switch" aria-checked={w.enabled} aria-label={`${label(w.id)} 보이기`} disabled={off} onClick={() => toggle(w.id)}
                className={`rounded-full px-3 py-1 text-meta font-semibold ${w.enabled ? 'bg-action text-action-fg' : 'bg-surface text-fg-secondary ring-1 ring-border'}`}>
                {w.enabled ? '켜짐' : '꺼짐'}
              </button>
              <button type="button" className="btn btn-ghost" aria-label={`${label(w.id)} 위로`} disabled={off || i === 0} onClick={() => move(w.id, -1)}>↑</button>
              <button type="button" className="btn btn-ghost" aria-label={`${label(w.id)} 아래로`} disabled={off || i === rows.length - 1} onClick={() => move(w.id, 1)}>↓</button>
            </span>
          </li>)}
        </ul>
      </fieldset>
    })}
    {c.fieldError && <ConfigStateNotice kind="field" locale="ko" message={c.fieldError} />}
    {c.conflict && <ConflictCompare rows={[{ key: 'portal.widgets', label: '홈 위젯', mine: summary(c.draft), latest: c.conflict.value ? summary(c.conflict.value) : '설정 손상' }]}
      onMine={c.keepMine} onLatest={c.useLatest} latestAvailable={!!c.conflict.value} />}
    {c.error && <ConfigStateNotice kind="patch" locale="ko" message={c.error} />}
    <SettingsSaveBar notice={c.notice}>
      <button type="button" className="btn btn-primary" aria-label="홈 위젯 저장" disabled={c.pending || (!c.dirty && !c.uncertain) || !!c.conflict} onClick={c.save}>
        {c.uncertain ? '저장 결과 확인 및 재시도' : '홈 위젯 저장'}
      </button>
    </SettingsSaveBar>
  </div>
}
