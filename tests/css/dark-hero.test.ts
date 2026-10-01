// 어두운 히어로 전제 마크업 제거(SP3b 스펙 §4.4·D13·E8, 계획 판정 Q20) — 히어로가 밝은 표면이 된 뒤
// 흰 반투명 배경·흰 글자·어두운 기준 hex 가 남으면 흰 위 흰으로 사라진다. C 소유 두 파일은 UI-2b(여기 없음).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { srcFiles } from './lib/cssTokens'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const FILES = [
  'src/components/ui/PageHero.tsx', 'src/components/home/NewProjectModal.tsx', 'src/components/agent-hub/AgentFrame.tsx',
  'src/components/agent-hub/AgentTabs.tsx', 'src/components/wiki/WikiSearch.tsx', 'src/components/wiki/WikiReindexButton.tsx',
  'src/components/chat/AssistantChat.tsx', 'src/app/not-found.tsx',
  'src/components/agent-hub/AgentHubView.tsx', 'src/components/report/ReportButton.tsx',
]
const DARK = /(?<![\w-])(?:[a-z-]+:)*(?:bg|border|ring)-white\/|(?<![\w-])(?:[a-z-]+:)*text-white(?![\w-])|-\[#[0-9a-fA-F]{3,8}\]|--gradient-(?:dark|primary)/

describe('어두운 히어로 전제 0', () => {
  it.each(FILES)('%s — 흰 반투명·흰 글자·임의 hex·어두운 그라데이션이 없다', (f) => {
    expect(read(f).split('\n').filter((l) => DARK.test(l))).toEqual([])
  })
  it('에이전트 히어로 타일 값 색은 상태 토큰이다(판정 Q20 — 원천은 AgentHubView·RosterBoard)', () => {
    // 배열 끝은 '= [' 뒤의 닫는 줄(\n  ])로 찾는다 — 타입 표기 HeroTile[] 의 ']' 를 잡으면 빈 조각이 되어 늘 통과했다(U1b 리뷰 R3 P1)
    const hub = read('src/components/agent-hub/AgentHubView.tsx')
    const start = hub.indexOf('const tiles: HeroTile[] = [')
    const tiles = hub.slice(start, hub.indexOf('\n  ]', start))
    expect(start).toBeGreaterThan(-1)
    expect(tiles).toContain("key: 'delegated'")
    expect(tiles).toContain("key: 'stuck'")
    expect(tiles).not.toMatch(/'#[0-9a-fA-F]{3,8}'/)
    const roster = read('src/components/agents/RosterBoard.tsx')
    const hero = roster.slice(roster.indexOf('export function rosterHero'), roster.indexOf('\n}\n', roster.indexOf('export function rosterHero')))
    expect(hero).toContain("key: 'empty'")
    expect(hero).not.toMatch(/'#[0-9a-fA-F]{3,8}'/)
  })
  it('hero-glow — 규칙 0, C 소유 projects/page.tsx 밖 사용 0(C 파일은 UI-2b — 사전 점검 실행 minor 3)', () => {
    expect(read('src/app/globals.css')).not.toMatch(/\.hero-glow\b/)
    expect(srcFiles(/\.tsx$/).filter(([f, t]) => f !== 'src/app/(app)/projects/page.tsx' && /\bhero-glow\b/.test(t)).map(([f]) => f)).toEqual([])
  })
})
