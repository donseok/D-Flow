/** 프로파일 주입형 N단 파서 + 링커(Plan B §6.4, Task 4).
 *  `ExcelProfile` 을 받아 임의 양식을 파싱한다. 옛 3행 헤더 양식(tests/fixtures/excel/legacy-3row-profile)을
 *  주입하면 구 3행 헤더 파서와 동등한 결과를 낸다(라운드트립 계약,
 *  tests/excel/parse-with-profile.test.ts 케이스 (a)). 구 파서는 tests/fixtures/excel/legacyParse.ts 의
 *  테스트 오라클로만 남았다 — 런타임 임포터는 이 파일이다. */

import * as XLSX from 'xlsx'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ImportItem, ImportError } from '@/lib/excel/validate'
import { TEAM_DIRECT_MARK } from '@/lib/excel/headerWords'
import { NOT_XLSX_ERROR, isPercentCell, isXlsxBuffer, readSheetRows } from '@/lib/excel/sheetRows'
import {
  actualPctViolation, importedWeightScale, importedWeightToFraction, weightViolation, type ImportedWeightCell,
} from '@/lib/domain/wbsValueRules'

export interface ParsedRowN {
  depth: number                 // 0-based
  code: string | null           // 코드 열 값(§6.4). 없으면 null → 링커가 채번
  name: string
  extraAxis: string | null
  deliverable: string | null
  plannedStart: string | null; plannedEnd: string | null
  weight: number | null; actualPct: number | null
  owners: { team: string; kind: 'primary' | 'support' }[]
  custom?: Record<string, unknown>
  excelRow: number
}

/** 엑셀 날짜는 시리얼(정수)로 저장됨. SSF.parse_date_code 로 타임존 무관하게 {y,m,d} 도출
 *  (cellDates 로컬 변환에 의존하면 Asia/Seoul 1899 LMT 오프셋 때문에 -1일 밀린다). */
const ISO_DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/

