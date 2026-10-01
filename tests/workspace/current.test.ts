import { describe, expect, it } from 'vitest'
import { WS_COOKIE, pickCurrentWorkspace } from '@/lib/workspace/current'

const rows = [
  { id: 'a', slug: 'acme', name: 'Acme', role: 'member' as const, joinedAt: '2026-01-01' },
  { id: 'b', slug: 'beta', name: 'Beta', role: 'admin' as const, joinedAt: '2026-02-01' },
]

describe('pickCurrentWorkspace — 쿠키는 힌트, 소속을 다시 본다(D3)', () => {
  it('쿠키 슬러그가 소속이면 그것', () => {
    expect(pickCurrentWorkspace(rows, 'beta')).toEqual({ id: 'b', slug: 'beta', name: 'Beta' })
  })
  it('쿠키가 없거나·탈퇴·위조·형식 밖이면 첫 소속(Review Focus 2)', () => {
    for (const c of [undefined, '', 'gone', 'Beta', 'beta;path=/', ' beta', 'beta\n', '../acme', 'a'.repeat(70)]) {
      expect(pickCurrentWorkspace(rows, c), String(c)).toEqual({ id: 'a', slug: 'acme', name: 'Acme' })
    }
  })
  it('소속 0 이면 null — 쿠키가 있어도', () => {
    expect(pickCurrentWorkspace([], 'acme')).toBeNull()
  })
  it('쿠키 이름은 dflow-ws', () => { expect(WS_COOKIE).toBe('dflow-ws') })
})
