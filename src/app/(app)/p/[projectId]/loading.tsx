'use client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Skeleton } from '@/components/ui/Skeleton'

/**
 * 프로젝트 세그먼트 공용 로딩 폴백 — wbs·weekly·meetings·settings 를 한 파일로 덮는다.
 *
 * 이 파일이 반드시 `p/[projectId]` 레벨에 있어야 하는 이유:
 * Next 의 로딩 폴백은 "부모 세그먼트"의 loading.tsx 이고, 그 Suspense 는 자식 세그먼트 키로
 * 마운트된다. /p/x/dashboard → /p/x/wbs 이동은 (app) 기준으로 자식 세그먼트가 계속 `p` 라
 * (app)/loading.tsx 의 경계가 재마운트되지 않는다. 즉 프로젝트 내부 메뉴 이동은 상위 폴백이
 * 덮지 못하고 이 위치에서만 덮인다 — (app)/loading.tsx 가 있으니 괜찮다고 보면 오판이다.
 *
 * 자체 loading.tsx 를 가진 형제(dashboard·kanban·members·attendance·announcements)는
 * 더 구체적인 자기 파일이 우선하므로 이 폴백의 영향을 받지 않는다.
 */
export default function Loading() {
  const { t } = useLocale()
  return (
    <div className="flex h-full min-h-0 flex-col gap-5" role="status" aria-label={t('pages.loading.screen')}>
      {/* 페이지 머리(PageHeader — 64, 컴팩트 48) 자리 — 그 높이에 맞춰 로드 완료 시 세로 시프트가 없게 한다 */}
      <Skeleton className="h-16 shrink-0 rounded-3xl [@media(max-width:1279px),(max-height:799px)]:h-12" />
      <div className="min-h-0 flex-1 space-y-4">
        {/* 툴바 행 — 뷰 전환·주차 이동·필터 등 화면마다 내용은 달라도 위치는 공통 */}
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-10 w-64 rounded-xl" />
          <Skeleton className="h-10 w-40 rounded-xl" />
        </div>
        <Skeleton className="h-[420px] rounded-2xl" />
      </div>
    </div>
  )
}
