import { describe, it, expect } from 'vitest'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { makeActor } from '../fixtures/actor'

// SP1 에는 워크스페이스 선택 화면이 없다(스펙 5.3) — 소속이 정확히 1개일 때만 그 워크스페이스를 쓴다.
describe('resolveSoleWorkspaceId', () => {
  it('소속 워크스페이스가 1개면 그 id', () => {
    expect(resolveSoleWorkspaceId(makeActor({ workspaceRoles: new Map([['ws-a', 'member']]) })))
      .toEqual({ ok: true, workspaceId: 'ws-a' })
  })

  it('0개면 거부 — 임의 워크스페이스를 지어내지 않는다', () => {
    expect(resolveSoleWorkspaceId(makeActor({ workspaceRoles: new Map() })))
      .toEqual({ ok: false, error: '워크스페이스에 소속돼 있지 않습니다.' })
  })

  it('2개 이상이면 지정을 요구한다(SP2 가 선택 UI 를 준다)', () => {
    expect(resolveSoleWorkspaceId(makeActor({ workspaceRoles: new Map([['ws-a', 'admin'], ['ws-b', 'member']]) })))
      .toEqual({ ok: false, error: '워크스페이스를 지정해야 합니다.' })
  })
})
