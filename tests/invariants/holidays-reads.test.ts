// holidays 판독 단일화(SP5 A — 스펙 D11) — kind 도입 뒤 date 만 읽는 곳은 work 행을 휴무로 오판한다. holidays 표는 허용 파일 둘에서만
// from() 하고(로더·쓰기 액션), 허용 파일 안의 select 는 kind 를 싣는다. 설정 4표 불변식(settings-writes)과 같은 꼴 — 의도적 난독화는 못 잡는다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'

const ROOT = path.resolve(__dirname, '../..')
const ALLOWED: Readonly<Record<string, string>> = {
  'src/lib/calendar/load.ts': '유일한 판독 — 키셋 끝까지 + kind',
  'src/app/actions/project.ts': '쓰기(addHoliday·removeHoliday — 세션 + RLS admin_write_holidays). select 없음',
}
const FROM = /\.from\(\s*(['"`])holidays\1\s*\)/g
const FROM_SELECT = /\.from\(\s*(['"`])holidays\1\s*\)\s*\.select\(\s*(['"`])([^'"`]*)\2/g

function srcFiles(): string[] {
  return walk(path.join(ROOT, 'src')).map(f => path.relative(ROOT, f).split(path.sep).join('/')).sort()
}
export function holidayReads(text: string): { selects: string[]; froms: number } {
  return { froms: [...text.matchAll(FROM)].length, selects: [...text.matchAll(FROM_SELECT)].map(m => m[3]) }
}

describe('holidays 판독 단일화', () => {
  it('허용 파일 밖에서 from(\'holidays\') 0건', () => {
    const offenders = srcFiles().filter(f => !(f in ALLOWED) && holidayReads(readFileSync(path.join(ROOT, f), 'utf8')).froms > 0)
    expect(offenders).toEqual([])
  })
  it('허용 파일 안의 select 는 kind 를 싣는다', () => {
    for (const f of Object.keys(ALLOWED)) {
      for (const cols of holidayReads(readFileSync(path.join(ROOT, f), 'utf8')).selects) expect(cols, f).toMatch(/\bkind\b/)
    }
  })
  it('죽은 허용 항목이 없다 — 로더는 holidays 를 읽는다', () => {
    expect(holidayReads(readFileSync(path.join(ROOT, 'src/lib/calendar/load.ts'), 'utf8')).froms).toBeGreaterThan(0)
    for (const f of Object.keys(ALLOWED)) expect(() => readFileSync(path.join(ROOT, f)), f).not.toThrow()
  })
  it('검사 함수 표본 — 줄바꿈·큰따옴표·백틱을 잡고 다른 표는 잡지 않는다', () => {
    expect(holidayReads("sb\n  .from('holidays')\n  .select('date')").selects).toEqual(['date'])
    expect(holidayReads('sb.from("holidays").select("date, kind")').selects).toEqual(['date, kind'])
    expect(holidayReads('sb.from(`holidays`).delete()').froms).toBe(1)
    expect(holidayReads("sb.from('holidays_backup').select('date')").froms).toBe(0)
  })
})
