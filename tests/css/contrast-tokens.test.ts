// 의미 토큰 대비(개정 §5.5.3·§5.5.4, SP3b 스펙 §8.1 · E15 · D12 · 계획 판정 Q13) — 라이트 토큰을 파싱하고 var() 를 풀어 계산한다(제품이 라이트 전용이다).
// 쌍 목록은 닫힌 표다: 새 의미 색 토큰은 쌍에 들거나 DECORATIVE 에 사유와 함께 든다(메타 단언). 대비 식은 accent.ts 의 contrastRatio 하나.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/lib/settings/accent'
import { ACCENT_TOKENS } from '@/lib/settings/accentTokens'
import { resolver, semanticNames } from './lib/cssTokens'

const { maps, resolve } = resolver()
const TEXT = 4.5
const NON_TEXT = 3
type Pair = readonly [fg: string, bg: string, min: number, source: string]
const on = (fg: string, bgs: string[], min: number, source: string): Pair[] => bgs.map((bg) => [fg, bg, min, source] as const)

export const PAIRS: Pair[] = [
  ...on('fg', ['surface', 'canvas', 'surface-subtle', 'surface-raised', 'surface-selected', 'surface-hover', 'surface-zebra', 'weekend', 'holiday-band'], TEXT, '개정 §5.5.3'),
  ...on('fg-secondary', ['surface', 'canvas', 'surface-subtle', 'surface-raised', 'surface-hover', 'surface-zebra'], TEXT, '개정 §5.5.3'),
  ...on('fg-muted', ['surface', 'canvas', 'surface-subtle', 'surface-raised', 'surface-selected', 'surface-hover', 'surface-disabled', 'surface-zebra', 'weekend', 'holiday-band'], TEXT, '개정 §5.5.3·§5.5.4'),
  ...on('action', ['surface', 'canvas', 'surface-subtle', 'surface-selected'], TEXT, '개정 §5.5.3 링크'),
  ...on('border-input', ['surface', 'canvas', 'surface-subtle'], NON_TEXT, '개정 §5.5.3 입력 경계'),
  ...on('border-focus', ['surface', 'canvas', 'surface-subtle', 'surface-selected', 'surface-raised'], NON_TEXT, '개정 §5.5.3 포커스'),
  ...on('action-fg', ['action', 'action-hover', 'action-pressed'], TEXT, '개정 §5.5.3 주 버튼'),
  ...['success', 'warning', 'danger', 'progress', 'pending', 'neutral'].flatMap((s) => on(s, ['surface', 'canvas', `${s}-weak`], TEXT, '개정 §5.5.4 상태')),
  ...['success', 'warning', 'danger', 'progress', 'pending', 'today', 'phasebar', 'critical'].map((s) => [`${s}-fg`, s, TEXT, 'D12·판정 Q13 채움 전경'] as const),
  ...Array.from({ length: 8 }, (_, i) => i + 1).flatMap((n) => [
    [`category-${n}`, 'surface', TEXT, '개정 §5.5.4 범주'] as const,
    [`category-${n}`, `category-${n}-weak`, TEXT, 'D12·판정 Q13 범주 칩'] as const,
    ['category-fg', `category-${n}`, TEXT, '판정 Q13 범주 막대 글자'] as const,
  ]),
  // 조회 실패 알림(LoadErrorNotice — bg-delayed-weak + text-ink)·상태 알림 문구(U1a 리뷰 R3 P3 — 옛 표의 ink/delayed-weak 복원)
  ...on('fg', ['success-weak', 'warning-weak', 'danger-weak', 'progress-weak'], TEXT, '옛 대비 표·LoadErrorNotice'),
  ['critical', 'critical-weak', TEXT, 'D12·판정 Q13'],
  ['critical', 'surface', TEXT, '개정 §5.5.4'],
  ...on('today', ['surface', 'weekend', 'holiday-band'], NON_TEXT, '개정 §5.5.4 오늘 선'),
  ['phasebar', 'surface', NON_TEXT, '개정 §5.5.4'],
  ['phasebar-fill', 'phasebar', NON_TEXT, 'D12·판정 Q13 — 채움은 phasebar 위(스펙 §8.1 의 plan-track 정정)'],
  ['action', 'plan-track', NON_TEXT, '개정 §5.5.4 진척 막대'],
]

