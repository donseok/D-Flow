import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'
import {
  splitMinuteBlocks, fnv1a64, isMarkableBlock, minuteBlockDraftText, remarkAnnotateBlocks, type BlockMarks,
} from '@/lib/minutes/blocks'
import { MarkdownView } from '@/components/minutes/MarkdownView'

describe('fnv1a64', () => {
  it('결정적이며 16자리 hex', () => {
    expect(fnv1a64('hello')).toBe(fnv1a64('hello'))
    expect(fnv1a64('hello')).toMatch(/^[0-9a-f]{16}$/)
    expect(fnv1a64('hello')).not.toBe(fnv1a64('hello!'))
  })
  it('빈 문자열도 안정', () => {
    expect(fnv1a64('')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('splitMinuteBlocks', () => {
  it('헤딩/문단/리스트/표/코드를 루트 블록으로 분할하고 headingDepth를 기록', () => {
    const md = [
      '# 제목',
      '',
      '첫 문단입니다.',
      '',
      '- 항목 1\n- 항목 2',
      '',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '',
      '```js\nconsole.log(1)\n```',
    ].join('\n')
    const blocks = splitMinuteBlocks(md)
    expect(blocks).toHaveLength(5)
    expect(blocks[0]).toMatchObject({ index: 0, headingDepth: 1, rendered: true })
    expect(blocks[1].headingDepth).toBeUndefined()
    expect(blocks.map(b => b.index)).toEqual([0, 1, 2, 3, 4])
    // GFM 표가 하나의 블록 (remark-gfm 미적용이면 문단 여러 개로 쪼개져 실패)
    expect(blocks[3].text).toContain('a')
    expect(blocks[3].text).toContain('2')
    expect(minuteBlockDraftText(blocks[2])).toBe('항목 1\n항목 2')
    expect(minuteBlockDraftText(blocks[3])).toBe('a | b\n1 | 2')
  })

  it('목록의 anchor text/hash는 유지하면서 이슈 초안용 항목 경계만 보존한다', () => {
    const block = splitMinuteBlocks([
      '- 주문은 수기로 입력',
      '- 입력 오류와 납기 지연 발생',
      '- 자동 연계 방안 확인 필요',
    ].join('\n'))[0]

    expect(block.text).toBe('주문은 수기로 입력입력 오류와 납기 지연 발생자동 연계 방안 확인 필요')
    expect(block.hash).toBe(fnv1a64(block.text))
    expect(minuteBlockDraftText(block)).toBe([
      '주문은 수기로 입력',
      '입력 오류와 납기 지연 발생',
      '자동 연계 방안 확인 필요',
    ].join('\n'))
  })

  it('인용문과 hard break 문단도 이슈 초안용 문장 경계를 보존한다', () => {
    const blockquote = splitMinuteBlocks([
      '> 주문은 수기로 입력',
      '>',
      '> 입력 오류 발생',
      '>',
      '> 원인 확인 필요',
    ].join('\n'))[0]
    const hardBreak = splitMinuteBlocks([
      '주문은 수기로 입력  ',
      '입력 오류 발생  ',
      '원인 확인 필요',
    ].join('\n'))[0]

    expect(minuteBlockDraftText(blockquote)).toBe('주문은 수기로 입력\n입력 오류 발생\n원인 확인 필요')
    expect(minuteBlockDraftText(hardBreak)).toBe('주문은 수기로 입력\n입력 오류 발생\n원인 확인 필요')
    expect(blockquote.hash).toBe(fnv1a64(blockquote.text))
    expect(hardBreak.hash).toBe(fnv1a64(hardBreak.text))
  })

  it('체크리스트 완료 상태를 이슈 초안용 텍스트에 보존한다', () => {
    const block = splitMinuteBlocks([
      '- [x] 원인 확인 완료',
      '- [ ] 개선안 협의 필요',
    ].join('\n'))[0]

    expect(minuteBlockDraftText(block)).toBe('[완료] 원인 확인 완료\n[미완료] 개선안 협의 필요')
    expect(block.hash).toBe(fnv1a64(block.text))
  })

  it('해시는 공백 변화에 안정 (정규화: trim + 연속 공백/개행 → 스페이스 1개)', () => {
    const a = splitMinuteBlocks('결정  사항\n확정')[0]
    const b = splitMinuteBlocks('결정 사항 확정')[0]
    expect(a.hash).toBe(b.hash)
    expect(a.text).toBe('결정 사항 확정')
  })

  it('구분선(---)은 빈 텍스트 → 마킹 불가', () => {
    const blocks = splitMinuteBlocks('위\n\n---\n\n아래')
    expect(blocks).toHaveLength(3)
    expect(blocks[1].text).toBe('')
    expect(isMarkableBlock(blocks[1])).toBe(false)
    expect(isMarkableBlock(blocks[0])).toBe(true)
  })

  it('raw HTML 블록은 rendered=false + 빈 텍스트(includeHtml:false) → 마킹 불가', () => {
    const blocks = splitMinuteBlocks('문단\n\n<div>raw</div>\n\n다음')
    expect(blocks).toHaveLength(3)
    expect(blocks[1].rendered).toBe(false)
    expect(blocks[1].text).toBe('')
    expect(isMarkableBlock(blocks[1])).toBe(false)
  })

  it('GFM 각주 정의·링크 정의는 rendered=false + 빈 텍스트 (제자리 렌더 안 됨)', () => {
    // rendered=false 블록은 text 도 '' 로 강등되므로 내용 검색이 아니라 개수·플래그로 검증
    const md = '본문[^1]과 [링크][ref]\n\n[^1]: 각주 내용\n\n[ref]: https://example.com'
    const blocks = splitMinuteBlocks(md)
    const nonRendered = blocks.filter(b => !b.rendered)
    expect(nonRendered.length).toBeGreaterThanOrEqual(2)  // footnoteDefinition + definition
    nonRendered.forEach(b => {
      expect(b.text).toBe('')
      expect(isMarkableBlock(b)).toBe(false)
    })
  })

  it('빈 문서 → 빈 배열', () => {
    expect(splitMinuteBlocks('')).toEqual([])
    expect(splitMinuteBlocks('   \n  ')).toEqual([])
  })
})

// 회의록→WBS(설계 2026-10-21-minutes-to-wbs §3.3) — 문단에 연결된 작업 수를 이슈 수(data-issue-count)와 같은 꼴로 스탬프한다.
describe('remarkAnnotateBlocks — 연결된 WBS 작업 수(wbsCount)', () => {
  /** 블록마다 스탬프된 hProperties — 렌더러(react-markdown)가 그대로 요소 속성으로 옮긴다 */
  function stamped(md: string, marks: BlockMarks) {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(md) as Root
    remarkAnnotateBlocks(marks)(tree)
    return tree.children.map(node => (node.data as { hProperties?: Record<string, unknown> } | undefined)?.hProperties)
  }

  it('remarkAnnotateBlocks({ 0: { wbsCount: 2 } }) 는 그 블록에 data-wbs-count=2 를 단다 — 다른 블록은 앵커만', () => {
    const [first, second] = stamped('첫 문단\n\n둘째 문단', { 0: { wbsCount: 2 } })
    expect(first).toEqual({ 'data-mblock': 0, 'data-wbs-count': 2 })
    expect(second).toEqual({ 'data-mblock': 1 })
  })

  it('이슈 수와 함께 단다 — 두 배지는 따로다', () => {
    const [first] = stamped('문단', { 0: { issueCount: 1, wbsCount: 3 } })
    expect(first).toEqual({ 'data-mblock': 0, 'data-issue-count': 1, 'data-wbs-count': 3 })
  })

  it('0 은 달지 않는다(이슈 수와 같은 규칙) — 배지가 "0"으로 뜨지 않게', () => {
    const [first] = stamped('문단', { 0: { wbsCount: 0 } })
    expect(first).toEqual({ 'data-mblock': 0 })
  })

  it('렌더 — 문단 요소에 data-wbs-count="2" 가 실린다', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, { content: '로그인 API 개발', marks: { 0: { wbsCount: 2 } } }))
    expect(html).toMatch(/<p[^>]*data-wbs-count="2"/)
  })

  it('코드 블록 — data-wbs-count 도 앵커처럼 pre 로 옮기고 code 에는 남기지 않는다(MarkdownView ANCHOR_KEYS)', () => {
    const html = renderToStaticMarkup(createElement(MarkdownView, { content: '```js\nlogin()\n```', marks: { 0: { wbsCount: 3 } } }))
    expect(html).toMatch(/<pre[^>]*data-wbs-count="3"/)
    expect(html).not.toMatch(/<code[^>]*data-wbs-count/)
  })
})
