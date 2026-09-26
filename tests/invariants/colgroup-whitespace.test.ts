// <colgroup> 안에서 `<col … />` 뒤에 같은 줄로 무언가(열 설명 주석 등)를 이어 쓰지 않는다. JSX 는 같은 줄의 공백을 텍스트 노드로
// 남기므로 그 공백이 colgroup 의 자식이 되고, React 가 "whitespace text nodes cannot be a child of <colgroup>" hydration 오류를 낸다
// (WeeklySheetView 의 `<col className="w-[10%]" />    {/* 구분 */}`). 열 설명은 표 위 주석에 둔다(IssuesView 처럼).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const COL_THEN_SAME_LINE = /<col\b[^>]*\/>[ \t]+\S/

describe('colgroup 공백 텍스트 노드', () => {
  it('src 의 .tsx 에 `<col … />` 뒤 같은 줄에 공백과 다른 내용이 이어지는 줄 0건', () => {
    const hits: string[] = []
    for (const f of walk(ROOT).filter((p) => p.endsWith('.tsx'))) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (COL_THEN_SAME_LINE.test(line)) hits.push(`${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })
})
