import { describe, it, expect, vi, beforeEach } from 'vitest'

/** wbs.md 웹 업로드 액션 — 미리보기(자동 부착 판정)·적용(runWbsImport 공유 코어).
 *  계약: 스펙 §업로드 경로 2개 — 웹 경로 = 자동 부착 + 확인(미리보기 카드 → [적용/취소]). */

const { db, requireProjectAdmin, runWbsImport } = vi.hoisted(() => {
  const db = {
    // 테이블별 응답 큐 — agent 라우트 테스트와 동형
    queues: {} as Record<string, Array<{ data?: unknown; error?: { message: string } | null }>>,
    // runWbsImport 실물을 돌리는 케이스(R1)만 쓰는 RPC 응답 큐
    rpcQueue: [] as Array<{ data?: unknown; error?: { message: string } | null }>,
  }
  return {
    db,
    requireProjectAdmin: vi.fn(),
    runWbsImport: vi.fn(),
  }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const resp = (db.queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'like', 'limit', 'is', 'update', 'order', 'range']) b[k] = () => b
      // ensureAgentProject(applyWbsUpload 의 자동 활성 경로, 2026-08-24)의 insert — 결과를 안 쓰는
      // fire-and-forget 형 호출이라 성공만 흉내낸다. 활성 여부는 agent_projects 큐로 제어한다.
      b.insert = () => Promise.resolve({ data: null, error: null })
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
    rpc: async () => db.rpcQueue.shift() ?? { data: null, error: null },
  }),
}))
// runWbsImport 실물 케이스(R1)의 부수효과 — 설정 시드 쓰기·알림은 목
vi.mock('@/lib/settings/write', () => ({ writeProjectSettingsInternal: vi.fn(async () => ({ ok: true, status: 'applied', revision: 2, commandId: 'c' })) }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn(async () => ({ ok: true })) }))
// levels 정본은 해석기(R2) — 액션은 설정 표를 직접 읽지 않는다
const cfg = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: cfg.getProjectConfig }))
vi.mock('@/lib/agent/wbsImport', async (orig) => ({
  ...(await orig() as object),
  runWbsImport: (...a: unknown[]) => runWbsImport(...a),
}))

import { previewWbsUpload, applyWbsUpload } from '@/app/actions/wbsMarkdown'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigUnavailableError, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
import { ERR_LEVEL_LABELS_INVALID } from '@/lib/agent/wbsImport'

const PID = 'proj-1'
const ADMIN = { ok: true as const, actor: { userId: 'u-admin', isSuperuser: false } }

const PL_MD = `---
module: acme-qa
attach: PH-03/SYS-QA

levels:
  - { name: Phase,     prefix: PH,  progress: rollup, owner: pmo, upload: false }
  - { name: System,    prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Subsystem, prefix: SUB, progress: rollup }
  - { name: Task,      prefix: TSK, progress: input }
  - { name: SubTask,   prefix: STK, progress: checklist, optional: true, upload: fold }
---

## SUB-QA-JD: 판정
- [ ] TSK-QA-JD-01: 자동판정   w:5  ~2026-12-19
  - [ ] STK-QA-JD-01-1: 룰 리뷰
- [ ] TSK-QA-JD-02: 재판정   w:3  ~2026-12-26
`

const SKEL_MD = `---
module: acme-skel

levels:
  - { name: Phase, prefix: PH,  progress: rollup }
  - { name: Task,  prefix: TSK, progress: input }
---

## PH-01: 분석
- [ ] TSK-AN-01: 분석서   w:5  ~2026-09-30
`

const SERVER_LABELS = ['Phase', 'System', 'Subsystem', 'Task', 'SubTask']

beforeEach(() => {
  db.queues = {}
  db.rpcQueue = []
  requireProjectAdmin.mockReset()
  requireProjectAdmin.mockResolvedValue(ADMIN)
  runWbsImport.mockReset()
  cfg.getProjectConfig.mockReset().mockResolvedValue(makeProjectConfig({ 'core.level_labels': SERVER_LABELS }))
})

