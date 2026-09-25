import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(process.cwd(), 'src')
const SKIP_DIRS = new Set(['node_modules', '.next'])
const ALLOWED_DELETE_FILE = join(process.cwd(), 'src/app/actions/roster.ts')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

// 따옴표(single/double/backtick)·괄호 안 공백·`as const` 무관 — 리뷰 conformance-1/strength-2:
// from("project_members")·from(`project_members`)·from( 'project_members' )·
// from('project_members' as const) 도 전부 잡아낸다.
function findChainHits(files: string[], verb: 'insert' | 'update' | 'upsert' | 'delete'): string[] {
  const re = new RegExp(`from\\(\\s*(['"\`])project_members\\1(?:\\s+as\\s+const)?\\s*\\)[\\s\\S]{0,200}?\\.${verb}\\(`, 'g')
  const hits: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    re.lastIndex = 0
    while ((m = re.exec(text))) {
      const line = text.slice(0, m.index).split('\n').length
      hits.push(`${relative(process.cwd(), file)}:${line}: .${verb}(`)
    }
  }
  return hits
}

describe('명단(project_members) 직접 쓰기 0건 — RPC 가 유일한 쓰기 경로', () => {
  const files = walk(ROOT)

  it("from('project_members') 체인에 .insert(/.update(/.upsert( 0건", () => {
    const hits = (['insert', 'update', 'upsert'] as const).flatMap((v) => findChainHits(files, v))
    expect(hits, `project_members 직접 쓰기 잔존:\n${hits.join('\n')}`).toEqual([])
  })

  it("from('project_members') 체인의 .delete( 는 src/app/actions/roster.ts 1곳만 허용", () => {
    const hits = findChainHits(
      files.filter((f) => f !== ALLOWED_DELETE_FILE),
      'delete',
    )
    expect(hits, `roster.ts 밖 project_members 삭제 잔존:\n${hits.join('\n')}`).toEqual([])
  })

  it('옛 조직 테이블(memberships/project_roles/project_member_identities) 참조 0건', () => {
    const patterns: Array<[string, RegExp]> = [
      ["from('memberships')", /from\(\s*(['"`])memberships\1\s*\)/],
      ["from('project_roles')", /from\(\s*(['"`])project_roles\1\s*\)/],
      ["from('project_member_identities')", /from\(\s*(['"`])project_member_identities\1\s*\)/],
    ]
    const hits: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')
      for (const [label, re] of patterns) {
        lines.forEach((line, i) => {
          if (re.test(line)) hits.push(`${relative(process.cwd(), file)}:${i + 1}: ${label}`)
        })
      }
    }
    expect(hits, `옛 조직 테이블 참조 잔존:\n${hits.join('\n')}`).toEqual([])
  })
})
