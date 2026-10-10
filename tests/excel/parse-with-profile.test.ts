import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWithProfile, linkByDepth, resolveLegacyLevelLabels } from '@/lib/excel/parseWithProfile'
import { LEGACY_EXCEL_PROFILE_V1 } from '../fixtures/excel/legacy-3row-profile'
import type { ExcelProfile } from '@/lib/excel/profile'
import { parseWbsWorkbook } from '../fixtures/excel/legacyParse'
import { validateAndLink } from '../fixtures/excel/legacyParse'
import type { ImportItem } from '@/lib/excel/validate'

function makeBook(sheets: { name: string; aoa: unknown[][] }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new()
  for (const { name, aoa } of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name)
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

/** 부모 연결을 tempId 문자열이 아니라 "자기 리스트 안에서의 위치"로 비교한다(§6.4 라운드트립 계약
 *  — "tempId 매핑 무관, 구조 동형"). 두 파서가 서로 다른 tempId 채번 규칙을 쓰더라도 트리 모양이
 *  같으면 통과해야 한다. */
function parentIndices(items: ImportItem[]): number[] {
  return items.map(it =>
    it.parentTempId === null ? -1 : items.findIndex(x => x.tempId === it.parentTempId))
}

/* ── (a) 라운드트립 계약: 레거시 3행 헤더 AOA 를 LEGACY_EXCEL_PROFILE_V1 로 파싱+링킹한 결과가
 *  기존 parseWbsWorkbook+validateAndLink 와 항목 수·이름·부모 연결·owners·일정 동일해야 한다.
 *  code 는 비교하지 않는다 — 구 파서는 name.split(/[.\s]/)[0] 워드 파싱(§6.4 가 폐기 대상으로
 *  지목한 바로 그 로직)이고, 신 파서는 명시 코드 열 또는 트리 위치 채번이라 규칙 자체가 다르다. */
describe('parseWithProfile + linkByDepth — (a) 라운드트립 계약(LEGACY_EXCEL_PROFILE_V1)', () => {
  // detect.test.ts 케이스 (a) 와 동일한 레거시 3행 헤더 5팀 형태 — LEGACY_EXCEL_PROFILE_V1 좌표와
  // 일치함이 이미 검증된 형태를 재사용해 라운드트립 비교의 기준을 맞춘다.
  const wbsAoa: unknown[][] = [
    Array(17).fill(''),
    ['', '', '', '', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM', '', '', '', '', '', ''],
    ['Biz', 'Phase', 'Task', 'Activity', '', '', 'PMO', 'ERP', 'MES', '가공', 'MDM',
      '산출물', '시작', '종료', '가중치', '', '실적%'],
    ['PI', '1. 준비'],
    ['', '', '1-1. 거버넌스'],
    ['', '', '', 'TFT R&R 확정', '', '', '●', '', '', '', '', '업무분장표',
      new Date(2026, 6, 1), new Date(2026, 6, 7), 2, '', 50],
    ['', '', '', '현황 파악', '', '', '', '△', '△', '●'],
    ['', '2. 실행'],
    ['', '', '2-1. 설계'],
    ['', '', '', '설계 검토', '', '', '●'],
    ['', '', '', '설계 완료', '', '', '●', '', '', '', '△'],
  ]
  const holidayAoa: unknown[][] = [['Holiday'], [new Date(2026, 6, 17), '제헌절']]
  const buf = makeBook([{ name: 'WBS', aoa: wbsAoa }, { name: 'Holiday', aoa: holidayAoa }])

  const legacyLinked = validateAndLink(parseWbsWorkbook(buf))
  it('기존 파서(parseWbsWorkbook+validateAndLink) 링크 성공 — 비교 기준 성립', () => {
    expect(legacyLinked.ok).toBe(true)
  })
  if (!legacyLinked.ok) throw new Error('unreachable')

  const parsed = parseWithProfile(buf, LEGACY_EXCEL_PROFILE_V1)
  it('parseWithProfile: 성공', () => expect(parsed.ok).toBe(true))
  if (!parsed.ok) throw new Error('unreachable')

  it('레거시 프로파일(hierarchy columns 3열) → resolveLegacyLevelLabels 는 true', () => {
    expect(resolveLegacyLevelLabels(LEGACY_EXCEL_PROFILE_V1)).toBe(true)
  })

  const linked = linkByDepth(parsed.rows, { legacyLevelLabels: resolveLegacyLevelLabels(LEGACY_EXCEL_PROFILE_V1) })
  it('linkByDepth: 성공', () => expect(linked.ok).toBe(true))
  if (!linked.ok) throw new Error('unreachable')

  it('항목 수 동일', () => {
    expect(linked.items.length).toBe(legacyLinked.items.length)
  })
  it('이름 동일(문서 순서 보존)', () => {
    expect(linked.items.map(it => it.name)).toEqual(legacyLinked.items.map(it => it.name))
  })
  it('부모 연결 동일 — 구조 동형(tempId 문자열 매핑은 무관)', () => {
    expect(parentIndices(linked.items)).toEqual(parentIndices(legacyLinked.items))
  })
  it('owners 동일', () => {
    expect(linked.items.map(it => it.owners)).toEqual(legacyLinked.items.map(it => it.owners))
  })
  it('일정(계획 시작/종료) 동일', () => {
    expect(linked.items.map(it => [it.plannedStart, it.plannedEnd])).toEqual(
      legacyLinked.items.map(it => [it.plannedStart, it.plannedEnd]))
  })
  it('부가 확인 — 실적%·산출물·biz(Q3 extraAxis) 동일, 가중치는 저장 단위(분수)로', () => {
    expect(linked.items.map(it => [it.actualPct, it.deliverable, it.biz])).toEqual(
      legacyLinked.items.map(it => [it.actualPct, it.deliverable, it.biz]))
    // BUG-02 — 옛 파서(오라클)는 칸의 수를 그대로 돌려줬다(2 → 2 = 화면의 200%). 지금은 화면과 같은 % 로 읽어 분수로 저장한다:
    // 이 픽스처의 가중치는 서식 없는 2 라 2% = 0.02 다(1 을 넘는 값이 있으면 그 파일은 % 로 읽는다 — wbsValueRules.importedWeightScale)
    expect(linked.items.map(it => it.weight)).toEqual(
      legacyLinked.items.map(it => (it.weight === null ? null : it.weight / 100)))
  })
  it('level 매핑 — hierarchy columns 3열이므로 레거시 phase/task/activity 와 동일', () => {
    expect(linked.items.map(it => it.level)).toEqual(legacyLinked.items.map(it => it.level))
  })
  it('holidays 동일', () => {
    expect(parsed.holidays).toEqual(parseWbsWorkbook(buf).holidays)
  })
})

/* ── (b) 아웃라인 4단 파일 → depth 0~3 링킹, 코드 그대로 보존, 채번 없음.
 *  같은 파일로 팀명 직접 방식(teamColumns=[[c,'*']], 콤마 분리, 첫 팀 primary)도 함께 검증한다. */
describe('parseWithProfile + linkByDepth — (b) 아웃라인 4단 + 팀명 직접 방식', () => {
  const aoa: unknown[][] = [
    ['코드', '이름', '담당'],
    ['1', '준비', 'PMO'],
    ['1.1', '거버넌스', 'PMO,ERP'],
    ['1.1.1', 'TFT 구성', 'ERP'],
    ['1.1.1.1', 'R&R 확정', ''],
  ]
  const outlineProfile: ExcelProfile = {
    version: 1,
    sheetName: 'Sheet1',
    holidaySheetName: null,
    headerRow: 0,
    hierarchy: { kind: 'outline', column: 0 },
    logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [[2, '*']],
    ownerMarks: {},
  }
  const buf = makeBook([{ name: 'Sheet1', aoa }])
  const parsed = parseWithProfile(buf, outlineProfile)

  it('parseWithProfile: 성공', () => expect(parsed.ok).toBe(true))
  if (!parsed.ok) throw new Error('unreachable')

  it('depth 0~3 (구분자 수)', () => {
    expect(parsed.rows.map(r => r.depth)).toEqual([0, 1, 2, 3])
  })
  it('코드 열 값 그대로 보존(logical.code 미설정 → 아웃라인 열 값이 code 후보)', () => {
    expect(parsed.rows.map(r => r.code)).toEqual(['1', '1.1', '1.1.1', '1.1.1.1'])
  })
  it('이름 = 코드 열 바로 오른쪽 열', () => {
    expect(parsed.rows.map(r => r.name)).toEqual(['준비', '거버넌스', 'TFT 구성', 'R&R 확정'])
  })
  it('팀명 직접 방식 — 콤마 분리, 첫 팀 primary·나머지 support, 빈 셀은 owners:[]', () => {
    expect(parsed.rows.map(r => r.owners)).toEqual([
      [{ team: 'PMO', kind: 'primary' }],
      [{ team: 'PMO', kind: 'primary' }, { team: 'ERP', kind: 'support' }],
      [{ team: 'ERP', kind: 'primary' }],
      [],
    ])
  })

  it('resolveLegacyLevelLabels 는 outline 이면 false', () => {
    expect(resolveLegacyLevelLabels(outlineProfile)).toBe(false)
  })

  const linked = linkByDepth(parsed.rows)
  it('linkByDepth: 성공, 채번 없이 원본 코드 그대로 승계', () => {
    expect(linked.ok).toBe(true)
    if (!linked.ok) return
    expect(linked.items.map(it => it.code)).toEqual(['1', '1.1', '1.1.1', '1.1.1.1'])
  })
  it('부모 연결 — 0→1→2→3 단일 체인', () => {
    expect(linked.ok).toBe(true)
    if (!linked.ok) return
    expect(parentIndices(linked.items)).toEqual([-1, 0, 1, 2])
  })
  it('level — outline 이라 전부 activity(레거시 3단 매핑 대상 아님)', () => {
    expect(linked.ok).toBe(true)
    if (!linked.ok) return
    expect(linked.items.map(it => it.level)).toEqual(['activity', 'activity', 'activity', 'activity'])
  })
})

/* ── 리뷰 픽스(2026-08-01): profile.logical.name 이 정본이고, 'outline+1' 관례는 최후 폴백일 뿐이다.
 * '코드,비고,이름' 형 파일에서 순진한 code_col+1 관례를 그대로 썼다면 '비고'(1열)를 이름으로
 * 잘못 읽었을 것 — logical.name=2 를 명시하면 그 오독이 재현되지 않아야 한다. */
describe('parseWithProfile — logical.name 이 명시되면 우선한다(코드+1 관례를 덮어씀)', () => {
  const aoa: unknown[][] = [
    ['코드', '비고', '이름'],
    ['1', '메모A', '준비'],
    ['1.1', '메모B', '거버넌스'],
  ]
  const profile: ExcelProfile = {
    version: 1,
    sheetName: 'Sheet1',
    holidaySheetName: null,
    headerRow: 0,
    hierarchy: { kind: 'outline', column: 0 },
    // logical.name = 2('이름' 열) — 명시했으므로 code_col+1(=1, '비고' 열) 관례는 쓰이지 않아야 한다.
    logical: { extraAxis: null, code: null, name: 2, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [],
    ownerMarks: {},
  }
  const buf = makeBook([{ name: 'Sheet1', aoa }])
  const parsed = parseWithProfile(buf, profile)

  it('이름이 명시 열(2, "이름")에서 온다 — 폴백 열(1, "비고")이 아니다', () => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows.map(r => r.name)).toEqual(['준비', '거버넌스'])
    expect(parsed.rows.map(r => r.name)).not.toEqual(['메모A', '메모B'])
  })
})

/* ── (c) 코드 열 없는 4열 계층(columns) → 자동 채번 '1','1.1','1.1.1','1.1.1.1' ── */
describe('parseWithProfile + linkByDepth — (c) 코드 열 없는 4열 계층(columns) → 자동 채번', () => {
  const aoa: unknown[][] = [
    ['', 'L1', 'L2', 'L3', 'L4'],
    ['', '1단계'],
    ['', '', '2단계'],
    ['', '', '', '3단계'],
    ['', '', '', '', '4단계'],
  ]
  const profile: ExcelProfile = {
    version: 1,
    sheetName: 'Sheet1',
    holidaySheetName: null,
    headerRow: 0,
    hierarchy: { kind: 'columns', columns: [1, 2, 3, 4] },
    logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [],
    ownerMarks: {},
  }
  const buf = makeBook([{ name: 'Sheet1', aoa }])
  const parsed = parseWithProfile(buf, profile)

  it('parseWithProfile: 성공, code 는 전부 null(코드 열 미설정)', () => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows.map(r => r.code)).toEqual([null, null, null, null])
    expect(parsed.rows.map(r => r.depth)).toEqual([0, 1, 2, 3])
  })

  it('resolveLegacyLevelLabels 는 4열이라 false(3열일 때만 레거시 호환)', () => {
    expect(resolveLegacyLevelLabels(profile)).toBe(false)
  })

  it('linkByDepth: 트리 위치 기반 자동 채번', () => {
    if (!parsed.ok) return
    const linked = linkByDepth(parsed.rows)
    expect(linked.ok).toBe(true)
    if (!linked.ok) return
    expect(linked.items.map(it => it.code)).toEqual(['1', '1.1', '1.1.1', '1.1.1.1'])
    expect(linked.items.map(it => it.level)).toEqual(['activity', 'activity', 'activity', 'activity'])
  })

  it('두 번째 1단계 형제가 오면 채번이 새 경로로 리셋된다(1, 1.1 → 2)', () => {
    if (!parsed.ok) return
    const aoa2: unknown[][] = [...aoa, ['', '5단계(새 1단)']]
    const buf2 = makeBook([{ name: 'Sheet1', aoa: aoa2 }])
    const parsed2 = parseWithProfile(buf2, profile)
    expect(parsed2.ok).toBe(true)
    if (!parsed2.ok) return
    const linked2 = linkByDepth(parsed2.rows)
    expect(linked2.ok).toBe(true)
    if (!linked2.ok) return
    expect(linked2.items.map(it => it.code)).toEqual(['1', '1.1', '1.1.1', '1.1.1.1', '2'])
  })
})

