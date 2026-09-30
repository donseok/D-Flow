import { DEFAULT_PRODUCT_NAME } from '@/lib/branding'

export type BrandMarkChoice =
  | { kind: 'image'; src: string }
  | { kind: 'flow' }
  | { kind: 'monogram'; letter: string }

/** A mark wins; otherwise the product name determines the decorative glyph. */
export function resolveBrandMark(productName: string, markSrc: string | null): BrandMarkChoice {
  if (markSrc) return { kind: 'image', src: markSrc }
  if (productName === DEFAULT_PRODUCT_NAME) return { kind: 'flow' }
  return { kind: 'monogram', letter: Array.from(productName)[0] ?? '' }
}
