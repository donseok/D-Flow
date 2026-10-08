// 스크롤 주체 하나(D19) — main 이 문서형의 유일한 세로 스크롤. 페이지·PageFrame 문서형에 세로 overflow-auto 없음, main 에 overflow·scrollbar 유틸 없음.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

export const FILL_PAGES = [
  'src/app/(app)/p/[projectId]/wbs/page.tsx',       // S-7 이 '아니면'이면 w/[slug]/minutes/page.tsx 를 더한다
  'src/app/(app)/p/[projectId]/weekly/page.tsx',    // 주간 시트(SP4 B #25 — 시트 상자가 스크롤 주인)
]
describe('scroll-owner', () => {
  it('page.tsx 에 세로 overflow-(y-)auto 가 없다', () => {
    const bad = walk('src/app').filter((f) => f.endsWith('page.tsx') && /overflow-(?:y-)?auto/.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })
  it('PageFrame 문서형·ProjectPageShell 에 세로 스크롤 없음', () => {
    expect(readFileSync('src/components/app/PageFrame.tsx', 'utf8')).not.toMatch(/overflow-(?:y-)?auto/)
    expect(readFileSync('src/components/app/ProjectPageShell.tsx', 'utf8')).not.toMatch(/overflow-(?:y-)?auto|data-project-scroll-region/)
  })
  it('main 의 className 에 overflow·scrollbar 유틸이 없다(.app-main 본문만)', () => {
    const main = readFileSync('src/components/app/AppShell.tsx', 'utf8').match(/<main[^>]*className="([^"]*)"/)?.[1] ?? ''
    expect(main).toContain('app-main'); expect(main).not.toMatch(/overflow|scrollbar/)
  })
  it('main 은 절대 위치의 기준(relative)이다 — 아니면 본문의 sr-only 가 문서 기준으로 놓여 문서가 길어지고 스크롤이 둘이 된다', () => {
    expect(/<main id="main-content" className="([^"]*)"/.exec(readFileSync('src/components/app/AppShell.tsx', 'utf8'))?.[1].split(' ')).toContain('relative')
  })
  it('채움형은 닫힌 목록만(variant="fill")', () => {
    const fill = walk('src/app').filter((f) => f.endsWith('page.tsx') && /variant="fill"/.test(readFileSync(f, 'utf8')))
    expect(fill.sort()).toEqual([...FILL_PAGES].sort())
  })
  it('에이전트 현황에 손으로 준 h-full 틀이 없다(/agents 사고 회귀)', () => {
    const f = 'src/app/(app)/w/[slug]/agents/page.tsx'
    expect(codeLines(readFileSync(f, 'utf8'), f).join('\n')).not.toMatch(/\bh-full\b/)      // 주석의 설명문은 틀이 아니다
  })
  it('globals.css — .app-main 본문 뒤에 채움 규칙(공백·줄바꿈 무시)', () => {
    const css = readFileSync('src/app/globals.css', 'utf8').replace(/\s+/g, ' ')
    const a = css.indexOf('.app-main { overflow-y: auto; scrollbar-gutter: stable; }')
    const b = css.indexOf('.app-main:has([data-frame="fill"]) { overflow: hidden; scrollbar-gutter: auto; }')
    expect(a).toBeGreaterThan(-1); expect(b).toBeGreaterThan(a)
    // 채움 규칙도 안전망(unlayered 블록) 앞 — 안전망 무수정
    expect(b).toBeLessThan(css.indexOf('반응형 display 안전망'))
  })
  it('비색 :root 에 --frame-sticky-top 기본값 0px(PageFrame 밖에서도 top-(--frame-sticky-top) 가 0 으로 풀린다)', () => {
    const css = readFileSync('src/app/globals.css', 'utf8')
    expect(css).toMatch(/--frame-sticky-top:\s*0px;/)
  })
  it('BB4 — main 의 scroll-padding-top 이 --main-scroll-pad(PageFrame 이 도구 줄 높이 + 8 로 쓴다)를 따른다 — @layer components 안·안전망 앞', () => {
    const css = readFileSync('src/app/globals.css', 'utf8').replace(/\s+/g, ' ')
    const rule = css.indexOf('.app-main { scroll-padding-top: var(--main-scroll-pad, 0px); }')
    expect(rule).toBeGreaterThan(css.indexOf('.app-main:has([data-frame="fill"])'))
    expect(rule).toBeLessThan(css.indexOf('반응형 display 안전망'))
    expect(rule).toBeGreaterThan(css.indexOf('@layer components'))
    expect(css).not.toContain('[data-frame-body] :focus-visible')   // 요소 scroll-margin 은 크로미움 초점 스크롤이 따르지 않았다(실측)
  })
})