/* ── (d) 깊이 점프(0→2) → 에러 행 보고 ── */
describe('parseWithProfile + linkByDepth — (d) 깊이 점프 → 에러 행 보고', () => {
  const aoa: unknown[][] = [
    ['', 'L1', 'L2', 'L3'],
    ['', '1단계'],
    ['', '', '', '3단계로 점프(L2 없음)'],
  ]
  const profile: ExcelProfile = {
    version: 1,
    sheetName: 'Sheet1',
    holidaySheetName: null,
    headerRow: 0,
    hierarchy: { kind: 'columns', columns: [1, 2, 3] },
    logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
    teamColumns: [],
    ownerMarks: {},
  }
  const buf = makeBook([{ name: 'Sheet1', aoa }])
  const parsed = parseWithProfile(buf, profile)

  it('parseWithProfile 자체는 성공(행 단위 구조 오류가 아니라 순서 오류라 링커 몫)', () => {
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.rows.map(r => r.depth)).toEqual([0, 2])
  })

  it('linkByDepth: 깊이 건너뜀 에러 — excelRow 포함', () => {
    if (!parsed.ok) return
    const linked = linkByDepth(parsed.rows)
    expect(linked.ok).toBe(false)
    if (linked.ok) return
    expect(linked.errors.some(e => e.excelRow === 3 && e.message.includes('깊이'))).toBe(true)
  })
})

