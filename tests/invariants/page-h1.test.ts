// 화면마다 보이는 h1 하나(스펙 §9 ④, E21) — <h1 은 닫힌 허용 목록 파일에만(파일·개수), PageHeader 는 컴팩트에도 h1 을 그리고 숨기지 않는다.
// 옛 PageHero 는 UI-5 에서 전 화면을 PageHeader 로 옮기고 지웠다 — 머리는 한 벌이다(파일·import·식별자 0).
// 라우트별 실제 h1 개수는 눈확인(§8.5 UI-2b — 1280×720·390)이 잰다.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const ALLOW: Record<string, number> = {
  'src/components/app/PageHeader.tsx': 1,
  'src/components/app/ScopeError.tsx': 1,
  'src/components/workspace/NoWorkspaceView.tsx': 1,
  'src/components/agent-hub/AgentFrame.tsx': 1,          // AgentHero 의 h1(D18 예외) — 컴팩트에서는 PageHeader 로 바꿔 그린다(조건부 렌더라 한 화면에 하나)
  'src/components/minutes/MinuteViewer.tsx': 1,
  'src/components/minutes/ShareViewer.tsx': 1,
  'src/app/page.tsx': 1,                                 // 루트 리졸버의 조회 오류 화면(셸 밖 — 제품 이름이 머리)
  'src/app/login/page.tsx': 1,
  'src/app/invite/[token]/page.tsx': 1,
  'src/app/not-found.tsx': 1,
  'src/components/errors/StandaloneError.tsx': 1,       // 셸 밖 오류 화면(src/app/error.tsx·global-error.tsx 가 같이 쓴다 — 한 화면에 하나)
}
describe('page-h1', () => {
  it('<h1 은 허용 목록 파일에만, 개수 그대로', () => {
    const got: Record<string, number> = {}
    for (const f of walk('src')) { const n = codeLines(readFileSync(f, 'utf8'), f).join('\n').match(/<h1[\s>]/g)?.length ?? 0; if (n) got[f] = n }
    expect(got).toEqual(ALLOW)
  })
  it('PageHeader 의 h1 에 hidden·sr-only 가 없다 — 제목 클래스에도, 감싸는 header 에도', () => {
    const text = readFileSync('src/components/app/PageHeader.tsx', 'utf8')
    expect(text.match(/<h1[^>]*>/)?.[0] ?? '').toMatch(/^<h1 className=\{titleClass\}>$/)
    expect(text.match(/const titleClass = .*/)?.[0] ?? '').not.toMatch(/\bhidden\b|sr-only/)
    expect(text.match(/<header[^>]*>/)?.[0] ?? '').not.toMatch(/\bhidden\b|sr-only/)
    expect(text).not.toContain('[@media(min-width:1280px)_and_(min-height:800px)]:grid')
  })
  it('머리는 한 벌 — PageHero 파일이 없고 src 어디에도 그 이름(import·JSX·HeroBadge)이 없다', () => {
    expect(existsSync('src/components/ui/PageHero.tsx')).toBe(false)
    const hits = walk('src').filter((f) => /\bPageHero\b|\bHeroBadge\b|components\/ui\/PageHero/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
  it('테스트도 지운 모듈을 mock·import 하지 않는다(없는 경로의 vi.mock 은 조용히 통과해 죽은 설정으로 남는다)', () => {
    const hits = walk('tests').filter((f) => !f.endsWith('page-h1.test.ts') && /components\/ui\/PageHero/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
  it('ProjectPageShell 어댑터는 컴팩트에서 머리를 버리지 않는다', () => {
    const t = readFileSync('src/components/app/ProjectPageShell.tsx', 'utf8')
    expect(t).not.toMatch(/useCompactViewport|!compact &&/)
  })
})
