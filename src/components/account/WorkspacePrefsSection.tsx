'use client'

import { useRef, useState, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import type { UiPrefs } from '@/lib/domain/types'
import { queueUiPref, queueWorkspacePref } from '@/lib/prefs/debouncedSave'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { rovingRadioIndex } from './rovingRadio'

const START_PAGES = [['home', '홈'], ['my_work', '내 업무'], ['projects', '프로젝트 목록'], ['last_project', '마지막 프로젝트']] as const
const PROJECT_VIEWS = [['rows', '행'], ['cards', '카드']] as const

function PrefRadioGroup<T extends string>({ label, choices, initial, save }: {
  label: string; choices: readonly (readonly [T, string])[]; initial: T; save: (value: T) => void
}) {
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
  return <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-(--radius-control) border border-border bg-surface-subtle p-1">
    {choices.map(([v, text], i) => <button key={v} ref={el => { refs.current[i] = el }} type="button" role="radio" aria-checked={v === value} tabIndex={v === value ? 0 : -1}
      onClick={() => select(v)} onKeyDown={e => onKeyDown(e, i)}
      className={`inline-flex h-8 items-center justify-center gap-1 rounded-(--radius-control) px-2 text-xs font-medium transition-colors duration-(--motion-fast) ${v === value ? 'bg-surface-selected text-action' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}>
      <Check className={`h-3.5 w-3.5 ${v === value ? '' : 'invisible'}`} aria-hidden />{text}
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
  return <>
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-fg">현재 워크스페이스</h2>
      {currentWorkspaceError ? <StatusMessage kind="partial_error" compact title="워크스페이스 설정을 불러오지 못했습니다" />
        : !currentWorkspace ? <StatusMessage kind="empty" compact title="소속된 워크스페이스가 없습니다" />
          : <>
            <p className="mt-3 text-body font-semibold text-fg">{currentWorkspace.name}</p>
            <p className="mb-2 mt-3 text-meta text-fg-secondary">시작 화면</p>
            <PrefRadioGroup label="시작 화면" choices={START_PAGES} initial={startPage ?? 'home'} save={value => queueWorkspacePref(currentWorkspace.id, { startPage: value })} />
          </>}
    </section>
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-fg">목록 보기</h2>
      <div className="mt-3 max-w-sm"><PrefRadioGroup label="프로젝트 목록 보기" choices={PROJECT_VIEWS} initial={projectsView} save={value => queueUiPref({ projectsView: value })} /></div>
    </section>
  </>
}
