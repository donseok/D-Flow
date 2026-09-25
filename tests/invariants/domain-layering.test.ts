import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// 순수 계층(src/lib/domain)은 앱 계층(src/app — 서버 액션·라우트)에 의존하지 않는다. 타입만 가져와도 방향이 뒤집힌다 —
// 입력 계약은 도메인이 정본이고 액션이 재수출한다(예: RosterInput).
const ROOT = join(process.cwd(), 'src/lib/domain')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe('도메인 계층 의존 방향', () => {
  it("src/lib/domain 은 '@/app/' 을 import 하지 않는다", () => {
    const hits = walk(ROOT).flatMap(f => readFileSync(f, 'utf8').split('\n')
      .map((line, i) => [line, i] as const)
      .filter(([line]) => /from\s+['"]@\/app\//.test(line))
      .map(([line, i]) => `${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`))
    expect(hits, hits.join('\n')).toEqual([])
  })
})
