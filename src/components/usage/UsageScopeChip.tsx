/** 사용 현황의 범위 표시(D21) — usage_events 에 workspace_id 가 없어(SP8) 수치가 플랫폼 전체다. 보는 사람은 플랫폼 관리자뿐이다 */
export function UsageScopeChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-subtle px-3 py-1 text-meta font-semibold text-fg-secondary">
      플랫폼 전체(워크스페이스 구분은 SP8)
    </span>
  )
}
