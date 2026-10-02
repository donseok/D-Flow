import { describe, expect, it } from 'vitest'
import { detectWorkbook } from '@/lib/excel/detect'
import { linkByDepth, parseWithProfile } from '@/lib/excel/parseWithProfile'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { ComputedItem, WbsRow } from '@/lib/domain/types'
import { standardWorkbook } from '../fixtures/excel/standardAoa'
import { LEGACY_SENTINELS, findSentinels, sentinelsFor, zipTextParts } from '../fixtures/legacy-sentinels'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { calUtcSun } from '../helpers/calendarFixture'

// 부정 테스트 2(SP4 D7·D8, W20·W24) — WBS 표준 엑셀 출력. 사용자 정의 팀만 있는 구성의 파일에는 옛 기본값(5팀 코드·11구분명)이 0건이고,
// 같은 이름을 실제로 등록한 구성은 그 이름이 나오고 정상 왕복한다(단어 전역 금지로 통과시키지 않는다). 봇 부분은 SP8.
// 옛 이름의 평문은 tests/fixtures/legacy-sentinels.ts 하나에만 — 여기서는 그 상수로 꺼낸다.
const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
/** 단계 L개 깊이의 줄기 하나 + 잎 둘(팀 둘이 주관·지원) */
function treeFor(teams: readonly string[], L: number): ComputedItem[] {
  const rows: WbsRow[] = []
  let parent: string | null = null
  for (let d = 0; d < L - 1; d++) { rows.push(row({ id: `n${d}`, parentId: parent, code: `c${d}`, sortOrder: d, name: `줄기${d}` })); parent = `n${d}` }
  rows.push(row({ id: 'L1', parentId: parent, code: 'l1', sortOrder: 90, name: '잎1', plannedStart: '2026-03-02', plannedEnd: '2026-03-06',
    owners: [{ team: teams[0], kind: 'primary' }, ...(teams[1] ? [{ team: teams[1], kind: 'support' as const }] : [])] }))
  rows.push(row({ id: 'L2', parentId: parent, code: 'l2', sortOrder: 91, name: '잎2', plannedStart: '2026-03-09', plannedEnd: '2026-03-13',
    owners: [{ team: teams[teams.length - 1], kind: 'primary' }] }))
  return computeTree(rows, '2026-03-04', calUtcSun, { subActTeamOrder: teamOrderMap(teams) })
}
const LABELS: Record<keyof typeof SYNTHETIC_TEAMS, string[]> = {
  default: ['단계', '작업', '세부'], research: ['과제', '연구', '실험', '측정'], construction: ['공구', '공종', '작업'],
}
async function textOf(buf: ArrayBuffer): Promise<string> {
  return (await zipTextParts(buf)).map((p) => p.text).join('\n')
}
function roundTrip(buf: ArrayBuffer) {
  const det = detectWorkbook(buf)
  if (!det.ok) throw new Error(det.error)
  const parsed = parseWithProfile(buf, det.result.profile)
  if (!parsed.ok) throw new Error(parsed.error)
  const linked = linkByDepth(parsed.rows, { legacyLevelLabels: false })
  if (!linked.ok) throw new Error(JSON.stringify(linked.errors))
  return { profile: det.result.profile, items: linked.items }
}

describe.each(Object.keys(SYNTHETIC_TEAMS) as Array<keyof typeof SYNTHETIC_TEAMS>)('합성 구성 %s — 표준 엑셀에 SP4 센티널 0건', (cfg) => {
  const teams = SYNTHETIC_TEAMS[cfg].filter((t) => t.active).map((t) => t.code)
  const registered = SYNTHETIC_TEAMS[cfg].flatMap((t) => [t.code, t.name])
  it('파일의 텍스트 파트 전체(시트·공유 문자열·docProps)에 옛 기본값이 없다', async () => {
    const buf = standardWorkbook(treeFor(teams, LABELS[cfg].length), [], 'Acme', teams, LABELS[cfg])
    expect(findSentinels(await textOf(buf), sentinelsFor('SP4', registered))).toEqual([])
  })
  it('그 파일은 감지 → 파싱 → 링크로 왕복한다 — 팀 열은 그 구성의 팀', () => {
    const buf = standardWorkbook(treeFor(teams, LABELS[cfg].length), [], 'Acme', teams, LABELS[cfg])
    const { profile, items } = roundTrip(buf)
    expect(profile.teamColumns.map(([, c]) => c)).toEqual(teams)
    expect(items.filter((i) => i.owners.length > 0).map((i) => i.owners.map((o) => o.team))).toEqual([[teams[0], ...(teams[1] ? [teams[1]] : [])], [teams[teams.length - 1]]])
  })
})

describe('같은 이름을 실제로 등록한 구성 — 그 이름이 나오고 정상 동작한다(D8)', () => {
  const registeredLegacy = LEGACY_SENTINELS.teamCodes[1]   // 옛 팀 코드 하나를 이 구성이 스스로 등록했다
  const teams = [registeredLegacy, 'OPS']
  it('등록 이름은 파일에 나오고(센티널에서 빠진다), 나머지 옛 이름은 0건', async () => {
    const buf = standardWorkbook(treeFor(teams, 3), [], 'Acme', teams, LABELS.default)
    const text = await textOf(buf)
    expect(findSentinels(text, [registeredLegacy])).toEqual([registeredLegacy])
    expect(findSentinels(text, sentinelsFor('SP4', teams))).toEqual([])
  })
  it('그 파일도 왕복한다', () => {
    const { profile } = roundTrip(standardWorkbook(treeFor(teams, 3), [], 'Acme', teams, LABELS.default))
    expect(profile.teamColumns.map(([, c]) => c)).toEqual(teams)
  })
})

describe('W24 — 팀 [R&D, Ops] 파일 머리에 5팀 코드 0건·왕복·N단(L=5) 왕복', () => {
  const teams = ['R&D', 'Ops']
  it('머리 행에 옛 5팀 코드가 없다', async () => {
    const text = await textOf(standardWorkbook(treeFor(teams, 3), [], 'Acme', teams, ['Phase', 'Task', 'Activity']))
    expect(findSentinels(text, [...LEGACY_SENTINELS.teamCodes])).toEqual([])
  })
  it.each([3, 5])('L=%i — 감지 계층 열 수 = L, 항목·담당이 그대로 돌아온다', (L) => {
    const labels = ['단계', '시스템', '서브시스템', '작업묶음', '작업'].slice(0, L)
    const items = treeFor(teams, L)
    const { profile, items: back } = roundTrip(standardWorkbook(items, [], 'Acme', teams, labels))
    expect(profile.hierarchy).toEqual({ kind: 'columns', columns: Array.from({ length: L }, (_, i) => i + 1) })
    expect(back.map((i) => i.name)).toEqual(['줄기0', '줄기1', '줄기2', '줄기3'].slice(0, L - 1).concat(['잎1', '잎2']))
    expect(back.find((i) => i.name === '잎1')?.owners).toEqual([{ team: 'R&D', kind: 'primary' }, { team: 'Ops', kind: 'support' }])
  })
})
