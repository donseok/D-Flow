// 옛 전역 경로 리터럴(스펙 §5.7 불변식) — ① 옛 전역 접두의 revalidatePath 0건(임시 허용 제외) ② '/(' 로 시작하는 revalidatePath 는 둘째 인자가 있고
// 그 경로 + '/<종류>.tsx' 파일이 src/app 아래 있다(D8 — Next 15 의 암묵 태그는 라우트 그룹을 포함한 파일 경로다. 동작 테스트는 판별력이 없다)
// ③ 따옴표 접두 옛 경로 리터럴은 닫힌 허용 목록(파일 + 개수 + 사유)에만. 주석은 세지 않는다(codeLines). 목록은 줄기만 한다.
// 사유 접두: '영구: '(옛 형식을 계속 내거나 읽는다) · 'UI-2a: 과제 N — '(UI-2a 체크포인트까지 0) · 'UI-2b: '(UI-2b 체크포인트까지 0, V19).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const OLD = '(\\/projects|\\/meetings|\\/minutes|\\/agents|\\/portfolio|\\/usage|\\/admin\\/accounts|\\/admin\\/teams)'
const LITERAL = new RegExp(`(['"\`])${OLD}(?=[/'"\`?]|\\$\\{)`, 'g')
const OLD_REVALIDATE = new RegExp(`revalidatePath\\(\\s*(['"\`])${OLD}(?=[/'"\`?]|\\$\\{)`, 'g')
const GROUP_REVALIDATE = /revalidatePath\(\s*'(\/\([^']*)'\s*(?:,\s*'(page|layout)')?\s*\)/g

const SHELL = 'UI-2b: 옛 셸 — 과제 31 이 파일째 지운다'
const CLIENT_LINK = 'UI-2b: 과제 35 — 클라이언트 링크(useScope 뒤)'
const RESOLVER = 'UI-2a: 과제 18 — 리졸버·D7'
const BASE_ARG = 'UI-2a: 과제 21 — base 인자'
const PERMALINK = '영구: 영구 링크(D6) — 옛 형식을 내거나 두 형식을 읽는다'

/** ③ 허용 목록 — 과제 9 의 생성 스크립트가 초안을 만들고 사유는 계획 과제 9 Step 3 의 규칙표로 달았다 */
export const ALLOW: Record<string, { count: number; why: string }> = {
  'src/components/app/Sidebar.tsx': { count: 21, why: SHELL },
  'src/components/app/HeaderChrome.tsx': { count: 21, why: SHELL },
  'src/components/app/ProjectNavigationContext.tsx': { count: 6, why: SHELL },
  'src/components/wiki/WikiShared.tsx': { count: 5, why: CLIENT_LINK },
  'src/components/minutes/MinuteViewer.tsx': { count: 3, why: CLIENT_LINK },
  'src/components/minutes/MinutesView.tsx': { count: 2, why: CLIENT_LINK },
  'src/components/minutes/MinutesExplorer.tsx': { count: 2, why: CLIENT_LINK },
  'src/components/meetings/MeetingDetailModal.tsx': { count: 1, why: CLIENT_LINK },
  'src/components/agents/SeatmapView.tsx': { count: 1, why: CLIENT_LINK },
  'src/components/agents/OfficeNav.tsx': { count: 1, why: CLIENT_LINK },
  'src/components/admin/AccountsManager.tsx': { count: 1, why: CLIENT_LINK },
  'src/components/ui/BrandMark.tsx': { count: 1, why: 'UI-2b: 과제 25 — C 파일 과제' },
  'src/lib/nav/legacyPaths.ts': { count: 2, why: 'UI-2b: 과제 25 — C 파일 과제' },
  'src/app/page.tsx': { count: 1, why: RESOLVER },
  'src/app/not-found.tsx': { count: 1, why: RESOLVER },
  'src/app/login/page.tsx': { count: 1, why: RESOLVER },
  'src/components/invite/InviteRedeemCard.tsx': { count: 2, why: RESOLVER },
  'src/app/(app)/admin/llm-config/page.tsx': { count: 1, why: RESOLVER },
  'src/lib/minutes/source.ts': { count: 1, why: BASE_ARG },
  'src/lib/domain/usage.ts': { count: 2, why: BASE_ARG },
  'src/lib/data/minutes.ts': { count: 1, why: BASE_ARG },
  'src/app/actions/project.ts': { count: 3, why: 'UI-2b: 과제 25 — revalidatePath(레이아웃 데이터)' },
  'src/app/actions/inviteRedeem.ts': { count: 2, why: 'UI-2b: 과제 25 — revalidatePath(레이아웃 데이터)' },
  'src/lib/domain/usageMenu.ts': { count: 11, why: '영구: 역사 키 — 옛 경로 사용 이벤트를 같은 키로 읽는다(과제 20 이 개수를 다시 정한다)' },
  'src/lib/ai/chat/verifier.ts': { count: 5, why: PERMALINK },
  'src/lib/ai/chat/deep-links.ts': { count: 2, why: PERMALINK },
  'src/lib/ai/index/content.ts': { count: 1, why: PERMALINK },
  'src/components/chat/BotPageContextProvider.tsx': { count: 3, why: PERMALINK },
  'src/lib/workspace/legacy.ts': { count: 9, why: '영구: 옛 경로 변환표' },
}
/** ① 임시 허용 — UI-2b 에서 0. createProject 계열 3·초대 합류 2 는 레이아웃 데이터라 UI-2b 의 범위 레이아웃 뒤에 바꾼다(§5.7).
 *  'UI-2a: 과제 N' 항목은 그 화면을 옮기는 과제가 지운다 */
