import type { ReactNode } from 'react'
import Link from 'next/link'
import { buttonClass } from './buttonStyles'
import { AlertTriangle, Ban, CloudOff, Inbox, RefreshCw, Settings2, ShieldAlert, type LucideIcon } from 'lucide-react'

/**
 * 표준 상태 8종(개정 §5.7.2, SP3b 스펙 §4.5, 계획 판정 Q25) — 화면·위젯이 같은 모양으로 상태를 말한다.
 * 막는 오류(permission_changed, blocking 인 partial_error)는 role="alert", 나머지는 role="status".
 * loading 은 레이아웃 높이를 지키는 skeleton 이고 수치를 0 으로 그리지 않는다. 문구는 호출부가 넘긴다 —
 * 이 컴포넌트는 기본 문구·복구 약속("자동으로 다시 시도합니다")을 하지 않는다(개정 §5.10.3).
 */
export type StatusKind = 'loading' | 'empty' | 'needs_setup' | 'disabled' | 'partial_error' | 'conflict' | 'offline' | 'permission_changed'
export const STATUS_KINDS: readonly StatusKind[] = ['loading', 'empty', 'needs_setup', 'disabled', 'partial_error', 'conflict', 'offline', 'permission_changed']
/** 다음 행동 하나 — 링크 또는 버튼(둘 다는 안 된다) */
export type StatusAction = { label: string; href: string; onSelect?: never } | { label: string; onSelect: () => void; href?: never }

/**
 * 링크형 행동(설정에서 복구하기·켜기·설정으로)은 밑줄 링크 — ghost 버튼 모양은 테두리·밑줄이 없어 일반 글자처럼 보였다(u3-3 리뷰 P2-4, 판정 R10 ②).
 * 옛 ConfigStateNotice 의 밑줄 링크와 같은 색(옛 이름 brand 는 action 의 별칭 — 이 파일은 새 토큰 이름만). 버튼형 행동은 ghost 버튼 그대로
 */
const LINK_ACTION = 'inline-flex min-h-6 items-center text-control font-semibold text-action underline underline-offset-2 hover:text-action-hover'

const TONE: Record<Exclude<StatusKind, 'loading'>, { Icon: LucideIcon; cls: string }> = {
  empty: { Icon: Inbox, cls: 'text-fg-muted' },
  needs_setup: { Icon: Settings2, cls: 'text-action' },
  disabled: { Icon: Ban, cls: 'text-fg-muted' },
  partial_error: { Icon: AlertTriangle, cls: 'text-danger' },
  conflict: { Icon: RefreshCw, cls: 'text-warning' },
  offline: { Icon: CloudOff, cls: 'text-warning' },
  permission_changed: { Icon: ShieldAlert, cls: 'text-danger' },
}

export function StatusMessage({ kind, title, detail, action, compact = false, blocking = false, announce = true }: {
  kind: StatusKind
  title: string
  detail?: ReactNode
  action?: StatusAction
  compact?: boolean
  /** 화면 전체를 막는 오류 — partial_error 에만 뜻이 있다(위젯 카드의 부분 실패는 false) */
  blocking?: boolean
  /** false 면 알림 영역(role)을 만들지 않는다 — 감싸는 영역이 이미 알릴 때만(범위 오류 화면: 제목 h1 과 한 영역, CC6). 두 영역이면 두 번 낭독된다 */
  announce?: boolean
}) {
  const alert = kind === 'permission_changed' || (blocking && kind === 'partial_error')
  const frame = compact
    ? alert
      ? 'flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-weak/30 px-3 py-2'
      : 'flex items-start gap-2.5 py-2'
    : 'flex items-start gap-3.5 rounded-(--radius-panel) border border-border bg-surface p-4'
  if (kind === 'loading') {
    return (
      <div role="status" aria-busy="true" data-status-kind="loading" className={`${frame} ${compact ? 'min-h-8' : 'min-h-24'}`}>
        <span className="sr-only">{title}</span>
        <div aria-hidden className="w-full space-y-2">
          <div className="h-3 w-2/5 animate-pulse rounded bg-surface-subtle" />
          <div className="h-3 w-4/5 animate-pulse rounded bg-surface-subtle" />
          {!compact && <div className="h-3 w-3/5 animate-pulse rounded bg-surface-subtle" />}
        </div>
      </div>
    )
  }
  const { Icon, cls } = TONE[kind]
  return (
    <div role={announce ? (alert ? 'alert' : 'status') : undefined} data-status-kind={kind} className={frame}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cls}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {detail && <div className="mt-1 text-sm text-fg-secondary leading-relaxed">{detail}</div>}
        {action && (
          <div className={compact ? 'mt-1.5' : 'mt-3'}>
            {action.href !== undefined
              ? <Link href={action.href} className={LINK_ACTION}>{action.label}</Link>
              : <button type="button" onClick={action.onSelect} className={buttonClass('ghost')}>{action.label}</button>}
          </div>
        )}
      </div>
    </div>
  )
}
