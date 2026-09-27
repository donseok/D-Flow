import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildAoaWithProfile, buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { buildWbsAoa } from '@/lib/excel/export'
import { LEGACY_EXCEL_PROFILE_V1, type ExcelProfile } from '@/lib/excel/profile'
import { detectWorkbook } from '@/lib/excel/detect'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'
import { computeTree } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'
import { teamOrderMap } from '@/lib/domain/teams'
import { FIXTURE_TEAM_CODES } from '../fixtures/teams'

const OPTS = { subActTeamOrder: teamOrderMap(FIXTURE_TEAM_CODES) }
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
})

function unwrap(built: ReturnType<typeof buildAoaWithProfile>): unknown[][] {
  if (!built.ok) throw new Error(`buildAoaWithProfile failed: ${built.error}`)
  return built.aoa
}

/* ── (a) LEGACY_EXCEL_PROFILE_V1 + 접기 == 기존 buildWbsAoa (셀 단위 동일, 라운드트립 회귀 기준) ── */
describe('buildAoaWithProfile — (a) LEGACY_EXCEL_PROFILE_V1 접기는 기존 buildWbsAoa 와 셀 단위 동일', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: '1. 준비', biz: 'PI' }),
    row({ id: 'T', parentId: 'P', code: '1-1', sortOrder: 1, name: '1-1. 거버넌스' }),
    row({
      id: 'A1', parentId: 'T', code: 'a1', sortOrder: 2, name: 'TFT R&R 확정',
      deliverable: '업무분장표', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      weight: 2, actualPct: 50, owners: [{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }],
    }),
    row({
      id: 'A2', parentId: 'T', code: 'a2', sortOrder: 3, name: '현황 파악',
      plannedStart: '2026-07-08', plannedEnd: '2026-07-14', actualPct: 100,
      owners: [{ team: 'ERP', kind: 'primary' }],
    }),
  ]
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)

  const legacyAoa = buildWbsAoa(items, '테스트 프로젝트', FIXTURE_TEAM_CODES)
  const profileAoa = unwrap(buildAoaWithProfile(items, LEGACY_EXCEL_PROFILE_V1, { expandSubActs: false }, '테스트 프로젝트'))

  it('행 개수가 같다', () => {
    expect(profileAoa.length).toBe(legacyAoa.length)
  })

  it('헤더 3행 + 데이터 행 전부 셀 단위로 동일하다', () => {
    expect(profileAoa).toEqual(legacyAoa)
  })
})

/* ── (b) 펼침 — sub-act 가 4번째 계층 열(index 4)에 행으로 등장, 팀 마크 1개.
 *  리뷰 픽스(삽입-시프트) 이후 팀 열 자체는 원래 6~10 에서 7~11 로 밀린다(LEGACY 도 예외 없이 동일
 *  규칙 적용) — 그래서 팀 마크 열은 헤더에서 동적으로 찾는다(구현 좌표를 하드코딩하지 않는다). ── */
