import { describe, expect, it } from 'vitest'
import { verifyBotSources } from '@/lib/ai/chat/verifier'

const M = '00000000-0000-0000-7e57-000000001702'
const src = (href: string) => ({
  id: href, entityId: M, entityType: 'minute' as const, domain: 'minutes' as const, projectId: null, title: '회의록', href, updatedAt: null,
})
const verify = (hrefs: string[]) => verifyBotSources(hrefs.map(src), { allowedProjectIds: [] }).sources.map((s) => s.href)

describe('verifier — 회의록 출처는 두 형식(D6)', () => {
  it('옛 /minutes/<id> 와 새 /w/<s>/minutes/<id> 를 받고, 다른 id·다른 조각은 거른다', () => {
    // 같은 회의록 출처는 중복 제거되므로 형식마다 따로 검증한다
    expect(verify([`/minutes/${M}`])).toEqual([`/minutes/${M}`])
    expect(verify([`/w/acme/minutes/${M}`])).toEqual([`/w/acme/minutes/${M}`])
    expect(verify([`/w/acme/minutes/other`, `/w/acme/agents`, `/w/acme/minutes`])).toEqual([])
  })
  it('워크스페이스 머리 뒤에 프로젝트 경로를 붙여 다른 도메인 뿌리를 흉내 낼 수 없다', () => {
    const p = '00000000-0000-0000-7e57-000000001799'
    const wbs = { id: 'w', entityId: 'a', entityType: 'wbs_item' as const, domain: 'wbs' as const, projectId: p, title: 'x', updatedAt: null }
    const r = verifyBotSources([
      { ...wbs, href: `/p/${p}/wbs?focus=a` },
      { ...wbs, id: 'w2', href: `/w/acme/p/${p}/wbs?focus=a` },
    ], { allowedProjectIds: [p] })
    expect(r.sources.map((s) => s.id)).toEqual(['w'])
  })
  it('형식 밖 슬러그 머리·외부 주소는 거른다', () => {
    expect(verify([`/w/A/minutes/${M}`, `/w/-x/minutes/${M}`, `//evil.example/w/acme/minutes/${M}`, `/w//minutes/${M}`])).toEqual([])
  })
})
