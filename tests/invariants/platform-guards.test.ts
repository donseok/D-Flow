// 플랫폼 전용 가드(requireSuperuser) 호출 위치를 스펙 §4.1 D1 의 11곳으로 고정한다 — 새 호출은 워크스페이스·프로젝트 가드를 먼저 검토하게.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeLines, walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const EXPECTED = [
  'src/app/actions/accounts.ts#resetPassword', 'src/app/actions/accounts.ts#setPlatformAdmin',
  'src/app/actions/llmConfig.ts#createLlmProfile', 'src/app/actions/llmConfig.ts#deleteLlmProfile',
  'src/app/actions/llmConfig.ts#getLlmConfig', 'src/app/actions/llmConfig.ts#listLlmProfiles',
  'src/app/actions/llmConfig.ts#saveLlmConfig', 'src/app/actions/llmConfig.ts#testLlmConnection',
  'src/app/actions/llmConfig.ts#updateLlmProfile',
  'src/app/api/chat/health/route.ts#GET', 'src/app/api/wiki/reindex/route.ts#POST',
]

describe('플랫폼 가드 11곳(D1)', () => {
  it('requireSuperuser( 호출 = EXPECTED', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(process.cwd(), file)
      if (rel === 'src/lib/authz/index.ts') continue   // 정의
      let fn = '(top)'
      for (const line of codeLines(readFileSync(file, 'utf8'))) {
        const m = line.match(/^export (?:async )?function (\w+)/)
        if (m) fn = m[1]
        if (/\brequireSuperuser\(/.test(line)) hits.push(`${rel}#${fn}`)
      }
    }
    expect(hits.sort()).toEqual([...EXPECTED].sort())
  })

  it('주석 속 가드 이름은 세지 않는다', () => {
    const src = [
      '// requireSuperuser() 는 플랫폼 전용', '/* requireSuperuser()', ' * requireSuperuser() */',
      'const g = await requireSuperuser() // 호출', '/** a */ x(requireSuperuser())',
    ].join('\n')
    expect(codeLines(src).filter((l) => /\brequireSuperuser\(/.test(l))).toEqual([
      'const g = await requireSuperuser() ', ' x(requireSuperuser())',
    ])
  })
})
