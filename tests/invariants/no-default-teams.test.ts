import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

// 원본 5팀 폴백은 런타임에 두지 않는다(DC-01a) — 팀은 팀 마스터(DB)만 본다. 테스트 픽스처는 tests/fixtures/teams.ts.
describe('5팀 기본값 런타임 0건', () => {
  it('src 에 DEFAULT_TEAMS·DEFAULT_TEAM_CODES·SUB_ACT_TEAMS 가 없다', () => {
    const hits = walk(join(process.cwd(), 'src')).flatMap(f => readFileSync(f, 'utf8').split('\n')
      .map((line, i) => [line, i] as const)
      .filter(([line]) => /\b(DEFAULT_TEAMS|DEFAULT_TEAM_CODES|SUB_ACT_TEAMS)\b/.test(line))
      .map(([line, i]) => `${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`))
    expect(hits, hits.join('\n')).toEqual([])
  })
})
