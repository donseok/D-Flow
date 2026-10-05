// SP5b W1 — 승인 단계·선행 기준·크레딧 정책의 순수 계약(스펙 D14·D15·D21, 개정 §3.3). 골든 tests/fixtures/parity/workflow.json 은
// tests/rls/workflow-policy.test.ts 가 같은 파일로 SQL(workflow_value_of·wbs_predecessor_reached·wbs_stage_reaches_gate)을 대조한다.
import { describe, expect, it } from 'vitest'
import golden from '../fixtures/parity/workflow.json'
import {
  DEFAULT_APPROVAL_STEPS, actualHundredBlocked, approverOf, effectiveSteps, judgePendingApproval, needsRoundOpen, nextPendingStep,
  parseApprovalSteps, pendingApproval, stepLabelOf, type ApprovalStepDef,
} from '@/lib/domain/approvalSteps'
import { predecessorReached, predecessorReachedFor, stageReachesGate, type PredecessorGate } from '@/lib/domain/agentWork'
import { DEFAULT_CREDIT_POLICY, clampCredit, parseCreditPolicy, validateStageCredits } from '@/lib/domain/stageCredits'
import { settingDef } from '@/lib/settings/registry'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'

const TWO: ApprovalStepDef[] = [
  { code: 'internal', label: '내부 검토', approver: 'subtree_or_admin' },
  { code: 'client', label: '고객 승인', approver: 'admin' },
]

describe('골든 — 기본값·선행 판정·모양 검사(TS 쪽)', () => {
  it('레지스트리 기본값 = 골든 defaults(SQL workflow_value_of 의 리터럴과 같은 파일)', () => {
    for (const [key, v] of Object.entries(golden.defaults)) {
      expect(settingDef('project', key)!.default, key).toEqual(v)
    }
  })
  it('predecessorReachedFor — 120 조합(gate 2 × stage 5 × 승인 2 × 실적 3 × dev_workflow 2)', () => {
    expect(golden.predecessor).toHaveLength(120)
    for (const c of golden.predecessor) {
      const got = predecessorReachedFor({ stage: c.stage, orderApproved: c.approved, actualPct: c.actual, devWorkflow: c.dev }, c.gate as PredecessorGate)
      expect(got, JSON.stringify(c)).toBe(c.reached)
    }
  })
  it('stageReachesGate — RPC 첫 도달의 단계 축', () => {
    for (const c of golden.stageReaches) expect(stageReachesGate(c.stage, c.gate as PredecessorGate), JSON.stringify(c)).toBe(c.reaches)
  })
  it('옛 predecessorReached 는 reached 래퍼다(호환 규칙 S1)', () => {
    for (const c of golden.predecessor.filter((x) => x.gate === 'reached')) {
      expect(predecessorReached({ stage: c.stage, orderApproved: c.approved, actualPct: c.actual })).toBe(c.reached)
    }
  })
  it('설정 모양 — 레지스트리 parse 통과 ⇔ 골든 ok(같은 쌍을 SQL 모양 검사가 본다)', () => {
    for (const [key, cases] of Object.entries(golden.shape)) {
      const def = settingDef('project', key)!
      for (const c of cases) expect(def.parse(c.value).ok, `${key} ${JSON.stringify(c.value)}`).toBe(c.ok)
    }
  })
})

