// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TeamsProvider, useTeamCodes, useTeamLabel, useTeamSlot, useTeams } from '@/components/app/TeamsProvider'
import type { Team } from '@/lib/domain/teams'

function Codes() {
  return <span>{useTeamCodes().join(',')}</span>
}
function Progress() {
  return <span>{useTeams().filter(t => t.progressVisible).map(t => t.code).join(',')}</span>
}

describe('TeamsProvider', () => {
  it('provider 가 없으면 팀 없음 — 원본 5팀으로 폴백하지 않는다', () => {
    expect(renderToStaticMarkup(<Codes />)).toBe('<span></span>')
    expect(renderToStaticMarkup(<Progress />)).toBe('<span></span>')
  })

  it('주입된 팀 목록을 정렬·활성 필터해 반환', () => {
    const teams: Team[] = [
      { id: '2', code: '신팀', name: '신팀', color: '#6b7280', sortOrder: 5, active: true, progressVisible: false, projectId: null, workspaceId: 'ws-1' },
      { id: '1', code: 'PMO', name: 'PMO', color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
      { id: '3', code: '구팀', name: '구팀', color: '#6b7280', sortOrder: 9, active: false, progressVisible: true, projectId: null, workspaceId: 'ws-1' },
    ]
    expect(renderToStaticMarkup(<TeamsProvider teams={teams}><Codes /></TeamsProvider>))
      .toContain('PMO,신팀')
    expect(renderToStaticMarkup(<TeamsProvider teams={teams}><Progress /></TeamsProvider>))
      .toContain('>PMO<')
  })

  // 비활성 팀이 담당인 항목·회의록 — 선택지에는 없지만 글자는 이름이어야 한다(code 로 떨어지지 않는다)
  describe('비활성 팀의 라벨', () => {
    const t = (id: string, code: string, name: string, active: boolean): Team =>
      ({ id, code, name, color: '#2563eb', sortOrder: 0, active, progressVisible: true, projectId: null, workspaceId: 'ws-1' })
    function Labels({ codes }: { codes: string[] }) {
      const label = useTeamLabel()
      return <span>{codes.map(label).join('|')}</span>
    }
    function SlotNeutral({ code }: { code: string }) {
      const slot = useTeamSlot()
      return <span>{JSON.stringify(slot(code)) === JSON.stringify(slot('없는팀')) ? 'neutral' : 'colored'}</span>
    }
    it('비활성 팀은 이름으로 보이고, 선택지(useTeamCodes)에는 없다', () => {
      const teams = [t('1', 'OPS', '운영', true), t('2', 'OLD', '옛 조직', false)]
      const html = renderToStaticMarkup(<TeamsProvider teams={teams}><Labels codes={['OPS', 'OLD', 'NOPE']} /><Codes /></TeamsProvider>)
      expect(html).toContain('<span>운영|옛 조직|NOPE</span>')
      expect(html).toContain('<span>OPS</span>')
    })
    it('비활성 팀의 이름이 활성 팀과 겹쳐도 활성 팀의 글자는 그대로다 — 비활성 쪽만 code 를 덧붙인다', () => {
      const teams = [t('1', 'OPS', '운영', true), t('2', 'OLD', '운영', false)]
      expect(renderToStaticMarkup(<TeamsProvider teams={teams}><Labels codes={['OPS', 'OLD']} /></TeamsProvider>))
        .toContain('<span>운영|운영 (OLD)</span>')
    })
    it('같은 code 의 활성·비활성 팀이 있으면 활성 팀의 이름이다', () => {
      const teams = [t('2', 'OPS', '옛 운영', false), t('1', 'OPS', '운영', true)]
      expect(renderToStaticMarkup(<TeamsProvider teams={teams}><Labels codes={['OPS']} /></TeamsProvider>)).toContain('<span>운영</span>')
    })
    it('색 슬롯은 활성 팀만 — 비활성 팀은 중립 그대로다', () => {
      const teams = [t('1', 'OPS', '운영', true), t('2', 'OLD', '옛 조직', false)]
      expect(renderToStaticMarkup(<TeamsProvider teams={teams}><SlotNeutral code="OLD" /></TeamsProvider>)).toContain('neutral')
    })
  })
})
