// 작업 계획 화면의 색(SP3b 스펙 §4.4, 계획 판정 Q13·Q19) — 고정 hex·흰 글자·반투명 채움이 돌아오지 않게.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const t = readFileSync(join(process.cwd(), 'src/components/wbs/WbsGanttSheet.tsx'), 'utf8')

describe('WbsGanttSheet 색', () => {
  it('임의 hex 클래스가 없다(행 틴트·이정표)', () => { expect(t).not.toMatch(/(?:bg|border|text)-\[#[0-9a-fA-F]{3,8}\]/) })
  it('흰 글자가 없다(오늘 칩·이정표·토스트·막대 라벨)', () => { expect(t).not.toMatch(/(?<![\w-])text-white(?![\w-])/) })
  it('오늘 칩 글자는 12px 이상(개정 §5.5.4)', () => { expect(t).toContain("fontSize: 'max(12px, var(--wbs-day-font, 9px))'") })
  // 이정표 칩도 같은 하한(과제 12 눈확인 — 9px 그대로였다, 원장 CARRY). 칩 높이 = 글자 12 + 위아래 2·2(leading-none) = 16 —
  // 2단(tier 1) 칩의 내림은 그보다 커야 1단 칩과 겹치지 않는다.
  it('이정표 칩 글자는 12px 이상이고 2단 칩은 1단 칩 높이(16) 아래로 내린다', () => {
    const start = t.indexOf('data-wbs-milestone-chip')
    const block = t.slice(start, t.indexOf('</div>', start))
    expect(start).toBeGreaterThan(0)
    expect(block).toContain("fontSize: 'max(12px, var(--wbs-day-font, 9px))'")
    expect(block).toContain('py-0.5')
    expect(block).toContain('leading-none')
    const drop = Number(/calc\(var\(--wbs-head-h\) \+ (\d+)px\)/.exec(block)?.[1] ?? 0)
    expect(drop).toBeGreaterThan(16)
  })
  // 이름·번호 칸은 sticky 라 그 아래로 가로 스크롤된 칸(진척·일자·막대)이 지나간다 — 반투명 배경색이면 비친다(과제 12 눈확인).
  // depth 1 틴트는 불투명 surface 위에 옅은 action-soft 층을 얹는다(라이트 합성 = 옛 #f8faff, 판정 Q19).
  it('행 배경(rowBg)은 불투명 — 배경색에 /NN 알파가 없다', () => {
    const start = t.indexOf('const rowBg =')
    const block = t.slice(start, t.indexOf('const cellBg', start))
    expect(start).toBeGreaterThan(0)
    expect(block).toContain("'bg-surface-subtle'")
    expect(block).toContain('from-action-soft/40')
    expect(block.match(/(?<![\w-])bg-[a-z-]+\/\d+/g) ?? []).toEqual([])
  })
  it('단계 막대 진척 채움은 불투명(phasebar 위 3.0 — 판정 Q13)', () => { expect(t).not.toMatch(/bg-phasebar-fill[^'"`]*opacity-/) })
  // 전체 화면은 AI 버튼(FAB, z 120)과 같은 층이면 문서 순서로 덮인다 — U1a 수정 F3 가 토큰 + 1 로 올렸다(tests/css/fullscreen-layer.test.ts).
  // 과제 24 가 FAB 층을 대응표에 정하면 + 1 이 빠져 z-(--z-fullscreen) 꼴로 돌아온다 — 둘 다 토큰 경유다.
  it('전체 화면 층은 토큰(D56)', () => { expect(t).toMatch(/z-(?:\(--z-fullscreen\)|\[calc\(var\(--z-fullscreen\)_\+_1\)\])/) })
})
