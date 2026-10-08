'use client'
// 승인 단계·선행 기준(SP5b W2 — 설정 workflow.approval_steps·approval_distinct_approvers·predecessor_gate, 개정 §3.3.1).
// - 승인 단계 1~3: code(새 단계만 입력 — 기존 단계 code 는 고정, 바꾸려면 지우고 새로), 이름(기본 단계 review 만 비워 사전 이름), 승인자.
//   단계 구성·순서는 다음 검수 라운드부터, 이름·승인자는 바로 적용된다. 검수 중인 단계 삭제·대기 단계 승인자 넓히기는 서버가 거부한다(사유 표시).
// - 서로 다른 승인자: 한 검수에서 같은 사람이 두 단계를 승인하지 못하게(다음 승인부터).
// - 선행 기준: reached(검수 대기부터 후속 착수 — 현행) | final(최종 승인 뒤). 이미 시작한 후속은 되돌리지 않는다.
import { useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  APPROVERS, DEFAULT_STEP_CODE, MAX_APPROVAL_STEPS, STEP_CODE_RE, parseApprovalSteps, type ApprovalStepDef, type Approver,
} from '@/lib/domain/approvalSteps'
import { PREDECESSOR_GATES, type PredecessorGate } from '@/lib/domain/agentWork'
import type { DictKey } from '@/lib/i18n/dict'
import { useSettingsCommand } from './useSettingsCommand'

type Row = { code: string; label: string; approver: Approver; fixed: boolean }
const APPROVER_KEY: Record<Approver, DictKey> = { subtree_or_admin: 'settings.workflow.approverSubtree', admin: 'settings.workflow.approverAdmin' }
const GATE_KEY: Record<PredecessorGate, DictKey> = { reached: 'settings.workflow.gateReached', final: 'settings.workflow.gateFinal' }

const toRows = (steps: readonly ApprovalStepDef[]): Row[] => steps.map((s) => ({ code: s.code, label: s.label ?? '', approver: s.approver, fixed: true }))
const toSteps = (rows: readonly Row[]): unknown[] => rows.map((r) => ({
  code: r.code.trim(), label: r.label.trim() === '' && r.code.trim() === DEFAULT_STEP_CODE ? null : r.label, approver: r.approver,
}))

