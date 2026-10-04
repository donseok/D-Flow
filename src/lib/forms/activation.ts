// 활성화 전 매핑 완전성(정본 §4.7.3). 파일 바이트가 필요한 재스캔은 여기 없다 —
// engineVersion 이 현재가 아니면 등록을 다시 하라는 거부로 멈춘다(OPC scan 은 아직 없다).
import { validatePlaceholders } from '@/lib/report/engine/scanner'
import {
  FORM_FORMAT, type FormKind, type Placeholder, type PlaceholderKind, type RenderMapping, type ScanIssue, type ScanReport,
} from '@/lib/report/engine/types'

const ENGINE = 'forms-engine.v1'
const KINDS = new Set<PlaceholderKind>(['value', 'rows', 'slide', 'items'])

export type ActivationAssessment =
  | { ok: true }
  | { ok: false; code: 'UNMAPPED'; error: string; unmapped: string[] }
  | { ok: false; code: 'TYPE_MISMATCH' | 'SCAN' | 'RESCAN' | 'SHAPE'; error: string }

const ERR_UNMAPPED = '매핑되지 않은 자리표시자가 있어 활성화할 수 없습니다.'
const ERR_TYPE = '자리표시자 종류와 경로 타입이 맞지 않아 활성화할 수 없습니다.'
const ERR_SCAN = '양식 스캔에 오류가 있어 활성화할 수 없습니다. 파일을 다시 등록하세요.'
const ERR_RESCAN = '양식 스캔이 현재 엔진과 다릅니다. 파일을 다시 등록하세요.'
const ERR_SHAPE = '양식 스캔 결과를 읽지 못했습니다. 파일을 다시 등록하세요.'

function isPlaceholder(v: unknown): v is Placeholder {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const p = v as Placeholder
  return typeof p.token === 'string' && KINDS.has(p.kind) && typeof p.path === 'string'
    && Array.isArray(p.scope) && p.scope.every((s) => typeof s === 'string')
    && typeof p.location === 'object' && p.location !== null && !Array.isArray(p.location)
    && typeof p.mergedRuns === 'boolean'
}

function isIssue(v: unknown): v is ScanIssue {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const i = v as ScanIssue
  return typeof i.code === 'string' && (i.severity === 'error' || i.severity === 'warning') && typeof i.message === 'string'
}

/** 저장된 스캔이 현재 엔진의 ScanReport 인지. 다른 engineVersion 은 stale */
function readReport(raw: unknown, kind: FormKind): { ok: true; report: ScanReport } | { ok: false; code: 'RESCAN' | 'SHAPE' } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, code: 'SHAPE' }
  const version = (raw as { engineVersion?: unknown }).engineVersion
  if (version !== ENGINE) return { ok: false, code: typeof version === 'string' ? 'RESCAN' : 'SHAPE' }
  const format = (raw as { format?: unknown }).format
  if (format !== 'pptx' && format !== 'xlsx') return { ok: false, code: 'SHAPE' }
  if (format !== FORM_FORMAT[kind]) return { ok: false, code: 'SHAPE' }
  const placeholders = (raw as { placeholders?: unknown }).placeholders
  const issues = (raw as { issues?: unknown }).issues
  if (!Array.isArray(placeholders) || !placeholders.every(isPlaceholder)) return { ok: false, code: 'SHAPE' }
  if (!Array.isArray(issues) || !issues.every(isIssue)) return { ok: false, code: 'SHAPE' }
  return { ok: true, report: { engineVersion: ENGINE, format, placeholders, issues } }
}

/**
 * 스캔 토큰이 자동 경로 또는 mapping 으로 카탈로그에 닿는지, 블록/값 타입이 맞는지.
 * RECOMMENDED_MISSING 은 경고라 막지 않는다. 저장된 severity error 도 막는다(등록 거부 사유가 행에 남은 경우).
 */
export function assessFormActivation(
  kind: FormKind,
  placeholders: unknown,
  mapping: RenderMapping,
  activeCustomKeys?: readonly string[],
): ActivationAssessment {
  const read = readReport(placeholders, kind)
  if (!read.ok) return { ok: false, code: read.code, error: read.code === 'RESCAN' ? ERR_RESCAN : ERR_SHAPE }
  if (read.report.issues.some((i) => i.severity === 'error')) return { ok: false, code: 'SCAN', error: ERR_SCAN }
  const issues = validatePlaceholders(read.report.placeholders, kind, mapping, activeCustomKeys)
  const errors = issues.filter((i) => i.severity === 'error')
  const mismatch = errors.filter((i) => i.code === 'TYPE_MISMATCH')
  if (mismatch.length) return { ok: false, code: 'TYPE_MISMATCH', error: ERR_TYPE }
  const unmapped = [...new Set(errors.filter((i) => i.code === 'UNKNOWN_TOKEN').map((i) => i.token).filter((t): t is string => !!t))]
  if (unmapped.length) return { ok: false, code: 'UNMAPPED', error: ERR_UNMAPPED, unmapped }
  if (errors.length) return { ok: false, code: 'SCAN', error: ERR_SCAN }
  return { ok: true }
}
