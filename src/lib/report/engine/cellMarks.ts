/**
 * 표 칸 표시(cell marks) — 회사 양식의 요일 격자 표(휴가/훈련 등)를 사람이 쓴 꼴로 그리기 위한 칸 단위 지시.
 * 자동 연결이 토큰 칸의 `a:tcPr/a:extLst/a:ext`(uri = CELL_MARK_URI)에 두고, 엔진이 행을 그린 뒤 처리하고 지운다.
 *
 * - fill  : 칸 글자가 비지 않으면 그 칸 바탕을 양식에서 배운 색으로 칠하고 글자를 지운다(휴가인 요일 칸).
 * - merge : 바로 위 행의 같은 열 칸과 글자가 같으면 세로로 합친다(팀 칸 — rowSpan/vMerge).
 * - rows  : 이 행 블록의 한 장당 행 수(옵션 max_rows_per_slide 대신) — 한 장에 다른 표와 같이 있는 작은 표가 장을 복제하지 않게.
 */

export const CELL_MARK_URI = '{9A3D6B21-5E7C-4B8F-A1D2-3C4E5F6A7B80}'
const NS = 'urn:d-flow:cell-marks:1'
const EXT_RE = new RegExp(`<a:ext uri="${CELL_MARK_URI.replace(/[{}-]/g, (c) => `\\${c}`)}">[\\s\\S]*?</a:ext>`)
const FILL_NAMES = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill'])

export interface CellMark { fill?: string; merge?: boolean; rows?: number }

/** 직계 자식 원소 원문 목록 — 같은 이름 중첩(a:ln 안의 a:solidFill 등)과 자기 닫힘을 깊이로 가른다 */
export function childElements(inner: string): string[] {
  const out: string[] = []
  const re = /<(\/?)([\w:]+)\b[^>]*?(\/?)>/g
  let depth = 0
  let start = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(inner))) {
    const [tag, close, , self] = m
    if (close) {
      depth -= 1
      if (depth === 0 && start >= 0) { out.push(inner.slice(start, m.index + tag.length)); start = -1 }
    } else if (self) {
      if (depth === 0) out.push(tag)
    } else {
      if (depth === 0) start = m.index
      depth += 1
    }
  }
  return out
}

const nameOf = (el: string) => /^<a:(\w+)/.exec(el)?.[1] ?? ''

/** tcPr 의 바탕(fill) 자식을 바꾼다 — fill 이 null 이면 바탕을 지운다(표 스타일을 따른다). 테두리(a:lnX) 안의 색은 건드리지 않는다. */
export function setCellFill(cellXml: string, fill: string | null): string {
  const tcPr = /<a:tcPr\b[^>]*\/>|<a:tcPr\b[^>]*>[\s\S]*?<\/a:tcPr>/.exec(cellXml)?.[0]
  if (!tcPr) return fill ? cellXml.replace(/<\/a:tc>$/, `<a:tcPr>${fill}</a:tcPr></a:tc>`) : cellXml
  const open = /^<a:tcPr\b[^>]*?(?=\/?>)/.exec(tcPr)![0]
  const inner = tcPr.endsWith('/>') ? '' : tcPr.slice(tcPr.indexOf('>') + 1, -'</a:tcPr>'.length)
  const kids = childElements(inner).filter((el) => !FILL_NAMES.has(nameOf(el)))
  // 순서: lnL·lnR·lnT·lnB·lnTlToBr·lnBlToTr·cell3D 다음이 바탕, 그 뒤 headers·extLst
  const at = kids.findIndex((el) => ['headers', 'extLst'].includes(nameOf(el)))
  if (fill) kids.splice(at < 0 ? kids.length : at, 0, fill)
  return cellXml.replace(tcPr, `${open}>${kids.join('')}</a:tcPr>`)
}

/** 칸의 바탕 원문(a:solidFill 등) — 없으면 null */
export function cellFillOf(cellXml: string): string | null {
  const tcPr = /<a:tcPr\b[^>]*>([\s\S]*?)<\/a:tcPr>/.exec(cellXml)
  if (!tcPr) return null
  return childElements(tcPr[1]).find((el) => FILL_NAMES.has(nameOf(el)) && nameOf(el) !== 'noFill') ?? null
}

/** 칸 표시를 붙인다(tcPr 의 extLst 마지막). 이미 있으면 바꾼다. */
export function attachCellMark(cellXml: string, mark: CellMark): string {
  const attrs = [mark.merge ? ' merge="1"' : '', mark.rows ? ` rows="${mark.rows}"` : ''].join('')
  const ext = `<a:ext uri="${CELL_MARK_URI}"><dfm:mark xmlns:dfm="${NS}"${attrs}>${mark.fill ?? ''}</dfm:mark></a:ext>`
  const cleaned = cellXml.replace(EXT_RE, '')
  const selfClosing = /<a:tcPr\b([^>]*)\/>/.exec(cleaned)
  if (selfClosing) return cleaned.replace(selfClosing[0], `<a:tcPr${selfClosing[1]}><a:extLst>${ext}</a:extLst></a:tcPr>`)
  if (/<a:tcPr\b[^>]*>/.test(cleaned)) {
    if (/<a:extLst>[\s\S]*?<\/a:extLst>\s*<\/a:tcPr>/.test(cleaned)) return cleaned.replace(/<\/a:extLst>(\s*<\/a:tcPr>)/, `${ext}</a:extLst>$1`)
    return cleaned.replace(/<\/a:tcPr>/, `<a:extLst>${ext}</a:extLst></a:tcPr>`)
  }
  return cleaned.replace(/<\/a:tc>$/, `<a:tcPr><a:extLst>${ext}</a:extLst></a:tcPr></a:tc>`)
}

