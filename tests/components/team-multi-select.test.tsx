// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

import { TeamMultiSelect } from '@/components/roster/TeamMultiSelect'

const OPTIONS = [{ id: 't-erp', code: 'ERP' }, { id: 't-mes', code: 'MES' }]

function Harness() {
  const [value, setValue] = useState<string[]>(['t-erp'])
  return (
    <div>
      <TeamMultiSelect options={OPTIONS} value={value} onChange={setValue} label="alice 팀" />
      <input aria-label="다음 칸" />
    </div>
  )
}

/** 팝오버 기준(버튼을 감싼 div)의 화면 좌표를 지정한다 — jsdom 은 레이아웃이 없다. */
function setAnchorRect(r: { left: number; top: number; width?: number; height?: number }) {
  const w = r.width ?? 120, h = r.height ?? 32
  const rect = { left: r.left, top: r.top, right: r.left + w, bottom: r.top + h, width: w, height: h, x: r.left, y: r.top, toJSON: () => ({}) }
  const anchor = document.querySelector<HTMLButtonElement>('[aria-label="alice 팀"]')!.parentElement!
  anchor.getBoundingClientRect = () => rect as DOMRect
}

describe('TeamMultiSelect — 포털 팝오버의 키보드·위치', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    act(() => root.render(<Harness />))
    setAnchorRect({ left: 100, top: 100 })
  })
  afterEach(() => { act(() => root.unmount()); container.remove() })

  const trigger = () => document.querySelector<HTMLButtonElement>('[aria-label="alice 팀"]')!
  const pop = () => document.querySelector<HTMLElement>('[role="group"][aria-label="alice 팀"]')
  const open = () => act(() => trigger().click())
  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

  it('열면 포커스가 목록의 첫 입력으로 간다', () => {
    open()
    expect(pop()).not.toBeNull()
    expect(pop()!.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(pop()!.querySelector('input'))
  })

  it('포커스가 버튼·목록 밖으로 나가면 닫힌다', async () => {
    open()
    act(() => document.querySelector<HTMLInputElement>('[aria-label="다음 칸"]')!.focus())
    await flush()
    expect(pop()).toBeNull()
  })

  it('목록 안에서 포커스가 옮겨 다니면 열린 채다', async () => {
    open()
    act(() => pop()!.querySelector<HTMLInputElement>('input[data-team-check="MES"]')!.focus())
    await flush()
    expect(pop()).not.toBeNull()
  })

  it('목록 빈 곳을 눌러 목록 자체가 포커스를 받으면 열린 채, 포커스가 문서 밖(body)으로 빠지면 닫힌다', async () => {
    open()
    act(() => pop()!.focus())
    await flush()
    expect(pop()).not.toBeNull()
    act(() => (document.activeElement as HTMLElement).blur())
    await flush()
    expect(pop()).toBeNull()
  })

  it('Esc 로 닫으면 포커스가 버튼으로 돌아온다', () => {
    open()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(pop()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('마지막 정지점에서 Tab, 첫 정지점에서 Shift+Tab 은 닫고 버튼으로 돌아온다(포털이 문서 끝이라 탭 순서가 새지 않게)', () => {
    open()
    // 정지점: ERP 체크 · 대표 라디오 묶음 하나(체크된 ERP) · MES 체크 — 체크 안 된 MES 라디오는 탭 순서에 없다.
    const last = pop()!.querySelector<HTMLInputElement>('input[data-team-check="MES"]')!
    act(() => last.focus())
    act(() => { last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
    expect(pop()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    open()
    // 라디오 묶음 안(탭 정지점 아님)의 Tab 은 가로채지 않는다.
    const radio = pop()!.querySelector<HTMLInputElement>('input[data-team-primary="ERP"]')!
    act(() => radio.focus())
    act(() => { radio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
    expect(pop()).not.toBeNull()
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(pop()).toBeNull()
    expect(document.activeElement).toBe(trigger())
    open()
    act(() => { pop()!.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })) })
    expect(pop()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('left 는 화면 오른쪽 끝에서 목록 폭만큼 안쪽으로 제한된다', () => {
    setAnchorRect({ left: window.innerWidth - 40, top: 100 })
    open()
    expect(parseFloat(pop()!.style.left)).toBe(window.innerWidth - 232)
  })

  it('스크롤로 기준 버튼이 화면 밖으로 나가면 닫힌다', () => {
    open()
    expect(pop()).not.toBeNull()
    setAnchorRect({ left: 100, top: -80 })
    act(() => { window.dispatchEvent(new Event('scroll')) })
    expect(pop()).toBeNull()
  })

  it('기준 버튼이 스크롤 컨테이너(overflow auto) 영역 밖이면 닫힌다', () => {
    const scroller = container.firstElementChild as HTMLElement
    scroller.style.overflowX = 'auto'
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    open()
    expect(pop()).not.toBeNull()
    setAnchorRect({ left: 500, top: 100 })
    act(() => { scroller.dispatchEvent(new Event('scroll')) })
    expect(pop()).toBeNull()
  })
})
