'use client'
import { useEffect, useState } from 'react'
import { EyeOff } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useHiddenWidgets } from './HiddenWidgetsProvider'
import type { PortalWidgetId } from '@/lib/portal/widgets'

/**
 * 위젯 숨기기(개인 — 워크스페이스 키 portalHiddenWidgets, 스펙 §6.1). 즉시 저장 → 서버 화면 다시 그리기. 저장 실패를 숨김 성공처럼 보이지 않는다.
 * 설정 화면의 저장 바(SettingsSaveBar)를 쓰지 않는다 — 초안이 없는 즉시 동작이다(판정 R3 제외 기준).
 */
export function WidgetHideButton({ widgetId, title }: { workspaceId: string; widgetId: PortalWidgetId; hidden: readonly PortalWidgetId[]; title: string }) {
  const commands = useHiddenWidgets()
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(false)
  const hide = async () => {
    setBusy(true)
    setErr(false)
    const ok = await commands.change(widgetId)
    setBusy(false)
    if (!ok) { setErr(true); return }
  }
  return <>
    {err && <span role="alert" className="text-meta text-danger">숨기지 못했습니다</span>}
    <IconButton aria-label="이 위젯 숨기기" title={`${title} 숨기기`} variant="ghost" disabled={!ready} busy={busy || commands.pending} icon={<EyeOff className="h-4 w-4" aria-hidden />} onClick={hide} />
  </>
}
