import type { WbsBulkChanges, WbsBulkSnapshotRow, WbsBulkTarget } from './wbsBulk'

export const WBS_PASTE_FIELDS = ['deliverable', 'plannedStart', 'plannedEnd', 'biz'] as const
export type WbsPasteField = typeof WBS_PASTE_FIELDS[number]
export type WbsPasteOperation = { target: WbsBulkTarget; name: string; changes: WbsBulkChanges }

/** TSV 셀을 읽는다. Excel의 인용 셀(탭·줄바꿈·따옴표 포함)도 한 칸으로 유지한다. */
export function parseWbsTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], value = '', quoted = false
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { value += '"'; i++ }
      else if (quoted || value === '') quoted = !quoted
      else value += char
    } else if (!quoted && (char === '\t' || char === '\n')) {
      row.push(value); value = ''
      if (char === '\n') { rows.push(row); row = [] }
    } else value += char
  }
  if (quoted) throw new Error('닫히지 않은 인용 셀이 있습니다.')
  if (value || row.length || !input.endsWith('\n')) { row.push(value); rows.push(row) }
  return rows
}

/** 서버가 확정한 표시 행·표시 열만 사용한다. 범위 초과를 잘라내지 않고 명시적으로 거부한다. */
export function previewWbsPaste(text: string, rows: WbsBulkSnapshotRow[], columns: readonly WbsPasteField[]): WbsPasteOperation[] {
  if (!text.trim()) return []
  if (text.length > 200_000) throw new Error('붙여넣기 내용이 너무 큽니다. 나누어 적용해 주세요.')
  const matrix = parseWbsTsv(text)
  if (matrix.length > 200 || matrix.length > rows.length) throw new Error('표시된 대상 행 범위를 초과했습니다. 한 번에 최대 200행까지 적용할 수 있습니다.')
  if (!columns.length || matrix.some(row => row.length > columns.length)) throw new Error('표시된 편집 가능 열 범위를 초과했습니다.')
  return matrix.map((values, index) => {
    const changes: WbsBulkChanges = {}
    values.forEach((value, col) => { changes[columns[col]] = value === '' ? { mode: 'clear' } : { mode: 'set', value } })
    return { target: { id: rows[index].id, updatedAt: rows[index].updatedAt }, name: rows[index].name, changes }
  })
}