/** 쌍에 들지 않는 의미 색 토큰 — 사유와 함께 닫는다 */
export const DECORATIVE: Record<string, string> = {
  'fg-disabled': '조작 불가 글자 — WCAG 예외(개정 §5.5.3). 사유 설명은 fg-secondary',
  border: '장식 구분선 전용(개정 §5.5.3)',
  'action-soft': '선택 탭 배경 = surface-selected 와 같은 값(개정 §5.5.3)',
}

describe('의미 토큰 대비(스펙 §8.1 ⑤)', () => {
  it.each(PAIRS.map((p) => [...p]))('%s / %s ≥ %s (%s)', (fg, bg, min) => {
    expect(contrastRatio(resolve(fg as string), resolve(bg as string))).toBeGreaterThanOrEqual(min as number)
  })
})

describe('N1 중립 칩 — 옛 bg-line text-ink-subtle(경계 채움 위 fg-muted) 6곳의 대체 쌍', () => {
  // 경계(border)는 DECORATIVE 라 그 위 글자는 쌍 표가 보증하지 않는다(3.97 이었다). 대체 쌍은 neutral on neutral-weak,
  // surface-subtle 상자 안의 칩(이슈 모달 둘)은 neutral on surface(neutral-weak 는 surface-subtle 과 같은 값이라 칩 모양이 사라진다).
  const N1: [string, string][] = [['neutral', 'neutral-weak'], ['neutral', 'surface']]
  it.each(N1)('쌍 표에 %s / %s(TEXT)가 있다', (fg, bg) => {
    expect(PAIRS.some(([f, b, min]) => f === fg && b === bg && min === TEXT)).toBe(true)
  })
  it.each(N1)('%s on %s ≥ 4.5', (fg, bg) => {
    expect(contrastRatio(resolve(fg), resolve(bg))).toBeGreaterThanOrEqual(TEXT)
  })
})

describe('메타 단언', () => {
  const names = semanticNames(maps)
  it('모든 의미 색 토큰은 쌍에 들거나 DECORATIVE 에 있다(닫힌 표)', () => {
    const used = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]))
    expect(names.filter((n) => !used.has(n) && !(n in DECORATIVE))).toEqual([])
    expect(Object.keys(DECORATIVE).filter((n) => !names.includes(n))).toEqual([])
  })
  it('쌍의 토큰은 모두 의미 토큰이다(옛 이름·원색을 쌍에 쓰지 않는다)', () => {
    expect([...new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]))].filter((n) => !names.includes(n))).toEqual([])
  })
  it('accentTokens.ts(A) 기준 색 = globals.css 의미 토큰 값', () => {
    for (const [k, hex] of Object.entries(ACCENT_TOKENS.light)) expect(resolve(k), k).toBe(hex)
  })
  it('의미 층(@theme)의 값은 원색 var(--p-*) 또는 hex 다 — 다른 의미 토큰을 가리키지 않는다', () => {
    expect(maps.theme.filter((d) => d.name.startsWith('--color-') && !/^(var\(--p-[\w-]+\)|#[0-9A-Fa-f]{6})$/.test(d.value))).toEqual([])
  })
})

describe('예전 회귀 단언(유지)', () => {
  it('로그인 화면에 옛 보조 글자 하드코딩(#7a6f68)이 없다', () => {
    expect(readFileSync(join(process.cwd(), 'src/app/login/page.tsx'), 'utf8')).not.toMatch(/#7a6f68/i)
  })
  it('간트 주말·휴일 날짜 라벨은 반투명 위험색을 쓰지 않는다', () => {
    expect(readFileSync(join(process.cwd(), 'src/components/wbs/WbsGanttSheet.tsx'), 'utf8')).not.toContain('text-danger/70')
  })
})
