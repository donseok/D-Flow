// 런타임 상수 grep 게이트(정본 §6.5.2) — src/** 의 코드 줄에서 패턴이 나오면 허용 목록에 있어야 하고, 목록의 파일은 실제로 걸려야 한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from '../invariants/_walk'
import { ALLOW, PATTERNS, type RuntimeConstantPattern } from './no-runtime-constants.allow'

const files = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('/fixtures/'))
const hitsOf = (file: string): RuntimeConstantPattern[] => {
  const code = codeLines(readFileSync(file, 'utf8'), file).join('\n')
  return (Object.keys(PATTERNS) as RuntimeConstantPattern[]).filter((p) => PATTERNS[p].test(code))
}

describe('no-runtime-constants', () => {
  const actual = new Map(files.map((f) => [f, hitsOf(f)] as const).filter(([, hits]) => hits.length))
  it('목록 밖 파일에 패턴이 없다', () => {
    const offenders = [...actual].filter(([f]) => !ALLOW[f]).map(([f, hits]) => `${f}: ${hits.join(', ')}`)
    expect(offenders, '설정 레지스트리를 읽어야 한다 — 새 파일은 허용 목록에 오르지 못한다').toEqual([])
  })
  it('목록의 파일은 적힌 패턴에 정확히 걸린다(죽은 예외 없음)', () => {
    const stale: string[] = []
    for (const [f, a] of Object.entries(ALLOW)) {
      const hits = actual.get(f) ?? []
      if ([...hits].sort().join() !== [...a.patterns].sort().join()) stale.push(`${f}: 목록 ${a.patterns.join(',')} / 실측 ${hits.join(',') || '(없음)'}`)
    }
    expect(stale).toEqual([])
  })
  it('DEFAULT_TEAMS 는 이미 0건이다(tests/invariants/no-default-teams 와 겹치지만 재도입을 여기서도 막는다)', () => {
    expect([...actual.values()].some((h) => h.includes('DEFAULT_TEAMS'))).toBe(false)
  })

  it('SP4 가 지운 주간 상수는 허용 항목 없는 영구 가드다 — 어느 파일에도 없고 목록에도 없다(스펙 §4.8)', () => {
    const weekly: RuntimeConstantPattern[] = ['WEEKLY_SECTIONS', 'WEEKLY_TEAM_SECTIONS', 'FALLBACK_SECTION']
    expect(Object.entries(ALLOW).filter(([, a]) => a.patterns.some((p) => weekly.includes(p))).map(([f]) => f)).toEqual([])
    expect([...actual].filter(([, hits]) => hits.some((p) => weekly.includes(p))).map(([f]) => f)).toEqual([])
  })
})
