'use client'
import { useEffect, useState } from 'react'
import { History } from 'lucide-react'
import type { ChangeActorRole, ChangeLogEntry } from '@/app/actions/wbs'
import type { TeamCode } from '@/lib/domain/types'
import { formatWeightPct } from '@/lib/domain/format'
import { useLocale } from '@/components/providers/LocaleProvider'
import { SPEC_UPDATED_TOKEN } from '@/lib/domain/wbsSpecLog'
import type { DictKey } from '@/lib/i18n/dict'
import { stampIn } from '@/lib/domain/calendar'
import { useCustomFieldScope } from '@/components/fields/CustomFieldValuesEditor'
import type { FieldDef } from '@/lib/domain/customFields'
import { CUSTOM_LOG_PREFIX, formatCustomLogValue } from '@/lib/domain/customFieldValues'

/** 접기 전 기본 노출 건수 — 이력은 항목당 수십 건까지 쌓이는데 패널의 주인공이 아니다. */
export const HISTORY_COLLAPSED_COUNT = 3

type Tr = (k: DictKey) => string
/** 이 프로젝트 권한(명단 access_role, 권한 없음·명단 밖은 viewer) → 표시 키. */
const ROLE_KEY: Record<ChangeActorRole, DictKey> = { admin: 'wbs.roleAdmin', member: 'wbs.roleMember', viewer: 'wbs.roleViewer' }
const FIELD_KEY: Record<string, DictKey> = {
  actual_pct: 'wbs.colActualPct', weight: 'wbs.colWeight', name: 'wbs.fieldName', planned_start: 'wbs.colPlannedStart',
  planned_end: 'wbs.colPlannedEnd', deliverable: 'wbs.colDeliverable', biz: 'wbs.fieldBiz', created: 'wbs.fieldCreated',
  dependency: 'wbs.dependencies',
  // Task 12(stage)·Task 12A(spec) 가 change_logs 에 기록하는 필드명 — 매핑이 없으면 이 화면의
  // 변경 이력 라벨이 원문 그대로("stage"/"spec") 노출된다(fmtValue 는 값만 다루고 라벨은 이 맵이 정본).
  stage: 'wbs.stageLabel', spec: 'wbs.specPanelTitle',
}

function fmtValue(field: string, v: string | null, t: Tr): string {
  if (v == null || v === '') return field === 'weight' ? t('wbs.weightEqual') : '—'
  if (field === 'dependency') return t('wbs.dependencyLink')
  if (field === 'weight' && !Number.isNaN(Number(v))) return formatWeightPct(Number(v))
  // spec 은 본문 전문을 로그에 넣지 않고 로케일 중립 토큰만 저장한다(wbsSpecLog.ts) — 여기서
  // 사전 키로 변환. 리터럴 한국어를 그대로 저장하면 en 사용자 이력에도 노출된다(리뷰 라운드 1).
  if (field === 'spec' && v === SPEC_UPDATED_TOKEN) return t('wbs.specUpdatedLogValue')
  return field === 'actual_pct' ? `${v}%` : v
}

/** 'YYYY.MM.DD HH:mm' — 서버가 내려준 프로젝트 tz 의 벽시계(브라우저 tz 가 아니다 — 계획 P8, A-4 리뷰 N7) */
function fmtAt(iso: string, timeZone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return stampIn(timeZone, d).replace(/-/g, '.')
}

function actorLabel(team: TeamCode | null, role: ChangeActorRole | null, t: Tr): string {
  const r = role ? t(ROLE_KEY[role]) : null
  if (team && r) return `${team} · ${r}`
  return r ?? team ?? t('wbs.unknownActor')
}

/**
 * 변경 이력 — 항목당 한 줄, 기본 최근 3건(2026-08-28). 종전에는 3줄짜리 카드가 이력 수만큼
 * 쌓여 상세 패널의 절반 이상을 먹었다. RowDetailPanel 에서 떼어낸 이유는 두 가지다:
 * 그 파일이 700줄을 넘었고, 이 블록만 따로 테스트하려면 패널 전체를 모킹해야 했다.
 */
export function ChangeHistoryList({ logs, timeZone }: { logs: ChangeLogEntry[] | null; timeZone: string }) {
  const { t } = useLocale()
  // 사용자 정의 필드 이력(field='custom.<key>')은 키가 아니라 지금의 라벨·서식으로 보인다 — 정의를 못 읽거나 지운 필드는 키·원문 그대로
  const fieldScope = useCustomFieldScope()
  const customDef = (field: string): FieldDef | undefined =>
    field.startsWith(CUSTOM_LOG_PREFIX) ? fieldScope?.defs?.find(d => d.key === field.slice(CUSTOM_LOG_PREFIX.length)) : undefined
  const customFormat = { locale: fieldScope?.locale ?? 'ko', yes: fieldScope?.locale === 'en' ? 'Yes' : '예', no: fieldScope?.locale === 'en' ? 'No' : '아니오', empty: '—' }
  const fieldLabel = (field: string) => FIELD_KEY[field] ? t(FIELD_KEY[field])
    : field.startsWith(CUSTOM_LOG_PREFIX) ? customDef(field)?.label ?? field.slice(CUSTOM_LOG_PREFIX.length) : field
  const value = (field: string, v: string | null) =>
    field.startsWith(CUSTOM_LOG_PREFIX) ? formatCustomLogValue(customDef(field), v, customFormat) : fmtValue(field, v, t)
  const [expanded, setExpanded] = useState(false)
  // 다른 항목을 열면 접힌 상태로 돌아간다 — 앞 항목에서 펼친 게 따라오면 "왜 다 보이지"가 된다.
  useEffect(() => { setExpanded(false) }, [logs])

  const hidden = logs ? Math.max(0, logs.length - HISTORY_COLLAPSED_COUNT) : 0
  const shown = logs && !expanded ? logs.slice(0, HISTORY_COLLAPSED_COUNT) : logs

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-fg-muted">
        <History className="h-3.5 w-3.5" /> {t('wbs.changeHistory')}
      </div>
      {shown == null ? (
        <p className="text-xs text-fg-muted">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="text-xs text-fg-muted">{t('wbs.noHistory')}</p>
      ) : (
        <>
          <ol className="divide-y divide-border/50 border-y border-border/50">
            {shown.map(log => (
              <li key={log.id} data-history-row
                className="grid grid-cols-[auto_1fr] items-baseline gap-x-2 py-1 text-[12px] sm:grid-cols-[8.5rem_1fr_auto]">
                <span className="tabular-nums text-[11px] text-fg-muted">{fmtAt(log.at, timeZone)}</span>
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-fg">{fieldLabel(log.field)}</span>
                  <span className="mx-1 text-fg-secondary line-through decoration-fg-muted/50">{value(log.field, log.oldValue)}</span>
                  <span className="text-fg-muted">→</span>
                  <span className="ml-1 font-semibold text-fg">{value(log.field, log.newValue)}</span>
                </span>
                <span className="col-start-2 text-[11px] text-fg-muted sm:col-start-3">{actorLabel(log.actorTeam, log.actorRole, t)}</span>
              </li>
            ))}
          </ol>
          {hidden > 0 && (
            <button type="button" data-history-more onClick={() => setExpanded(v => !v)}
              className="mt-1.5 text-[11px] font-medium text-fg-secondary underline-offset-2 hover:underline">
              {expanded ? t('wbs.historyCollapse') : t('wbs.historyExpand').replace('{n}', String(hidden))}
            </button>
          )}
        </>
      )}
    </section>
  )
}
