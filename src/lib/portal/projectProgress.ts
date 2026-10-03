/**
 * 프로젝트 진척(SP3b UI-3 W5) — 잎(자식 없음)만, 완료 = actual_pct ≥ 100(반올림 금지 — computeCompletionMap 과 같은 규약). 가중 진척은 개요가 정본이다.
 * today = 기한 판정의 '오늘'(프로젝트 상태와 같은 워크스페이스 tz — 판정 R1). null 이면 기한 판정(다음 기한·지난 미완)을 하지 않고 완료·전체만 센다.
 */
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'

export interface ProgressRow { id: string; parentId: string | null; projectId: string; actualPct: number | null; plannedEnd: string | null }
export interface ProjectProgress { hasWbs: boolean; allDone: boolean; done: number; total: number; nextDue: string | null; overdueOpen: number }

export function projectProgressMap(rows: readonly ProgressRow[], today: string | null): Record<string, ProjectProgress> {
  const parents = new Set<string>()
  for (const r of rows) if (r.parentId) parents.add(r.parentId)
  const out: Record<string, ProjectProgress> = {}
  for (const r of rows) {
    if (parents.has(r.id)) continue
    const p = (out[r.projectId] ??= { hasWbs: true, allDone: true, done: 0, total: 0, nextDue: null, overdueOpen: 0 })
    p.total++
    if ((r.actualPct ?? 0) >= 100) { p.done++; continue }
    p.allDone = false
    if (today === null || !r.plannedEnd) continue
    if (r.plannedEnd < today) p.overdueOpen++
    else if (p.nextDue === null || r.plannedEnd < p.nextDue) p.nextDue = r.plannedEnd
  }
  return out
}

/** 현황의 근거 한 줄(스펙 §6.1 projects 위젯) — 상태 칩 옆에 글로 둔다(색만으로 뜻을 전하지 않는다) */
export function statusReason(status: ProjectLifecycleStatus, p: Pick<ProjectProgress, 'done' | 'total' | 'overdueOpen'> | null): string {
  if (status === 'unknown') return '진척을 확인하지 못했습니다'
  if (status === 'ready') return '시작 전'
  if (status === 'done') return p ? `종료일 지남 · 완료 ${p.done}/${p.total}` : '종료일 지남 · WBS 없음'
  if (status === 'overdue') return `종료일 지남 · 미완료 ${p ? p.total - p.done : 0}`
  if (!p) return 'WBS 없음'
  return p.overdueOpen > 0 ? `완료 ${p.done}/${p.total} · 기한 지난 작업 ${p.overdueOpen}` : `완료 ${p.done}/${p.total}`
}
