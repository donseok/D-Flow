// 세션 관문의 호출자 고정(UI-2b 최종 보안 리뷰 P2-1 → GG2). 범위 없는 세션 관문 requireSessionModule 은 페이지 관문(pageGate.ts) 하나만 부른다 —
// 세션 라우트는 범위 관문 requireScopedSessionModule(요청의 프로젝트·워크스페이스 → 조합 → 실제 소속 → 모듈, D26·CC6)을 쓴다.
// 왜: 레인 A 병합(rebase) 때 v2 스트림 라우트 같은 충돌 파일을 한쪽 통째(`git checkout --ours`)로 고르면 본문이
// `requireSessionModule(request.pageContext?.projectId ?? request.projectId, 'chatbot')` 로 돌아가도 typecheck 가 통과한다 — 프로젝트 없는 질문이 세션 유일
// 워크스페이스로 다시 판정되고(R15), 화면 문맥의 워크스페이스·선택 프로젝트 조합 판정(CC6)이 사라진다. sole-workspace 는 리터럴 `requireSessionModule(null` 만,
// deny.routes 는 requireSessionModule 을 정상 관문으로 받으므로 이 회귀는 여기서만 빨강이 된다.
// 주석은 세지 않는다(codeLines — 문자열 속 이름은 센다: 보수적으로 빨강). 별칭 import(`requireSessionModule as x`)·재노출도 호출자 목록 밖이면 잡는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

/** 닫힌 호출자 목록 — 늘리려면 이 파일에 사유와 함께 적는다(리뷰 대상) */
export const CALLERS: Record<string, string> = {
  'src/lib/modules/pageGate.ts': '페이지 관문 — requireModulePage(null, …) 의 세션 범위 갈래(그 범위는 페이지가 정한다, 요청 본문이 아니다)',
}
const DEFINER = 'src/lib/modules/gate.ts'
/** 범위 관문을 써야 하는 세션 라우트(manifest 의 세션 라우트 8) — 원문에 범위 관문 호출이 있어야 한다 */
export const SCOPED_ROUTES = [
  'src/app/api/track/route.ts',
  'src/app/api/chat/route.ts',
  'src/app/api/chat/context/route.ts',
  'src/app/api/chat/stream/route.ts',
  'src/app/api/chat/v2/stream/route.ts',
  'src/app/api/chat/command/route.ts',
  'src/app/api/minutes/chat/route.ts',
  'src/app/api/minutes/export/route.ts',
] as const

/** 이 원문이 requireSessionModule 을 쓰는가(호출·import·재노출) — 주석 밖 코드만 */
export function usesSessionModule(text: string, fileName = 'snippet.ts'): boolean {
  const code = codeLines(text, fileName).join('\n')
  return /\brequireSessionModule\b/.test(code)
}

describe('requireSessionModule 호출자(GG2)', () => {
  it('src 전체에서 requireSessionModule 을 쓰는 파일은 닫힌 목록(pageGate.ts)뿐이다', () => {
    const got = ['src/app', 'src/components', 'src/lib'].flatMap((r) => walk(r))
      .filter((f) => f !== DEFINER && usesSessionModule(readFileSync(f, 'utf8'), f))
    expect(got.sort()).toEqual(Object.keys(CALLERS).sort())
  })
  it('세션 라우트 여덟은 범위 관문 requireScopedSessionModule 을 부른다 — v2 는 선택 프로젝트까지 조합 판정에 넣는다(CC6)', () => {
    for (const f of SCOPED_ROUTES) {
      const code = codeLines(readFileSync(f, 'utf8'), f).join('\n')
      expect(code, f).toMatch(/\brequireScopedSessionModule\(/)
    }
    const v2 = codeLines(readFileSync('src/app/api/chat/v2/stream/route.ts', 'utf8'), 'route.ts').join('\n')
    expect(v2).toMatch(/\bchatProjectHint\(/)
  })
  it('판별기 민감도 — 통째 선택 회귀의 원문을 잡고, 주석 언급은 세지 않는다', () => {
    expect(usesSessionModule("const mod = await requireSessionModule(request.pageContext?.projectId ?? request.projectId, 'chatbot')")).toBe(true)
    expect(usesSessionModule("import { requireSessionModule as gate } from '@/lib/modules/gate'")).toBe(true)
    expect(usesSessionModule("export { requireSessionModule } from './gate'")).toBe(true)
    expect(usesSessionModule("// requireSessionModule(null, 'chatbot') 은 쓰지 않는다\n/* requireSessionModule */ const mod = await requireScopedSessionModule(s, 'chatbot')")).toBe(false)
  })
  it('목록 항목마다 사유가 있다', () => { for (const [f, why] of Object.entries(CALLERS)) expect(why.length, f).toBeGreaterThan(10) })
})
