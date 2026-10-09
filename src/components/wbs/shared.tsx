import type { Status } from '@/lib/domain/types'
import { useStageLabel } from './StageLabelsProvider'
import { t as translate, type DictKey } from '@/lib/i18n/dict'

export const STATUS: Record<Status, { labelKey: DictKey; chip: string; bar: string; dot: string }> = {
  not_started: { labelKey: 'status.not_started', chip: 'bg-pending-weak text-pending', bar: 'bg-pending', dot: 'bg-pending' },
  in_progress: { labelKey: 'status.in_progress', chip: 'bg-progress-weak text-progress', bar: 'bg-progress', dot: 'bg-progress' },
  delayed: { labelKey: 'status.delayed', chip: 'bg-danger-weak text-danger', bar: 'bg-danger', dot: 'bg-danger' },
  done: { labelKey: 'status.done', chip: 'bg-success-weak text-success', bar: 'bg-success', dot: 'bg-success' },
}

/** depth(0-based) 별 배지 색 팔레트 — 옛 LEVEL 상수의 cls 를 그대로 재활용(회귀 0). depth 3+ 는 pending 재사용. */
const DEPTH_CLASS = [
  'bg-action-soft text-action',       // depth 0 (구 phase)
  'bg-progress-weak text-progress', // depth 1 (구 task)
  'bg-pending-weak text-pending',   // depth 2 (구 activity)
]
const DEPTH_CLASS_FALLBACK = 'bg-surface-subtle text-fg-secondary' // depth 3+
/* act 하위의 담당자별 분리 항목(임포트 시 자동 생성) 전용 표기 — 일반 배지와 시각 구분 */
const SUB_ACT = { label: 'SUB-ACT', cls: 'bg-surface-subtle text-fg-secondary' }
const koT = (k: DictKey) => translate('ko', k)
/** 배지 텍스트 — isOwnerSplit 이면 SUB-ACT, 아니면 프로젝트 단계 라벨 원문(levelLabels[depth]), 라벨 밖 깊이는 'N단'(SP4 — 옛 축약 규칙 삭제).
 * t 를 넘기지 않으면 ko 사전으로 읽는다(훅 밖 호출 — 서버·순수 함수). */
export function levelBadgeText(depth: number, isOwnerSplit: boolean, levelLabels: readonly string[], t: (k: DictKey) => string = koT): string {
  if (isOwnerSplit) return SUB_ACT.label
  return levelLabels[depth] ?? t('wbs.levelNth').replace('{n}', String(depth + 1))
}

/** 배지 색 — isOwnerSplit 이면 SUB-ACT 톤, 아니면 depth 기반 팔레트(depth 3+ 는 폴백 재사용). */
export function levelBadgeClass(depth: number, isOwnerSplit: boolean): string {
  if (isOwnerSplit) return SUB_ACT.cls
  return DEPTH_CLASS[depth] ?? DEPTH_CLASS_FALLBACK
}

export function StatusChip({ status, t }: { status: Status; t: (k: DictKey) => string }) {
  const s = STATUS[status]
  return (
    <span className={`chip ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {t(s.labelKey)}
    </span>
  )
}

export function LevelBadge({
  depth,
  isOwnerSplit = false,
  levelLabels,
  compact = false,
  t,
}: {
  depth: number
  isOwnerSplit?: boolean
  levelLabels: readonly string[]
  compact?: boolean
  t?: (k: DictKey) => string
}) {
  return (
    <span
      className={`lvl-badge ${levelBadgeClass(depth, isOwnerSplit)}`}
      style={{
        fontSize: 'var(--wbs-badge-font, 12px)',
        ...(compact
          ? {
              maxWidth: '100%',
              overflow: 'hidden',
              paddingInline: '3px',
              letterSpacing: 0,
              whiteSpace: 'nowrap',
            }
          : {}),
      }}
    >
      {levelBadgeText(depth, isOwnerSplit, levelLabels, t)}
    </span>
  )
}

export { OwnerBadges } from './OwnerBadges'

export function fmtDate(d: string | null): string {
  if (!d) return '-'
  return d.slice(2).replace(/-/g, '.') // 2026-09-15 -> 26.09.15
}

// 리프 수집은 도메인 계층(lib/domain/tree)이 단일 출처 — 여기선 재노출만.
export { collectLeaves } from '@/lib/domain/tree'

/**
 * WBS Task 단계(wbs_items.stage) 칩 — 상태(status)와 다른 축이다.
 * 상태는 실적·계획에서 매번 파생되는 계산값이고, 단계는 에이전트 루프가 옮기는 저장값이다.
 * 특히 im("검수 대기")에서 둘이 가장 크게 벌어진다 — 구현은 끝났는데 실적은 아직 100 이 아니라
 * 상태는 진행중/지연으로 남는다. 두 칩이 서로 어긋나 보이는 건 버그가 아니라 그 사실 자체다.
 *
 * 글자는 코드 두 자만 찍고 전체 라벨은 title 로 뺀다 — 단계 컬럼 칸에 전체 라벨이
 * 들어갈 자리가 없고, 짧은 한국어로 줄이면 stage ip('작업 중')가 StatusChip 의 '진행중'과 같은 행에서
 * 충돌한다. (LevelBadge 는 SP4 A2 부터 설정의 단계 이름을 그대로 찍는다 — 옛 PHASE/TASK/ACT 축약 어법은 없다.)
 */
const STAGE_META: Record<string, { key: DictKey; cls: string }> = {
  as: { key: 'wbs.stageAs', cls: 'bg-pending-weak text-pending' },
  ip: { key: 'wbs.stageIp', cls: 'bg-progress-weak text-progress' },
  im: { key: 'wbs.stageIm', cls: 'bg-action-soft text-action' },
  xx: { key: 'wbs.stageXx', cls: 'bg-success-weak text-success' },
}

const STAGE_UNKNOWN_CLS = 'bg-surface-subtle text-fg-secondary'

export function StageChip({
  stage,
  t,
}: {
  stage: string | null | undefined
  t: (k: DictKey) => string
}) {
  const label = useStageLabel()
  if (!stage) return null
  const meta = STAGE_META[stage]
  // 모르는 값도 그린다 — 감추면 "단계 없음"으로 위장한다(에러 처리 3원칙).
  return (
    <span
      data-wbs-stage={stage}
      className={`lvl-badge ${meta ? meta.cls : STAGE_UNKNOWN_CLS}`}
      style={{ fontSize: 'var(--wbs-badge-font, 12px)', paddingInline: '3px', letterSpacing: 0 }}
      title={meta ? label(stage, t(meta.key)) : stage}
    >
      {stage.toUpperCase()}
    </span>
  )
}
