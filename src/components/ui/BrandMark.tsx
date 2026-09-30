'use client'

import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useLocale } from '@/components/providers/LocaleProvider'
import { BRAND } from '@/lib/branding'
import { resolveBrandMark, type BrandMarkChoice } from '@/lib/settings/brandMark'

/**
 * 제품 브랜드 마크.
 *
 * - `BrandGlyph` : 기본 모노그램 또는 새 flow 벡터 아이콘.
 * - `BrandMark`  : 로고 글리프 + 선택적 워드마크(BRAND.productName) + 선택적 태그라인.
 *
 * 새 아이콘은 /projects 포털에서 먼저 적용한다.
 * 다른 화면은 기존 제품명 모노그램을 유지한다.
 */

/** 장식용 브랜드 아이콘. 접근 가능한 제품명은 호출부의 텍스트/링크 레이블이 제공한다. */
export function BrandGlyph({ size = 40, className = '', variant = 'monogram', choice, productName = BRAND.productName }: {
  size?: number
  className?: string
  variant?: 'monogram' | 'flow'
  choice?: BrandMarkChoice
  productName?: string
}) {
  if (choice?.kind === 'image') return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={choice.src} alt="" aria-hidden="true" width={size} height={size}
      className={`inline-block shrink-0 object-contain ${className}`} style={{ width: size, height: size }} />
  )
  if (choice?.kind === 'flow' || (!choice && variant === 'flow')) {
    return (
      <Image
        src="/brand/dflow-flow.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        unoptimized
        className={`inline-block shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), boxShadow: 'var(--shadow-sm)' }}
      aria-hidden
    >
      <span className="flex h-full w-full items-center justify-center bg-brand font-bold text-white" style={{ fontSize: Math.round(size * 0.46) }}>
        {choice?.kind === 'monogram' ? choice.letter : Array.from(productName)[0]}
      </span>
    </span>
  )
}

/**
 * 글리프 + 워드마크. 기본은 글리프만, `withWordmark` 로 제품명(BRAND.productName) 텍스트, `tagline` 으로 한 줄 태그라인.
 * 워드마크 텍스트 색은 토큰(text-ink/ink-subtle)이라 라이트/다크 모두 대응.
 */
export function BrandMark({
  size = 40,
  withWordmark = false,
  tagline = false,
  className = '',
}: {
  size?: number
  withWordmark?: boolean
  tagline?: boolean
  className?: string
}) {
  const { t, locale } = useLocale()
  const pathname = usePathname()
  const choice = pathname === '/projects' ? resolveBrandMark(BRAND.productName, null) : undefined
  if (!withWordmark) return <BrandGlyph size={size} className={className} choice={choice} />

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandGlyph size={size} choice={choice} />
      <span className="leading-tight">
        <span className="block font-bold tracking-tight text-ink" style={{ fontSize: Math.round(size * 0.4) }}>
          {BRAND.productName}
        </span>
        {tagline && (
          <span className="block text-ink-subtle" style={{ fontSize: Math.round(size * 0.26) }}>
            {/* ko 는 BRAND.tagline(env 로 교체 가능). env 한 줄은 한 언어뿐이라 en 은 번역 사전을 쓴다. */}
            {locale === 'en' ? t('brand.tagline') : BRAND.tagline}
          </span>
        )}
      </span>
    </span>
  )
}
