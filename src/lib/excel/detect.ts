/** 양식 자동 감지(§6.3) — 임의의 엑셀 워크북을 열어 ExcelProfile 을 최선 추정한다.
 *  규칙은 전부 순수 함수로 분리한다(detectWorkbook 은 조립만). 감지 실패는 침묵 폴백이 아니라
 *  질문거리다 — 확신이 없으면 warnings 에 남기고 confidence 를 낮춘다(빈 매핑은 null). */

import * as XLSX from 'xlsx'
import type { ExcelProfile } from '@/lib/excel/profile'
// 별칭 사전(논리·담당)은 엑셀 머리 낱말의 단일 출처에 있다(SP4 D38) — 팀 예약어가 같은 사전에서 파생한다. 기존 import 경로를 위해 재수출한다
import { LOGICAL_ALIASES, TEAM_DIRECT_MARK, TEAM_HEADER_ALIASES, isHeaderWordMatch } from '@/lib/excel/headerWords'
export { LOGICAL_ALIASES } from '@/lib/excel/headerWords'
import { NOT_XLSX_ERROR, isDateCell, isXlsxBuffer, readSheetRows } from '@/lib/excel/sheetRows'

export interface DetectionResult {
  sheetNames: string[]
  profile: ExcelProfile          // 최선 추정(사람이 2단계에서 수정)
  confidence: { header: number; hierarchy: number; logical: number }  // 0~1
  preview: { headers: string[]; rows: unknown[][] }   // 헤더행 라벨 + 데이터 10행 원본
  warnings: string[]             // '가중치 열을 찾지 못했습니다' 등 — 빈 매핑은 null 로 두고 경고
  /** 계층 방식별 후보(BUG-08) — 마법사가 방식을 바꿀 때 그 방식의 후보에서 다시 시작한다(이전 방식의 열을 끌고 가지 않는다).
   *  columns = 열=계층 후보(없으면 []), outline = 아웃라인 코드 열 후보, name = 머리 낱말로 찾은 이름 열(아웃라인 전용) */
  hierarchyCandidates: { columns: number[]; outline: number | null; name: number | null }
  /** 구조를 확정하지 못했다(BUG-07·04) — 머리 행·계층 열·(아웃라인의) 이름 열 가운데 하나라도 못 찾았다. 추정으로 채우지 않았으므로
   *  사용자가 2단계에서 직접 지정해야 하고, 고치지 않은 이 양식은 프로젝트 기본 양식으로 저장하지 않는다 */
  uncertain: boolean
}

/** 담당 마크 방식(규칙 6)의 기본 마크 사전. */
export const DEFAULT_OWNER_MARKS: Record<string, 'primary' | 'support'> = {
  '●': 'primary', '△': 'support', '◎': 'primary', 'O': 'primary', 'o': 'primary',
}

const OUTLINE_RE = /^\d+([.\-]\d+)*$/

const FIELD_LABELS: Record<keyof ExcelProfile['logical'], string> = {
  extraAxis: '업무영역', code: '코드', deliverable: '산출물', start: '시작일',
  end: '종료일', weight: '가중치', actualPct: '실적%', name: '이름',
}

const ALL_ALIASES: string[] = Object.values(LOGICAL_ALIASES).flat().map(a => a.trim().toLowerCase())

/** 프로젝트의 추가 축 이름(core.extra_axis_label)을 그 열의 별칭에 더한다 — 내보내기가 그 이름으로 머리를 쓰므로(exportWithProfile) 같이 알아야
 *  왕복한다. 기존 낱말은 그대로 둔다(설정을 바꾸기 전에 낸 파일·남의 양식). 맨 앞에 둬 완전일치에서 먼저 잡힌다. */
function withExtraAxisAlias(aliases: readonly string[], extraAxisLabel: string | null): string[] {
  const label = extraAxisLabel?.trim().toLowerCase()
  return label && !aliases.includes(label) ? [label, ...aliases] : [...aliases]
}

