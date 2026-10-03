import { Skeleton } from '@/components/ui/Skeleton'
export default function Loading() {
  return <div className="mx-auto w-full max-w-[1440px]" role="status" aria-label="프로젝트를 불러오는 중">
    <div className="flex min-h-16 items-center gap-3 py-3"><Skeleton className="h-6 w-40 rounded" /></div>
    <Skeleton className="mb-4 h-10 w-full rounded" />
    <div className="space-y-2 rounded-(--radius-panel) border border-border p-3">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="h-12 w-full rounded" />)}</div>
  </div>
}
