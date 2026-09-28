import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
const src = (p: string) => readFileSync(p, 'utf8')
const sig = (text: string, name: string) => {
  const m = text.match(new RegExp(`export (?:async )?function ${name}\\([^)]*\\)[^{]*`))
  return m?.[0].replace(/\s+/g, ' ').trim()
}
describe('가드 시그니처 동결(결정 8)', () => {
  const guards = src('src/lib/authz/index.ts'), pure = src('src/lib/domain/authz.ts')
  it.each([
    ['requireSuperuser', 'export async function requireSuperuser(): Promise<GuardResult>'],
    ['requireProjectAdmin', 'export async function requireProjectAdmin(projectId: string | null): Promise<GuardResult>'],
    ['requireProjectMember', 'export async function requireProjectMember(projectId: string | null): Promise<GuardResult>'],
    ['requireWorkspaceAdmin', 'export async function requireWorkspaceAdmin(workspaceId: string | null): Promise<GuardResult>'],
    ['resolveScope', 'export async function resolveScope(table: ProjectScopedTable, id: string): Promise<ScopeResult>'],
  ])('%s', (name, expected) => { expect(sig(guards, name)).toBe(expected) })
  it('roleIn', () => {
    expect(sig(pure, 'roleIn')).toBe('export function roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null')
  })
  // D10 — requireModule 은 가드 모듈 밖(src/lib/modules/gate.ts)에 산다. 반환형은 이름 있는 별칭(정규식이 반환형의 '{' 에서 끊긴다).
  it('requireModule(관문 — 가드가 아니다, E18)', () => {
    expect(sig(src('src/lib/modules/gate.ts'), 'requireModule'))
      .toBe('export async function requireModule(scope: ModuleScope, moduleId: ModuleId | readonly ModuleId[], opts?: { client?: ConfigReadClient }): Promise<ModuleGateResult>')
  })
})