function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}
function isTextCell(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== ''
}
function cellText(v: unknown): string {
  return String(v ?? '').trim()
}

/* ── 규칙 1: 시트 선택 — 'WBS' 우선, 없으면 첫 시트. Holiday 는 이름 일치 시만. 시트 0개 → null. ── */
export function pickSheets(sheetNames: string[]): { workSheetName: string; holidaySheetName: string | null } | null {
  if (sheetNames.length === 0) return null
  const workSheetName = sheetNames.includes('WBS') ? 'WBS' : sheetNames[0]
  const holidaySheetName = sheetNames.includes('Holiday') ? 'Holiday' : null
  return { workSheetName, holidaySheetName }
}

/* ── 규칙 2: 헤더 행 — 상위 10행을 별칭 사전 히트 수로 스코어링. 동점·0점이면 tie=true. ── */
export function detectHeaderRow(
  aoa: unknown[][], maxScan = 10, extraAxisLabel: string | null = null, levelLabels: readonly string[] = [],
): { row: number; score: number; tie: boolean } {
  // 프로젝트의 단계 이름도 머리 낱말이다(BUG-07) — 단계 이름만 있는 머리 행도 점수를 받는다
  const levels = levelLabels.map((l) => l.trim().toLowerCase()).filter(Boolean)
  const known = [...new Set([...withExtraAxisAlias(ALL_ALIASES, extraAxisLabel), ...levels])]
  const n = Math.min(maxScan, aoa.length)
  if (n === 0) return { row: 0, score: 0, tie: false }
  const scores: number[] = []
  for (let r = 0; r < n; r++) {
    const row = aoa[r] ?? []
    let score = 0
    for (const cell of row) {
      const s = cellText(cell).toLowerCase()
      if (s && known.includes(s)) score++
    }
    scores.push(score)
  }
  const max = Math.max(...scores)
  const winners = scores.reduce<number[]>((acc, s, i) => (s === max ? [...acc, i] : acc), [])
  return { row: winners[0], score: max, tie: winners.length > 1 || max === 0 }
}

/* ── 규칙 3: 열=계층 — 텍스트 열의 연속 구간 중 "행마다 비공백 정확히 1개" 비율 90%+ 인 최장 구간.
 *  후보 없으면 null(호출부가 아웃라인으로 넘어간다). 길이 1 구간은 "항상 채워진 단일 필드"(예: 산출물)와
 *  구별할 수 없으므로 제외한다 — 계층은 최소 2열 이상이어야 의미가 있다. ── */
export function detectColumnHierarchy(dataRows: unknown[][], excluded: ReadonlySet<number> = new Set()): { columns: number[]; ratio: number } | null {
  if (dataRows.length === 0) return null
  const maxCol = dataRows.reduce((m, r) => Math.max(m, r.length), 0)
  const isTextColumn: boolean[] = []
  // excluded = 날짜로 읽히는 열 등 계층일 수 없는 열 — 글자로 적은 날짜('2026-10-20')도 글자 열이라 구간에 섞였다
  for (let c = 0; c < maxCol; c++) isTextColumn[c] = !excluded.has(c) && dataRows.some(r => isTextCell(r[c]))

  const runs: [number, number][] = []
  let runStart: number | null = null
  for (let c = 0; c <= maxCol; c++) {
    const t = c < maxCol && isTextColumn[c]
    if (t && runStart === null) runStart = c
    if (!t && runStart !== null) { runs.push([runStart, c - 1]); runStart = null }
  }

  let best: { columns: number[]; ratio: number } | null = null
  for (const [s, e] of runs) {
    for (let len = e - s + 1; len >= 2; len--) {
      for (let start = s; start + len - 1 <= e; start++) {
        const cols = Array.from({ length: len }, (_, i) => start + i)
        const ratio = exactlyOneRatio(dataRows, cols)
        if (ratio >= 0.9 && (!best || len > best.columns.length || (len === best.columns.length && start < best.columns[0]))) {
          best = { columns: cols, ratio }
        }
      }
    }
  }
  return best
}

