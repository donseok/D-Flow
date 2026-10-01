import type { ComputedItem } from '@/lib/domain/types'
import { buildAoaWithProfile, buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { deriveStandardExcelProfile, resolveTeamColumns } from '@/lib/excel/standardProfile'

/** 표준 레이아웃(SP4 D16)을 옛 buildWbsAoa 와 같은 인자로 부르는 테스트 도우미 — 옛 빌더를 동작으로 시험하던 테스트가 런타임 경로를 시험하게 한다.
 *  기본 단계 이름은 옛 빌더의 기본값과 같다. 거부(표준 경로에서는 결함)는 throw. */
const LABELS3 = ['Phase', 'Task', 'Activity']
export function standardAoa(items: ComputedItem[], projectName: string, teamCodes: readonly string[], levelLabels: readonly string[] = LABELS3): unknown[][] {
  const r = buildAoaWithProfile(items, deriveStandardExcelProfile(resolveTeamColumns(items, teamCodes), levelLabels),
    { expandSubActs: false, levelLabels, deep: 'fold' }, projectName)
  if (!r.ok) throw new Error(`표준 레이아웃 거부: ${r.error}`)
  return r.aoa
}
export function standardWorkbook(items: ComputedItem[], holidays: { date: string; name: string }[], projectName: string,
  teamCodes: readonly string[], levelLabels: readonly string[] = LABELS3): ArrayBuffer {
  const r = buildWorkbookWithProfile(items, deriveStandardExcelProfile(resolveTeamColumns(items, teamCodes), levelLabels), holidays,
    { expandSubActs: false, levelLabels, deep: 'fold' }, projectName)
  if (!r.ok) throw new Error(`표준 레이아웃 거부: ${r.error}`)
  return r.buffer
}
