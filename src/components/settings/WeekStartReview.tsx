'use client'
// '변경 내용 검토'(스펙 D38·개정 §2.8.7 영향 행) — 서버가 계산한 E·과도기 일수·기존 문서 수·막는 주차를 문장으로 보인다.
// 상태 표시는 SP3b StatusMessage(로딩·실패·충돌). 문구는 여기 한 곳(weekStartReviewText) — 테스트가 같은 함수를 본다.
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { WeekStartDay, WeekStartPreview } from '@/lib/domain/calendar'

export type WeekStartReviewState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; preview: WeekStartPreview }
export const WEEK_DAY_LABEL: Readonly<Record<WeekStartDay, string>> = { sunday: '일요일', monday: '월요일' }

/** 저장을 막는 검토인가 — 아직 받지 못했거나(로딩·실패), 손상된 저장 규칙이거나, 막는 주차가 있다 */
export function reviewBlocksSave(state: WeekStartReviewState | null): boolean {
  if (!state || state.kind !== 'ready') return true
  return !!state.preview.error || state.preview.blockingWeeks.length > 0
}

export function weekStartReviewText(preview: WeekStartPreview, nextDay: WeekStartDay): string {
  const label = WEEK_DAY_LABEL[nextDay]
  // 예정 전환 취소(되돌림 갈래 — 도메인이 아직 적용 전 원소를 지운다). '바뀌는 내용이 없습니다' 로 말하지 않는다(A-5 리뷰 P2, O1)
  if (preview.cancelled?.from) {
    return `예정된 ${preview.cancelled.from} 의 ${WEEK_DAY_LABEL[preview.cancelled.day]} 시작 전환을 취소합니다. 지금처럼 ${label} 시작이 이어지고 기존 주간보고 ${preview.keptDocs}건은 그대로입니다.`
  }
  if (preview.effectiveFrom === null) {
    return preview.keptDocs === 0 && preview.blockingWeeks.length === 0
      ? `주간보고가 아직 없어 저장하면 바로 ${label} 시작으로 바뀝니다.`
      : '바뀌는 내용이 없습니다.'
  }
  const transition = preview.transitionDays ? ` 바뀌기 직전 주 하나가 ${preview.transitionDays}일입니다(전환 주).` : ''
  return `${preview.effectiveFrom} 부터 ${label} 시작입니다.${transition} 기존 주간보고 ${preview.keptDocs}건은 그대로입니다.`
}

export function WeekStartReview({ state, nextDay }: { state: WeekStartReviewState; nextDay: WeekStartDay }) {
  if (state.kind === 'loading') return <StatusMessage kind="loading" title="변경 내용을 확인하는 중입니다." compact />
  if (state.kind === 'error') return <StatusMessage kind="partial_error" title="변경 내용을 확인하지 못했습니다." detail={state.message} compact />
  const { preview } = state
  // 손상된 저장 규칙(과거 전환을 바꾸게 되는 목록) — 검토 대신 그 문구(일람 정정 과제 2·3)
  if (preview.error) return <StatusMessage kind="partial_error" title="지금 저장된 주 시작 규칙을 바꿀 수 없습니다." detail={preview.error} compact />
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3" role="group" aria-label="변경 내용 검토">
      <p className="text-sm text-fg">{weekStartReviewText(preview, nextDay)}</p>
      {preview.blockingWeeks.length > 0 && (
        <StatusMessage kind="conflict" compact
          title="이미 만든 주간보고가 새 규칙과 맞지 않아 저장할 수 없습니다."
          detail={`해당 주차: ${preview.blockingWeeks.join(', ')} — 그 주간보고를 정리하거나 다른 시점에 다시 바꾸세요.`} />
      )}
    </div>
  )
}
