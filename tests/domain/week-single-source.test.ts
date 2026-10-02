// 주 계산 단일 출처(SP5 스펙 D9·E3·K15, 개정 §2.8.7) — 주 시작·요일 계산은 src/lib/domain/calendar.ts 하나다.
// 개정 정규식(mondayOf|mondayIso|(dow + 6) % 7)에 더해 .getDay()·.getUTCDay() 호출 자체를 금지한다 — 조건식 모양 매칭은 한 줄에 조건이 없는
// DayPopover 의 getDay()·다음 줄에서 비교하는 validate.mjs 를 놓친다. 스캔 = src/**(ts·tsx)·scripts/**(ts·mjs·js), 주석은 걷는다.
// 허용은 줄 단위의 닫힌 목록 둘이다: WEEK_CALC_ALLOW(영구 — 사유) · LEGACY_WEEK_COPIES(옛 사본 — 지우는 SP5 A 과제). 키 = '<파일>|<줄 조각>'.
// 죽은 항목(조각이 그 파일의 위반 줄에 없다)도 실패다 — 사본을 지운 과제가 항목도 지운다.
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from '../invariants/_walk'

const CALENDAR = 'src/lib/domain/calendar.ts'
const PATTERNS: readonly RegExp[] = [/\bmondayOf\b/, /\bmondayIso\b/, /\(dow \+ 6\) % 7/, /\.get(?:UTC)?Day\(\)/]

/** 영구 허용 — 주 계산이 아닌 요일 색인·ISO 주차, 또는 calendar.ts 를 import 할 수 없는 .mjs 의 월요일 규칙 시드·검증 */
export const WEEK_CALC_ALLOW: Readonly<Record<string, string>> = {
  'src/lib/report/weekly.ts|const dayNr = (d.getUTCDay() + 6) % 7': 'ISO-8601 주차 메타 isoWeek — ISO 정의라 주 시작 설정과 무관(개정 §2.8.7)',
  'src/lib/report/weekly.ts|const firstDayNr = (firstThu.getUTCDay() + 6) % 7': 'ISO-8601 주차 메타 isoWeek — 1월 4일이 든 주',
  'src/lib/report/weekly.ts|DOW_KR[d.getUTCDay()]': "요일 라벨 색인('M/D(요일)' 표기) — 주 계산이 아니다",
  'src/lib/mail/meetingInvite.ts|DOW_KR[d.getUTCDay()]': '회의 초대 메일의 요일 라벨 색인 — 주 계산이 아니다',
  'src/components/dashboard/bits.tsx|WEEKDAYS[new Date(': '대시보드 요일 사전 키(att.weekday.*) 색인 — 주 계산이 아니다',
  'scripts/ui-capture.mjs|const dow = new Date(': '캡처 시드 — 월요일 규칙을 생성 때 기록한 프로젝트의 이번 주 월요일 키(SP5 D28). .mjs 라 calendar.ts 를 import 하지 못한다',
  'scripts/ui-capture.mjs|-((dow + 6) % 7)': '캡처 시드 — 위와 같은 줄의 월요일 키(SP5 D28)',
  'scripts/lib/e2e.mjs|getUTCDay() === 1': 'E2E 검증 전용 isMondayIso — DB 가 돌려준 월요일 규칙 프로젝트의 키를 확인한다(키를 만들지 않는다, SP4 W30)',
}

