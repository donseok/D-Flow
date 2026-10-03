import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IssueQueueCard } from '@/components/dashboard/IssueQueueCard'
import { walk } from '../invariants/_walk'
import { DASH_ISSUE } from './_dashboard-fixture'

describe('opaque issue code display', () => {
  it('queue shows the issued code', () => {
    const html = renderToStaticMarkup(<IssueQueueCard issues={[{ ...DASH_ISSUE, code: 'RS-RND-007' }]} projectId="p1" today="2026-09-27" locale="ko" />)
    expect(html).toContain('RS-RND-007')
  })
  it('screens and index never build a public number from issueNo', () => {
    const patterns = [/#\$\{[^}]*\bissue_?[nN]o\b[^}]*\}/, /['"`]#['"`]\s*\+\s*[\w.?]*\bissue_?[nN]o\b/]
    const files = ['src/components', 'src/app', 'src/lib/ai/index'].flatMap(d => walk(d))
    expect(files.filter(f => patterns.some(re => re.test(readFileSync(f, 'utf8'))))).toEqual([])
  })
})
