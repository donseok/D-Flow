'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronRight, CircleDashed, HelpCircle, SkipForward, X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { setupProgress, setupStepHref, type SetupStep, type SetupStepId } from '@/lib/domain/projectSetup'
import type { DictKey } from '@/lib/i18n/dict'

/** '{n}' 꼴 자리 채우기 — 사전 문구의 수·이름 */
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

type Saved = { skipped: string[]; hidden: boolean }
const EMPTY: Saved = { skipped: [], hidden: false }

/** 브라우저에 둔 사용자 선택(건너뛴 단계·닫음) — 모르는 모양은 빈 값으로 읽는다. 완료 여부는 여기 없다(서버 상태가 정본) */
function parseSaved(raw: string | null): Saved {
  if (!raw) return EMPTY
  const v: unknown = JSON.parse(raw)
  if (typeof v !== 'object' || v === null) return EMPTY
  const o = v as Record<string, unknown>
  return {
    skipped: Array.isArray(o.skipped) ? o.skipped.filter((x): x is string => typeof x === 'string') : [],
    hidden: o.hidden === true,
  }
}

/**
 * 프로젝트 준비 체크리스트(첫 사용 흐름). 단계의 완료는 서버가 실제 상태로 판정해 내린다(steps — domain/projectSetup, 설정은 해석기).
 * 이 컴포넌트가 브라우저에 저장하는 것은 사용자의 선택 둘뿐이다: 건너뛴 단계와 닫음. 서버 상태가 완료인 단계는 건너뛰기 표시보다 우선한다.
 *  - panel(설정 화면 맨 위): 단계 목록 — 상태·해당 설정으로 가는 링크·건너뛰기. 닫으면 다시 여는 버튼 하나만 남는다.
 *  - banner(개요 화면 맨 위, 프로젝트 관리자에게만): 접힌 한 줄 — 진행·다음 단계·전체 보기·닫기. 남은 단계가 없거나 닫았으면 아무것도 그리지 않는다.
 * 저장 키는 계정·프로젝트별이다(v2 — 옛 v1 은 "몇 번째 단계까지 확인했나"라 뜻이 달라 읽지 않는다).
 */
export function ProjectSetupChecklist({ projectId, userId, steps, variant = 'panel' }: {
  projectId: string
  userId: string
  steps: readonly SetupStep[]
  variant?: 'panel' | 'banner'
}) {
  const { t } = useLocale()
  const key = `project-setup:v2:${userId}:${projectId}`
  const [saved, setSaved] = useState<Saved>(EMPTY)
  // 저장값을 읽기 전에는 배너를 그리지 않는다 — 닫은 사람에게 배너가 한 번 번쩍이지 않게(패널은 읽기 전에도 목록을 그린다)
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    try { setSaved(parseSaved(localStorage.getItem(key))) } catch { setStorageError(true) }
    setReady(true)
  }, [key])
  const save = (next: Saved) => {
    setSaved(next)
    try { localStorage.setItem(key, JSON.stringify(next)); setStorageError(false) } catch { setStorageError(true) }
  }

  const skipped = new Set(saved.skipped)
  const progress = setupProgress(steps, skipped)
  const title = (id: SetupStepId) => t(`setup.step.${id}` as DictKey)
  const toggleSkip = (id: SetupStepId) =>
    save({ ...saved, skipped: skipped.has(id) ? saved.skipped.filter((x) => x !== id) : [...saved.skipped, id] })

  if (variant === 'banner') {
    if (!ready || saved.hidden || progress.next === null) return null
    return (
      <section aria-label={t('setup.banner.label')} data-setup-banner
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-(--radius-panel) border border-border bg-surface shadow-(--shadow-card) px-4 py-2.5 text-sm">
        <span className="font-semibold text-fg">{t('setup.banner.label')}</span>
        <span className="tabular-nums text-fg-secondary">{fill(t('setup.progress'), { done: progress.done, total: progress.total })}</span>
        <a href={setupStepHref(projectId, progress.next)} data-setup-next
          className="inline-flex min-w-0 items-center gap-1 font-semibold text-action underline underline-offset-2 hover:text-action-hover">
          <span className="truncate">{fill(t('setup.banner.next'), { step: title(progress.next) })}</span>
          <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
        </a>
        <span className="ml-auto flex items-center gap-1">
          <a href={`/p/${projectId}/settings`} className="btn btn-ghost h-8 px-3 text-xs">{t('setup.banner.all')}</a>
          <button type="button" onClick={() => save({ ...saved, hidden: true })} className="btn btn-ghost h-8 px-3 text-xs"
            aria-label={t('setup.banner.dismiss')} title={t('setup.banner.dismiss')}>
            <X className="h-4 w-4" aria-hidden />
          </button>
        </span>
      </section>
    )
  }

  if (saved.hidden) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => save({ ...saved, hidden: false })}>
        {t('setup.show')} · {fill(t('setup.progress'), { done: progress.done, total: progress.total })}
      </button>
    )
  }
  const allDone = progress.done === progress.total
  return (
    <section aria-label={t('setup.title')} data-setup-panel className="space-y-3 rounded-(--radius-panel) border border-border bg-surface shadow-(--shadow-card) p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-fg">
          {t('setup.title')} <span className="ml-1 text-sm font-medium tabular-nums text-fg-secondary">{fill(t('setup.progress'), { done: progress.done, total: progress.total })}</span>
        </h2>
        <button type="button" className="btn btn-ghost h-8 px-3 text-xs" onClick={() => save({ ...saved, hidden: true })}>{t('setup.hide')}</button>
      </div>
      <p className="text-sm text-fg-secondary">{allDone ? t('setup.allDone') : progress.settled ? t('setup.allSettled') : t('setup.lead')}</p>
      <ol className="divide-y divide-border">
        {steps.map((step) => {
          const isSkipped = step.state !== 'done' && skipped.has(step.id)
          const view = step.state === 'done' ? 'done' : step.state === 'unknown' ? 'unknown' : isSkipped ? 'skipped' : 'todo'
          const Icon = view === 'done' ? Check : view === 'unknown' ? HelpCircle : view === 'skipped' ? SkipForward : CircleDashed
          const tone = view === 'done' ? 'text-success' : view === 'unknown' ? 'text-warning' : view === 'skipped' ? 'text-fg-muted' : 'text-action'
          return (
            <li key={step.id} data-setup-step={step.id} data-setup-state={view} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${view === 'done' || view === 'skipped' ? 'text-fg-secondary' : 'text-fg'}`}>
                  {title(step.id)}
                  <span className={`ml-2 text-xs font-medium ${tone}`}>{t(`setup.state.${view}` as DictKey)}</span>
                </p>
                <p className="text-xs leading-5 text-fg-muted">
                  {view === 'unknown' ? t('setup.unknownHint') : t(`setup.step.${step.id}.desc` as DictKey)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <a href={setupStepHref(projectId, step.id)} className="btn btn-ghost h-8 px-3 text-xs" aria-label={fill(t('setup.openLabel'), { step: title(step.id) })}>
                  {t('setup.open')}
                </a>
                {step.state === 'todo' && (
                  <button type="button" className="btn btn-ghost h-8 px-3 text-xs" onClick={() => toggleSkip(step.id)}
                    aria-label={fill(t(isSkipped ? 'setup.unskipLabel' : 'setup.skipLabel'), { step: title(step.id) })}>
                    {t(isSkipped ? 'setup.unskip' : 'setup.skip')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-fg-muted">{t('setup.storageNote')}</p>
      {storageError && <p role="alert" className="text-sm text-warning">{t('setup.storageError')}</p>}
    </section>
  )
}
