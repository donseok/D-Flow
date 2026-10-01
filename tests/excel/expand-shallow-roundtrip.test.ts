import { describe, expect, it } from 'vitest'
import { buildAoaWithProfile, buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { deriveStandardExcelProfile, resolveTeamColumns } from '@/lib/excel/standardProfile'
import { detectWorkbook } from '@/lib/excel/detect'
import { linkByDepth, parseWithProfile } from '@/lib/excel/parseWithProfile'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { WbsRow } from '@/lib/domain/types'

// A2-2 리뷰 정확성 P2(U3) — 펼침의 sub-act 를 깊이와 무관하게 '세부업무' 열(insertAt)에 쓰면, 잎이 마지막 계층 열보다 얕은 트리에서
// sub-act 가 깊이를 건너뛰어(1단 → 3단) 다시 가져올 때 linkByDepth 가 거부했다. insertAt 은 부모가 마지막 계층 열 깊이 이상일 때
// (접힌 일반 항목 아래 포함)만 쓰고, 얕으면 옛 규칙처럼 부모 다음 계층 열에 쓴다(스펙 D16·§4.3 의 Q40 문구 정정 — 정오표).
const TEAMS = ['RES', 'OPS']
const LABELS = ['단계', '작업', '세부']
const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: '2026-03-02', plannedEnd: '2026-03-06', weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
const split = (parent: WbsRow, sort: number): WbsRow[] => parent.owners.map((o, i) => row({
  id: `${parent.id}s${i}`, parentId: parent.id, code: parent.code, sortOrder: sort + i, name: `${parent.name} (${o.team})`,
  owners: [o], isOwnerSplit: true, actualPct: 50,
}))
// 얕은 잎: 단계 S0 아래 작업 S1(깊이 1)이 잎이고 담당 둘 → sub-act 깊이 2(= 마지막 계층 열 깊이). 깊은 잎: D0 → D1 → D2(깊이 2) → sub-act 깊이 3
const S1 = row({ id: 'S1', parentId: 'S0', code: '1.1', sortOrder: 1, name: '얕은 잎', owners: [{ team: 'RES', kind: 'primary' }, { team: 'OPS', kind: 'support' }] })
const D2 = row({ id: 'D2', parentId: 'D1', code: '2.1.1', sortOrder: 12, name: '깊은 잎', owners: [{ team: 'OPS', kind: 'primary' }, { team: 'RES', kind: 'support' }] })
const ROWS: WbsRow[] = [
  row({ id: 'S0', code: '1', sortOrder: 0, name: '얕은 단계' }), S1, ...split(S1, 2),
  row({ id: 'D0', code: '2', sortOrder: 10, name: '깊은 단계' }), row({ id: 'D1', parentId: 'D0', code: '2.1', sortOrder: 11, name: '깊은 작업' }), D2, ...split(D2, 13),
]
const items = computeTree(ROWS, '2026-03-04', new Set(), { subActTeamOrder: teamOrderMap(TEAMS) })
const profile = deriveStandardExcelProfile(resolveTeamColumns(items, TEAMS), LABELS)
const opts = { expandSubActs: true, levelLabels: LABELS, deep: 'fold' as const }

describe('펼침의 sub-act 자리 — 얕은 잎 아래는 부모 다음 계층 열, 마지막 계층 열 깊이의 잎 아래는 세부업무 열', () => {
  it('얕은 잎의 sub-act 는 셋째 계층 열(깊이 2), 깊은 잎의 sub-act 는 insertAt 열', () => {
    const built = buildAoaWithProfile(items, profile, opts, 'Acme')
    if (!built.ok) throw new Error(built.error)
    const hier = profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns : []
    const insertAt = hier[hier.length - 1] + 1
    const rowOf = (name: string) => built.aoa.find((r) => r.includes(name))!
    expect(rowOf('얕은 잎 (RES)').indexOf('얕은 잎 (RES)')).toBe(hier[2])
    expect(rowOf('깊은 잎 (OPS)').indexOf('깊은 잎 (OPS)')).toBe(insertAt)
  })
  it('detect → parse → linkByDepth 왕복 — 깊이를 건너뛰지 않고 sub-act 가 제 부모 아래로 돌아온다', () => {
    const built = buildWorkbookWithProfile(items, profile, [], opts, 'Acme')
    if (!built.ok) throw new Error(built.error)
    const det = detectWorkbook(built.buffer)
    if (!det.ok) throw new Error(det.error)
    const parsed = parseWithProfile(built.buffer, det.result.profile)
    if (!parsed.ok) throw new Error(parsed.error)
    const linked = linkByDepth(parsed.rows, { legacyLevelLabels: false })
    if (!linked.ok) throw new Error(JSON.stringify(linked.errors))
    const by = (name: string) => linked.items.find((i) => i.name === name)!
    expect(by('얕은 잎 (RES)').parentTempId).toBe(by('얕은 잎').tempId)
    expect(by('얕은 잎 (OPS)').parentTempId).toBe(by('얕은 잎').tempId)
    expect(by('깊은 잎 (OPS)').parentTempId).toBe(by('깊은 잎').tempId)
    expect(by('얕은 잎 (RES)').owners).toEqual([{ team: 'RES', kind: 'primary' }])
  })
})
