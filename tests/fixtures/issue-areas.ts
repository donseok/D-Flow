import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
// 이관된 기존 프로젝트를 표현하는 픽스처. 런타임 정본은 프로젝트마다 주입한다.
export const TEST_AREAS: IssueAreaRef[] = ['기준관리', '손익관리', '영업', '품질·설계', '생산계획', '조업', '출하', '원가'].map((name, index) => ({
  id: String(index).padStart(2, '0'), code: String(index).padStart(2, '0'), name, sortOrder: index, active: true,
}))
export const TEST_ENTRY_CONTEXT = { policy: DEFAULT_ID_POLICY, areas: TEST_AREAS, rules: { analysis: 'optional' as const, areaRequired: false } }
export const actionAreaId = (code: string) => `00000000-0000-0000-7e57-000000001b${code}`
export const ACTION_ENTRY_CONTEXT = { ...TEST_ENTRY_CONTEXT, areas: TEST_AREAS.map(area => ({ ...area, id: actionAreaId(area.code) })) }
export const REQUIRED_ENTRY_CONTEXT = { ...TEST_ENTRY_CONTEXT, rules: { analysis: 'required' as const, areaRequired: true } }
