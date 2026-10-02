// 국가 달력 0(SP5 사용자 결정 5·스펙 §4.5·개정 §4.2.7) — 한국 공휴일 오버레이·고정 공휴일 상수가 코드·스크립트·스킬로 다시 들어오지 않게.
// 금지 둘: ① 문자열 넷 ② 한 파일에 한국 고정 공휴일 월·일을 가진 'YYYY-MM-DD' 리터럴이 둘 이상. 스킬 문서는 코드 블록(```)을 뺀 산문만 본다.
// grep 만으로 판정하지 않는다(개정 §6.1 원칙 2) — 빌더·템플릿·검증 CLI 의 기본 휴일이 [] 라는 행위 단언 셋을 같이 둔다.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { walk } from './_walk'
import { buildWorkbook } from '../../scripts/wbs/build-xlsx.mjs'
import { checkDraft } from '../../scripts/wbs/validate.mjs'
import { TEMPLATE_HOLIDAYS } from '@/lib/excel/template'

const ROOT = process.cwd()
const FORBIDDEN = /krSpecialDay|holiday_region|광복절|개천절/
const FIXED_MD = ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25']
const FIXED_DATE = new RegExp(String.raw`\b\d{4}-(?:${FIXED_MD.join('|')})\b`, 'g')
const CODE_FENCE = /```[\s\S]*?```/g
const SELF = 'tests/invariants/no-country-calendar.test.ts'

function scanned(): { path: string; text: string }[] {
  const code = [
    ...walk(join(ROOT, 'src'), undefined, /\.(ts|tsx|mjs|js)$/),
    ...walk(join(ROOT, 'scripts'), undefined, /\.(ts|mjs|js|cjs)$/),
  ].map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }))
  const skills = walk(join(ROOT, '.claude/skills'), new Set(['__pycache__', '.pytest_cache', 'node_modules']), /\.(md|py|mjs|js|ts)$/)
    .map((p) => {
      const raw = readFileSync(p, 'utf8')
      // 스킬 문서의 예시 코드 블록은 뺀다 — 줄 수는 유지(줄 번호가 원문과 맞게)
      return { path: relative(ROOT, p), text: p.endsWith('.md') ? raw.replace(CODE_FENCE, (m) => m.replace(/[^\n]/g, '')) : raw }
    })
  return [...code, ...skills]
}

/** 한 텍스트의 위반 — 표본 테스트도 부른다 */
function countryCalendarHits(path: string, text: string): string[] {
  const out: string[] = []
  text.split('\n').forEach((line, i) => { if (FORBIDDEN.test(line)) out.push(`${path}:${i + 1}: ${line.trim()}`) })
  const fixed = new Set(text.match(FIXED_DATE) ?? [])
  if (fixed.size >= 2) out.push(`${path}: 한국 고정 공휴일 날짜 리터럴 ${fixed.size}개 — ${[...fixed].sort().join(', ')}`)
  return out
}

describe('no-country-calendar — 국가 달력 출처 0', () => {
  const files = scanned()

  it('세 뿌리를 모두 걷는다(빈 목록으로 통과하지 않는다)', () => {
    const roots = new Set(files.map((f) => f.path.split('/')[0]))
    expect([...roots].sort()).toEqual(['.claude', 'scripts', 'src'])
    expect(files.some((f) => f.path === 'scripts/wbs/validate.mjs')).toBe(true)
  })

  it('금지 문자열·고정 공휴일 상수가 없다', () => {
    const hits = files.filter((f) => f.path !== SELF).flatMap((f) => countryCalendarHits(f.path, f.text))
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('표본 — 놓치지 않고(상수 둘·금지 문자열), 날짜 하나는 잡지 않는다', () => {
    expect(countryCalendarHits('x.mjs', "const H = new Set(['2026-08-15', '2026-10-03'])")).toHaveLength(1)
    expect(countryCalendarHits('x.ts', "import { krSpecialDayMap } from './h'")).toHaveLength(1)
    expect(countryCalendarHits('x.ts', "const label = '광복절'")).toHaveLength(1)
    expect(countryCalendarHits('x.ts', "const due = '2026-12-25'")).toEqual([])
    expect(countryCalendarHits('x.ts', "const d = ['2026-12-24', '2026-10-02']")).toEqual([])
  })
})

describe('기본 공휴일 = [](행위 단언 셋)', () => {
  const AREAS = [{ key: 'A', l1: '영역', l2: '묶음', l2Deliverable: '산출물', children: [{
    name: '작업 묶음', start: '2026-10-05', end: '2026-10-09', weight: 1,
    children: [{ name: '작업', start: '2026-10-05', end: '2026-10-09', weight: 1, deliverable: '문서' }],
  }] }]

  it('빌더 CLI — buildWorkbook(areas) 의 Holiday 시트는 머리 한 줄뿐', () => {
    const { wb } = buildWorkbook(AREAS)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Holiday, { header: 1, blankrows: false })
    expect(rows).toEqual([['날짜', '이름']])
  })

  it('템플릿 — TEMPLATE_HOLIDAYS 가 빈 배열', () => {
    expect(TEMPLATE_HOLIDAYS).toEqual([])
  })

  it('검증 CLI — holidays 없는 입력의 휴일은 [] 이고 10-09(금) 종료는 문제가 아니다', () => {
    const r = checkDraft({ areas: AREAS })
    expect(r.holidays).toEqual([])
    expect(r.problems.filter((p: string) => p.includes('휴일'))).toEqual([])
  })

  it('검증 CLI — 입력 holidays 의 날짜에 끝나면 문제로 보고하고, 배열이 아니면 throw', () => {
    const r = checkDraft({ areas: AREAS, holidays: [{ date: '2026-10-09', name: '창립기념일' }] })
    expect(r.problems.some((p: string) => p.includes('휴일에 시작·종료'))).toBe(true)
    expect(() => checkDraft({ areas: AREAS, holidays: '2026-10-09' })).toThrow('holidays 는')
  })

  it('검증 CLI — 주말 문구는 "주말(토·일)"', () => {
    const r = checkDraft({ areas: [{ key: 'A', children: [{ name: 'g', start: '2026-10-10', end: '2026-10-10', weight: 1,
      children: [{ name: 't', start: '2026-10-10', end: '2026-10-10', weight: 1, deliverable: 'd' }] }] }] })
    expect(r.problems.some((p: string) => p.includes('시작이 주말(토·일)'))).toBe(true)
  })
})
