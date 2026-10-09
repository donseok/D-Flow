// 팀 표기의 렌더(팀 유연화 1단계) — 화면은 팀 이름을 그린다. code 는 선택자(data-*)·키로만 남고, 긴 이름은 줄이며 title 로 전부 보인다.
// 공급자가 없거나 목록 밖 팀이면 code 그대로다.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TeamsProvider, useTeamLabel } from '@/components/app/TeamsProvider'
import { OwnerBadges } from '@/components/wbs/shared'
import { TeamBar, TeamBarLabelsProvider } from '@/components/minutes/TeamBar'
import { TeamProgress } from '@/components/dashboard/TeamProgress'
import { RosterReadRow } from '@/components/roster/RosterRow'
import { TEAM_PALETTE } from '@/lib/domain/teamColor'
import type { ComputedItem } from '@/lib/domain/types'
import type { RosterMember } from '@/lib/data/memberSelect'
import { teamRows } from '../helpers/teams-source-mock'
import { ensureEnLoaded, t as dictT } from '@/lib/i18n/dict'

vi.mock('@/app/actions/roster', () => ({ upsertRosterMember: vi.fn(), removeRosterMember: vi.fn() }))

const LONG = '아주 긴 이름을 가진 전사 디지털 전환 추진 기획 조정 팀'
const teams = [
  ...teamRows(['TEAM_A'], { id: 't-a', name: '기획팀', color: TEAM_PALETTE[0] }),
  ...teamRows(['TEAM_B'], { id: 't-b', name: LONG, color: TEAM_PALETTE[1], sortOrder: 1 }),
  ...teamRows(['OLD'], { id: 't-old', name: '옛 이름', color: TEAM_PALETTE[2], sortOrder: 2, active: false }),
]

function Label({ code }: { code: string }) {
  return <span>{useTeamLabel()(code)}</span>
}

describe('useTeamLabel — 범위 공급자의 활성 팀으로 code 를 이름으로', () => {
  it('활성 팀은 이름, 비활성 팀도 이름(라벨 해석용으로 내려온다), 목록 밖·공급자 없음은 code 그대로', () => {
    const html = (code: string) => renderToStaticMarkup(<TeamsProvider teams={teams}><Label code={code} /></TeamsProvider>)
    expect(html('TEAM_A')).toBe('<span>기획팀</span>')
    expect(html('OLD')).toBe('<span>옛 이름</span>')
    expect(html('GONE')).toBe('<span>GONE</span>')
    expect(renderToStaticMarkup(<Label code="TEAM_A" />)).toBe('<span>TEAM_A</span>')
  })
  it('같은 이름의 활성 팀이 둘이면 `이름 (code)` 로 가른다', () => {
    const dup = [...teamRows(['P1'], { id: 'd1', name: '기획팀' }), ...teamRows(['P2'], { id: 'd2', name: '기획팀', sortOrder: 1 })]
    expect(renderToStaticMarkup(<TeamsProvider teams={dup}><Label code="P2" /></TeamsProvider>)).toBe('<span>기획팀 (P2)</span>')
  })
})

describe('OwnerBadges — WBS 담당 표지', () => {
  const owners = [{ team: 'TEAM_A', kind: 'primary' as const }, { team: 'TEAM_B', kind: 'support' as const }, { team: 'GONE', kind: 'primary' as const }]
  it('글자와 title 은 팀 이름 — code 는 보이지 않는다(목록 밖 팀만 code)', () => {
    const html = renderToStaticMarkup(<TeamsProvider teams={teams}><OwnerBadges owners={owners} /></TeamsProvider>)
    expect(html).toContain('>기획팀</span>')
    expect(html).toContain('title="기획팀 주관"')
    expect(html).toContain(`title="${LONG} 지원"`)
    expect(html).not.toContain('TEAM_A')
    expect(html).toContain('>GONE</span>')
  })
  it('긴 이름은 줄인다 — 글자 칸에 truncate 와 상한 폭, 전체 이름은 title', () => {
    const html = renderToStaticMarkup(<TeamsProvider teams={teams}><OwnerBadges owners={[owners[1]]} /></TeamsProvider>)
    expect(html).toMatch(new RegExp(`<span class="[^"]*\\btruncate\\b[^"]*">${LONG}</span>`))
    expect(html).toMatch(/max-w-\[10rem\]/)
  })
  it('공급자가 없는 화면(공유)은 code 그대로 — 렌더가 깨지지 않는다', () => {
    expect(renderToStaticMarkup(<OwnerBadges owners={[owners[0]]} />)).toContain('>TEAM_A</span>')
  })
})

