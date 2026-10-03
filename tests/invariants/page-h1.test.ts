// 화면마다 보이는 h1 하나(스펙 §9 ④, E21) — <h1 은 닫힌 허용 목록 파일에만(파일·개수), PageHeader·PageHero 는 컴팩트에도 h1 을 그리고 숨기지 않는다.
// 라우트별 실제 h1 개수는 눈확인(§8.5 UI-2b — 1280×720·390)이 잰다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const ALLOW: Record<string, number> = {
  'src/components/app/PageHeader.tsx': 1,
  'src/components/ui/PageHero.tsx': 1,
  'src/components/app/ScopeError.tsx': 1,
  'src/components/workspace/NoWorkspaceView.tsx': 1,
  'src/components/agent-hub/AgentFrame.tsx': 1,          // AgentHero 의 h1(D18 예외) — 컴팩트에서는 PageHero 로 바꿔 그린다(조건부 렌더라 한 화면에 하나)
  'src/components/minutes/MinuteViewer.tsx': 1,
  'src/components/minutes/ShareViewer.tsx': 1,
  'src/app/page.tsx': 1,                                 // 루트 리졸버의 조회 오류 화면(셸 밖 — 제품 이름이 머리)
  'src/app/login/page.tsx': 1,
  'src/app/invite/[token]/page.tsx': 1,
  'src/app/not-found.tsx': 1,
}
describe('page-h1', () => {
  it('<h1 은 허용 목록 파일에만, 개수 그대로', () => {
    const got: Record<string, number> = {}
    for (const f of walk('src')) { const n = codeLines(readFileSync(f, 'utf8'), f).join('\n').match(/<h1[\s>]/g)?.length ?? 0; if (n) got[f] = n }
    expect(got).toEqual(ALLOW)
  })
  it('PageHeader·PageHero 의 h1 에 hidden·sr-only 가 없다', () => {
    for (const f of ['src/components/app/PageHeader.tsx', 'src/components/ui/PageHero.tsx']) {
      const h1 = readFileSync(f, 'utf8').match(/<h1[^>]*>/)?.[0] ?? ''
      expect(h1, f).not.toMatch(/\bhidden\b|sr-only/)
    }
    expect(readFileSync('src/components/ui/PageHero.tsx', 'utf8')).not.toContain('[@media(min-width:1280px)_and_(min-height:800px)]:grid')
  })
  it('PageHero 는 감싸는 요소에서도 숨기지 않는다(조상 hidden 이면 h1 도 안 보인다)', () => {
    const code = codeLines(readFileSync('src/components/ui/PageHero.tsx', 'utf8'), 'PageHero.tsx').join('\n')
    expect(code).not.toMatch(/className="[^"]*\bhidden\b/)
  })
  it('ProjectPageShell 어댑터는 컴팩트에서 머리를 버리지 않는다', () => {
    const t = readFileSync('src/components/app/ProjectPageShell.tsx', 'utf8')
    expect(t).not.toMatch(/useCompactViewport|!compact &&/)
  })
})
