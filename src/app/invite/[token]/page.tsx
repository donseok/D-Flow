import { notFound } from 'next/navigation'
import { getInvitePreview } from '@/app/actions/inviteRedeem'
import { serviceRoleConfigured } from '@/lib/supabase/env'
import { BrandGlyph } from '@/components/ui/BrandMark'
import { BRAND } from '@/lib/branding'
import { InviteRedeemCard } from '@/components/invite/InviteRedeemCard'
import { t } from '@/lib/i18n/dict'

// 초대의 취소·소비·만료가 다음 요청부터 즉시 반영되도록 정적 캐시 금지
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false } }

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // env 가드 — 미설정 배포에서 500 대신 404 (share 페이지 선례)
  if (!serviceRoleConfigured()) {
    console.error('[invite] service_role 환경변수 미설정 — 초대 페이지 비활성')
    notFound()
  }
  // 여기서 세션을 읽지 않는다(설계 P8). /invite 는 미들웨어 matcher 밖이라 토큰 갱신을 받지 못하고,
  // RSC 에서 쿠키 쓰기는 예외를 던진다 — 만료 토큰을 가진 사용자에게 500 이 된다.
  // 세션 판정은 InviteRedeemCard 가 마운트 후 서버 액션(getInviteSessionState)으로 물어본다 —
  // 액션은 쿠키를 쓸 수 있어 만료 토큰 갱신이 정상 동작한다.
  const res = await getInvitePreview(token)
  // 제품 이름·모노그램은 초대한 워크스페이스의 설정(branding.product_name)을 따른다 — 활성 초대에서만 실려 온다. 그 밖(만료·취소·오류)은 배포 기본 이름
  const productName = (res.ok && res.preview.productName) || BRAND.productName

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandGlyph size={48} productName={productName} />
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg">{t('invite.pageTitle').replace('{product}', () => productName)}</h1>
            <p className="mt-1 text-sm text-fg-secondary">{t('invite.pageLead')}</p>
          </div>
        </div>
        <InviteRedeemCard
          token={token}
          preview={res.ok ? res.preview : null}
          loadError={res.ok ? null : res.error}
        />
      </div>
    </div>
  )
}