describe('buildAoaWithProfile — (b) expandSubActs:true 는 sub-act 를 4번째 계층 열 행으로 펼친다', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: '1. 준비' }),
    row({ id: 'T', parentId: 'P', code: '1-1', sortOrder: 1, name: '1-1. 거버넌스' }),
    row({
      id: 'A1', parentId: 'T', code: 'a1', sortOrder: 2, name: 'TFT R&R 확정',
      plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      owners: [{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }],
      actualPct: null, // splitLeafOwners 규약(validate.ts) — 분리된 부모는 실적을 자식에 넘기고 비운다.
    }),
    row({
      id: 'A1s0', parentId: 'A1', code: 'a1', sortOrder: 3,
      name: 'TFT R&R 확정 (PMO 주관)', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      actualPct: 60, owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: true,
    }),
    row({
      id: 'A1s1', parentId: 'A1', code: 'a1', sortOrder: 4,
      name: 'TFT R&R 확정 (가공 지원)', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      actualPct: 40, owners: [{ team: '가공', kind: 'support' }], isOwnerSplit: true,
    }),
  ]
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)
  const aoa = unwrap(buildAoaWithProfile(items, LEGACY_EXCEL_PROFILE_V1, { expandSubActs: true }, '테스트'))
  const header3 = aoa[2] as unknown[]
  const TEAM_LABELS = ['PMO', 'ERP', 'MES', '가공', 'MDM']
  const teamColIdxs = header3.map((v, i) => (TEAM_LABELS.includes(v as string) ? i : -1)).filter(i => i >= 0)
  const teamMarkCount = (r: unknown[]) => teamColIdxs.filter(c => r[c] === '●' || r[c] === '△').length

  it('팀 열도 시프트되어 5개 그대로 검출된다(유실 없음)', () => {
    expect(teamColIdxs.length).toBe(5)
  })

  it('sub-act 행이 존재하고 4번째 계층 열(index 4)에 이름이 실린다', () => {
    const subActRows = aoa.slice(3).filter(r => (r as unknown[])[4] !== '')
    expect(subActRows.length).toBe(2)
    const names = subActRows.map(r => (r as unknown[])[4])
    expect(names).toContain('TFT R&R 확정 (PMO 주관)')
    expect(names).toContain('TFT R&R 확정 (가공 지원)')
  })

  it('sub-act 행은 1~3번째 계층 열(Phase/Task/Activity)이 전부 비어 있다', () => {
    const subActRows = aoa.slice(3).filter(r => (r as unknown[])[4] !== '')
    for (const r of subActRows) expect([1, 2, 3].map(c => (r as unknown[])[c])).toEqual(['', '', ''])
  })

  it('sub-act 행에는 팀 마크가 정확히 1개다', () => {
    const subActRows = aoa.slice(3).filter(r => (r as unknown[])[4] !== '')
    for (const r of subActRows) expect(teamMarkCount(r as unknown[])).toBe(1)
  })

  it('부모(A1) 행은 여전히 3번째 계층 열에 등장하고 팀 마크는 2개(원본 담당 보존)', () => {
    const parentRow = aoa.slice(3).find(r => (r as unknown[])[3] === 'TFT R&R 확정')
    expect(parentRow).toBeDefined()
    expect(teamMarkCount(parentRow as unknown[])).toBe(2)
  })

  it('접기(expandSubActs:false)였다면 sub-act 행이 아예 없다(대조군, 시프트도 없다)', () => {
    const collapsed = unwrap(buildAoaWithProfile(items, LEGACY_EXCEL_PROFILE_V1, { expandSubActs: false }, '테스트'))
    const subActRows = collapsed.slice(3).filter(r => (r as unknown[])[4] !== '')
    expect(subActRows.length).toBe(0)
    // 접기는 시프트가 없으므로 팀 열이 원래 자리(6~10)에 그대로 있다.
    const h3 = collapsed[2] as unknown[]
    expect(h3.slice(6, 11)).toEqual(TEAM_LABELS)
  })
})

/* ── (b-2, 리뷰 Important #1) 계층 열 바로 다음에 다른 논리 열이 선언된 "충돌" 프로파일 —
 *  삽입-시프트가 없었다면 sub-act 이름과 산출물 값이 같은 물리 열을 다퉜을 상황. ── */
