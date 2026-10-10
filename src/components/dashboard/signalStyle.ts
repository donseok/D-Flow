import { CheckCircle2, AlertTriangle, AlertOctagon, MinusCircle, type LucideIcon } from 'lucide-react'
import type { Signal } from '@/lib/domain/dashboard'

/** 신호 → 토큰(기존 상태 팔레트 재사용) + 접근성 아이콘. */
export const SIGNAL_META: Record<Signal, { text: string; dot: string; borderTop: string; chip: string; icon: LucideIcon }> = {
  green:   { text: 'text-success',           dot: 'bg-success',           borderTop: 'border-t-success',           chip: 'bg-success-weak text-success',              icon: CheckCircle2 },
  amber:   { text: 'text-warning', dot: 'bg-warning', borderTop: 'border-t-warning', chip: 'bg-pending-weak text-warning', icon: AlertTriangle },
  red:     { text: 'text-danger',        dot: 'bg-danger',        borderTop: 'border-t-danger',        chip: 'bg-danger-weak text-danger',        icon: AlertOctagon },
  neutral: { text: 'text-fg-muted',     dot: 'bg-fg-muted',     borderTop: 'border-t-border-input',    chip: 'bg-surface-subtle text-fg-muted',        icon: MinusCircle },
}
