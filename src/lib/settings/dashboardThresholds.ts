// 대시보드 판정 기준(설정 dashboard.due_soon_days·dashboard.delayed_red_count) → 도메인 인자 한 벌. 해석기·세션 클라이언트를 끌어오지 않는다(pick 과 같은 잎).
// 손상·누락 값은 그 키만 제품 기본값으로 판정한다 — 표시 전용 기준이라 화면·계산을 멈추지 않는다(손상 사실은 해석기가 로그로 남기고, 설정 화면의 편집기가 알린다).
// WBS 로더(getComputedWbs)가 부르므로 던지지 않는다 — 기준 하나의 손상이 계획% 계산을 막으면 안 된다.
import { DEFAULT_DASHBOARD_THRESHOLDS, type DashboardThresholds } from '@/lib/domain/dashboard'
import type { ProjectConfig } from './projectConfig'

type NumberKey = 'dashboard.due_soon_days' | 'dashboard.delayed_red_count'

function read(cfg: Pick<ProjectConfig, 'keys'>, key: NumberKey, fallback: number): number {
  const st = (cfg.keys as ProjectConfig['keys'] | undefined)?.[key]
  return st && (st.status === 'set' || st.status === 'default') && typeof st.value === 'number' ? st.value : fallback
}

export function dashboardThresholdsOf(cfg: Pick<ProjectConfig, 'keys'>): DashboardThresholds {
  return {
    dueSoonDays: read(cfg, 'dashboard.due_soon_days', DEFAULT_DASHBOARD_THRESHOLDS.dueSoonDays),
    delayedRedCount: read(cfg, 'dashboard.delayed_red_count', DEFAULT_DASHBOARD_THRESHOLDS.delayedRedCount),
  }
}
