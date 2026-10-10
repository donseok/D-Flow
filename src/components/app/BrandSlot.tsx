import { BrandMark } from '@/components/ui/BrandMark'

export interface ShellBrand { productName: string; workspaceId: string | null; hasFull: boolean; hasMark: boolean }

/** 셸 로고(★8, D24) — 전체 로고 136×28 contain(display 유틸 없음 — 크기별 전환은 바깥 래퍼), 접힘·좁은 바는 마크 28×28. */
export function BrandSlot({ brand, compact }: { brand: ShellBrand; compact: boolean }) {
  if (!compact && brand.hasFull && brand.workspaceId) {
    return (
      <span className="relative inline-flex h-7 w-34 items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/brand/${encodeURIComponent(brand.workspaceId)}/full`} alt={brand.productName} className="h-7 w-34 object-contain" />
      </span>
    )
  }
  return <BrandMark productName={brand.productName} hasMark={brand.hasMark} workspaceId={brand.workspaceId} size={28} />
}
