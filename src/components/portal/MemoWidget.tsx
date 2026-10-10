'use client'
import { useEffect, useRef, useState } from 'react'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { useLocale } from '@/components/providers/LocaleProvider'
import { postPrefsNow } from '@/lib/prefs/debouncedSave'
import { PORTAL_MEMO_MAX } from '@/lib/portal/prefs'

const SAVE_DELAY_MS = 800
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * 메모 위젯 — 나만 보는 글 한 칸(워크스페이스 범위 개인 설정 portalMemo). 입력이 멈추면 저장하고, 결과를 글로 알린다
 * (저장 실패를 조용히 넘기지 않는다 — 글은 화면에 남고 '다시 저장'을 둔다). initial 이 null 이면 개인 설정을 읽지 못한 것이라
 * 입력을 열지 않는다: 빈 칸으로 열면 첫 저장이 서버의 옛 글을 덮는다(쓰기 전 선행 조회 실패 — 중단).
 */
export function MemoWidget({ workspaceId, initial }: { workspaceId: string; initial: string | null }) {
  const { t } = useLocale()
  const [text, setText] = useState(initial ?? '')
  const [state, setState] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(text)
  const saved = useRef(initial ?? '')
  const seq = useRef(0)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const save = async () => {
    const value = latest.current
    if (value === saved.current) { setState('saved'); return }
    const mine = ++seq.current
    setState('saving')
    const ok = await postPrefsNow({ prefs: { portalMemo: value }, workspaceId }).then((r) => r.ok, () => false)
    if (ok) saved.current = value
    if (mine !== seq.current) return                       // 더 새 저장이 진행 중이다 — 그 결과가 상태를 정한다
    setState(ok ? 'saved' : 'failed')
  }
  const change = (value: string) => {
    setText(value); latest.current = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void save() }, SAVE_DELAY_MS)
  }
  // 입력 칸을 떠날 때 기다리던 저장을 바로 보낸다 — 화면을 떠나기 전에 글이 남게
  const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; void save() } }

  if (initial === null) return <StatusMessage kind="partial_error" compact title={t('portalUi.widget.memoUnavailable')} />
  return (
    <div className="space-y-2">
      <textarea data-portal-memo aria-label={t('portalUi.widget.memoLabel')} value={text} maxLength={PORTAL_MEMO_MAX} rows={5}
        placeholder={t('portalUi.widget.memoPlaceholder')} onChange={(e) => change(e.target.value)} onBlur={flush}
        className="block w-full resize-y rounded-(--radius-control) border border-border-input bg-surface px-3 py-2 text-body text-fg placeholder:text-fg-muted" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-meta text-fg-secondary">
        <span className="tabular-nums">{t('portalUi.widget.memoCount').replace('{n}', String(text.length)).replace('{max}', String(PORTAL_MEMO_MAX))}</span>
        {state === 'failed'
          ? <span role="alert" className="flex items-center gap-2 text-danger">{t('portalUi.widget.memoFailed')}
              <button type="button" onClick={() => { void save() }} className="font-semibold underline underline-offset-2">{t('portalUi.widget.memoRetry')}</button></span>
          : <span role="status">{state === 'saving' ? t('portalUi.widget.memoSaving') : state === 'saved' ? t('portalUi.widget.memoSaved') : ''}</span>}
      </div>
    </div>
  )
}
