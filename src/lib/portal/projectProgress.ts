/**
 * 프로젝트 진척(SP3b UI-3 W5) — 잎(자식 없음)만, 완료 = actual_pct ≥ 100(반올림 금지 — computeCompletionMap 과 같은 규약). 가중 진척은 개요가 정본이다.
 * today = 기한 판정의 '오늘'(프로젝트 상태와 같은 워크스페이스 tz — 판정 R1). null 이면 기한 판정(다음 기한·지난 미완)을 하지 않고 완료·전체만 센다.
 */
import { leafStarted, type ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { fill, koTranslate, type Translate } from '@/lib/i18n/translate'

export interface ProgressRow { id: string; parentId: string | null; projectId: string; actualPct: number | null; plannedEnd: string | null; stage?: string | null }
/** anyStarted = 잎이 하나라도 진행됐다(실적 > 0 또는 진행 단계) — 프로젝트 상태 파생의 재료(BUG-35, projectLifecycleStatus) */
export interface ProjectProgress { hasWbs: boolean; allDone: boolean; anyStarted: boolean; done: number; total: number; nextDue: string | null; overdueOpen: number }

export function projectProgressMap(rows: readonly ProgressRow[], today: string | null): Record<string, ProjectProgress> {
  const parents = new Set<string>()
  for (const r of rows) if (r.parentId) parents.add(r.parentId)
  const out: Record<string, ProjectProgress> = {}
  for (const r of rows) {
    if (parents.has(r.id)) continue
    const p = (out[r.projectId] ??= { hasWbs: true, allDone: true, anyStarted: false, done: 0, total: 0, nextDue: null, overdueOpen: 0 })
    p.total++
    if (leafStarted(r.actualPct, r.stage)) p.anyStarted = true
    if ((r.actualPct ?? 0) >= 100) { p.done++; continue }
    p.allDone = false
    if (today === null || !r.plannedEnd) continue
    if (r.plannedEnd < today) p.overdueOpen++
    else if (p.nextDue === null || r.plannedEnd < p.nextDue) p.nextDue = r.plannedEnd
  }
  return out
}

/** 현황의 근거 한 줄(스펙 §6.1 projects 위젯) — 상태 칩 옆에 글로 둔다(색만으로 뜻을 전하지 않는다).
 *  endPassed = 종료일이 지났는가. 상태가 WBS 에서 파생되면서(BUG-35) 종료일 전에도 '완료'가 될 수 있다 — 그때는 '종료일 지남'을 붙이지 않는다.
 *  생략은 true(옛 호출부 — 완료는 종료일 뒤에만 나왔다) */
export function statusReason(status: ProjectLifecycleStatus, p: Pick<ProjectProgress, 'done' | 'total' | 'overdueOpen'> | null, t: Translate = koTranslate, endPassed = true): string {
  if (status === 'unknown') return t('portal.status.unknown')
  if (status === 'ready') return t('portal.status.ready')
  if (status === 'done' && p && !endPassed) return fill(t('portal.status.doneEarly'), { done: p.done, total: p.total })
  if (status === 'done') return p ? fill(t('portal.status.doneWithWbs'), { done: p.done, total: p.total }) : t('portal.status.doneNoWbs')
  if (status === 'overdue') return fill(t('portal.status.overdue'), { n: p ? p.total - p.done : 0 })
  if (!p) return t('portal.status.noWbs')
  return p.overdueOpen > 0 ? fill(t('portal.status.activeOverdue'), { done: p.done, total: p.total, n: p.overdueOpen }) : fill(t('portal.status.active'), { done: p.done, total: p.total })
}
