// src/components/settings/ConfigLoadError.tsx — 설정을 읽지 못한 화면의 상태(스펙 §3.5). 기본값으로 그리지 않는다.
import { ConfigStateNotice } from './ConfigStateNotice'

export function ConfigLoadError({ error, keyName = null, kind = 'unavailable', isAdmin = false, settingsHref }: {
  error: string; keyName?: string | null; kind?: 'unavailable' | 'invalid' | 'required'
  isAdmin?: boolean; settingsHref?: string
}) {
  void error // 오류 원문은 서버에서 기록한다. 언어가 다른 화면에 그대로 싣지 않는다.
  return <ConfigStateNotice kind={kind} keyName={keyName} isAdmin={isAdmin} settingsHref={settingsHref} />
}
