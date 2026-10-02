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
import type { Locale } from '@/lib/i18n/dict'
import type { CalendarFieldState } from '@/lib/settings/calendarField'
import { ConfigStateNotice } from './ConfigStateNotice'
import { ConflictCompare } from './ConflictCompare'
import { TimezoneSelect } from './TimezoneSelect'
import { WeekStartEditor } from './WeekStartEditor'
import { reviewBlocksSave, type WeekStartReviewState } from './WeekStartReview'
import { WorkingDaysEditor } from './WorkingDaysEditor'

export type CalendarScope = { projectId: string } | { workspaceId: string }
type Key = 'calendar.timezone' | 'calendar.working_days' | 'calendar.week_start'
type Draft = { timezone: string; workingDays: IsoDow[]; weekDay: WeekStartDay }
type Conflict = { revision: number; values: Partial<Record<string, unknown>>; invalidKeys: string[] }

const LABEL: Readonly<Record<Key, string>> = { 'calendar.week_start': '주 시작', 'calendar.working_days': '근무 요일', 'calendar.timezone': '시간대' }
const KEYS: readonly Key[] = ['calendar.week_start', 'calendar.working_days', 'calendar.timezone']

function sourceLabel(scope: CalendarScope, s: CalendarFieldState<unknown>): string {
  if (s.source === 'invalid') return '설정 손상'
  if (s.source === 'default') return '제품 기본값'
  return 'projectId' in scope ? '프로젝트 설정' : '워크스페이스 설정'
}
/** 오늘 적용되는 요일과 아직 적용 전인 전환(마지막 원소의 from > 오늘) */
function weekState(rules: readonly WeekStartRule[] | null, todayIso: string | null): { day: WeekStartDay; scheduled: WeekStartRule | null } {
  if (!rules || rules.length === 0) return { day: 'sunday', scheduled: null }
  const last = rules[rules.length - 1]
  if (!todayIso) return { day: last.day, scheduled: null }
  const scheduled = last.from !== null && last.from > todayIso ? last : null
  return { day: currentRuleDay(rules, todayIso), scheduled }
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
  canEdit: boolean; locale?: Locale
}) {
  const { scope, canEdit, locale = 'ko' } = props
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

  const corrupted: Record<Key, boolean> = {
    'calendar.timezone': props.timezone.source === 'invalid', 'calendar.working_days': props.workingDays.source === 'invalid',
    'calendar.week_start': props.weekStart.source === 'invalid',
  }
  const changed = KEYS.filter(k => !same(draft, baseline, k) || (corrupted[k] && !repaired.includes(k)))
  const tzCheck = parseTimezone(draft.timezone.trim())
  const wdCheck = parseWorkingDays(draft.workingDays)
  const weekChanged = draft.weekDay !== baseline.weekDay
  const { scheduled } = weekState(props.weekStart.value, props.todayIso)
  const reviewBlocks = isProject && weekChanged && reviewBlocksSave(review)
  const invalidInput = !tzCheck.ok || !wdCheck.ok
  const saveDisabled = !canEdit || pending || !!conflict || invalidInput || reviewBlocks || (changed.length === 0 && !uncertainPatch)

  // 주 시작을 바꾸면 서버 미리보기 — 마지막 요청의 응답만 쓴다. 의존성은 문자열 id(페이지가 scope 를 리터럴로 넘겨도 재요청하지 않게)
  const projectId = 'projectId' in scope ? scope.projectId : null
  useEffect(() => {
    if (!projectId || !weekChanged) { setReview(null); return }
    const seq = ++reviewSeq.current
    setReview({ kind: 'loading' })
    previewWeekStartChange(projectId, draft.weekDay).then(
      r => { if (seq === reviewSeq.current) setReview(r.ok ? { kind: 'ready', preview: r.preview } : { kind: 'error', message: r.error }) },
      () => { if (seq === reviewSeq.current) setReview({ kind: 'error', message: '영향을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.' }) },
    )
  }, [projectId, weekChanged, draft.weekDay])

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
    if (result?.ok) { applied(result.revision, result.revision === patch.expectedRevision ? '바뀐 값이 없습니다.' : `${changed.length}개 설정을 저장했습니다.`); return }
    if (result?.kind === 'conflict') {
      setConflict({ revision: result.latest.revision, values: result.latest.values, invalidKeys: result.latest.invalidKeys }); setUncertainPatch(null); setFieldErrors({}); return
    }
    if (result && (result.kind !== 'unavailable' || !result.retryable)) {
      const entries = result.kind === 'invalid' ? result.fieldErrors.filter(e => KEYS.includes(e.key as Key)).map(e => [e.key, e.message] as const) : []
      setFieldErrors(Object.fromEntries(entries)); setError(entries.length > 0 ? null : result.error); setUncertainPatch(null); return
    }
    try {
      const found = await getSettingsCommandOutcome(scope, patch.commandId)
      if (found.ok && found.outcome.status === 'applied') { applied(found.outcome.revision, '저장된 명령을 확인했습니다.'); return }
    } catch { /* 같은 명령을 재전송 */ }
    if (resendCount === 0) return submit(patch, 1)
    setUncertainPatch(patch); setError('저장 결과를 확인하지 못했습니다. 같은 명령으로 다시 확인하세요.')
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
    ? <ConfigStateNotice kind="invalid" locale={locale} keyName={k} message={s.error} isAdmin={canEdit} settingsHref={href} />
    : null
  const fieldNotice = (k: Key) => fieldErrors[k] ? <ConfigStateNotice kind="field" locale={locale} message={fieldErrors[k]} /> : null
  const keyLine = (k: Key) => <p className="text-[11px] text-fg-muted">{k}</p>
  const head = (k: Key, s: CalendarFieldState<unknown>, applies: string, labelFor?: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {labelFor
        ? <label htmlFor={labelFor} className="text-sm font-semibold text-fg">{LABEL[k]}</label>
        : <span className="text-sm font-semibold text-fg">{LABEL[k]}</span>}
      <span className="text-xs text-fg-muted">{sourceLabel(scope, s)} · {applies}</span>
    </div>
  )

  return (
    <div className="space-y-5">
      {isProject && (
        <p className="text-xs leading-5 text-fg-muted">
          워크스페이스 기본값에서 복사됨(생성 시점) — 새 프로젝트를 만들 때 워크스페이스의 값을 한 번 복사합니다. 워크스페이스 값을 바꿔도 이 프로젝트는 바뀌지 않습니다.
        </p>
      )}

      <section className="space-y-2 border-b border-border pb-4" data-field="calendar.week_start" aria-label={LABEL['calendar.week_start']}>
        {head('calendar.week_start', props.weekStart, isProject ? '다음 주부터 적용' : '새 프로젝트의 초기값')}
        {corruptNotice('calendar.week_start', props.weekStart, '#calendar-week-start')}
        <WeekStartEditor value={draft.weekDay} onChange={day => edit({ weekDay: day }, 'calendar.week_start')} disabled={inputsLocked}
          scheduled={isProject ? scheduled : null} review={isProject && weekChanged ? review : null} />
        {fieldNotice('calendar.week_start')}
        {keyLine('calendar.week_start')}
      </section>

      <section className="space-y-2 border-b border-border pb-4" data-field="calendar.working_days" aria-label={LABEL['calendar.working_days']}>
        {head('calendar.working_days', props.workingDays, '즉시 적용(저장된 진척 기록은 다시 계산하지 않습니다)')}
        {corruptNotice('calendar.working_days', props.workingDays, '#calendar-working-days')}
        <WorkingDaysEditor value={draft.workingDays} onChange={days => edit({ workingDays: days }, 'calendar.working_days')} disabled={inputsLocked} locale={locale} />
        {fieldNotice('calendar.working_days')}
        {keyLine('calendar.working_days')}
      </section>

      <section className="space-y-2" data-field="calendar.timezone" aria-label={LABEL['calendar.timezone']}>
        {head('calendar.timezone', props.timezone, '즉시 적용(저장된 날짜는 바뀌지 않습니다)', 'calendar-timezone')}
        {corruptNotice('calendar.timezone', props.timezone, '#calendar-timezone')}
        <TimezoneSelect value={draft.timezone} onChange={tz => edit({ timezone: tz }, 'calendar.timezone')} disabled={inputsLocked} locale={locale} />
        {fieldNotice('calendar.timezone')}
        {keyLine('calendar.timezone')}
      </section>

      {conflict && <ConflictCompare rows={changed.map(k => ({ key: k, label: LABEL[k], mine: String(stored(draft, k)),
        latest: conflict.invalidKeys.includes(k) ? '설정 손상' : JSON.stringify(conflict.values[k] ?? null) }))}
        onMine={chooseMine} onLatest={chooseLatest} latestAvailable={changed.every(k => !conflict.invalidKeys.includes(k))} />}
      {error && <ConfigStateNotice kind="patch" locale={locale} message={error} />}
      {notice && <p role="status" className="text-sm text-done">{notice}</p>}
      <div data-save-bar className="sticky bottom-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 shadow-sm">
        <span className="text-xs text-fg-muted">변경 {changed.length}개</span>
        <button type="button" className="btn btn-primary" disabled={saveDisabled} onClick={save}>
          {uncertainPatch ? '저장 결과 확인 및 재시도' : '저장'}
        </button>
      </div>
    </div>
  )
}