describe('buildAoaWithProfile — (b-2) 삽입-시프트: 계층 다음 열 충돌 프로파일도 이름이 안 덮인다', () => {
  const CONFLICT_PROFILE: ExcelProfile = {
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
    hierarchy: { kind: 'columns', columns: [0, 1, 2] }, // 마지막 계층 열(2) 바로 다음(3)에 deliverable 선언
    logical: { extraAxis: null, code: null, name: null, deliverable: 3, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [[4, 'PMO']], // 시프트 대상(4 >= insertAt=3)인지도 같이 확인
    ownerMarks: { '●': 'primary', '△': 'support' },
  }
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: 'P' }),
    row({ id: 'T', parentId: 'P', code: '1-1', sortOrder: 1, name: 'T' }),
    row({
      id: 'A1', parentId: 'T', code: 'a1', sortOrder: 2, name: 'A1',
      deliverable: '설계서', owners: [{ team: 'PMO', kind: 'primary' }], actualPct: null,
    }),
    row({
      id: 'A1s0', parentId: 'A1', code: 'a1', sortOrder: 3,
      name: 'A1 (PMO 주관)', deliverable: '설계서', actualPct: 80,
      owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: true,
    }),
  ]
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)
  const aoa = unwrap(buildAoaWithProfile(items, CONFLICT_PROFILE, { expandSubActs: true }, 'C'))
  const rows = aoa.slice(3) as unknown[][]
  const subAct = rows.find(r => r[3] === 'A1 (PMO 주관)')
  const parent = rows.find(r => r[2] === 'A1')

  it('sub-act 이름은 삽입 열(index 3)에, 산출물 값은 시프트된 열(index 4)에 — 서로 안 덮인다', () => {
    expect(subAct).toBeDefined()
    expect(subAct![3]).toBe('A1 (PMO 주관)')
    expect(subAct![4]).toBe('설계서') // 원래 deliverable=3 이었다면 이름과 충돌했을 자리
  })

  it('부모 행도 자기 산출물을 시프트된 열에서 그대로 보존한다(계층 열은 안 밀림)', () => {
    expect(parent).toBeDefined()
    expect(parent![2]).toBe('A1')  // 계층 열(마지막=2)은 insertAt 미만이라 시프트 안 됨
    expect(parent![3]).toBe('')    // 삽입 열 — 부모 자신은 여기 안 씀
    expect(parent![4]).toBe('설계서')
  })

  it('detect→parseWithProfile 왕복이 성공한다(무증상 오파싱 없음)', () => {
    const built = buildWorkbookWithProfile(items, CONFLICT_PROFILE, [], { expandSubActs: true }, 'C')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const detected = detectWorkbook(built.buffer)
    expect(detected.ok).toBe(true)
    if (!detected.ok) return
    const parsed = parseWithProfile(built.buffer, detected.result.profile)
    expect(parsed.ok).toBe(true)
  })
})

/* ── (신설, 리뷰 Important #2) 프로파일 밖 팀 동적 확장 — 조용한 유실 금지 ── */
describe('buildAoaWithProfile — 프로파일 밖 팀은 말미에 열을 추가해 유실 없이 싣는다', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: 'P' }),
    row({ id: 'T', parentId: 'P', code: '1-1', sortOrder: 1, name: 'T' }),
    row({
      id: 'A1', parentId: 'T', code: 'a1', sortOrder: 2, name: 'A1',
      owners: [{ team: 'PMO', kind: 'primary' }, { team: '신팀6', kind: 'support' }], actualPct: 30,
    }),
  ]
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)

  it('펼침 모드 — 6번째 팀 라벨이 헤더 말미에 추가되고, 데이터 행에 마크가 실재한다', () => {
    const aoa = unwrap(buildAoaWithProfile(items, LEGACY_EXCEL_PROFILE_V1, { expandSubActs: true }, 'T'))
    const header3 = aoa[2] as unknown[]
    const col = header3.indexOf('신팀6')
    expect(col).toBeGreaterThan(-1)
    const a1Row = (aoa.slice(3) as unknown[][]).find(r => r[3] === 'A1')
    expect(a1Row).toBeDefined()
    expect(a1Row![col]).toBe('△')
  })

  it('접기 모드에서도 동일하게 유실되지 않는다', () => {
    const aoa = unwrap(buildAoaWithProfile(items, LEGACY_EXCEL_PROFILE_V1, { expandSubActs: false }, 'T'))
    const header3 = aoa[2] as unknown[]
    const col = header3.indexOf('신팀6')
    expect(col).toBeGreaterThan(-1)
    const a1Row = (aoa.slice(3) as unknown[][]).find(r => r[3] === 'A1')
    expect(a1Row).toBeDefined()
    expect(a1Row![col]).toBe('△')
  })
})

/* ── (c) 펼침 산출물 → detect → parseWithProfile → linkByDepth 왕복에서 sub-act 가
 *  isOwnerSplit 후보(1개 담당의 독립 자식 행)로 복원된다. ──
 *  biz(extraAxis)는 일부러 전부 비운다 — 채우면 계층 열 탐지 알고리즘이 Biz 열까지 "계층 후보 구간"에
 *  끌어들여 임계값 판정이 데이터 개수에 좌우되는 불필요한 취약성이 생긴다(감지 알고리즘 자체는
 *  Task3 책임 밖). */
