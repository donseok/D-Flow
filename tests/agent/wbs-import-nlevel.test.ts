import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ERR_LEVEL_LABELS_INVALID, toRpcNode, validateLevels, type LevelDecl } from '@/lib/agent/wbsImport'

/** 계약 v2.2(nlevel) — .claude/skills/dflow-wbs-nlevel/references/wbs-nlevel-md-contract.md §import 계약 v2.2 */

const LEVELS: LevelDecl[] = [
  { name: 'Phase', prefix: 'PH', progress: 'rollup' },
  { name: 'System', prefix: 'SYS', progress: 'rollup' },
  { name: 'Subsystem', prefix: 'SUB', progress: 'rollup' },
  { name: 'WP', prefix: 'WP', progress: 'rollup', report: 'weekly' },
  { name: 'Activity', prefix: 'ACT', progress: 'rollup', optional: true },
  { name: 'Task', prefix: 'TSK', progress: 'input' },
  { name: 'SubTask', prefix: 'STK', progress: 'checklist', optional: true, upload: 'fold' },
]

const BASE = {
  id: 'T1', parent_id: null as string | null, kind: 'task' as const, title: 't', stage: null,
  category: null, domain: null, assignee: null, schedule: null, depends: [] as string[],
  acceptance: [] as string[], priority: null, model: null, tags: [] as string[],
  prd_ref: null, entry_point: null, spec_sections: null,
}

describe('validateLevels — levels 선언 구조 검증(순수부)', () => {
  it('정상 7층 통과 — upload 기본 true, fold 는 최심층만', () => {
    const r = validateLevels(LEVELS)
    expect('error' in r).toBe(false)
    if (!('error' in r)) expect(r.levels).toHaveLength(7)
  })
  it('배열 아님·빈 배열 거부', () => {
    expect('error' in validateLevels(null)).toBe(true)
    expect('error' in validateLevels([])).toBe(true)
  })
  it('progress 허용 밖 값 거부', () => {
    expect('error' in validateLevels([{ name: 'Phase', prefix: 'PH', progress: 'percent' }])).toBe(true)
  })
  it('name·prefix 중복 거부', () => {
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup' },
      { name: 'Phase2', prefix: 'PH', progress: 'input' },
    ])).toBe(true)
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup' },
      { name: 'Phase', prefix: 'P2', progress: 'input' },
    ])).toBe(true)
  })
  it('input 층은 upload:true 강제 — false/fold 거부', () => {
    expect('error' in validateLevels([{ name: 'Task', prefix: 'TSK', progress: 'input', upload: false }])).toBe(true)
    expect('error' in validateLevels([{ name: 'Task', prefix: 'TSK', progress: 'input', upload: 'fold' }])).toBe(true)
  })
  it('upload 는 아래에서 위로만 — 위층 false 아래층 true 거부', () => {
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup' },
      { name: 'WP', prefix: 'WP', progress: 'rollup', upload: false },
      { name: 'Task', prefix: 'TSK', progress: 'input' },
    ])).toBe(true)
  })
  it('선두 연속 upload:false 는 골격층 선언 — 그 아래 true 허용 (PL 파일 정본 형태, E2E 2026-08-22 실측)', () => {
    const r = validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup', owner: 'pmo', upload: false },
      { name: 'System', prefix: 'SYS', progress: 'rollup', owner: 'pmo', upload: false },
      { name: 'Subsystem', prefix: 'SUB', progress: 'rollup' },
      { name: 'Task', prefix: 'TSK', progress: 'input' },
    ])
    expect('error' in r).toBe(false)
  })
  it('선두 fold 는 여전히 거부 — 접힐 부모가 없다', () => {
    expect('error' in validateLevels([
      { name: 'Phase', prefix: 'PH', progress: 'rollup', upload: 'fold' },
      { name: 'Task', prefix: 'TSK', progress: 'input' },
    ])).toBe(true)
  })
  it('input 층 없는 선언 거부 — 발행 대상 층이 없으면 진도 입력 불가', () => {
    expect('error' in validateLevels([{ name: 'Phase', prefix: 'PH', progress: 'rollup' }])).toBe(true)
  })
})

