'use client'
import { useEffect, useState } from 'react'
import { Copy, RefreshCw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { getMinuteShare, setMinuteShare, type MinuteShareCode, type MinuteShareResult } from '@/app/actions/minutes'
import type { ShareOp } from '@/lib/minutes/share'
import type { DictKey } from '@/lib/i18n/dict'

/** 액션의 사유 코드 → 사전 키. 화면 문구의 출처는 사전 하나다 — 액션 문구를 그대로 그리지 않는다. */
const CODE_KEY: Record<MinuteShareCode, DictKey> = {
  share_lookup: 'min.share.lookupFailed',
  share_save: 'min.share.saveFailed',
}

/** 실패 문구 — 사유 코드가 있으면 사전 문구, 없으면(판정의 거부: 권한·보관) 받은 문구, 그것도 없으면 일반 문구. */
function failText(res: MinuteShareResult, t: (key: DictKey) => string): string {
  const key = res.code && Object.hasOwn(CODE_KEY, res.code) ? CODE_KEY[res.code] : null
  return key ? t(key) : (res.error ?? t('min.share.failed'))
}

/** 구글식 공유 모달 — 토글 ON/OFF·링크 복사·재발급. 낙관적 갱신 없음(성공 응답으로만 상태 반영 → 롤백 불요). */
export function MinuteShareModal({ open, onClose, minuteId }: {
  open: boolean; onClose: () => void; minuteId: string
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)

  useEffect(() => {
    if (!open) return
    let stale = false
    setLoading(true); setErr(null); setConfirmRegen(false)
    getMinuteShare(minuteId)
      .then(res => {
        if (stale) return
        if (res.ok) { setEnabled(!!res.enabled); setToken(res.token ?? null) }
        else setErr(failText(res, t))
      })
      .catch(() => { if (!stale) setErr(t('min.share.failed')) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [open, minuteId, t])

  async function run(op: ShareOp) {
    setBusy(true); setErr(null)
    try {
      const res = await setMinuteShare(minuteId, op)
      if (res.ok) { setEnabled(!!res.enabled); setToken(res.token ?? null); setConfirmRegen(false) }
      else setErr(failText(res, t))
    } catch {
      setErr(t('min.share.failed'))
    } finally { setBusy(false) }
  }

  const url = token ? `${window.location.origin}/share/minutes/${token}` : ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast({ title: t('min.share.copied') })
    } catch {
      toast({ title: t('min.share.copyFailed'), variant: 'error' })
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('min.share.title')} size="sm">
      {loading ? (
        <p className="text-sm text-fg-secondary">…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">{t('min.share.desc')}</p>
          <button onClick={() => void run(enabled ? 'disable' : 'enable')} disabled={busy}
            role="switch" aria-checked={enabled}
            className={`btn w-full justify-between ${enabled ? 'border border-border-focus bg-action-soft text-action' : ''}`}>
            <span>{enabled ? t('min.share.on') : t('min.share.off')}</span>
            <span aria-hidden className={`inline-block h-4 w-7 rounded-full p-0.5 transition ${enabled ? 'bg-action' : 'bg-surface-subtle'}`}>
              <span className={`block h-3 w-3 rounded-full bg-white transition ${enabled ? 'translate-x-3' : ''}`} />
            </span>
          </button>
          {enabled && token && (
            <div className="space-y-2">
              <input readOnly value={url} onFocus={e => e.currentTarget.select()}
                className="app-input w-full text-xs" aria-label={t('min.share.copy')} />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => void copy()} disabled={busy} className="btn">
                  <Copy className="h-4 w-4" />{t('min.share.copy')}
                </button>
                {confirmRegen ? (
                  <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-danger">
                    <span className="min-w-0 flex-1">{t('min.share.regenConfirm')}</span>
                    <button onClick={() => void run('regenerate')} disabled={busy} className="btn text-danger">
                      {t('min.share.regen')}
                    </button>
                    <button onClick={() => setConfirmRegen(false)} className="btn">{t('common.cancel')}</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmRegen(true)} disabled={busy} className="btn">
                    <RefreshCw className="h-4 w-4" />{t('min.share.regen')}
                  </button>
                )}
              </div>
            </div>
          )}
          {err && <p className="text-sm text-danger">{err}</p>}
        </div>
      )}
    </Modal>
  )
}
