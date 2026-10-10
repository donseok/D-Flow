'use client'
import { useEffect, useState } from 'react'
import { reloadPortalPage } from '@/lib/portal/reload'
import { flushUiPrefs, queueUiPref } from '@/lib/prefs/debouncedSave'
import type { ProjectsView } from '@/lib/portal/prefs'
import { useLocale } from '@/components/providers/LocaleProvider'
export function ProjectsViewToggle({ view }: { view: ProjectsView }) {
  const { t } = useLocale()
  const [selected, setSelected] = useState(view), [busy, setBusy] = useState(false), [error, setError] = useState(false)
  useEffect(() => { setSelected(view) }, [view])
  async function select(next: ProjectsView) {
    if (selected === next || busy) return
    setSelected(next); setBusy(true); setError(false)
    // 계정 키: 워크스페이스 id 없이 저장한다. 큐의 다른 계정 변경도 보존하며 완료 뒤 갱신한다.
    queueUiPref({ projectsView: next })
    if (await flushUiPrefs()) reloadPortalPage()
    else { setSelected(view); setError(true) }
    setBusy(false)
  }

  // 보기 전환은 공용 세그먼트 모양(.seg — 옅은 홈 + 흰 선택 칸, 2026-10-10 디자인 정비). 선택은 aria-pressed·체크(::before)·굵기로 알린다
  const item = (v: ProjectsView, label: string) => (
    <button type="button" aria-pressed={selected === v} disabled={busy} onClick={() => void select(v)}
      className={`seg-item disabled:cursor-not-allowed disabled:opacity-50 ${selected === v ? 'seg-item-active' : ''}`}>{label}</button>
  )
  return <span className="inline-flex items-center gap-2">
    <span className="seg" role="group" aria-label={t('portalUi.projects.viewAria')}>
      {item('rows', t('portalUi.projects.viewRows'))}
      {item('cards', t('portalUi.projects.viewCards'))}
    </span>
    {error && <span role="alert" className="text-meta text-danger">{t('portalUi.projects.viewSaveFailed')}</span>}
  </span>
}
