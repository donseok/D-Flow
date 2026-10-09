// 팀의 런타임 원천은 요청 범위 하나(src/lib/teams/source.ts)다 — SP4 B(스펙 §6.1 teams-source, D19·D36). 옛 프로세스 전역 캐시 모듈은
// 지워졌고 되살아나지 않는다. 지운 전역 접근자 이름과 '전부를 여는 뷰'의 규칙은 옛 teams-scope(SP2 Task 16b)에서 옮겼다.
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const CWD = process.cwd()
/** 옛 모듈 경로 — 이 파일 자신이 스펙 §7 B 의 grep 0건 검사에 걸리지 않게 조각으로 만든다 */
const OLD_MODULE = ['teams', 'master'].join('/')
const OLD_REF = new RegExp(`['"\`][^'"\`]*\\b${OLD_MODULE.replace('/', '\\/')}\\b`)
export const SOURCE_EXPORTS: readonly string[] = ['TeamsUnavailableError', 'projectOwnTeams', 'projectTeams', 'teamCodesVisibleTo', 'visibleTeamIdsMatching', 'visibleTeams', 'workspaceTeams']
const REMOVED = ['teamsSync', 'activeTeamCodesSync', 'isRegisteredTeamCode', 'isActiveTeamCode', 'refreshTeams', 'activeTeamsForWorkspaces'] as const
const CALL = new RegExp(`\\b(?:${REMOVED.join('|')})\\s*\\(`)
/** 전 워크스페이스 가시 범위({ all: true })를 만들 수 있는 유일한 파일 — 플랫폼 관리자 판정(teamViewOfScope) */
const ALL_VIEW_OWNER = 'src/lib/domain/authz.ts'
const ALL_VIEW = /\ball\s*:\s*true\b/
/** walk 의 기본 확장자(.ts/.tsx)는 scripts 의 .mjs 를 미리 걸러 버린다 — 확장자를 walk 에 넘긴다(B-1 리뷰 F1) */
const codeFiles = (dir: string) => walk(join(CWD, dir), undefined, /\.(ts|tsx|mjs)$/)
const hits = (files: string[], re: RegExp) => files.flatMap((f) => codeLines(readFileSync(f, 'utf8'), f)
  .flatMap((l, i) => (re.test(l) ? [`${relative(CWD, f)}:${i + 1}: ${l.trim()}`] : [])))

describe('팀 원천 — 요청 범위 하나(SP4 B)', () => {
  it('옛 캐시 모듈 파일이 없다', () => {
    expect(existsSync(join(CWD, 'src/lib', `${OLD_MODULE}.ts`))).toBe(false)
  })
  it('src·tests·scripts 의 코드 줄이 옛 캐시 모듈을 가리키지 않는다(import·vi.mock·경로 문자열)', () => {
    expect(hits(['src', 'tests', 'scripts'].flatMap(codeFiles), OLD_REF)).toEqual([])
  }, 20_000)
  it('원천 모듈의 export = SOURCE_EXPORTS — 접근자를 늘리면 여기서 본다(여러 워크스페이스 접근자는 만들지 않는다 — Q23)', () => {
    const code = readFileSync(join(CWD, 'src/lib/teams/source.ts'), 'utf8')
    const names = [...code.matchAll(/^export\s+(?:async\s+)?(?:function|class|const)\s+(\w+)/gm)].map((m) => m[1]).sort()
    expect(names).toEqual([...SOURCE_EXPORTS].sort())
    // 위 정규식이 세지 못하는 꼴(export { a } · export { a as b } from)으로 접근자를 늘리지 않는다(B-1 리뷰 P3)
    expect(code.match(/^export\s*\{.*/gm) ?? []).toEqual([])
  })
  it('지운 접근자·캐시 갱신 이름을 src 가 부르지 않는다(주석 제외)', () => {
    expect(hits(codeFiles('src'), CALL)).toEqual([])
  }, 20_000)
  it(`전 워크스페이스 가시 범위({ all: true })는 ${ALL_VIEW_OWNER} 에서만 만든다`, () => {
    expect(hits(codeFiles('src'), ALL_VIEW).filter((h) => !h.startsWith(`${ALL_VIEW_OWNER}:`))).toEqual([])
    expect(hits([join(CWD, ALL_VIEW_OWNER)], ALL_VIEW).length).toBeGreaterThan(0)
  }, 20_000)
  it('판정기 표본', () => {
    expect(OLD_REF.test(`import { x } from '@/lib/${OLD_MODULE}'`)).toBe(true)
    expect(OLD_REF.test(`vi.mock('@/lib/${OLD_MODULE}', () => ({}))`)).toBe(true)
    expect(OLD_REF.test(`import { x } from '@/lib/teams/source'`)).toBe(false)
    expect(CALL.test('await refreshTeams()')).toBe(true)
    expect(CALL.test('teamsForWorkspaceSync(w)')).toBe(false)
    expect(ALL_VIEW.test('view = isSuperuser ? { all: true } : x')).toBe(true)
    expect(ALL_VIEW.test('{ overall: trueish }')).toBe(false)
    // scripts 는 거의 .mjs 다 — 목록이 그것을 실제로 담아야 scripts 검사가 선다(B-1 리뷰 F1)
    expect(codeFiles('scripts').some((f) => f.endsWith('.mjs'))).toBe(true)
  })
})
