import { describe, expect, it } from 'vitest'
import { LEGACY_ROUTES, carryQuery, legacyTarget, type LegacyKind } from '@/lib/workspace/legacy'

describe('carryQuery — 원래 쿼리만(Review Focus 3)', () => {
  it('_rsc·__nextDataReq 를 빼고 순서·중복·인코딩을 지킨다', () => {
    expect(carryQuery('?view=x&_rsc=abc&team=A&team=B')).toBe('?view=x&team=A&team=B')
    expect(carryQuery('?__nextDataReq=1')).toBe('')
    expect(carryQuery('?q=%3F%23%26')).toBe('?q=%3F%23%26')
    expect(carryQuery('')).toBe('')
  })
})

describe('legacyTarget — 옛 경로 → 새 경로 변환표(§5.3)', () => {
  const cases: [LegacyKind, string, string, string | null, string, string][] = [
    ['projects', '/projects', '?new=1', 'acme', '/w/acme/projects', '?new=1'],
    ['meetings', '/meetings', '', 'acme', '/w/acme/meetings', ''],
    ['minutes', '/minutes', '?view=calendar', 'acme', '/w/acme/minutes', '?view=calendar'],
    ['minute', '/minutes/00000000-0000-0000-7e57-000000001609', '?block=2&version=v1&_rsc=z', 'beta', '/w/beta/minutes/00000000-0000-0000-7e57-000000001609', '?block=2&version=v1'],
    ['agents', '/agents', '', 'acme', '/w/acme/agents', ''],
    ['portfolio', '/portfolio', '', 'acme', '/w/acme/portfolio', ''],
    ['usage', '/usage', '?days=30', 'acme', '/w/acme/usage', '?days=30'],
    ['adminAccounts', '/admin/accounts', '?project=p1', 'beta', '/w/beta/admin/accounts', '?project=p1'],
    ['adminTeams', '/admin/teams', '', 'acme', '/w/acme/admin/teams', ''],
  ]
  for (const [kind, path, search, slug, outPath, outSearch] of cases) {
    it(`${kind} ${path}${search}`, () => { expect(legacyTarget(kind, path, search, slug)).toEqual({ path: outPath, search: outSearch }) })
  }
  it('소속 0(slug null)이면 / — 리졸버의 소속 없음 화면', () => {
    expect(legacyTarget('meetings', '/meetings', '?x=1', null)).toEqual({ path: '/', search: '' })
  })
  it('칸반(UI-3 스텁)은 view → group, 나머지 쿼리 그대로(D36)', () => {
    expect(legacyTarget('kanban', '/p/p1/kanban', '?view=phase&team=X', null)).toEqual({ path: '/p/p1/wbs', search: '?view=board&group=phase&team=X' })
    expect(legacyTarget('kanban', '/p/p1/kanban', '', null)).toEqual({ path: '/p/p1/wbs', search: '?view=board' })
  })
  it('간트(S-1 ① 대안 — 컨트롤러 W1)는 view=timeline 고정, 나머지 쿼리 보존·_rsc 제거, 슬러그 없이', () => {
    expect(legacyTarget('gantt', '/p/p1/gantt', '', null)).toEqual({ path: '/p/p1/wbs', search: '?view=timeline' })
    expect(legacyTarget('gantt', '/p/p1/gantt', '?scale=24&view=board&team=A&team=B&_rsc=z', 'acme')).toEqual({ path: '/p/p1/wbs', search: '?view=timeline&scale=24&team=A&team=B' })
  })
  it('표는 열한 종류를 모두 가진다', () => {
    expect(Object.keys(LEGACY_ROUTES).sort()).toEqual(['adminAccounts', 'adminTeams', 'agents', 'gantt', 'kanban', 'meetings', 'minute', 'minutes', 'portfolio', 'projects', 'usage'])
  })
})
