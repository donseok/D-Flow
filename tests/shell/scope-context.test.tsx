import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ScopeProvider, useScope } from '@/components/app/ScopeContext'

function Probe() { const s = useScope(); return <a href={s?.workspace ? `/w/${s.workspace.slug}/minutes` : '#none'}>x</a> }
describe('useScope — 동기 컨텍스트(D38 ①)', () => {
  it('SSR HTML 에 슬러그가 있다(효과를 기다리지 않는다)', () => {
    const html = renderToString(<ScopeProvider value={{ workspace: { id: 'w', slug: 'acme', name: 'Acme' }, projectId: null }}><Probe /></ScopeProvider>)
    expect(html).toContain('href="/w/acme/minutes"')
  })
  it('공급자 밖은 null', () => { expect(renderToString(<Probe />)).toContain('#none') })
})