describe('buildAoaWithProfile — (c) 펼침 산출물의 detect→parseWithProfile 왕복', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: '1. 준비' }),
    row({ id: 'T', parentId: 'P', code: '1-1', sortOrder: 1, name: '1-1. 거버넌스' }),
    row({
      id: 'A1', parentId: 'T', code: 'a1', sortOrder: 2, name: 'TFT R&R 확정',
      plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      owners: [{ team: 'PMO', kind: 'primary' }, { team: '가공', kind: 'support' }], actualPct: null,
    }),
    row({
      id: 'A1s0', parentId: 'A1', code: 'a1', sortOrder: 3,
      name: 'TFT R&R 확정 (PMO 주관)', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      actualPct: 60, owners: [{ team: 'PMO', kind: 'primary' }], isOwnerSplit: true,
    }),
    row({
      id: 'A1s1', parentId: 'A1', code: 'a1', sortOrder: 4,
      name: 'TFT R&R 확정 (가공 지원)', plannedStart: '2026-07-01', plannedEnd: '2026-07-07',
      actualPct: 40, owners: [{ team: '가공', kind: 'support' }], isOwnerSplit: true,
    }),
    row({
      id: 'A2', parentId: 'T', code: 'a2', sortOrder: 5, name: '현황 파악',
      plannedStart: '2026-07-08', plannedEnd: '2026-07-14', actualPct: 100,
      owners: [{ team: 'ERP', kind: 'primary' }],
    }),
  ]
  const items = computeTree(SRC, '2026-09-15', new Set(), OPTS)
  const built = buildWorkbookWithProfile(items, LEGACY_EXCEL_PROFILE_V1, [], { expandSubActs: true }, 'RT')
  if (!built.ok) throw new Error(`setup failed: ${built.error}`)
  const buf = built.buffer

  it('detectWorkbook 이 4열 계층(columns)을 감지한다', () => {
    const detected = detectWorkbook(buf)
    expect(detected.ok).toBe(true)
    if (!detected.ok) return
    expect(detected.result.profile.hierarchy).toEqual({ kind: 'columns', columns: [1, 2, 3, 4] })
  })

  it('parseWithProfile → linkByDepth 왕복에서 sub-act 가 담당 1개의 독립 자식 행으로 복원된다', () => {
    const detected = detectWorkbook(buf)
    expect(detected.ok).toBe(true)
    if (!detected.ok) return
    const profile = detected.result.profile

    const parsed = parseWithProfile(buf, profile)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const linked = linkByDepth(parsed.rows, { legacyLevelLabels: resolveLegacyLevelLabels(profile) })
    expect(linked.ok).toBe(true)
    if (!linked.ok) return

    const parent = linked.items.find(i => i.name === 'TFT R&R 확정')
    const subAct = linked.items.find(i => i.name === 'TFT R&R 확정 (PMO 주관)')
    expect(parent).toBeDefined()
    expect(subAct).toBeDefined()
    // '복원' = 예전엔 splitLeafOwners 가 합성해야 했던 모양(부모 밑, 담당 1개짜리 독립 리프)이
    // 이제는 파일에 실제로 존재하는 행이라 링킹만으로 재현된다(추가 분리 로직 불필요).
    expect(subAct!.parentTempId).toBe(parent!.tempId)
    expect(subAct!.owners).toEqual([{ team: 'PMO', kind: 'primary' }])
  })
})

