import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { linkifyMinutePaths } from '@/components/minutes/linkify'

const M = '00000000-0000-0000-7e57-000000001703'
describe('linkify — 두 형식을 통째로 링크(D6)', () => {
  it('새 형식은 /w/<s> 를 잘라내지 않는다', () => {
    const html = renderToString(<>{linkifyMinutePaths(`참고: /w/acme/minutes/${M} 와 /minutes/${M}`)}</>)
    expect(html).toContain(`href="/w/acme/minutes/${M}"`)
    expect(html).toContain(`href="/minutes/${M}"`)
    expect(html).not.toContain(`/w/acme<a`)
  })
})
