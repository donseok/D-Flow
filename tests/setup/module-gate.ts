// tests/setup/module-gate.ts — 단위 테스트 전역 기본 mock(스펙 D10). vitest.config.ts 의 setupFiles 가 모든 테스트 파일 앞에 싣는다.
// 관문은 통과를 돌려준다 — 관문을 넣은 액션·라우트·페이지를 import 하는 기존 테스트가 설정 해석기(쿠키·DB)로 가지 않게.
// 관문 자체와 거부 경로를 보는 테스트는 vi.mocked(requireModule).mockResolvedValue(…) 로 거부를 주거나, 진짜가 필요하면
// vi.importActual('@/lib/modules/gate') 를 쓴다(tests/setup/module-gate-*.test.ts 가 두 동작을 고정한다).
// tests/rls(vitest.config.rls.ts)·settings:verify(vitest.config.verify.ts)에는 걸지 않는다 — 그쪽은 DB 를 쓴다.
import { vi } from 'vitest'

vi.mock('@/lib/modules/gate', () => ({
  requireModule: vi.fn(async () => ({ ok: true })),
  requireSessionModule: vi.fn(async () => ({ ok: true })),
  moduleState: vi.fn(async () => 'on'),
  moduleSetFor: vi.fn(async () => new Set((await import('@/lib/modules/defaults')).MODULE_IDS)),
  projectsWithModule: vi.fn(async (ids: readonly string[]) => [...new Set(ids)]),
  workspacesWithModule: vi.fn(async (ids: readonly string[]) => [...new Set(ids)]),
}))

// aiAvailable(D17) — (mock 된) hasLLM() 을 그대로 돌려준다. hasLLM 을 mock 하던 호출부 테스트가 그대로 돈다(tests/setup/ai-available-default.test.ts).
vi.mock('@/lib/modules/aiAvailable', () => ({
  aiAvailable: vi.fn(async () => (await import('@/lib/ai/provider')).hasLLM()),
}))

// SP5b W1 — 승인 판정 재료 로더(src/lib/agent/approvalState.ts)의 기본값 = 설정 키 없음(기본 1단계 review·subtree_or_admin, 대기 = review).
// 승인 액션을 import 하는 기존 테스트의 admin 조회 큐가 밀리지 않게 한다(스펙 §4.7 호환 규칙). 로더 자체는 tests/agent/approval-state.test.ts 가
// vi.importActual 로 본다. 다단계 경로를 보는 테스트는 vi.mocked(loadApprovalState).mockResolvedValue(…) 로 준다.
vi.mock('@/lib/agent/approvalState', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent/approvalState')>('@/lib/agent/approvalState')
  const { DEFAULT_APPROVAL_STEPS } = await import('@/lib/domain/approvalSteps')
  return {
    ...actual,
    loadApprovalState: vi.fn(async () => ({
      ok: true, pending: { step: 'review', index: 1, total: 1, approver: 'subtree_or_admin' },
      steps: DEFAULT_APPROVAL_STEPS.map((s) => ({ ...s })), stage: 'im',
    })),
    notifyApprovalStep: vi.fn(async () => {}),
    loadQueueApprovals: vi.fn(async () => new Map()),
  }
})

// SP5b W2 — 선행 충족 기준 판독(src/lib/agent/predecessorGate.ts)의 기본값 = 키 없음('reached' — 현행). 선행 판정 소비처(claim 게이트·알림·
// 대기 사유)를 import 하는 기존 테스트의 admin 조회 큐가 밀리지 않게 한다. 기준을 바꿔 보는 테스트는 vi.mocked(…).mockResolvedValue('final').
vi.mock('@/lib/agent/predecessorGate', () => ({
  loadPredecessorGate: vi.fn(async () => 'reached'),
  loadPredecessorGates: vi.fn(async (_admin: unknown, ids: readonly string[]) => new Map([...new Set(ids)].map((id) => [id, 'reached']))),
  loadStageLabelsMap: vi.fn(async (_admin: unknown, ids: readonly string[]) => new Map([...new Set(ids)].map((id) => [id, {}]))),
}))
// SP5b W2 — WBS 화면의 승인 주문 축(src/lib/data/approvedItems.ts) 기본값 = 없음. 페이지 테스트가 주문 표를 흉내 내지 않아도 되게
vi.mock('@/lib/data/approvedItems', () => ({ getApprovedItemIds: vi.fn(async () => []) }))
