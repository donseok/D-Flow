import { BrandMark } from '@/components/ui/BrandMark'

export interface ShellBrand { productName: string; workspaceId: string | null; hasFull: boolean; hasFullDark: boolean; hasMark: boolean }

/**
 * 셸 로고(★8, D24) — 전체 로고 136×28 contain(라이트·다크 두 클래스, display 유틸 없음 — 크기별 전환은 바깥 래퍼), 접힘·좁은 바는 마크 28×28.
 * 다크 전용 로고가 없으면 라이트 로고를 중립 배경판에 얹어 다크에서 보이게 한다(배경판도 .brand-logo-dark — display 유틸 없음).
 */
export function BrandSlot({ brand, compact }: { brand: ShellBrand; compact: boolean }) {
  const src = (slot: 'full' | 'full_dark') => `/api/brand/${encodeURIComponent(brand.workspaceId ?? '')}/${slot}`
  if (!compact && brand.hasFull && brand.workspaceId) {
    return (
      <span className="relative inline-flex h-7 w-34 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src('full')} alt={brand.productName} className="brand-logo-light h-7 w-34 object-contain" />
        {brand.hasFullDark
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={src('full_dark')} alt={brand.productName} className="brand-logo-dark h-7 w-34 object-contain" />
          : <span data-logo-plate className="brand-logo-dark rounded-(--radius-control) border border-border bg-surface-raised px-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src('full')} alt={brand.productName} className="h-7 w-32 object-contain" />
            </span>}
      </span>
    )
  }
  return <BrandMark productName={brand.productName} hasMark={brand.hasMark} workspaceId={brand.workspaceId} size={28} />
}
