// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ComputedItem } from '@/lib/domain/types'
import type { FieldDef } from '@/lib/domain/customFields'
import { toProjectActorView, type Actor, type ProjectActorView } from '@/lib/domain/authz'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }))
vi.mock('@/app/actions/wbs', () => ({ updateActual: vi.fn(), updateWeight: vi.fn(), addWbsItem: vi.fn() }))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: h.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (key: string) => key }) }))
vi.mock('@/components/wbs/RowDetailPanel', () => ({ RowDetailPanel: () => null }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWbsCollapse: vi.fn() }))

import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'
import { cellEditableField } from '@/components/wbs/WbsCustomFieldCell'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'
import { calInputUtcMon } from '../helpers/calendarFixture'

/**
 * WBS 시트의 사용자 정의 필드 셀 편집(개정 §3.6.9 "편집 셀은 멤버 필드만"). 클릭·Enter 로 들어가 Enter 로 저장, Esc 로 취소한다.
 * 저장은 상세 패널과 같은 길(saveCustomFieldValues — JWT + 행 custom 전체 CAS)이고 충돌은 조용히 덮지 않는다.
 */
const P = '00000000-0000-0000-7e57-00000000c311'
const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: true, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)
const RESULT = def({ key: 'result', label: '결과', type: 'select', sort: 1, options: [{ code: 'pass', label: '합격', sort: 0, active: true }, { code: 'old', label: '옛값', sort: 1, active: false }] })
const ADMIN_ONLY = def({ key: 'grade', label: '등급', type: 'text', sort: 2, editable_by: 'admin' })
const MEMO = def({ key: 'memo', label: '메모', type: 'multiline', sort: 3 })
const base: ComputedItem = {
  id: 'a1', parentId: null, code: '1', sortOrder: 0, name: '일정 항목', biz: null, deliverable: null,
  plannedStart: '2026-07-01', plannedEnd: '2026-07-10', weight: 1, actualPct: 0, owners: [], isOwnerSplit: false,
  plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [], depth: 0,
}
const viewOfActor = (actor: Actor): ProjectActorView => toProjectActorView(actor, P)!
const admin = viewOfActor(makeAdminActor(P))

