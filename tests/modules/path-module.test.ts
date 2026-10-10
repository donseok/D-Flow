// 경로 → 모듈(BUG-22 의 안내 판정이 쓴다) — 페이지 관문과 같은 표(routePrefixes)·같은 규칙(세그먼트 접두 일치).
import { describe, expect, it } from 'vitest'
import { moduleOfPath } from '@/lib/modules/pathModule'

const P = '00000000-0000-0000-7e57-0000000016f5'
describe('moduleOfPath', () => {
  it('프로젝트 화면 — 모듈 조각과 그 아래 주소', () => {
    expect(moduleOfPath(`/p/${P}/issues`)).toEqual({ scope: 'project', projectId: P, moduleId: 'issues' })
    expect(moduleOfPath(`/p/${P.toUpperCase()}/wiki/topics/t1?x=1#y`)).toEqual({ scope: 'project', projectId: P, moduleId: 'wiki' })
    expect(moduleOfPath(`/p/${P}/import`)).toMatchObject({ moduleId: 'wbs' })
    expect(moduleOfPath(`/p/${P}/agents/office`)).toMatchObject({ moduleId: 'agents' })
  })
  it('워크스페이스 화면', () => {
    expect(moduleOfPath('/w/default/minutes/abc')).toEqual({ scope: 'workspace', slug: 'default', moduleId: 'minutes' })
    expect(moduleOfPath('/w/default/meetings')).toMatchObject({ moduleId: 'meetings' })
  })
  it('세그먼트 접두만 — 이름이 비슷한 조각은 다른 화면이다', () => {
    expect(moduleOfPath(`/p/${P}/issues-old`)).toBeNull()
  })
  it('모듈 밖 주소·형식 밖 id 는 null', () => {
    for (const path of [`/p/${P}`, '/w/default', '/w/default/projects', '/w/default/settings', '/account', '/', '/p/not-a-uuid/issues', '/w/Bad_Slug/minutes']) {
      expect(moduleOfPath(path), path).toBeNull()
    }
  })
})
