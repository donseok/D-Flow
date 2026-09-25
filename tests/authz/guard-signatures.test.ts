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
  ])('%s', (name, expected) => { expect(sig(guards, name)).toBe(expected) })
  it('roleIn', () => {
    expect(sig(pure, 'roleIn')).toBe('export function roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null')
  })
})
