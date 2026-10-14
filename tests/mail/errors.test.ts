// SMTP 발송 오류 → 사용자 문구(설계 §2.5). 회의 안내·프로젝트 초대·테스트 발송이 같은 변환을 쓴다 — SMTP 원문은 싣지 않는다.
import { describe, it, expect } from 'vitest'
import { smtpErrorMessage } from '@/lib/mail/errors'
import { serverKoTranslate } from '@/lib/i18n/serverDict'

const RAW = '535-5.7.8 Username and Password not accepted bot@example.org secret-pw smtp.example.org'
const smtpError = (code: string) => Object.assign(new Error(RAW), { code, response: RAW })

const AUTH = '메일 계정 인증에 실패했습니다. 관리자에게 문의하세요.'
const CONNECT = '메일 서버에 연결하지 못했습니다.'
const OTHER = '메일 발송 중 오류가 발생했습니다.'

describe('smtpErrorMessage', () => {
  it('EAUTH 는 계정 인증 실패 — 회의·초대 액션의 옛 문구 그대로', () => {
    expect(smtpErrorMessage(serverKoTranslate, smtpError('EAUTH'))).toBe(AUTH)
    expect(smtpErrorMessage(serverKoTranslate, smtpError('EAUTH'), { test: false })).toBe(AUTH)
  })

  it('테스트 발송의 EAUTH 는 앱 비밀번호 안내를 더한다', () => {
    const msg = smtpErrorMessage(serverKoTranslate, smtpError('EAUTH'), { test: true })
    expect(msg).toBe(serverKoTranslate('srv.mailSettings.testAuthFailed'))
    expect(msg).toContain('앱 비밀번호')
    expect(msg).not.toBe(AUTH)
  })

  it.each(['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'])('%s 는 서버 연결 실패 — 테스트 발송이어도 같다', (code) => {
    expect(smtpErrorMessage(serverKoTranslate, smtpError(code))).toBe(CONNECT)
    expect(smtpErrorMessage(serverKoTranslate, smtpError(code), { test: true })).toBe(CONNECT)
  })

  it.each([
    ['다른 코드', smtpError('EENVELOPE')],
    ['코드 없는 Error', new Error(RAW)],
    ['문자열', RAW],
    ['null', null],
    ['undefined', undefined],
    ['숫자 코드', { code: 535 }],
  ] as const)('그 밖(%s)은 일반 발송 실패', (_label, e) => {
    expect(smtpErrorMessage(serverKoTranslate, e)).toBe(OTHER)
    expect(smtpErrorMessage(serverKoTranslate, e, { test: true })).toBe(OTHER)
  })

  it('원문(계정·비밀번호·호스트·응답 코드)을 문구에 싣지 않는다', () => {
    for (const code of ['EAUTH', 'ETIMEDOUT', 'EENVELOPE']) {
      for (const test of [false, true]) {
        const msg = smtpErrorMessage(serverKoTranslate, smtpError(code), { test })
        for (const leak of ['bot@example.org', 'secret-pw', 'smtp.example.org', '535']) expect(msg).not.toContain(leak)
      }
    }
  })
})
