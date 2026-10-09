'use client'

import { useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { lintWeeklySheet, type LintFinding, type LintGroupOf, type LintKind, type LintRow } from '@/lib/domain/weeklyLint'
import type { WeeklyCellEdit, WeeklyCellKey } from '@/lib/domain/weeklySheet'

const KIND_LABEL: Record<LintKind, DictKey> = {
  duplicate: 'weekly.lint.kind.duplicate', nearDuplicate: 'weekly.lint.kind.nearDuplicate',
  numbering: 'weekly.lint.kind.numbering', format: 'weekly.lint.kind.format',
}
const KIND_TONE: Record<LintKind, string> = {
  duplicate: 'bg-warning-weak text-warning',
  nearDuplicate: 'bg-critical-weak text-critical',
  numbering: 'bg-warning-weak text-warning',
  format: 'bg-progress-weak text-progress',
}

/** 묶음별 목록. lintWeeklySheet 가 묶음 순서(입력에서 처음 나온 순서)를 먼저 세워 내주므로, 처음 나온 순서를 그대로 쓴다.
 *  키는 groupKey 다 — 이름(section)이 같은 두 묶음(동명 영역)이 한 머리 아래 섞이지 않게. 머리에는 이름을 쓴다. */
function groupFindings(findings: LintFinding[]): { key: string; label: string; items: LintFinding[] }[] {
  const out: { key: string; label: string; items: LintFinding[] }[] = []
  const at = new Map<string, number>()
  for (const f of findings) {
    const i = at.get(f.groupKey)
    if (i === undefined) { at.set(f.groupKey, out.length); out.push({ key: f.groupKey, label: f.section, items: [f] }) }
    else out[i].items.push(f)
  }
  return out
}

/** 주간보고 점검 패널 — 현재 화면의 rows로 지적을 계산해 보여주고, 항목별로 수정을 적용한다.
 *  점검은 묶음(groupOf — 호출부가 정한다) 안에서만 이뤄지므로(도메인 규칙) 목록도 묶음별로 묶어 보여준다.
 *  rows 는 화면 순서 그대로 넘긴다 — 묶음·행 순서가 이 순서를 따른다.
 *  저장은 부모가 넘긴 onApply(=runBatch)가 담당한다. 이 컴포넌트는 I/O를 하지 않는다. */
export function WeeklyLintPanel<R extends LintRow>({ open, rows, groupOf, canApply = true, onClose, onApply, onGoToCell }: {
  open: boolean
  rows: readonly R[]
  /** 점검 묶음 — 키로 견주고 이름을 머리에 쓴다. PPT 페이지 단위와 같은 키여야 한다(스펙 D22) */
  groupOf: LintGroupOf<R>
  /** 자동수정('적용') 노출 여부 = 셀 편집 자격(isProjectMember). 점검 자체는 조회 전용도 볼 수 있다. */
  canApply?: boolean
  onClose: () => void
  onApply: (edits: WeeklyCellEdit[]) => void
  onGoToCell: (rowId: string, cellKey: WeeklyCellKey) => void
}) {
  // 열려 있는 동안 rows(또는 groupOf)가 바뀔 때마다 재계산 — 적용 직후에도, 타인의 Realtime 수정에도 목록이 따라간다.
  // 묶음 수만큼의 행 × 4열이라 비용은 무시할 만하다. 닫혀 있으면 계산하지 않는다.
  const { t } = useLocale()
  const findings = useMemo(() => (open ? lintWeeklySheet(rows, groupOf, t) : []), [open, rows, groupOf, t])
  const groups = useMemo(() => groupFindings(findings), [findings])

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('weekly.lint.title')}
      eyebrow={findings.length > 0 ? t('weekly.lint.count').replace('{n}', String(findings.length)) : undefined}
      size="lg"
      footer={<button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>}
    >
      {findings.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-secondary">{t('weekly.lint.empty')}</p>
      ) : (
        <>
          {/* 왜 다른 업무영역의 같은 문구가 안 잡히는지 매번 묻지 않도록 점검 범위를 못박되,
              글머리 기호·번호 표기만 시트 전체 기준이라는 예외까지 같이 적는다(안 적으면 그 지적이 버그로 읽힌다).
              셀 안 [머리글] 구획도 같이 적는다 — 적지 않으면 이번엔 반대로 "왜 안 잡히지?"를 묻게 된다. */}
          <p className="pb-2 text-xs text-fg-secondary">
            {t('weekly.lint.scope.lead')}<code>{t('weekly.lint.scope.headingSample')}</code>{t('weekly.lint.scope.afterHeading')}
            <b>{t('weekly.lint.scope.differentName')}</b>{t('weekly.lint.scope.afterName')}
            <b>{t('weekly.lint.scope.restart')}</b>{t('weekly.lint.scope.afterRestart')}
            <code>{t('weekly.lint.scope.markSample')}</code>{t('weekly.lint.scope.tail')}
          </p>
          <div className="divide-y divide-border/80">
            {groups.map(g => (
              <section key={g.key} data-lint-section={g.key} className="py-2">
                <h3 className="flex items-baseline gap-2 pb-1 text-sm font-semibold text-fg">
                  {g.label}
                  <span className="text-xs font-normal text-fg-muted">{t('weekly.lint.count').replace('{n}', String(g.items.length))}</span>
                </h3>
                <ul className="divide-y divide-border/60">
                  {g.items.map(f => (
                    <LintItem
                      key={f.id}
                      finding={f}
                      canApply={canApply}
                      onApply={() => onApply(f.edits)}
                      // 셀 이동은 모달이 닫히는 커밋 '뒤'로 미룬다 — 같은 틱에 옮기면
                      // Modal이 닫히며 열 때 캡처한 트리거(점검 버튼)로 포커스를 되돌려 이동이 무효가 된다.
                      onGo={() => { onClose(); setTimeout(() => onGoToCell(f.rowId, f.cellKey), 0) }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

function LintItem({ finding, canApply, onApply, onGo }: {
  finding: LintFinding; canApply: boolean; onApply: () => void; onGo: () => void
}) {
  const { t } = useLocale()
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_TONE[finding.kind]}`}>
        {t(KIND_LABEL[finding.kind])}
      </span>
      <div className="min-w-0 flex-1">
        {/* 제목 클릭 = 모달 닫고 해당 셀로 이동. 어디를 말하는지 눈으로 확인하고 직접 고칠 수 있게. */}
        <button
          type="button"
          onClick={onGo}
          className="text-left text-sm font-semibold text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus"
        >
          {finding.title}
        </button>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-fg-secondary">{finding.detail}</p>
      </div>
      {/* 유사 중복은 edits 가 없다(어느 줄을 남길지는 사람의 판단) — 적용 버튼 대신 제목 클릭으로 셀에 간다. */}
      {canApply && finding.edits.length > 0 && (
        <button type="button" className="btn btn-ghost shrink-0 text-xs" onClick={onApply}>{t('weekly.lint.apply')}</button>
      )}
    </li>
  )
}
