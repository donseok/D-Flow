import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 레퍼런스 하네스는 최상위 await 와 env 로 도는 스크립트라 단위 실행하지 않고 소스를 정적으로 본다.
const SRC = readFileSync(join(process.cwd(), 'scripts/agent-harness-example.mjs'), 'utf8')

describe('scripts/agent-harness-example.mjs', () => {
  it('레거시 시크릿의 작업 목록 조회(GET /agent/work?project_id=)는 user_email 을 붙인다(없으면 400 identity_required)', () => {
    const lines = SRC.split('\n').filter((l) => l.includes('/agent/work?project_id='))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).toMatch(/user_email=\$\{encodeURIComponent\(AGENT_EMAIL\)\}/)
  })
})
