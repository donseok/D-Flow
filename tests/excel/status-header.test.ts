import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWbsAoa, buildWbsWorkbook } from '@/lib/excel/export'
import { buildAoaWithProfile } from '@/lib/excel/exportWithProfile'
import { detectWorkbook } from '@/lib/excel/detect'
import { LEGACY_EXCEL_PROFILE_V1 } from '@/lib/excel/profile'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { WbsRow } from '@/lib/domain/types'

// 스펙 §4.3 ① — 두 빌더가 데이터 행 끝에 쓰는 상태 칸(시작전·진행중·지연·완료)에 머리 '상태' 를 단다.
// 뒤 계산 열 머리(계획%·계획대비%·진척)의 어긋남은 감지 낱말 호환 때문에 그대로다(D16) — 여기서는 상태 한 칸만 본다.
const TEAMS = ['R&D', 'Ops']
const OPTS = { subActTeamOrder: teamOrderMap(TEAMS) }
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
})
const items = computeTree([
  row({ id: 'P', code: '1', name: '준비' }),
  row({ id: 'T', parentId: 'P', code: '1.1', sortOrder: 1, name: '설계' }),
  row({ id: 'A', parentId: 'T', code: '1.1.1', sortOrder: 2, name: '초안', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
    actualPct: 60, owners: [{ team: 'R&D', kind: 'primary' }] }),
  // 감지기는 마크가 하나도 없는 열을 팀 열로 잡지 않는다(규칙 6) — 두 팀 열 모두 마크가 있게 Ops 담당 잎을 둔다.
  // 실적 60·뒤 잎은 아직 시작 전 — 루트가 계획(30)을 따라가 '진행중' 이다(실적이 계획보다 낮으면 '지연').
  row({ id: 'B', parentId: 'T', code: '1.1.2', sortOrder: 3, name: '검토', plannedStart: '2026-07-06', plannedEnd: '2026-07-10',
    owners: [{ team: 'Ops', kind: 'primary' }] }),
], '2026-07-03', new Set(), OPTS)

describe('상태 열 머리(스펙 §4.3 ①)', () => {
  it('옛 빌더 — 라벨 행 마지막이 상태, 라벨 행 길이 = 데이터 행 길이', () => {
    const aoa = buildWbsAoa(items, 'Acme', TEAMS)
    const label = aoa[2] as unknown[]
    expect(label[label.length - 1]).toBe('상태')
    expect(label[label.length - 2]).toBe('진척')   // 뒤 계산 열 머리는 그대로(D16)
    for (const data of aoa.slice(3)) expect((data as unknown[]).length).toBe(label.length)
    expect((aoa[3] as unknown[])[label.length - 1]).toBe('진행중')
  })
  it('프로파일 빌더(접기·펼침) — 같은 규칙', () => {
    for (const expandSubActs of [false, true]) {
      const r = buildAoaWithProfile(items, LEGACY_EXCEL_PROFILE_V1, { expandSubActs, levelLabels: ['Phase', 'Task', 'Activity'] }, 'Acme')
      if (!r.ok) throw new Error(r.error)
      const label = r.aoa[2] as unknown[]
      expect(label[label.length - 1], `expand=${expandSubActs}`).toBe('상태')
      for (const data of r.aoa.slice(3)) expect((data as unknown[]).length).toBe(label.length)
    }
  })
  it('감지기는 상태 열을 팀 열로 잡지 않는다 — 내보낸 파일을 다시 감지해도 팀 열은 프로젝트 팀뿐', () => {
    const det = detectWorkbook(buildWbsWorkbook(items, [], 'Acme', TEAMS))
    expect(det.ok).toBe(true)
    if (!det.ok) return
    expect(det.result.profile.teamColumns.map(([, c]) => c)).toEqual(TEAMS)
    const wb = XLSX.read(buildWbsWorkbook(items, [], 'Acme', TEAMS), { type: 'array' })
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.WBS, { header: 1, blankrows: false })
    expect((aoa[2] as unknown[]).at(-1)).toBe('상태')
  })
})