function exactlyOneRatio(dataRows: unknown[][], cols: number[]): number {
  if (dataRows.length === 0) return 0
  let hit = 0
  for (const r of dataRows) {
    const filled = cols.filter(c => !isBlankCell(r[c])).length
    if (filled === 1) hit++
  }
  return hit / dataRows.length
}

/* ── 규칙 4: 아웃라인 — ^\d+([.\-]\d+)*$ 매치 비율 80%+ 인 첫 열(왼쪽부터). ── */
export function detectOutlineHierarchy(dataRows: unknown[][], excluded: ReadonlySet<number> = new Set()): { column: number; ratio: number } | null {
  if (dataRows.length === 0) return null
  const maxCol = dataRows.reduce((m, r) => Math.max(m, r.length), 0)
  for (let c = 0; c < maxCol; c++) {
    // excluded = 날짜로 읽히는 열·머리가 다른 논리 열(시작·종료·가중치·실적%)인 열(BUG-07). 아웃라인 패턴은 숫자와 '.'·'-' 뿐이라
    // 글자 날짜('2026-10-20')와 정수 열(가중치 50)이 그대로 걸린다
    if (excluded.has(c)) continue
    let hit = 0
    for (const r of dataRows) if (OUTLINE_RE.test(cellText(r[c]))) hit++
    const ratio = hit / dataRows.length
    if (ratio >= 0.8) return { column: c, ratio }
  }
  return null
}

function leftmostTextColumn(headerLabels: string[]): number {
  for (let c = 0; c < headerLabels.length; c++) if (headerLabels[c] !== '') return c
  return 0
}

/** 부분일치 단계 최소 별칭 길이. 길이 2 이하 별칭('No' 등)은 부분일치에 쓰면 'Note'/'Nomination' 류
 *  무관 헤더를 오탐한다(리뷰 발견) — 그런 별칭은 완전일치로만 인정한다. 헤더 셀 쪽도 같은 이유로
 *  이 길이 미만이면 부분일치 후보에서 아예 제외한다(양방향 짧은 문자열 오탐 방지). */
const MIN_PARTIAL_ALIAS_LEN = 3

/* ── 규칙 5: 논리 열 — 완전일치 우선, 부분일치 차선(짧은 별칭은 완전일치만). 미발견 = null + warning.
 *  부분일치로 확정된 열은 별도 warning("...(으)로 추정했습니다")을 남긴다 — 사람 확인 없이 확정 취급하지
 *  않는다. hierarchy 가 이미 점유한 열은 후보에서 제외한다(충돌 방지). 같은 열이 두 필드에 중복 배정되지
 *  않도록 배정된 열은 즉시 claim 한다. ── */
