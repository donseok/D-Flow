// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { render, screen, fireEvent } from '../shell/_dom'

function Example() {
  const [value, setValue] = useState('list')
  return <SegmentedTabs label="보기 방식" tabs={[
    { key: 'list', label: '목록' }, { key: 'board', label: '보드' }, { key: 'calendar', label: '달력' },
  ]} value={value} onChange={setValue} />
}

describe('세그먼트 탭 키보드 탐색', () => {
  it('방향키는 선택과 포커스를 함께 이동하고 양 끝에서 순환한다', () => {
    render(<Example />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1])
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[2])
    expect(tabs[2].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0])
    expect(tabs.map(tab => tab.tabIndex)).toEqual([0, -1, -1])
  })
  it('Home과 End는 첫 탭과 마지막 탭으로 이동한다', () => {
    render(<Example />)
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(document.activeElement).toBe(tabs[2])
    fireEvent.keyDown(tabs[2], { key: 'Home' })
    expect(document.activeElement).toBe(tabs[0])
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('보기 방식')
  })
})
