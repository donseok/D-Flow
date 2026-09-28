import { redirect } from 'next/navigation'
import { requireModulePage } from '@/lib/modules/pageGate'

// 간트는 WBS 화면(/wbs)에 통합되었다. 기존 북마크는 타임라인 집중 모드로 넘긴다.
export default async function GanttPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'wbs')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  redirect(`/p/${projectId}/wbs?view=timeline`)
}
