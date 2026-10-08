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
