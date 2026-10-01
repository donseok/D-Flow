import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PresenceStrip } from '@/components/app/PresenceStrip'
import { presenceStyle } from '@/lib/domain/sheetPresence'

describe('PresenceStrip — 아바타 글자색은 배경 짝(보충 3)', () => {
  it('흰 글자 유틸이 없고 배경·글자색을 인라인 짝으로 낸다', () => {
    const online = Array.from({ length: 7 }, (_, i) => ({ userId: `u${i}`, name: `사람${i}` }))
    const html = renderToString(<PresenceStrip online={online} meId="u0" />)
    expect(html).not.toContain('text-white')
    const s = presenceStyle('u1')
    expect(html).toContain(`color:${s.color}`)
    expect(html).toMatch(/\+(?:<!-- -->)?2</)
  })
})
