'use client'
// 달력 설정 절(스펙 §5.1 A — 주 시작(일·월)·근무 요일·시간대). 프로젝트·워크스페이스 두 범위가 같은 편집기를 쓴다.
// 키마다 편집 컴포넌트는 설정 정의의 custom 위젯 이름 그대로다(판정 J1 — WeekStartEditor·WorkingDaysEditor·TimezoneSelect).
// 저장은 설정 액션 한 길(updateProjectSettings·updateWorkspaceSettings — 결과 kind 처리는 WorkspaceFieldsEditor 와 같다).
// 프로젝트 주 시작은 요일 하나를 보내고 규칙 목록은 서버(edit.toStored)가 만든다. 바꾸기 전에 서버 미리보기('변경 내용 검토')를 받고,
// 막는 주차가 있으면 저장하지 않는다(DB 의 정확 판정이 최종 — D53). 값 검증은 calendar.ts 의 parse* 를 그대로 쓴다(서버와 같은 규칙).
import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { getSettingsCommandOutcome, updateProjectSettings, updateWorkspaceSettings, type SettingsCommandResult, type SettingsPatch } from '@/app/actions/settings'
import { previewWeekStartChange } from '@/app/actions/settingsPreview'
import { currentRuleDay, parseTimezone, parseWorkingDays, type IsoDow, type WeekStartDay, type WeekStartRule } from '@/lib/domain/calendar'
import { newUuid } from '@/lib/domain/uuid'
import type { DictKey} from '@/lib/i18n/dict'
import { browserTimezoneSuggestion, type CalendarFieldState } from '@/lib/settings/calendarField'
import { SettingsSaveBar } from './SettingsSaveBar'
import { ConfigStateNotice } from './ConfigStateNotice'
import { ConflictCompare } from './ConflictCompare'
import { TimezoneSelect } from './TimezoneSelect'
import { WeekStartEditor } from './WeekStartEditor'
import { reviewBlocksSave, type WeekStartReviewState } from './WeekStartReview'
import { WorkingDaysEditor } from './WorkingDaysEditor'
import { useLocale } from '@/components/providers/LocaleProvider'

export type CalendarScope = { projectId: string } | { workspaceId: string }
type Key = 'calendar.timezone' | 'calendar.working_days' | 'calendar.week_start'
/** weekDay '' = 저장된 주 시작이 손상돼 고른 요일이 없다(사용자가 골라야 저장 대상 — A-5 리뷰 O7) */
type Draft = { timezone: string; workingDays: IsoDow[]; weekDay: WeekStartDay | '' }
type Conflict = { revision: number; values: Partial<Record<string, unknown>>; invalidKeys: string[] }

type T = (k: DictKey) => string
const LABEL: Readonly<Record<Key, DictKey>> = { 'calendar.week_start': 'settings.weekStart.label', 'calendar.working_days': 'settings.calendar.working_days.label', 'calendar.timezone': 'settings.calendar.timezone.label' }
const KEYS: readonly Key[] = ['calendar.week_start', 'calendar.working_days', 'calendar.timezone']

function sourceLabel(scope: CalendarScope, s: CalendarFieldState<unknown>, t: T): string {
  if (s.source === 'invalid') return t('settings.notify.policy.corrupted')
  if (s.source === 'default') return t('settings.wsFields.source.product')
  return 'projectId' in scope ? t('settings.source.project') : t('settings.wsFields.source.workspace')
}
/** 편집 요일 = 마지막 원소의 요일(예정 전환이 있으면 그 요일 — 직전 요일을 고르는 것이 곧 예정 취소다, A-5 리뷰 P2·O1),
 *  오늘 적용되는 요일, 아직 적용 전인 전환(마지막 원소의 from > 오늘). 저장 직후(baseline = 보낸 요일)와 새로고침 뒤가 같은 요일이다 */