/* ── 구현 규칙 부가 검증: 계층 열 2개 이상 채워짐 → 명시 에러(excelRow 포함) ── */
describe('parseWithProfile — 계층 열 다중 채움 방어', () => {
  it('columns 계층에서 한 행에 2열 이상 채워지면 즉시 에러(행 번호 포함)', () => {
    const aoa: unknown[][] = [
      ['', 'L1', 'L2'],
      ['', '1단계', '동시채움'],
    ]
    const profile: ExcelProfile = {
      version: 1, sheetName: 'Sheet1', holidaySheetName: null, headerRow: 0,
      hierarchy: { kind: 'columns', columns: [1, 2] },
      logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
      teamColumns: [], ownerMarks: {},
    }
    const buf = makeBook([{ name: 'Sheet1', aoa }])
    const res = parseWithProfile(buf, profile)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('2행')
  })
})

/* ── 구현 규칙 부가 검증: 코드 열 값이 60자를 초과하면 linkByDepth 가 에러로 잡는다 ── */
describe('linkByDepth — 코드 60자 초과 에러', () => {
  it('명시 코드 열 값이 60자를 넘으면 에러', () => {
    const longCode = '1'.repeat(61)
    const rows = [{
      depth: 0, code: longCode, name: 'n', extraAxis: null, deliverable: null,
      plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], excelRow: 4,
    }]
    const res = linkByDepth(rows)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors.some(e => e.excelRow === 4 && e.message.includes('60자'))).toBe(true)
  })
  it('60자 이하면 통과', () => {
    const code60 = '1'.repeat(60)
    const rows = [{
      depth: 0, code: code60, name: 'n', extraAxis: null, deliverable: null,
      plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], excelRow: 4,
    }]
    const res = linkByDepth(rows)
    expect(res.ok).toBe(true)
  })
})