export function detectLogicalColumns(
  headerLabels: string[],
  excluded: ReadonlySet<number> = new Set(),
  extraAxisLabel: string | null = null,
  /** 날짜로 읽히는 열 — 코드·이름 후보에서 뺀다(BUG-07). 나머지 필드는 그대로 본다(시작·종료가 바로 이 열이다) */
  dateLike: ReadonlySet<number> = new Set(),
): { logical: ExcelProfile['logical']; warnings: string[]; partialMatchCount: number } {
  const lower = headerLabels.map(v => v.toLowerCase())
  const warnings: string[] = []
  const claimed = new Set<number>(excluded)
  const fields = Object.keys(LOGICAL_ALIASES) as (keyof ExcelProfile['logical'])[]
  const logical = {} as ExcelProfile['logical']
  let partialMatchCount = 0

  for (const field of fields) {
    const own = LOGICAL_ALIASES[field].map(a => a.trim().toLowerCase())
    const aliases = field === 'extraAxis' ? withExtraAxisAlias(own, extraAxisLabel) : own
    const barred = (c: number) => (field === 'code' || field === 'name') && dateLike.has(c)
    let found = -1
    for (let c = 0; c < lower.length; c++) {
      if (claimed.has(c) || !lower[c] || barred(c)) continue
      if (aliases.includes(lower[c])) { found = c; break }
    }
    let isPartial = false
    if (found < 0) {
      const partialAliases = aliases.filter(a => a.length >= MIN_PARTIAL_ALIAS_LEN)
      for (let c = 0; c < lower.length; c++) {
        if (claimed.has(c) || lower[c].length < MIN_PARTIAL_ALIAS_LEN || barred(c)) continue
        if (partialAliases.some(a => lower[c].includes(a) || a.includes(lower[c]))) { found = c; isPartial = true; break }
      }
    }
    if (found >= 0) {
      logical[field] = found
      claimed.add(found)
      if (isPartial) {
        partialMatchCount++
        warnings.push(`'${headerLabels[found]}' 열을 ${FIELD_LABELS[field]}(으)로 추정했습니다 — 2단계에서 확인하세요`)
      }
    } else {
      logical[field] = null
      warnings.push(`${FIELD_LABELS[field]} 열을 찾지 못했습니다`)
    }
  }
  return { logical, warnings, partialMatchCount }
}

/** '담당' 계열 머리 열에 마크(●/△)가 있을 때의 안내 — 그 열을 팀 열로 잡으면 '담당' 이라는 팀이 생긴다(SP4 D39) */
/** 안내는 결과까지 말한다(A2-2 리뷰 P3) — 감지는 팀 열 없이 진행되므로 그대로 실행하면 그 열의 담당(마크·섞인 팀명)이 버려진다 */
export const OWNER_MARKS_IN_TEAM_HEADER = '담당 열에는 팀 이름을 적으세요 — ●/△ 는 팀마다 열을 둘 때 씁니다. 이대로 가져오면 이 열의 담당은 버려지고 항목은 담당 없이 들어갑니다'

/* ── 규칙 6: 팀 열 — 마크 방식(계층·논리 열과 '담당' 계열 머리 열을 뺀 뒤, 데이터 셀이 DEFAULT_OWNER_MARKS 키 또는 공백뿐인 열) 우선.
 *  없으면 '담당' 계열 머리 열 하나에 팀명이 직접 든 방식(teamColumns=[[열, TEAM_DIRECT_MARK]]). 그 열에 마크가 있으면 팀 열 없음 + 안내(D39 —
 *  마크는 팀마다 열을 둘 때 쓴다; 그 열을 마크 방식으로 잡으면 머리 '담당' 이 팀 이름이 된다). 둘 다 없으면 빈 배열 + warning. 마크 방식은
 *  실제 마크가 최소 1개 있어야 인정한다(완전히 빈 스페이서 열이 팀 열로 오인되는 것을 막기 위함 — 헤더 라벨도 비어 있으면 후보에서 제외).
 *  '담당' 계열 별칭 비교는 머리 낱말 비교(isHeaderWordMatch — 대소문자·전각·앞뒤 공백 무시)다. ── */
