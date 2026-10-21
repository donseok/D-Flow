import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 회의록 목록의 글머리 기호(점·번호)가 목록 상자 밖으로 나가지 않아야 한다.
 * 목록 상자 가장자리에는 hover 테두리([data-mblock]:hover outline)와 마킹·이슈·WBS 좌측 선이 그려진다.
 *
 * 1) 마킹은 루트 블록 단위라 목록이면 <ul>/<ol> 전체에 data-ins / data-issue-count / data-wbs-count 가 붙는다.
 *    `.minutes-md [data-ins]` 의 padding-left(0.6em)는 `.minutes-md ul` 보다 특이성이 높아 목록
 *    들여쓰기를 덮고, 바깥쪽(outside) 기호가 3px 좌측 선 위에 얹혔다(2026-09-10 제보).
 * 2) 번호 폭은 자릿수마다 늘어난다(Pretendard 16px 실측 "9. " 1.093em · "35. " 1.692em ·
 *    "135. " 2.131em). 한 자리 기준 들여쓰기(1.45em)에 두 자리 번호가 hover 테두리 밖으로
 *    튀어나왔다(2026-09-10 제보). 번호 목록은 자릿수(--ol-digits, MarkdownView 가 넣는다)만큼 민다.
 */

const root = fileURLToPath(new URL('../..', import.meta.url))
const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8')

/** 선택자가 정확히 일치하는 규칙의 선언부. */
function declarationsOf(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? null
}

function declOf(selector: string, prop: string): string | null {
  const escaped = prop.replace(/[-]/g, '\\-')
  return declarationsOf(selector)?.match(new RegExp(`(?:^|[;\\s])${escaped}:\\s*([^;]+);`))?.[1].trim() ?? null
}

/** 실측 번호 폭 증가량(2자리 − 1자리) — 자릿수당 여백이 이보다 작으면 두 자리부터 다시 튀어나온다. */
const MARKER_GROWTH_PER_DIGIT_EM = 1.692 - 1.093

describe('회의록 목록 들여쓰기', () => {
  const baseIndent = declOf('.minutes-md ul', '--list-indent')
  const markIndent = declOf('.minutes-md [data-ins]', 'padding-left')

  it('글머리 목록은 기본 들여쓰기를 --list-indent 로 둔다', () => {
    expect(baseIndent).toBe('1.45em')
    expect(declOf('.minutes-md ul', 'padding-left')).toBe('var(--list-indent)')
  })

  it('번호 목록은 자릿수만큼 들여쓰기를 늘린다 — 번호가 hover 테두리 밖으로 튀어나오지 않게', () => {
    const olIndent = declOf('.minutes-md ol', '--list-indent')
    expect(declOf('.minutes-md ol', 'padding-left')).toBe('var(--list-indent)')
    const m = olIndent?.match(/^calc\(([\d.]+em) \+ \(var\(--ol-digits, 1\) - 1\) \* ([\d.]+)em\)$/)
    expect(m, `ol --list-indent: ${olIndent}`).not.toBeNull()
    expect(m![1]).toBe(baseIndent)  // 한 자리 목록은 글머리 목록과 같은 들여쓰기
    expect(Number(m![2])).toBeGreaterThanOrEqual(MARKER_GROWTH_PER_DIGIT_EM)
  })

  it('마킹·이슈·WBS 연결된 목록은 목록 들여쓰기 + 마킹 여백만큼 민다 — 기호가 좌측 선에 얹히지 않게', () => {
    expect(markIndent).toBe('0.6em')
    expect(declOf('.minutes-md :is(ul, ol):is([data-ins], [data-issue-count], [data-wbs-count])', 'padding-left'))
      .toBe(`calc(var(--list-indent) + ${markIndent})`)
    // WBS 선은 이슈 블록을 비켜 간다 — :where 라 특이성이 이슈 규칙과 같아 위 목록 특례가 이긴다. 여백이 마킹과 같아야 위 calc 가 맞는다.
    expect(declOf('.minutes-md [data-wbs-count]:where(:not([data-issue-count]))', 'padding-left')).toBe(markIndent)
    // 이슈와 WBS 가 함께 걸린 블록은 ::before 가 하나뿐이라 이슈 배지 하나에 두 수를 함께 적는다
    expect(declOf('.minutes-md [data-issue-count][data-wbs-count]::before', 'content'))
      .toBe("'⚑ ' attr(data-issue-count) ' · ▤ ' attr(data-wbs-count)")
  })
})

describe('회의록 문단 배지·선 — 첫 줄을 가리지 않고 선은 하나', () => {
  it('배지(-top-2 = 0.5rem 위로 걸친다)가 달리는 블록은 그만큼 첫 줄을 내린다 — :where 라 pre·머메이드처럼 제 여백이 더 큰 블록은 제 값이 이긴다', () => {
    for (const badge of ['.minutes-md [data-hl-count]::after', '.minutes-md [data-issue-count]::before', '.minutes-md [data-wbs-count]:where(:not([data-issue-count]))::before']) {
      expect(declarationsOf(badge), badge).toMatch(/\babsolute -top-2 right-1\b/)
    }
    expect(declOf('.minutes-md :where([data-hl-count], [data-issue-count], [data-wbs-count])', 'padding-top')).toBe('0.5rem')
    expect(declOf('.minutes-md pre', 'padding')).toBe('0.85em')
  })

  it('등록된(WBS) AI 마킹 블록은 선이 하나 — 마킹 선을 초록으로 바꾸고 안쪽 초록 선을 끈다. 이슈가 걸리면 이슈 꼴(파랑) 그대로', () => {
    const both = '.minutes-md [data-wbs-count]:where([data-ins]:not([data-issue-count]))'
    expect(declOf(both, 'border-left-color')).toBe('var(--color-success)')
    expect(declOf(both, 'box-shadow')).toBe('none')
    // 인용문은 마킹 색 규칙(blockquote[data-ins=…])이 한 단계 높아 따로 둔다
    expect(declOf('.minutes-md blockquote[data-wbs-count]:where([data-ins]:not([data-issue-count]))', 'border-left-color')).toBe('var(--color-success)')
    // 이 규칙들은 임시 선택 표시(안쪽 파란 선)보다 앞에 있다 — 같은 특이성이라 선택 중 표시가 이긴다
    expect(css.indexOf(both)).toBeLessThan(css.indexOf(".minutes-md [data-active-selection='true']"))
    expect(declOf('.minutes-md [data-issue-count]', 'box-shadow')).toBe('inset 3px 0 var(--color-progress)')
  })
})
