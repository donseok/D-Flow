// 공용 팀 생성은 한 길(SP5 B2 — D50 ①): create_team RPC(팀 + teams 모드 회의록 루트를 한 트랜잭션으로). 0024 가 세션의 공용 팀 INSERT 정책을
// 지웠고, src 의 `from('teams')` insert·upsert 는 전용 팀(project_id 있음) 경로의 닫힌 파일에서만 한다. create_team 은 공용 팀 액션만 부른다.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse } from './_ast'
import { walk } from './_walk'

const CWD = process.cwd()
/** 전용 팀 insert 의 닫힌 목록 — 파일 → 자리 수와 사유 */
const PROJECT_TEAM_INSERTS: Readonly<Record<string, { count: number; why: string }>> = {
  'src/app/actions/projectTeams.ts': { count: 1, why: 'addProjectTeam — 프로젝트 관리자의 전용 팀 추가(project_id 고정)' },
  'src/lib/teams/register.ts': { count: 1, why: '가져오기·공용 팀 복사의 전용 팀 등록(project_id 고정)' },
}
const CREATE_TEAM_CALLERS: Readonly<Record<string, number>> = { 'src/app/actions/teams.ts': 1 }

function chainFrom(e: ts.Expression): string | null {
  let cur: ts.Expression = e
  for (;;) {
    if (ts.isCallExpression(cur)) {
      if (ts.isPropertyAccessExpression(cur.expression) && cur.expression.name.text === 'from' && cur.arguments[0] && ts.isStringLiteralLike(cur.arguments[0])) return cur.arguments[0].text
      cur = cur.expression
    } else if (ts.isPropertyAccessExpression(cur)) cur = cur.expression
    else return null
  }
}

export function scan(file: string, text: string): { inserts: number; createTeam: number } {
  const sf = parse(file, text)
  let inserts = 0
  let createTeam = 0
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.text
      if ((m === 'insert' || m === 'upsert') && chainFrom(n.expression.expression) === 'teams') inserts++
      if (m === 'rpc' && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && n.arguments[0].text === 'create_team') createTeam++
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { inserts, createTeam }
}

describe('공용 팀 생성 한 길(SP5 B2 — D50)', () => {
  const files = walk(`${CWD}/src`).map((f) => ({ rel: relative(CWD, f), ...scan(relative(CWD, f), readFileSync(f, 'utf8')) }))
  it('teams insert·upsert 는 전용 팀 경로의 닫힌 파일에서만, 자리 수도 같다(죽은 항목 실패)', () => {
    const got = Object.fromEntries(files.filter((f) => f.inserts > 0).map((f) => [f.rel, f.inserts]))
    expect(got).toEqual(Object.fromEntries(Object.entries(PROJECT_TEAM_INSERTS).map(([k, v]) => [k, v.count])))
  }, 30_000)
  it('create_team RPC 는 공용 팀 액션(addTeam)만 부른다', () => {
    expect(Object.fromEntries(files.filter((f) => f.createTeam > 0).map((f) => [f.rel, f.createTeam]))).toEqual(CREATE_TEAM_CALLERS)
  })
  it('판정기 표본', () => {
    expect(scan('a.ts', "admin.from('teams').insert({ code })").inserts).toBe(1)
    expect(scan('a.ts', "admin.from('teams').select('id').eq('x', 1)").inserts).toBe(0)
    expect(scan('a.ts', "admin.from('minute_folders').insert({})").inserts).toBe(0)
    expect(scan('a.ts', "admin.rpc('create_team', {})").createTeam).toBe(1)
  })
})
