'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, NotebookText } from 'lucide-react'
import type { MeetingOccurrence } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import { meetingEditHref, type MeetingRowExtra } from '@/lib/domain/meetings'
import { vocabOf, vocabView, type VocabByProject } from '@/lib/settings/vocab'
import { MeetingDetailModal } from '@/components/meetings/MeetingDetailModal'
import { DateCell, weekdayKey } from './bits'

/** 대시보드 회의 리스트 — 행 클릭 시 상세 모달을 띄운다.
 *  작성자(또는 프로젝트 관리자 이상)면 상세에서 수정·삭제가 열린다. 수정 폼은 프로젝트 멤버 목록이 필요하므로
 *  여기서 띄우지 않고 회의 페이지로 딥링크(?focus=&date=&edit=1)해 폼을 바로 연다. */
/** 참석자 이름을 이만큼만 보이고 나머지는 '외 N명'으로 접는다 — 한 줄 폭 안에서 끝나게. */
const MAX_NAMES = 3
const EMPTY_EXTRA: MeetingRowExtra = { attendees: [], memo: '' }

export function MeetingScheduleList({ rows, extras, today, currentUserId = null, canManage = false, categories }: {
  rows: MeetingOccurrence[]
  /** 시리즈 id → 참석자 이름·메모 요약. 조회 실패로 비면 빈 상태 문구가 나온다. */
  extras: Record<string, MeetingRowExtra>
  today: string
  currentUserId?: string | null
  /** 이 프로젝트 관리자 이상(isProjectAdmin). 기본 false = fail-closed. */
  canManage?: boolean
  /** 회의 범주(설정 meetings.categories) — 프로젝트별 */
  categories: VocabByProject<'meetings.categories'>
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [detailOcc, setDetailOcc] = useState<MeetingOccurrence | null>(null)

  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map(o => {
          const meta = vocabView('meetings.categories', vocabOf(categories, o.projectId), o.category, t)
          const extra = extras[o.seriesId] ?? EMPTY_EXTRA
          const shownNames = extra.attendees.slice(0, MAX_NAMES).join(', ')
          const moreNames = extra.attendees.length - MAX_NAMES
          return (
            <li key={o.occurrenceId} onClick={() => setDetailOcc(o)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setDetailOcc(o) }}
              className="flex cursor-pointer items-center gap-3 py-2.5 first:pt-0 last:pb-0 transition hover:bg-surface-subtle focus:outline-none focus-visible:bg-surface-subtle">
              <DateCell date={o.occurrenceDate} isToday={o.occurrenceDate === today}
                todayLabel={t('dash.today')} weekday={t(weekdayKey(o.occurrenceDate) as DictKey)} />
              <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
              {/* 좁은 폭은 세로 쌓기, md 이상은 제목:참석자:메모 = 5:4:6 세 열. 행 폭이 넓어 제목만 두면
                  절반이 빈다. flex-direction/grid 는 반응형 display 안전망과 무관하다. */}
              <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,4fr)_minmax(0,6fr)] md:items-center md:gap-x-4">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-fg" title={o.title}>{o.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-secondary">
                    {o.startTime && (
                      <span className="tabular-nums">
                        {o.startTime.slice(0, 5)}{o.endTime ? `–${o.endTime.slice(0, 5)}` : ''}
                      </span>
                    )}
                    {o.location && <span className="truncate">{o.location}</span>}
                  </div>
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] md:mt-0"
                  title={extra.attendees.length ? extra.attendees.join(', ') : undefined}>
                  <Users className="h-3 w-3 shrink-0 text-fg-muted" aria-hidden />
                  {extra.attendees.length === 0 ? (
                    <span className="text-fg-muted">{t('dash.meet.noAttendees')}</span>
                  ) : (
                    <>
                      <span className="truncate text-fg-secondary">{shownNames}</span>
                      {moreNames > 0 && (
                        <span className="shrink-0 text-fg-muted">{t('dash.meet.attendeesMore').replace('{n}', String(moreNames))}</span>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] md:mt-0"
                  title={extra.memo || undefined}>
                  <NotebookText className="h-3 w-3 shrink-0 text-fg-muted" aria-hidden />
                  {extra.memo ? (
                    <span className="truncate text-fg-secondary">{extra.memo}</span>
                  ) : (
                    <span className="text-fg-muted">{t('dash.meet.noMemo')}</span>
                  )}
                </div>
              </div>
              <span className={`badge shrink-0 ${meta.chip}`}>{meta.label}</span>
            </li>
          )
        })}
      </ul>
      {/* 대시보드는 프로젝트 하나에 고정된 화면이라 canManage 가 곧 그 프로젝트의 관리자 판정이다. */}
      <MeetingDetailModal open={!!detailOcc} occurrence={detailOcc}
        currentUserId={currentUserId} isAdmin={canManage}
        onClose={() => setDetailOcc(null)}
        onEditSeries={m => router.push(meetingEditHref(m.projectId, m.id, detailOcc?.occurrenceDate))}
        onChanged={() => router.refresh()} categories={categories} />
    </>
  )
}