function weekState(rules: readonly WeekStartRule[] | null, todayIso: string | null): { day: WeekStartDay | ''; current: WeekStartDay | null; scheduled: WeekStartRule | null } {
  if (!rules || rules.length === 0) return { day: '', current: null, scheduled: null }   // 손상 — 기본 요일을 고른 것처럼 보이지 않는다
  const last = rules[rules.length - 1]
  if (!todayIso) return { day: last.day, current: last.day, scheduled: null }
  const scheduled = last.from !== null && last.from > todayIso ? last : null
  return { day: last.day, current: currentRuleDay(rules, todayIso), scheduled }
}
function draftOf(p: { timezone: CalendarFieldState<string>; workingDays: CalendarFieldState<IsoDow[]>; weekStart: CalendarFieldState<WeekStartRule[]>; todayIso: string | null }): Draft {
  return { timezone: p.timezone.value ?? '', workingDays: [...(p.workingDays.value ?? [])].sort((a, b) => a - b), weekDay: weekState(p.weekStart.value, p.todayIso).day }
}
const same = (a: Draft, b: Draft, k: Key) => k === 'calendar.timezone' ? a.timezone.trim() === b.timezone.trim()
  : k === 'calendar.working_days' ? JSON.stringify(a.workingDays) === JSON.stringify(b.workingDays) : a.weekDay === b.weekDay
const stored = (d: Draft, k: Key): unknown => k === 'calendar.timezone' ? d.timezone.trim() : k === 'calendar.working_days' ? [...d.workingDays].sort((a, b) => a - b) : d.weekDay

