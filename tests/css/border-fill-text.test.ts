// 경계 토큰을 채움으로 쓰고 그 위에 글자를 얹지 않는다(UI-1 최종 리뷰 N1). contrast-tokens 의 DECORATIVE 가 border(= 옛 line·grid)를
// '장식 구분선 전용'으로 쌍 표에서 빼 주므로, 그 위 글자 대비는 아무 표도 보증하지 않는다 — 실제로 `bg-line text-ink-subtle` 은
// 라이트 3.97·다크 4.19 로 4.5 미달이었다(이슈 칩·만료 공지 칩·이슈 모달 칩·WBS 접힌 행 수 배지 6곳).
// 줄 단위로 본다: 변형 없는 bg-<경계 토큰>(`/70` 같은 불투명도 접미 포함)과 변형 없는 text-* 가 한 줄이면 실패. 글자 없는 막대·구분선·
// 스켈레톤은 text- 가 없어 걸리지 않고, hover:bg-line hover:text-ink 같은 상태 채움(아이콘 버튼)은 대상 밖이다.
// 여러 줄 className 의 다른 줄에 나뉘면 못 잡는다(2026-10 현재 src 에 그런 곳 0).
import { describe, expect, it } from 'vitest'
import { srcFiles } from './lib/cssTokens'

const BORDER_FILL = /(?<![\w:/-])bg-(?:line|line-strong|grid|grid-strong|border|border-input|border-focus|hero-line)(?![\w-])/
const TEXT = /(?<![\w:/-])text-[a-z[(]/
/** 파일 → [허용 줄 수, 사유] — 비어 있어야 정상. 늘리려면 사유와 함께 */
const ALLOW: Record<string, [number, string]> = {}

export function borderFillTextLines(text: string): number[] {
  return text.split('\n').flatMap((l, i) => (BORDER_FILL.test(l) && TEXT.test(l) ? [i + 1] : []))
}

describe('경계 토큰 채움 위 글자 0(N1)', () => {
  const hits = new Map<string, number[]>()
  for (const [f, t] of srcFiles(/\.tsx?$/)) {
    const lines = borderFillTextLines(t)
    if (lines.length) hits.set(f, lines)
  }
  it('허용 목록 밖에서 0줄', () => {
    expect([...hits].filter(([f, ls]) => !(f in ALLOW) || ls.length > ALLOW[f][0]).map(([f, ls]) => `${f}:${ls.join(',')}`)).toEqual([])
    expect(Object.keys(ALLOW).filter((f) => !hits.has(f)), '0이 된 파일은 목록에서 뺀다').toEqual([])
  })
  it('판정기가 살아 있다 — 모양별 표본', () => {
    expect(borderFillTextLines("chip: 'bg-line text-ink-subtle'")).toEqual([1])
    expect(borderFillTextLines('className="ml-1.5 rounded-full bg-border px-1.5 text-fg-muted"')).toEqual([1])
    expect(borderFillTextLines('className="text-ink-subtle hover:bg-line hover:text-ink"')).toEqual([])
    expect(borderFillTextLines('className="h-1 w-full rounded-full bg-line"')).toEqual([])
    expect(borderFillTextLines('className="bg-line-strong/60 h-px"')).toEqual([])
    expect(borderFillTextLines("chip: 'bg-neutral-weak text-neutral'")).toEqual([])
  })
})

describe('중립 칩의 대체 쌍은 대비 표가 보증한다(N1)', () => {
  // 6곳이 옮겨 간 쌍 — neutral 글자 on neutral-weak(라이트·다크 ≥ 4.5 는 contrast-tokens 의 'N1 중립 칩' 단언).
  // 이슈 모달의 둘은 상자가 bg-surface-2(= surface-subtle = neutral-weak 와 같은 값)라 neutral-weak 칩은 모양이 사라진다 — neutral on surface.
  // WBS 접힌 행 수 배지도 1단계 행이 surface-subtle 이라 같은 이유로 neutral on surface + 장식 링(ring-border — 글자 아님)
  const SITES: [string, RegExp][] = [
    ['src/lib/domain/issues.ts', /on_hold:[^\n]*chip: 'bg-neutral-weak text-neutral'/],
    // 심각도 '낮음'의 칩은 B4 부터 설정 어휘의 색 토큰(neutral) — 그 토큰의 클래스 쌍
    ['src/lib/settings/vocab.ts', /neutral: \{[^\n]*chip: 'bg-neutral-weak text-neutral'/],
    ['src/lib/domain/announcements.ts', /expired:[^\n]*chip: 'bg-neutral-weak text-neutral'/],
    ['src/components/issues/IssueModals.tsx', /chip bg-surface text-neutral/],
    ['src/components/wbs/WbsGanttSheet.tsx', /rounded-full bg-surface px-1\.5 py-px tabular-nums text-neutral ring-1 ring-inset ring-border/],
  ]
  const files = new Map(srcFiles(/\.tsx?$/))
  it.each(SITES)('%s 가 중립 쌍을 쓴다 (%s)', (f, re) => { expect(files.get(f) ?? '').toMatch(re) })
  it('IssueModals 는 두 곳 모두', () => {
    expect((files.get('src/components/issues/IssueModals.tsx') ?? '').match(/chip bg-surface text-neutral/g)?.length).toBe(2)
  })
})
