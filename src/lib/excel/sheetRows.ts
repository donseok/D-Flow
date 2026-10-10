// 엑셀 파일·시트 읽기의 공통 바닥(BUG-04·01) — 감지기(detect.ts)와 파서(parseWithProfile.ts)가 같이 쓴다.
import * as XLSX from 'xlsx'

/** 엑셀(.xlsx)이 아닌 파일 — 화면에 그대로 보이는 문구 */
export const NOT_XLSX_ERROR = '유효한 엑셀(.xlsx) 파일이 아닙니다'

/** .xlsx 는 ZIP 묶음이다 — 첫 4바이트가 로컬 파일 머리(PK\x03\x04)인지 본다.
 *  SheetJS 는 ZIP 이 아닌 내용을 CSV·평문으로 **읽어 준다**(오류가 아니다) — 확장자만 .xlsx 인 글자 파일이 본문 글자를 열 이름으로 삼은
 *  "양식"이 되어 0건 성공·양식 저장까지 갔다(BUG-04). 읽기 전에 여기서 막는다. 빈 ZIP(PK\x05\x06)·옛 .xls(OLE)도 엑셀 통합 문서가 아니다 */
export function isXlsxBuffer(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false
  const b = new Uint8Array(buf, 0, 4)
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
}

/** 시트의 값이 있는 행들과 그 행의 **엑셀 행 번호**(1부터).
 *  빈 행은 뺀다(sheet_to_json 의 blankrows:false 와 같은 행 집합 — 양식의 headerRow 는 이 압축된 순번이다). 다만 순번만으로 행 번호를 세면
 *  빈 행 뒤의 오류가 엉뚱한 줄을 가리킨다("엑셀 7행" 인데 실제는 9행) — 행 오류는 사람이 그 줄을 찾아 고치라는 말이라 실제 번호를 같이 돌려준다 */
export function readSheetRows(ws: XLSX.WorkSheet | undefined): { aoa: unknown[][]; excelRows: number[] } {
  if (!ws || ws['!ref'] == null) return { aoa: [], excelRows: [] }
  const first = XLSX.utils.decode_range(ws['!ref']).s.r
  const full = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true })
  const aoa: unknown[][] = []
  const excelRows: number[] = []
  full.forEach((row, i) => {
    // SheetJS 의 빈 행 판정과 같다 — 값(null 아님)이 하나도 없는 행. 구멍(sparse)은 some 이 건너뛴다
    if (!row.some((v) => v != null)) return
    aoa.push(row)
    excelRows.push(first + i + 1)
  })
  return { aoa, excelRows }
}

/** 그 칸이 % 서식인가(엑셀이 0.5 를 50% 로 보인다) — 워크북을 cellNF:true 로 읽었을 때만 서식(z)이 온다 */
export function isPercentCell(ws: XLSX.WorkSheet, excelRow: number, col: number): boolean {
  const cell = ws[XLSX.utils.encode_cell({ r: excelRow - 1, c: col })] as XLSX.CellObject | undefined
  return typeof cell?.z === 'string' && cell.z.includes('%')
}

/** 그 칸이 날짜 서식의 수인가(엑셀 날짜는 일련번호 + 날짜 서식이다) */
export function isDateCell(ws: XLSX.WorkSheet, excelRow: number, col: number): boolean {
  const cell = ws[XLSX.utils.encode_cell({ r: excelRow - 1, c: col })] as XLSX.CellObject | undefined
  if (!cell) return false
  return cell.t === 'd' || (cell.t === 'n' && typeof cell.z === 'string' && XLSX.SSF.is_date(cell.z))
}
