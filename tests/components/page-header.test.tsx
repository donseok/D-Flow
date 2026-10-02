import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PageHeader } from '@/components/app/PageHeader'

describe('PageHeader — 모든 뷰포트에서 h1(④), 컴팩트는 CSS 로 설명·메타를 숨긴다(D55)', () => {
  it('h1 하나, hidden·sr-only 없음', () => {
    const html = renderToString(<PageHeader title="홈" description="설명" meta="메타" />)
    expect(html.match(/<h1/g)).toHaveLength(1)
    expect(html).not.toMatch(/<h1[^>]*class="[^"]*(?:\bhidden\b|sr-only)/)
  })
  it('설명·메타는 컴팩트 미디어 한 클래스로 숨긴다 — 조건부 렌더가 아니다(SSR 에 늘 있다)', () => {
    const html = renderToString(<PageHeader title="t" description="설명" meta="메타" />)
    expect(html).toContain('설명'); expect(html).toContain('메타')
    expect(html).toContain('[@media(max-width:1279px),(max-height:799px)]:hidden')
  })
  it('보조 동작은 둘까지 보이고 나머지는 넘침 자리로', () => {
    const html = renderToString(<PageHeader title="t" secondaryActions={[<b key="1">A</b>, <b key="2">B</b>, <b key="3">C</b>]} />)
    expect(html).toContain('A'); expect(html).toContain('B')
    expect(html).toMatch(/data-slot="overflow"[^>]*>(?:(?!<\/div>).)*C/)
    expect(html).not.toMatch(/data-slot="overflow"[^>]*>(?:(?!<\/div>).)*>A</)
  })
  it('동작이 없으면 오른쪽 자리를 그리지 않는다', () => {
    expect(renderToString(<PageHeader title="t" />)).not.toContain('data-slot')
  })
})
