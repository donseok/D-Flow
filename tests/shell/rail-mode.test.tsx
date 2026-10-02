import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RAIL_MIN_MAIN, RAIL_WIDTH, SIDEBAR_WIDTH, railSideBySide, useRailMode } from '@/components/app/RightRail'

describe('레일 병치 임계(개정 §5.4.3, §8.1 #9)', () => {
  it('상수', () => { expect(RAIL_WIDTH).toBe(400); expect(RAIL_MIN_MAIN).toBe(720); expect(SIDEBAR_WIDTH).toEqual({ open: 232, closed: 64 }) })
  it('경계값 1440·1400·1280 × 펼침(232)·접힘(64)', () => {
    expect(railSideBySide(1440, 232)).toBe(true)     // 1440-232-400-48 = 760
    expect(railSideBySide(1400, 232)).toBe(true)     // 1400-232-400-48 = 720 — 경계 포함
    expect(railSideBySide(1399, 232)).toBe(false)
    expect(railSideBySide(1280, 232)).toBe(false)
    expect(railSideBySide(1280, 64)).toBe(true)      // 1280-64-400-48 = 768
  })
  it('SSR·첫 렌더는 닫힘(레일은 열린 채로 SSR 하지 않는다 — D55)', () => {
    function Probe() { return <i>{useRailMode(232)}</i> }
    expect(renderToString(<Probe />)).toContain('closed')
  })
})