function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v)
    if (!d) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.y}-${p(d.m)}-${p(d.d)}`
  }
  if (v instanceof Date) {
    return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())).toISOString().slice(0, 10)
  }
  // 양식 가이드 4번이 허용한 'YYYY-MM-DD' 텍스트 — 달력에 있는 날짜만(2026-02-30 은 null). 그 밖의 문자열은 종전대로 null.
  if (typeof v === 'string') {
    const m = ISO_DATE_TEXT.exec(v.trim())
    if (!m) return null
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
    const dt = new Date(Date.UTC(y, mo - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? m[0] : null
  }
  return null
}
/** 숫자 또는 숫자 문자열 → number. 빈 칸·그 밖의 값은 null. */
function toNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN)
  return Number.isFinite(n) ? n : null
}

function cellStr(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}
function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** 아웃라인 코드 패턴 — detect.ts 의 OUTLINE_RE 와 동일(export 되어 있지 않아 복제). */
const OUTLINE_RE = /^\d+([.\-]\d+)*$/

/** teamColumns 해석 — 마크 방식(ownerMarks 사전 조회)과 팀명 직접 방식([[c,'*']], 콤마 분리,
 *  첫 팀 primary·나머지 support)을 모두 지원한다(§6.3 규칙 6 / Task4 구현 규칙). */
function parseOwners(row: unknown[], profile: ExcelProfile): ParsedRowN['owners'] {
  const out: ParsedRowN['owners'] = []
  for (const [col, label] of profile.teamColumns) {
    const raw = String(row[col] ?? '').trim()
    if (raw === '') continue
    if (label === TEAM_DIRECT_MARK) {
      const teams = raw.split(',').map(s => s.trim()).filter(Boolean)
      teams.forEach((team, i) => out.push({ team, kind: i === 0 ? 'primary' : 'support' }))
    } else {
      const kind = profile.ownerMarks[raw]
      if (kind) out.push({ team: label, kind })
    }
  }
  return out
}

/** 가중치 칸 → { 값, % 서식 여부 }. 빈 칸·숫자가 아닌 글자는 null(종전대로). '50%' 글자는 엑셀의 % 서식 칸과 같은 뜻(0.5)으로 읽는다 */
function weightCell(v: unknown, percentFormat: boolean): ImportedWeightCell | null {
  if (typeof v === 'string' && v.trim().endsWith('%')) {
    const n = toNum(v.trim().slice(0, -1))
    return n === null ? null : { value: n / 100, percentFormat: true }
  }
  const n = toNum(v)
  return n === null ? null : { value: n, percentFormat }
}

/** 이름(계층) 칸이 빈 행에 "읽을 값"이 있는가 — 양식이 읽는 칸(논리 열·팀 열·사용자 정의 열)만 본다. 양식 밖의 칸(비고·합계 줄·메모)은
 *  어차피 읽지 않는 글자라 값으로 치지 않는다 */
function hasMappedValue(r: unknown[], profile: ExcelProfile): boolean {
  const cols = [
    ...Object.values(profile.logical).filter((c): c is number => c !== null && c !== undefined),
    ...profile.teamColumns.map(([c]) => c),
    ...(profile.customColumns ?? []).map(([c]) => c),
  ]
  return cols.some((c) => !isBlankCell(r[c]))
}

export const ERR_NAME_BLANK = '작업명이 비어 있습니다'
export const ERR_OUTLINE_CODE_BLANK = '아웃라인 코드가 비어 있습니다'

/**
 * 반환의 rowErrors·skippedRows(BUG-33) — 이름(계층) 칸이 빈 행의 처리:
 *  · 양식이 읽는 칸에 값이 있으면(날짜·산출물·가중치…) 그 행은 **오류**다('엑셀 N행: 작업명이 비어 있습니다'). 조용히 버리면 사용자는
 *    그 줄이 들어갔다고 믿는다.
 *  · 읽는 칸이 전부 비었으면(양식 밖 메모만 있는 줄) 데이터가 아니다 — 건너뛰고 그 수(skippedRows)를 결과에 보인다.
 *  · 칸이 전부 빈 줄은 SheetJS 가 행으로 주지 않는다(세지 않는다).
 * rowErrors 가 있어도 ok: true 다 — 호출부가 링크 오류(linkByDepth)와 한 표로 모아 보인다.
 * 가중치는 저장 단위(분수 — 1 = 100%)로 바꿔 돌려준다(wbsValueRules.ts 의 importedWeightScale).
 */
export function parseWithProfile(
  buf: ArrayBuffer,
  profile: ExcelProfile,
): { ok: true; rows: ParsedRowN[]; holidays: { date: string; name: string }[]; rowErrors: ImportError[]; skippedRows: number }
  | { ok: false; error: string } {
  if (!isXlsxBuffer(buf)) return { ok: false, error: NOT_XLSX_ERROR }
  let wb: XLSX.WorkBook
  try {
    // cellDates:false — 날짜를 시리얼(정수)로 유지해 toIso 에서 타임존 무관 변환(위 참조).
    // cellNF:true — 셀의 number format 서식 코드(z)를 보존해 날짜/숫자 판별에 활용.
    wb = XLSX.read(buf, { type: 'array', cellDates: false, cellNF: true })
  } catch {
    return { ok: false, error: '워크북을 읽을 수 없습니다' }
  }

  const ws = wb.Sheets[profile.sheetName]
  // 시트명이 프로파일과 다르면 명시 에러(§6.1 — 구 파서의 '조용한 count:0' 문제를 여기서 되풀이하지 않는다).
  if (!ws) return { ok: false, error: `시트를 찾을 수 없습니다: ${profile.sheetName}` }
  // 행 순번(headerRow 의 기준)은 빈 행을 뺀 것이고, 오류에 싣는 행 번호는 엑셀의 실제 번호다(readSheetRows)
  const { aoa, excelRows } = readSheetRows(ws)

  const rows: ParsedRowN[] = []
  const rowErrors: ImportError[] = []
  let skippedRows = 0
  /** rows 와 같은 순서의 가중치 원본 — 파일의 배율을 정한 뒤 한꺼번에 저장 단위로 바꾼다 */
  const weightCells: (ImportedWeightCell | null)[] = []
  /** 이름 칸이 빈 행 — 읽는 칸에 값이 있으면 오류, 없으면 건너뜀 */
  const blankNameRow = (r: unknown[], excelRow: number, message: string) => {
    if (hasMappedValue(r, profile)) rowErrors.push({ excelRow, message })
    else skippedRows++
  }
  const dataStart = profile.headerRow + 1
  for (let i = dataStart; i < aoa.length; i++) {
    const r = (aoa[i] ?? []) as unknown[]
    const excelRow = excelRows[i]

    let depth: number
    let name: string
    // outline 모드에서만 쓰인다 — 코드 열이 별도 지정되지 않았을 때 이 값을 code 후보로 쓴다.
    let outlineCode: string | null = null

    if (profile.hierarchy.kind === 'columns') {
      const cols = profile.hierarchy.columns
      const filledIdx: number[] = []
      cols.forEach((c, idx) => { if (!isBlankCell(r[c])) filledIdx.push(idx) })
      if (filledIdx.length === 0) { blankNameRow(r, excelRow, ERR_NAME_BLANK); continue }
      if (filledIdx.length >= 2) {
        // 2개 이상 채워짐 = 구조 오류. 단일 문자열 에러라 전체 파싱을 중단한다(행 번호는 메시지에 포함).
        return { ok: false, error: `${excelRow}행: 계층 열에 값이 2개 이상 채워짐(깊이를 판정할 수 없음)` }
      }
      depth = filledIdx[0]
      name = String(r[cols[depth]] ?? '').trim()
    } else {
      const raw = String(r[profile.hierarchy.column] ?? '').trim()
      // 리뷰 픽스: profile.logical.name 이 정본이다 — 명시 지정이 있으면 그 열을 쓴다. 지정이 없는 양식(이름 열 필드가 생기기 전에 저장된
      // 아웃라인 양식)은 '코드 열 바로 오른쪽 열' 관례로 읽는다 — 감지기는 이 관례로 추정하지 않는다(BUG-07: 못 찾으면 사용자가 고른다)
      const nameCol = profile.logical.name ?? (profile.hierarchy.column + 1)
      name = String(r[nameCol] ?? '').trim()
      if (raw === '') { blankNameRow(r, excelRow, name ? ERR_OUTLINE_CODE_BLANK : ERR_NAME_BLANK); continue }
      if (!OUTLINE_RE.test(raw)) {
        return { ok: false, error: `${excelRow}행: 아웃라인 코드 형식이 아님 — "${raw}"` }
      }
      // 깊이 = 구분자 수(0-based). '1' → 0, '1.1' → 1, '1.1.1.1' → 3.
      depth = (raw.match(/[.\-]/g) ?? []).length
      outlineCode = raw
      // 코드는 있는데 이름이 없는 행 — 이름 없는 항목을 만들지 않는다
      if (name === '') { rowErrors.push({ excelRow, message: ERR_NAME_BLANK }); continue }
    }

    let code: string | null = null
    if (profile.logical.code !== null) {
      code = cellStr(r[profile.logical.code])
    } else if (outlineCode !== null) {
      code = outlineCode
    }

    let custom: Record<string, unknown> | undefined
    if (profile.customColumns && profile.customColumns.length > 0) {
      const cMap: Record<string, unknown> = {}
      for (const [col, key] of profile.customColumns) {
        const raw = r[col]
        if (!isBlankCell(raw)) {
          const cellObj = ws[XLSX.utils.encode_cell({ r: excelRow - 1, c: col })]
          const isDateCell = cellObj && (cellObj.t === 'd' || (typeof cellObj.z === 'string' && XLSX.SSF.is_date(cellObj.z)))
          if (isDateCell || raw instanceof Date) {
            const iso = toIso(raw)
            if (iso) cMap[key] = iso
          } else if (typeof raw === 'number' || typeof raw === 'boolean') {
            cMap[key] = raw
          } else {
            const s = String(raw).trim()
            if (ISO_DATE_TEXT.test(s)) {
              const iso = toIso(s)
              cMap[key] = iso ?? s
            } else {
              cMap[key] = s
            }
          }
        }
      }
      if (Object.keys(cMap).length > 0) {
        custom = cMap
      }
    }

    rows.push({
      depth,
      code,
      name,
      extraAxis: profile.logical.extraAxis !== null ? cellStr(r[profile.logical.extraAxis]) : null,
      deliverable: profile.logical.deliverable !== null ? cellStr(r[profile.logical.deliverable]) : null,
      plannedStart: profile.logical.start !== null ? toIso(r[profile.logical.start]) : null,
      plannedEnd: profile.logical.end !== null ? toIso(r[profile.logical.end]) : null,
      weight: null,   // 아래에서 파일의 배율로 채운다
      actualPct: profile.logical.actualPct !== null ? toNum(r[profile.logical.actualPct]) : null,
      owners: parseOwners(r, profile),
      custom,
      excelRow,
    })
    const wCol = profile.logical.weight
    weightCells.push(wCol !== null ? weightCell(r[wCol], isPercentCell(ws, excelRow, wCol)) : null)
  }

  // 가중치 — 파일 하나에 배율 하나(형제 비율 보존). 저장 단위는 분수(1 = 100%)다
  const scale = importedWeightScale(weightCells.filter((c): c is ImportedWeightCell => c !== null))
  rows.forEach((row, idx) => {
    const cell = weightCells[idx]
    row.weight = cell === null ? null : importedWeightToFraction(cell, scale)
  })

  const holidays = readHolidaySheet(wb, profile.holidaySheetName)

  return { ok: true, rows, holidays, rowErrors, skippedRows }
}

/** Holiday 시트 — 첫 열이 날짜인 행만(toIso 가 날짜로 읽는 것). 시트 이름이 없거나 시트가 없으면 [] */
export function readHolidaySheet(wb: XLSX.WorkBook, sheetName: string | null): { date: string; name: string }[] {
  const holidays: { date: string; name: string }[] = []
  if (!sheetName) return holidays
  const hs = wb.Sheets[sheetName]
  if (!hs) return holidays
  for (const r of XLSX.utils.sheet_to_json<unknown[]>(hs, { header: 1, blankrows: false })) {
    const iso = toIso(r[0])
    if (iso) holidays.push({ date: iso, name: String(r[1] ?? '').trim() })
  }
  return holidays
}

/** 미리보기용(가져오기 감지 — SP5 D7) — 실행과 같은 읽기 규칙(cellDates:false). 워크북을 못 읽으면 null */
export function readHolidaysFromBuffer(buf: ArrayBuffer, sheetName: string | null): { date: string; name: string }[] | null {
  if (!isXlsxBuffer(buf)) return null
  let wb: XLSX.WorkBook
  try { wb = XLSX.read(buf, { type: 'array', cellDates: false }) } catch { return null }
  return readHolidaySheet(wb, sheetName)
}

/** hierarchy 가 columns 이고 정확히 3열이면 레거시(phase/task/activity) 라벨을 쓴다(레거시 호환).
 *  linkByDepth 는 rows 만 받는 함수라(Task4 인터페이스) profile 을 모른다 — 이 판정은 profile 을
 *  아는 호출부(라운드트립 테스트·향후 Task6 실행 라우트)가 미리 계산해 opts 로 넘긴다. */
export function resolveLegacyLevelLabels(profile: ExcelProfile): boolean {
  return profile.hierarchy.kind === 'columns' && profile.hierarchy.columns.length === 3
}

const LEGACY_LEVELS = ['phase', 'task', 'activity'] as const

/** N단 스택 링킹 + 코드 채번(코드 열 값 있으면 그대로, 없으면 형제 순번 경로 '1'·'1.1'·'1.1.2')
 *  → ImportItem[](validate.ts 의 타입 재사용). `lastAtDepth[d]` 배열은 깊이마다 직전 항목을 기억하는
 *  스택이다 — 각 행의 부모는 한 단계 얕은 깊이의 직전 항목이다(설계 §4.4). */
export function linkByDepth(
  rows: ParsedRowN[],
  opts?: { legacyLevelLabels?: boolean },
): { ok: true; items: ImportItem[] } | { ok: false; errors: ImportError[] } {
  const legacyLevelLabels = opts?.legacyLevelLabels ?? false
  const errors: ImportError[] = []
  const items: ImportItem[] = []
  const lastAtDepth: (string | null)[] = []   // depth d 에서 가장 최근에 링크된 항목의 tempId
  const siblingCount: number[] = []           // depth d 에서의 1-based 형제 순번(채번용)
  let prevDepth = -1                          // 직전에 성공적으로 처리된 행의 깊이(첫 행은 0 이어야 함)
  let order = 0

  rows.forEach((r, i) => {
    const { plannedStart: s, plannedEnd: e, depth: d } = r
    if ((s && !e) || (!s && e)) errors.push({ excelRow: r.excelRow, message: '시작/종료일 중 하나만 입력됨' })
    if (s && e && s > e) errors.push({ excelRow: r.excelRow, message: '시작일이 종료일보다 늦음' })
    // 값 규칙 — 화면 편집과 같은 함수(wbsValueRules). 실적% 범위 밖은 DB CHECK 가 통째로 거부해 500 이 됐고(BUG-01),
    // 음수 가중치는 그대로 저장됐다(BUG-09). 가중치는 저장 단위(분수)로 와 있어 사람이 적은 수를 문구에 싣지 않는다
    if (r.actualPct !== null && actualPctViolation(r.actualPct)) {
      errors.push({ excelRow: r.excelRow, message: `실적%는 0~100 범위여야 합니다(입력값 ${r.actualPct})` })
    }
    if (r.weight !== null && weightViolation(r.weight)) {
      errors.push({ excelRow: r.excelRow, message: '가중치는 0 이상이어야 합니다' })
    }

    // depth 가 스택보다 2단 이상 점프하면 부모를 특정할 수 없다(중간 깊이 행 누락).
    if (d > prevDepth + 1) {
      errors.push({ excelRow: r.excelRow, message: `깊이 건너뜀(${prevDepth}단 → ${d}단)` })
    }

    const tempId = `t${i}`
    const parentTempId = d === 0 ? null : (lastAtDepth[d - 1] ?? null)

    // 형제 순번 경로 채번: 이 depth 의 카운터를 올리고, 더 깊은 카운터는 새 서브트리 시작이므로 버린다.
    siblingCount[d] = (siblingCount[d] ?? 0) + 1
    siblingCount.length = d + 1
    const autoCode = Array.from({ length: d + 1 }, (_, idx) => siblingCount[idx] ?? 1).join('.')

    let code = r.code
    if (code !== null) {
      if (code.length > 60) errors.push({ excelRow: r.excelRow, message: `코드 길이가 60자를 초과함: "${code}"` })
    } else {
      code = autoCode
    }

    const level = legacyLevelLabels ? (LEGACY_LEVELS[d] ?? 'activity') : 'activity'

    items.push({
      tempId, parentTempId, level,
      code, sortOrder: order++, name: r.name, biz: r.extraAxis, deliverable: r.deliverable,
      plannedStart: s, plannedEnd: e, weight: r.weight, actualPct: r.actualPct,
      owners: r.owners, isOwnerSplit: false,
      ...(r.custom ? { custom: r.custom } : {}),
    })

    lastAtDepth[d] = tempId
    prevDepth = d
  })

  if (errors.length) return { ok: false, errors }
  return { ok: true, items }
}
