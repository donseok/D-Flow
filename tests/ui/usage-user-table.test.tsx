import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsageUserTable } from '@/components/usage/UsageUserTable'
import type { UsageUserRow } from '@/lib/domain/usage'

const row = (id: string, role: UsageUserRow['role']): UsageUserRow => ({
  id, email: `${id}@example.com`, name: id, teamCode: null, role,
  createdAt: '2026-01-01T00:00:00Z', lastSignInAt: null, events: 0, activeDays: 0, lastActivityAt: null,
})
const cells = (html: string) => [...html.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map(m => m[1])

describe('UsageUserTable — 역할 열(워크스페이스 역할 어휘)', () => {
  it('admin 은 관리자, member 는 멤버, 역할 없음은 —', () => {
    const html = renderToStaticMarkup(
      <UsageUserTable rows={[row('alice', 'admin'), row('bob', 'member'), row('carol', null)]} days={30} timeZone="Asia/Seoul" />,
    )
    const c = cells(html)
    // 행마다 이름·이메일·팀·역할 순 — 역할은 네 번째 칸
    expect([c[3], c[12], c[21]]).toEqual(['관리자', '멤버', '—'])
    expect(html).not.toMatch(/팀 편집자|pmo_admin|team_editor/)
  })
})