describe('WbsGanttSheet — 사용자 정의 필드 셀 편집', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    h.save.mockResolvedValue({ ok: true, values: { qty: 5, result: 'pass' } })
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  })
  afterEach(async () => { await act(async () => root.unmount()); container.remove() })

  const cell = (k: string) => [...container.querySelectorAll<HTMLElement>(`[data-wbs-col="cf:${k}"]`)].at(-1)!
  const editor = (k: string) => cell(k).querySelector<HTMLInputElement | HTMLSelectElement>('input, select')
  async function render(custom: unknown, opts: { defs?: FieldDef[]; actorView?: ProjectActorView | null; readOnly?: boolean; canAdmin?: boolean } = {}) {
    await act(async () => root.render(
      <CustomFieldsProvider projectId={P} entity="wbs_item" defs={opts.defs ?? [def({}), RESULT, ADMIN_ONLY, MEMO]} canAdmin={opts.canAdmin ?? true} locale="ko">
        <WbsGanttSheet levelLabels={['Phase', 'Task']} items={[{ ...base, custom: custom as never }]} calendar={calInputUtcMon}
          today="2026-07-03" actorView={opts.actorView === undefined ? admin : opts.actorView} projectId={P} readOnly={opts.readOnly ?? false} />
      </CustomFieldsProvider>,
    ))
  }
  const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })) })
  async function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
    await act(async () => {
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
  }

  it('cellEditableField — 활성·멤버 편집·한 줄 유형만 셀 편집 대상이다', () => {
    expect(cellEditableField(def({}))).toBe(true)
    expect(cellEditableField(RESULT)).toBe(true)
    expect(cellEditableField(def({ type: 'date' }))).toBe(true)
    expect(cellEditableField(def({ type: 'boolean' }))).toBe(true)
    expect(cellEditableField(def({ type: 'text' }))).toBe(true)
    expect(cellEditableField(ADMIN_ONLY)).toBe(false)
    expect(cellEditableField(MEMO)).toBe(false)
    expect(cellEditableField(def({ type: 'multiselect' }))).toBe(false)
    expect(cellEditableField(def({ active: false }))).toBe(false)
  })

  it('클릭으로 들어가 Enter 로 저장 — 행의 custom 전체를 CAS 기준으로 넘기고 다른 키는 그대로 둔다', async () => {
    await render({ qty: 0, result: 'pass', grade: 'A' })
    expect(cell('qty').getAttribute('role')).toBe('button')
    await click(cell('qty'))
    expect(editor('qty')?.value).toBe('0')
    await type(editor('qty')!, '5')
    h.save.mockResolvedValue({ ok: true, values: { qty: 5, result: 'pass', grade: 'A' } })
    await key(editor('qty')!, 'Enter')
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save).toHaveBeenCalledWith(P, 'wbs_item', 'a1', { qty: 0, result: 'pass', grade: 'A' }, { qty: 5, result: 'pass', grade: 'A' })
    expect(editor('qty')).toBeNull()
    expect(cell('qty').textContent).toBe('5')       // 서버 스냅샷이 오기 전에도 저장된 값을 보인다
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('키보드 Enter 로도 들어간다. Esc 는 저장 없이 원래 값으로 닫는다', async () => {
    await render({ qty: 3 })
    await key(cell('qty'), 'Enter')
    expect(editor('qty')).not.toBeNull()
    await type(editor('qty')!, '9')
    await key(editor('qty')!, 'Escape')
    expect(editor('qty')).toBeNull()
    expect(cell('qty').textContent).toBe('3')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('한글 조합 중의 Enter·Esc 는 저장·취소로 새지 않는다 — 조합이 끝난 뒤의 Enter 만 저장한다(Q04, 개정 §5.8.4)', async () => {
    const NOTE = def({ key: 'note', label: '비고', type: 'text', sort: 4 })
    h.save.mockResolvedValue({ ok: true, values: { note: '검토' } })
    await render({}, { defs: [NOTE] })
    await click(cell('note'))
    await type(editor('note')!, '검토')
    const composing = (k: string, init: KeyboardEventInit) => act(async () => { editor('note')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })) })
    await composing('Enter', { isComposing: true })
    await composing('Enter', { keyCode: 229 })
    await composing('Escape', { isComposing: true })
    expect(h.save).not.toHaveBeenCalled()
    expect(editor('note')).not.toBeNull()
    expect(editor('note')!.value).toBe('검토')
    await key(editor('note')!, 'Enter')
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.save.mock.calls[0][4]).toEqual({ note: '검토' })
  })

  it('값을 비우면 그 키를 뺀다(0 과 다르다). 같은 값이면 저장하지 않는다', async () => {
    await render({ qty: 0, result: 'pass' })
    await click(cell('qty'))
    await key(editor('qty')!, 'Enter')              // 그대로 Enter — 변경 없음
    expect(h.save).not.toHaveBeenCalled()
    await click(cell('qty'))
    await type(editor('qty')!, '')
    h.save.mockResolvedValue({ ok: true, values: { result: 'pass' } })
    await key(editor('qty')!, 'Enter')
    expect(h.save).toHaveBeenCalledWith(P, 'wbs_item', 'a1', { qty: 0, result: 'pass' }, { result: 'pass' })
    expect(cell('qty').textContent).toBe('—')
  })

  it('선택 필드는 옵션 code 로 저장한다 — 비활성 옵션은 고를 수 없다', async () => {
    await render({ qty: 1 })
    await click(cell('result'))
    const select = editor('result') as HTMLSelectElement
    expect([...select.options].map(o => [o.value, o.disabled])).toEqual([['', false], ['pass', false], ['old', true]])
    await type(select, 'pass')
    h.save.mockResolvedValue({ ok: true, values: { qty: 1, result: 'pass' } })
    await key(select, 'Enter')
    expect(h.save).toHaveBeenCalledWith(P, 'wbs_item', 'a1', { qty: 1 }, { qty: 1, result: 'pass' })
    expect(cell('result').textContent).toBe('합격')
  })

  it('CAS 충돌은 덮지 않는다 — 알리고 편집기를 닫은 뒤 새로 읽는다. 화면 값은 서버 값 그대로다', async () => {
    await render({ qty: 1 })
    await click(cell('qty'))
    await type(editor('qty')!, '7')
    h.save.mockResolvedValue({ ok: false, code: 'FIELD_CONFLICT', error: '값이나 편집 권한이 바뀌었습니다.' })
    await key(editor('qty')!, 'Enter')
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(editor('qty')).toBeNull()
    expect(cell('qty').textContent).toBe('1')
    expect(h.refresh).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('값이나 편집 권한이 바뀌었습니다.')
  })

  it('그 밖의 저장 실패는 입력을 지킨다 — 편집기가 남고 값은 바뀌지 않는다', async () => {
    await render({ qty: 1 })
    await click(cell('qty'))
    await type(editor('qty')!, '7')
    h.save.mockResolvedValue({ ok: false, code: 'FIELD_UNAVAILABLE', error: '추가 정보를 저장하지 못했습니다.' })
    await key(editor('qty')!, 'Enter')
    expect(editor('qty')?.value).toBe('7')
    expect(editor('qty')?.getAttribute('aria-invalid')).toBe('true')
    expect(h.refresh).not.toHaveBeenCalled()
    expect(container.textContent).toContain('추가 정보를 저장하지 못했습니다.')
  })

  it('정의 위반(범위 밖 숫자)은 서버로 보내지 않는다', async () => {
    await render({ qty: 1 }, { defs: [def({ limits: { min: 0, max: 10 } })] })
    await click(cell('qty'))
    await type(editor('qty')!, '11')
    await key(editor('qty')!, 'Enter')
    expect(h.save).not.toHaveBeenCalled()
    expect(editor('qty')?.getAttribute('aria-invalid')).toBe('true')
  })

  it('관리자 전용 필드·여러 줄 필드는 관리자에게도 셀에서 읽기 전용이다(편집은 상세 패널)', async () => {
    await render({ grade: 'A', memo: '메모' })
    for (const k of ['grade', 'memo']) {
      expect(cell(k).getAttribute('role')).toBeNull()
      await click(cell(k))
      expect(editor(k)).toBeNull()
    }
    expect(cell('grade').textContent).toBe('A')
  })

  it('읽기 전용 시트·행을 고칠 수 없는 사용자(조회·담당 아닌 멤버)는 셀에 들어가지 못한다', async () => {
    await render({ qty: 1 }, { readOnly: true })
    await click(cell('qty'))
    expect(editor('qty')).toBeNull()
    await render({ qty: 1 }, { actorView: null, canAdmin: false })
    await click(cell('qty'))
    expect(editor('qty')).toBeNull()
    await render({ qty: 1 }, { actorView: viewOfActor(makeMemberActor(P)), canAdmin: false })   // 팀이 없는 멤버 — 이 항목의 담당이 아니다
    await click(cell('qty'))
    expect(editor('qty')).toBeNull()
    expect(cell('qty').getAttribute('role')).toBeNull()
    expect(h.save).not.toHaveBeenCalled()
  })

  it('그 항목의 담당 팀 멤버는 멤버 필드를 셀에서 고친다(관리자가 아니어도)', async () => {
    await act(async () => root.render(
      <CustomFieldsProvider projectId={P} entity="wbs_item" defs={[def({}), ADMIN_ONLY]} canAdmin={false} locale="ko">
        <WbsGanttSheet levelLabels={['Phase', 'Task']} items={[{ ...base, owners: [{ team: 'RES', kind: 'primary' }], custom: { qty: 1, grade: 'A' } }]}
          calendar={calInputUtcMon} today="2026-07-03" actorView={viewOfActor(makeMemberActor(P, ['RES']))} projectId={P} />
      </CustomFieldsProvider>,
    ))
    await click(cell('qty'))
    await type(editor('qty')!, '2')
    h.save.mockResolvedValue({ ok: true, values: { qty: 2, grade: 'A' } })
    await key(editor('qty')!, 'Enter')
    expect(h.save).toHaveBeenCalledWith(P, 'wbs_item', 'a1', { qty: 1, grade: 'A' }, { qty: 2, grade: 'A' })
    await click(cell('grade'))
    expect(editor('grade')).toBeNull()
  })

  it('읽지 못한 값(손상)은 경고 표식만 — 편집으로 덮지 못한다', async () => {
    await render({ qty: { bad: true } })
    expect(cell('qty').textContent).toBe('!')
    await click(cell('qty'))
    expect(editor('qty')).toBeNull()
  })
})
