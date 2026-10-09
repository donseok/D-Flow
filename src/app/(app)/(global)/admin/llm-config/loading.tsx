'use client'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Skeleton } from '@/components/ui/Skeleton'

// LLM 설정 화면 폴백 — 옛 admin 세그먼트 폴백(2026-08-18 성능 감사)을 (global) 이동(과제 31)과 함께 이 화면으로 옮겼다.
// 계정·공용 팀 관리는 /w/[slug]/admin/** 로 갔다(UI-2a) — 그쪽은 워크스페이스 범위 loading.tsx 가 덮는다.
export default function Loading() {
  const { t } = useLocale()
  return (
    <div className="space-y-4" role="status" aria-label={t('pages.loading.admin')}>
      <Skeleton className="h-9 w-52 rounded-xl" />
      <div className="panel-soft space-y-2.5 p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    </div>
  )
}
