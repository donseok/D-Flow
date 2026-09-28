// 모듈 플래그 8개는 flags.ts 술어로만 읽는다(스펙 §4.1). 킬스위치 둘(시크릿까지 보는 두 externalApi)은 owner 다.
// Phase C 의 operational-env (가) "목록 이름은 owner 파일에서만 읽힌다"가 이 테스트를 대신하면 C 가 지운다.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_FLAG_NAMES } from '@/lib/modules/flags'
import { codeLines, walk } from '../invariants/_walk'

const OWNERS: Record<string, readonly string[]> = {
  'src/lib/modules/flags.ts': MODULE_FLAG_NAMES,
  'src/lib/agent/externalApi.ts': ['AGENT_API_ENABLED'],          // 킬스위치(E15 — 자리 유지)
  'src/lib/minutes/externalApi.ts': ['MINUTES_API_ENABLED'],      // 킬스위치 = 플래그 ∧ 시크릿(flags.ts 와 뜻이 다르다)
}
const READ = new RegExp(`\\benv(?:\\.|\\[\\s*['"])(${MODULE_FLAG_NAMES.join('|')})\\b`)

describe('모듈 플래그 판독 위치', () => {
  it('flags.ts·두 킬스위치 밖에서 process.env.<플래그>·env.<플래그> 판독이 0건', () => {
    const hits = walk('src').flatMap((f) => {
      const rel = relative(process.cwd(), f)
      return codeLines(readFileSync(f, 'utf8'), f).flatMap((line, i) => {
        const m = line.match(READ)
        if (!m) return []
        if ((OWNERS[rel] ?? []).includes(m[1])) return []
        return [`${rel}:${i + 1}: ${line.trim()}`]
      })
    })
    expect(hits, '모듈 플래그는 @/lib/modules/flags 의 술어로 읽는다').toEqual([])
  })
  it('민감도 — 판독 모양 셋을 잡는다', () => {
    expect(READ.test("if (process.env.CHAT_V2_ENABLED !== 'true')")).toBe(true)
    expect(READ.test("process.env['WIKI_WORKER_ENABLED']")).toBe(true)
    expect(READ.test('env.WIKI_SERVICE_ENABLED === "true"')).toBe(true)
    expect(READ.test('chatV2Enabled()')).toBe(false)
  })
})
