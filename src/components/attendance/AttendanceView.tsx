'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, CalendarDays, List, Plus, CalendarX2,
} from 'lucide-react'
import type { AttendanceRecord, AttendanceType, ProjectMember, TeamCode } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { activeVocab, vocabColor, vocabLabel, vocabShort, type AttendanceTypeDef } from '@/lib/settings/vocab'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamCodes, useTeamLabel } from '@/components/app/TeamsProvider'
import { Modal } from '@/components/ui/Modal'
import { ASSISTANT_NAME } from '@/lib/branding'
import { SegmentedTabs } from '@/components/ui/SegmentedTabs'
import { MemberPickerViewToggle, MemberSelectOptions } from '@/components/members/MemberPicker'
import { EmptyState } from '@/components/ui/EmptyState'
import { DayPopover, type DayPopoverAnchor } from '@/components/ui/DayPopover'
import { fmtDate } from '@/components/wbs/shared'
import {
  calendarDayInfo, monthMatrix, recordsByDate, weekdayColumns, type CalendarView,
} from '@/lib/domain/attendance'
import { currentRuleDay } from '@/lib/domain/calendar'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { memberBelongsToTeam, type MemberPickerView } from '@/lib/domain/memberPicker'
import { upsertAttendance, removeAttendance } from '@/app/actions/attendance'
import { useBotPageContext } from '@/components/chat/BotPageContextProvider'
import { RestDayMark } from '@/components/calendar/RestDayMark'
import { formatYearMonth } from '@/lib/i18n/format'

type ViewKey = 'calendar' | 'list'
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

interface BotDeepLinkFilter {
  from: string | null
  to: string | null
  team: TeamCode | null
  type: AttendanceType | null
}

/** 챗봇 딥링크(?from&to&team&type) 초기 필터 — 유효값만 채택, 아무 것도 없으면 null. */
function readBotFilter(
  params: { get(name: string): string | null }, teamCodes: readonly string[], typeCodes: readonly string[],
): BotDeepLinkFilter | null {
  const rawFrom = params.get('from')
  const rawTo = params.get('to')
  // 기간은 from·to가 함께 유효할 때만 적용한다(도구 조회 계약과 동일).
  const rangeValid = !!rawFrom && !!rawTo
    && ISO_DAY_RE.test(rawFrom) && ISO_DAY_RE.test(rawTo) && rawFrom <= rawTo
  const rawTeam = params.get('team')
  const team = rawTeam && (teamCodes as readonly string[]).includes(rawTeam)
    ? (rawTeam as TeamCode)
    : null
  const rawType = params.get('type')
  const type = rawType && typeCodes.includes(rawType) ? rawType : null
  if (!rangeValid && !team && !type) return null
  return { from: rangeValid ? rawFrom : null, to: rangeValid ? rawTo : null, team, type }
}

