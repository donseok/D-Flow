// 옛 전역 경로 리터럴(스펙 §5.7 불변식) — ① 옛 전역 접두의 revalidatePath 0건(임시 허용 제외) ② '/(' 로 시작하는 revalidatePath 는 둘째 인자가 있고
// 그 경로 + '/<종류>.tsx' 파일이 src/app 아래 있다(D8 — Next 15 의 암묵 태그는 라우트 그룹을 포함한 파일 경로다. 동작 테스트는 판별력이 없다)
// ③ 따옴표 접두 옛 경로 리터럴은 닫힌 허용 목록(파일 + 개수 + 사유)에만. 주석은 세지 않는다(codeLines). 목록은 줄기만 한다.
// 사유 접두: '영구: '(옛 형식을 계속 내거나 읽는다) · UI-2a 사유 접두(과제 번호 — UI-2a 체크포인트까지 0) · UI-2b 사유 접두(UI-2b 체크포인트까지 0 — 과제 35 로 0, V19).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const OLD = '(\\/projects|\\/meetings|\\/minutes|\\/agents|\\/portfolio|\\/usage|\\/admin\\/accounts|\\/admin\\/teams)'
const LITERAL = new RegExp(`(['"\`])${OLD}(?=[/'"\`?]|\\$\\{)`, 'g')
const OLD_REVALIDATE = new RegExp(`revalidatePath\\(\\s*(['"\`])${OLD}(?=[/'"\`?]|\\$\\{)`, 'g')
const GROUP_REVALIDATE = /revalidatePath\(\s*'(\/\([^']*)'\s*(?:,\s*'(page|layout)')?\s*\)/g

/** 화면 안 클라이언트 링크(과제 35)는 useScope 로 새 형식이고, 범위가 없을 때(셸 밖·테스트)의 한 갈래만 옛 형식이다 */
const NO_SCOPE = '영구: 범위 없음 폴백 — 스텁이 해석(D5)'
const PERMALINK = '영구: 영구 링크(D6) — 옛 형식을 내거나 두 형식을 읽는다'

/** ③ 허용 목록 — 과제 9 의 생성 스크립트가 초안을 만들고 사유는 계획 과제 9 Step 3 의 규칙표로 달았다 */
export const ALLOW: Record<string, { count: number; why: string }> = {
  'src/components/minutes/minuteLinks.ts': { count: 2, why: NO_SCOPE },
  'src/components/agents/SeatmapView.tsx': { count: 1, why: NO_SCOPE },
  'src/components/agents/OfficeNav.tsx': { count: 1, why: NO_SCOPE },
  'src/components/admin/AccountsManager.tsx': { count: 1, why: NO_SCOPE },
  'src/lib/minutes/permalink.ts': { count: 1, why: '영구: 영구 링크 형식의 기준 경로 상수 하나(D6) — 링크 함수는 기준 경로를 필수로 받는다(CC6)' },
  'src/lib/domain/usageMenu.ts': { count: 8, why: '영구: 역사 키 — 옛 경로 사용 이벤트를 같은 키로 읽는다' },
  'src/lib/ai/chat/verifier.ts': { count: 5, why: PERMALINK },
  'src/lib/ai/chat/deep-links.ts': { count: 2, why: PERMALINK },
  'src/lib/ai/index/content.ts': { count: 1, why: PERMALINK },
  'src/lib/workspace/legacy.ts': { count: 9, why: '영구: 옛 경로 변환표' },
}
/** ① 임시 허용 — UI-2b 의 과제 25 가 0 으로 만들었다(createProject 계열·초대 합류는 ('/(app)/w/[slug]', 'layout') 로 — 전환기 목록이 레이아웃 데이터, §5.7).
 *  새 임시 허용을 더하지 않는다 */
export const TEMP_REVALIDATE: Record<string, { count: number; why: string }> = {}

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