/** 옛 사본 — 지우는 과제가 같은 커밋에서 항목을 지운다. 과제 29 가 빈 객체를 단언한다 */
export const LEGACY_WEEK_COPIES: Readonly<Record<string, string>> = {
  'src/lib/report/week.ts|monday': 'SP5 A 과제 14 — mondayIso·mondayOf 를 weekKeyOf·weekLabelTexts 로',
  'src/app/(app)/p/[projectId]/weekly/page.tsx|mondayIso': 'SP5 A 과제 14 — normalizeWeekParam(weekKeyOf)',
  'src/app/actions/weekly.ts|mondayIso': 'SP5 A 과제 14 — weekKeyOf(<프로젝트 규칙>)',
  'src/app/actions/projectAreas.ts|mondayIso': 'SP5 A 과제 14 — p_from_week = weekKeyOf(rules, todayIn(tz))',
  'src/app/api/report/route.ts|mondayIso': 'SP5 A 과제 14 — weekKeyOf',
  'src/lib/report/weekly.ts|mondayOf': 'SP5 A 과제 15 — 보고서 주차를 weekKeyOf·weekLabelTexts 로',
  'src/lib/report/weekly.ts|d.getUTCDay() || 7': 'SP5 A 과제 15 — mondayOf 본문',
  'src/components/wbs/WbsGanttSheet.tsx|getUTCDay()': 'SP5 A 과제 16 — 주 끝 = weekPeriodOf(현재 키).endExclusive − 1, 음영 = isWorkingDay',
  'src/lib/domain/ganttScale.ts|getUTCDay()': 'SP5 A 과제 16 — isWorkingDay',
  'src/lib/domain/issueDashboard.ts|getUTCDay()': 'SP5 A 과제 16 — 현재 규칙의 weekKeyOf',
  'src/lib/domain/issueDashboard.ts|(dow + 6) % 7': 'SP5 A 과제 16 — 현재 규칙의 weekKeyOf',
  'src/lib/wbsmd/parse.ts|getUTCDay()': 'SP5 A 과제 16 — nextWorkingDay(date, cal)',
  'src/lib/ai/tools/weekly.ts|getUTCDay()': 'SP5 A 과제 17 — 프로젝트 규칙의 키로 정규화(월요일 강제 삭제)',
  'src/lib/ai/chat/router.ts|mondayOf': 'SP5 A 과제 17 — weekPeriodOf(weekKeyOf(today))',
  'src/lib/ai/chat/router.ts|getUTCDay()': 'SP5 A 과제 17 — mondayOf 본문',
  'src/lib/ai/chat/planner.ts|getUTCDay()': 'SP5 A 과제 17 — dateAnchors(calendar, now)',
  'src/components/ui/DayPopover.tsx|getDay()': 'SP5 A 과제 21 — isoDowOf(date)(브라우저 로컬 tz 재해석 제거 — K15)',
  'src/lib/domain/dates.ts|getUTCDay()': 'SP5 A 과제 22 — isBusinessDay 삭제',
  'src/lib/domain/attendance.ts|first.getUTCDay()': 'SP5 A 과제 24 — monthMatrix(year, month, firstDay)',
  'src/app/(app)/meetings/page.tsx|first.getUTCDay()': 'SP5 A 과제 24 — monthGrid(…, firstDay)',
  'src/app/(app)/p/[projectId]/meetings/page.tsx|first.getUTCDay()': 'SP5 A 과제 24 — monthGrid(…, firstDay)',
  'src/components/meetings/MeetingsView.tsx|first.getUTCDay()': 'SP5 A 과제 24 — 첫 열 = 규칙 시작 요일',
  'src/components/meetings/MyMeetingsView.tsx|first.getUTCDay()': 'SP5 A 과제 24 — 첫 열 = 워크스페이스 규칙 시작 요일',
  'scripts/wbs/validate.mjs|getDay()': "SP5 A 과제 24 — UTC 판정(getUTCDay)으로 바꾸고 '주말(토·일)' 문구와 함께 WEEK_CALC_ALLOW 로 옮긴다(CLI 입력 규칙)",
}

/** 주석을 걷은 코드 줄 가운데 금지 꼴이 있는 줄(1부터) */
export function findWeekCalcViolations(text: string): { line: number; match: string }[] {
  const out: { line: number; match: string }[] = []
  codeLines(text).forEach((code, i) => {
    for (const p of PATTERNS) {
      const m = code.match(p)
      if (m) { out.push({ line: i + 1, match: code.trim() }); return }
    }
  })
  return out
}

const files = [
  ...walk('src').map((f) => relative(process.cwd(), f)),
  ...walk('scripts', undefined, /\.(ts|mjs|js)$/).map((f) => relative(process.cwd(), f)),
].filter((f) => f !== CALENDAR).sort()
const entries = (o: Readonly<Record<string, string>>) => Object.entries(o).map(([k, why]) => {
  const at = k.indexOf('|')
  return { key: k, file: k.slice(0, at), needle: k.slice(at + 1), why }
})
const ALLOWED = [...entries(WEEK_CALC_ALLOW), ...entries(LEGACY_WEEK_COPIES)]
const violations = files.flatMap((file) => findWeekCalcViolations(readFileSync(file, 'utf8')).map((v) => ({ file, ...v })))

describe('주 계산 단일 출처(D9)', () => {
  it('src·scripts 의 주 계산·요일 호출은 calendar.ts 와 두 허용 목록 밖 0건', () => {
    const offenders = violations
      .filter((v) => !ALLOWED.some((a) => a.file === v.file && v.match.includes(a.needle)))
      .map((v) => `${v.file}:${v.line}: ${v.match}`)
    expect(offenders, `calendar.ts 의 weekKeyOf·isoDowOf·startOfWeek 를 쓴다:\n${offenders.join('\n')}`).toEqual([])
  })
  it('죽은 항목 0 — 모든 항목의 조각이 그 파일의 위반 줄에 있다(사본을 지운 과제는 항목도 지운다)', () => {
    const dead = ALLOWED.filter((a) => !violations.some((v) => v.file === a.file && v.match.includes(a.needle))).map((a) => a.key)
    expect(dead).toEqual([])
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
