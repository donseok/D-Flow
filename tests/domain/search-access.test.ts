import { describe, expect, it } from 'vitest'
import { decideSearchAccess } from '@/lib/domain/searchAccess'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const projectWorkspace = { [A]: WS_A, [B]: WS_B }

describe('decideSearchAccess', () => {
  it('허용 목록에 있으면 그 프로젝트 하나만 통과시킨다', () => {
    expect(decideSearchAccess(A, { ok: true, scope: { allowedProjectIds: [A, B], projectWorkspace } }))
      .toEqual({ ok: true, projectIds: [A], workspaceId: WS_A })
  })

  it('허용 목록에 없으면 403 — 비공개 프로젝트 유출 경로를 막는다', () => {
    const r = decideSearchAccess(B, { ok: true, scope: { allowedProjectIds: [A], projectWorkspace } })
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ status: 403 })
  })

  it('허용 목록이 비면 403 — 빈 목록을 전체 허용으로 읽지 않는다', () => {
    expect(decideSearchAccess(A, { ok: true, scope: { allowedProjectIds: [], projectWorkspace } }))
      .toMatchObject({ ok: false, status: 403 })
  })

  it('스코프 조회 자체가 실패하면 503 — 모르면 닫는다(fail-closed)', () => {
    expect(decideSearchAccess(A, { ok: false }))
      .toMatchObject({ ok: false, status: 503 })
  })

  it('요청 projectId 가 빈 문자열이면 403', () => {
    expect(decideSearchAccess('', { ok: true, scope: { allowedProjectIds: [A], projectWorkspace } }))
      .toMatchObject({ ok: false, status: 403 })
  })

  it('워크스페이스는 그 프로젝트의 것만 — 다른 프로젝트의 워크스페이스를 빌리지 않는다', () => {
    expect(decideSearchAccess(B, { ok: true, scope: { allowedProjectIds: [A, B], projectWorkspace } }))
      .toEqual({ ok: true, projectIds: [B], workspaceId: WS_B })
  })

  it('허용된 프로젝트인데 워크스페이스를 모르면 503 — 범위 미확정으로 검색하지 않는다', () => {
    const scopes: Array<{ allowedProjectIds: string[]; projectWorkspace?: Record<string, string> }> = [
      { allowedProjectIds: [A] },
      { allowedProjectIds: [A], projectWorkspace: {} },
      { allowedProjectIds: [A], projectWorkspace: { [B]: WS_B } },
      { allowedProjectIds: [A], projectWorkspace: { [A]: '' } },
      { allowedProjectIds: [A], projectWorkspace: { [A]: null as unknown as string } },
    ]
    for (const scope of scopes) {
      expect(decideSearchAccess(A, { ok: true, scope }), JSON.stringify(scope))
        .toEqual({ ok: false, status: 503, reason: 'ACCESS_SCOPE_UNAVAILABLE' })
    }
  })

  it('상속 키(__proto__ 등)는 워크스페이스로 읽지 않는다', () => {
    expect(decideSearchAccess('__proto__', { ok: true, scope: { allowedProjectIds: ['__proto__'], projectWorkspace: {} } }))
      .toEqual({ ok: false, status: 503, reason: 'ACCESS_SCOPE_UNAVAILABLE' })
  })
})
