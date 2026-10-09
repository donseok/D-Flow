import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale({ also: ['login.email', 'login.password'] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/app/actions/inviteRedeem', () => ({ getInviteSessionState: vi.fn(), redeemInvite: vi.fn(), redeemInviteWithSignup: vi.fn() }))
import { InviteRedeemCard } from '@/components/invite/InviteRedeemCard'
import type { InvitePreview } from '@/app/actions/inviteRedeem'
const preview: InvitePreview = { projectName: 'Acme 구축', projectDescription: null, maskedEmail: 'a***@example.com', status: 'active', accountExists: true, teamNames: [], workspaceName: 'Acme', accessRole: 'member' }
const render = (over: Partial<InvitePreview> = {}) => renderToStaticMarkup(<InviteRedeemCard token="t" preview={{ ...preview, ...over }} loadError={null} />)
describe('초대 화면의 소속·받을 권한', () => {
  it('워크스페이스·프로젝트·권한·가린 이메일 순서로 표시한다', () => {
    const html = render()
    for (const s of ['Acme', 'Acme 구축', '멤버', 'a***@example.com']) expect(html).toContain(s)
    expect(html).toMatch(/워크스페이스[\s\S]*프로젝트[\s\S]*받을 권한[\s\S]*초대된 이메일/)
  })
  it.each([['admin', '관리자'], [null, '조회 전용']] as const)('권한 %s 표시', (accessRole, label) => { expect(render({ accessRole })).toContain(label) })
  it.each(['expired', 'revoked', 'redeemed'] as const)('비활성 %s에서는 식별 정보를 표시하지 않는다', status => {
    const html = render({ status })
    for (const s of ['Acme', 'a***@example.com', '받을 권한']) expect(html).not.toContain(s)
  })
})
