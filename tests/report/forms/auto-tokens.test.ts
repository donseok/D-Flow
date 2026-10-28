// 자리표시자 없는 주간보고 PPT 양식의 표 자동 연결(계획 2026-10-28-weekly-form-auto-tokens.md).
// 머리글 낱말·열 너비·가로 병합으로 "구분 | 실적 | 계획" 표를 찾아 첫 데이터 행에 {{#rows sections}} 토큰을 넣는다.
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { autoTokenizeTemplate } from '@/lib/report/forms/autoTokens'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { renderPptx } from '@/lib/report/engine/pptx'
import type { CatalogModel } from '@/lib/report/catalog/types'
import type { RenderOptions } from '@/lib/report/engine/types'

const options: RenderOptions = { max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)' }

type Cell = { text?: string | string[]; span?: number; hMerge?: boolean; rowSpan?: number; vMerge?: boolean }
type Row = { h: number; cells: Cell[] }

function cell(c: Cell): string {
  const attrs = [
    c.span ? ` gridSpan="${c.span}"` : '', c.hMerge ? ' hMerge="1"' : '', c.rowSpan ? ` rowSpan="${c.rowSpan}"` : '', c.vMerge ? ' vMerge="1"' : '',
  ].join('')
  const texts = c.text === undefined ? [] : Array.isArray(c.text) ? c.text : [c.text]
  const paras = texts.length
    ? texts.map((t) => `<a:p><a:pPr algn="l"/><a:r><a:rPr lang="ko-KR" sz="900" b="0"/><a:t>${t}</a:t></a:r></a:p>`).join('')
    : '<a:p><a:endParaRPr lang="ko-KR" sz="900"/></a:p>'
  return `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${paras}</a:txBody><a:tcPr anchor="ctr"/></a:tc>`
}

function table(id: number, cols: number[], rows: Row[]): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="표 ${id}"/></p:nvGraphicFramePr>`
    + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/>`
    + `<a:tblGrid>${cols.map((w) => `<a:gridCol w="${w}"/>`).join('')}</a:tblGrid>`
    + rows.map((r) => `<a:tr h="${r.h}">${r.cells.map(cell).join('')}</a:tr>`).join('')
    + `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

const title = (id: number, text: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="제목"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr lang="ko-KR"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`

