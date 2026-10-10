// 워크스페이스 해석기 — 배포 기본값(env) 셋, 명시 [] 는 set(D40), 0행 throw.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { valueOf } from '@/lib/settings/registry'
import { ConfigUnavailableError, WorkspaceArchivedError } from '@/lib/settings/errors'

const WID = '00000000-0000-4000-8000-00000000bb01'
const client = (data: unknown, error: { message: string } | null = null) => {
  const b: Record<string, unknown> = {}
  for (const k of ['from', 'select', 'eq']) b[k] = () => b
  b.maybeSingle = async () => ({ data, error })
  return b as unknown as { from: () => unknown }
}
const row = (values: Record<string, unknown>) => ({ workspace_id: WID, values, revision: 1, schema_version: 1 })
const loadWith = (values: Record<string, unknown>) => getWorkspaceConfig(WID, { client: client(row(values)) as never })
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
  it('values 가 객체가 아니면 throw — 전 키를 기본값으로 풀지 않는다', async () => {
    for (const values of [null, [], 'x', 3]) {
      await expect(getWorkspaceConfig(WID, { client: client({ ...row({}), values }) as never }), String(values)).rejects.toBeInstanceOf(ConfigUnavailableError)
    }
  })
  it('달력 — 세 키로 워크스페이스 달력(요일 하나 → 규칙 하나, 날짜 예외 없음)', async () => {
    const cfg = await loadWith({ 'calendar.week_start': 'monday', 'calendar.timezone': 'America/Los_Angeles' })
    expect(cfg.calendar?.weekStart).toEqual([{ day: 'monday', from: null }])
    expect(cfg.calendar?.timezone).toBe('America/Los_Angeles')
    expect(cfg.calendarError).toBeNull()
  })
  it('[RF4] 손상 근무 요일은 calendar=null·calendarError(calendar.working_days)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfg = await loadWith({ 'calendar.working_days': [] })
    err.mockRestore()
    expect(cfg.calendar).toBeNull()
    expect(cfg.calendarError).toMatchObject({ key: 'calendar.working_days' })
  })
})

// 워크스페이스 보관(0056) — 이 해석기가 service_role 경로(외부 API·공유 링크·워커)의 동결을 한 곳에서 건다: 모듈 관문·알림 정책·초대 도메인이 전부 이 위에 선다.
describe('getWorkspaceConfig — 보관된 워크스페이스', () => {
  const AT = '2026-10-10T00:00:00Z'
  const WID2 = '00000000-0000-4000-8000-00000000bb02'   // 요청 범위 캐시(같은 id·클라이언트)가 케이스끼리 겹치지 않게
  const archivedRow = (workspaces: unknown, id = WID2) => ({ workspace_id: id, values: { 'ai.enabled': false }, revision: 1, schema_version: 1, workspaces })

  it('보관이면 WorkspaceArchivedError — ConfigUnavailableError 의 하위라 기존 fail-closed 갈래(관문 거부·워커 unknown)를 그대로 탄다', async () => {
    const err = await getWorkspaceConfig(WID2, { client: client(archivedRow({ archived_at: AT })) as never }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WorkspaceArchivedError)
    expect(err).toBeInstanceOf(ConfigUnavailableError)
    expect((err as WorkspaceArchivedError).workspaceId).toBe(WID2)
    expect((err as WorkspaceArchivedError).code).toBe('CONFIG_UNAVAILABLE')
  })
  it('임베드가 null(워크스페이스 행이 보이지 않음)·배열 임베드의 보관 행도 닫는다', async () => {
    for (const workspaces of [null, [{ archived_at: AT }], [], {}]) {
      await expect(getWorkspaceConfig(WID2, { client: client(archivedRow(workspaces)) as never }), JSON.stringify(workspaces)).rejects.toBeInstanceOf(WorkspaceArchivedError)
    }
  })
  it('보관 아님(archived_at null)은 그대로 읽는다 — 임베드를 싣지 않는 응답도(테스트 대역)', async () => {
    const live = await getWorkspaceConfig(WID2, { client: client(archivedRow({ archived_at: null })) as never })
    expect(live.keys['ai.enabled']).toEqual({ status: 'set', value: false })
    const bare = await getWorkspaceConfig(WID2, { client: client({ workspace_id: WID2, values: {}, revision: 1, schema_version: 1 }) as never })
    expect(bare.workspaceId).toBe(WID2)
  })
  it('includeArchived — 플랫폼 관리 목록만 쓴다. 보관된 워크스페이스의 설정도 읽는다', async () => {
    const cfg = await getWorkspaceConfig(WID2, { client: client(archivedRow({ archived_at: AT })) as never, includeArchived: true })
    expect(cfg.keys['ai.enabled']).toEqual({ status: 'set', value: false })
  })
  it('조회 열에 워크스페이스의 보관 시각을 싣는다', async () => {
    const select = vi.fn()
    const b: Record<string, unknown> = {}
    b.from = () => b; b.eq = () => b
    b.select = (cols: string) => { select(cols); return b }
    b.maybeSingle = async () => ({ data: archivedRow({ archived_at: null }), error: null })
    await getWorkspaceConfig(WID2, { client: b as never })
    expect(select).toHaveBeenCalledWith(expect.stringContaining('workspaces(archived_at)'))
  })
})
