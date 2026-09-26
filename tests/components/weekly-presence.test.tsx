// @vitest-environment jsdom
// weekly/usePresence — 주간 시트 presence 를 private 채널로 연다(0007 realtime.messages 정책과 짝).
//   1) 토픽 = weeklyPresenceTopic(projectId, reportId), config.private === true
//   2) 채널 생성 전에 realtime.setAuth()
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
  track: vi.fn(),
  removeChannel: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => {
    const channel = {
      on: () => channel,
      subscribe: (cb: SubscribeCb) => { h.subscribeCb = cb; return channel },
      presenceState: () => ({}),
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

const { usePresence } = await import('@/components/weekly/usePresence')

const PID = 'a1b2c3d4-0000-4000-8000-000000000001'
const RID = 'b1b2c3d4-0000-4000-8000-000000000002'
const ME = { id: 'u1', name: 'alice' }
let peers: unknown[] = []

type Props = { projectId: string; reportId: string | null; me: { id: string; name: string } | null; enabled: boolean }
function Probe(props: Props) {
  peers = usePresence({ ...props, active: null, editing: false })
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
  h.track.mockClear()
  h.removeChannel.mockClear()
  peers = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function mount(props: Partial<Props> = {}) {
  await act(async () => { root.render(<Probe projectId={PID} reportId={RID} me={ME} enabled {...props} />) })
}

describe('weekly usePresence', () => {
  it('주간 presence 토픽을 private 로, setAuth 뒤에 연다', async () => {
    await mount()
    expect(h.channelName).toBe(`project-${PID}-weekly-${RID}-presence`)
    expect(h.channelOpts).toMatchObject({ config: { private: true, presence: { key: expect.stringMatching(/^u1:/) } } })
    expect(h.calls).toEqual(['setAuth', 'channel'])
  })

  it('SUBSCRIBED 에서 자기 위치를 track 한다', async () => {
    await mount()
    act(() => h.subscribeCb?.('SUBSCRIBED'))
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', name: 'alice', rowId: '', col: '' }))
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
    ['reportId=null', { reportId: null }],
    ['잘못된 pid', { projectId: 'not-a-uuid' }],
  ])('%s 면 채널을 만들지 않는다', async (_label, props) => {
    await mount(props)
    expect(h.calls).not.toContain('channel')
    expect(peers).toEqual([])
  })
})
