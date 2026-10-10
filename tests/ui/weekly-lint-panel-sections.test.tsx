// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WeeklyLintPanel } from '@/components/weekly/WeeklyLintPanel'
import type { LegacySectionRow } from '../helpers/legacySectionRows'
import { legacyGroup, legacyOrdered } from '../helpers/weekly-legacy'

// 화면 문구는 사전에서 온다 — 진짜 ko 사전으로 풀어 한국어 단언을 그대로 둔다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mkRow = (id: string, section: string, sortOrder: number, over: Partial<LegacySectionRow> = {}): LegacySectionRow => ({
  id, reportId: 'rep', section, module: '', sortOrder,
  thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over,
})

const sections = () =>
  [...document.querySelectorAll<HTMLElement>('[data-lint-section]')]

describe('주간보고 점검 패널 — 구분 단위', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  const show = (rows: LegacySectionRow[]) => {
    root = createRoot(container)
    act(() => root.render(
      <WeeklyLintPanel open rows={legacyOrdered(rows)} groupOf={legacyGroup} onClose={() => {}} onApply={() => {}} onGoToCell={() => {}} />,
    ))
  }

  it('지적을 구분별로 묶어 구분 순서대로 보여준다', () => {
    show([
      mkRow('r2', '홍보', 2, { thisContent: '나\n나' }),
      mkRow('r1', 'HQ', 1, { thisContent: '가\n가', thisIssue: '1. 가\n3. 나' }),
    ])
    expect(sections().map(el => el.dataset.lintSection)).toEqual(['HQ', '홍보'])
  })

  it('구분 묶음 안에는 그 구분의 지적만 들어간다', () => {
    show([
      mkRow('r1', 'HQ', 1, { thisContent: '가\n가', thisIssue: '1. 가\n3. 나' }),
      mkRow('r2', '홍보', 2, { thisContent: '나\n나' }),
    ])
    const counts = sections().map(el => el.querySelectorAll('li').length)
    expect(counts).toEqual([2, 1])
  })

  it('묶음 머리글에 구분 이름과 건수가 보인다', () => {
    show([
      mkRow('r1', 'HQ', 1, { thisContent: '가\n가', thisIssue: '1. 가\n3. 나' }),
      mkRow('r2', '홍보', 2, { thisContent: '나\n나' }),
    ])
    const heads = sections().map(el => el.querySelector('h3')!.textContent ?? '')
    expect(heads[0]).toContain('HQ')
    expect(heads[0]).toContain('2건')
    expect(heads[1]).toContain('홍보')
    expect(heads[1]).toContain('1건')
  })

  it('앞 구분에 정리 지적만 있어도 구분 순서가 뒤집히지 않는다', () => {
    show([
      mkRow('r1', 'HQ', 1, { thisContent: '· 가' }),        // 정리(기호) 지적만
      mkRow('r2', '홍보', 2, { thisContent: '- 다\n- 다' }),  // 중복 지적 + 다수결 기호 공급
    ])
    expect(sections().map(el => el.dataset.lintSection)).toEqual(['HQ', '홍보'])
  })

  it('완전 중복과 유사 중복이 다른 배지로 나뉜다', () => {
    show([mkRow('r1', 'HQ', 1, {
      thisContent: 'FIN 인터페이스 설계 진행 중 60%\nFIN 인터페이스 설계 진행 중 60%',
      thisIssue: 'FIN 인터페이스 설계 진행 중 60%\nFIN 인터페이스 설계 진행 중 70%',
    })])
    expect(document.body.textContent).toContain('완전 중복')
    expect(document.body.textContent).toContain('유사 중복')
    expect(document.body.textContent).toContain('% 일치')
  })

  it('유사 중복 지적에는 적용 버튼이 없다 — 어느 줄을 남길지는 사람이 정한다', () => {
    show([mkRow('r1', 'HQ', 1, {
      thisIssue: 'FIN 인터페이스 설계 진행 중 60%\nFIN 인터페이스 설계 진행 중 70%',
    })])
    expect([...document.querySelectorAll('li')]).toHaveLength(1)
    expect([...document.querySelectorAll('button')].find(b => b.textContent === '적용')).toBeUndefined()
  })

  it('지적이 없으면 구분 묶음도 없다', () => {
    show([mkRow('r1', 'HQ', 1, { thisContent: '가\n나' })])
    expect(sections()).toHaveLength(0)
    expect(document.body.textContent).toContain('점검할 내용이 없습니다')
  })

  it('적용 버튼은 그 지적의 편집을 그대로 넘긴다', () => {
    const got: unknown[] = []
    root = createRoot(container)
    act(() => root.render(
      <WeeklyLintPanel
        open
        rows={[mkRow('r1', 'HQ', 1, { thisContent: '가\n가' })]}
        groupOf={legacyGroup}
        onClose={() => {}}
        onApply={edits => got.push(edits)}
        onGoToCell={() => {}}
      />,
    ))
    const apply = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '적용')!
    act(() => apply.click())
    expect(got).toEqual([[{ rowId: 'r1', cellKey: 'this_content', content: '가' }]])
  })

  it('묶음은 groupOf 의 키로 — 이름이 같은 두 영역도 따로 묶고, data-lint-section 은 키·머리는 이름', () => {
    type Row = { id: string; areaId: string; thisContent: string; thisIssue: string; nextContent: string; nextIssue: string }
    const r = (id: string, areaId: string, thisContent: string): Row =>
      ({ id, areaId, thisContent, thisIssue: '', nextContent: '', nextIssue: '' })
    root = createRoot(container)
    act(() => root.render(
      <WeeklyLintPanel
        open
        rows={[r('r1', 'a-1', '가\n가'), r('r2', 'a-2', '나\n나')]}
        groupOf={(row: Row) => ({ key: row.areaId, label: '실험' })}
        onClose={() => {}}
        onApply={() => {}}
        onGoToCell={() => {}}
      />,
    ))
    expect(sections().map(el => el.dataset.lintSection)).toEqual(['a-1', 'a-2'])
    const heads = sections().map(el => el.querySelector('h3')!.textContent ?? '')
    expect(heads).toHaveLength(2)
    for (const h of heads) { expect(h).toContain('실험'); expect(h).toContain('1건') }
  })
})
