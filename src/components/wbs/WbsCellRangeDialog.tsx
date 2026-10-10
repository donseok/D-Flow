'use client'
// 셀 범위 붙여넣기·지우기의 확인·결과 상자. 큰 범위는 적용 전에 묻고(되돌리기가 없다), 끝난 뒤에는 바꿈·이미 같은 값·건너뜀·값 오류·잘림·충돌·실패를
// 건수와 사유로 보인다(개정 §5.8 — 부분 성공을 숨기지 않는다). 충돌은 칸마다 비교 상자를 띄우지 않고 여기 한 번에 모은다: 충돌한 칸은 쓰지 않았고
// 화면은 이미 최신 값으로 다시 읽었다. 깨끗하게 끝난 작은 붙여넣기는 이 상자 없이 토스트 한 줄이다(useWbsCellRange).
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { customFieldErrorText } from '@/components/fields/CustomFieldValuesEditor'
import { fill } from '@/lib/i18n/translate'
import type { DictKey } from '@/lib/i18n/dict'
import type { RangeInvalidReason } from '@/lib/domain/wbsCellRange'
import type { RangeJob } from './useWbsCellRange'

/** 사유 목록에서 한 번에 보이는 줄 수 — 나머지는 '외 N건' */
const SHOWN = 6
type Line = { where: string; why?: string }

export function WbsCellRangeDialog({ job, rowLabel, colLabel, onConfirm, onClose }: {
  job: RangeJob | null
  /** 행의 이름(작업명) · 열의 머리글자 — 사유 줄의 "어느 칸" */
  rowLabel: (rowId: string) => string
  colLabel: (col: string) => string
  onConfirm: () => void
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  if (!job) return null
  const { kind, phase, plan } = job
  const outcome = job.outcome ?? { written: [], already: [], conflicts: [], failed: [] }
  const where = (c: { rowId: string; col: string }) => `${rowLabel(c.rowId)} · ${colLabel(c.col)}`
  const invalidText = (r: RangeInvalidReason) => (typeof r === 'string' ? t(`wbs.range.why.${r}` as DictKey) : customFieldErrorText(r.field, locale))
  const title = t(`wbs.range.title.${kind}${phase === 'done' ? '' : 'Confirm'}` as DictKey)
  const sections: { key: string; label: string; n: number; count?: string; tone?: 'warn'; lines?: Line[] }[] = [
    phase === 'done'
      ? { key: 'written', label: t('wbs.range.sum.written'), n: outcome.written.length }
      : { key: 'toWrite', label: t('wbs.range.sum.toWrite'), n: plan.writes.length },
    { key: 'unchanged', label: t('wbs.range.sum.unchanged'), n: plan.unchanged + outcome.already.length },
    { key: 'conflict', label: t('wbs.range.sum.conflict'), n: outcome.conflicts.length, tone: 'warn', lines: outcome.conflicts.map(w => ({ where: where(w) })) },
    { key: 'failed', label: t('wbs.range.sum.failed'), n: outcome.failed.length, tone: 'warn', lines: outcome.failed.map(f => ({ where: where(f.write), why: f.message })) },
    { key: 'invalid', label: t('wbs.range.sum.invalid'), n: plan.invalid.length, tone: 'warn', lines: plan.invalid.map(c => ({ where: where(c), why: invalidText(c.reason) })) },
    { key: 'skipped', label: t('wbs.range.sum.skipped'), n: plan.skipped.length, lines: plan.skipped.map(c => ({ where: where(c), why: t(`wbs.range.why.${c.reason}` as DictKey) })) },
    { key: 'clipped', label: t('wbs.range.sum.clipped'), n: plan.clippedRows + plan.clippedCols, count: fill(t('wbs.range.clippedDetail'), { rows: plan.clippedRows, cols: plan.clippedCols }), tone: 'warn' },
  ]
  // 바꾼(바꿀) 칸 수는 0 이어도 보인다 — 나머지는 있을 때만
  const shown = sections.filter((s, i) => i === 0 || s.n > 0)
  const running = phase === 'running'
  return (
    <Modal open size="md" title={title} onClose={onClose}
      footer={phase === 'done'
        ? <button type="button" className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>
        : <>
          <button type="button" className="btn btn-ghost" disabled={running} onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" disabled={running} aria-busy={running} onClick={onConfirm}>
            {running ? t('wbs.saving') : fill(t(kind === 'paste' ? 'wbs.range.apply' : 'wbs.range.erase'), { n: plan.writes.length })}
          </button>
        </>}>
      <div className="space-y-3 text-sm" data-wbs-range-dialog={phase}>
        {phase !== 'done' && <p className="text-fg-secondary">{running ? t('wbs.range.running') : fill(t(kind === 'paste' ? 'wbs.range.confirmPaste' : 'wbs.range.confirmClear'), { n: plan.writes.length })}</p>}
        <ul className="space-y-2" role={phase === 'done' ? 'status' : undefined}>
          {shown.map(s => (
            <li key={s.key} data-wbs-range-sum={s.key}>
              <p className="flex items-baseline justify-between gap-3">
                <span className={s.tone === 'warn' ? 'font-medium text-danger' : 'font-medium text-fg'}>{s.label}</span>
                <span className="shrink-0 tabular-nums text-fg-secondary">{s.count ?? fill(t('wbs.range.cells'), { n: s.n })}</span>
              </p>
              {s.lines && s.lines.length > 0 && (
                <ul className="mt-1 space-y-0.5 border-l border-border pl-3 text-xs text-fg-secondary">
                  {s.lines.slice(0, SHOWN).map((line, i) => <li key={i} className="break-words">{line.where}{line.why ? ` — ${line.why}` : ''}</li>)}
                  {s.lines.length > SHOWN && <li>{fill(t('wbs.range.more'), { n: s.lines.length - SHOWN })}</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
        {outcome.conflicts.length > 0 && <p className="rounded-lg border border-border bg-surface-subtle p-3 text-fg-secondary">{t('wbs.range.conflictNote')}</p>}
      </div>
    </Modal>
  )
}