describe('승인 단계', () => {
  it('parseApprovalSteps — 트림한 라벨을 저장한다, label null 은 기본 단계 review 만', () => {
    expect(parseApprovalSteps([{ code: 'a', label: ' 검토 ', approver: 'admin' }])).toEqual({ ok: true, value: [{ code: 'a', label: '검토', approver: 'admin' }] })
    expect(parseApprovalSteps(DEFAULT_APPROVAL_STEPS)).toEqual({ ok: true, value: DEFAULT_APPROVAL_STEPS })
    expect(parseApprovalSteps([{ code: 'a', label: null, approver: 'admin' }]).ok).toBe(false)
  })
  it('유효 단계(D15) — im·xx 이고 스냅샷이 있으면 스냅샷, 그 밖은 현재 설정', () => {
    expect(effectiveSteps({ stage: 'im', reviewSteps: ['review'] }, TWO)).toEqual(['review'])
    expect(effectiveSteps({ stage: 'xx', reviewSteps: ['internal', 'client'] }, DEFAULT_APPROVAL_STEPS)).toEqual(['internal', 'client'])
    expect(effectiveSteps({ stage: 'im', reviewSteps: null }, TWO)).toEqual(['internal', 'client'])
    expect(effectiveSteps({ stage: 'ip', reviewSteps: ['review'] }, TWO)).toEqual(['internal', 'client'])
    expect(needsRoundOpen({ stage: 'xx', reviewSteps: null })).toBe(true)
    expect(needsRoundOpen({ stage: 'im', reviewSteps: ['review'] })).toBe(false)
    expect(needsRoundOpen({ stage: 'ip', reviewSteps: null })).toBe(false)
  })
  it('대기 단계·승인자 — 사라진 단계는 admin(fail-closed), 라벨은 code 그대로', () => {
    expect(nextPendingStep(['internal', 'client'], [])).toBe('internal')
    expect(nextPendingStep(['internal', 'client'], [{ stepCode: 'internal' }])).toBe('client')
    expect(nextPendingStep(['internal', 'client'], [{ stepCode: 'internal' }, { stepCode: 'client' }])).toBeNull()
    expect(approverOf('internal', TWO)).toBe('subtree_or_admin')
    expect(approverOf('gone', TWO)).toBe('admin')
    expect(stepLabelOf('gone', TWO, '승인')).toBe('gone')
    expect(stepLabelOf('review', DEFAULT_APPROVAL_STEPS, '승인')).toBe('승인')
    expect(pendingApproval({ stage: 'im', reviewSteps: ['internal', 'client'] }, TWO, [{ stepCode: 'internal' }]))
      .toEqual({ step: 'client', index: 2, total: 2, approver: 'admin' })
  })
  it('judgePendingApproval — RPC 규칙: 열린 라운드의 미승인 단계, 없으면 새 라운드의 첫 단계(현재 설정)', () => {
    expect(judgePendingApproval({ stage: 'im', reviewSteps: ['internal', 'client'] }, TWO, [{ stepCode: 'internal' }]).step).toBe('client')
    expect(judgePendingApproval({ stage: 'im', reviewSteps: null }, TWO, []).step).toBe('internal')
    expect(judgePendingApproval({ stage: 'ip', reviewSteps: null }, DEFAULT_APPROVAL_STEPS, [])).toEqual({ step: 'review', index: 1, total: 1, approver: 'subtree_or_admin' })
    // 그 라운드가 다 승인된 im(서비스 경로로 단계만 되돌린 행) — 새 라운드
    expect(judgePendingApproval({ stage: 'im', reviewSteps: ['review'] }, TWO, [{ stepCode: 'review' }])).toEqual({ step: 'internal', index: 1, total: 2, approver: 'subtree_or_admin' })
  })
  it('actualHundredBlocked — D14 순서(im 대기 절이 dev_workflow 앞, 잠금이 단계 절 앞)', () => {
    const base = { devWorkflow: true, locked: false, stage: 'ip' as string | null, reviewSteps: null as string[] | null, approvalSteps: DEFAULT_APPROVAL_STEPS }
    expect(actualHundredBlocked(base)).toBeNull()
    expect(actualHundredBlocked({ ...base, locked: true })).toBe('locked')
    expect(actualHundredBlocked({ ...base, approvalSteps: TWO })).toBe('approval_required')
    expect(actualHundredBlocked({ ...base, approvalSteps: TWO, locked: true })).toBe('locked')
    expect(actualHundredBlocked({ ...base, stage: 'xx', approvalSteps: TWO })).toBeNull()
    // im 대기 라운드는 dev_workflow 를 꺼도 막힌다
    expect(actualHundredBlocked({ ...base, devWorkflow: false, stage: 'im', reviewSteps: ['internal', 'client'] })).toBe('approval_required')
    expect(actualHundredBlocked({ ...base, devWorkflow: false, stage: 'ip', approvalSteps: TWO })).toBeNull()
    // 스냅샷 1단계 라운드는 설정이 2단계여도 막히지 않는다(그 반대도)
    expect(actualHundredBlocked({ ...base, stage: 'im', reviewSteps: ['review'], approvalSteps: TWO })).toBeNull()
    expect(actualHundredBlocked({ ...base, stage: 'im', reviewSteps: ['internal', 'client'] })).toBe('approval_required')
  })
})

