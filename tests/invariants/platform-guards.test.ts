// 플랫폼 전용 가드(requireSuperuser) 호출 위치를 닫힌 목록으로 고정한다 — 새 호출은 워크스페이스·프로젝트 가드를 먼저 검토하게.
// 스펙 §4.1 D1 의 11곳 + 워크스페이스 목록·생성 둘(개정 §5.3.2 — 워크스페이스가 아직 없거나 전부를 보는 화면이라 워크스페이스 가드로는 열 수 없다) = 13곳
// − 비밀번호 재설정 하나 = 12곳. resetPassword 는 그 워크스페이스의 관리자에게 열렸다(requireWorkspaceAdmin + 대상 범위 판정
// passwordResetVerdict — 다른 워크스페이스에도 속한 계정·관리자 계정은 여전히 플랫폼 관리자만이다).
// + 빈 워크스페이스 삭제 하나(0055 — 되돌릴 수 없는 조작이라 그 워크스페이스의 관리자에게 열지 않는다) = 13곳. 이름 변경(renameWorkspace)은
// requireWorkspaceAdmin 이라 여기 없다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeLines, walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const EXPECTED = [
  'src/app/actions/accounts.ts#setPlatformAdmin',
  'src/app/actions/llmConfig.ts#createLlmProfile', 'src/app/actions/llmConfig.ts#deleteLlmProfile',
  'src/app/actions/llmConfig.ts#getLlmConfig', 'src/app/actions/llmConfig.ts#listLlmProfiles',
  'src/app/actions/llmConfig.ts#saveLlmConfig', 'src/app/actions/llmConfig.ts#testLlmConnection',
  'src/app/actions/llmConfig.ts#updateLlmProfile',
  'src/app/actions/platformWorkspaces.ts#createPlatformWorkspace', 'src/app/actions/platformWorkspaces.ts#deletePlatformWorkspace',
  'src/app/actions/platformWorkspaces.ts#listPlatformWorkspaces',
  'src/app/api/chat/health/route.ts#GET', 'src/app/api/wiki/reindex/route.ts#POST',
]

describe('플랫폼 가드 13곳(D1 의 11 − 비밀번호 재설정 + 워크스페이스 목록·생성·삭제)', () => {
  it('requireSuperuser( 호출 = EXPECTED', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(process.cwd(), file)
      if (rel === 'src/lib/authz/index.ts') continue   // 정의
      let fn = '(top)'
      for (const line of codeLines(readFileSync(file, 'utf8'), file)) {
        const m = line.match(/^export (?:async )?function (\w+)/)
        if (m) fn = m[1]
        if (/\brequireSuperuser\(/.test(line)) hits.push(`${rel}#${fn}`)
      }
    }
    expect(hits.sort()).toEqual([...EXPECTED].sort())
  }, 20_000)

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
