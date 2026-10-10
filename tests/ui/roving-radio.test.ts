// 사용자 정의 roving 라디오의 방향키 규칙(APG 라디오 그룹) — 계정 화면의 라디오 그룹이 같은 함수를 쓴다(U1c 리뷰 R1 P3).
// 두 칸짜리 그룹은 ←/↑ 를 +1 로 잘못 해도 결과가 같다 — 세 칸으로 규칙 자체를 고정한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rovingRadioIndex } from '@/components/account/rovingRadio'

describe('rovingRadioIndex', () => {
  it.each([
    ['ArrowRight', 0, 1], ['ArrowDown', 2, 0], ['ArrowLeft', 0, 2], ['ArrowLeft', 2, 1], ['ArrowUp', 1, 0], ['ArrowUp', 0, 2],
    ['Home', 2, 0], ['End', 0, 2],
  ] as const)('%s 를 %i 에서 → %i (세 칸)', (key, i, next) => {
    expect(rovingRadioIndex(key, i, 3)).toBe(next)
  })
  it('그 밖의 키는 null(기본 동작을 막지 않는다)', () => {
    expect(rovingRadioIndex('Tab', 0, 3)).toBeNull()
    expect(rovingRadioIndex(' ', 0, 3)).toBeNull()
  })
  it('테마·시작 화면 그룹이 이 함수를 쓴다(제 손으로 % 를 계산하지 않는다)', () => {
    for (const f of ['src/components/account/ThemeRadioGroup.tsx', 'src/components/account/WorkspacePrefsSection.tsx']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src, f).toContain('rovingRadioIndex(')
      expect(src, f).not.toMatch(/\(i [+-] 1( \+ n)?\) %/)
    }
  })
})
