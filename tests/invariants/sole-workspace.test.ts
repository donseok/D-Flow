// 세션 유일 워크스페이스 판정 0건(스펙 §8.1·§9, D26·E3) — 주석 포함. 대상: src/app(api/v1 제외)·src/components·src/lib(제외 넷).
// 리터럴 null 만 본다 — 변수 인자는 리뷰 대상이다. 임시 허용의 사유 규칙은 route-literals 와 같다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'

const PATTERN = /resolveSoleWorkspaceId|requireSessionModule\(null|requireModulePage\(null|aiAvailable\(null/g
const ROOTS = ['src/app', 'src/components', 'src/lib']
const EXCLUDE = new Set(['src/lib/modules/gate.ts', 'src/lib/modules/pageGate.ts', 'src/lib/modules/aiAvailable.ts', 'src/lib/authz/workspace.ts'])
const isV1 = (f: string) => f.startsWith('src/app/api/v1/')

export const TEMP: Record<string, { count: number; why: string }> = {
  'src/lib/ai/minutes-answer.ts': { count: 1, why: 'UI-2b: 과제 34 — aiAvailable 범위' },
  'src/app/api/track/route.ts': { count: 1, why: 'UI-2b: 과제 34 — 세션 라우트 workspaceId' },
  'src/app/api/minutes/export/route.ts': { count: 3, why: 'UI-2b: 과제 34 — 세션 라우트 workspaceId' },
  'src/app/api/minutes/chat/route.ts': { count: 1, why: 'UI-2b: 과제 34 — 세션 라우트 workspaceId' },
}

describe('sole-workspace', () => {
  it('판정 호출·언급은 임시 허용 목록의 개수 그대로', () => {
    const got: Record<string, number> = {}
    for (const f of ROOTS.flatMap((r) => walk(r))) {
      if (EXCLUDE.has(f) || isV1(f)) continue
      const n = readFileSync(f, 'utf8').match(PATTERN)?.length ?? 0
      if (n) got[f] = n
    }
    expect(got).toEqual(Object.fromEntries(Object.entries(TEMP).map(([f, v]) => [f, v.count])))
  })
  it('사유 규칙', () => { for (const [f, v] of Object.entries(TEMP)) expect(v.why, f).toMatch(/^(UI-2a: 과제 \d+ — |UI-2b: )/) })
})
