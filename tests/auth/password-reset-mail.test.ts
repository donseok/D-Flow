// 메일 재설정 길을 여는 판정 — 앱의 메일 발송 설정(SMTP_*)이 있거나 로컬 개발일 때만.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { passwordResetMailAvailable } from '@/lib/auth/passwordResetMail'
import { mailConfigured } from '@/lib/mail/transport'

const KEYS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_AUTH', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_ADDRESS'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

const smtp = () => { process.env.SMTP_HOST = 'smtp.example.com'; process.env.SMTP_USER = 'bot@example.com'; process.env.SMTP_PASS = 'x'.repeat(8) }

describe('passwordResetMailAvailable', () => {
  it('SMTP 설정이 없는 배포: 닫힌다 — 로그인 화면이 링크를 숨기고 "관리자에게 문의"를 유지한다', () => {
    expect(mailConfigured()).toBe(false)
    expect(passwordResetMailAvailable({ APP_ENV: 'production', NODE_ENV: 'production' })).toBe(false)
    expect(passwordResetMailAvailable({ NODE_ENV: 'production' })).toBe(false)
    expect(passwordResetMailAvailable({ APP_ENV: 'staging' })).toBe(false)
  })
  it('SMTP 설정이 있는 배포: 열린다', () => {
    smtp()
    expect(mailConfigured()).toBe(true)
    expect(passwordResetMailAvailable({ APP_ENV: 'production', NODE_ENV: 'production' })).toBe(true)
  })
  it('잘못된 SMTP 설정은 구성되지 않은 것으로 본다 — 보내면 실패할 길을 열지 않는다', () => {
    smtp(); process.env.SMTP_PORT = '465'; process.env.SMTP_SECURE = 'false'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(mailConfigured()).toBe(false)
    expect(passwordResetMailAvailable({ APP_ENV: 'production' })).toBe(false)
    spy.mockRestore()
  })
  it('로컬 개발은 SMTP 설정 없이도 열린다 — 로컬 Supabase 가 인증 메일을 자기 메일함으로 받는다', () => {
    expect(passwordResetMailAvailable({ APP_ENV: 'development' })).toBe(true)
    expect(passwordResetMailAvailable({ NODE_ENV: 'development' })).toBe(true)
  })
})
