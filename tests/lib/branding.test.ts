import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('BRAND', () => {
  it('기본값은 D-Flow', async () => {
    // 개발 PC·CI 에 브랜드 env 가 이미 있어도 기본값 경로를 검사한다 — pick() 은 '' 를 미설정으로 본다.
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', '')
    vi.stubEnv('NEXT_PUBLIC_BRAND_TAGLINE', '')
    vi.stubEnv('NEXT_PUBLIC_BRAND_COPYRIGHT', '')
    vi.stubEnv('NEXT_PUBLIC_BRAND_PORTAL_ICON', '')
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND.productName).toBe('D-Flow')
    expect(BRAND.tagline).toBe('일하는 방식이 바뀌다')
    expect(BRAND.copyright).toBe('')
    expect(BRAND.portalIcon).toBe('flow')
  })
  it('env 로 덮어쓴다', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', 'Acme PM')
    vi.stubEnv('NEXT_PUBLIC_BRAND_TAGLINE', '일이 흐른다')
    vi.stubEnv('NEXT_PUBLIC_BRAND_COPYRIGHT', '© 2026 Acme')
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND).toMatchObject({ productName: 'Acme PM', tagline: '일이 흐른다', copyright: '© 2026 Acme' })
  })
  it('공백 env 는 기본값', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', '  ')
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND.productName).toBe('D-Flow')
  })
  // 화이트라벨 배포(제품명 변경)가 D 글리프를 달고 나오지 않게 — 명시값이 없으면 제품명으로 정한다(D6-§13).
  it.each([
    [undefined, 'D-Flow', 'flow'], ['', 'D-Flow', 'flow'], ['monogram', 'D-Flow', 'monogram'],
    ['', 'Acme PM', 'monogram'], ['flow', 'Acme PM', 'flow'], ['sparkle', 'Acme PM', 'monogram'],
  ])('resolvePortalIcon(%j, %s) → %s', async (raw, name, want) => {
    const { resolvePortalIcon } = await import('@/lib/branding')
    expect(resolvePortalIcon(raw, name)).toBe(want)
  })
  it('메일 발신명은 BRAND 에 없다 — 서버 전용 모듈(mail/fromName)이 소유한다', async () => {
    const { BRAND } = await import('@/lib/branding')
    expect(BRAND).not.toHaveProperty('mailFromName')
  })
})
