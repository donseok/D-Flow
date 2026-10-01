import { describe, expect, it } from 'vitest'
import { resolveStartPath } from '@/lib/workspace/startPage'

const ws = { slug: 'acme' }
const P1 = '00000000-0000-0000-7e57-0000000016f1', P2 = '00000000-0000-0000-7e57-0000000016f2'
describe('resolveStartPath — D44', () => {
  it('네 값', () => {
    expect(resolveStartPath(ws, {}, () => true)).toBe('/w/acme')
    expect(resolveStartPath(ws, { startPage: 'home' }, () => true)).toBe('/w/acme')
    expect(resolveStartPath(ws, { startPage: 'my_work' }, () => true)).toBe('/w/acme/my-work')
    expect(resolveStartPath(ws, { startPage: 'projects' }, () => true)).toBe('/projects')
    expect(resolveStartPath(ws, { startPage: 'last_project', recentProjects: [{ id: P1, at: 'x' }, { id: P2, at: 'y' }] }, (id) => id === P2)).toBe(`/p/${P2}/dashboard`)
  })
  it('최근 프로젝트가 모두 접근 불가·없음·모르는 값은 home', () => {
    expect(resolveStartPath(ws, { startPage: 'last_project', recentProjects: [{ id: P1, at: 'x' }] }, () => false)).toBe('/w/acme')
    expect(resolveStartPath(ws, { startPage: 'last_project' }, () => true)).toBe('/w/acme')
    expect(resolveStartPath(ws, { startPage: 'nope' as never }, () => true)).toBe('/w/acme')
  })
  it('최근 프로젝트 id 가 uuid 꼴이 아니면 건너뛴다(저장된 값이 경로에 그대로 들어가지 않게)', () => {
    expect(resolveStartPath(ws, { startPage: 'last_project', recentProjects: [{ id: '../../admin', at: 'x' }, { id: P1, at: 'y' }] }, () => true)).toBe(`/p/${P1}/dashboard`)
  })
})
