import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// 경로가 /projects 여도 결과가 같아야 한다 — BrandMark 는 경로를 읽지 않는다(C §5.4, ★8)
vi.mock('next/navigation', () => ({ usePathname: () => '/projects' }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
import { BrandMark } from '@/components/ui/BrandMark'

const WID = '00000000-0000-0000-7e57-000000001711'

describe('BrandMark — 경로 판정 없이 마크 규칙 하나(C §5.4, ★8)', () => {
  it('마크가 있으면 읽기 라우트 이미지, 경로와 무관', () => {
    const html = renderToString(<BrandMark productName="Acme" hasMark workspaceId={WID} size={28} />)
    expect(html).toContain(`/api/brand/${WID}/mark`)
    expect(html).toContain('<img')
  })
  it('마크가 없으면 제품 이름 모노그램', () => {
    const html = renderToString(<BrandMark productName="Acme" hasMark={false} workspaceId={null} size={28} />)
    expect(html).toContain('>A<')
    expect(html).not.toContain('/api/brand/')
  })
  it('마크 표시가 켜져도 워크스페이스 id 가 없으면 이미지를 만들지 않는다(없는 읽기 경로를 그리지 않는다)', () => {
    const html = renderToString(<BrandMark productName="Acme" hasMark workspaceId={null} size={28} />)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('/api/brand/')
  })
  it('기본 제품명이면 flow 아이콘 — 모노그램 글자 없음', () => {
    const html = renderToString(<BrandMark productName="D-Flow" hasMark={false} workspaceId={null} size={28} />)
    expect(html).toContain('dflow-flow.svg')
  })
  it('워드마크는 호출부가 넘긴 제품 이름을 쓴다(env 브랜드가 아니라)', () => {
    const html = renderToString(<BrandMark productName="Acme" hasMark={false} workspaceId={null} withWordmark />)
    expect(html).toContain('>Acme<')
  })
})