export const TEMP_REVALIDATE: Record<string, { count: number; why: string }> = {
  'src/app/actions/project.ts': { count: 3, why: "UI-2b: 과제 25 — ('/(app)/w/[slug]', 'layout') 로(전환기 목록이 레이아웃 데이터)" },
  'src/app/actions/inviteRedeem.ts': { count: 2, why: "UI-2b: 과제 25 — ('/(app)/w/[slug]', 'layout') 로" },
}

const files = walk('src').filter((f) => !f.includes('/__tests__/'))
const countOf = (lines: string[], re: RegExp) => lines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0)

describe('route-literals', () => {
  it('① 옛 전역 접두의 revalidatePath 는 임시 허용 목록의 개수 그대로', () => {
    const got: Record<string, number> = {}
    for (const f of files) { const n = countOf(codeLines(readFileSync(f, 'utf8'), f), OLD_REVALIDATE); if (n) got[f] = n }
    expect(got).toEqual(Object.fromEntries(Object.entries(TEMP_REVALIDATE).map(([f, v]) => [f, v.count])))
  })
  it('② 라우트 그룹 경로의 revalidatePath 는 종류가 있고 그 파일이 있다', () => {
    const bad: string[] = []
    for (const f of files) {
      for (const l of codeLines(readFileSync(f, 'utf8'), f)) {
        for (const m of l.matchAll(GROUP_REVALIDATE)) {
          if (!m[2]) { bad.push(`${f}: ${m[0]} — 둘째 인자('page'|'layout')가 없다`); continue }
          if (!existsSync(join('src/app', `${m[1]}/${m[2]}.tsx`))) bad.push(`${f}: ${m[0]} — src/app${m[1]}/${m[2]}.tsx 가 없다`)
        }
      }
    }
    expect(bad).toEqual([])
  })
  it('③ 따옴표 접두 옛 경로 리터럴은 허용 목록에만, 개수 그대로', () => {
    const got: Record<string, number> = {}
    for (const f of files) { const n = countOf(codeLines(readFileSync(f, 'utf8'), f), LITERAL); if (n) got[f] = n }
    expect(got).toEqual(Object.fromEntries(Object.entries(ALLOW).map(([f, v]) => [f, v.count])))
  })
  it('사유가 규칙 접두로 시작한다', () => {
    for (const [f, v] of [...Object.entries(ALLOW), ...Object.entries(TEMP_REVALIDATE)]) expect(v.why, f).toMatch(/^(영구: |UI-2a: 과제 \d+ — |UI-2b: )/)
  })
})