describe('TeamBar — 회의록 팀 막대', () => {
  it('글자는 이름, 선택자(data-team-bar)는 code, 색은 그 팀 슬롯 — 고정 폭(w-12)이 아니라 상한 폭 + 말줄임 + title', () => {
    const html = renderToStaticMarkup(<TeamsProvider teams={teams}><TeamBar code="TEAM_B" /></TeamsProvider>)
    expect(html).toContain('data-team-bar="TEAM_B"')
    expect(html).toContain(`title="${LONG}"`)
    expect(html).toContain(`<span class="truncate">${LONG}</span>`)
    expect(html).toContain('bg-category-2')
    expect(html).not.toMatch(/(?<![\w-])w-12\b/)
    expect(html).toMatch(/max-w-\[7rem\]/)
  })
  it('회의록 화면이 내려 준 이름(고른 프로젝트의 전용 팀)이 공급자보다 먼저다 — 모르는 code 는 공급자, 그것도 없으면 code', () => {
    const scoped = (code: string) => (code === 'DEDI' ? '전용 기획' : undefined)
    const html = (code: string) => renderToStaticMarkup(
      <TeamsProvider teams={teams}><TeamBarLabelsProvider value={scoped}><TeamBar code={code} shape="pill" /></TeamBarLabelsProvider></TeamsProvider>)
    expect(html('DEDI')).toContain('<span class="truncate">전용 기획</span>')
    expect(html('TEAM_A')).toContain('<span class="truncate">기획팀</span>')
    expect(html('GONE')).toContain('<span class="truncate">GONE</span>')
  })
  it('호출부가 준 title 은 그대로 둔다', () => {
    expect(renderToStaticMarkup(<TeamBar code="X" title="담당 팀" />)).toContain('title="담당 팀"')
  })
  it('팀 없는 회의록(code 빈 값 — 0052)은 같은 자리에 중립 색 "팀 없음"으로 그린다 — 공급자가 없는 공유 화면도 같다', async () => {
    for (const html of [
      renderToStaticMarkup(<TeamsProvider teams={teams}><TeamBar code="" /></TeamsProvider>),
      renderToStaticMarkup(<TeamsProvider teams={teams}><TeamBarLabelsProvider value={() => '엉뚱한 이름'}><TeamBar code="" shape="tag" /></TeamBarLabelsProvider></TeamsProvider>),
      renderToStaticMarkup(<TeamBar code="" shape="label" />),
    ]) {
      // 로케일 공급자 밖이라 사전 키가 그대로 나온다 — 글자는 사전(ko·en)이 정한다(아래)
      expect(html).toContain('data-team-bar=""')
      expect(html).toContain('<span class="truncate">min.team.none</span>')
      expect(html).toContain('title="min.team.none"')
      expect(html).not.toMatch(/bg-category-\d/)       // 어느 팀의 색도 아니다
    }
    await ensureEnLoaded()   // en 사전은 지연 등록이다
    expect([dictT('ko', 'min.team.none'), dictT('en', 'min.team.none')]).toEqual(['팀 없음', 'No team'])
    expect([dictT('ko', 'min.fold.noTeam'), dictT('en', 'min.fold.noTeam')]).toEqual(['팀 없음(미분류)', 'No team (unfiled)'])
  })
  it('팀 행이 지워진 옛 회의록은 빈 값이 아니라 옛 code 가 온다 — "팀 없음"이 아니라 그 code 글자다', () => {
    const html = renderToStaticMarkup(<TeamsProvider teams={teams}><TeamBar code="DELETED" /></TeamsProvider>)
    expect(html).toContain('<span class="truncate">DELETED</span>')
    expect(html).not.toContain('min.team.none')
  })
})

describe('TeamProgress — 대시보드 팀별 진척', () => {
  const leaf = (id: string, team: string, pct: number) => ({
    id, parentId: null, code: id, name: id, children: [], owners: [{ team, kind: 'primary' }], actualPct: pct, rolledActualPct: pct, weight: 1, effectiveWeight: 1,
  }) as unknown as ComputedItem
  it('행 글자는 팀 이름(집계 키 data-team-progress 는 code) — 긴 이름은 줄이고 title·진행 막대의 접근 이름도 이름이다', () => {
    const html = renderToStaticMarkup(<TeamProgress items={[leaf('a', 'TEAM_A', 40), leaf('b', 'TEAM_B', 80)]} teams={teams} />)
    expect(html).toContain('data-team-progress="TEAM_A"')
    expect(html).toContain('<span class="truncate">기획팀</span>')
    expect(html).toContain(`title="${LONG}"`)
    expect(html).toMatch(/aria-label="기획팀 진척 \d+%"/)
    expect(html).not.toContain('>TEAM_A<')
    // 비활성 팀은 행이 없다
    expect(html).not.toContain('옛 이름')
  })
  it('표시할 팀이 없으면 빈 상태 — 관리자에게만 팀 관리 링크, en 사전도 있다', () => {
    const empty = renderToStaticMarkup(<TeamProgress items={[]} teams={[]} teamSettingsHref="/p/p1/settings#project-team" />)
    expect(empty).toContain('표시할 팀이 없습니다')
    expect(empty).toContain('href="/p/p1/settings#project-team"')
    expect(empty).toContain('팀 추가하러 가기')
    const member = renderToStaticMarkup(<TeamProgress items={[]} teams={[]} />)
    expect(member).toContain('표시할 팀이 없습니다')
    expect(member).not.toContain('<a ')
    // 전부 숨김·비활성이어도 빈 카드가 아니라 사유를 보인다
    const hidden = renderToStaticMarkup(<TeamProgress items={[]} teams={teamRows(['TEAM_A'], { progressVisible: false })} />)
    expect(hidden).toContain('표시할 팀이 없습니다')
  })
})

describe('명단 — 팀 칩', () => {
  it('읽기 행의 팀 칩은 이름(목록 밖 팀은 code) — 긴 이름은 줄이고 title', () => {
    const member = {
      id: 'm1', name: '구성원 A', email: null, active: true, roleLabel: null, title: null, accessRole: 'member', userId: null,
      teams: [{ id: 't-b', code: 'TEAM_B' }, { id: 't-x', code: 'GONE' }],
    } as unknown as RosterMember
    const html = renderToStaticMarkup(
      <TeamsProvider teams={teams}><table><tbody><RosterReadRow member={member} /></tbody></table></TeamsProvider>)
    expect(html).toContain(`title="${LONG}"`)
    expect(html).toMatch(/class="chip [^"]*\btruncate\b/)
    expect(html).toContain('>GONE</span>')
    expect(html).not.toContain('>TEAM_B<')
  })
})
