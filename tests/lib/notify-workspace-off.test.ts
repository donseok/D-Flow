// 내 계정의 "워크스페이스에서 꺼짐" 요약(src/lib/notify/workspaceOff.ts — 개정 §4.10). 화면 쪽은 tests/ui/account-notif-prefs.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ config: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.config }))

import { loadWorkspaceNotifyOff, summarizeWorkspaceNotifyOff } from '@/lib/notify/workspaceOff'

const OFF = { enabled: false }
const cfg = (value: unknown) => ({ keys: { 'notify.policy': { status: 'set', value } } })
beforeEach(() => { h.config.mockReset() })

describe('summarizeWorkspaceNotifyOff', () => {
  it('소속 전부가 끈 유형은 all, 일부만 끈 유형은 그 이름들(받은 순서) — 켜진 유형은 키가 없다', () => {
    expect(summarizeWorkspaceNotifyOff([
      { name: 'Alpha', policy: { 'issue.update': OFF, 'work.claimed': OFF } },
      { name: 'Beta', policy: { 'issue.update': OFF } },
      { name: 'Gamma', policy: { 'issue.update': OFF, 'work.claimed': OFF, 'work.assigned': { enabled: true } } },
    ])).toEqual({
      'issue.update': { all: true, names: ['Alpha', 'Beta', 'Gamma'] },
      'work.claimed': { all: false, names: ['Alpha', 'Gamma'] },
    })
  })
  it('소속이 하나면 그 워크스페이스가 끈 유형이 곧 전부다. 소속이 없으면 빈 요약', () => {
    expect(summarizeWorkspaceNotifyOff([{ name: 'Alpha', policy: { 'issue.update': OFF } }])).toEqual({ 'issue.update': { all: true, names: ['Alpha'] } })
    expect(summarizeWorkspaceNotifyOff([])).toEqual({})
  })
  it('필수 유형은 저장값이 꺼짐이어도 표시하지 않는다(발행 판정과 같은 도우미)', () => {
    expect(summarizeWorkspaceNotifyOff([{ name: 'Alpha', policy: { 'work.reported': OFF } }])).toEqual({})
  })
  it('못 읽은 워크스페이스(null)는 이름에서 빠지고, 그때는 어떤 유형도 "전부"로 단정하지 않는다', () => {
    expect(summarizeWorkspaceNotifyOff([{ name: 'Alpha', policy: { 'issue.update': OFF } }, { name: 'Beta', policy: null }]))
      .toEqual({ 'issue.update': { all: false, names: ['Alpha'] } })
    expect(summarizeWorkspaceNotifyOff([{ name: 'Beta', policy: null }])).toEqual({})
  })
})

describe('loadWorkspaceNotifyOff', () => {
  it('워크스페이스마다 해석기로 정책을 읽어 요약한다', async () => {
    h.config.mockImplementation(async (id: string) => cfg(id === 'ws-a' ? { 'issue.update': OFF } : {}))
    expect(await loadWorkspaceNotifyOff([{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }]))
      .toEqual({ 'issue.update': { all: false, names: ['Alpha'] } })
    expect(h.config.mock.calls.map((c) => c[0])).toEqual(['ws-a', 'ws-b'])
  })
  it('조회 실패·손상 값인 워크스페이스는 빼고 로그를 남긴다 — 꺼짐으로도 켜짐으로도 그리지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      h.config.mockImplementation(async (id: string) => {
        if (id === 'ws-b') throw new Error('down')
        if (id === 'ws-c') return { keys: { 'notify.policy': { status: 'invalid', error: 'x' } } }
        return cfg({ 'issue.update': OFF })
      })
      expect(await loadWorkspaceNotifyOff([{ id: 'ws-a', name: 'Alpha' }, { id: 'ws-b', name: 'Beta' }, { id: 'ws-c', name: 'Gamma' }]))
        .toEqual({ 'issue.update': { all: false, names: ['Alpha'] } })
      expect(err).toHaveBeenCalledTimes(2)
      expect(err.mock.calls.map((c) => c[1])).toEqual(['ws-b', 'ws-c'])
    } finally { err.mockRestore() }
  })
})
