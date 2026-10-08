import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 레퍼런스 하네스는 최상위 await 와 env 로 도는 스크립트라 단위 실행하지 않고 소스를 정적으로 본다.
const SRC = readFileSync(join(process.cwd(), 'scripts/agent-harness-example.mjs'), 'utf8')

describe('scripts/agent-harness-example.mjs', () => {
  // 옛 케이스 '레거시 시크릿의 작업 목록 조회는 user_email 을 붙인다(없으면 400 identity_required)' 의 후신 — 시크릿 principal 과 그 신원
  // 규칙이 삭제됐다(SP7 §5.1.4). 신원은 토큰(PAT) 소유자이고, 읽기 호출은 user_email 쿼리 없이 간다.
  it('작업 목록 조회(GET /agent/work?project_id=)는 토큰으로만 인증한다 — user_email 쿼리를 붙이지 않는다', () => {
    const lines = SRC.split('\n').filter((l) => l.includes('/agent/work?project_id=') && !l.trim().startsWith('//'))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l).not.toMatch(/user_email=/)
    expect(SRC).toMatch(/Authorization: `Bearer \$\{AGENT_SECRET\}`/)
  })
  it('쓰기 호출의 body user_email 은 토큰 소유자 이메일(AGENT_EMAIL)이다 — 서버가 소유자와 대조한다(identity_mismatch)', () => {
    expect(SRC).toMatch(/const actor = \{ user_email: AGENT_EMAIL, agent: AGENT_NAME \}/)
    expect(SRC).toContain('dflow_pat_')
  })
  it('삭제된 배포 전역 시크릿의 env 이름을 쓰지 않는다', () => {
    expect(SRC).not.toContain(['AGENT', 'API', 'SECRET'].join('_'))
  })
})