export function AttendanceView({
  projectId, records, members, initialDate, canEdit, calendar, holidayNames, types,
}: {
  projectId: string
  records: AttendanceRecord[]
  members: ProjectMember[]
  initialDate: string // 'YYYY-MM-DD' (오늘 — 프로젝트 시간대, 서버가 계산)
  canEdit: boolean
  /** 첫 열·쉬는 날의 원천 — 이 프로젝트의 달력(requireCalendar(cfg)) */
  calendar: CalendarView
  /** 휴무·근무 예외의 이름(holidays.name) */
  holidayNames?: Readonly<Record<string, string>>
  /** 이 프로젝트의 근태 유형(설정 attendance.types — 해석된 값) */
  types: readonly AttendanceTypeDef[]
}) {
  const router = useRouter()
  const { t } = useLocale()
  // 근태 유형 표시 — 설정 어휘(기본 라벨이면 사전 문구). 등록 선택지·범례 = 활성이면서 등록 가능한 유형.
  const typeLabel = (ty: AttendanceType) => vocabLabel('attendance.types', types, ty, t)
  const typeShort = (ty: AttendanceType) => vocabShort(types, ty, t)
  const selectable = useMemo(() => activeVocab(types).filter(e => e.selectable), [types])
  const defaultType = selectable[0]?.code ?? ''
  const searchParams = useSearchParams()
  const teamCodes = useTeamCodes()
  const teamLabelOf = useTeamLabel()   // 표·필터 칩의 팀 글자는 이름 — ?team= 값과 대조는 code 그대로
  // 챗봇 딥링크 필터는 최초 마운트에서 한 번만 읽고, 해제 전까지 달력·목록에 적용한다.
  const [botFilter, setBotFilter] = useState(() => readBotFilter(searchParams, teamCodes, types.map(e => e.code)))
  const [initY, initM] = useMemo(() => initialDate.split('-').map(Number), [initialDate])
  const [year, setYear] = useState(botFilter?.from ? Number(botFilter.from.slice(0, 4)) : initY)
  const [month0, setMonth0] = useState(
    botFilter?.from ? Number(botFilter.from.slice(5, 7)) - 1 : (initM || 1) - 1,
  )
  const [memberFilter, setMemberFilter] = useState<string>('all')
  const [memberPickerView, setMemberPickerView] = useState<MemberPickerView>('name')
  const [view, setView] = useState<ViewKey>('calendar')
  const [more, setMore] = useState<DayPopoverAnchor | null>(null)

  // 등록/수정 모달
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [form, setForm] = useState<{ memberId: string; date: string; type: AttendanceType; note: string }>({
    memberId: members[0]?.id ?? '',
    date: initialDate,
    type: defaultType,
    note: '',
  })

  const memberMap = useMemo(() => {
    const map = new Map<string, ProjectMember>()
    members.forEach(m => map.set(m.id, m))
    return map
  }, [members])

  const filtered = useMemo(() => {
    const base = memberFilter === 'all' ? records : records.filter(r => r.memberId === memberFilter)
    if (!botFilter) return base
    return base.filter(r => {
      if (botFilter.from && r.date < botFilter.from) return false
      if (botFilter.to && r.date > botFilter.to) return false
      if (botFilter.type && r.type !== botFilter.type) return false
      if (botFilter.team) {
        const mem = memberMap.get(r.memberId)
        if (!mem || !memberBelongsToTeam(mem, botFilter.team)) return false
      }
      return true
    })
  }, [records, memberFilter, botFilter, memberMap])
  // 달력 셀·팝오버의 이름 칩도 가나다순. 셀은 앞 3건만 보여주므로(초과분은 '+N'),
  // 정렬하지 않으면 '누가 잘려 나가는지'가 DB 반환 순서에 따라 바뀐다.
  const byDate = useMemo(() => {
    const map = recordsByDate(filtered)
    for (const list of Object.values(map)) {
      list.sort((a, b) => compareKoreanName(memberMap.get(a.memberId)?.name, memberMap.get(b.memberId)?.name))
    }
    return map
  }, [filtered, memberMap])
  // 첫 열 = 오늘 적용되는 규칙의 시작 요일(SP5 §4.4) — 보는 달과 무관하다
  const firstDay = currentRuleDay(calendar.weekStart, initialDate)
  const columns = useMemo(() => weekdayColumns(firstDay), [firstDay])
  const matrix = useMemo(() => monthMatrix(year, month0, firstDay), [year, month0, firstDay])
  const ym = `${year}-${String(month0 + 1).padStart(2, '0')}`
  const monthEnd = `${ym}-${String(new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()).padStart(2, '0')}`
  useBotPageContext({
    domain: 'attendance',
    projectId,
    selectedEntity: editingId ? { type: 'attendance_record', id: editingId } : null,
    view,
    range: { from: `${ym}-01`, to: monthEnd },
    filters: {
      ...(memberFilter === 'all' ? {} : { memberId: memberFilter }),
      ...(botFilter?.team ? { team: botFilter.team } : {}),
    },
  })

  // 날짜 내림차순. 같은 날짜 안에서는 이름 가나다순 —
  // memberId(UUID)로 tiebreak 하면 사람 이름이 사실상 무작위 순서로 늘어선다.
  const listRows = useMemo(
    () => [...filtered].sort((a, b) => (
      a.date < b.date ? 1 : a.date > b.date ? -1
        : compareKoreanName(memberMap.get(a.memberId)?.name, memberMap.get(b.memberId)?.name)
    )),
    [filtered, memberMap],
  )

  // 셀·팝오버가 공유하는 근태 칩 — canEdit일 때만 클릭/키보드로 수정 진입
  function renderRecChip(r: AttendanceRecord, onOpen?: () => void) {
    const meta = vocabColor(types, r.type)
    const mem = memberMap.get(r.memberId)
    const open = canEdit ? () => { onOpen?.(); openEdit(r) } : undefined
    return (
      <div
        key={r.id}
        onClick={open}
        role={canEdit ? 'button' : undefined}
        tabIndex={canEdit ? 0 : undefined}
        onKeyDown={open ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() } } : undefined}
        className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-meta font-medium ${meta.chip} ${canEdit ? 'cursor-pointer hover:ring-1 hover:ring-border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus' : ''}`}
        title={`${mem?.name ?? '?'} · ${typeLabel(r.type)}${r.note ? ` · ${r.note}` : ''}${canEdit ? ` · ${t('att.clickToEdit')}` : ''}`}
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`} />
        <span className="truncate">{mem?.name ?? '?'}</span>
        <span className="ml-auto shrink-0 opacity-75">{typeShort(r.type)}</span>
      </div>
    )
  }

  function shift(delta: number) {
    const base = new Date(Date.UTC(year, month0 + delta, 1))
    setYear(base.getUTCFullYear())
    setMonth0(base.getUTCMonth())
  }
  function goToday() {
    setYear(initY)
    setMonth0((initM || 1) - 1)
  }

  function openCreate() {
    setEditingId(null)
    setForm({ memberId: members[0]?.id ?? '', date: initialDate, type: defaultType, note: '' })
    setFormErr(null)
    setConfirmingDelete(false)
    setOpen(true)
  }

  function openEdit(r: AttendanceRecord) {
    if (!canEdit) return
    setEditingId(r.id)
    setForm({ memberId: r.memberId, date: r.date, type: r.type, note: r.note ?? '' })
    setFormErr(null)
    setConfirmingDelete(false)
    setOpen(true)
  }

  async function handleDelete() {
    if (!editingId) return
    setDeleting(true)
    const res = await removeAttendance(editingId)
    setDeleting(false)
    setConfirmingDelete(false)
    if (!res.ok) { setFormErr(res.error ?? t('att.err.deleteFailed')); return }
    setOpen(false)
    router.refresh()
  }

  async function submit() {
    if (!form.memberId) { setFormErr(t('att.err.selectMember')); return }
    if (!form.date) { setFormErr(t('att.err.selectDate')); return }
    setSaving(true)
    setFormErr(null)
    const res = await upsertAttendance(projectId, {
      memberId: form.memberId,
      date: form.date,
      type: form.type,
      note: form.note.trim() || null,
    })
    setSaving(false)
    if (!res.ok) { setFormErr(res.error ?? t('att.err.saveFailed')); return }
    setOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {/* 툴바 + 범례 (스크롤 시 상단 고정) */}
      <div className="sticky top-(--frame-sticky-top) z-10 -mx-1 space-y-3 bg-canvas/95 px-1 pb-3 pt-1 backdrop-blur-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => shift(-1)} className="chrome-icon" aria-label={t('att.prevMonth')}><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-[116px] text-center text-base font-bold tabular-nums text-fg">
              {formatYearMonth(year, month0)}
            </div>
            <button onClick={() => shift(1)} className="chrome-icon" aria-label={t('att.nextMonth')}><ChevronRight className="h-4 w-4" /></button>
            <button onClick={goToday} className="btn btn-ghost h-10">{t('att.today')}</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MemberPickerViewToggle value={memberPickerView} onChange={setMemberPickerView} compact />
            <select
              value={memberFilter}
              onChange={e => setMemberFilter(e.target.value)}
              className="app-input h-10 w-auto min-w-[140px]"
              aria-label={t('att.memberFilter')}
            >
              <option value="all">{t('att.allMembers')}</option>
              <MemberSelectOptions
                members={members}
                view={memberPickerView}
                categoryOrder={teamCodes}
                selectedId={memberFilter === 'all' ? null : memberFilter}
              />
            </select>
            <SegmentedTabs<ViewKey>
              tabs={[
                { key: 'calendar', label: t('att.view.calendar'), icon: CalendarDays },
                { key: 'list', label: t('att.view.list'), icon: List },
              ]}
              value={view}
              onChange={setView}
              size="sm"
            />
            {canEdit && (
              <button onClick={openCreate} className="btn btn-primary"><Plus className="h-4 w-4" />{t('att.addRecord')}</button>
            )}
          </div>
        </div>

        {/* 범례 */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {selectable.map(e => (
            <span key={e.code} className="inline-flex items-center gap-1.5 text-meta font-medium text-fg-secondary">
              <span className={`h-2 w-2 rounded-full ${vocabColor(types, e.code).dot}`} />
              {typeLabel(e.code)}
            </span>
          ))}
        </div>

        {/* 챗봇 딥링크 필터 — 해제 전까지 달력·목록에 적용 (문구는 att.botFilter·att.botFilterClear) */}
        {botFilter && (
          <div className="flex flex-wrap items-center gap-1.5 text-meta font-medium text-fg-secondary">
            <span className="text-fg-muted">{t('att.botFilter').replace('{name}', ASSISTANT_NAME.ko)}</span>
            {botFilter.from && botFilter.to && (
              <span className="chip bg-surface-subtle tabular-nums text-fg-secondary">{botFilter.from} ~ {botFilter.to}</span>
            )}
            {botFilter.team && <span className="chip bg-surface-subtle text-fg-secondary">{teamLabelOf(botFilter.team)}</span>}
            {botFilter.type && <span className="chip bg-surface-subtle text-fg-secondary">{typeLabel(botFilter.type)}</span>}
            <button onClick={() => setBotFilter(null)} className="btn btn-ghost h-7 px-2 text-meta">
              {t('att.botFilterClear')}
            </button>
          </div>
        )}
      </div>

      {view === 'calendar' ? (
        <div className="card overflow-hidden p-0">
          <div className="grid grid-cols-7 gap-px bg-border">
            {columns.map(c => (
              <div key={c.key} data-cal-head data-working={calendar.workingDays.has(c.iso)} className={`bg-surface-subtle py-2 text-center text-meta ${calendar.workingDays.has(c.iso) ? 'font-semibold text-fg' : 'font-normal text-fg-muted'}`}>{t(`att.weekday.${c.key}` as DictKey)}</div>
            ))}
            {matrix.flat().map(cell => {
              const inMonth = cell.startsWith(ym)
              const isToday = cell === initialDate
              const dayNum = Number(cell.slice(8, 10))
              const dayRecs = byDate[cell] ?? []
              // 쉬는 날 = 근무 요일 + 날짜 예외에서만(한국 특일 오버레이 없음 — 사용자 결정 5), 이름은 holidays.name
              const info = calendarDayInfo(cell, calendar, holidayNames)
              return (
                <div key={cell} data-date={cell} className={`min-h-[96px] p-1.5 ${info.working ? 'bg-surface' : 'bg-weekend'} ${inMonth ? '' : 'opacity-40'}`}>
                  {/* 좁은 화면(sm 미만)은 이름이 날짜 아래 한 줄을 통째로 쓰고 줄바꿈, sm 이상은 날짜 옆 한 줄 말줄임(title 로 전체) */}
                  <div className="flex flex-wrap items-center justify-between gap-x-1 px-0.5 sm:flex-nowrap">
                    <span className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-action text-action-fg' : info.working ? 'text-fg' : 'text-fg-secondary'}`}>
                      {dayNum}
                    </span>
                    {info.name && (
                      <span className="basis-full break-all text-meta font-medium leading-tight text-fg-muted sm:min-w-0 sm:basis-auto sm:truncate" title={info.name}>
                        {info.name}
                      </span>
                    )}
                    {!info.working && <RestDayMark named={!!info.name} mark={t('att.restMark')} label={t('att.restDay')} />}
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayRecs.slice(0, 3).map(r => renderRecChip(r))}
                    {dayRecs.length > 3 && (
                      <button
                        onClick={e => {
                          const r = e.currentTarget.getBoundingClientRect()
                          setMore({ date: cell, rect: { top: r.top, bottom: r.bottom, left: r.left } })
                        }}
                        className="w-full rounded-md px-1 py-0.5 text-left text-meta font-medium text-fg-muted transition hover:bg-surface-subtle hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
                      >
                        +{dayRecs.length - 3}{t('att.moreSuffix')}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {more && (
            <DayPopover anchor={more} count={(byDate[more.date] ?? []).length} onClose={() => setMore(null)}>
              {(byDate[more.date] ?? []).map(r => renderRecChip(r, () => setMore(null)))}
            </DayPopover>
          )}
        </div>
      ) : listRows.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title={t('att.empty.title')}
          description={memberFilter === 'all' ? t('att.empty.all') : t('att.empty.member')}
        />
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="px-4 py-3">{t('att.col.date')}</th>
                  <th className="px-4 py-3">{t('att.col.member')}</th>
                  <th className="px-4 py-3">{t('att.col.team')}</th>
                  <th className="px-4 py-3">{t('att.col.type')}</th>
                  <th className="px-4 py-3">{t('att.col.note')}</th>
                </tr>
              </thead>
              <tbody>
                {listRows.map(r => {
                  const meta = vocabColor(types, r.type)
                  const mem = memberMap.get(r.memberId)
                  return (
                    <tr
                      key={r.id}
                      onClick={canEdit ? () => openEdit(r) : undefined}
                      role={canEdit ? 'button' : undefined}
                      tabIndex={canEdit ? 0 : undefined}
                      onKeyDown={canEdit ? e => { if (e.key === 'Enter') openEdit(r) } : undefined}
                      className={`border-b border-border/70 last:border-0 transition hover:bg-surface-subtle ${canEdit ? 'cursor-pointer focus:outline-none focus-visible:bg-surface-subtle' : ''}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-medium tabular-nums text-fg">{fmtDate(r.date)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg">{mem?.name ?? t('att.unknown')}</div>
                        {mem?.title && <div className="text-xs text-fg-muted">{mem.title}</div>}
                      </td>
                      <td className="max-w-[12rem] truncate px-4 py-3 text-fg-secondary" title={mem?.teams[0]?.code ? teamLabelOf(mem.teams[0].code) : undefined}>{mem?.teams[0]?.code ? teamLabelOf(mem.teams[0].code) : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`chip ${meta.chip}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {typeLabel(r.type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-fg-secondary">{r.note || '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 근태 등록 모달 — 삭제 확인 모달과 상호배타로 렌더(포커스 트랩/Escape 충돌 방지) */}
      <Modal
        open={open && !confirmingDelete}
        onClose={() => setOpen(false)}
        title={editingId ? t('att.editRecord') : t('att.addRecord')}
        footer={
          <>
            {editingId && (
              <button onClick={() => setConfirmingDelete(true)} disabled={deleting || saving} className="btn btn-ghost mr-auto text-danger hover:bg-danger-weak">
                {deleting ? t('att.deleting') : t('common.delete')}
              </button>
            )}
            <button onClick={() => setOpen(false)} className="btn btn-ghost">{t('common.cancel')}</button>
            <button onClick={submit} disabled={saving || deleting} className="btn btn-primary">{saving ? t('att.saving') : t('common.save')}</button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="attendance-member" className="text-xs font-semibold text-fg-secondary">
                {t('att.form.member')}
              </label>
              <MemberPickerViewToggle value={memberPickerView} onChange={setMemberPickerView} compact />
            </div>
            <select
              id="attendance-member"
              value={form.memberId}
              onChange={e => setForm(f => ({ ...f, memberId: e.target.value }))}
              disabled={!!editingId}
              className="app-input disabled:opacity-60"
            >
              {members.length === 0 && <option value="">{t('att.form.noMembers')}</option>}
              <MemberSelectOptions
                members={members}
                view={memberPickerView}
                categoryOrder={teamCodes}
                selectedId={form.memberId || null}
              />
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('att.form.date')}</span>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                disabled={!!editingId}
                className="app-input px-2 text-xs disabled:opacity-60"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('att.form.type')}</span>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value as AttendanceType }))}
                className="app-input"
              >
                {selectable.map(e => (
                  <option key={e.code} value={e.code}>{typeLabel(e.code)}</option>
                ))}
                {/* 수정 중인 기록의 유형이 선택지 밖(비활성·등록 불가)이면 그 값을 보존해 보인다 — 저장 시 서버가 활성 여부를 다시 본다 */}
                {form.type && !selectable.some(e => e.code === form.type) && (
                  <option value={form.type}>{typeLabel(form.type)}</option>
                )}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('att.form.note')}</span>
            <textarea
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              rows={2}
              placeholder={t('att.form.notePlaceholder')}
              className="app-textarea"
            />
          </label>
          {editingId && (
            <p className="text-meta leading-5 text-fg-muted">{t('att.form.lockedHint')}</p>
          )}
          {formErr && <p className="text-xs font-medium text-danger">{formErr}</p>}
        </div>
      </Modal>

      {/* 근태 삭제 확인 모달 — 취소 시 수정 모달로 복귀 */}
      <Modal
        open={open && confirmingDelete}
        onClose={() => { if (!deleting) setConfirmingDelete(false) }}
        size="sm"
        title={t('att.deleteTitle')}
        footer={
          <>
            <button onClick={() => setConfirmingDelete(false)} className="btn btn-ghost" disabled={deleting}>
              {t('common.cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="btn bg-danger text-danger-fg transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? t('att.deleting') : t('common.delete')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-fg-secondary">
          {/* 이름(굵게)이 문장 안에 끼어 {name} 자리에서 문장을 둘로 가른다 */}
          {(() => {
            const [before, after = ''] = t('att.deleteConfirmBody').replace('{date}', fmtDate(form.date)).split('{name}')
            return <>{before}<strong className="text-fg">{memberMap.get(form.memberId)?.name ?? t('att.unknown')}</strong>{after}</>
          })()}
        </p>
      </Modal>
    </div>
  )
}
