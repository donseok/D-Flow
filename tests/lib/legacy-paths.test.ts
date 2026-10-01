import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { LEGACY_PATHS } from '@/lib/nav/legacyPaths'

// SP3b 스펙 §2.4 알림 13 — C(설정 화면)가 새로 만든 옛 정보 구조(IA) 경로는 한 상수로 모은다. UI-2 가 새 경로(/w/<slug>/…)로 바꿀 때
// 한 곳만 고치게. 상수 값이 바뀌면 소비처가 함께 바뀐다 — 소비처에 같은 리터럴이 다시 생기지 않게 원문을 본다.
describe('LEGACY_PATHS — 옛 IA 경로 상수(SP3b 알림 13)', () => {
  it('지금의 옛 경로 둘을 담는다', () => {
    expect(LEGACY_PATHS).toEqual({ projects: '/projects', adminTeams: '/admin/teams' })
    expect(Object.isFrozen(LEGACY_PATHS)).toBe(true)
  })
  it.each([
    'src/app/(app)/w/[slug]/settings/page.tsx',
  ])('%s 는 옛 경로를 리터럴로 쓰지 않고 상수를 쓴다', (file) => {
    const code = readFileSync(file, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//') && !l.includes('{/*')).join('\n')
    expect(code).not.toMatch(/['"`]\/projects['"`]/)
    expect(code).not.toMatch(/['"`]\/admin\/teams['"`]/)
    expect(code).toContain('LEGACY_PATHS')
  })
})
