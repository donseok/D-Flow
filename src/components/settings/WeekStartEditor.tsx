'use client'
// 주 시작 요일 편집기(설정 키 calendar.week_start 의 custom 위젯 — 판정 J1). 프로젝트는 요일 하나를 고르고 규칙 목록은 서버(edit.toStored)가
// 만든다 — 바꾸면 '변경 내용 검토'(서버 미리보기)를 같이 보인다. 워크스페이스(새 프로젝트의 초기값)는 검토 없이 요일만.
import { WEEK_START_DAYS, type WeekStartDay, type WeekStartRule } from '@/lib/domain/calendar'
import { WEEK_DAY_LABEL, WeekStartReview, type WeekStartReviewState } from './WeekStartReview'

export function WeekStartEditor({ value, onChange, disabled, scheduled = null, currentDay, review = null, onClear }: {
  /** '' = 저장값 손상으로 고른 요일 없음 */
  value: WeekStartDay | ''
  onChange: (day: WeekStartDay) => void
  /** 저장된 주 시작이 손상됐을 때 고른 요일을 되돌린다('' — 저장 대상에서 빠진다, a6 리뷰 Q1). 라디오는 '없음'으로 돌아갈 수 없어서다 */
  onClear?: () => void
  disabled: boolean
  /** 아직 적용 전인 전환(마지막 원소의 from > 오늘) — 프로젝트만 */
  scheduled?: WeekStartRule | null
  /** 오늘 적용되는 요일 — 예정 전환이 있을 때 '지금은 X 시작' 과 취소 방법을 같이 보인다 */
  currentDay?: WeekStartDay
  /** 바꾼 요일의 서버 검토 — 프로젝트에서 요일을 바꿨을 때만 */
  review?: WeekStartReviewState | null
}) {
  return (
    <div className="space-y-2">
      <div id="calendar-week-start" role="radiogroup" aria-label="주 시작" className="flex flex-wrap gap-4">
        {WEEK_START_DAYS.map(day => (
          <label key={day} className="flex items-center gap-1.5 text-sm text-fg">
            <input type="radio" name="calendar-week-start" value={day} checked={value === day} disabled={disabled}
              onChange={() => onChange(day)} />
            {WEEK_DAY_LABEL[day]}
          </label>
        ))}
      </div>
      {onClear && (
        <button type="button" data-week-start-clear className="btn btn-ghost px-2 text-xs" disabled={disabled} onClick={onClear}>
          선택 취소(주 시작은 저장하지 않음)
        </button>
      )}
      {scheduled?.from && (
        <p className="text-xs text-fg-muted">
          {currentDay ? `지금은 ${WEEK_DAY_LABEL[currentDay]} 시작 · ` : ''}예정: {scheduled.from} 부터 {WEEK_DAY_LABEL[scheduled.day]} 시작
          {currentDay && currentDay !== scheduled.day ? ` — ${WEEK_DAY_LABEL[currentDay]}을 고르고 저장하면 예정을 취소합니다.` : ''}
        </p>
      )}
      {/* 검토 결과를 보조기기에 알린다 — 상태 요소가 바뀌어 끼워져도 읽히게 처음부터 있는 polite 래퍼 안에서 바꾼다(A-5 리뷰 O3).
          저장 버튼의 aria-describedby 가 이 id 를 가리킨다 */}
      <div id="calendar-week-start-review" aria-live="polite" aria-atomic="true">
        {review && value && <WeekStartReview state={review} nextDay={value} />}
      </div>
    </div>
  )
}
