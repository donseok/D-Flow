/** 사용 현황의 범위 표시(D21, SP8) — 워크스페이스 스코프 */
export function UsageScopeChip({ workspaceName }: { workspaceName?: string } = {}) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-subtle px-3 py-1 text-meta font-semibold text-fg-secondary">
      {workspaceName ? `${workspaceName} 워크스페이스` : '이 워크스페이스'}
    </span>
  )
}
