/**
 * SP6 순수 자리표시자 스캐너 및 토큰 파서 (정본 §4.4.1·§4.4.2, 개정 §3.6.8)
 */
import { resolveCatalogPath } from '../catalog'
import {
  type FormKind,
  type Placeholder,
  type PlaceholderKind,
  type PlaceholderLocation,
  type RenderMapping,
  type ScanIssue,
} from './types'

const ABSOLUTE_PATH_RE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/

export interface ParsedTokenSuccess {
  ok: true
  token: string
  kind: PlaceholderKind | 'close_rows' | 'close_items'
  path: string
}

export interface ParsedTokenFailure {
  ok: false
  raw: string
  error: string
}

export type ParsedTokenResult = ParsedTokenSuccess | ParsedTokenFailure

/**
 * 중괄호 안의 본문(rawBody)을 파싱하여 토큰 구조를 생성한다.
 */
export function parseTokenBody(rawBody: string): ParsedTokenResult {
  const trimmed = rawBody.trim()
  if (!trimmed) {
    return { ok: false, raw: `{{${rawBody}}}`, error: 'Empty token body' }
  }

  // 1. 블록 닫기 토큰: /rows, /items
  if (trimmed.startsWith('/')) {
    const closeKeyword = trimmed.slice(1).trim()
    if (closeKeyword === 'rows') {
      return { ok: true, token: '{{/rows}}', kind: 'close_rows', path: '' }
    }
    if (closeKeyword === 'items') {
      return { ok: true, token: '{{/items}}', kind: 'close_items', path: '' }
    }
    return { ok: false, raw: `{{${rawBody}}}`, error: `Invalid closing block '${trimmed}'` }
  }

  // 2. 블록 열기 토큰: #rows path, #slide path, #items path
  if (trimmed.startsWith('#')) {
    const match = trimmed.match(/^#(rows|slide|items)[ \t]+(.+)$/)
    if (!match) {
      return { ok: false, raw: `{{${rawBody}}}`, error: `Malformed block open syntax '${trimmed}'` }
    }
    const blockKind = match[1] as PlaceholderKind
    const path = match[2].trim()

    if (!isValidPath(path)) {
      return { ok: false, raw: `{{${rawBody}}}`, error: `Invalid path '${path}' in block open` }
    }

    return {
      ok: true,
      token: `{{#${blockKind} ${path}}}`,
      kind: blockKind,
      path,
    }
  }

  // 3. 값 토큰: path
  if (!isValidPath(trimmed)) {
    return { ok: false, raw: `{{${rawBody}}}`, error: `Invalid value token path '${trimmed}'` }
  }

  return {
    ok: true,
    token: `{{${trimmed}}}`,
    kind: 'value',
    path: trimmed,
  }
}

/**
 * 경로 문법 검사: absolute 또는 relative 경로 여부 판정
 */
export function isValidPath(path: string): boolean {
  if (path === '.') return true
  if (path.startsWith('.')) {
    // 상대 경로: .name, .this_content, .custom.foo
    const rest = path.slice(1)
    return ABSOLUTE_PATH_RE.test(rest)
  }
  // 절대 경로: report.week_range, sections, kpi.plan
  return ABSOLUTE_PATH_RE.test(path)
}

/**
 * 단일 텍스트 문자열에서 토큰들을 스캔한다.
 */
export function scanTextTokens(
  text: string,
  location: PlaceholderLocation,
  scopeStack: string[] = [],
): { placeholders: Placeholder[]; issues: ScanIssue[] } {
  const placeholders: Placeholder[] = []
  const issues: ScanIssue[] = []

  let pos = 0
  while (pos < text.length) {
    const openIdx = text.indexOf('{{', pos)
    if (openIdx === -1) break

    const closeIdx = text.indexOf('}}', openIdx + 2)
    if (closeIdx === -1) {
      // 닫히지 않은 중괄호
      const raw = text.slice(openIdx)
      issues.push({
        code: 'MALFORMED_TOKEN',
        severity: 'error',
        message: `Unclosed delimiter '${raw}'`,
        location,
        token: raw,
      })
      break
    }

    const rawToken = text.slice(openIdx, closeIdx + 2)
    const rawBody = text.slice(openIdx + 2, closeIdx)
    const parsed = parseTokenBody(rawBody)

    if (!parsed.ok) {
      issues.push({
        code: 'MALFORMED_TOKEN',
        severity: 'error',
        message: parsed.error,
        location,
        token: rawToken,
      })
      pos = closeIdx + 2
      continue
    }

    if (parsed.kind === 'close_items') {
      const top = scopeStack[scopeStack.length - 1]
      if (!top || !top.startsWith('{{#items ')) {
        issues.push({
          code: 'UNCLOSED_BLOCK',
          severity: 'error',
          message: "Unexpected closing tag '{{/items}}' with no matching open block",
          location,
          token: rawToken,
        })
      } else {
        scopeStack.pop()
      }
    } else if (parsed.kind === 'close_rows') {
      const top = scopeStack[scopeStack.length - 1]
      if (!top || !top.startsWith('{{#rows ')) {
        issues.push({
          code: 'UNCLOSED_BLOCK',
          severity: 'error',
          message: "Unexpected closing tag '{{/rows}}' with no matching open block",
          location,
          token: rawToken,
        })
      } else {
        scopeStack.pop()
      }
    } else {
      // value, rows, slide, items
      const placeholder: Placeholder = {
        token: parsed.token,
        kind: parsed.kind,
        path: parsed.path,
        scope: [...scopeStack],
        location,
        mergedRuns: false,
      }
      placeholders.push(placeholder)

      if (parsed.kind === 'rows' || parsed.kind === 'slide' || parsed.kind === 'items') {
        scopeStack.push(parsed.token)
      }
    }

    pos = closeIdx + 2
  }

  return { placeholders, issues }
}

export interface RunSegment {
  text: string
}

/**
 * 런(Run) 배열에서 쪼개진 토큰을 병합하여 스캔한다 (스파이크 ① 지표).
 */
export function scanRunTokens(
  runs: readonly RunSegment[],
  location: PlaceholderLocation,
  scopeStack: string[] = [],
): { placeholders: Placeholder[]; issues: ScanIssue[] } {
  if (runs.length === 0) return { placeholders: [], issues: [] }

  // 전체 텍스트 연결 및 각 런의 시작/종료 오프셋 기록
  let fullText = ''
  const runBoundaries: Array<{ start: number; end: number }> = []

  for (const r of runs) {
    const start = fullText.length
    fullText += r.text
    runBoundaries.push({ start, end: fullText.length })
  }

  const { placeholders, issues } = scanTextTokens(fullText, location, scopeStack)

  // 각 플레이스홀더가 여러 런에 걸쳐 있는지 검사
  let searchPos = 0
  for (const p of placeholders) {
    const idx = fullText.indexOf(p.token, searchPos)
    if (idx !== -1) {
      searchPos = idx + p.token.length
      const tokenEnd = searchPos

      const startRun = runBoundaries.findIndex(b => idx >= b.start && idx < b.end)
      const endRun = runBoundaries.findIndex(b => tokenEnd > b.start && tokenEnd <= b.end)

      if (startRun !== -1 && endRun !== -1 && startRun !== endRun) {
        p.mergedRuns = true
        issues.push({
          code: 'SPLIT_RUN',
          severity: 'warning',
          message: `Token '${p.token}' was split across runs (${startRun} to ${endRun}) and merged`,
          location: p.location,
          token: p.token,
        })
      }
    }
  }

  return { placeholders, issues }
}

/**
 * 스캔된 플레이스홀더들을 데이터 카탈로그 및 매핑에 대해 정밀 검증한다.
 */
export function validatePlaceholders(
  placeholders: readonly Placeholder[],
  formKind: FormKind,
  mapping: RenderMapping = {},
  activeCustomKeys?: readonly string[],
): ScanIssue[] {
  const issues: ScanIssue[] = []
  const isXlsx = formKind.endsWith('_xlsx')

  // 1. 슬라이드별 slide 블록 수 집계 (pptx)
  const slideCountsBySlide = new Map<number, number>()

  for (const p of placeholders) {
    const compositeKey = [...p.scope, p.token].join('/')
    const mappedPath = mapping[compositeKey] ?? mapping[p.token] ?? p.path

    // 1-1. xlsx에 slide 블록 금지
    if (isXlsx && p.kind === 'slide') {
      issues.push({
        code: 'SLIDE_IN_XLSX',
        severity: 'error',
        message: `{{#slide}} token is not supported in XLSX forms: '${p.token}'`,
        location: p.location,
        token: p.token,
      })
      continue
    }

    // 1-2. 한 슬라이드에 slide 블록 2개 이상 금지
    if (p.kind === 'slide' && p.location.slide !== undefined) {
      const current = slideCountsBySlide.get(p.location.slide) ?? 0
      slideCountsBySlide.set(p.location.slide, current + 1)
      if (current >= 1) {
        issues.push({
          code: 'MULTIPLE_SLIDE_BLOCKS',
          severity: 'error',
          message: `Multiple {{#slide}} blocks found on slide ${p.location.slide}`,
          location: p.location,
          token: p.token,
        })
      }
    }

    // 1-3. 카탈로그 경로 해석
    const resolved = resolveCatalogPath(formKind, mappedPath, p.scope, activeCustomKeys, mapping)
    if (!resolved) {
      issues.push({
        code: 'UNKNOWN_TOKEN',
        severity: 'error',
        message: `Token '${p.token}' (resolved path: '${mappedPath}') not found in catalog or mapping`,
        location: p.location,
        token: p.token,
      })
      continue
    }

    // 1-4. TYPE_MISMATCH 검사
    const fieldType = resolved.field.type
    if (p.kind === 'value') {
      // 값 토큰에는 list<record>를 사용할 수 없음
      if (fieldType === 'list<record>') {
        issues.push({
          code: 'TYPE_MISMATCH',
          severity: 'error',
          message: `Value token '${p.token}' cannot reference list<record> path '${mappedPath}'`,
          location: p.location,
          token: p.token,
        })
      }
    } else {
      // rows, slide, items 블록 토큰에는 목록(list<record> | list<text>)만 올 수 있음
      if (fieldType !== 'list<record>' && fieldType !== 'list<text>') {
        issues.push({
          code: 'TYPE_MISMATCH',
          severity: 'error',
          message: `Block token '${p.token}' cannot reference scalar path '${mappedPath}' (type: ${fieldType})`,
          location: p.location,
          token: p.token,
        })
      }
    }
  }

  // 2. 권장 토큰 부재 검사 (오류가 없을 때만 경고)
  const hasErrors = issues.some(i => i.severity === 'error')
  if (!hasErrors) {
    if (formKind.startsWith('weekly_report')) {
      const hasSectionsOrWbs = placeholders.some(p => {
        const compositeKey = [...p.scope, p.token].join('/')
        const effective = mapping[compositeKey] ?? mapping[p.token] ?? p.path
        return effective.startsWith('sections') || effective.startsWith('wbs_groups')
      })
      if (!hasSectionsOrWbs) {
        issues.push({
          code: 'RECOMMENDED_MISSING',
          severity: 'warning',
          message: "Recommended token 'sections' is missing from weekly report template",
        })
      }
    } else if (formKind === 'issue_analysis_pptx') {
      const hasAreasOrIssues = placeholders.some(p => {
        const compositeKey = [...p.scope, p.token].join('/')
        const effective = mapping[compositeKey] ?? mapping[p.token] ?? p.path
        return effective.startsWith('areas') || effective.startsWith('issues')
      })
      if (!hasAreasOrIssues) {
        issues.push({
          code: 'RECOMMENDED_MISSING',
          severity: 'warning',
          message: "Recommended token 'areas' or 'issues' is missing from issue analysis template",
        })
      }
    } else if (formKind === 'wbs_export_xlsx') {
      const hasWbsItems = placeholders.some(p => {
        const compositeKey = [...p.scope, p.token].join('/')
        const effective = mapping[compositeKey] ?? mapping[p.token] ?? p.path
        return effective.startsWith('wbs_items')
      })
      if (!hasWbsItems) {
        issues.push({
          code: 'RECOMMENDED_MISSING',
          severity: 'warning',
          message: "Recommended token 'wbs_items' is missing from WBS export template",
        })
      }
    }
  }

  return issues
}
