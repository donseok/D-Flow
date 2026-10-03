import type { ConfigArea } from '@/lib/settings/projectConfig'

export type IssueAreaRef = { id: string; code: string; name: string; sortOrder: number; active: boolean }
export const ISSUE_AREA_CODE_RE = /^[A-Z0-9]{1,8}$/

export function issueAreasOf(areas: readonly ConfigArea[]): IssueAreaRef[] {
  return areas.map(({ id, code, name, sortOrder, active }) => ({ id, code, name, sortOrder, active }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
}
export function activeIssueAreas(areas: readonly IssueAreaRef[]): IssueAreaRef[] {
  return areas.filter(area => area.active)
}
export function areaLabel(area: IssueAreaRef | undefined, fallbackId: string | null): string {
  return area ? `${area.code} · ${area.name}` : fallbackId ? '알 수 없는 영역' : '미분류'
}
