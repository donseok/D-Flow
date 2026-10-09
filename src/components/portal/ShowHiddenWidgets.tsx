'use client'
import { useEffect, useState } from 'react'
import { useHiddenWidgets } from './HiddenWidgetsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 숨긴 위젯 다시 보기 — 개인 숨김을 비운다(즉시 저장 → 다시 그리기). 실패는 글로 알린다 */
export function ShowHiddenWidgets({ count }: { workspaceId: string; count: number }) {
  const { t } = useLocale()
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
      <button type="button" data-show-hidden-widgets onClick={show} disabled={!ready || commands.disabled || busy || commands.pending} aria-busy={busy || undefined}
        className="text-control font-semibold text-action underline underline-offset-2 hover:text-action-hover disabled:opacity-60">
        {t('portalUi.widget.showHidden').replace('{n}', String(count))}
      </button>
      {err && <span role="alert" className="text-meta text-danger">{t('portalUi.widget.showFailed')}</span>}
    </div>
  )
}
