// 전환 뒤 실적 편집(스펙 D54·D4 — 비평 Q16, §6.1 의 A1 몫). 실적 쓰기의 서버 재검사는 팀 **id** 로 판정한다(actions/wbs.ts
// updateActual — item_owners.in('team_id', 명단 팀 id)). 가져오기 경로의 전환(convert_inherited_teams)은 담당(item_owners)과 명단 팀
// (project_member_teams)을 같은 새 전용 팀 id 로 함께 옮긴다(DB 쪽은 tests/rls/team-convert.test.ts) — 그래서 상속 시절 공용 팀으로 명단을
// 꾸린 담당 팀 멤버가 가져온 항목의 실적을 그대로 고친다. 명단을 옮기지 않은 '복사만'(같은 code·다른 id 두 벌)은 같은 멤버를 거부한다.
// 액션은 고치지 않는다(재검사 규칙 그대로) — 이 파일은 전환이 만들어야 할 상태를 고정한다. '공용 팀 복사로 시작'(copyGlobalTeams)이
// 전환 RPC 를 쓰는 케이스는 B 가 이 파일에 더한다(마무리 판정 T14·계획 P12).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: vi.fn(),
  requireSuperuser: vi.fn(), resolveProjectId: mocks.resolveProjectId, getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { updateActual } from '@/app/actions/wbs'
import { makeMemberActor } from '../fixtures/actor'

const P = '00000000-0000-0000-7e57-0000000018a1'   // 단위 테스트 픽스처 id(GC — 18a0~18af 는 이 파일)
const ITEM = '00000000-0000-0000-7e57-0000000018a2'
/** 상속 시절의 공용 팀 QA 와, 전환이 같은 code·이름·색으로 만든 이 프로젝트의 전용 팀 QA */
const COMMON_QA = '00000000-0000-0000-7e57-0000000018a3'
const OWN_QA = '00000000-0000-0000-7e57-0000000018a4'

type Resp = { data?: unknown; error?: { message: string } | null }
/** 세션 클라이언트 흉내 — wbs_items 는 차례 응답(항목 → 자식 없음 → update 결과), item_owners 는 in('team_id', 명단 팀 id)를 실제로
 *  적용해 그 항목의 담당 팀 id 가 목록에 있을 때만 행을 준다(액션의 id 재검사가 보는 그대로). 쓰기와 담당 조회의 id 목록을 기록한다 */
function server(ownerTeamId: string) {
  const writes: Array<{ table: string; payload: unknown }> = []
  const ownerLookups: unknown[][] = []
  const items: Resp[] = [
    { data: { id: ITEM, actual_pct: 40, project_id: P, dev_workflow: false, tags: [] } },
    { data: null },
    { data: [{ id: ITEM }] },
  ]
  const client = {
    from: (table: string) => {
      let resp: Resp = table === 'wbs_items' ? (items.shift() ?? { data: null }) : { data: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'limit', 'order']) b[k] = () => b
      b.in = (col: string, values: unknown[]) => {
        if (table === 'item_owners' && col === 'team_id') {
          ownerLookups.push(values)
          resp = { data: values.includes(ownerTeamId) ? { team_id: ownerTeamId } : null }
        }
        return b
      }
      b.update = (payload: unknown) => { writes.push({ table, payload }); return b }
      b.insert = (payload: unknown) => { writes.push({ table, payload }); return b }
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
  }
  mocks.createServerClient.mockResolvedValue(client)
  return { writes, ownerLookups }
}
/** 그 프로젝트의 담당 팀 멤버(명단 권한 member) — 명단 팀은 rosterTeamId 하나 */
const memberWith = (rosterTeamId: string) =>
  makeMemberActor(P, [], { rosterTeams: new Map([[P, { teamIds: [rosterTeamId], teamCodes: ['QA'] }]]) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P })
})

describe('전환 뒤 실적 편집 — 액션의 팀 id 재검사(D54)', () => {
  it('상속 중(명단·담당 모두 공용 팀 id) — 담당 팀 멤버가 실적을 고친다(출발점)', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: memberWith(COMMON_QA) })
    const { writes } = server(COMMON_QA)
    expect(await updateActual(ITEM, 70, 40)).toEqual({ ok: true })
    expect(writes[0]).toMatchObject({ table: 'wbs_items', payload: { actual_pct: 70 } })
  })
  it('가져오기 경로로 전환한 뒤(명단 팀·담당이 같은 새 전용 팀 id) — 같은 멤버가 가져온 항목의 실적을 고친다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: memberWith(OWN_QA) })
    const { writes, ownerLookups } = server(OWN_QA)
    expect(await updateActual(ITEM, 70, 40)).toEqual({ ok: true })
    expect(ownerLookups).toEqual([[OWN_QA]])
    expect(writes.map((w) => w.table)).toEqual(['wbs_items', 'change_logs'])
  })
  it('복사만 한 분열(명단은 공용 팀 id, 담당은 같은 code 의 전용 팀 id) — 같은 멤버를 거부하고 아무것도 쓰지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: memberWith(COMMON_QA) })
    const { writes, ownerLookups } = server(OWN_QA)
    expect(await updateActual(ITEM, 70, 40)).toEqual({ ok: false, error: '담당 작업이 아님' })
    expect(ownerLookups).toEqual([[COMMON_QA]])
    expect(writes).toEqual([])
  })
})