export function ApprovalStepsEditor({ projectId, steps, distinct, gate, revision, canEdit }: {
  projectId: string
  /** 저장된 값(손상이면 null — 기본 1단계에서 다시 쓴다) */
  steps: readonly ApprovalStepDef[] | null
  distinct: boolean | null
  gate: PredecessorGate | null
  revision: number
  canEdit: boolean
}) {
  const { t } = useLocale()
  const initial = steps ?? [{ code: DEFAULT_STEP_CODE, label: null, approver: 'subtree_or_admin' as const }]
  const [base, setBase] = useState({ steps: JSON.stringify(toSteps(toRows(initial))), distinct: distinct ?? true, gate: gate ?? 'reached' as PredecessorGate })
  const [rows, setRows] = useState<Row[]>(() => toRows(initial))
  const [dist, setDist] = useState(distinct ?? true)
  const [g, setG] = useState<PredecessorGate>(gate ?? 'reached')
  const parsed = parseApprovalSteps(toSteps(rows))
  const stepsChanged = steps === null || JSON.stringify(toSteps(rows)) !== base.steps
  const set: Record<string, unknown> = {
    ...(stepsChanged && parsed.ok ? { 'workflow.approval_steps': parsed.value } : {}),
    ...(dist !== base.distinct || distinct === null ? { 'workflow.approval_distinct_approvers': dist } : {}),
    ...(g !== base.gate || gate === null ? { 'workflow.predecessor_gate': g } : {}),
  }
  const cmd = useSettingsCommand(projectId, revision, () => setBase({ steps: JSON.stringify(toSteps(rows)), distinct: dist, gate: g }))
  const locked = !canEdit || cmd.pending
  const edit = (i: number, patch: Partial<Row>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); cmd.clear() }
  const move = (i: number, d: -1 | 1) => { setRows((rs) => { const n = [...rs]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n }); cmd.clear() }
  const err = cmd.fieldErrors['workflow.approval_steps'] ?? cmd.fieldErrors['workflow.predecessor_gate'] ?? cmd.fieldErrors['workflow.approval_distinct_approvers'] ?? cmd.error

  return (
    <div data-approval-steps-editor className="space-y-4">
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={i} data-approval-step={r.code || `new-${i}`} className="grid grid-cols-[2rem_1fr] items-start gap-2 rounded-lg border border-border bg-surface p-2 sm:grid-cols-[2rem_8rem_1fr_11rem_auto]">
            <span className="pt-2 text-center text-xs font-semibold tabular-nums text-fg-muted">{i + 1}</span>
            <input className="app-input h-9 font-mono text-xs" value={r.code} disabled={locked || r.fixed} maxLength={20} aria-label={t('settings.workflow.stepCode')}
              placeholder="code" onChange={(e) => edit(i, { code: e.target.value.toLowerCase() })} />
            <input className="app-input col-span-2 h-9 text-xs sm:col-span-1" value={r.label} disabled={locked} maxLength={20} aria-label={t('settings.workflow.stepLabel')}
              placeholder={r.code === DEFAULT_STEP_CODE ? t('wbs.approveStepDefault') : t('settings.workflow.stepLabel')} onChange={(e) => edit(i, { label: e.target.value })} />
            <select className="app-input col-span-2 h-9 text-xs sm:col-span-1" value={r.approver} disabled={locked} aria-label={t('settings.workflow.stepApprover')}
              onChange={(e) => edit(i, { approver: e.target.value as Approver })}>
              {APPROVERS.map((a) => <option key={a} value={a}>{t(APPROVER_KEY[a])}</option>)}
            </select>
            <div className="col-span-2 flex gap-1 sm:col-span-1">
              <button type="button" className="btn btn-ghost h-9 px-2 text-xs" disabled={locked || i === 0} onClick={() => move(i, -1)} aria-label={t('settings.workflow.stepUp')}>↑</button>
              <button type="button" className="btn btn-ghost h-9 px-2 text-xs" disabled={locked || i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('settings.workflow.stepDown')}>↓</button>
              <button type="button" className="btn btn-ghost h-9 px-2 text-xs text-danger" disabled={locked || rows.length <= 1}
                onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); cmd.clear() }}>{t('settings.workflow.stepRemove')}</button>
            </div>
          </li>
        ))}
      </ol>
      {canEdit && rows.length < MAX_APPROVAL_STEPS && (
        <button type="button" className="btn btn-ghost h-8 px-3 text-xs" disabled={locked} data-approval-step-add
          onClick={() => { setRows((rs) => [...rs, { code: '', label: '', approver: 'admin', fixed: false }]); cmd.clear() }}>{t('settings.workflow.stepAdd')}</button>
      )}
      <p className="text-meta text-fg-muted">{t('settings.workflow.stepsHint')}</p>
      {rows.some((r) => !r.fixed && r.code !== '' && !STEP_CODE_RE.test(r.code)) && <p role="alert" className="text-xs text-danger">{t('settings.workflow.stepCodeHint')}</p>}
      {!parsed.ok && <p role="alert" className="text-xs text-danger">{parsed.error}</p>}

      <label className="flex items-center gap-2 text-xs text-fg">
        <input type="checkbox" className="h-3.5 w-3.5 rounded border-border" checked={dist} disabled={locked} data-approval-distinct
          onChange={(e) => { setDist(e.target.checked); cmd.clear() }} />
        {t('settings.workflow.approval_distinct_approvers.label')}
      </label>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs font-semibold text-fg">{t('settings.workflow.predecessor_gate.label')}</legend>
        {PREDECESSOR_GATES.map((v) => (
          <label key={v} className="flex items-center gap-2 text-xs text-fg">
            <input type="radio" name={`gate-${projectId}`} value={v} checked={g === v} disabled={locked} data-predecessor-gate={v}
              onChange={() => { setG(v); cmd.clear() }} />
            {t(GATE_KEY[v])}
          </label>
        ))}
        <p className="text-meta text-fg-muted">{t('settings.workflow.predecessor_gate.desc')}</p>
      </fieldset>

      {err && <p role="alert" className="text-xs text-danger" data-approval-steps-error>{err}</p>}
      {cmd.saved && <p role="status" className="text-xs text-success">{t('settings.workflow.saved')}</p>}
      {canEdit && (
        <button type="button" className="btn btn-primary h-8 px-3 text-xs" data-approval-steps-save
          disabled={locked || !parsed.ok || Object.keys(set).length === 0} onClick={() => cmd.save(set)}>
          {cmd.uncertain ? t('settings.workflow.retry') : t('settings.workflow.save')}
        </button>
      )}
    </div>
  )
}
