// 팀 캐시(src/lib/teams/master.ts)는 service_role 로 전 워크스페이스의 팀을 싣는다. 워크스페이스를 가리지 않는 옛 전역
// 접근자(teamsSync·activeTeamCodesSync·isRegisteredTeamCode·isActiveTeamCode)는 다른 워크스페이스의 팀 코드를 레이아웃·AI
// 컨텍스트·검증으로 흘렸다(SP2 Task 16b). 이제 워크스페이스·프로젝트·가시 범위 접근자만 있다 — 되살아나지 않게 막는다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeLines, walk } from './_walk'

const CWD = process.cwd()
const MASTER = join(CWD, 'src/lib/teams/master.ts')
const REMOVED = ['teamsSync', 'activeTeamCodesSync', 'isRegisteredTeamCode', 'isActiveTeamCode'] as const

/** 옛 이름을 부르는 줄 — 이름 앞은 단어 경계라 teamsForWorkspaceSync·isRegisteredTeamCodeForProject 는 걸리지 않는다. */
const CALL = new RegExp(`\\b(?:${REMOVED.join('|')})\\s*\\(`)
const callHits = (lines: string[]) => lines.flatMap((line, i) => (CALL.test(line) ? [i] : []))

/** master 가 그 이름을 내보내는가 — export function/const 와 export { … } 두 모양. */
function exportsName(code: string, name: string): boolean {
  return new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function\\s*\\*?|const|let|var)\\s*${name}\\b`).test(code)
    || [...code.matchAll(/\bexport\s*\{([^}]*)\}/g)].some(m => m[1].split(',').some(part => part.trim().split(/\s+as\s+/).pop() === name))
}

describe('팀 캐시 — 워크스페이스를 가리지 않는 전역 접근자 금지(SP2 Task 16b)', () => {
  it('src 어디에서도 옛 전역 접근자를 부르지 않는다(주석 제외)', () => {
    const hits = walk(join(CWD, 'src')).flatMap(f => {
      const lines = codeLines(readFileSync(f, 'utf8'))
      return callHits(lines).map(i => `${relative(CWD, f)}:${i + 1}: ${lines[i].trim()}`)
    })
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('master.ts 는 그 이름들을 export 하지 않는다', () => {
    const code = codeLines(readFileSync(MASTER, 'utf8')).join('\n')
    expect(REMOVED.filter(name => exportsName(code, name))).toEqual([])
  })

  it('판정기 — 주석 속 이름과 비슷한 새 이름은 세지 않고, 호출·export 는 센다', () => {
    const src = (body: string) => codeLines(body)
    expect(callHits(src('// teamsSync() 는 지웠다\n/* activeTeamCodesSync() */'))).toEqual([])
    expect(callHits(src('teamsForWorkspaceSync(w)\nisRegisteredTeamCodeForProject(c, p)\nactiveTeamsForWorkspacesSync(ws)'))).toEqual([])
    expect(callHits(src('const x = teamsSync().filter(t => t.active)'))).toEqual([0])
    expect(callHits(src('if (isActiveTeamCode (code)) ok()'))).toEqual([0])
    expect(exportsName('export function teamsSync(): readonly Team[] {', 'teamsSync')).toBe(true)
    expect(exportsName('export const isActiveTeamCode = (c: string) => true', 'isActiveTeamCode')).toBe(true)
    expect(exportsName('export { teamsForWorkspaceSync, activeTeamCodesSync }', 'activeTeamCodesSync')).toBe(true)
    expect(exportsName('export { internal as isRegisteredTeamCode }', 'isRegisteredTeamCode')).toBe(true)
    expect(exportsName('export function teamsForWorkspaceSync(w: string) {', 'teamsSync')).toBe(false)
  })
})
