// tests/fixtures/seat.ts
// Seat 형 테스트 픽스처 — 필드가 늘 때마다 좌석 테스트 전부를 고치지 않도록 기본값을 한 곳에 모은다.
// 기본값은 SeatState·Phase·AnimName 의 첫 값(READY·design·typing)이다.
import type { Seat } from '@/lib/domain/seatmap'

export function makeSeat(overrides: Partial<Seat> = {}): Seat {
  const canManage = overrides.canManage ?? false, assigneeMine = overrides.assigneeMine ?? false
  return {
    orderId: 'o1', id8: 'o1', projectId: 'p1', itemId: 'i1', code: 'TSK-01-01', name: '시트',
    state: 'READY', phase: 'design', anim: 'typing', character: 'cat',
    agent: null, progress: 0,
    lastSignalAt: null, heartbeatAt: null, heartbeatPhase: null,
    note: null, rejected: false, reviewNote: null, reportId: null,
    resumeRequestedAt: null, resumeRequestedHost: null,
    waitReason: null,
    // 승인 어포던스는 따로 주지 않으면 자기 착수 없는 canApproveCompletion 과 같게 둔다(관리 자격 ∧ 내 담당 아님).
    canManage, assigneeMine, canApprove: canManage && !assigneeMine,
    agentMine: false, agentOwnerName: null,
    ...overrides,
  }
}
