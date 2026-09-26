import { describe, expect, it } from 'vitest'
import { isDeliverablePathValid } from '@/lib/domain/deliverables'

const WS = 'aaaaaaaa-1111-4111-8111-111111111111'
const PID = 'bbbbbbbb-2222-4222-8222-222222222222'
const ITEM = 'cccccccc-3333-4333-8333-333333333333'
const OTHER = '99999999-8888-4777-8666-555555555555'
const SCOPE = { workspaceId: WS, projectId: PID }
const ok = `ws/${WS}/p/${PID}/deliverables/${ITEM}/1700000000000-plan.xlsx`

describe('isDeliverablePathValid', () => {
  it('자기 워크스페이스·프로젝트·WBS 항목 경로만 받는다', () => {
    expect(isDeliverablePathValid(SCOPE, ITEM, ok)).toBe(true)
  })

  it('다른 워크스페이스·다른 프로젝트·다른 항목의 경로를 거부한다', () => {
    expect(isDeliverablePathValid({ ...SCOPE, workspaceId: OTHER }, ITEM, ok)).toBe(false)
    expect(isDeliverablePathValid({ ...SCOPE, projectId: OTHER }, ITEM, ok)).toBe(false)
    expect(isDeliverablePathValid(SCOPE, OTHER, ok)).toBe(false)
  })

  it('다른 entity 세그먼트·무프로젝트(_) 경로를 거부한다', () => {
    expect(isDeliverablePathValid(SCOPE, ITEM, ok.replace('/deliverables/', '/issue-attachments/'))).toBe(false)
    expect(isDeliverablePathValid(SCOPE, ITEM, ok.replace(`/p/${PID}/`, '/p/_/'))).toBe(false)
  })

  it('옛 형식 <항목>/<파일> 과 경로 순회를 거부한다', () => {
    expect(isDeliverablePathValid(SCOPE, ITEM, `${ITEM}/1-a.pdf`)).toBe(false)
    expect(isDeliverablePathValid(SCOPE, ITEM, `ws/${WS}/p/${PID}/deliverables/${ITEM}/..`)).toBe(false)
    expect(isDeliverablePathValid(SCOPE, ITEM, `ws/${WS}/p/${PID}/deliverables/${ITEM}/../x/a.pdf`)).toBe(false)
  })
})