/* ── 구현 규칙 부가 검증: 시트 없음 → 명시 에러(§6.1 침묵 오파싱 재발 방지) ── */
describe('parseWithProfile — 시트 없음 명시 에러', () => {
  it('profile.sheetName 이 워크북에 없으면 ok:false', () => {
    const buf = makeBook([{ name: 'Other', aoa: [['x']] }])
    const res = parseWithProfile(buf, LEGACY_EXCEL_PROFILE_V1)
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toContain('WBS')
  })
})

describe('parseWithProfile — 양식 가이드 4번의 YYYY-MM-DD 텍스트 날짜', () => {
  const P: ExcelProfile = {
    version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0,
    hierarchy: { kind: 'columns', columns: [0, 1] },
    logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: null },
    teamColumns: [], ownerMarks: { '●': 'primary', '△': 'support' },
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['L1', 'L2', '산출물', '시작', '종료'],
    ['준비', '', '', '2026-09-01', '2026-09-12'],
    ['', '착수', '', ' 2026-09-01 ', '2026-02-30'],
  ]), 'WBS')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

  it('텍스트 ISO 날짜를 읽는다 — 달력에 없는 날짜는 비운다', () => {
    const r = parseWithProfile(buf, P)
    if (!r.ok) throw new Error(r.error)
    expect(r.rows.map(x => [x.plannedStart, x.plannedEnd])).toEqual([['2026-09-01', '2026-09-12'], ['2026-09-01', null]])
  })
})
