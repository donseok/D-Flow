import { describe, expect, it } from 'vitest'
import { EXCEL_HEADER_WORDS, HEADER, LOGICAL_ALIASES, TEAM_HEADER_ALIASES, isHeaderWordMatch } from '@/lib/excel/headerWords'
import { LOGICAL_ALIASES as FROM_DETECT } from '@/lib/excel/detect'
import { buildAoaWithProfile } from '@/lib/excel/exportWithProfile'
import { TEMPLATE_HEADER } from '@/lib/excel/template'
import { normalizeNewTeamCode, reservedTeamNames } from '@/lib/domain/teams'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { WbsRow } from '@/lib/domain/types'

// 엑셀 머리 낱말의 단일 출처(SP4 D38·E30) — 빌더가 쓰는 낱말·감지기의 논리 별칭·담당 별칭. 팀 예약어는 여기서 파생한다.
describe('EXCEL_HEADER_WORDS', () => {
  it('빌더 머리 낱말·논리 별칭·담당 별칭을 모두 담고 중복이 없다', () => {
    for (const w of Object.values(HEADER)) expect(EXCEL_HEADER_WORDS).toContain(w)
    for (const w of Object.values(LOGICAL_ALIASES).flat()) expect(EXCEL_HEADER_WORDS).toContain(w)
    for (const w of TEAM_HEADER_ALIASES) expect(EXCEL_HEADER_WORDS).toContain(w)
    expect(new Set(EXCEL_HEADER_WORDS).size).toBe(EXCEL_HEADER_WORDS.length)
  })
  it('옛 단계 이름(Phase·Task·Activity)은 담지 않는다 — 프로젝트 단계 이름에서 온다', () => {
    for (const w of ['Phase', 'Task', 'Activity']) expect(EXCEL_HEADER_WORDS).not.toContain(w)
  })
  it('옛 예약어 목록의 머리 낱말은 모두 남는다(회귀)', () => {
    for (const w of ['Biz', '담당', '산출물', '계획', '시작', '종료', '가중치', '실적%', '계획%', '계획대비%', '상태']) {
      expect(EXCEL_HEADER_WORDS, w).toContain(w)
    }
  })
  it('감지기는 같은 별칭 객체를 쓴다(재수출) — 두 사본이 갈라지지 않는다', () => {
    expect(FROM_DETECT).toBe(LOGICAL_ALIASES)
  })
  it('양식 머리는 전부 단일 출처 안에 있다', () => {
    for (const w of TEMPLATE_HEADER) expect(EXCEL_HEADER_WORDS, w).toContain(w)
  })
  it('프로파일 빌더의 라벨 행 낱말 = 단계 이름·팀 코드를 뺀 나머지가 전부 단일 출처 안에 있다', () => {
    const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
      plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
    const items = computeTree([row({ id: 'P', name: '준비' }), row({ id: 'A', parentId: 'P', name: '초안', owners: [{ team: 'RES', kind: 'primary' }] })],
      '2026-03-02', new Set(), { subActTeamOrder: teamOrderMap(['RES']) })
    const profile: ExcelProfile = { version: 1, sheetName: 'WBS', holidaySheetName: 'Holiday', headerRow: 2,
      hierarchy: { kind: 'columns', columns: [1, 2] },
      logical: { extraAxis: 0, code: null, name: null, deliverable: 6, start: 7, end: 8, weight: 9, actualPct: 11 },
      teamColumns: [[5, 'RES']], ownerMarks: { '●': 'primary', '△': 'support' } }
    for (const expandSubActs of [false, true]) {
      const r = buildAoaWithProfile(items, profile, { expandSubActs, levelLabels: ['단계', '작업'] }, 'Acme')
      if (!r.ok) throw new Error(r.error)
      const words = [...(r.aoa[1] as unknown[]), ...(r.aoa[2] as unknown[])].filter((w) => typeof w === 'string' && w !== '' && w !== 'Acme')
      const outside = words.filter((w) => !['단계', '작업', 'RES'].includes(w as string) && !EXCEL_HEADER_WORDS.includes(w as string))
      expect(outside, `expand=${expandSubActs}`).toEqual([])
    }
  })
  it('isHeaderWordMatch — 대소문자·전각·앞뒤 공백을 무시한다(감지기와 같은 비교)', () => {
    expect(isHeaderWordMatch('start', 'Start')).toBe(true)
    expect(isHeaderWordMatch(' ＴＥＡＭ ', 'Team')).toBe(true)
    expect(isHeaderWordMatch('담당자', '담당')).toBe(false)
  })
})

describe('reservedTeamNames·normalizeNewTeamCode(D38)', () => {
  it('머리 낱말 ∪ 프로젝트 단계 이름 ∪ 추가 축 이름', () => {
    const r = reservedTeamNames({ levelLabels: ['단계', '작업'], extraAxisLabel: '사업' })
    expect(r).toEqual(expect.arrayContaining([...EXCEL_HEADER_WORDS, '단계', '작업', '사업']))
    expect(reservedTeamNames({ levelLabels: ['단계'], extraAxisLabel: null })).not.toContain(null)
  })
  it('예약어는 대소문자·전각·공백을 무시하고 거부한다 — 감지기가 그 머리를 논리 열로 읽는다', () => {
    const reserved = reservedTeamNames({ levelLabels: ['Phase', 'Task'], extraAxisLabel: null })
    for (const input of ['산출물', 'start', 'START', ' Team ', 'ｔｅａｍ', 'phase', '이름']) {
      expect(normalizeNewTeamCode(input, reserved).ok, input).toBe(false)
    }
    expect(normalizeNewTeamCode(' 신팀 ', reserved)).toEqual({ ok: true, code: '신팀' })
    expect(normalizeNewTeamCode('Activity', reserved)).toEqual({ ok: true, code: 'Activity' })   // 이 프로젝트의 단계 이름이 아니다
  })
  it('공용 팀(머리 낱말만)은 단계 이름을 보지 않는다 — 한계(K14)', () => {
    expect(normalizeNewTeamCode('Phase', EXCEL_HEADER_WORDS)).toEqual({ ok: true, code: 'Phase' })
  })
  it('빈 값·길이 초과는 지금처럼 거부', () => {
    expect(normalizeNewTeamCode('  ', EXCEL_HEADER_WORDS).ok).toBe(false)
    expect(normalizeNewTeamCode('a'.repeat(21), EXCEL_HEADER_WORDS).ok).toBe(false)
  })
})
