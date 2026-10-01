import { Skeleton } from '@/components/ui/Skeleton'

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1440px]" role="status" aria-label="프로젝트를 불러오는 중">
      {/* 페이지 머리 */}
      <div className="flex min-h-16 items-center justify-between gap-3 py-3">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="card flex min-h-[184px] flex-col p-5">
            <div className="flex items-start justify-between">
              <Skeleton className="h-12 w-12 rounded-2xl" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-full rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
            </div>
            <div className="mt-auto flex items-center justify-between border-t border-line pt-4">
              <Skeleton className="h-3 w-28 rounded" />
              <Skeleton className="h-3 w-10 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