export function detectTeamColumns(
  headerLabels: string[],
  dataRows: unknown[][],
  excluded: ReadonlySet<number> = new Set(),
): { teamColumns: [number, string][]; warnings: string[] } {
  const isTeamHeader = (label: string) => TEAM_HEADER_ALIASES.some((a) => isHeaderWordMatch(a, label))
  const isMark = (v: string) => Object.prototype.hasOwnProperty.call(DEFAULT_OWNER_MARKS, v)
  const maxCol = Math.max(headerLabels.length, dataRows.reduce((m, r) => Math.max(m, r.length), 0))
  const markCols: [number, string][] = []
  for (let c = 0; c < maxCol; c++) {
    if (excluded.has(c)) continue
    const label = headerLabels[c] ?? ''
    if (!label || isTeamHeader(label)) continue
    let sawMark = false
    let allMarkOrBlank = true
    for (const r of dataRows) {
      const v = cellText(r[c])
      if (v === '') continue
      if (isMark(v)) sawMark = true
      else { allMarkOrBlank = false; break }
    }
    if (sawMark && allMarkOrBlank) markCols.push([c, label])
  }
  if (markCols.length > 0) return { teamColumns: markCols, warnings: [] }

  for (let c = 0; c < headerLabels.length; c++) {
    if (excluded.has(c) || !headerLabels[c] || !isTeamHeader(headerLabels[c])) continue
    if (dataRows.some((r) => isMark(cellText(r[c])))) return { teamColumns: [], warnings: [OWNER_MARKS_IN_TEAM_HEADER] }
    return { teamColumns: [[c, TEAM_DIRECT_MARK]], warnings: ['담당 열의 팀명을 직접 사용'] }
  }
  return { teamColumns: [], warnings: ['팀 열을 찾지 못했습니다'] }
}

/* ── 규칙 3′: 단계 이름 열(BUG-07) — 머리 낱말이 프로젝트의 단계 이름(core.level_labels)과 같은 열들. 둘 이상이고 단계 순서대로
 *  왼쪽에서 오른쪽으로 놓였으면 그 열들이 계층이다(자료의 모양으로 추정하는 규칙 3 보다 먼저 — 머리가 말해 주는 사실이다).
 *  비교는 머리 낱말 비교(대소문자·전각·앞뒤 공백 무시). 하나만 맞거나 순서가 뒤집혔으면 null(다음 규칙으로). ── */
export function detectLevelLabelColumns(headerLabels: string[], levelLabels: readonly string[]): number[] | null {
  const cols: number[] = []
  for (const label of levelLabels) {
    if (!label.trim()) continue
    const c = headerLabels.findIndex((h, idx) => h !== '' && !cols.includes(idx) && isHeaderWordMatch(h, label))
    if (c >= 0) cols.push(c)
  }
  if (cols.length < 2) return null
  return cols.every((c, i) => i === 0 || c > cols[i - 1]) ? cols : null
}

/** 날짜 글자 — 'YYYY-MM-DD'·'YYYY.MM.DD'·'YYYY/MM/DD'(자리 수는 느슨하게). 코드·이름 후보에서 빼는 판정에만 쓴다(값 읽기는 toIso) */
const DATE_TEXT_RE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/

/** 날짜로 읽히는 열 — 값이 있는 칸의 절반 이상이 날짜 서식의 수이거나 날짜 글자인 열 */
function dateLikeColumns(ws: XLSX.WorkSheet | undefined, dataRows: unknown[][], dataExcelRows: number[]): Set<number> {
  const out = new Set<number>()
  const maxCol = dataRows.reduce((m, r) => Math.max(m, r.length), 0)
  for (let c = 0; c < maxCol; c++) {
    let filled = 0
    let dates = 0
    dataRows.forEach((r, i) => {
      const v = r[c]
      if (isBlankCell(v)) return
      filled++
      if ((typeof v === 'string' && DATE_TEXT_RE.test(v.trim())) || (ws && isDateCell(ws, dataExcelRows[i], c))) dates++
    })
    if (filled > 0 && dates / filled >= 0.5) out.add(c)
  }
  return out
}

/** 머리 낱말이 그 필드들의 별칭과 정확히 같은 열 */
function exactAliasColumns(headerLabels: string[], fields: readonly (keyof ExcelProfile['logical'])[]): Set<number> {
  const words = fields.flatMap((f) => LOGICAL_ALIASES[f]).map((a) => a.trim().toLowerCase())
  const out = new Set<number>()
  headerLabels.forEach((h, c) => { if (h && words.includes(h.toLowerCase())) out.add(c) })
  return out
}

