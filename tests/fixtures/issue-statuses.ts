import parity from './parity/issue-workflow.json'
import type { Issue } from '@/lib/domain/issues'
import type { IssueCategory, IssueStatusDef } from '@/lib/settings/vocab'

/**
 * 합성 구성 R(연구)의 이슈 5상태 — 접수(open)·검토(open)·고객 승인(on_hold)·실행(in_progress)·종료(resolved).
 * TS·SQL 전이 골든(parity/issue-workflow.json)과 같은 정의를 쓴다 — 화면 테스트가 "상태가 코드에 박혀 있지 않다"를 이 구성으로 증명한다.
 */
export const RESEARCH_STATUSES = parity.defs.research as IssueStatusDef[]

const CATEGORY_OF = new Map<string, IssueCategory>(RESEARCH_STATUSES.map(d => [d.code, d.category]))

/** 표시 상태 code 로 이슈 한 건 — 범주는 연구 정의에서 읽고, 정의에 없는 code 는 넘긴 범주(기본 open)를 쓴다 */
export function statusIssue(id: string, statusCode: string, over: Partial<Issue> = {}): Issue {
  return {
    id, issueNo: 1, code: `ISS-${id}`, projectId: 'project-1', areaId: null, codeAreaId: null,
    title: `이슈 ${id}`, body: '본문', status: CATEGORY_OF.get(statusCode) ?? 'open', statusCode, severity: 'medium',
    assigneeMemberIds: [], startDate: null, dueDate: null, subProcess: '', ownerDepartment: '', relatedSystems: [],
    sourceType: null, sourceDetail: '', minuteSources: [], resolutionNote: '', resolvedAt: null,
    createdBy: 'user-1', createdByName: '작성자', createdAt: '2026-07-31T00:00:00Z', updatedAt: '2026-07-31T00:00:00Z',
    ...over,
  }
}
