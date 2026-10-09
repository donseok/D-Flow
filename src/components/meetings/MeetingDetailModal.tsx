'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { useMinuteLinks } from '@/components/minutes/minuteLinks'
import { CalendarDays, Clock4, MapPin, Repeat, Trash2, Pencil, Ban, User, AlertTriangle, NotebookText, Megaphone, Check } from 'lucide-react'
import type { Meeting, MeetingAttendeeInfo, MeetingOccurrence } from '@/lib/domain/types'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamLabel } from '@/components/app/TeamsProvider'
import { Modal } from '@/components/ui/Modal'
import { fmtDate } from '@/components/wbs/shared'
import { canEditMeeting } from '@/lib/domain/meetings'
import { vocabOf, vocabView, type VocabByProject } from '@/lib/settings/vocab'
import { fetchMeetingDetail, cancelOccurrence, deleteMeeting } from '@/app/actions/meetings'
import { createAnnouncementFromMeeting } from '@/app/actions/announcements'
import { fetchMeetingMinutesLite } from '@/app/actions/minutes'

type LinkedMinute = { id: string; title: string; minuteDate: string }

export function MeetingDetailModal({
  open, occurrence, currentUserId, isAdmin, onClose, onEditSeries, onChanged, categories,
}: {
  open: boolean
  occurrence: MeetingOccurrence | null
  currentUserId: string | null
  /** **이 회의가 속한 프로젝트의** 관리자 여부. 서버 가드(adminOrOwnerGate·createAnnouncementFromMeeting)가
   *  회의 행의 project_id 로 requireProjectAdmin 을 하므로, 전역 '어느 프로젝트든 관리자'로는 갈라진다. */
  isAdmin: boolean
  onClose: () => void
  onEditSeries: (m: Meeting) => void
  onChanged: () => void
  /** 회의 범주(설정 meetings.categories) — 프로젝트별 */
  categories: VocabByProject<'meetings.categories'>
}) {
  const { t } = useLocale()
  const teamLabelOf = useTeamLabel()
  const minuteLinks = useMinuteLinks()   // 화면 안 링크의 범위(D38 ①) — 없으면 옛 형식(스텁이 행의 워크스페이스로, D6)
  const [detail, setDetail] = useState<{ meeting: Meeting; attendees: MeetingAttendeeInfo[] } | null>(null)
  const [minutes, setMinutes] = useState<LinkedMinute[]>([])
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 상세 조회 실패 — msg 가 null 이면(던짐) 공용 문구. 효과 안에서 t 를 읽지 않는다(t 가 바뀔 때마다 다시 읽지 않게)
  const [loadError, setLoadError] = useState<{ msg: string | null } | null>(null)
  const [pending, startTransition] = useTransition()
  const [posting, startPost] = useTransition()
  const [posted, setPosted] = useState(false)

  useEffect(() => {
    if (!open || !occurrence) {
      setDetail(null); setMinutes([]); setConfirmDelete(false); setConfirmCancel(false); setPosted(false); setError(null); setLoadError(null); return
    }
    let alive = true
    setLoading(true)
    // 회의록 조회는 부가 정보 — 실패해도 상세 표시를 막지 않는다
    setLoadError(null)
    Promise.all([
      // 상세 조회 실패는 '참석자 없음·본문 없음'이 아니다 — 사유를 보인다(SP5 B2 — D39). 던짐도 같은 실패
      fetchMeetingDetail(occurrence.seriesId).catch(() => ({ ok: false as const, error: null })),
      fetchMeetingMinutesLite(occurrence.seriesId).catch(() => [] as LinkedMinute[]),
    ])
      .then(([d, ms]) => {
        if (!alive) return
        if (d && d.ok === false) { setDetail(null); setLoadError({ msg: d.error }) }
        else setDetail(d && d.ok ? d.detail : null)
        setMinutes(ms)
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [open, occurrence])

  if (!occurrence) return null
  const meta = vocabView('meetings.categories', vocabOf(categories, occurrence.projectId), occurrence.category, t)
  const canEdit = detail ? canEditMeeting(detail.meeting, currentUserId, isAdmin) : false
  const timeLabel = occurrence.startTime
    ? `${occurrence.startTime}${occurrence.endTime ? `–${occurrence.endTime}` : ''}`
    : t('meet.allDay')

  const runCancel = () => startTransition(async () => {
    const res = await cancelOccurrence(occurrence.seriesId, occurrence.occurrenceDate)
    if (res.ok) { onChanged(); onClose() }
    else { setError(res.error ?? t('meet.saveFailed')); setConfirmCancel(false) }
  })
  const runDelete = () => startTransition(async () => {
    const res = await deleteMeeting(occurrence.seriesId)
    if (res.ok) { onChanged(); onClose() }
    else { setError(res.error ?? t('meet.deleteFailed')); setConfirmDelete(false) }
  })
  const runPost = () => startPost(async () => {
    setError(null)
    const res = await createAnnouncementFromMeeting(occurrence.seriesId, occurrence.occurrenceDate)
    if (res.ok) setPosted(true)
    else setError(res.error ?? t('meet.detail.postFailed'))
  })

  return (
    <>
      <Modal
        open={open && !confirmDelete && !confirmCancel}
        onClose={onClose}
        eyebrow={meta.label}
        title={occurrence.title}
        footer={canEdit ? (
          <>
            {isAdmin && (
              posted ? (
                <span className="btn btn-ghost mr-auto pointer-events-none text-progress"><Check className="h-4 w-4" />{t('meet.detail.postedAsAnnouncement')}</span>
              ) : (
                <button onClick={runPost} disabled={posting || pending} className="btn btn-ghost mr-auto text-action hover:bg-action-soft">
                  <Megaphone className="h-4 w-4" />{posting ? t('meet.detail.posting') : t('meet.detail.postAsAnnouncement')}
                </button>
              )
            )}
            {occurrence.isRecurring && (
              <button onClick={() => setConfirmCancel(true)} disabled={pending} className={`btn btn-ghost text-pending hover:bg-pending-weak ${isAdmin ? '' : 'mr-auto'}`}>
                <Ban className="h-4 w-4" />{t('meet.detail.cancelOccurrence')}
              </button>
            )}
            <button onClick={() => setConfirmDelete(true)} disabled={pending} className="btn btn-ghost text-danger hover:bg-danger-weak"><Trash2 className="h-4 w-4" />{t('meet.detail.deleteSeries')}</button>
            <button onClick={() => detail && onEditSeries(detail.meeting)} disabled={pending || !detail} className="btn btn-primary"><Pencil className="h-4 w-4" />{t('meet.detail.editSeries')}</button>
          </>
        ) : (
          <button onClick={onClose} className="btn btn-ghost">{t('common.close')}</button>
        )}
      >
        <div className="space-y-3 text-sm">
          <span className={`chip ${meta.chip}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}</span>

          {(error || loadError) && (
            <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-danger-weak px-3 py-2 text-xs font-medium text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />{error || loadError?.msg || t('meet.detail.loadFailed')}
            </p>
          )}
          <div className="flex items-center gap-2 text-fg"><CalendarDays className="h-4 w-4 text-fg-muted" />{fmtDate(occurrence.occurrenceDate)}
            {occurrence.isRecurring && <span className="inline-flex items-center gap-1 text-meta text-fg-muted"><Repeat className="h-3 w-3" />{t('meet.recurring')}</span>}
          </div>
          <div className="flex items-center gap-2 text-fg"><Clock4 className="h-4 w-4 text-fg-muted" /><span className="tabular-nums">{timeLabel}</span></div>
          {occurrence.location && <div className="flex items-center gap-2 text-fg"><MapPin className="h-4 w-4 text-fg-muted" />{occurrence.location}</div>}
          {detail?.meeting.createdByName && <div className="flex items-center gap-2 text-fg-secondary"><User className="h-4 w-4 text-fg-muted" />{t('meet.detail.createdBy')}: {detail.meeting.createdByName}</div>}

          <div>
            <div className="mb-1.5 text-xs font-semibold text-fg-secondary">{t('meet.detail.attendees')}</div>
            {loading ? <div className="text-xs text-fg-muted">…</div>
              : (detail?.attendees.length ?? 0) === 0 ? <div className="text-xs text-fg-muted">{t('meet.detail.noAttendees')}</div>
              : (
                <div className="flex flex-wrap gap-1.5">
                  {detail!.attendees.map(a => (
                    <span key={a.id} className="chip bg-surface-subtle text-fg">{a.name}{a.teamCodes.length ? ` · ${a.teamCodes.map(teamLabelOf).join(', ')}` : ''}</span>
                  ))}
                </div>
              )}
          </div>

          {/* 연결된 회의록 — 있을 때만 노출. 클릭하면 회의록 상세로 바로 이동 */}
          {minutes.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-fg-secondary">{t('meet.detail.linkedMinutes')}</div>
              <ul className="space-y-1">
                {minutes.map(mn => (
                  <li key={mn.id}>
                    <Link href={minuteLinks.minute(mn.id)} onClick={onClose}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-fg transition hover:border-border-input hover:bg-surface-subtle">
                      <NotebookText className="h-4 w-4 shrink-0 text-action" />
                      <span className="shrink-0 tabular-nums text-xs text-fg-muted">{mn.minuteDate}</span>
                      <span className="truncate">{mn.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs font-semibold text-fg-secondary">{t('meet.detail.body')}</div>
            {loading ? <div className="text-xs text-fg-muted">…</div>
              : detail?.meeting.body ? <p className="whitespace-pre-wrap text-sm leading-6 text-fg-secondary">{detail.meeting.body}</p>
              : <div className="text-xs text-fg-muted">{t('meet.detail.noBody')}</div>}
          </div>
        </div>
      </Modal>

      <Modal
        open={open && confirmDelete}
        onClose={() => { if (!pending) setConfirmDelete(false) }}
        size="sm"
        title={t('meet.delete.title')}
        footer={
          <>
            <button onClick={() => setConfirmDelete(false)} disabled={pending} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={runDelete} disabled={pending} className="btn bg-danger text-danger-fg hover:brightness-105 disabled:opacity-50">{pending ? t('meet.deleting') : t('common.delete')}</button>
          </>
        }
      >
        <p className="text-sm leading-6 text-fg-secondary">{t('meet.delete.confirm')}</p>
      </Modal>

      <Modal
        open={open && confirmCancel}
        onClose={() => { if (!pending) setConfirmCancel(false) }}
        size="sm"
        title={t('meet.cancelOcc.title')}
        footer={
          <>
            <button onClick={() => setConfirmCancel(false)} disabled={pending} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={runCancel} disabled={pending} className="btn bg-danger text-danger-fg hover:brightness-105 disabled:opacity-50"><Ban className="h-4 w-4" />{t('meet.detail.cancelOccurrence')}</button>
          </>
        }
      >
        <p className="text-sm leading-6 text-fg-secondary">{t('meet.cancelOcc.confirm')}</p>
      </Modal>
    </>
  )
}
