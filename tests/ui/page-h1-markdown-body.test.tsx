// @vitest-environment jsdom
/**
 * 화면의 가시 h1 은 하나(스펙 §9 ④, E21). 회의록 상세·공유 화면은 제목이 h1 인데 본문 마크다운의 `# 제목` 도 h1 로 그려져
 * 둘이 됐다(UI-2b 눈확인 — ws-minute·minute 스텁 최종·share). 본문을 그리는 쪽에서 머리 수준을 한 칸씩 내린다(demoteHeadings,
 * 판정 R-h1) — 위키 본문도 같은 이유로 켠다(페이지가 자기 h1 을 가진 곳).
 */
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/minutes/MinuteInsightCard', () => ({ MinuteInsightCard: () => null }))
vi.mock('@/components/minutes/MinuteToc', () => ({ MinuteToc: () => null }))
vi.mock('@/components/minutes/MinuteChatPanel', () => ({ MinuteChatPanel: () => null }))
vi.mock('@/components/minutes/MinuteMetaModal', () => ({ MinuteMetaModal: () => null }))
vi.mock('@/components/minutes/MinuteShareModal', () => ({ MinuteShareModal: () => null }))
vi.mock('@/components/minutes/MinuteBlockPopover', () => ({ MinuteBlockPopover: () => null }))

import { MarkdownView } from '@/components/minutes/MarkdownView'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { ShareViewer } from '@/components/minutes/ShareViewer'

const BODY = '# 본문 첫 제목\n\n내용\n\n## 둘째\n\n### 셋째\n\n#### 넷째\n\n##### 다섯째\n\n###### 여섯째\n'

const minute: Minute = {
  id: 'm1', minuteDate: '2026-07-16', teamCode: 'PMO', title: '주간회의',
  bodyMd: BODY, meetingId: null, createdBy: 'u1', createdByName: '작성자',
  createdAt: '2026-07-16T00:00:00Z', updatedAt: '2026-07-16T00:00:00Z',
}
const count = (html: string, tag: string) => (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length

describe('page-h1 — 본문 마크다운의 머리는 화면 h1 을 늘리지 않는다', () => {
  it('회의록 상세(워크스페이스 경로·옛 경로 스텁이 307 로 닿는 곳) — h1 은 제목 하나', () => {
    const html = renderToStaticMarkup(
      <MinuteViewer minute={minute} files={[]} canManage={false} annotations={{ highlights: [], insights: [] }} userId="u1" projects={[]} timeZone="UTC" />,
    )
    expect(count(html, 'h1')).toBe(1)
    expect(html).toContain('본문 첫 제목')
  })

  it('외부 공유 화면 — h1 은 제목 하나', () => {
    const html = renderToStaticMarkup(<ShareViewer minuteDate="2026-07-16" teamCode="PMO" title="주간회의" bodyMd={BODY} />)
    expect(count(html, 'h1')).toBe(1)
    expect(html).toContain('본문 첫 제목')
  })

  it('MarkdownView 기본값은 그대로 — # 은 h1(위키 밖 소비처·옛 마크업 불변)', () => {
    const html = renderToStaticMarkup(<MarkdownView content={BODY} />)
    for (const n of [1, 2, 3, 4, 5, 6]) expect(count(html, `h${n}`)).toBe(1)
    expect(html).not.toMatch(/md-h[123]/)
  })

  it('demoteHeadings — # → h2 … ##### → h6, ###### 은 h6 에 머문다. 시각 클래스는 원래 수준 것을 단다', () => {
    const html = renderToStaticMarkup(<MarkdownView content={BODY} demoteHeadings />)
    expect(count(html, 'h1')).toBe(0)
    expect(html).toMatch(/<h2[^>]*class="md-h1"[^>]*>본문 첫 제목/)
    expect(html).toMatch(/<h3[^>]*class="md-h2"[^>]*>둘째/)
    expect(html).toMatch(/<h4[^>]*class="md-h3"[^>]*>셋째/)
    expect(html).toMatch(/<h5[^>]*>넷째/)
    expect(count(html, 'h6')).toBe(2)
    expect(html).toMatch(/<h6[^>]*>다섯째/)
    expect(html).toMatch(/<h6[^>]*>여섯째/)
  })

  it('강등해도 블록 앵커(data-mblock)는 그대로 — 목차·하이라이트 인덱스 파리티', () => {
    const a = renderToStaticMarkup(<MarkdownView content={BODY} />).match(/data-mblock="\d+"/g)
    const b = renderToStaticMarkup(<MarkdownView content={BODY} demoteHeadings />).match(/data-mblock="\d+"/g)
    expect(b).toEqual(a)
  })
})

describe('page-h1 — 켜는 곳(페이지가 자기 h1 을 가진 곳)', () => {
  const on = (f: string) => /<MarkdownView\b[^>]*\bdemoteHeadings\b/.test(readFileSync(f, 'utf8'))
  it.each([
    'src/components/minutes/MinuteViewer.tsx',
    'src/components/minutes/ShareViewer.tsx',
    'src/components/wiki/WikiDocumentEditor.tsx',
  ])('%s', (f) => { expect(on(f), f).toBe(true) })
})
