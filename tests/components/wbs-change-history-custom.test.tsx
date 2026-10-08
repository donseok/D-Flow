// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/app/actions/customFieldValues', () => ({ saveCustomFieldValues: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ChangeHistoryList } from '@/components/wbs/ChangeHistoryList'
import { CustomFieldsProvider } from '@/components/fields/CustomFieldValuesEditor'
import type { ChangeLogEntry } from '@/app/actions/wbs'
import type { FieldDef } from '@/lib/domain/customFields'

const def = (over: Partial<FieldDef>): FieldDef => ({
  key: 'qty', label: '검측 수량', description: '', type: 'number', required: false, editable_by: 'member',
  show_in_list: false, searchable: false, sort: 0, active: true, ...over,
} as FieldDef)
const log = (id: number, field: string, oldValue: string | null, newValue: string | null): ChangeLogEntry =>
  ({ id, field, oldValue, newValue, at: '2026-10-08 09:00:00+09', actorTeam: null, actorRole: 'member' })

/** 사용자 정의 필드 이력(field='custom.<key>')은 키가 아니라 지금의 라벨·서식으로 보인다(개정 §3.6.7 '이력' 행) */
describe('ChangeHistoryList — 사용자 정의 필드 이력', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove() })
  const rows = () => [...container.querySelectorAll('[data-history-row]')].map(r => r.textContent ?? '')

  function render(logs: ChangeLogEntry[], defs: FieldDef[] | null | 'none') {
    const list = <ChangeHistoryList timeZone="Asia/Seoul" logs={logs} />
    act(() => {
      root.render(defs === 'none' ? list
        : <CustomFieldsProvider projectId="p1" entity="wbs_item" defs={defs} canAdmin={false} locale="ko">{list}</CustomFieldsProvider>)
    })
  }

  it('custom.<key> 를 필드 라벨로, 값을 화면 서식(단위·옵션 라벨·예/아니오)으로 보인다', () => {
    render([
      log(1, 'custom.qty', '0', '12.5'),
      log(2, 'custom.result', null, 'pass'),
      log(3, 'custom.done', 'true', 'false'),
    ], [
      def({ limits: { decimals: 1, unit: 'm³' } }),
      def({ key: 'result', label: '실험 결과', type: 'select', options: [{ code: 'pass', label: '합격', sort: 0, active: true }] }),
      def({ key: 'done', label: '검수 완료', type: 'boolean' }),
    ])
    const [qty, result, done] = rows()
    expect(qty).toContain('검측 수량')
    expect(qty).toContain('0.0 m³')
    expect(qty).toContain('12.5 m³')
    expect(qty).not.toContain('custom.qty')
    expect(result).toContain('실험 결과')
    expect(result).toContain('—')
    expect(result).toContain('합격')
    expect(done).toContain('검수 완료')
    expect(done).toContain('예')
    expect(done).toContain('아니오')
  })

  it('비활성 필드의 과거 이력도 라벨로 보인다', () => {
    render([log(1, 'custom.qty', '1', '2')], [def({ active: false })])
    expect(rows()[0]).toContain('검측 수량')
  })

  it('지운 필드·정의를 못 읽은 경우·범위 밖(Provider 없음)은 접두를 뗀 key 와 원문 값 — 다른 필드의 라벨로 꾸미지 않는다', () => {
    for (const defs of [[def({ key: 'other', label: '다른 필드' })], null, 'none'] as const) {
      render([log(1, 'custom.qty', '1', '2')], defs as FieldDef[] | null | 'none')
      expect(rows()[0]).toContain('qty')
      expect(rows()[0]).not.toContain('custom.')
      expect(rows()[0]).not.toContain('다른 필드')
      expect(rows()[0]).toContain('1')
      expect(rows()[0]).toContain('2')
    }
  })

  it('기본 필드의 이력 표시는 그대로다', () => {
    render([log(1, 'actual_pct', '40', '100'), log(2, 'customer', 'a', 'b')], [def({})])
    expect(rows()[0]).toContain('wbs.colActualPct')
    expect(rows()[0]).toContain('100%')
    expect(rows()[1]).toContain('customer')   // 'custom.' 접두가 아닌 이름은 건드리지 않는다
  })
})
