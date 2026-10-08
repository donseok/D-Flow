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
  it('높이 — 기본 64(min-h-16·py-3), 컴팩트 48(min-h-12·py-2)은 같은 임의 미디어 한 조건으로(개정 §5.4.1·§5.4.4)', () => {
    const cls = renderToString(<PageHeader title="t" />).match(/<header[^>]*class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    const M = '[@media(max-width:1279px),(max-height:799px)]'
    expect(cls).toEqual(expect.arrayContaining(['min-h-16', 'py-3', `${M}:min-h-12`, `${M}:py-2`]))
    // 머리 상자에는 display 를 바꾸는 반응형·컨테이너 변형이 없다(안전망 규칙 — 임의 미디어와 섞지 않는다)
    expect(cls.filter((c) => /^(?:sm|md|lg|xl|2xl|@\[[^\]]*\]):(?:hidden|flex|block|grid|inline)/.test(c))).toEqual([])
    const h1 = renderToString(<PageHeader title="t" />).match(/<h1[^>]*class="([^"]*)"/)?.[1] ?? ''
    expect(h1).toContain('text-title'); expect(h1).toContain(`${M}:text-title-sm`)
  })
  it('preview(상태 점검 화면 전용) — 제목은 h2(화면당 h1 하나), 뷰포트가 아니라 고정 모양', () => {
    const def = renderToString(<PageHeader preview="default" title="t" description="설명" />)
    expect(def).not.toContain('<h1'); expect(def.match(/<h2/g)).toHaveLength(1)
    expect(def).not.toContain('[@media'); expect(def).toContain('min-h-16')
    const compact = renderToString(<PageHeader preview="compact" title="t" description="설명" meta="메타" />)
    expect(compact).not.toContain('<h1'); expect(compact).not.toContain('[@media')
    const box = compact.match(/<header[^>]*class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(box).toEqual(expect.arrayContaining(['min-h-12', 'py-2'])); expect(box).not.toContain('min-h-16'); expect(box).not.toContain('py-3')
    expect(compact).toMatch(/<h2[^>]*class="[^"]*text-title-sm/)
    expect(compact).toMatch(/<p[^>]*class="[^"]*\bhidden\b[^"]*"[^>]*>설명/)
  })
})