describe('parseSchedule v2.2 — 종료일 단독 표기', () => {
  it('"~ 2026-11-14" → start:null, end 만 (nlevel wbs.md 의 ~날짜 토큰)', async () => {
    const { parseSchedule } = await import('@/lib/agent/wbsImport')
    expect(parseSchedule('~ 2026-11-14')).toEqual({ start: null, end: '2026-11-14' })
    expect(parseSchedule('~2026-11-14')).toEqual({ start: null, end: '2026-11-14' })
    // v2.0 양단 표기·오류 케이스는 종전 그대로
    expect(parseSchedule('2026-08-11 ~ 2026-08-14')).toEqual({ start: '2026-08-11', end: '2026-08-14' })
    expect('error' in parseSchedule('~11/14')).toBe(true)
  })
})

describe('toRpcNode v2.2 — levels 문맥의 노드 변환(순수부)', () => {
  it('level 인덱스 저장 + input 층 → dev_workflow:true, rollup 층 → false', () => {
    expect(toRpcNode('acme-op', { ...BASE, level: 5 }, 0, LEVELS))
      .toMatchObject({ level_idx: 5, dev_workflow: true })
    expect(toRpcNode('acme-op', { ...BASE, kind: 'wp' as const, level: 3 }, 0, LEVELS))
      .toMatchObject({ level_idx: 3, dev_workflow: false })
  })
  it('stage fp 는 ip 로 정규화(0096·계약 v2.3 과도기), todo 는 null, 모르는 값은 노드 단위 거부', () => {
    expect(toRpcNode('acme-op', { ...BASE, level: 5, stage: 'fp' }, 0, LEVELS)).toMatchObject({ stage: 'ip' })
    expect(toRpcNode('acme-op', { ...BASE, level: 5, stage: 'todo' }, 0, LEVELS)).toMatchObject({ stage: null })
    expect('error' in toRpcNode('acme-op', { ...BASE, level: 5, stage: 'zz' }, 0, LEVELS)).toBe(true)
  })
  it('milestone 은 input 층이어도 dev_workflow:false — 발행 제외', () => {
    expect(toRpcNode('acme-op', { ...BASE, level: 5, milestone: true }, 0, LEVELS))
      .toMatchObject({ milestone: true, dev_workflow: false })
  })
  it('levels 있는데 level 누락·범위 밖 → 노드 단위 거부', () => {
    expect('error' in toRpcNode('acme-op', { ...BASE }, 0, LEVELS)).toBe(true)
    expect('error' in toRpcNode('acme-op', { ...BASE, level: 7 }, 0, LEVELS)).toBe(true)
    expect('error' in toRpcNode('acme-op', { ...BASE, level: -1 }, 0, LEVELS)).toBe(true)
  })
  it('weight 는 양수만 — 0·음수·NaN 거부, 생략은 null', () => {
    expect(toRpcNode('acme-op', { ...BASE, level: 5, weight: 5 }, 0, LEVELS)).toMatchObject({ weight: 5 })
    expect(toRpcNode('acme-op', { ...BASE, level: 5 }, 0, LEVELS)).toMatchObject({ weight: null })
    expect('error' in toRpcNode('acme-op', { ...BASE, level: 5, weight: 0 }, 0, LEVELS)).toBe(true)
    expect('error' in toRpcNode('acme-op', { ...BASE, level: 5, weight: -1 }, 0, LEVELS)).toBe(true)
  })
  it('credit → credit_key, if_id 패스스루', () => {
    expect(toRpcNode('acme-op', { ...BASE, level: 5, credit: 'if', if_id: 'IF-0031' }, 0, LEVELS))
      .toMatchObject({ credit_key: 'if', if_id: 'IF-0031' })
  })
  it('levels 없으면 v2.0 경로 불변 — kind 규칙 dev_workflow, level_idx:null', () => {
    const r = toRpcNode('MES', { ...BASE, kind: 'task' as const }, 0)
    expect(r).toMatchObject({ dev_workflow: true, level_idx: null, milestone: false, weight: null })
  })
})

// ─────────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
// levels 정본 판독은 해석기(R4), 골격 시드는 설정 내부 쓰기(W6) — runWbsImport 는 설정 표를 직접 만지지 않는다
const cfg = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: cfg.getProjectConfig }))
const write = vi.hoisted(() => ({ writeProjectSettingsInternal: vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({ ok: true, status: 'applied', revision: 2, commandId: 'c' })) }))
vi.mock('@/lib/settings/write', () => write)
// CR-7(SP4 D15) — 골격 시드는 쓰기 전에 설정 저장과 같은 교차 검사를 거친다. 실물을 감싸 호출 인자를 기록하고, reject 를 주면 그 사유로 거부한다
const vcfg = vi.hoisted(() => ({ reject: null as string | null, calls: [] as unknown[][] }))
vi.mock('@/lib/settings/validateConfig', async (orig) => {
  const m = await orig() as typeof import('@/lib/settings/validateConfig')
  return {
    ...m,
    validateProjectConfig: (...a: Parameters<typeof m.validateProjectConfig>) => {
      vcfg.calls.push(a)
      return vcfg.reject ? { ok: false as const, fieldErrors: [{ key: 'core.level_labels', message: vcfg.reject }] } : m.validateProjectConfig(...a)
    },
  }
})
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as importPOST } from '@/app/api/v1/wbs/import/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_OWNER } from '../fixtures/credentials'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ERR_CONFIG_CONFLICT } from '@/lib/settings/errors'