describe('previewWbsUpload', () => {
  it('관리자 아님 → 거부, DB 접근 없음', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한이 없습니다.' })
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('권한')
  })

  it('PL 파일 — attach 자동 판정 + levels 일치 + 신규/갱신 분류 + fold 건수', async () => {
    db.queues = {
      wbs_items: [
        { data: [{ external_ref: 'acme-skel/SYS-QA' }] },          // attach suffix 해석 (유일)
        { data: [{ external_ref: 'acme-qa/TSK-QA-JD-02' }] },      // 기존 ref 조회 → 1건은 갱신
      ],
    }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(true)
    expect(r).toMatchObject({
      mode: 'pl', module: 'acme-qa', attach: 'PH-03/SYS-QA',
      attachRef: 'acme-skel/SYS-QA', attachFound: true,
      levelsStatus: 'match', foldCount: 1, newCount: 2, updateCount: 1, canApply: true,
    })
    expect(r.counts).toMatchObject({ Subsystem: 1, Task: 2, SubTask: 1 })
    expect(cfg.getProjectConfig).toHaveBeenCalledWith(PID, { client: expect.anything() })   // admin 주입
  })

  it('attach 노드 없음 → attachFound:false, canApply:false', async () => {
    db.queues = {
      wbs_items: [{ data: [] }, { data: [] }],
    }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(true)
    expect(r.attachFound).toBe(false)
    expect(r.canApply).toBe(false)
  })

  it('levels 불일치 → levelsStatus:mismatch, canApply:false', async () => {
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'Task', 'Activity'] }))
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }, { data: [] }],
    }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.levelsStatus).toBe('mismatch')
    expect(r.canApply).toBe(false)
  })

  it('단계 이름 설정이 손상(invalid)이면 "없음"으로 합치지 않고 손상 문구로 막는다(C2-F2)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': 'not-a-list' }))
    db.queues = { wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }, { data: [] }] }
    const r = await previewWbsUpload(PID, PL_MD)
    spy.mockRestore()
    expect(r.ok).toBe(true)
    expect(r.canApply).toBe(false)
    expect(r.serverLevels).toBeNull()
    expect(r.errors).toContain('단계 이름 설정이 손상되어 대조할 수 없습니다 — 관리자가 설정을 다시 저장하세요.')
    expect(r.errors?.join('\n')).not.toContain('정본: 없음')
  })

  it('단계 이름이 미설정(required_missing)이면 손상 문구가 아니라 "정본: 없음" 안내(F-3a)', async () => {
    cfg.getProjectConfig.mockResolvedValue(makeProjectConfig({}))
    db.queues = { wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }, { data: [] }] }
    const r = await previewWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(true)
    expect(r.levelsStatus).toBe('mismatch')
    expect(r.canApply).toBe(false)
    expect(r.errors?.some(e => e.includes('정본: 없음'))).toBe(true)
    expect(r.errors).not.toContain(ERR_LEVEL_LABELS_INVALID)
  })

  it('설정 조회 실패의 DB 원문은 응답에 싣지 않고 로그에만 남긴다(C2-F1)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    cfg.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: relation "x" does not exist'))
    db.queues = { wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }] }
    const r = await previewWbsUpload(PID, PL_MD)
    const logged = JSON.stringify(spy.mock.calls, (_k, v) => (v instanceof Error ? v.message : v))
    spy.mockRestore()
    expect(r).toEqual({ ok: false, error: ERR_CONFIG_UNAVAILABLE })
    expect(logged).toContain('relation')
  })

  it('그 밖의 예외도 원문 대신 고정 문구 — 미리보기에 실패했습니다(C2-F1)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.queues = { wbs_items: [{ data: null, error: { message: 'permission denied for table wbs_items' } }] }
    const r = await previewWbsUpload(PID, PL_MD)
    spy.mockRestore()
    expect(r).toEqual({ ok: false, error: '미리보기에 실패했습니다.' })
  })

  it('골격 파일(attach 없음) → mode:skeleton, levelsStatus:seed', async () => {
    db.queues = { wbs_items: [{ data: [] }] } // 기존 ref 조회만
    const r = await previewWbsUpload(PID, SKEL_MD)
    expect(r).toMatchObject({ mode: 'skeleton', levelsStatus: 'seed', canApply: true })
    expect(cfg.getProjectConfig).not.toHaveBeenCalled()   // 골격은 대조하지 않는다(시드 예정)
  })

  it('검증 에러가 있으면 errors 전량 + canApply:false', async () => {
    const bad = PL_MD.replace('## SUB-QA-JD: 판정', '## PH-03: 구축\n\n## SUB-QA-JD: 판정')
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }, { data: [] }],
    }
    const r = await previewWbsUpload(PID, bad)
    expect(r.errors?.some(e => e.includes('골격'))).toBe(true)
    expect(r.canApply).toBe(false)
  })
})

