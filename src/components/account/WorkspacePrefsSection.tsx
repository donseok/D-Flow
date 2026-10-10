'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import type { UiPrefs } from '@/lib/domain/types'
import { queueUiPref, queueWorkspacePref } from '@/lib/prefs/debouncedSave'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { rovingRadioIndex } from './rovingRadio'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

const START_PAGES = [['home', 'account.start.home'], ['my_work', 'account.start.myWork'], ['projects', 'account.start.projects'], ['last_project', 'account.start.lastProject']] as const satisfies readonly (readonly [string, DictKey])[]
const PROJECT_VIEWS = [['rows', 'account.view.rows'], ['cards', 'account.view.cards']] as const satisfies readonly (readonly [string, DictKey])[]

function PrefRadioGroup<T extends string>({ label, choices, initial, save }: {
  label: string; choices: readonly (readonly [T, DictKey])[]; initial: T; save: (value: T) => void
}) {
  const { t } = useLocale()
  const [value, setValue] = useState(initial)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  function select(next: T) {
    if (next === value) return
    setValue(next); save(next)
  }
  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const next = rovingRadioIndex(e.key, i, choices.length)
    if (next === null) return
    e.preventDefault(); select(choices[next][0]); refs.current[next]?.focus()
  }
  return <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-(--radius-control) bg-surface-subtle p-1">
    {choices.map(([v, text], i) => <button key={v} ref={el => { refs.current[i] = el }} type="button" role="radio" aria-checked={v === value} tabIndex={v === value ? 0 : -1}
      onClick={() => select(v)} onKeyDown={e => onKeyDown(e, i)}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-(--radius-control) px-2 text-xs font-medium transition-colors duration-(--motion-fast) ${v === value ? 'bg-surface font-semibold text-fg shadow-(--shadow-card)' : 'text-fg-secondary hover:text-fg'}`}>
      <Check className={`h-3.5 w-3.5 ${v === value ? '' : 'invisible'}`} aria-hidden />{t(text)}
    </button>)}
  </div>
}

/** 시작 화면은 현재 워크스페이스 행, 목록 보기는 계정 행에 저장한다(D44·D9). */
export function WorkspacePrefsSection({ currentWorkspace, currentWorkspaceError, startPage, projectsView }: {
  currentWorkspace: { id: string; name: string } | null
  currentWorkspaceError: boolean
  startPage: UiPrefs['startPage'] | null
  projectsView: 'rows' | 'cards'
}) {
  const { t } = useLocale()
  return <>
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-fg">{t('account.ws.current')}</h2>
      {currentWorkspaceError ? <StatusMessage kind="partial_error" compact title={t('account.ws.loadFailed')} />
        : !currentWorkspace ? <StatusMessage kind="empty" compact title={t('account.ws.none')} />
          : <>
            <p className="mt-3 text-body font-semibold text-fg">{currentWorkspace.name}</p>
            <p className="mb-2 mt-3 text-meta text-fg-secondary">{t('account.start.title')}</p>
            <PrefRadioGroup label={t('account.start.title')} choices={START_PAGES} initial={startPage ?? 'home'} save={value => queueWorkspacePref(currentWorkspace.id, { startPage: value })} />
          </>}
    </section>
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-fg">{t('account.view.title')}</h2>
      <div className="mt-3 max-w-sm"><PrefRadioGroup label={t('account.view.label')} choices={PROJECT_VIEWS} initial={projectsView} save={value => queueUiPref({ projectsView: value })} /></div>
    </section>
  </>
}
