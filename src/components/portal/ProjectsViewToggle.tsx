'use client'
import { useEffect, useState } from 'react'
import { reloadPortalPage } from '@/lib/portal/reload'
import { Button } from '@/components/ui/Button'
import { flushUiPrefs, queueUiPref } from '@/lib/prefs/debouncedSave'
import type { ProjectsView } from '@/lib/portal/prefs'
export function ProjectsViewToggle({ view }: { view: ProjectsView }) {
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

  return <span className="inline-flex gap-1" role="group" aria-label="프로젝트 보기">
    <Button variant={selected === 'rows' ? 'primary' : 'ghost'} aria-pressed={selected === 'rows'} disabled={busy} onClick={() => void select('rows')}>행</Button>
    <Button variant={selected === 'cards' ? 'primary' : 'ghost'} aria-pressed={selected === 'cards'} disabled={busy} onClick={() => void select('cards')}>카드</Button>
    {error && <span role="alert" className="text-meta text-danger">보기 설정을 저장하지 못했습니다</span>}
  </span>
}