/* ── (신설, 리뷰 항목 3) outline 계층 + 펼침은 명시적으로 거부한다 — 무증상 오파싱 대신 정직한 실패. ── */
describe('buildAoaWithProfile — outline 계층 + 펼침은 명시적으로 거부한다', () => {
  const OUTLINE_PROFILE: ExcelProfile = {
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
    hierarchy: { kind: 'outline', column: 0 },
    logical: { extraAxis: null, code: null, name: 1, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
  }
  const items = computeTree(
    [row({ id: 'A', parentId: null, code: '1', sortOrder: 0, name: 'A' })],
    '2026-09-15', new Set(), OPTS,
  )

  it('outline + expandSubActs:true 는 ok:false 로 거부한다', () => {
    const built = buildAoaWithProfile(items, OUTLINE_PROFILE, { expandSubActs: true })
    expect(built).toEqual({ ok: false, error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' })
  })

  it('buildWorkbookWithProfile 도 동일하게 거부를 그대로 전파한다', () => {
    const built = buildWorkbookWithProfile(items, OUTLINE_PROFILE, [], { expandSubActs: true })
    expect(built.ok).toBe(false)
  })

  it('outline + 접기는 회귀 없이 그대로 동작한다', () => {
    const built = buildAoaWithProfile(items, OUTLINE_PROFILE, { expandSubActs: false })
    expect(built.ok).toBe(true)
  })
})

/* ── (d) headerRow 존중 — 라벨 행이 profile.headerRow 위치에 오고, 같은 프로파일로 되읽힌다 ── */
describe('buildWorkbookWithProfile — headerRow 0·1·2·3 라운드트립', () => {
  const SRC: WbsRow[] = [
    row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: '준비', plannedStart: '2026-07-01', plannedEnd: '2026-07-10' }),
    row({ id: 'T', parentId: 'P', code: '1.1', sortOrder: 1, name: '착수', plannedStart: '2026-07-01', plannedEnd: '2026-07-03',
      owners: [{ team: '팀A', kind: 'primary' }] }),
  ]
  const items = computeTree(SRC, '2026-07-02', new Set(), { subActTeamOrder: teamOrderMap(['팀A']) })
  const COLUMNS = (headerRow: number): ExcelProfile => ({
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow,
    hierarchy: { kind: 'columns', columns: [0, 1] },
    logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
    teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
  })
  const OUTLINE = (headerRow: number): ExcelProfile => ({
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow,
    hierarchy: { kind: 'outline', column: 0 },
    logical: { extraAxis: null, code: null, name: 1, deliverable: null, start: 2, end: 3, weight: null, actualPct: null },
    teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
  })
  const readBack = (profile: ExcelProfile) => {
    const built = buildWorkbookWithProfile(items, profile, [], { expandSubActs: false }, 'Acme')
    if (!built.ok) throw new Error(built.error)
    // detect·parse 와 같은 읽기 규칙(blankrows:false) — 빈 행은 세지 않는다
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(
      XLSX.read(built.buffer, { type: 'array' }).Sheets.WBS, { header: 1, blankrows: false })
    const parsed = parseWithProfile(built.buffer, profile)
    if (!parsed.ok) throw new Error(parsed.error)
    return { aoa, rows: parsed.rows.map(r => [r.depth, r.name, r.plannedStart]) }
  }

  it.each([0, 1, 2, 3])('columns headerRow=%i', (h) => {
    const { aoa, rows } = readBack(COLUMNS(h))
    expect(aoa[h]).toContain('시작')
    expect(rows).toEqual([[0, '준비', '2026-07-01'], [1, '착수', '2026-07-01']])
  })
  it.each([0, 1, 2, 3])('outline headerRow=%i', (h) => {
    const { aoa, rows } = readBack(OUTLINE(h))
    expect(aoa[h]).toContain('코드')
    expect(rows).toEqual([[0, '준비', '2026-07-01'], [1, '착수', '2026-07-01']])
  })

  it('계층 열보다 깊은 WBS 는 접기·펼침 모두 ok:false — 이름이 사라진 파일을 만들지 않는다', () => {
    const deep = computeTree([
      row({ id: 'A', parentId: null, code: '1', sortOrder: 0, name: 'A' }),
      row({ id: 'B', parentId: 'A', code: '1.1', sortOrder: 1, name: 'B' }),
      row({ id: 'C', parentId: 'B', code: '1.1.1', sortOrder: 2, name: 'C' }),
    ], '2026-07-02', new Set(), OPTS)
    for (const expandSubActs of [false, true]) {
      const r = buildAoaWithProfile(deep, COLUMNS(2), { expandSubActs })
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error).toContain('계층 열(2개)')
        expect(r.error).toContain('설정 화면의 "저장된 양식 비우기"')
        expect(r.error).not.toContain('임포트 마법사')
      }
    }
  })
})
