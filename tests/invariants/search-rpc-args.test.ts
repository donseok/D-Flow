// 검색 RPC 호출부의 인자 이름이 마이그레이션의 최신 시그니처에 있는지 본다.
// 0036 이 match_ai_documents·match_ai_documents_lexical 의 p_include_global 을 없앴는데 호출부 셋이 계속 넘겨 PostgREST 가
// PGRST202(함수 없음)로 거절했다 — 단위 테스트는 rpc 를 모킹해 초록이었다. 이름이 어긋나면 여기서 빨강이 된다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const MIGRATIONS = join(ROOT, 'supabase', 'migrations')
const RPCS = ['match_ai_documents', 'match_ai_documents_lexical'] as const

/** 마이그레이션을 번호 순으로 읽어 마지막 정의의 인자 이름을 돌려준다 */
function latestParams(name: string): string[] {
  let params: string[] | null = null
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8')
    const re = new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\(([\\s\\S]*?)\\)\\s*returns`, 'gi')
    for (const m of sql.matchAll(re)) {
      params = m[1].split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)
    }
  }
  if (!params) throw new Error(`${name} 정의를 마이그레이션에서 찾지 못했다`)
  return params
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry) ? [path] : []
  })
}

/** src 에서 .rpc('<name>', { … }) 의 최상위 키를 모은다 */
function callSites(name: string): Array<{ file: string; keys: string[] }> {
  const out: Array<{ file: string; keys: string[] }> = []
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8')
    const re = new RegExp(`\\.rpc\\(\\s*'${name}'\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, 'g')
    for (const m of text.matchAll(re)) {
      const keys = [...m[1].matchAll(/^\s*([a-z_]+)\s*:/gm)].map((k) => k[1])
      out.push({ file: file.slice(ROOT.length + 1), keys })
    }
  }
  return out
}

// 0042 가 p_workspace_id 를 필수로 만들었다(null·생략이면 AI_SEARCH_WORKSPACE_REQUIRED). 빠뜨린 호출은 런타임에야 터지고 단위 테스트는 rpc 를
// 모킹해 초록이다 — 호출부가 키를 갖는지 여기서 고정한다. p_include_global 도 적게 한다(전역 문서를 넣는지가 호출부에서 읽히게).
const REQUIRED_KEYS = ['p_workspace_id', 'p_project_ids', 'p_include_global'] as const

describe('검색 RPC 호출부 — 워크스페이스 범위 인자를 반드시 넘긴다(0042)', () => {
  for (const name of RPCS) {
    it(`${name}: 최신 시그니처에 범위 인자가 있다`, () => {
      const params = latestParams(name)
      for (const key of REQUIRED_KEYS) expect(params, `${name} 시그니처`).toContain(key)
    })
    it(`${name}: src 의 모든 호출부가 p_workspace_id 를 가진다`, () => {
      const sites = callSites(name)
      expect(sites.length, `${name} 호출부`).toBeGreaterThan(0)
      for (const site of sites) {
        for (const key of REQUIRED_KEYS) expect(site.keys, `${site.file} 에 ${key} 가 없다`).toContain(key)
      }
    })
    it(`${name}: 객체 리터럴이 아닌 인자로 부르는 호출부가 없다(위 검사가 못 보는 모양)`, () => {
      let literal = 0
      let total = 0
      for (const file of sourceFiles(join(ROOT, 'src'))) {
        const text = readFileSync(file, 'utf8')
        total += [...text.matchAll(new RegExp(`\\.rpc\\(\\s*['"\`]${name}['"\`]`, 'g'))].length
        literal += [...text.matchAll(new RegExp(`\\.rpc\\(\\s*'${name}'\\s*,\\s*\\{`, 'g'))].length
      }
      expect(total).toBeGreaterThan(0)
      expect(literal, `${name} — 리터럴 인자 호출 수`).toBe(total)
    })
  }
})

describe('검색 RPC 호출 인자 — 최신 마이그레이션 시그니처와 같은 이름만 쓴다', () => {
  for (const name of RPCS) {
    it(name, () => {
      const params = latestParams(name)
      const sites = callSites(name)
      expect(sites.length, `${name} 호출부`).toBeGreaterThan(0)
      for (const site of sites) {
        expect(site.keys.length, `${site.file} 의 인자`).toBeGreaterThan(0)
        expect(site.keys.filter((k) => !params.includes(k)), `${site.file} 에 시그니처에 없는 인자`).toEqual([])
      }
    })
  }
})
