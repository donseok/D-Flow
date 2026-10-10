'use client'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GripVertical, LayoutGrid, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useLocale } from '@/components/providers/LocaleProvider'
import { postPrefsNow } from '@/lib/prefs/debouncedSave'
import { reloadPortalPage } from '@/lib/portal/reload'
import {
  dropLayoutItem, gridCells, moveLayoutItem, sameLayout, type LayoutItem, type PortalLayout, type PortalWidgetId, type WidgetSize,
} from '@/lib/portal/widgets'

export interface HomeGridSlot { id: PortalWidgetId; size: WidgetSize; title: string; node: ReactNode }
export interface HomeGalleryItem { id: PortalWidgetId; title: string; desc: string; size: WidgetSize; isNew: boolean }

const CELL = (size: WidgetSize) => (size === 'full' ? 'min-w-0 lg:col-span-2' : 'min-w-0')
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, () => String(v)), s)

/**
 * 홈 격자 + 홈 구성(편집 모드) — 2열 격자(lg 미만 한 열)에 위젯을 순서대로 놓는다. 위젯 본문은 서버가 그려 node 로 넘긴다.
 * 편집은 초안이다: 옮기기·크기·빼기·더하기 모두 저장을 누르기 전에는 서버에 쓰지 않는다. 저장 = 개인 설정 portalLayout 한 번 쓰기 → 성공하면
 * 화면을 다시 읽어 새로 올린 위젯의 내용을 싣는다. 실패하면 초안과 편집 모드를 그대로 두고 알린다(바꾼 것을 잃지 않는다).
 * 조작은 끌어 놓기에 기대지 않는다: 위젯마다 앞·뒤 버튼과 손잡이의 화살표 키가 같은 일을 하고, 결과를 라이브 영역이 읽어 준다.
 * 새로 더한 위젯은 아직 조회하지 않았으므로 자리표시 카드로 보인다(화면에 올라간 위젯만 조회한다는 규칙을 편집 중에도 지킨다).
 */
