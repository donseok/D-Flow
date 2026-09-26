import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const SKILLS = join(process.cwd(), '.claude/skills')

const LEGACY_IDENT = /\b(memberships|project_roles|project_member_identities|effectiveLegacyRole|getMembership|current_team|update_project_member_with_identity|app_role)\b/
// 단어 경계만 요구 — 따옴표 종류(single/double/backtick)에 무관하게 잡는다. 리뷰
// conformance-2/strength-1: 옛 역할 값이 JSX 속성처럼 큰따옴표로 다시 등장해도
// (0e0ceaf 의 <option value="contributor"> 사례) 잡아낸다. 대소문자 구분·\b 경계라
// roleContributor 같은 camelCase 식별자는(경계가 없어) 걸리지 않는다 — HEAD 에서 확인됨.
// app_role 은 0006 에서 폐기된 옛 전역 역할 함수(스코프 없는 "어느 프로젝트든 역할" 판정) — SP2 스펙 결정 8.
const LEGACY_ROLE_LITERAL = /\b(pmo_admin|team_editor|contributor)\b/
// 역할 표현만 막는다 — 'PMO' 단어 자체(팀 코드·주간 구분명·테스트 픽스처)는 정당한 데이터라 금지하지 않는다.
// 권한 주체는 프로젝트 관리자·워크스페이스 관리자인데 'PMO 관리자 전용'·'(PMO)' 같은 문구가 원본 조직을 전제했다(DC-09).
const PMO_ROLE_PHRASE = /PMO ?(관리자|admins?\b|만|전용)|담당 ?팀·PMO|\(PMO\)/

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

  it("역할 표현 'PMO 관리자/만/전용'·'(PMO)' 0건 — 권한은 프로젝트 관리자·워크스페이스 관리자다", () => {
    const hits = findHits(files, PMO_ROLE_PHRASE)
    expect(hits, `PMO 역할 표현 잔존:\n${hits.join('\n')}`).toEqual([])
  })
})

describe('옛 조직 모델 0건 — 스킬 문서', () => {
  // 에이전트가 스킬 문서를 계약으로 읽는다 — 폐기된 표(0003 의 project_roles 등)를 근거로 적으면 그대로 따라 한다.
  // walk() 는 .ts/.tsx 만 모으므로 .md 는 따로 고른다.
  it('스킬 문서(.claude/skills/**/*.md)에도 레거시 식별자 0건', () => {
    const files = (readdirSync(SKILLS, { recursive: true }) as string[])
      .filter((p) => p.endsWith('.md'))
      .map((p) => join(SKILLS, p))
    expect(files.length).toBeGreaterThan(0)
    const hits = findHits(files, LEGACY_IDENT)
    expect(hits, `스킬 문서의 레거시 식별자 잔존:\n${hits.join('\n')}`).toEqual([])
  })
})