describe('applyWbsUpload', () => {
  it('정상 PL — runWbsImport 에 해석된 attachRef·module·levels·노드가 넘어간다', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }],
      agent_projects: [{ data: { enabled: true } }], // 이미 활성 — ensureAgentProject no-op
    }
    runWbsImport.mockResolvedValue({ ok: true, upserted: 3, skipped: 0, unmatched: [], nonLeafSkipped: [], ordersCreated: 2 })
    const r = await applyWbsUpload(PID, PL_MD)
    expect(r).toMatchObject({ ok: true, upserted: 3, ordersCreated: 2 })
    expect(runWbsImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      projectId: PID, module: 'acme-qa', attachRef: 'acme-skel/SYS-QA', actorUserId: 'u-admin',
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'TSK-QA-JD-01', level: 3, weight: 5 })]),
    }))
  })

  it('검증 에러 파일 — runWbsImport 를 호출하지 않는다(fail-closed, 클라이언트 신뢰 안 함)', async () => {
    const bad = PL_MD.replace('- [ ] TSK-QA-JD-02: 재판정', '- [ ] TSK-QA-JD-01: 중복')
    const r = await applyWbsUpload(PID, bad)
    expect(r.ok).toBe(false)
    expect(runWbsImport).not.toHaveBeenCalled()
  })

  it('코어가 throw 한 DB 원문은 응답에 싣지 않는다 — 업로드에 실패했습니다(C2-F1)', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockRejectedValue(new Error('[settings/write] 알 수 없는 DB 오류: boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await applyWbsUpload(PID, PL_MD)
    const logged = JSON.stringify(spy.mock.calls, (_k, v) => (v instanceof Error ? v.message : v))
    spy.mockRestore()
    expect(r).toEqual({ ok: false, error: '업로드에 실패했습니다.' })
    expect(JSON.stringify(r)).not.toContain('boom')
    expect(logged).toContain('boom')
  })

  it('코어가 설정 조회 실패(ConfigUnavailableError)로 throw 하면 ERR_CONFIG_UNAVAILABLE(F-3b)', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: relation "x" does not exist'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await applyWbsUpload(PID, PL_MD)
    spy.mockRestore()
    expect(r).toEqual({ ok: false, error: ERR_CONFIG_UNAVAILABLE })
  })

  it('코어 실패는 메시지 그대로 반환', async () => {
    db.queues = {
      wbs_items: [{ data: [{ external_ref: 'acme-skel/SYS-QA' }] }],
      agent_projects: [{ data: { enabled: true } }],
    }
    runWbsImport.mockResolvedValue({ ok: false, code: 'attach_not_found', message: 'attach 노드가 없습니다' })
    const r = await applyWbsUpload(PID, PL_MD)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('attach')
  })
})

// R1 — 명단은 정규형(local@ASCII 호스트)으로 저장된다. 웹 업로드의 담당자(@kim@한글.kr·끝 점)도 같은 규칙으로 매칭돼야 한다.
// 이 절만 runWbsImport 실물을 돌린다(API 경로와 같은 코어 — tests/agent/wbs-import.test.ts 가 API 입구를 본다).
describe('applyWbsUpload — 담당자 매칭은 정규형으로(R1)', () => {
  it.each([
    ['kim@한글.kr', 'kim@xn--bj0bj06e.kr'],
    ['alice@acme.test.', 'alice@acme.test'],
  ])('담당자 %s 는 명단 %s 와 매칭된다', async (assignee, stored) => {
    const actual = await vi.importActual<typeof import('@/lib/agent/wbsImport')>('@/lib/agent/wbsImport')
    runWbsImport.mockImplementation(actual.runWbsImport as never)
    const md = SKEL_MD.replace('TSK-AN-01: 분석서   w:5', `TSK-AN-01: 분석서   @${assignee} w:5`)
    db.queues = {
      agent_projects: [{ data: { enabled: true } }],                                  // ensureAgentProject — 이미 활성
      wbs_items: [{ data: [] }, { data: null }, { data: [] }],                       // 깊이 선행 조회·담당자 반영·주문 대상(없음)
      project_members: [{ data: [{ id: 'member-1', people: { email: stored, active: true } }] }],
    }
    db.rpcQueue = [{ data: { upserted: 1, skipped: 0, ids: { 'acme-skel/TSK-AN-01': 'id-t' }, new_refs: ['acme-skel/TSK-AN-01'] } }]
    const r = await applyWbsUpload(PID, md)
    expect(r).toMatchObject({ ok: true, upserted: 1 })
    expect(r.unmatched).toEqual([])
  })
})
