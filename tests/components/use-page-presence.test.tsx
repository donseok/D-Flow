// @vitest-environment jsdom
// usePagePresence — presence 를 private 채널로 연다(0007 realtime.messages 정책과 짝).
//   1) 토픽 = pagePresenceTopic(projectId, pageKey), config.private === true
//   2) 채널 생성 전에 realtime.setAuth() — 토큰 없이 join 하면 인가가 anon 으로 판정된다
//   3) enabled=false·me=null·잘못된 pid 면 채널을 만들지 않고 빈 목록
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type SubscribeCb = (status: string) => void

const h = vi.hoisted(() => ({
  session: { user: { id: 'u1' } } as { user: { id: string } } | null,
  calls: [] as string[],
  channelName: '' as string,
  channelOpts: null as unknown,
  subscribeCb: null as SubscribeCb | null,
  syncCb: null as (() => void) | null,
  state: {} as Record<string, { userId: string; name: string }[]>,
  track: vi.fn(),
  removeChannel: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: (_type: string, _filter: unknown, cb: () => void) => { h.syncCb = cb; return channel },
      subscribe: (cb: SubscribeCb) => { h.subscribeCb = cb; return channel },
      presenceState: () => h.state,
      track: h.track,
    }
    return {
      auth: { getSession: async () => ({ data: { session: h.session } }) },
      realtime: { setAuth: () => { h.calls.push('setAuth') } },
      channel: (name: string, opts: unknown) => {
        h.calls.push('channel')
        h.channelName = name
        h.channelOpts = opts
        return channel
      },
      removeChannel: h.removeChannel,
    }
  },
}))

const { usePagePresence } = await import('@/components/app/usePagePresence')

const PID = 'a1b2c3d4-0000-4000-8000-000000000001'
const ME = { id: 'u1', name: 'alice' }
let online: unknown[] = []

function Probe(props: { projectId: string; me: { id: string; name: string } | null; enabled: boolean }) {
  online = usePagePresence({ ...props, pageKey: 'wbs' })
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  h.session = { user: { id: 'u1' } }
  h.calls = []
  h.channelName = ''
  h.channelOpts = null
  h.subscribeCb = null
  h.syncCb = null
  h.state = {}
  h.track.mockClear()
  h.removeChannel.mockClear()
  online = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function mount(props: Partial<{ projectId: string; me: { id: string; name: string } | null; enabled: boolean }> = {}) {
  await act(async () => { root.render(<Probe projectId={PID} me={ME} enabled {...props} />) })
}

describe('usePagePresence', () => {
  it('프로젝트 presence 토픽을 private 로, setAuth 뒤에 연다', async () => {
    await mount()
    expect(h.channelName).toBe(`project-${PID}-presence-wbs`)
    expect(h.channelOpts).toMatchObject({ config: { private: true, presence: { key: expect.stringMatching(/^u1:/) } } })
    expect(h.calls).toEqual(['setAuth', 'channel'])
  })

  it('SUBSCRIBED 에서 track 하고 sync 상태를 userId 단위로 모은다', async () => {
    await mount()
    act(() => h.subscribeCb?.('SUBSCRIBED'))
    expect(h.track).toHaveBeenCalledWith({ userId: 'u1', name: 'alice' })
    h.state = { a: [{ userId: 'u1', name: 'alice' }], b: [{ userId: 'u2', name: 'bob' }], c: [{ userId: 'u2', name: 'bob' }] }
    act(() => h.syncCb?.())
    expect(online).toEqual([{ userId: 'u1', name: 'alice' }, { userId: 'u2', name: 'bob' }])
  })

  it('언마운트에서 removeChannel', async () => {
    await mount()
    act(() => root.unmount())
    expect(h.removeChannel).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })

  it.each([
    ['enabled=false', { enabled: false }],
    ['me=null', { me: null }],
    ['잘못된 pid', { projectId: 'not-a-uuid' }],
  ])('%s 면 채널을 만들지 않는다', async (_label, props) => {
    await mount(props)
    expect(h.calls).not.toContain('channel')
    expect(online).toEqual([])
  })

  it('세션이 없으면 채널을 만들지 않는다', async () => {
    h.session = null
    await mount()
    expect(h.calls).not.toContain('channel')
  })
})
