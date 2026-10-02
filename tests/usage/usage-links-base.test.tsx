// 사용 현황 필터 링크는 범위의 경로(/w/<slug>/usage)를 base 로 받는다(과제 21) — 옛 /usage 로 새면 스텁을 한 번 더 거친다
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PeriodTabs } from '@/components/usage/PeriodTabs'
import { UsageEventLog } from '@/components/usage/UsageEventLog'

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll('&amp;', '&'))

describe('사용 현황 링크 base', () => {
  it('기간 탭 — 사용자·메뉴 필터를 유지한 채 base 아래로', () => {
    const hs = hrefs(renderToString(<PeriodTabs base="/w/acme/usage" filter={{ days: 30, user: 'u1', menu: 'wbs' }} />))
    expect(hs.length).toBeGreaterThan(1)
    for (const h of hs) expect(h.startsWith('/w/acme/usage'), h).toBe(true)
    expect(hs).toContain('/w/acme/usage?days=7&user=u1&menu=wbs')
  })
  it('접속 로그의 메뉴·사용자 칩', () => {
    const html = renderToString(<UsageEventLog base="/w/acme/usage" events={[]} names={new Map([['u1', 'Alice']])} limit={200} locale="ko"
      menus={['wbs', 'issues']} filter={{ days: 7, user: 'u1' }} timeZone="UTC" />)
    const hs = hrefs(html)
    expect(hs).toEqual(expect.arrayContaining(['/w/acme/usage?days=7&user=u1', '/w/acme/usage?days=7&user=u1&menu=wbs', '/w/acme/usage?days=7']))
    for (const h of hs) expect(h.startsWith('/usage'), h).toBe(false)
  })
})
