import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accentState, compareMeta, RAIL_REQUIRED_COLS, railVerdict } from '../../scripts/ui-capture.mjs'
import { kanbanBoardRendered, parseE2eSelection } from '../../scripts/lib/e2e-selection.mjs'

describe('UI-3 증거 입력을 실제 상태로 검증한다', () => {
  it('카드·접힘 행은 상태 표지를 요구한다', () => {
    const { routes } = JSON.parse(readFileSync('scripts/ui-capture.routes.json', 'utf8'))
    expect(routes.find((r: { key: string }) => r.key === 'ws-projects-cards').expect).toContain('[data-project-card]')
    expect(routes.find((r: { key: string }) => r.key === 'p-wbs-inspector-collapsed').expect).toContain('[data-side-rail][data-collapsed="true"]')
  })
  it('accent 비교는 중첩 키 순서에 독립적이고 다른 색은 거부한다', () => {
    const a = accentState({ dark: { fg: '#fff', bg: '#000' }, light: { bg: '#eee' } })
    const b = accentState({ light: { bg: '#eee' }, dark: { bg: '#000', fg: '#fff' } })
    expect(a).toBe(b)
    const meta = { accent: a }
    expect(compareMeta(meta, { accent: accentState(null) }).problems).toHaveLength(1)
    expect(compareMeta(meta, { accent: accentState(null) }, { allowCross: true }).warnings).toHaveLength(1)
  })
  it('필수 열은 번호·작업명·담당팀·진척 상태다', () => {
    expect(RAIL_REQUIRED_COLS).toEqual(['no', 'name', 'owners', 'status'])
    const cols = Object.fromEntries(RAIL_REQUIRED_COLS.map(c => [c, true]))
    expect(railVerdict({ mode: 'side', cols, overlap: true })).toEqual({ ok: false, why: 'rail-overlap' })
    expect(railVerdict({ mode: 'overlay', cols, expectedMode: 'side' })).toEqual({ ok: false, why: 'mode:overlay≠side' })
  })
  it('색 행렬 촬영이 실패해도 기본 색 복구를 실행한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'd-flow-accent-proof-'))
    try {
      const bin = join(dir, 'bin'); mkdirSync(bin)
      const log = join(dir, 'calls.txt')
      writeFileSync(join(bin, 'node'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$ACCENT_TEST_LOG"\n[ "$2" != "shoot" ]\n', { mode: 0o755 })
      expect(() => execFileSync('bash', [resolve('scripts/ui-capture-accent-matrix.sh'), 'proof', 'account'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ACCENT_TEST_LOG: log }, stdio: 'pipe' })).toThrow()
      expect(readFileSync(log, 'utf8').trim().split('\n').map(line => line.split(' ').slice(1, 3).join(' '))).toEqual(['accent default', 'shoot --label', 'accent default'])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('E2E 단독 단계 선택', () => {
  it('전체 실행과 명시적인 E3 실행을 구분한다', () => {
    expect(parseE2eSelection([])).toBeNull()
    expect(parseE2eSelection(['--only', 'sp3b-E3'])).toBe('sp3b-E3')
    for (const args of [['sp3b-E3'], ['--only'], ['--only', 'typo'], ['--only', 'sp3b-E3', '--other']]) expect(() => parseE2eSelection(args)).toThrow()
  })
  it('보드 표지는 HTML 속성에서만 인정한다', () => {
    expect(kanbanBoardRendered('<div data-kanban-board="true"></div>')).toBe(true)
    expect(kanbanBoardRendered('<div>data-kanban-board</div>')).toBe(false)
    expect(kanbanBoardRendered('<div data-other="data-kanban-board"></div>')).toBe(false)
  })
})
