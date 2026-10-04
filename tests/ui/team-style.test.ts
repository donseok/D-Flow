// useTeamSlot(SP4 P2) — 범위 공급자의 활성 팀으로 code 를 슬롯으로 바꾼다. 비활성·목록 밖·공급자 없음은 중립.
import { describe, expect, it } from 'vitest'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { useTeamSlot } from '@/components/app/TeamsProvider'
import { CATEGORY_SLOTS, NEUTRAL_SLOT, TEAM_PALETTE } from '@/lib/domain/teamColor'
import { withTeams } from '../fixtures/teams'
import { teamRows } from '../helpers/teams-source-mock'

function Probe({ codes }: { codes: string[] }) {
  const slotOf = useTeamSlot()
  return h('i', null, codes.map((c) => `${c}=${slotOf(c).fg}`).join(','))
}
const teams = [
  ...teamRows(['RES'], { id: '00000000-0000-0000-7e57-000000001a20', color: TEAM_PALETTE[2] }),
  ...teamRows(['OLD'], { id: '00000000-0000-0000-7e57-000000001a21', color: TEAM_PALETTE[0], active: false }),
]

describe('useTeamSlot', () => {
  it('활성 팀은 팔레트 슬롯, 비활성·목록 밖은 중립', () => {
    // 공급자는 withTeams(TeamsProvider 를 createElement 로 감싸는 공용 도우미)로 — props 타입이 children 을 요구한다
    const html = renderToString(withTeams(h(Probe, { codes: ['RES', 'OLD', 'CIV'] }), teams))
    expect(html).toContain(`RES=${CATEGORY_SLOTS[2].fg}`)
    expect(html).toContain(`OLD=${NEUTRAL_SLOT.fg}`)
    expect(html).toContain(`CIV=${NEUTRAL_SLOT.fg}`)
  })
  it('[RF1] 공급자가 없으면(공유 회의록) 모두 중립', () => {
    expect(renderToString(h(Probe, { codes: ['RES'] }))).toContain(`RES=${NEUTRAL_SLOT.fg}`)
  })
})

describe('회의록 팀 막대 패턴(SP5 B2 — D39)', () => {
  it('막대는 TeamBar 한 곳 — 회의록 화면이 슬롯·채움 전경을 직접 조립하지 않는다', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const dir = 'src/components/minutes'
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && f !== 'TeamBar.tsx')
    for (const f of files) expect(readFileSync(`${dir}/${f}`, 'utf8'), f).not.toMatch(/useTeamSlot|slotOf\(/)
    const bar = readFileSync(`${dir}/TeamBar.tsx`, 'utf8')
    expect(bar).toContain('text-category-fg')
    expect(bar).toContain('slotOf(code).bar')
  })
})