type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null }

/** wbs-import.test.ts 의 목과 동형 + 필터 기록(골격 시드의 트리 깊이 선행 조회 검증용). */
function useAdmin(queues: Record<string, Resp[]>, rpcQueue: Resp[] = []) {
  const filters: Record<string, Array<[string, string, unknown]>> = {}
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'insert', 'delete', 'upsert', 'in', 'limit', 'order', 'range']) b[k] = () => b
      for (const k of ['eq', 'is']) b[k] = (col: string, v: unknown) => { (filters[table] ??= []).push([k, col, v]); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => rpcQueue.shift() ?? { data: null, error: null }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: CRED_OWNER, email: 'admin@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, filters }
}

const PROJECT_ID = '87654321-4321-4321-4321-987654321def'

/** 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 케이스마다 새 토큰과 그 행을 만든다. */
function patRow() {
  const cred = agentCredential({ scopes: ['work:report'] })
  return { token: cred.token, row: cred.row }
}

function post(body: unknown, bearer: string) {
  return new NextRequest('http://l/api/v1/wbs/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  })
}

/** 관리자 통과 공통 큐 — integration_credentials(조회 → last_used 갱신)·권한 4축·project_members(명단 권한: 멤버 게이트 → 관리자 판정 2회) */
const authzQueues = () => ({
  integration_credentials: [{ data: undefined as unknown }, { data: null }],
  project_members: [roster(rosterRow(PROJECT_ID, 'admin')), roster(rosterRow(PROJECT_ID, 'admin'))],
  ...credAxes([PROJECT_ID], 2),
})

const SERVER_LABELS = LEVELS.map(l => l.name)

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  delete process.env.AGENT_API_SECRET
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
  cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': SERVER_LABELS }))
})

