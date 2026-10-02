// 페이지 안 고정 요소(D54) — main 이 유일한 스크롤이 되면 top-0 은 도구 줄을 덮는다. top-(--frame-sticky-top) 와 z-10 이하로. 예외는 닫힌 목록(사유)
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walk } from '../invariants/_walk'

const EXEMPT: Record<string, string> = {
  'src/components/app/PageFrame.tsx': '도구 줄 자신 — 페이지 안 고정 요소의 기준(top 0, --z-sticky)이고 자기 높이를 --frame-sticky-top 으로 내린다',
  'src/components/wbs/WbsGanttSheet.tsx': '채움형 그리드 자신의 스크롤 영역(열 머리·고정 열)',
  'src/components/agent-hub/DelegationTable.tsx': '표 자신의 스크롤 영역(delegationTable.module.css .box — overflow:auto + max-height)',
  'src/components/members/MemberPicker.tsx': '목록 자신의 스크롤 영역(max-h-52 overflow-y-auto) 안 분류 머리',
  'src/components/settings/WorkspaceFieldsEditor.tsx': '아래 고정 저장 바(bottom) — 도구 줄과 무관',
}
describe('sticky-offset', () => {
  it('예외 밖의 sticky 는 top-0·top-<숫자> 가 아니라 --frame-sticky-top, 층은 z-10 이하', () => {
    const bad: string[] = []
    for (const f of walk('src/components')) {
      if (EXEMPT[f]) continue
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (!/\bsticky\b/.test(l) || /^\s*(\/\/|\*|\{\/\*)/.test(l)) return
        if (/(?:^|[\s"'`])(?:\w+:)?top-(?:0|\d+)\b/.test(l)) bad.push(`${f}:${i + 1} top 고정값`)
        if (/\bz-(?:[2-9]\d|\d{3})\b|z-\[/.test(l)) bad.push(`${f}:${i + 1} 층이 z-10 위`)
      })
    }
    expect(bad).toEqual([])
  })
  it('z-10 고정 줄 아래로 흐르는 내용의 높은 층(z-20·z-30)은 isolate 상자 안에 가둔다 — 주간 시트(채움형 스크롤 상자)·회의록 탐색기', () => {
    // 고정 줄을 z-10 으로 내리면(도구 줄 --z-sticky 아래) 뒤 형제의 z-30 배지·z-20 메뉴 버튼이 스크롤 중 그 줄을 덮는다(옛 z-40 의 이유)
    expect(readFileSync('src/components/weekly/WeeklySheetView.tsx', 'utf8')).toContain('<div className="isolate min-h-0 flex-1 overflow-auto">')
    expect(readFileSync('src/components/minutes/MinutesExplorer.tsx', 'utf8')).toMatch(/data-minutes-explorer\s+className="isolate /)
  })
  it('예외 목록의 파일이 실제로 있다(낡은 예외 금지)', () => {
    expect(Object.keys(EXEMPT).filter((f) => !existsSync(f))).toEqual([])
  })
  it('판정기가 살아 있다 — 표본', () => {
    const hit = (l: string) => /(?:^|[\s"'`])(?:\w+:)?top-(?:0|\d+)\b/.test(l)
    expect(hit('className="sticky top-0 z-10"')).toBe(true)
    expect(hit('className="lg:sticky lg:top-24"')).toBe(true)
    expect(hit('className="xl:sticky xl:top-(--frame-sticky-top)"')).toBe(false)
    expect(/\bz-(?:[2-9]\d|\d{3})\b|z-\[/.test('sticky top-(--frame-sticky-top) z-40')).toBe(true)
    expect(/\bz-(?:[2-9]\d|\d{3})\b|z-\[/.test('sticky top-(--frame-sticky-top) z-10')).toBe(false)
  })
})
