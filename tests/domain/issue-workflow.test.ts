// SP5b I — 이슈 표시 상태 전이(스펙 D1·D4). 골든(tests/fixtures/parity/issue-workflow.json)은 tests/rls/issue-workflow.test.ts 가 DB 트리거로 같은 결과를 확인한다.
import { describe, expect, it } from 'vitest'
import golden from '../fixtures/parity/issue-workflow.json'
import { allowedTargets, canTransitionCode, categoryOf, categoryTransitionOk, initialStatus } from '@/lib/domain/issueWorkflow'
import { STATUS_TRANSITIONS } from '@/lib/domain/issues'
import { DEFAULT_ISSUE_STATUSES, parseVocab, type IssueStatusDef } from '@/lib/settings/vocab'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'

const defsOf = (name: string) => (golden.defs as Record<string, IssueStatusDef[]>)[name]

describe('이슈 표시 상태 — 골든 전이표', () => {
  it.each(golden.transitions)('$defs: $from → $to = $ok', ({ defs, from, to, ok }) => {
    expect(canTransitionCode(defsOf(defs), from, to)).toBe(ok)
  })
  it('범주 전이표는 11간선 — resolved→on_hold 만 없다(제품 고정)', () => {
    expect(Object.values(STATUS_TRANSITIONS).flat()).toHaveLength(11)
    expect(categoryTransitionOk('resolved', 'on_hold')).toBe(false)
    expect(categoryTransitionOk('on_hold', 'on_hold')).toBe(true)
  })
  it('기본 4정의의 전이 = 옛 canTransition(범주 전이표)과 같다 — 설정 키가 없는 프로젝트는 현행과 같다', () => {
    for (const f of DEFAULT_ISSUE_STATUSES) for (const t of DEFAULT_ISSUE_STATUSES) {
      expect(canTransitionCode(DEFAULT_ISSUE_STATUSES, f.code, t.code)).toBe(STATUS_TRANSITIONS[f.category].includes(t.category))
    }
  })
})

describe('이슈 표시 상태 — 첫 상태·선택지·범주', () => {
  it('첫 상태 = open 범주의 첫 활성(sort 순)', () => {
    for (const c of golden.inserts.filter(x => x.statusCode === null)) expect(initialStatus(defsOf(c.defs))?.code).toBe(c.initial)
  })
  it('선택지 = 허용 전이만(자기·비활성 제외) — 연구 픽스처의 검토(open)에서', () => {
    expect(allowedTargets(defsOf('research'), 'review').map(d => d.code)).toEqual(['intake', 'client_approval', 'execution', 'done'])
  })
  it('정의에 없는 code(지워진 상태)는 범주 null — 행의 범주(fromCategory)로 판정한다', () => {
    const defs = defsOf('research')
    expect(categoryOf(defs, 'gone')).toBeNull()
    expect(canTransitionCode(defs, 'gone', 'done')).toBe(false)
    expect(canTransitionCode(defs, 'gone', 'done', 'in_progress')).toBe(true)
    expect(canTransitionCode(defs, 'gone', 'client_approval', 'resolved')).toBe(false)
  })
})

describe('workflow.issue_statuses parse(SP5b D1·D2)', () => {
  it('골든의 두 정의는 parse 를 통과한다', () => {
    expect(parseVocab('workflow.issue_statuses', defsOf('default')).ok).toBe(true)
    expect(parseVocab('workflow.issue_statuses', defsOf('research')).ok).toBe(true)
  })
  it('open·resolved 범주에 활성이 없으면 거부, 범주 4값 밖이면 거부, 21개면 거부', () => {
    const noResolved = defsOf('research').map(d => d.category === 'resolved' ? { ...d, active: false } : d)
    expect(parseVocab('workflow.issue_statuses', noResolved)).toMatchObject({ ok: false })
    const noOpen = defsOf('research').filter(d => d.category !== 'open')
    expect(parseVocab('workflow.issue_statuses', noOpen)).toMatchObject({ ok: false })
    expect(parseVocab('workflow.issue_statuses', [...defsOf('research'), { ...defsOf('research')[0], code: 'x', category: 'closed' }])).toMatchObject({ ok: false })
    const many = Array.from({ length: 21 }, (_, i) => ({ code: `s${i}`, label: `상태${i}`, category: i === 0 ? 'resolved' : 'open', color: 'neutral', sort: i, active: true }))
    expect(parseVocab('workflow.issue_statuses', many)).toMatchObject({ ok: false })
  })
})

// 개정 §6.5.7 — 설정을 읽는 도메인 함수는 기본·R·C 세 구성으로 돈다(키 없음 = 제품 기본 4정의)
describe.each(SYNTHETIC_CONFIGS)('합성 구성 $id', (cfg) => {
  const raw = (cfg.project as Record<string, unknown>)['workflow.issue_statuses'] ?? DEFAULT_ISSUE_STATUSES
  it('정의가 parse 를 통과하고 첫 상태가 open 범주다', () => {
    const parsed = parseVocab('workflow.issue_statuses', raw)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(initialStatus(parsed.value)?.category).toBe('open')
  })
})
