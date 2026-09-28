import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeLines, walk } from './_walk'

// 설정 편집기의 요청 id(commandId)는 newUuid 로 만든다 — http 로 LAN IP 에 접속하면(보안 컨텍스트 아님) crypto.randomUUID 가
// 없어 저장이 TypeError 로 멈춘다(C2 T28-M2). 세 편집기를 컴포넌트 테스트 하나씩 대신 이 검사 하나로 덮는다(F-2).
describe('설정 편집기 요청 id', () => {
  const dir = join(process.cwd(), 'src/components/settings')

  it('src/components/settings 에 crypto.randomUUID 호출이 없다', () => {
    const hits = walk(dir).flatMap((f) => codeLines(readFileSync(f, 'utf8'))
      .map((line, i) => [line, i] as const)
      .filter(([line]) => /\brandomUUID\s*\(/.test(line))
      .map(([line, i]) => `${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`))
    expect(hits, hits.join('\n')).toEqual([])
  })

  it.each(['LevelSettingsManager.tsx', 'StageCreditSlider.tsx', 'ClearExcelProfileButton.tsx'])('%s 는 commandId 를 newUuid() 로 만든다', (name) => {
    const code = codeLines(readFileSync(join(dir, name), 'utf8')).join('\n')
    expect(code).toMatch(/commandId:\s*newUuid\(\)/)
  })
})
