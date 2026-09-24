'use client'

import { useLocale } from '@/components/providers/LocaleProvider'
import { BRAND } from '@/lib/branding'

/**
 * 제품 브랜드 마크.
 *
 * - `BrandGlyph` : 제품명 첫 글자 모노그램을 라운드 스퀘어로 렌더 — 헤더·로그인 페이지가 공용.
 * - `BrandMark`  : 로고 글리프 + 선택적 워드마크(BRAND.productName) + 선택적 태그라인.
 *
 * 이미지 에셋 대신 BRAND 에서 그려 제품명을 바꾸면 로고도 함께 바뀐다.
 */

/** 제품명 모노그램 라운드 스퀘어 마크. 헤더/컴팩트 자리와 로그인 페이지에서 사용. */
export function BrandGlyph({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), boxShadow: 'var(--shadow-sm)' }}
      aria-hidden
    >
      <span className="flex h-full w-full items-center justify-center bg-brand font-bold text-white" style={{ fontSize: Math.round(size * 0.46) }}>
        {BRAND.productName.slice(0, 1)}
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
  if (!withWordmark) return <BrandGlyph size={size} className={className} />

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandGlyph size={size} />
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