describe('POST /wbs/import — v2.2 nlevel', () => {
  it('PL 업로드: attach 해석 + levels 일치 → RPC 에 p_attach_id·level_idx 실림', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin } = useAdmin({
      ...q,
      project_members: [...q.project_members, { data: [] }], // 권한 2회 뒤 담당자 매핑
      wbs_items: [
        { data: { id: 'attach-1' } }, // attach_ref → 노드 해석
        { data: [{ id: 'id-t', external_ref: 'acme-op/TSK-OP-EV-PR-01', dev_workflow: true }] }, // 갭 후보
      ],
      agent_work_orders: [{ data: [{ wbs_item_id: 'id-t' }] }], // 활성 주문 있음 — 갭 없음
    }, [{ data: { upserted: 2, skipped: 0, ids: { 'acme-op/SUB-OP-EV': 'id-s', 'acme-op/TSK-OP-EV-PR-01': 'id-t' }, new_refs: [] } }])

    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op',
      levels: LEVELS, attach_ref: 'acme-skel/SYS-OP',
      nodes: [
        { ...BASE, id: 'SUB-OP-EV', kind: 'wp', title: '생산이벤트', level: 2 },
        { ...BASE, id: 'TSK-OP-EV-PR-01', parent_id: 'SUB-OP-EV', title: '수집 프로세스', level: 5, weight: 5, credit: 'default' },
      ],
    }, token))
    expect(res.status).toBe(200)
    expect(cfg.getProjectConfig).toHaveBeenCalledWith(PROJECT_ID, { client: admin })   // 정본 대조는 admin 주입 해석기
    expect(write.writeProjectSettingsInternal).not.toHaveBeenCalled()                   // PL 업로드는 시드하지 않는다
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_upsert', expect.objectContaining({
      p_attach_id: 'attach-1',
      p_nodes: expect.arrayContaining([
        expect.objectContaining({ external_ref: 'acme-op/SUB-OP-EV', level_idx: 2, dev_workflow: false }),
        expect.objectContaining({ external_ref: 'acme-op/TSK-OP-EV-PR-01', level_idx: 5, weight: 5, credit_key: 'default', dev_workflow: true }),
      ]),
    }))
  })

  it('attach 노드 없음 → 400 attach_not_found (fail-closed, 골격 선행)', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    useAdmin({
      ...q,
      wbs_items: [{ data: null }], // attach 해석 실패
    })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op', levels: LEVELS, attach_ref: 'acme-skel/SYS-XX',
      nodes: [{ ...BASE, id: 'SUB-1', level: 2 }],
    }, token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('attach_not_found')
  })

  it('levels 가 서버 정본과 불일치 → 400 levels_mismatch', async () => {
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'Task', 'Activity'] }))
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    useAdmin({
      ...q,
    })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op', levels: LEVELS, attach_ref: 'acme-skel/SYS-OP',
      nodes: [{ ...BASE, id: 'SUB-1', level: 2 }],
    }, token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('levels_mismatch')
  })

  it('단계 이름 설정이 손상(invalid)이면 "정본: 없음"으로 안내하지 않고 손상 문구로 막는다 — RPC 없음(C2-F2)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': 'not-a-list' }))
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin } = useAdmin({ ...q })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op', levels: LEVELS, attach_ref: 'acme-skel/SYS-OP',
      nodes: [{ ...BASE, id: 'SUB-1', level: 2 }],
    }, token))
    spy.mockRestore()
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('validation_failed')
    expect(json.error).toContain('단계 이름 설정이 손상되어 대조할 수 없습니다')
    expect(json.error).not.toContain('정본: 없음')
    expect(admin.rpc).not.toHaveBeenCalledWith('import_wbs_upsert', expect.anything())
  })

  it('단계 이름이 미설정(required_missing)이면 손상이 아니라 levels_mismatch·"정본: 없음" 안내(F-3a)', async () => {
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({}))
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin } = useAdmin({ ...q })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op', levels: LEVELS, attach_ref: 'acme-skel/SYS-OP',
      nodes: [{ ...BASE, id: 'SUB-1', level: 2 }],
    }, token))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('levels_mismatch')
    expect(json.error).toContain('정본: 없음')
    expect(json.error).not.toContain(ERR_LEVEL_LABELS_INVALID)
    expect(admin.rpc).not.toHaveBeenCalledWith('import_wbs_upsert', expect.anything())
  })

  it('attach_ref 있는데 levels 없음 → 400 (구조 검증, 인증 전)', async () => {
    const { token } = patRow()
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op', attach_ref: 'acme-skel/SYS-OP',
      nodes: [{ ...BASE, id: 'SUB-1' }],
    }, token))
    expect(res.status).toBe(400)
  })

  it('levels 구조 위반(progress 오타) → 400 (인증 전)', async () => {
    const { token } = patRow()
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-op',
      levels: [{ name: 'Task', prefix: 'TSK', progress: 'percent' }],
      nodes: [{ ...BASE, id: 'T1', level: 0 }],
    }, token))
    expect(res.status).toBe(400)
  })

  it('골격 업로드(levels, attach 없음) → core.level_labels 를 설정 내부 쓰기로 시드', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin, filters } = useAdmin({
      ...q,
      wbs_items: [{ data: [] }], // 트리 depth 조회 — 빈 트리
      project_members: [...q.project_members, { data: [] }], // 권한 2회 뒤 담당자 매핑
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'acme-skel/PH-01': 'id-p' }, new_refs: [] } }])

    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-skel', levels: LEVELS,
      nodes: [{ ...BASE, id: 'PH-01', kind: 'phase', title: '분석', level: 0 }],
    }, token))
    expect(res.status).toBe(200)
    expect(write.writeProjectSettingsInternal).toHaveBeenCalledWith(expect.anything(), PROJECT_ID, { set: { 'core.level_labels': SERVER_LABELS } }, CRED_OWNER)
    // 트리 깊이 선행 조회는 SUB-ACT·스텁을 뺀다(0012 ①·validateConfig 와 같은 규칙)
    expect(filters.wbs_items).toEqual(expect.arrayContaining([['eq', 'is_owner_split', false], ['is', 'stub_for', null]]))
    // 골격 경로는 p_attach_id 를 싣지 않는다(레거시 RPC 와 인자 호환).
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_upsert',
      expect.not.objectContaining({ p_attach_id: expect.anything() }))
  })

  it('[CR-7] 골격 시드는 교차 검사(validateProjectConfig)를 지난 뒤에만 쓴다 — 시드 라벨과 트리 깊이를 넘긴다', async () => {
    vcfg.calls.length = 0
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    useAdmin({ ...q, wbs_items: [{ data: [] }], project_members: [...q.project_members, { data: [] }] },
      [{ data: { upserted: 1, skipped: 0, ids: { 'acme-skel/PH-01': 'id-p' }, new_refs: [] } }])
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-skel', levels: LEVELS,
      nodes: [{ ...BASE, id: 'PH-01', kind: 'phase', title: '분석', level: 0 }],
    }, token))
    expect(res.status).toBe(200)
    expect(vcfg.calls).toHaveLength(1)
    expect(vcfg.calls[0][0]).toEqual({ 'core.level_labels': SERVER_LABELS })
    expect(vcfg.calls[0][1]).toMatchObject({ treeMaxDepth: null })
  })

  it('[CR-7] 교차 검사가 거부하면 400 validation_failed — 설정을 쓰지 않고 upsert 도 부르지 않는다', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin } = useAdmin({ ...q, wbs_items: [{ data: [] }] })
    vcfg.reject = '교차 검사 거부'
    try {
      const res = await importPOST(post({
        project_id: PROJECT_ID, module: 'acme-skel', levels: LEVELS,
        nodes: [{ ...BASE, id: 'PH-01', kind: 'phase', title: '분석', level: 0 }],
      }, token))
      expect(res.status).toBe(400)
      const json = await res.json()
      expect(json.code).toBe('validation_failed')
      expect(json.error).toContain('교차 검사 거부')
      expect(write.writeProjectSettingsInternal).not.toHaveBeenCalled()
      expect(admin.rpc).not.toHaveBeenCalledWith('import_wbs_upsert', expect.anything())
    } finally { vcfg.reject = null }
  })

  it('골격 시드의 깊이 선행 조회는 쪽을 넘겨 끝까지 읽는다 — 둘째 쪽의 깊은 행이 축소 시드를 막는다(FM-17)', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, parent_id: null }))
    const chain = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, parent_id: i ? `c${i - 1}` : null }))    // 8단 — 7단 levels 보다 깊다
    const { admin } = useAdmin({ ...q, wbs_items: [{ data: firstPage }, { data: chain }] })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-skel', levels: LEVELS,
      nodes: [{ ...BASE, id: 'PH-01', kind: 'phase', title: '분석', level: 0 }],
    }, token))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('validation_failed')
    expect(json.error).toContain('levels 시드 실패')
    expect(write.writeProjectSettingsInternal).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalledWith('import_wbs_upsert', expect.anything())
  })

  it('골격 시드 쓰기가 실패하면(CONFIG_CONFLICT) 400 validation_failed 이고 import_wbs_upsert 는 부르지 않는다', async () => {
    write.writeProjectSettingsInternal.mockResolvedValueOnce({ ok: false, code: 'CONFIG_CONFLICT', error: '원문 relation "project_settings" boom' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin } = useAdmin({ ...q, wbs_items: [{ data: [] }] })
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'acme-skel', levels: LEVELS,
      nodes: [{ ...BASE, id: 'PH-01', kind: 'phase', title: '분석', level: 0 }],
    }, token))
    expect(res.status).toBe(400)
    const json = await res.json()
    spy.mockRestore()
    expect(json.code).toBe('validation_failed')
    expect(JSON.stringify(json)).toContain('CONFIG_CONFLICT')
    expect(json.error).toContain(ERR_CONFIG_CONFLICT)          // 코드의 고정 문구
    expect(JSON.stringify(json)).not.toContain('boom')         // 쓰기 결과의 error(원문)는 싣지 않는다
    expect(admin.rpc).not.toHaveBeenCalledWith('import_wbs_upsert', expect.anything())
  })

  it('레거시 payload(levels 없음) → RPC 인자에 p_attach_id 없음 (v2.0 하위호환)', async () => {
    const { token, row } = patRow()
    const q = authzQueues(); q.integration_credentials[0].data = row
    const { admin } = useAdmin({
      ...q,
      project_members: [...q.project_members, { data: [] }], // 권한 2회 뒤 담당자 매핑
      wbs_items: [{ data: [{ id: 'id-t', external_ref: 'MES/T1', dev_workflow: true }] }],
      agent_work_orders: [{ data: [{ wbs_item_id: 'id-t' }] }],
    }, [{ data: { upserted: 1, skipped: 0, ids: { 'MES/T1': 'id-t' }, new_refs: [] } }])
    const res = await importPOST(post({
      project_id: PROJECT_ID, module: 'MES', nodes: [{ ...BASE, id: 'T1' }],
    }, token))
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('import_wbs_upsert',
      expect.not.objectContaining({ p_attach_id: expect.anything() }))
  })
})
