// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 실패 알림 대비(최종 리뷰 UI I-1) — delayed 글자는 delayed-weak 위 3.71:1 로 본문 AA 미만이다.
// 글자는 ink, 위험색은 비텍스트 기준(3:1)인 아이콘에만 남긴다(티커 실패 칩 T12-4 와 같은 처리).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))

import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'

const doc = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d }

describe('LoadErrorNotice — 글자 대비', () => {
  it('사유 글자는 text-fg 이고 text-danger 를 달지 않는다 — 위험색은 아이콘에만', () => {
    const root = doc(renderToStaticMarkup(<LoadErrorNotice message="목록을 불러오지 못했습니다." />))
    const alert = root.querySelector('[role="alert"]')!
    expect(alert.className).not.toMatch(/\btext-danger\b/)
    const msg = [...alert.querySelectorAll('span')].find(s => s.textContent === '목록을 불러오지 못했습니다.')!
    expect(msg.className).not.toMatch(/\btext-danger\b/)
    expect(msg.className).toMatch(/\btext-fg\b/)
    expect(alert.querySelector('svg.text-danger')).not.toBeNull()
  })
})

// 같은 브랜치가 더한 줄 단위 실패 문구도 같은 처리 — 문구가 있는 줄에 text-danger 가 없고 ink 를 쓴다.
const FAILURE_LINES: [file: string, marker: string][] = [
  ['src/components/dashboard/TrendChart.tsx', "'dash.trend.historyFailed'"],
  ['src/components/dashboard/SpiPanel.tsx', "'dash.trend.historyFailed'"],
  ['src/components/minutes/MinuteMetaModal.tsx', "'min.meetingsLoadFailed'"],
  ['src/components/minutes/MinuteUploadModal.tsx', "'min.meetingsLoadFailed'"],
  ['src/components/wbs/RowDetailPanel.tsx', "'wbs.attachLinkFail'"],
  ['src/components/minutes/MinuteVersionPanel.tsx', 'downloadErrors[version.id]}'],
]
describe('줄 단위 실패 문구 — 글자는 ink, 위험색은 아이콘에만', () => {
  it.each(FAILURE_LINES)('%s', (file, marker) => {
    const lines = readFileSync(join(process.cwd(), file), 'utf8').split('\n').filter(l => l.includes(marker) && /className=/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) {
      expect(l).toMatch(/<AlertTriangle[^>]*\btext-danger\b[^>]*\/>/) // 위험색은 아이콘
      expect(l.replace(/<AlertTriangle[^>]*\/>/g, '')).not.toMatch(/\btext-danger\b/)
      expect(l).toMatch(/\btext-fg\b/)
    }
  })
})
