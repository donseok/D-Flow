// 주 계산 단일 출처(SP5 스펙 D9·E3·K15, 개정 §2.8.7) — 주 시작·요일 계산은 src/lib/domain/calendar.ts 하나다.
// 개정 정규식(mondayOf|mondayIso|(dow + 6) % 7)에 더해 .getDay()·.getUTCDay() 호출 자체를 금지한다 — 조건식 모양 매칭은 한 줄에 조건이 없는
// DayPopover 의 getDay()·다음 줄에서 비교하는 validate.mjs 를 놓친다. 스캔 = src/**(ts·tsx)·scripts/**(ts·mjs·js), 주석은 걷는다.
// 허용은 닫힌 목록 둘이다: WEEK_CALC_ALLOW(영구 — 사유) · LEGACY_WEEK_COPIES(옛 사본 — 지우는 SP5 A 과제). 키 = '<파일>|<줄 조각>',
// 값 = { why, count } — count 는 그 조각이 든 위반 줄들의 금지 꼴 **호출 수**다(K5): 허용 파일·허용 줄에 새 호출이 끼면 수가 늘어 실패한다.
// 죽은 항목(수 0)·수가 준 항목도 실패다 — 사본을 지우거나 줄인 과제가 항목·수를 같이 고친다. 줄은 그 파일의 항목 가운데 조각이 든 첫 항목에 센다.
// 요일 호출은 식별자로 잡는다(`\bget(?:UTC)?Day\b` — 공백·요소 접근 `d['getUTCDay']()`·문자열 속 이름 포함). 한계: 의도적 난독화(이름 조립·
// Reflect·별칭 변수에 메서드를 담아 부르기)는 잡지 못한다 — settings-writes 불변식과 같은 경계다.
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from '../invariants/_walk'

const CALENDAR = 'src/lib/domain/calendar.ts'
const PATTERNS: readonly RegExp[] = [/\bmondayOf\b/g, /\bmondayIso\b/g, /\(dow \+ 6\) % 7/g, /\bget(?:UTC)?Day\b/g]
/** why = 사유, count = 그 조각이 든 위반 줄들의 금지 꼴 호출 수(K5) */
export interface WeekCalcAllow { why: string; count: number }

/** 영구 허용 — 주 계산이 아닌 요일 색인·ISO 주차, 또는 calendar.ts 를 import 할 수 없는 .mjs 의 월요일 규칙 시드·검증 */
export const WEEK_CALC_ALLOW: Readonly<Record<string, WeekCalcAllow>> = {
  'src/lib/report/weekly.ts|const dayNr = (d.getUTCDay() + 6) % 7': { why: 'ISO-8601 주차 메타 isoWeek — ISO 정의라 주 시작 설정과 무관(개정 §2.8.7)', count: 1 },
  'src/lib/report/weekly.ts|const firstDayNr = (firstThu.getUTCDay() + 6) % 7': { why: 'ISO-8601 주차 메타 isoWeek — 1월 4일이 든 주', count: 1 },
  'src/lib/report/weekly.ts|DOW_KR[d.getUTCDay()]': { why: "요일 라벨 색인('M/D(요일)' 표기) — 주 계산이 아니다", count: 1 },
  'src/lib/mail/meetingInvite.ts|DOW_KR[d.getUTCDay()]': { why: '회의 초대 메일의 요일 라벨 색인 — 주 계산이 아니다', count: 2 },
  'src/components/dashboard/bits.tsx|WEEKDAYS[new Date(': { why: '대시보드 요일 사전 키(att.weekday.*) 색인 — 주 계산이 아니다', count: 1 },
  'scripts/ui-capture.mjs|const dow = new Date(': { why: '캡처 시드 — 월요일 규칙을 생성 때 기록한 프로젝트의 이번 주 월요일 키(SP5 D28). .mjs 라 calendar.ts 를 import 하지 못한다', count: 1 },
  'scripts/ui-capture.mjs|-((dow + 6) % 7)': { why: '캡처 시드 — 위와 같은 줄의 월요일 키(SP5 D28)', count: 1 },
  'scripts/lib/e2e.mjs|getUTCDay() === 1': { why: 'E2E 검증 전용 isMondayIso — DB 가 돌려준 월요일 규칙 프로젝트의 키를 확인한다(키를 만들지 않는다, SP4 W30)', count: 1 },
}

