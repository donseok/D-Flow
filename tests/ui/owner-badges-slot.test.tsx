// OwnerBadges(SP4 P2) — 범위 공급자의 활성 팀으로 담당 표지를 칠한다. 비활성·목록 밖 담당은 중립이고 렌더가 깨지지 않는다.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { TeamsProvider } from '@/components/app/TeamsProvider'
import { OwnerBadges } from '@/components/wbs/shared'
import { TEAM_PALETTE } from '@/lib/domain/teamColor'
import { teamRows } from '../helpers/teams-source-mock'

const teams = [
  ...teamRows(['RES'], { id: '00000000-0000-0000-7e57-000000001a22', color: TEAM_PALETTE[0] }),
  ...teamRows(['OLD'], { id: '00000000-0000-0000-7e57-000000001a23', color: TEAM_PALETTE[1], active: false }),
]
const count = (html: string, cls: string) => html.split(cls).length - 1

describe('OwnerBadges — 팀 슬롯', () => {
  it('[RF1] 활성 팀은 그 슬롯, 비활성·목록 밖 담당은 중립 — 옛 team-N 클래스 없음', () => {
    const html = renderToString(
      <TeamsProvider teams={teams}>
        <OwnerBadges owners={[{ team: 'RES', kind: 'primary' }, { team: 'OLD', kind: 'support' }, { team: 'CIV', kind: 'primary' }]} />
      </TeamsProvider>,
    )
    expect(count(html, 'text-category-1')).toBe(1)
    expect(count(html, 'text-neutral')).toBe(2)
    expect(html).not.toMatch(/\b(?:text|bg)-team-[1-5]\b/)
    expect(html).toContain('RES')
    expect(html).toContain('CIV')
  })
})
