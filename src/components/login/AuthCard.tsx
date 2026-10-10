import { BrandGlyph } from '@/components/ui/BrandMark'

/**
 * 로그인 밖의 인증 화면(재설정 메일 요청·새 비밀번호 설정)의 틀 — 가운데 카드 하나. 의미 토큰만 쓴다(로그인 화면과 같은 규칙, 스펙 §4.4).
 * 화면의 h1 은 여기 하나다(page-h1 불변식의 허용 목록).
 */
export function AuthCard({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6 py-12 text-fg">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandGlyph size={56} />
          <h1 className="text-title text-fg">{title}</h1>
          {lead && <p className="text-body text-fg-secondary">{lead}</p>}
        </div>
        <div className="w-full rounded-(--radius-panel) border border-border bg-surface shadow-(--shadow-card) p-6 sm:p-8">{children}</div>
      </div>
    </div>
  )
}

/** 인증 화면 입력의 공통 모양 — 로그인 화면의 inputBase 와 같은 토큰 */
export const authInput =
  'h-11 w-full rounded-(--radius-control) border border-border-input bg-surface px-4 text-base text-fg outline-none transition-[border-color] duration-(--motion-fast) placeholder:text-fg-muted focus:border-border-focus focus:ring-2 focus:ring-border-focus/25'
export const authLabel = 'mb-2 block text-meta font-semibold text-fg-secondary'
export const authLink = 'font-semibold text-action underline underline-offset-2 hover:text-action-hover'
