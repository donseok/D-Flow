import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(process.cwd(), 'src')
const SKIP_DIRS = new Set(['node_modules', '.next'])

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

const LEGACY_IDENT = /\b(memberships|project_roles|project_member_identities|effectiveLegacyRole|getMembership|current_team|update_project_member_with_identity)\b/
const LEGACY_ROLE_LITERAL = /'(pmo_admin|team_editor|contributor)'/

function findHits(files: string[], re: RegExp): string[] {
  const hits: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`)
    })
  }
  return hits
}

describe('옛 조직 모델 0건(결정 8) — src 전체(주석·i18n 사전 포함)', () => {
  const files = walk(ROOT)

  it('레거시 식별자(memberships/project_roles/project_member_identities/effectiveLegacyRole/getMembership/current_team/update_project_member_with_identity) 0건', () => {
    const hits = findHits(files, LEGACY_IDENT)
    expect(hits, `레거시 식별자 잔존:\n${hits.join('\n')}`).toEqual([])
  })

  it("옛 역할 문자열('pmo_admin'/'team_editor'/'contributor') 0건", () => {
    const hits = findHits(files, LEGACY_ROLE_LITERAL)
    expect(hits, `옛 역할 문자열 잔존:\n${hits.join('\n')}`).toEqual([])
  })
})