/** 옛 사본 — 지우는 과제가 같은 커밋에서 항목을 지운다. 과제 29 가 빈 객체를 단언한다 */
export const LEGACY_WEEK_COPIES: Readonly<Record<string, WeekCalcAllow>> = {
  'src/lib/domain/dates.ts|getUTCDay()': { why: 'SP5 A 과제 22 — isBusinessDay 삭제', count: 1 },
  'src/lib/domain/attendance.ts|first.getUTCDay()': { why: 'SP5 A 과제 24 — monthMatrix(year, month, firstDay)', count: 1 },
  'src/app/(app)/meetings/page.tsx|first.getUTCDay()': { why: 'SP5 A 과제 24 — monthGrid(…, firstDay)', count: 1 },
  'src/app/(app)/p/[projectId]/meetings/page.tsx|first.getUTCDay()': { why: 'SP5 A 과제 24 — monthGrid(…, firstDay)', count: 1 },
  'src/components/meetings/MeetingsView.tsx|first.getUTCDay()': { why: 'SP5 A 과제 24 — 첫 열 = 규칙 시작 요일', count: 1 },
  'src/components/meetings/MyMeetingsView.tsx|first.getUTCDay()': { why: 'SP5 A 과제 24 — 첫 열 = 워크스페이스 규칙 시작 요일', count: 1 },
  'scripts/wbs/validate.mjs|getDay()': { why: "SP5 A 과제 24 — UTC 판정(getUTCDay)으로 바꾸고 '주말(토·일)' 문구와 함께 WEEK_CALC_ALLOW 로 옮긴다(CLI 입력 규칙)", count: 1 },
}

/** 주석을 걷은 코드 줄 가운데 금지 꼴이 있는 줄(1부터)과 그 줄의 금지 꼴 호출 수. fileName 은 파서(TS/TSX/JS) 선택용 */
export function findWeekCalcViolations(text: string, fileName?: string): { line: number; match: string; hits: number }[] {
  const out: { line: number; match: string; hits: number }[] = []
  codeLines(text, fileName).forEach((code, i) => {
    let hits = 0
    for (const p of PATTERNS) hits += code.match(p)?.length ?? 0
    if (hits) out.push({ line: i + 1, match: code.trim(), hits })
  })
  return out
}

type Violation = { file: string; line: number; match: string; hits: number }
type AllowEntry = { key: string; file: string; needle: string; why: string; count: number }
/** 위반 줄을 그 파일의 첫 일치 항목에 세고, 항목마다 호출 수가 count 와 같은지 본다 — 목록 밖 줄은 offenders, 수가 다르면 miscounted */
export function judgeWeekCalc(violations: readonly Violation[], allowed: readonly AllowEntry[]): { offenders: string[]; miscounted: string[] } {
  const seen = new Map<string, number>(allowed.map((a) => [a.key, 0]))
  const offenders: string[] = []
  for (const v of violations) {
    const a = allowed.find((x) => x.file === v.file && v.match.includes(x.needle))
    if (!a) offenders.push(`${v.file}:${v.line}: ${v.match}`)
    else seen.set(a.key, (seen.get(a.key) ?? 0) + v.hits)
  }
  const miscounted = allowed.filter((a) => seen.get(a.key) !== a.count).map((a) => `${a.key} — 기대 ${a.count}, 실제 ${seen.get(a.key)}`)
  return { offenders, miscounted }
}

const files = [
  ...walk('src').map((f) => relative(process.cwd(), f)),
  ...walk('scripts', undefined, /\.(ts|mjs|js)$/).map((f) => relative(process.cwd(), f)),
].filter((f) => f !== CALENDAR).sort()
const entries = (o: Readonly<Record<string, WeekCalcAllow>>): AllowEntry[] => Object.entries(o).map(([k, v]) => {
  const at = k.indexOf('|')
  return { key: k, file: k.slice(0, at), needle: k.slice(at + 1), why: v.why, count: v.count }
})
const ALLOWED = [...entries(WEEK_CALC_ALLOW), ...entries(LEGACY_WEEK_COPIES)]
const violations: Violation[] = files.flatMap((file) => findWeekCalcViolations(readFileSync(file, 'utf8'), file).map((v) => ({ file, ...v })))
const judged = judgeWeekCalc(violations, ALLOWED)

describe('주 계산 단일 출처(D9)', () => {
  it('src·scripts 의 주 계산·요일 호출은 calendar.ts 와 두 허용 목록 밖 0건', () => {
    expect(judged.offenders, `calendar.ts 의 weekKeyOf·isoDowOf·startOfWeek 를 쓴다:\n${judged.offenders.join('\n')}`).toEqual([])
  })
  it('항목마다 호출 수가 count 와 같다 — 허용 파일의 새 호출(늘어남)·죽은 항목(0)·지운 사본(줄어듦) 모두 실패(K5)', () => {
    expect(judged.miscounted).toEqual([])
    for (const a of ALLOWED) expect(existsSync(a.file), a.key).toBe(true)
  })
  it('두 목록은 겹치지 않고, 키 꼴·사유 꼴을 지킨다', () => {
    const legacy = Object.keys(LEGACY_WEEK_COPIES)
    expect(Object.keys(WEEK_CALC_ALLOW).filter((k) => legacy.includes(k))).toEqual([])
    for (const a of ALLOWED) {
      expect(a.file, a.key).toMatch(/^(src|scripts)\/\S+\.(ts|tsx|mjs|js)$/)
      expect(a.needle.length, a.key).toBeGreaterThan(0)
    }
    for (const a of entries(LEGACY_WEEK_COPIES)) expect(a.why, a.key).toMatch(/^SP5 A 과제 \d+ — \S/)
    for (const a of entries(WEEK_CALC_ALLOW)) expect(a.why.length, a.key).toBeGreaterThan(10)
    for (const a of ALLOWED) expect(Number.isInteger(a.count) && a.count >= 1, a.key).toBe(true)
  })
  it('스캔 범위 — calendar.ts 는 빼고 scripts 의 .mjs 를 포함한다', () => {
    expect(files).not.toContain(CALENDAR)
    expect(existsSync(CALENDAR)).toBe(true)
    expect(files.some((f) => f.startsWith('scripts/') && f.endsWith('.mjs'))).toBe(true)
  })
})

