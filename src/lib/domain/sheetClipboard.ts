/* ── 셀 격자 ↔ TSV 직렬화(순수) — 구글시트/엑셀 상호 호환. I/O 없음. ── */

/** 셀에 탭·개행·따옴표가 있으면 인용 필요(그 외는 그대로). */
function needsQuote(cell: string): boolean {
  return /[\t\n\r"]/.test(cell)
}

/** 한 셀 직렬화 — 인용 시 `"…"`로 감싸고 내부 `"`는 `""`로 이스케이프. */
function serializeCell(cell: string): string {
  return needsQuote(cell) ? `"${cell.replace(/"/g, '""')}"` : cell
}

/** 셀 격자(행 우선) → TSV. 행 구분 `\n`, 열 구분 `\t`. */
export function serializeTsv(cells: string[][]): string {
  return cells.map(row => row.map(serializeCell).join('\t')).join('\n')
}

/**
 * TSV → 셀 격자(행 우선). 따옴표/멀티라인 셀 존중.
 * - `\r\n`·단독 `\r`은 행 경계로 정규화(단, 인용 안의 `\r`/`\n`은 셀 내용으로 보존).
 * - `"`로 시작하는 필드는 인용 필드: 닫는 `"`까지 읽되 `""`는 리터럴 `"`로 해제.
 * - 후행 개행 1개는 빈 행을 만들지 않는다(엑셀/시트 복사본 말미 `\n` 대응).
 * - 반환은 직사각형 보장 안 함 — 소비자(pasteEdits)가 앵커 기준으로 clip.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let lastWasRowSep = false // 후행 개행 판정 — 마지막 처리가 행 구분이면 EOF 플러시 생략
  const n = text.length
  let i = 0

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue } // 이스케이프된 따옴표
        inQuotes = false; i++; continue                             // 인용 종료
      }
      field += ch; i++; continue // 인용 안의 \t·\n·\r는 셀 내용
    }
    if (ch === '"' && field === '') { inQuotes = true; lastWasRowSep = false; i++; continue } // 필드 선두 따옴표만 인용 시작
    if (ch === '\t') { row.push(field); field = ''; lastWasRowSep = false; i++; continue }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = ''; rows.push(row); row = []; lastWasRowSep = true
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1 // \r\n은 한 경계로
      continue
    }
    field += ch; lastWasRowSep = false; i++
  }

  // 마지막 필드/행 플러시 — 단, 텍스트가 행 구분으로 끝났으면(후행 개행) 빈 행을 만들지 않는다.
  if (!(lastWasRowSep && field === '' && row.length === 0)) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 시트가 쓴 복사본의 표식 형식 — 한 열 여러 행의 복사본은 일반 여러 줄 텍스트와 text/plain 모양이 같아서 이것으로 가른다. */
export const SHEET_CLIPBOARD_TYPE = 'application/x-dflow-sheet'

/**
 * 붙여넣을 클립보드 → 셀 격자. 표에서 온 복사본만 TSV 로 펼친다 — 시트 표식, 탭(여러 열), HTML 표(엑셀·구글시트의 한 열 복사).
 * 그 밖의 일반 텍스트(셀 안에서 긁어 복사한 여러 줄 등)는 줄바꿈을 품은 **한 셀**이다 — 줄마다 아래 행으로 펼치지 않고,
 * 따옴표도 인용으로 읽지 않는다. 줄 끝은 `\n` 으로 맞추고 끝의 빈 줄은 버린다.
 */
export function cellsFromClipboard(text: string, src: { types: readonly string[]; html: string }): string[][] {
  if (src.types.includes(SHEET_CLIPBOARD_TYPE) || text.includes('\t') || /<table[\s>]/i.test(src.html)) return parseTsv(text)
  return [[text.replace(/\r\n?/g, '\n').replace(/\n+$/, '')]]
}
