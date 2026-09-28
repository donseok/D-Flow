// 워크스페이스 해석기 — 배포 기본값(env) 셋, 명시 [] 는 set(D40), 0행 throw.
import { afterEach, describe, expect, it } from 'vitest'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { valueOf } from '@/lib/settings/registry'
import { ConfigUnavailableError } from '@/lib/settings/errors'

const WID = '00000000-0000-4000-8000-00000000bb01'
const client = (data: unknown, error: { message: string } | null = null) => {
  const b: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'eq']) b[k] = () => b
  b.maybeSingle = async () => ({ data, error })
  return b as unknown as { from: () => unknown }
}
const row = (values: Record<string, unknown>) => ({ workspace_id: WID, values, revision: 1, schema_version: 1 })
const saved = { ...process.env }
afterEach(() => { process.env = { ...saved } })

describe('getWorkspaceConfig', () => {
  it('미설정 키는 env 가 있으면 deploy, 없으면 product 기본값. 명시 [] 는 set', async () => {
    process.env.INVITE_ALLOWED_DOMAINS = 'Example.com, acme.test'
    process.env.NEXT_PUBLIC_BRAND_NAME = ' Acme PM '
    delete process.env.MAIL_FROM_NAME
    const cfg = await getWorkspaceConfig(WID, { client: client(row({ 'ai.enabled': false })) as never })
    expect(cfg.keys['invites.allowed_domains']).toEqual({ status: 'default', value: ['example.com', 'acme.test'], from: 'deploy' })
    expect(cfg.keys['branding.product_name']).toEqual({ status: 'default', value: 'Acme PM', from: 'deploy' })
    expect(cfg.keys['branding.mail_from_name']).toEqual({ status: 'default', value: null, from: 'product' })
    expect(cfg.keys['ai.enabled']).toEqual({ status: 'set', value: false })
    expect(cfg.keys['modules.allowed']).toEqual({ status: 'default', value: [], from: 'product' })
    const explicit = await getWorkspaceConfig(WID, { client: client(row({ 'invites.allowed_domains': [] })) as never })
    expect(explicit.keys['invites.allowed_domains']).toEqual({ status: 'set', value: [] })   // 초대 불가 — env 로 넘어가지 않는다
    expect(valueOf(explicit, 'invites.allowed_domains')).toEqual([])
  })
  it('env 가 깨졌으면 배포 기본값을 쓰지 않고 product 로 간다(조용히 좁히지 않는다 — 로그)', async () => {
    process.env.INVITE_ALLOWED_DOMAINS = 'bad domain'
    const cfg = await getWorkspaceConfig(WID, { client: client(row({})) as never })
    expect(cfg.keys['invites.allowed_domains']).toEqual({ status: 'default', value: [], from: 'product' })
  })
  it('문자열 revision(bigint)은 number 로 바꾼다(Review Focus 2)', async () => {
    const cfg = await getWorkspaceConfig(WID, { client: client({ ...row({}), revision: '12' }) as never })
    expect(cfg.revision).toBe(12)
  })
  it('0행·오류는 throw', async () => {
    await expect(getWorkspaceConfig(WID, { client: client(null) as never })).rejects.toBeInstanceOf(ConfigUnavailableError)
    await expect(getWorkspaceConfig(WID, { client: client(null, { message: 'x' }) as never })).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
})
