// 제품 브랜드 단일 출처(SP0). SP3 에서 workspace_settings.values.branding 으로 승격한다.
// NEXT_PUBLIC_* 은 빌드 시 서버·클라이언트 번들 양쪽에 인라인된다 — 비밀을 두지 않고, 바꾸면 재배포해야 한다.
// 메일 발신명(MAIL_FROM_NAME, 서버 전용)은 여기 두지 않는다 — src/lib/mail/fromName.ts.
const pick = (v: string | undefined, fallback: string) => (v && v.trim() ? v.trim() : fallback)

export const DEFAULT_PRODUCT_NAME = 'D-Flow'

/** 포털 아이콘 — 명시값 'flow'|'monogram' 이 우선이다. 비었거나 모르는 값이면 제품명이 기본(D-Flow)일 때만 flow(D 글리프),
 *  아니면 제품명 첫 글자 monogram 이다. 화이트라벨 배포가 D 글리프를 달고 나오지 않게 한다.
 *  파비콘·apple-icon(src/app/icon.tsx 등)의 D 고정은 여기서 다루지 않는다 — SP3 branding.logo 에서 정한다. */
export function resolvePortalIcon(raw: string | undefined, productName: string): 'flow' | 'monogram' {
  const v = raw?.trim()
  if (v === 'flow' || v === 'monogram') return v
  return productName === DEFAULT_PRODUCT_NAME ? 'flow' : 'monogram'
}

const productName = pick(process.env.NEXT_PUBLIC_BRAND_NAME, DEFAULT_PRODUCT_NAME)

export const BRAND = {
  productName,
  /** 포털 아이콘(/projects 선적용) — resolvePortalIcon 참고. */
  portalIcon: resolvePortalIcon(process.env.NEXT_PUBLIC_BRAND_PORTAL_ICON, productName),
  /** 한국어 태그라인. env 한 줄은 한 언어뿐이라 en 화면은 i18n `brand.tagline` 을 쓴다(BrandMark). */
  tagline: pick(process.env.NEXT_PUBLIC_BRAND_TAGLINE, '일하는 방식이 바뀌다'),
  /** 비면 로그인 화면에 저작권 줄을 그리지 않는다. */
  copyright: pick(process.env.NEXT_PUBLIC_BRAND_COPYRIGHT, ''),
} as const

/** AI 어시스턴트 표시명 — 고객 브랜드와 무관한 중립명. */
export const ASSISTANT_NAME = { ko: 'AI 어시스턴트', en: 'AI Assistant' } as const