export const WARN_HIERARCHY_NOT_FOUND = '계층 열을 찾지 못했습니다 — 2단계에서 계층 방식과 열을 직접 지정하세요'
export const WARN_NAME_NOT_FOUND = "'이름' 열을 찾지 못했습니다 — 2단계에서 이름 열을 직접 지정하세요"

/* ── 조립 ── */
export function detectWorkbook(
  buf: ArrayBuffer,
  opts: { extraAxisLabel?: string | null; /** 프로젝트의 단계 이름(core.level_labels) — 계층 열 후보로 먼저 쓴다 */ levelLabels?: readonly string[] } = {},
): { ok: true; result: DetectionResult } | { ok: false; error: string } {
  const extraAxisLabel = opts.extraAxisLabel ?? null
  const levelLabels = opts.levelLabels ?? []
  // 엑셀이 아닌 파일은 여기서 끝낸다 — SheetJS 는 평문을 CSV 로 읽어 주므로 읽기 실패로는 걸러지지 않는다(BUG-04)
  if (!isXlsxBuffer(buf)) return { ok: false, error: NOT_XLSX_ERROR }
  let wb: XLSX.WorkBook
  try {
    // cellNF — 날짜 서식의 수(엑셀 날짜)를 알아보려면 서식 코드가 있어야 한다(dateLikeColumns)
    wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true })
  } catch {
    return { ok: false, error: '워크북을 읽을 수 없습니다' }
  }

  const sheets = pickSheets(wb.SheetNames)
  if (!sheets) return { ok: false, error: '시트가 없습니다' }
  const { workSheetName, holidaySheetName } = sheets

  const ws = wb.Sheets[workSheetName] as XLSX.WorkSheet | undefined
  const { aoa, excelRows } = readSheetRows(ws)

  const warnings: string[] = []

  // 규칙 2
  const headerRes = detectHeaderRow(aoa, 10, extraAxisLabel, levelLabels)
  const headerUnclear = headerRes.tie || headerRes.score === 0
  const headerRow = headerUnclear ? 0 : headerRes.row
  if (headerUnclear) warnings.push('헤더 행을 확실히 찾지 못했습니다 — 0행으로 가정합니다')
  const confidenceHeader = headerUnclear ? 0.15 : Math.min(1, headerRes.score / 4)

  const headerLabels = ((aoa[headerRow] ?? []) as unknown[]).map(cellText)
  const dataRows = aoa.slice(headerRow + 1)
  const dateLike = dateLikeColumns(ws, dataRows, excelRows.slice(headerRow + 1))

  // 규칙 3′ → 3 → 4. 두 방식의 후보를 다 구해 둔다 — 고른 방식은 하나지만 마법사가 방식을 바꾸면 다른 쪽 후보에서 시작한다(BUG-08)
  const labelColumns = detectLevelLabelColumns(headerLabels, levelLabels)
  const shapeColumns = labelColumns ? null : detectColumnHierarchy(dataRows, dateLike)
  // 아웃라인 코드일 수 없는 열 — 날짜 열과, 머리가 다른 논리 열이라고 말하는 열
  const notOutline = new Set<number>([...dateLike, ...exactAliasColumns(headerLabels, ['start', 'end', 'weight', 'actualPct'])])
  const outlineCandidate = detectOutlineHierarchy(dataRows, notOutline)

  let hierarchy: ExcelProfile['hierarchy']
  let confidenceHierarchy: number
  let hierarchyFound = true
  if (labelColumns) {
    hierarchy = { kind: 'columns', columns: labelColumns }
    confidenceHierarchy = 1
  } else if (shapeColumns) {
    hierarchy = { kind: 'columns', columns: shapeColumns.columns }
    confidenceHierarchy = shapeColumns.ratio
  } else if (outlineCandidate) {
    hierarchy = { kind: 'outline', column: outlineCandidate.column }
    confidenceHierarchy = outlineCandidate.ratio
  } else {
    // 못 찾았다 — 양식의 모양(계층은 비울 수 없다)을 채우려고 첫 글자 열을 두지만 추정이 아니라 빈자리다: uncertain 으로 표시하고
    // 사용자가 2단계에서 직접 지정한다
    hierarchy = { kind: 'columns', columns: [leftmostTextColumn(headerLabels)] }
    confidenceHierarchy = 0
    hierarchyFound = false
    warnings.push(WARN_HIERARCHY_NOT_FOUND)
  }
  const hierarchyColumns = new Set<number>(hierarchy.kind === 'columns' ? hierarchy.columns : [hierarchy.column])
  // outline 열은 코드 열과 동일 물리 열인 경우가 흔하다(Task 4 §6.4 — "코드 열 값이 code 후보").
  // columns 계층(Phase/Task/Activity 류)만 논리 열 후보에서 제외한다.
  const logicalExcluded = hierarchy.kind === 'columns' ? hierarchyColumns : new Set<number>()

  // 규칙 5
  const logicalRes = detectLogicalColumns(headerLabels, logicalExcluded, extraAxisLabel, dateLike)
  // '이름 열 없음' 경고는 아웃라인에서만 뜻이 있다 — 열=계층은 계층 열이 곧 이름이다. 아웃라인은 아래에서 더 분명한 문구로 낸다
  warnings.push(...logicalRes.warnings.filter((w) => w !== `${FIELD_LABELS.name} 열을 찾지 못했습니다`))

  // name 열은 outline 계층에서만 유효하다(columns 계층은 계층 열 자체가 이름의 출처 — 리뷰 픽스).
  // outline 인데 머리 낱말로 못 찾았으면 비워 둔다(BUG-07) — 예전에는 '코드 열 바로 다음 열' 로 추정해, 코드 열을 잘못 잡은 날
  // 종료일이 이름이 됐다. 못 찾은 것은 사용자가 고른다.
  const aliasName = logicalRes.logical.name
  const nameMissing = hierarchy.kind === 'outline' && aliasName === null
  if (nameMissing) warnings.push(WARN_NAME_NOT_FOUND)
  const logical: ExcelProfile['logical'] = { ...logicalRes.logical, name: hierarchy.kind === 'columns' ? null : aliasName }
  const partialMatchCount = logicalRes.partialMatchCount

  const matchedLogical = Object.values(logical).filter(v => v !== null).length
  const exactMatchedLogical = matchedLogical - partialMatchCount
  // 부분일치는 완전일치의 절반 가중치만 인정 — 추정임을 confidence 에도 반영한다.
  const confidenceLogical =
    (exactMatchedLogical + partialMatchCount * 0.5) / Object.keys(LOGICAL_ALIASES).length

  // 규칙 6
  const logicalColumns = new Set<number>(
    Object.values(logical).filter((v): v is number => v !== null),
  )
  const excludedForTeams = new Set<number>([...hierarchyColumns, ...logicalColumns])
  const teamRes = detectTeamColumns(headerLabels, dataRows, excludedForTeams)
  warnings.push(...teamRes.warnings)

  const profile: ExcelProfile = {
    version: 1,
    sheetName: workSheetName,
    holidaySheetName,
    headerRow,
    hierarchy,
    logical,
    teamColumns: teamRes.teamColumns,
    ownerMarks: { ...DEFAULT_OWNER_MARKS },
  }

  // 규칙 7
  const result: DetectionResult = {
    sheetNames: wb.SheetNames,
    profile,
    confidence: { header: confidenceHeader, hierarchy: confidenceHierarchy, logical: confidenceLogical },
    preview: { headers: headerLabels, rows: dataRows.slice(0, 10) },
    warnings,
    hierarchyCandidates: {
      columns: labelColumns ?? shapeColumns?.columns ?? [],
      outline: outlineCandidate?.column ?? null,
      name: aliasName,
    },
    uncertain: headerUnclear || !hierarchyFound || nameMissing,
  }
  return { ok: true, result }
}
