import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')

const LEGACY_IDENT = /\b(memberships|project_roles|project_member_identities|effectiveLegacyRole|getMembership|current_team|update_project_member_with_identity|app_role)\b/
// 단어 경계만 요구 — 따옴표 종류(single/double/backtick)에 무관하게 잡는다. 리뷰
// conformance-2/strength-1: 옛 역할 값이 JSX 속성처럼 큰따옴표로 다시 등장해도
// (0e0ceaf 의 <option value="contributor"> 사례) 잡아낸다. 대소문자 구분·\b 경계라
// roleContributor 같은 camelCase 식별자는(경계가 없어) 걸리지 않는다 — HEAD 에서 확인됨.
// app_role 은 0006 에서 폐기된 옛 전역 역할 함수(스코프 없는 "어느 프로젝트든 역할" 판정) — SP2 스펙 결정 8.
const LEGACY_ROLE_LITERAL = /\b(pmo_admin|team_editor|contributor)\b/

function findHits(files: string[], re: RegExp): string[] {
  const hits: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (re.test(line)) hits.push(`${relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`)
    })
  }
  return hits
}

describe('옛 조직 모델 0건(결정 8) — src 전체(주석·i18n 사전 포함)', () => {
  const files = walk(ROOT)

  it('레거시 식별자(memberships/project_roles/project_member_identities/effectiveLegacyRole/getMembership/current_team/update_project_member_with_identity/app_role) 0건', () => {
    const hits = findHits(files, LEGACY_IDENT)
    expect(hits, `레거시 식별자 잔존:\n${hits.join('\n')}`).toEqual([])
  })

  it("옛 역할 문자열('pmo_admin'/'team_editor'/'contributor') 0건", () => {
    const hits = findHits(files, LEGACY_ROLE_LITERAL)
    expect(hits, `옛 역할 문자열 잔존:\n${hits.join('\n')}`).toEqual([])
  })
})
