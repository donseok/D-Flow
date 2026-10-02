// 가져오기 실행 기록 패널(#23 — SP4 D5·D52, 계획 P9) — 같은 화면의 ?receipt=<명령 id> 를 페이지(서버)가 getImportReceipt 로 읽어 넘긴다.
// 영수증은 그 실행을 한 관리자에게만, 그 프로젝트에서만 보인다(액션이 행위자·프로젝트로 거른다 — 다른 프로젝트의 id 는 receipt: null, Q14).
// 읽기 실패는 '없음'으로 위장하지 않는다 — 원문은 액션이 로그로 남겼고 화면은 사전 문구다.
import type { ReactNode } from 'react'
import { StatusMessage } from '@/components/ui/StatusMessage'
import type { ImportReceiptResult, ImportReceiptView } from '@/app/actions/importReceipts'
import { isUuidLike } from '@/lib/domain/validate'
import { stampIn } from '@/lib/domain/calendar'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

export type ReceiptPanelState = { kind: 'found'; receipt: ImportReceiptView } | { kind: 'missing' } | { kind: 'invalid' } | { kind: 'error' }

/** ?receipt= → 패널 상태. 값이 없으면 패널 없음, 배열·uuid 아님은 액션을 부르지 않는다 */
export async function receiptStateOf(
  raw: string | string[] | undefined, read: (commandId: string) => Promise<ImportReceiptResult>,
): Promise<ReceiptPanelState | null> {
  if (raw === undefined) return null
  if (typeof raw !== 'string' || !isUuidLike(raw)) return { kind: 'invalid' }
  const r = await read(raw)
  if (!r.ok) return { kind: 'error' }
  return r.receipt ? { kind: 'found', receipt: r.receipt } : { kind: 'missing' }
}

/** timeZone = 그 프로젝트 달력의 tz(SP5 — 서울 고정 아님). null 은 달력을 못 읽음 — 시각만 '—'(다른 tz 로 잇지 않는다, 원인은 페이지가 로그) */
export function ImportReceiptPanel({ state, locale, timeZone }: { state: ReceiptPanelState; locale: Locale; timeZone: string | null }) {
  const tr = (k: DictKey) => t(locale, k)
  if (state.kind === 'invalid') return <StatusMessage kind="empty" title={tr('importWizard.receiptInvalid')} />
  if (state.kind === 'missing') return <StatusMessage kind="empty" title={tr('importWizard.receiptMissing')} detail={tr('importWizard.receiptMissingDesc')} />
  if (state.kind === 'error') return <StatusMessage kind="partial_error" title={tr('importWizard.receiptError')} />
  const r = state.receipt
  const cell = (label: DictKey, value: ReactNode, extra = '') => (
    <div><dt className="text-meta text-fg-muted">{tr(label)}</dt><dd className={`mt-0.5 font-semibold text-fg ${extra}`}>{value}</dd></div>
  )
  return (
    <section className="card space-y-3 p-5" data-import-receipt aria-labelledby="import-receipt-title">
      <h2 id="import-receipt-title" className="text-section text-fg">{tr('importWizard.receiptTitle')}</h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        {cell('importWizard.runId', <span title={r.commandId}>{r.commandId.slice(0, 8)}</span>, 'font-mono')}
        {cell('importWizard.doneMode', tr(r.mode === 'append' ? 'importWizard.modeAppend' : 'importWizard.modeReplace'))}
        {cell('importWizard.receiptCount', r.count, 'tabular-nums')}
        {cell('importWizard.receiptAt', timeZone ? stampIn(timeZone, r.createdAt) : '—', 'tabular-nums')}
      </dl>
    </section>
  )
}
