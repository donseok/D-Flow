'use client'
import { useEffect, useState } from 'react'
import { useHiddenWidgets } from './HiddenWidgetsProvider'

/** 숨긴 위젯 다시 보기 — 개인 숨김을 비운다(즉시 저장 → 다시 그리기). 실패는 글로 알린다 */
export function ShowHiddenWidgets({ count }: { workspaceId: string; count: number }) {
  const commands = useHiddenWidgets()
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const show = async () => {
    setBusy(true)
    setErr(false)
    const ok = await commands.change(null)
    setBusy(false)
    if (!ok) { setErr(true); return }
  }
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 pb-8">
      <button type="button" data-show-hidden-widgets onClick={show} disabled={!ready || busy || commands.pending} aria-busy={busy || undefined}
        className="text-control font-semibold text-action underline underline-offset-2 hover:text-action-hover disabled:opacity-60">
        {`숨긴 위젯 ${count}개 다시 보기`}
      </button>
      {err && <span role="alert" className="text-meta text-danger">다시 보이지 못했습니다</span>}
    </div>
  )
}