describe('크레딧 정책', () => {
  it('기본 정책 = 현행(5 단위·간격 10), 반례 0/20/25/90/100 은 {5,5} 에서만 통과', () => {
    expect(DEFAULT_CREDIT_POLICY).toEqual({ step: 5, min_gap: 10 })
    const t = { default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } }
    expect(validateStageCredits(t).ok).toBe(false)
    expect(validateStageCredits(t, { step: 5, min_gap: 5 })).toEqual({ ok: true, credits: t })
    expect(validateStageCredits({ default: { as: 0, ip: 21, rw: 25, im: 90, xx: 100 } }, { step: 5, min_gap: 1 }).ok).toBe(false)
    expect(validateStageCredits({ default: { as: 0, ip: 21, rw: 25, im: 90, xx: 100 } }, { step: 1, min_gap: 1 }).ok).toBe(true)
  })
  it('parseCreditPolicy — step 1|5, min_gap 정수 1~10, 모르는 필드 거부', () => {
    expect(parseCreditPolicy({ step: 1, min_gap: 3 })).toEqual({ ok: true, value: { step: 1, min_gap: 3 } })
    for (const bad of [{ step: 2, min_gap: 3 }, { step: 1, min_gap: 0 }, { step: 1, min_gap: 11 }, { step: 1 }, { step: 1, min_gap: 3, x: 1 }, null]) {
      expect(parseCreditPolicy(bad).ok, JSON.stringify(bad)).toBe(false)
    }
  })
  it('clampCredit — 정책 단위·간격(생략 = 현행)', () => {
    const t = { as: 0, ip: 20, rw: 25, im: 90, xx: 100 }
    expect(clampCredit(23, 'ip', t, { step: 1, min_gap: 1 })).toBe(23)
    expect(clampCredit(24, 'ip', t, { step: 1, min_gap: 1 })).toBe(24)
    expect(clampCredit(25, 'ip', t, { step: 1, min_gap: 1 })).toBe(24)   // rw(25) - 1
    expect(clampCredit(42, 'ip', { as: 0, ip: 30, rw: 50, im: 80, xx: 100 })).toBe(40)
  })
})

// 설정 조합(개정 §6.5.7) — 합성 구성의 크레딧 표가 기본 정책을 지키고(C 는 키 없음 — D24), 기본 승인 단계에서 판정이 현행과 같다
describe.each(SYNTHETIC_CONFIGS)('합성 구성 $id', (cfg) => {
  it('크레딧 표가 있으면 기본 정책에서 통과한다', () => {
    const t = cfg.project['workflow.stage_credits']
    if (t) expect(validateStageCredits(t).ok).toBe(true)
  })
  it('기본 1단계 — 사람 xx·실적 100 은 승인 판정이 현행과 같다(잠금만 막는다)', () => {
    expect(judgePendingApproval({ stage: 'ip', reviewSteps: null }, DEFAULT_APPROVAL_STEPS, []).total).toBe(1)
    expect(actualHundredBlocked({ devWorkflow: true, locked: false, stage: 'im', reviewSteps: ['review'], approvalSteps: DEFAULT_APPROVAL_STEPS })).toBeNull()
  })
})