function markOf(cellXml: string): CellMark | null {
  const ext = EXT_RE.exec(cellXml)?.[0]
  if (!ext) return null
  const open = /<dfm:mark\b([^>]*?)\/?>/.exec(ext)
  const attrs = open?.[1] ?? ''
  const body = /<dfm:mark\b[^>]*>([\s\S]*?)<\/dfm:mark>/.exec(ext)?.[1] ?? ''
  const rows = Number(/\brows="(\d+)"/.exec(attrs)?.[1] ?? '0')
  return { fill: body || undefined, merge: /\bmerge="1"/.test(attrs), rows: rows > 0 ? rows : undefined }
}

function stripMark(cellXml: string): string {
  return cellXml.replace(EXT_RE, '').replace(/<a:extLst>\s*<\/a:extLst>/, '')
}

function cellText(cellXml: string): string {
  return [...cellXml.matchAll(/<a:t>([^<]*)<\/a:t>|<a:t\b[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1] ?? m[2] ?? '').join('')
}

/**
 * 칸 글자를 지운다 — 런을 빼되 문단 끝 서식(endParaRPr)이 없으면 첫 런의 서식으로 남긴다.
 * 남기지 않으면 빈 문단이 기본 글자 크기(18pt)로 잡혀 행이 커진다.
 */
function clearText(cellXml: string): string {
  return cellXml.replace(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g, (p) => {
    const run = /<a:r\b[^>]*>[\s\S]*?<\/a:r>/.exec(p)?.[0]
    let out = p.replace(/<a:r\b[^>]*>[\s\S]*?<\/a:r>/g, '').replace(/<a:br\b[^>]*\/>/g, '')
    if (run && !/<a:endParaRPr\b/.test(out)) {
      const rPr = /<a:rPr\b([^>]*)\/>|<a:rPr\b([^>]*)>([\s\S]*?)<\/a:rPr>/.exec(run)
      if (rPr) {
        const end = rPr[3] !== undefined ? `<a:endParaRPr${rPr[2]}>${rPr[3]}</a:endParaRPr>` : `<a:endParaRPr${rPr[1]}/>`
        out = out.replace(/<\/a:p>$/, `${end}</a:p>`)
      }
    }
    return out
  })
}

/** 행 블록의 한 장당 행 수 표시 — 없으면 null */
export function rowCapOf(rowXml: string): number | null {
  if (!rowXml.includes(CELL_MARK_URI)) return null
  for (const cell of rowXml.match(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g) ?? []) {
    const rows = markOf(cell)?.rows
    if (rows) return rows
  }
  return null
}

/**
 * 그려진 행의 fill 표시 칸을 처리한다 — 글자가 있으면 배운 색으로 칠하고 글자를 지운다. merge 표시는 표 단위(mergeMarkedCells)가
 * 처리하므로 남기고, fill·rows 만 있는 표시는 지운다.
 */
export function applyCellFills(rowXml: string): string {
  if (!rowXml.includes(CELL_MARK_URI)) return rowXml
  return rowXml.replace(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g, (cell) => {
    const mark = markOf(cell)
    if (!mark) return cell
    let out = cell
    if (mark.fill) {
      // 칠하지 않는 칸도 빈 런을 지운다 — 서식 없는 빈 런이 기본 글자 크기(18pt)로 행을 키운다
      out = cellText(out).trim() ? clearText(setCellFill(out, mark.fill)) : clearText(out)
    }
    return mark.merge ? attachCellMark(out, { merge: true }) : stripMark(out)
  })
}

/** 표마다 merge 표시 칸을 위아래로 같은 글자끼리 합치고(rowSpan·vMerge) 표시를 지운다 */
export function mergeMarkedCells(xml: string): string {
  if (!xml.includes(CELL_MARK_URI)) return xml
  return xml.replace(/<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g, (tbl) => {
    if (!tbl.includes(CELL_MARK_URI)) return tbl
    const rows = [...tbl.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((m) => m[0])
    const grid = rows.map((row) => [...row.matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g)].map((m) => m[0]))
    const next = grid.map((cells) => [...cells])
    const cols = Math.max(0, ...grid.map((cells) => cells.length))
    for (let col = 0; col < cols; col += 1) {
      let r = 0
      while (r < grid.length) {
        const cell = grid[r][col]
        if (!cell || !markOf(cell)?.merge) { r += 1; continue }
        const text = cellText(cell).trim()
        let end = r + 1
        while (end < grid.length && grid[end][col] && markOf(grid[end][col])?.merge && cellText(grid[end][col]).trim() === text && text) end += 1
        const span = end - r
        next[r][col] = stripMark(span > 1
          ? cell.replace(/^<a:tc\b([^>]*)>/, (_m, a: string) => `<a:tc${a.replace(/\s(?:rowSpan|vMerge)="[^"]*"/g, '')} rowSpan="${span}">`)
          : cell)
        for (let k = r + 1; k < end; k += 1) {
          next[k][col] = stripMark(clearText(grid[k][col]).replace(/^<a:tc\b([^>]*)>/, (_m, a: string) => `<a:tc${a.replace(/\s(?:rowSpan|vMerge)="[^"]*"/g, '')} vMerge="1">`))
        }
        r = end
      }
    }
    let out = tbl
    rows.forEach((row, i) => {
      if (grid[i].every((cell, j) => cell === next[i][j])) return
      let rebuilt = row
      grid[i].forEach((cell, j) => { if (cell !== next[i][j]) rebuilt = rebuilt.replace(cell, next[i][j]) })
      out = out.replace(row, rebuilt)
    })
    return out
  })
}
