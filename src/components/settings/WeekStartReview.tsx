'use client'
// '변경 내용 검토'(스펙 D38·개정 §2.8.7 영향 행) — 서버가 계산한 E·과도기 일수·기존 문서 수·막는 주차를 문장으로 보인다.
// 상태 표시는 SP3b StatusMessage(로딩·실패·충돌). 문구는 여기 한 곳(weekStartReviewText) — 테스트가 같은 함수를 본다.
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { WeekStartDay, WeekStartPreview } from '@/lib/domain/calendar'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

type T = (k: DictKey) => string

export type WeekStartReviewState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; preview: WeekStartPreview }
/** 요일 이름의 사전 키 — 글자는 t(WEEK_DAY_LABEL[day]) */
export const WEEK_DAY_LABEL: Readonly<Record<WeekStartDay, DictKey>> = { sunday: 'settings.calendar.week_start.sunday', monday: 'settings.calendar.week_start.monday' }

/** 저장을 막는 검토인가 — 아직 받지 못했거나(로딩·실패), 손상된 저장 규칙이거나, 막는 주차가 있다 */
export function reviewBlocksSave(state: WeekStartReviewState | null): boolean {
  if (!state || state.kind !== 'ready') return true
  return !!state.preview.error || state.preview.blockingWeeks.length > 0
}

export function weekStartReviewText(preview: WeekStartPreview, nextDay: WeekStartDay, t: T): string {
  const label = t(WEEK_DAY_LABEL[nextDay])
  // 예정 전환 취소(되돌림 갈래 — 도메인이 아직 적용 전 원소를 지운다). '바뀌는 내용이 없습니다' 로 말하지 않는다(A-5 리뷰 P2, O1)
  if (preview.cancelled?.from) {
    return t('settings.weekStart.review.cancelled').replace('{from}', String(preview.cancelled.from)).replace('{day}', t(WEEK_DAY_LABEL[preview.cancelled.day])).replace('{label}', String(label)).replace('{keptDocs}', String(preview.keptDocs))
  }
  if (preview.effectiveFrom === null) {
    return preview.keptDocs === 0 && preview.blockingWeeks.length === 0
      ? t('settings.weekStart.review.immediate').replace('{label}', String(label))
      : t('settings.weekStart.review.noChange')
  }
  const transition = preview.transitionDays ? t('settings.weekStart.review.transition').replace('{transitionDays}', String(preview.transitionDays)) : ''
  return t('settings.weekStart.review.effective').replace('{effectiveFrom}', String(preview.effectiveFrom)).replace('{label}', String(label)).replace('{transition}', String(transition)).replace('{keptDocs}', String(preview.keptDocs))
}

export function WeekStartReview({ state, nextDay }: { state: WeekStartReviewState; nextDay: WeekStartDay }) {
  const { t } = useLocale()
  if (state.kind === 'loading') return <StatusMessage kind="loading" title={t('settings.weekStart.review.loading')} compact />
  if (state.kind === 'error') return <StatusMessage kind="partial_error" title={t('settings.weekStart.review.failed')} detail={state.message} compact />
  const { preview } = state
  // 손상된 저장 규칙(과거 전환을 바꾸게 되는 목록) — 검토 대신 그 문구(일람 정정 과제 2·3)
  if (preview.error) return <StatusMessage kind="partial_error" title={t('settings.weekStart.review.locked')} detail={preview.error} compact />
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface p-3" role="group" aria-label={t('settings.review.title')}>
      <p className="text-sm text-fg">{weekStartReviewText(preview, nextDay, t)}</p>
      {preview.blockingWeeks.length > 0 && (
        <StatusMessage kind="conflict" compact
          title={t('settings.weekStart.review.blocked')}
          detail={t('settings.weekStart.review.blockingWeeks').replace('{blockingWeeks}', String(preview.blockingWeeks.join(', ')))} />
      )}
    </div>
  )
}