const slide = (body: string) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`

async function pack(slides: string[]): Promise<Uint8Array> {
  const zip = new JSZip()
  const ids = slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/presentation.xml', `<p:presentation><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships>${slides.map((_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`)
  slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml))
  return zip.generateAsync({ type: 'uint8array' })
}

async function slideXml(bytes: Uint8Array, n: number): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  return (await zip.file(`ppt/slides/slide${n}.xml`)!.async('string'))
}

function cellTexts(rowXml: string): string[] {
  return [...rowXml.matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((m) => [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join('\n'))
}
function rows(xml: string): string[] { return [...xml.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((m) => m[0]) }

/** 부산운영팀 양식의 5번 슬라이드 꼴 — 머리글 2행(세로 병합·"일시" 가로 병합), 데이터 행 1개 + 표본 행 1개 */
const busanTable = () => table(7, [654681, 3695674, 3699934, 668866, 624418], [
  { h: 232392, cells: [
    { text: '구분', rowSpan: 2 }, { text: '전주 (41,42주차, 10/05~10/16)', rowSpan: 2 }, { text: '금주 (43주차, 10/19~10/23)', rowSpan: 2 },
    { text: '일시', span: 2 }, { hMerge: true },
  ] },
  { h: 232392, cells: [{ vMerge: true }, { vMerge: true }, { vMerge: true }, { text: 'From' }, { text: 'To' }] },
  { h: 4521115, cells: [
    { text: '부산운영팀' }, { text: ['[MES/APS공통] 보세공장 전환', '- 모니터링 및 안정화'] }, { text: '[생산계획] 운영계 반영' }, { text: '26/01/01' }, { text: '26/12/31' },
  ] },
  { h: 300000, cells: [{ text: '표본' }, { text: '표본 실적' }, { text: '표본 계획' }, {}, {}] },
])

/** 요일 격자 — "전주/금주" 가 월~금 위의 그룹 머리글(gridSpan), 열이 좁다. 주간 내용 표로 보면 안 된다. */
const dayGridTable = () => table(8, [971750, 4498449, ...Array(10).fill(208280), ...Array(5).fill(391685)], [
  { h: 218565, cells: [
    { text: '구분', rowSpan: 2 }, { text: '내용', rowSpan: 2 }, { text: '전주 (10/05~10/16)', span: 10 }, ...Array(9).fill({ hMerge: true }),
    { text: '금주 (10/19~10/23)', span: 5 }, ...Array(4).fill({ hMerge: true }),
  ] },
  { h: 121022, cells: [{ vMerge: true }, { vMerge: true }, ...['월', '화', '수', '목', '금', '월', '화', '수', '목', '금', '월', '화', '수', '목', '금'].map((d) => ({ text: d }))] },
  { h: 117594, cells: [{ text: '휴가' }, { text: '연차(홍길동)' }, ...Array(15).fill({})] },
])

const weekly = (sections: { name: string; this_content: string[]; next_content: string[] }[]) =>
  ({ report: { project_name: '부산운영팀' }, kpi: {}, sections }) as unknown as CatalogModel

describe('autoTokenizeTemplate — 주간 PPT 표 자동 연결', () => {
  it('"구분 | 전주 | 금주" 표의 첫 데이터 행에 토큰을 넣고 표본 행을 지우고 행 높이를 머리글에 맞춘다', async () => {
    const bytes = await pack([slide(title(2, '본부 주요 업무') + busanTable())])
    const r = await autoTokenizeTemplate(bytes, 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.detection).toEqual({
      slide: 1,
      columns: { name: 0, this: 1, next: 2 },
      headers: { name: '구분', this: '전주 (41,42주차, 10/05~10/16)', next: '금주 (43주차, 10/19~10/23)' },
      removedRows: 1,
    })
    const xml = await slideXml(r.bytes, 1)
    const trs = rows(xml)
    expect(trs).toHaveLength(3)
    expect(cellTexts(trs[0])).toEqual(['구분', '전주 (41,42주차, 10/05~10/16)', '금주 (43주차, 10/19~10/23)', '일시', ''])
    expect(cellTexts(trs[2])).toEqual(['{{#rows sections}}{{.name}}', '{{.this_content}}', '{{.next_content}}', '26/01/01', '26/12/31'])
    expect(/<a:tr h="232392">/.test(trs[2])).toBe(true)
    // 토큰 런은 원래 첫 런의 서식을 입고, 머리글·일시 칸은 그대로다
    expect(trs[2]).toContain('<a:rPr lang="ko-KR" sz="900" b="0"/><a:t>{{.this_content}}</a:t>')
    expect(trs[2]).toContain('<a:tcPr anchor="ctr"/>')
    expect(xml).toContain('본부 주요 업무')
    // 엔진 스캔은 rows 블록 안의 상대 토큰 세 개를 그 표 그 행에서 본다
    const scanned = await scanFormTemplate(r.bytes, 'pptx')
    expect(scanned.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(scanned.placeholders.map((p) => [p.token, p.kind, p.scope, p.location.table])).toEqual([
      ['{{#rows sections}}', 'rows', [], { row: 2, col: 0 }],
      ['{{.name}}', 'value', ['{{#rows sections}}'], { row: 2, col: 0 }],
      ['{{.this_content}}', 'value', ['{{#rows sections}}'], { row: 2, col: 1 }],
      ['{{.next_content}}', 'value', ['{{#rows sections}}'], { row: 2, col: 2 }],
    ])
  })

  it('"금주 실적 | 차주 계획" 과 "금주 | 차주" 는 실적·계획 낱말, 없으면 기간 순서로 고른다', async () => {
    const explicit = table(7, [1000000, 4000000, 4000000], [
      { h: 200000, cells: [{ text: '업무 영역' }, { text: '차주 계획' }, { text: '금주 실적' }] },
      { h: 1000000, cells: [{ text: 'MES' }, { text: '다음 주' }, { text: '이번 주' }] },
    ])
    const r1 = await autoTokenizeTemplate(await pack([slide(explicit)]), 'weekly_report_pptx')
    expect(r1.changed && r1.detection.columns).toEqual({ name: 0, this: 2, next: 1 })

    const period = table(7, [1000000, 4000000, 4000000], [
      { h: 200000, cells: [{ text: '팀' }, { text: '금주' }, { text: '차주' }] },
      { h: 1000000, cells: [{ text: 'MES' }, {}, {}] },
    ])
    const r2 = await autoTokenizeTemplate(await pack([slide(period)]), 'weekly_report_pptx')
    expect(r2.changed && r2.detection.columns).toEqual({ name: 0, this: 1, next: 2 })
    if (!r2.changed) return
    // 빈 칸은 endParaRPr 로 런을 만든다 — PowerPoint 가 복구 창을 띄우지 않게 문단 하나·런 하나
    const data = rows(await slideXml(r2.bytes, 1))[1]
    expect(data).toContain('<a:r><a:rPr lang="ko-KR" sz="900"/><a:t>{{.this_content}}</a:t></a:r>')
  })

  it('요일 격자는 건너뛰고 뒤 슬라이드의 넓은 표를 고른다 — 격자만 있으면 표를 못 찾은 것이다', async () => {
    const both = await autoTokenizeTemplate(await pack([slide(dayGridTable()), slide(busanTable())]), 'weekly_report_pptx')
    expect(both.changed && both.detection.slide).toBe(2)
    if (both.changed) expect(await slideXml(both.bytes, 1)).not.toContain('{{')
    const only = await autoTokenizeTemplate(await pack([slide(dayGridTable())]), 'weekly_report_pptx')
    expect(only).toEqual({ changed: false, reason: 'no_table' })
  })

  it('이미 토큰이 있는 양식·다른 종류·표 없음·이름 열 없음은 바꾸지 않는다', async () => {
    const tokened = await pack([slide(title(2, '{{report.project_name}}') + busanTable())])
    expect(await autoTokenizeTemplate(tokened, 'weekly_report_pptx')).toEqual({ changed: false, reason: 'has_tokens' })
    const plain = await pack([slide(title(2, '본부 주요 업무') + busanTable())])
    expect(await autoTokenizeTemplate(plain, 'issue_analysis_pptx')).toEqual({ changed: false, reason: 'unsupported_kind' })
    expect(await autoTokenizeTemplate(await pack([slide(title(2, '표지'))]), 'weekly_report_pptx')).toEqual({ changed: false, reason: 'no_table' })
    const noName = table(7, [4000000, 4000000], [
      { h: 200000, cells: [{ text: '금주 실적' }, { text: '차주 계획' }] },
      { h: 1000000, cells: [{}, {}] },
    ])
    expect(await autoTokenizeTemplate(await pack([slide(noName)]), 'weekly_report_pptx')).toEqual({ changed: false, reason: 'no_table' })
  })

  it('자동 연결한 양식은 기존 엔진이 영역별 행으로 채우고 5행을 넘으면 다음 슬라이드로 잇는다', async () => {
    const r = await autoTokenizeTemplate(await pack([slide(title(2, '표지')), slide(title(2, '본부 주요 업무') + busanTable())]), 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    const sections = Array.from({ length: 7 }, (_, i) => ({ name: `영역${i + 1}`, this_content: [`실적${i + 1}-1`, `실적${i + 1}-2`], next_content: [`계획${i + 1}`] }))
    const out = await renderPptx(r.bytes, weekly(sections), {}, options)
    const zip = await JSZip.loadAsync(out)
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort()
    expect(slides).toHaveLength(3)
    const texts = await Promise.all(slides.map((n) => zip.file(n)!.async('string')))
    const filled = texts.filter((x) => x.includes('영역1') || x.includes('영역6'))
    expect(filled).toHaveLength(2)
    const first = texts.find((x) => x.includes('영역1'))!
    expect(rows(first)).toHaveLength(2 + 5)
    expect(cellTexts(rows(first)[2])).toEqual(['영역1', '실적1-1\n실적1-2', '계획1', '26/01/01', '26/12/31'])
    // 이어지는 슬라이드는 남은 2행만 — '(계속)' 표기는 양식에 {{slide.continuation}} 토큰이 있을 때만 찍힌다
    expect(rows(texts.find((x) => x.includes('영역6'))!)).toHaveLength(2 + 2)
    for (const x of texts) expect(x).not.toContain('{{')
  })
})
