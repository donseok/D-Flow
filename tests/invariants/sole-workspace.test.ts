// 세션 유일 워크스페이스 판정 0건(스펙 §8.1·§9, D26·E3) — 주석 포함. 대상: src/app(api/v1 포함 — SP7 에서 자격증명 워크스페이스로 바꿨다)·src/components·src/lib(제외 둘).
// 판정 함수 자체(resolveSoleWorkspaceId)는 SP7 에서 지웠다 — 이름 0건은 제외 없이 전 src 에서 본다(아래 둘째 케이스, legacy-auth-removed 와 겹쳐 둔다).
// 리터럴 null 만 본다 — 변수 인자는 리뷰 대상이다. 임시 허용의 사유 규칙은 route-literals 와 같다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'

const PATTERN = /resolveSoleWorkspaceId|requireSessionModule\(null|requireModulePage\(null|aiAvailable\(null/g
const ROOTS = ['src/app', 'src/components', 'src/lib']
// aiAvailable.ts 는 null 범위를 없애 감시 대상으로 돌렸다(CC3) — 다시 유일 워크스페이스 판정을 들이면 여기서 잡힌다
// 두 파일은 null 범위 갈래의 정의·설명을 가진다(그 갈래는 이제 core 만 통과하고 닫힌다) — 호출부는 0건이어야 한다
const EXCLUDE = new Set(['src/lib/modules/gate.ts', 'src/lib/modules/pageGate.ts'])

// UI-2b 과제 34 로 세션 라우트·minutes-answer 가 요청의 워크스페이스로 판정한다 — 임시 허용 0(V19)
export const TEMP: Record<string, { count: number; why: string }> = {}

describe('sole-workspace', () => {
  it('판정 호출·언급은 임시 허용 목록의 개수 그대로', () => {
    const got: Record<string, number> = {}
    for (const f of ROOTS.flatMap((r) => walk(r))) {
      if (EXCLUDE.has(f)) continue
      const n = readFileSync(f, 'utf8').match(PATTERN)?.length ?? 0
      if (n) got[f] = n
    }
    expect(got).toEqual(Object.fromEntries(Object.entries(TEMP).map(([f, v]) => [f, v.count])))
  })
  it('유일 워크스페이스 판정 함수는 src 어디에도 없다 — 제외 파일 포함(SP7)', () => {
    const name = ['resolve', 'Sole', 'WorkspaceId'].join('')
    expect(walk('src').filter((f) => readFileSync(f, 'utf8').includes(name))).toEqual([])
    expect(walk('src').length).toBeGreaterThan(100)   // 대조 — 실제로 파일을 훑는다
  }, 20_000)
  it('사유 규칙', () => { for (const [f, v] of Object.entries(TEMP)) expect(v.why, f).toMatch(/^(UI-2a: 과제 \d+ — |UI-2b: )/) })
})