export function HomeGrid({ workspaceId, slots, gallery, defaults, personal, canEdit }: {
  workspaceId: string; slots: HomeGridSlot[]; gallery: HomeGalleryItem[]
  /** 워크스페이스 기본 배치(지금 이 사람이 볼 수 있는 것만) */
  defaults: LayoutItem[]
  /** 저장된 개인 구성으로 그렸는가 */
  personal: boolean
  /** 개인 설정을 읽었는가 — 못 읽었으면 구성하지 않는다(읽지 못한 값 위에 덮어쓰지 않는다) */
  canEdit: boolean
}) {
  const { t } = useLocale()
  const initial: LayoutItem[] = slots.map(({ id, size }) => ({ id, size }))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<readonly LayoutItem[]>(initial)
  const [useDefault, setUseDefault] = useState(false)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [live, setLive] = useState('')
  const [dragId, setDragId] = useState<PortalWidgetId | null>(null)
  const [overId, setOverId] = useState<PortalWidgetId | null>(null)
  // 조작 뒤 초점이 사라지지 않게 — 그릴 때 이 키의 요소에 초점을 준다(빼면 다음 위젯, 없으면 '위젯 추가')
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusKey) return
    // 공용 버튼은 ref 를 받지 않는다 — 자리 표식(data-fk)으로 찾는다. 키는 위젯 id(닫힌 목록)와 고정 낱말뿐이라 선택자에 그대로 쓴다
    root.current?.querySelector<HTMLElement>(`[data-fk="${focusKey}"]`)?.focus()
    setFocusKey(null)
  }, [focusKey, draft, editing, galleryOpen])

  const nodeOf = new Map(slots.map((s) => [s.id, s]))
  const metaOf = new Map(gallery.map((g) => [g.id, g]))
  const titleOf = (id: PortalWidgetId) => nodeOf.get(id)?.title ?? metaOf.get(id)?.title ?? id
  const placed = new Set(draft.map((i) => i.id))
  const dirty = useDefault ? (personal || !sameLayout(initial, defaults)) : !sameLayout(draft, initial)

  const edit = (next: readonly LayoutItem[]) => { setDraft(next); setUseDefault(false); setFailed(false) }
  const announceMove = (next: readonly LayoutItem[], id: PortalWidgetId) => {
    const pos = next.findIndex((i) => i.id === id) + 1
    setLive(fill(t('portalUi.edit.liveMoved'), { title: titleOf(id), pos, row: gridCells(next).find((c) => c.id === id)?.row ?? pos, total: next.length }))
  }
  const move = (id: PortalWidgetId, step: -1 | 1, control: string) => {
    const next = moveLayoutItem(draft, id, step)
    if (next === draft) { setLive(fill(t('portalUi.edit.liveEdge'), { title: titleOf(id) })); return }
    edit(next); announceMove(next, id); setFocusKey(`${id}:${control}`)
  }
  const resize = (id: PortalWidgetId, size: WidgetSize) => {
    edit(draft.map((i) => (i.id === id ? { id, size } : i)))
    setLive(fill(t('portalUi.edit.liveSized'), { title: titleOf(id), size: t(size === 'full' ? 'portalUi.edit.sizeFull' : 'portalUi.edit.sizeHalf') }))
  }
  const remove = (id: PortalWidgetId) => {
    const at = draft.findIndex((i) => i.id === id)
    const next = draft.filter((i) => i.id !== id)
    edit(next)
    setLive(fill(t('portalUi.edit.liveRemoved'), { title: titleOf(id), total: next.length }))
    const neighbor = next[at] ?? next[at - 1]
    setFocusKey(neighbor ? `${neighbor.id}:handle` : 'add')
  }
  const add = (id: PortalWidgetId) => {
    const g = metaOf.get(id)
    if (!g || placed.has(id)) return
    const next = [...draft, { id, size: g.size }]
    edit(next)
    setLive(fill(t('portalUi.edit.liveAdded'), { title: g.title, total: next.length }))
    // 누른 버튼이 '홈에 있음'으로 바뀌어 사라진다 — 다음에 더할 수 있는 위젯으로, 없으면 목록을 여닫는 버튼으로
    const rest = gallery.filter((x) => x.id !== id && !placed.has(x.id))
    setFocusKey(rest.length ? `gallery:${rest[0].id}` : 'add')
  }
  const onHandleKey = (e: KeyboardEvent, id: PortalWidgetId) => {
    const step = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : 0
    if (!step) return
    e.preventDefault()
    move(id, step as -1 | 1, 'handle')
  }
  const drop = (target: PortalWidgetId) => {
    if (dragId && dragId !== target) { const next = dropLayoutItem(draft, dragId, target); if (next !== draft) { edit(next); announceMove(next, dragId) } }
    setDragId(null); setOverId(null)
  }

  const open = () => { setDraft(initial); setUseDefault(false); setFailed(false); setGalleryOpen(false); setEditing(true); setLive(''); setFocusKey('add') }
  const cancel = () => { setDraft(initial); setUseDefault(false); setFailed(false); setGalleryOpen(false); setEditing(false); setLive(t('portalUi.edit.liveCancelled')); setFocusKey('open') }
  const reset = () => { setDraft(defaults); setUseDefault(true); setFailed(false); setLive(t('portalUi.edit.liveReset')) }
  const save = async () => {
    if (saving || !dirty) return
    setSaving(true); setFailed(false)
    // known = 지금 갤러리에 있는 위젯 — 그 뒤 관리자가 새로 켠 위젯만 '새로 추가됨'으로 보이게. 옛 숨김 값은 개인 구성에 흡수됐으므로 함께 비운다
    const layout: PortalLayout | null = useDefault ? null : { v: 1, items: draft.map(({ id, size }) => ({ id, size })), known: gallery.map((g) => g.id) }
    const ok = await postPrefsNow({ prefs: { portalLayout: layout, portalHiddenWidgets: [] }, workspaceId }).then((r) => r.ok, () => false)
    if (!ok) { setSaving(false); setFailed(true); return }
    reloadPortalPage()                                                  // 새로 올린 위젯의 내용은 서버가 그린다 — 저장 중 표시는 새 화면이 올 때까지 둔다
  }

  if (!editing) {
    return (
      <div ref={root} data-home-grid>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <Button data-fk="open" data-home-edit variant="secondary" icon={<LayoutGrid className="h-4 w-4" aria-hidden />} disabled={!canEdit}
            disabledReason={canEdit ? undefined : t('portalUi.edit.unavailable')} onClick={open}>{t('portalUi.edit.open')}</Button>
        </div>
        <span role="status" className="sr-only">{live}</span>
        {slots.length === 0
          ? <StatusMessage kind="empty" title={t('portalUi.edit.empty')} detail={t('portalUi.edit.emptyHint')} />
          : <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {slots.map((s) => <div key={s.id} data-widget-cell={s.id} data-size={s.size} className={CELL(s.size)}>{s.node}</div>)}
            </div>}
      </div>
    )
  }

  return (
    <div ref={root} data-home-grid data-editing>
      <div role="toolbar" aria-label={t('portalUi.edit.toolbarAria')} className="mb-4 flex flex-wrap items-center gap-2 rounded-(--radius-panel) border border-border bg-surface-subtle p-3">
        <p className="min-w-0 flex-1 basis-60 text-meta text-fg-secondary">{useDefault ? t('portalUi.edit.usingDefault') : t('portalUi.edit.hint')}</p>
        <Button data-fk="add" data-home-add variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} aria-expanded={galleryOpen} aria-controls="home-widget-gallery"
          onClick={() => setGalleryOpen((v) => !v)}>{t(galleryOpen ? 'portalUi.edit.addClose' : 'portalUi.edit.add')}</Button>
        <Button data-home-reset variant="ghost" onClick={reset}>{t('portalUi.edit.reset')}</Button>
        <Button data-home-cancel variant="ghost" onClick={cancel}>{t('portalUi.edit.cancel')}</Button>
        <Button data-home-save variant="primary" busy={saving} disabled={!dirty} onClick={save}>{t('portalUi.edit.save')}</Button>
      </div>
      {failed && <div className="mb-4"><StatusMessage kind="partial_error" blocking compact title={t('portalUi.edit.saveFailed')} /></div>}
      <span role="status" aria-live="polite" className="sr-only">{live}</span>

      {galleryOpen && (
        <section id="home-widget-gallery" aria-label={t('portalUi.edit.galleryTitle')} className="mb-6 rounded-(--radius-panel) border border-border bg-surface p-4.5">
          <h2 className="mb-3 text-section text-fg">{t('portalUi.edit.galleryTitle')}</h2>
          {gallery.length === 0 ? <StatusMessage kind="empty" compact title={t('portalUi.edit.galleryEmpty')} /> : (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {gallery.map((g) => {
                const on = placed.has(g.id)
                return (
                  <li key={g.id} data-gallery-item={g.id} className="flex min-w-0 items-center gap-3 rounded-(--radius-control) bg-surface-subtle p-3">
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-body font-semibold text-fg">{g.title}
                        {g.isNew && !on && <span className="chip bg-surface-selected text-fg">{t('portalUi.edit.galleryNew')}</span>}</span>
                      <span className="block text-meta text-fg-secondary">{g.desc}</span>
                    </span>
                    {on
                      ? <span className="chip shrink-0 bg-surface text-fg-secondary">{t('portalUi.edit.galleryPlaced')}</span>
                      : <Button data-fk={`gallery:${g.id}`} variant="secondary" className="shrink-0" aria-label={fill(t('portalUi.edit.galleryAdd'), { title: g.title })} onClick={() => add(g.id)}>{t('portalUi.edit.galleryAddShort')}</Button>}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {draft.length === 0
        ? <StatusMessage kind="empty" title={t('portalUi.edit.empty')} />
        : <ol className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {draft.map((item, index) => {
              const slot = nodeOf.get(item.id)
              const title = titleOf(item.id)
              return (
                <li key={item.id} data-widget-cell={item.id} data-size={item.size}
                  className={`${CELL(item.size)} rounded-(--radius-panel) ${overId === item.id && dragId !== item.id ? 'outline-2 outline-offset-2 outline-border-focus' : ''} ${dragId === item.id ? 'opacity-60' : ''}`}
                  onDragOver={(e) => { if (dragId && dragId !== item.id) { e.preventDefault(); setOverId(item.id) } }}
                  onDragLeave={() => setOverId((v) => (v === item.id ? null : v))}
                  onDrop={(e) => { e.preventDefault(); drop(item.id) }}>
                  {/* 끄는 손잡이는 이 띠 전체다 — 버튼 자체는 일부 브라우저에서 끌리지 않는다. 띠 안의 손잡이 버튼은 키보드(화살표 키)용이다 */}
                  <div role="group" aria-label={fill(t('portalUi.edit.controlsAria'), { title })} draggable data-widget-dragbar
                    onDragStart={(e) => { setDragId(item.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.id) }}
                    onDragEnd={() => { setDragId(null); setOverId(null) }}
                    className="mb-2 flex cursor-grab flex-wrap items-center gap-1 rounded-(--radius-control) border border-border bg-surface-subtle px-2 py-1">
                    <IconButton data-fk={`${item.id}:handle`} data-widget-handle variant="ghost"
                      aria-label={fill(t('portalUi.edit.handle'), { title })} icon={<GripVertical className="h-4 w-4" aria-hidden />}
                      onKeyDown={(e) => onHandleKey(e, item.id)} />
                    <span className="min-w-0 flex-1 truncate text-control font-semibold text-fg">{title}</span>
                    <IconButton data-fk={`${item.id}:back`} variant="ghost" disabled={index === 0} aria-label={fill(t('portalUi.edit.moveBack'), { title })}
                      icon={<ArrowUp className="h-4 w-4" aria-hidden />} onClick={() => move(item.id, -1, index === 1 ? 'forward' : 'back')} />
                    <IconButton data-fk={`${item.id}:forward`} variant="ghost" disabled={index === draft.length - 1} aria-label={fill(t('portalUi.edit.moveForward'), { title })}
                      icon={<ArrowDown className="h-4 w-4" aria-hidden />} onClick={() => move(item.id, 1, index === draft.length - 2 ? 'back' : 'forward')} />
                    <span role="group" aria-label={fill(t('portalUi.edit.sizeAria'), { title })} className="flex items-center gap-1">
                      {(['half', 'full'] as const).map((size) => (
                        <button key={size} type="button" aria-pressed={item.size === size} onClick={() => resize(item.id, size)}
                          className={`chip min-h-8 ${item.size === size ? 'bg-surface-selected text-fg' : 'text-fg-secondary hover:bg-surface-hover'}`}>
                          {t(size === 'full' ? 'portalUi.edit.sizeFull' : 'portalUi.edit.sizeHalf')}
                        </button>
                      ))}
                    </span>
                    <IconButton variant="ghost" aria-label={fill(t('portalUi.edit.remove'), { title })} icon={<X className="h-4 w-4" aria-hidden />} onClick={() => remove(item.id)} />
                  </div>
                  {/* 편집 중에는 본문을 누를 수 없다(inert) — 링크를 따라가다 초안을 잃지 않게. 조작은 위의 묶음이 전부다 */}
                  {slot
                    ? <div inert className="pointer-events-none opacity-70">{slot.node}</div>
                    : <div data-widget-placeholder={item.id} className="rounded-(--radius-panel) border border-dashed border-border-input bg-surface p-4.5">
                        <p className="text-section text-fg">{title}</p>
                        <p className="mt-1 text-meta text-fg-secondary">{metaOf.get(item.id)?.desc}</p>
                        <p className="mt-3 text-meta text-fg-muted">{t('portalUi.edit.placeholder')}</p>
                      </div>}
                </li>
              )
            })}
          </ol>}
    </div>
  )
}
