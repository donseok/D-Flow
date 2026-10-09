// 외부 회의록 API 의 오류문에 실리는 제품 이름 — 자격증명이 묶인 워크스페이스의 설정값(branding.product_name)이다(재점검 2026-10-09).
// 인증이 끝나 워크스페이스가 정해진 뒤의 오류(unknown_user)만 본다. 인증 전 오류(401)는 워크스페이스를 몰라 이름을 싣지 않는다.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ createAdminClient: vi.fn(), settingsReads: [] as string[] }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/minutes/externalApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/minutes/externalApi')>()),
  resolveUserByEmail: vi.fn(async () => null),
}))

import { GET as META } from '@/app/api/v1/minutes/meta/route'
import { BRAND } from '@/lib/branding'
import { apiProductName } from '@/lib/minutes/externalApi'
import { CRED_WS, minutesCredential, type TestCredential } from '../fixtures/credentials'

const W1 = CRED_WS, W2 = '5a000000-0000-4000-8000-0000000000ff'
const CRED1 = minutesCredential(), CRED2 = minutesCredential({ workspace_id: W2, id: '5a000000-0000-4000-8000-0000000000c2' })
const CREDS: TestCredential[] = [CRED1, CRED2]
let settings: Record<string, Record<string, unknown> | null>
const admin = {
  from: vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    let updating = false
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'in', 'order', 'maybeSingle', 'single']) b[k] = () => b
    b.eq = (col: string, val: unknown) => { filters[col] = val; return b }
    b.update = () => { updating = true; return b }
    const data = () => {
      if (table === 'integration_credentials') return updating ? null : (CREDS.find((c) => c.prefix === filters.token_prefix)?.row ?? null)
      if (table.endsWith('_settings')) {
        const wid = filters.workspace_id as string
        m.settingsReads.push(wid)
        const values = settings[wid]
        return values ? { workspace_id: wid, values, revision: 1, schema_version: 1 } : null
      }
      return []
    }
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(r)
    return b
  }),
}
const meta = (cred: TestCredential) => META(new NextRequest('http://localhost/api/v1/minutes/meta?user_email=nobody%40example.com', { headers: { Authorization: `Bearer ${cred.token}` } }))

beforeEach(() => {
  vi.clearAllMocks()
  m.settingsReads.length = 0
  settings = { [W1]: { 'branding.product_name': 'Acme Flow' }, [W2]: { 'branding.product_name': 'Beta PM' } }
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  m.createAdminClient.mockReturnValue(admin)
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('외부 회의록 API 오류문의 제품 이름', () => {
  it('자격증명 워크스페이스가 정한 이름이 실린다', async () => {
    const res = await meta(CRED1)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'unknown_user', error: '해당 이메일의 Acme Flow 사용자가 없습니다.' })
  })
  it('격리 — 다른 워크스페이스의 자격증명은 자기 이름만(읽는 설정도 그 워크스페이스 하나)', async () => {
    const body = await (await meta(CRED2)).json()
    expect(body.error).toBe('해당 이메일의 Beta PM 사용자가 없습니다.')
    expect(body.error).not.toContain('Acme Flow')
    expect(m.settingsReads).toEqual([W2])
  })
  it('설정을 읽지 못하면 배포 기본 이름으로 내리고 로그를 남긴다 — 원래 오류(403)를 바꾸지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    settings[W1] = null
    const res = await meta(CRED1)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(`해당 이메일의 ${BRAND.productName} 사용자가 없습니다.`)
    expect(err.mock.calls.some((c) => String(c[0]).includes('[branding]'))).toBe(true)
  })
  it('인증 전 오류(401)는 설정을 읽지 않는다 — 워크스페이스를 모른다', async () => {
    const res = await META(new NextRequest('http://localhost/api/v1/minutes/meta?user_email=a%40example.com', { headers: { Authorization: 'Bearer dflow_int_nope' } }))
    expect(res.status).toBe(401)
    expect(m.settingsReads).toEqual([])
  })
  it('apiProductName 은 넘긴 워크스페이스의 값만 돌려준다', async () => {
    expect(await apiProductName(admin as never, W1)).toBe('Acme Flow')
    expect(await apiProductName(admin as never, W2)).toBe('Beta PM')
  })
})