export function CalendarSettingsPanel(props: {
  scope: CalendarScope; revision: number; todayIso: string | null
  timezone: CalendarFieldState<string>; workingDays: CalendarFieldState<IsoDow[]>; weekStart: CalendarFieldState<WeekStartRule[]>
  canEdit: boolean;
  /** 워크스페이스 — 시간대가 아직 제품 기본값이면 브라우저 시간대를 제안(D13 ② — 자동 저장 없음, 저장은 관리자가) */
  suggestBrowserTimezone?: boolean
}) {
  const { t } = useLocale()
  const { scope, canEdit } = props
  const isProject = 'projectId' in scope
  const router = useRouter()
  const [draft, setDraft] = useState<Draft>(() => draftOf(props))
  const [baseline, setBaseline] = useState<Draft>(() => draftOf(props))
  const [baseRevision, setBaseRevision] = useState(props.revision)
  const [repaired, setRepaired] = useState<Key[]>([])
  const [review, setReview] = useState<WeekStartReviewState | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [uncertainPatch, setUncertainPatch] = useState<SettingsPatch | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Key, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const reviewSeq = useRef(0)
  // 브라우저 값은 마운트 뒤에만 읽는다 — 서버 렌더와 첫 클라이언트 렌더가 같아야 한다
  const [suggestion, setSuggestion] = useState<string | null>(null)
  useEffect(() => {
    if (props.suggestBrowserTimezone && props.timezone.source === 'default') setSuggestion(browserTimezoneSuggestion())
  }, [props.suggestBrowserTimezone, props.timezone.source])

  // 키 단위 판정(A-5 리뷰 O7 → a6 리뷰 Q1 — 세 키 모두): 바꾼 키만 보낸다. 손상 키도 자동으로 포함하지 않는다 — 손상 키의 초안은 빈 값이라
  // (calendarFieldOf 의 value null) 다시 저장할 값이 없고, 그 빈 값 검증이 다른 키 저장까지 막았다. 서버(buildStored·settings_ref_check)도
  // set 의 키만 판정한다. 손상 키를 고치려면 그 키에 값을 넣는다 — 손상 표지(corruptNotice)가 그 자리를 가리킨다.
  const changed = KEYS.filter(k => !same(draft, baseline, k))
  const tzCheck = parseTimezone(draft.timezone.trim())
  const wdCheck = parseWorkingDays(draft.workingDays)
  const weekChanged = draft.weekDay !== baseline.weekDay
  const { scheduled, current: currentDay } = weekState(props.weekStart.value, props.todayIso)
  const reviewBlocks = isProject && weekChanged && reviewBlocksSave(review)
  // 입력 오류는 보낼 키에서만 — 건드리지 않은 손상 키의 빈 초안이 저장 버튼 전체를 끄지 않게
  const invalidInput = (changed.includes('calendar.timezone') && !tzCheck.ok) || (changed.includes('calendar.working_days') && !wdCheck.ok)
  const saveDisabled = !canEdit || pending || !!conflict || invalidInput || reviewBlocks || (changed.length === 0 && !uncertainPatch)
  // 저장이 막힌 이유(변경 없음·권한·진행 중은 제외) — 저장 버튼의 aria-describedby 로 잇는다(A-5 리뷰 O3)
  const saveReason = !canEdit ? null
    : conflict ? t('settings.calendarPanel.conflictFirst')
    : invalidInput ? t('settings.calendarPanel.fixInputs')
    : reviewBlocks ? t('settings.calendarPanel.reviewPending')
    : null
  const saveDescribedBy = [saveReason ? 'calendar-save-reason' : null, reviewBlocks ? 'calendar-week-start-review' : null].filter(Boolean).join(' ') || undefined

  // 주 시작을 바꾸면 서버 미리보기 — 마지막 요청의 응답만 쓴다. 의존성은 문자열 id(페이지가 scope 를 리터럴로 넘겨도 재요청하지 않게)
  const projectId = 'projectId' in scope ? scope.projectId : null
  useEffect(() => {
    if (!projectId || !weekChanged || !draft.weekDay) { setReview(null); return }
    const seq = ++reviewSeq.current
    setReview({ kind: 'loading' })
    previewWeekStartChange(projectId, draft.weekDay).then(
      r => { if (seq === reviewSeq.current) setReview(r.ok ? { kind: 'ready', preview: r.preview } : { kind: 'error', message: r.error }) },
      () => { if (seq === reviewSeq.current) setReview({ kind: 'error', message: t('settings.calendarPanel.impactFailed') }) },
    )
  }, [projectId, weekChanged, draft.weekDay, t])

  async function update(patch: SettingsPatch): Promise<SettingsCommandResult> {
    return 'projectId' in scope ? updateProjectSettings(scope.projectId, patch) : updateWorkspaceSettings(scope.workspaceId, patch)
  }
  function applied(revision: number, message: string) {
    setBaseline({ ...draft }); setBaseRevision(revision); setRepaired([...repaired, ...changed])
    setUncertainPatch(null); setConflict(null); setFieldErrors({}); setReview(null); setNotice(message); router.refresh()
  }
  async function submit(patch: SettingsPatch, resendCount = 0): Promise<void> {
    let result: SettingsCommandResult | null = null
    try { result = await update(patch) } catch { /* 이력으로 결과 판정 */ }
    if (result?.ok) { applied(result.revision, result.revision === patch.expectedRevision ? t('settings.save.noChange') : t('settings.wsFields.saved').replace('{n}', String(changed.length))); return }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, values: result.latest.values, invalidKeys: result.latest.invalidKeys }); setUncertainPatch(null); setFieldErrors({}); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const entries = result.kind === 'invalid' ? result.fieldErrors.filter(e => KEYS.includes(e.key as Key)).map(e => [e.key, e.message] as const) : []
      setFieldErrors(Object.fromEntries(entries)); setError(entries.length > 0 ? null : result.error); setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome(scope, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') { applied(found.outcome.revision, t('settings.save.confirmed')); return }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch); setError(t('settings.rootFolders.uncertain'))
  }
  function save() {
    if (saveDisabled) return
    setError(null); setFieldErrors({}); setNotice(null)
    const set = Object.fromEntries(changed.map(k => [k, stored(draft, k)]))
    const patch = uncertainPatch ?? { expectedRevision: baseRevision, commandId: newUuid(), set, unset: [] }
    startTransition(async () => submit(patch))
  }
  function edit(next: Partial<Draft>, key: Key) {
    setDraft(cur => ({ ...cur, ...next }))
    setFieldErrors(cur => { const n = { ...cur }; delete n[key]; return n })
    setError(null); setNotice(null)
  }
  function chooseLatest() {
    if (!conflict) return
    const latest: Draft = { ...draft }
    const v = conflict.values
    if (!conflict.invalidKeys.includes('calendar.timezone') && typeof v['calendar.timezone'] === 'string') latest.timezone = v['calendar.timezone'] as string
    if (!conflict.invalidKeys.includes('calendar.working_days') && Array.isArray(v['calendar.working_days'])) latest.workingDays = [...(v['calendar.working_days'] as IsoDow[])].sort((a, b) => a - b)
    const ws = v['calendar.week_start']
    if (!conflict.invalidKeys.includes('calendar.week_start') && ws !== undefined) {
      latest.weekDay = typeof ws === 'string' ? ws as WeekStartDay : weekState(ws as WeekStartRule[], props.todayIso).day
    }
    setDraft(latest); setBaseline(latest); setBaseRevision(conflict.revision); setConflict(null); setError(null)
  }
  function chooseMine() {
    if (!conflict) return
    setBaseRevision(conflict.revision); setConflict(null); setError(null)
  }

  const inputsLocked = !canEdit || pending || !!uncertainPatch
  const corruptNotice = (k: Key, s: CalendarFieldState<unknown>, href: string) => s.error && !repaired.includes(k)
    ? <ConfigStateNotice kind="invalid" keyName={k} message={s.error} isAdmin={canEdit} settingsHref={href} />
    : null
  const fieldNotice = (k: Key) => fieldErrors[k] ? <ConfigStateNotice kind="field" message={fieldErrors[k]} /> : null
  const keyLine = (k: Key) => <p className="text-meta text-fg-muted">{k}</p>
  const head = (k: Key, s: CalendarFieldState<unknown>, applies: string, labelFor?: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {labelFor
        ? <label htmlFor={labelFor} className="text-sm font-semibold text-fg">{t(LABEL[k])}</label>
        : <span className="text-sm font-semibold text-fg">{t(LABEL[k])}</span>}
      <span className="text-xs text-fg-muted">{sourceLabel(scope, s, t)} · {applies}</span>
    </div>
  )

  return (
    <div className="space-y-5">
      {isProject && (
        <p className="text-xs leading-5 text-fg-muted">
          {t('settings.calendarPanel.copiedNote')}
        </p>
      )}

      <section className="space-y-2 border-b border-border pb-4" data-field="calendar.week_start" aria-label={t(LABEL['calendar.week_start'])}>
        {head('calendar.week_start', props.weekStart, isProject ? t('settings.calendarPanel.appliesNextWeek') : t('settings.calendarPanel.initialForNew'))}
        {corruptNotice('calendar.week_start', props.weekStart, '#calendar-week-start')}
        <WeekStartEditor value={draft.weekDay} onChange={day => edit({ weekDay: day }, 'calendar.week_start')} disabled={inputsLocked}
          scheduled={isProject ? scheduled : null} currentDay={currentDay ?? undefined} review={isProject && weekChanged ? review : null}
          onClear={baseline.weekDay === '' && draft.weekDay !== '' ? () => edit({ weekDay: '' }, 'calendar.week_start') : undefined} />
        {fieldNotice('calendar.week_start')}
        {keyLine('calendar.week_start')}
      </section>

      <section className="space-y-2 border-b border-border pb-4" data-field="calendar.working_days" aria-label={t(LABEL['calendar.working_days'])}>
        {head('calendar.working_days', props.workingDays, t('settings.calendarPanel.appliesNowProgress'))}
        {corruptNotice('calendar.working_days', props.workingDays, '#calendar-working-days')}
        <WorkingDaysEditor value={draft.workingDays} onChange={days => edit({ workingDays: days }, 'calendar.working_days')} disabled={inputsLocked} />
        {fieldNotice('calendar.working_days')}
        {keyLine('calendar.working_days')}
      </section>

      <section className="space-y-2" data-field="calendar.timezone" aria-label={t(LABEL['calendar.timezone'])}>
        {head('calendar.timezone', props.timezone, t('settings.calendarPanel.appliesNowDates'), 'calendar-timezone')}
        {corruptNotice('calendar.timezone', props.timezone, '#calendar-timezone')}
        <TimezoneSelect value={draft.timezone} onChange={tz => edit({ timezone: tz }, 'calendar.timezone')} disabled={inputsLocked}
          suggestion={suggestion && suggestion !== draft.timezone.trim() && !inputsLocked ? { label: t('settings.calendarPanel.suggestTz').replace('{suggestion}', String(suggestion)), value: suggestion } : null} />
        {fieldNotice('calendar.timezone')}
        {keyLine('calendar.timezone')}
      </section>

      {conflict && <ConflictCompare rows={changed.map(k => ({ key: k, label: t(LABEL[k]), mine: String(stored(draft, k)),
        latest: conflict.invalidKeys.includes(k) ? t('settings.notify.policy.corrupted') : JSON.stringify(conflict.values[k] ?? null) }))}
        onMine={chooseMine} onLatest={chooseLatest} latestAvailable={changed.every(k => !conflict.invalidKeys.includes(k))} />}
      {error && <ConfigStateNotice kind="patch" message={error} />}
      <SettingsSaveBar notice={notice} summary={t('settings.wsFields.changed').replace('{n}', String(changed.length))}>
        {/* 저장이 막힌 이유는 버튼 옆에 보인다 — 예전에는 화면 낭독기에만 읽혀(sr-only) 버튼만 꺼진 것처럼 보였다(BUG-31) */}
        {saveReason && <span id="calendar-save-reason" className="text-meta text-danger">{saveReason}</span>}
        <button type="button" className="btn btn-primary" disabled={saveDisabled} onClick={save} aria-describedby={saveDescribedBy}>
          {uncertainPatch ? t('settings.workflow.retry') : t('common.save')}
        </button>
      </SettingsSaveBar>
    </div>
  )
}
