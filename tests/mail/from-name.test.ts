import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('mailFromName', () => {
  it('MAIL_FROM_NAME 이 있으면 앞뒤 공백을 걷어 그대로 쓴다', async () => {
    vi.stubEnv('MAIL_FROM_NAME', '  Acme 알림 ')
    const { mailFromName } = await import('@/lib/mail/fromName')
    expect(mailFromName()).toBe('Acme 알림')
  })

  it('비었거나 공백뿐이면 "<제품명> 알림" 으로 떨어진다', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', '')
    vi.stubEnv('MAIL_FROM_NAME', '   ')
    const { mailFromName } = await import('@/lib/mail/fromName')
    expect(mailFromName()).toBe('D-Flow 알림')
  })

  it('기본 발신명은 제품명을 따라간다', async () => {
    vi.stubEnv('NEXT_PUBLIC_BRAND_NAME', 'Acme PM')
    vi.stubEnv('MAIL_FROM_NAME', '')
    const { mailFromName } = await import('@/lib/mail/fromName')
    expect(mailFromName()).toBe('Acme PM 알림')
  })

  it('env 를 호출 시점에 읽는다 — 모듈 로드 뒤에 바뀐 값도 반영한다', async () => {
    vi.stubEnv('MAIL_FROM_NAME', '')
    const { mailFromName } = await import('@/lib/mail/fromName')
    vi.stubEnv('MAIL_FROM_NAME', '나중 발신')
    expect(mailFromName()).toBe('나중 발신')
  })
})
