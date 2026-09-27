// <colgroup> 안에서 `<col … />` 뒤에 같은 줄로 무언가(열 설명 주석 등)를 이어 쓰지 않는다. JSX 는 같은 줄의 공백을 텍스트 노드로
// 남기므로 그 공백이 colgroup 의 자식이 되고, React 가 "whitespace text nodes cannot be a child of <colgroup>" hydration 오류를 낸다
// (WeeklySheetView 의 `<col className="w-[10%]" />    {/* 구분 */}`). 열 설명은 표 위 주석에 둔다(IssuesView 처럼).
// 같은 이유로 `<colgroup>` 바로 뒤 같은 줄의 공백도 막는다. 파일 전체를 훑어 여러 줄에 걸친 `<col>` 과 속성 안의 `>`(중괄호 식)도 잡는다.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
// 속성 = 중괄호 식이거나 '>'·'{' 가 아닌 글자(줄바꿈 포함) — 여러 줄 태그와 `{x > 1 ? … }` 를 넘긴다.
const ATTRS = String.raw`(?:[^>{]|\{[^}]*\})*`
const PATTERNS = [
  new RegExp(String.raw`<col\b${ATTRS}\/>[ \t]+\S`, 'g'),
  new RegExp(String.raw`<colgroup\b${ATTRS}>[ \t]+\S`, 'g'),
]
/** 걸린 줄 번호(공백 텍스트가 생기는 줄 = 매치 끝). 주석 줄에서 시작한 매치(설명 속 `<colgroup>` 언급)는 세지 않는다. */
const hitsIn = (text: string): number[] => {
  const lines = text.split('\n')
  const lineAt = (i: number) => text.slice(0, i).split('\n').length
  return PATTERNS.flatMap(re => [...text.matchAll(re)])
    .filter(m => !/^\s*(\/\/|\/\*|\*)/.test(lines[lineAt(m.index) - 1]))
    .map(m => lineAt(m.index + m[0].length))
    .sort((a, b) => a - b)
}

describe('colgroup 공백 텍스트 노드', () => {
  it('패턴 자체 — 같은 줄 주석·첫 col 앞 공백·여러 줄 col·속성 안 > 를 잡고, 줄바꿈으로 나눈 모양은 통과', () => {
    expect(hitsIn('<col className="w-[10%]" />    {/* 구분 */}')).toEqual([1])
    expect(hitsIn('<col a /> <col b />')).toEqual([1])
    expect(hitsIn('<colgroup> <col />\n</colgroup>')).toEqual([1])
    expect(hitsIn('<colgroup>\n  <col\n    className="w-10"\n  />  {/* c */}\n</colgroup>')).toEqual([4])
    expect(hitsIn('<col className={x > 1 ? "a" : "b"} />  {/* c */}')).toEqual([1])
    expect(hitsIn('<colgroup>\n  <col className="w-10" />\n  <col\n    className={w > 1 ? "a" : "b"}\n  />\n</colgroup>')).toEqual([])
    expect(hitsIn('// 표는 <colgroup> 으로 폭을 정한다\n * 열 정의 — <colgroup> 과 셀 순서')).toEqual([])
  })

  it('src 의 .tsx 에 colgroup 자식 자리의 같은 줄 공백 0건 — colgroup 이 있는 파일을 실제로 훑었다', () => {
    const hits: string[] = []
    const scanned: string[] = []
    for (const f of walk(ROOT).filter((p) => p.endsWith('.tsx'))) {
      const text = readFileSync(f, 'utf8')
      if (!text.includes('<col')) continue
      if (text.includes('<colgroup')) scanned.push(relative(process.cwd(), f))
      for (const line of hitsIn(text)) hits.push(`${relative(process.cwd(), f)}:${line}: ${text.split('\n')[line - 1].trim()}`)
    }
    // 훑은 파일이 없으면(ROOT 오류 등) 검사가 공허하게 통과한다.
    expect(scanned.length).toBeGreaterThan(0)
    expect(scanned).toContain('src/components/weekly/WeeklySheetView.tsx')
    expect(hits).toEqual([])
  })
})