describe('findWeekCalcViolations — 놓침 표본 일곱(E3·D9)과 거짓 적중 표본', () => {
  it.each([
    ['planner 주 범위(다음 줄의 day === 0 ? 6 : day − 1 은 앞 줄의 getUTCDay 가 잡는다)', 'const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()\nconst monday = addDaysIso(today, -(day === 0 ? 6 : day - 1))'],
    ['봇 주간 도구의 월요일 강제', 'if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1) {'],
    ['간트 주 끝', 'end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)) + 7)'],
    ['캡처 시드의 월요일 키', 'const weeklyReport = { week_start: plusDays(today, -((dow + 6) % 7)) }'],
    ['DayPopover 의 로컬 tz getDay(조건 없는 줄)', 'const dow = new Date(`${anchor.date}T00:00:00`).getDay()'],
    ['wbsmd 의 주말 판정', 'do { d.setUTCDate(d.getUTCDate() + 1) } while (d.getUTCDay() === 0 || d.getUTCDay() === 6)'],
    ['검증 CLI 의 getDay(비교는 다음 줄)', "const d = new Date(iso + 'T12:00:00').getDay()\nreturn d === 0 || d === 6"],
    ['우회 — 이름과 괄호 사이 공백(K5)', 'const dow = d.getUTCDay ()'],
    ['우회 — 요소 접근(K5)', "const dow = d['getUTCDay']()"],
    ['우회 — 옵셔널 체이닝(K5)', 'const dow = maybe?.getDay()'],
  ])('%s → 적중', (_n, text) => {
    expect(findWeekCalcViolations(text).length).toBeGreaterThan(0)
  })
  it.each([
    ['다른 메서드', 'const n = budget.getDays()'],
    ['비슷한 이름', 'const label = getDayLabel(d); const y = cal.getDayOfYear()'],
    ['줄 주석', '// mondayIso 는 SP5 가 지웠다'],
    ['블록 주석', '/* getUTCDay() 를 쓰지 않는다 — isoDowOf 를 쓴다 */'],
    ['긴 식별자', "const mondayIsoString = 'x'"],
    ['달력 모듈 함수', 'const dow = isoDowOf(date); const key = weekKeyOf(rules, date)'],
  ])('%s → 0', (_n, text) => {
    expect(findWeekCalcViolations(text)).toEqual([])
  })
})

describe('judgeWeekCalc — 허용 항목은 호출 수까지 고정한다(K5)', () => {
  const A: AllowEntry[] = [{ key: 'src/a.ts|getUTCDay()', file: 'src/a.ts', needle: 'getUTCDay()', why: '표본', count: 1 }]
  const v = (file: string, text: string) => findWeekCalcViolations(text).map((x) => ({ file, ...x }))
  it('허용 줄 그대로면 통과', () => {
    expect(judgeWeekCalc(v('src/a.ts', 'const k = d.getUTCDay()'), A)).toEqual({ offenders: [], miscounted: [] })
  })
  it('허용 파일의 다른 줄에 새 호출 — 같은 조각이 들어 있어도 수가 늘어 실패', () => {
    expect(judgeWeekCalc(v('src/a.ts', 'const k = d.getUTCDay()\nconst j = e.getUTCDay()'), A).miscounted).toEqual(['src/a.ts|getUTCDay() — 기대 1, 실제 2'])
  })
  it('허용 줄에 새 호출이 같이 붙어도 실패', () => {
    expect(judgeWeekCalc(v('src/a.ts', 'const k = d.getUTCDay() + e.getDay()'), A).miscounted).toEqual(['src/a.ts|getUTCDay() — 기대 1, 실제 2'])
  })
  it('허용 파일의 조각 없는 새 줄은 목록 밖(offenders), 사본을 지우면 죽은 항목(실제 0)', () => {
    expect(judgeWeekCalc(v('src/a.ts', 'const k = mondayIso(x)'), A)).toEqual({
      offenders: ['src/a.ts:1: const k = mondayIso(x)'], miscounted: ['src/a.ts|getUTCDay() — 기대 1, 실제 0'],
    })
  })
})
