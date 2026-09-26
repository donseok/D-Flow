// 플랫폼 전용 가드(requireSuperuser) 호출 위치를 스펙 §4.1 D1 의 11곳으로 고정한다 — 새 호출은 워크스페이스·프로젝트 가드를 먼저 검토하게.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const EXPECTED = [
  'src/app/actions/accounts.ts#resetPassword', 'src/app/actions/accounts.ts#setPlatformAdmin',
  'src/app/actions/llmConfig.ts#createLlmProfile', 'src/app/actions/llmConfig.ts#deleteLlmProfile',
  'src/app/actions/llmConfig.ts#getLlmConfig', 'src/app/actions/llmConfig.ts#listLlmProfiles',
  'src/app/actions/llmConfig.ts#saveLlmConfig', 'src/app/actions/llmConfig.ts#testLlmConnection',
  'src/app/actions/llmConfig.ts#updateLlmProfile',
  'src/app/api/chat/health/route.ts#GET', 'src/app/api/wiki/reindex/route.ts#POST',
]

/** 주석을 걷어낸 코드 줄들 — 설명문 속 가드 이름은 호출이 아니다([a38]). 문자열 속 '//' 는 이 검사에서 무시해도 된다. */
function codeLines(text: string): string[] {
  let inBlock = false
  return text.split('\n').map((raw) => {
    let line = raw
    let out = ''
    while (line.length) {
      if (inBlock) {
        const end = line.indexOf('*/')
        if (end < 0) { line = ''; break }
        line = line.slice(end + 2); inBlock = false
        continue
      }
      const block = line.indexOf('/*')
      const slash = line.indexOf('//')
      if (slash >= 0 && (block < 0 || slash < block)) { out += line.slice(0, slash); break }
      if (block >= 0) { out += line.slice(0, block); line = line.slice(block + 2); inBlock = true; continue }
      out += line; break
    }
    return out
  })
}

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
