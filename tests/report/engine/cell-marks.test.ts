// 칸 표시(cellMarks) — 회사 양식의 "휴가/훈련" 요일 격자 표를 근태 기록으로 채우는 길.
// 자동 연결이 표를 찾아 토큰·칸 표시를 넣고, 엔진이 휴가 요일 칸을 양식에서 배운 색으로 칠하고 팀 칸을 세로로 합친다.
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  CELL_MARK_URI, applyCellFills, attachCellMark, cellFillOf, childElements, mergeMarkedCells, rowCapOf, setCellFill,
} from '@/lib/report/engine/cellMarks'
import { autoTokenizeTemplate } from '@/lib/report/forms/autoTokens'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { deckOrder, renderPptx } from '@/lib/report/engine/pptx'
import type { CatalogModel } from '@/lib/report/catalog/types'

const BLUE = '<a:solidFill><a:srgbClr val="4F81BD"/></a:solidFill>'
const LN = '<a:lnL w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL>'
const RPR = '<a:rPr lang="ko-KR" sz="1000"/>'
type C = { text?: string; span?: number; hMerge?: boolean; rowSpan?: number; vMerge?: boolean; fill?: string }
const tc = (c: C) => {
  const attrs = [c.span ? ` gridSpan="${c.span}"` : '', c.hMerge ? ' hMerge="1"' : '', c.rowSpan ? ` rowSpan="${c.rowSpan}"` : '', c.vMerge ? ' vMerge="1"' : ''].join('')
  const p = c.text ? `<a:p><a:pPr algn="ctr"/><a:r>${RPR}<a:t>${c.text}</a:t></a:r></a:p>` : `<a:p><a:pPr algn="ctr"/><a:endParaRPr lang="ko-KR" sz="1000"/></a:p>`
  return `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/>${p}</a:txBody><a:tcPr anchor="ctr">${LN}${c.fill ?? ''}</a:tcPr></a:tc>`
}
const tr = (h: number, cells: C[]) => `<a:tr h="${h}">${cells.map(tc).join('')}</a:tr>`
const frame = (id: number, widths: number[], rows: string[]) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="표"/></p:nvGraphicFramePr>`
  + `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid>${widths.map((w) => `<a:gridCol w="${w}"/>`).join('')}</a:tblGrid>${rows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
const sld = (body: string) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
const HD = '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>'
const day = (fill?: boolean): C => (fill ? { fill: BLUE } : {})

/** 사람이 쓴 "3. 휴가/훈련" 표 — 머리글 셋(계획 묶음·요일·날짜), 금주 요약 줄, 사람 줄 셋(팀 칸 세로 합침, 휴가 요일은 파랑) */
const leaveTable = () => frame(20, [900000, 1200000, 1800000, 200000, 200000, 200000, 200000, 200000, 4000000], [
  tr(179209, [{ text: '팀구분', rowSpan: 3, fill: HD }, { text: '구분', rowSpan: 3, fill: HD }, { text: '담당자', rowSpan: 3, fill: HD },
    { text: '계획', span: 5, fill: HD }, { hMerge: true }, { hMerge: true }, { hMerge: true }, { hMerge: true }, { text: '비고', rowSpan: 3, fill: HD }]),
  tr(179209, [{ vMerge: true }, { vMerge: true }, { vMerge: true }, ...['월', '화', '수', '목', '금'].map((d) => ({ text: d, fill: HD })), { vMerge: true }]),
  tr(179209, [{ vMerge: true }, { vMerge: true }, { vMerge: true }, ...['19', '20', '21', '22', '23'].map((d) => ({ text: d, fill: HD })), { vMerge: true }]),
  tr(266867, [{ text: '하정철 매니저(휴가 10/07), 김수형 매니저(휴가 10/12 ~ 14)', span: 9 }, ...Array(8).fill({ hMerge: true })]),
  tr(216000, [{ text: '부산운영팀', rowSpan: 3 }, { text: '휴가' }, { text: '김민준' }, day(true), day(), day(), day(), day(), {}]),
  tr(216000, [{ vMerge: true }, { text: '휴가' }, { text: '최진혁' }, day(true), day(true), day(true), day(), day(), {}]),
  tr(200304, [{ vMerge: true }, { text: '휴가' }, { text: '하정철' }, day(), day(), day(), day(), day(true), {}]),
])

/** 같은 장의 "2. 교육/출장" 격자 — 구분이 "출장및교육" 이라 휴가 표가 아니다 */
const tripTable = () => frame(21, [600000, 900000, 2400000, 1000000, ...Array(10).fill(150000)], [
  tr(170708, [{ text: '구분', rowSpan: 2, fill: HD }, { text: '팀구분', rowSpan: 2, fill: HD }, { text: '내용', rowSpan: 2, fill: HD }, { text: '담당자', rowSpan: 2, fill: HD },
    { text: '실적', span: 5, fill: HD }, ...Array(4).fill({ hMerge: true }), { text: '계획', span: 5, fill: HD }, ...Array(4).fill({ hMerge: true })]),
  tr(170708, [{ vMerge: true }, { vMerge: true }, { vMerge: true }, { vMerge: true }, ...['월', '화', '수', '목', '금', '월', '화', '수', '목', '금'].map((d) => ({ text: d }))]),
  tr(281179, [{ text: '출장및교육' }, { text: '부산운영팀' }, { text: 'PI 프로젝트 수행' }, { text: '이돈석' }, ...Array(10).fill({})]),
])

/** 주간 업무 두 열 표(자동 연결의 본 표 — 없으면 연결하지 않는다) */
const weeklyTable = () => frame(10, [4500000, 4500000], [
  tr(337135, [{ text: '금주 (2026.10.05~2026.10.16) 실적' }, { text: '차주 (2026.10.19~2026.10.23) 계획' }]),
  tr(2250347, [{ text: '[a] 한 일' }, { text: '[a] 할 일' }]),
])

async function pack(): Promise<Uint8Array> {
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const slides = [sld(weeklyTable()), sld(tripTable() + leaveTable())]
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types/>')
  zip.file('ppt/presentation.xml', `<p:presentation><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`)
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`)
  slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml))
  return zip.generateAsync({ type: 'uint8array' })
}

const rowsOf = (xml: string) => [...xml.matchAll(/<a:tr\b[^>]*>[\s\S]*?<\/a:tr>/g)].map((m) => m[0])
const cellsOf = (row: string) => [...row.matchAll(/<a:tc\b[^>]*>[\s\S]*?<\/a:tc>/g)].map((m) => m[0])
const textOf = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')
const leaveTableOf = (slide: string) => [...slide.matchAll(/<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/g)].map((m) => m[0]).find((t) => t.includes('담당자') && !t.includes('내용'))!

describe('cellMarks 기본 동작', () => {
  it('childElements 는 직계 자식만, setCellFill 은 테두리 안의 색을 두고 바탕만 바꾼다', () => {
    const cell = tc({ text: 'x', fill: BLUE })
    expect(childElements(/<a:tcPr\b[^>]*>([\s\S]*?)<\/a:tcPr>/.exec(cell)![1]).map((el) => /^<a:(\w+)/.exec(el)![1])).toEqual(['lnL', 'solidFill'])
    expect(cellFillOf(cell)).toBe(BLUE)
    const cleared = setCellFill(cell, null)
    expect(cellFillOf(cleared)).toBeNull()
    expect(cleared).toContain(LN)
    expect(cellFillOf(setCellFill(cleared, BLUE))).toBe(BLUE)
    // 확장 목록 앞에 바탕을 둔다
    const marked = attachCellMark(setCellFill(cleared, null), { rows: 3 })
    expect(setCellFill(marked, BLUE)).toMatch(/<\/a:lnL><a:solidFill>[\s\S]*<\/a:solidFill><a:extLst>/)
  })

  it('applyCellFills — 글자가 있으면 칠하고 글자를 지우되 문단 끝 서식을 남기고, 빈 칸은 빈 런만 지운다', () => {
    const on = attachCellMark(tc({ text: '연' }), { fill: BLUE })
    const off = attachCellMark(tc({ text: '' }).replace('<a:endParaRPr lang="ko-KR" sz="1000"/>', '<a:r><a:t></a:t></a:r><a:endParaRPr lang="ko-KR" sz="1000"/>'), { fill: BLUE })
    const out = applyCellFills(`<a:tr h="1">${on}${off}</a:tr>`)
    const [a, b] = cellsOf(out)
    expect(cellFillOf(a)).toBe(BLUE)
    expect(textOf(a)).toBe('')
    expect(a).toContain('<a:endParaRPr lang="ko-KR" sz="1000"/>')
    expect(cellFillOf(b)).toBeNull()
    expect(b).not.toContain('<a:r>')
    expect(out).not.toContain(CELL_MARK_URI)
  })

  it('mergeMarkedCells — 위아래 같은 글자를 rowSpan·vMerge 로 합치고, rowCapOf 는 한 장당 행 수를 읽는다', () => {
    const team = (t: string) => attachCellMark(tc({ text: t }), { merge: true, rows: 7 })
    const tbl = `<a:tbl>${['A', 'A', 'B', 'A'].map((t) => `<a:tr h="1">${team(t)}${tc({ text: t })}</a:tr>`).join('')}</a:tbl>`
    expect(rowCapOf(rowsOf(tbl)[0])).toBe(7)
    const out = mergeMarkedCells(tbl)
    const first = rowsOf(out).map((r) => cellsOf(r)[0])
    expect(first[0]).toMatch(/^<a:tc rowSpan="2">/)
    expect(first[1]).toMatch(/^<a:tc vMerge="1">/)
    expect(textOf(first[1])).toBe('')
    expect(first[2]).toMatch(/^<a:tc>/)
    expect(textOf(first[3])).toBe('A')
    expect(out).not.toContain(CELL_MARK_URI)
  })
})

describe('휴가 표 자동 연결 → 근태 기록으로 채우기', () => {
  it('휴가 표만 찾아 날짜 머리글·금주 요약·사람 줄 토큰을 넣고, 교육/출장 격자는 그대로 둔다', async () => {
    const r = await autoTokenizeTemplate(await pack(), 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.detection.leaveTable).toEqual({ slide: 2, days: 5, week: 'next' })
    const zip = await JSZip.loadAsync(r.bytes)
    const slide = await zip.file('ppt/slides/slide2.xml')!.async('string')
    const rows = rowsOf(leaveTableOf(slide))
    expect(rows).toHaveLength(5)  // 머리글 셋 + 요약 + 토큰 줄 하나(보기 사람 줄 셋은 하나로)
    expect(cellsOf(rows[2]).slice(3, 8).map(textOf)).toEqual([1, 2, 3, 4, 5].map((n) => `{{report.next_week_day${n}}}`))
    expect(textOf(cellsOf(rows[3])[0])).toBe('{{leaves.this_week_summary}}')
    expect(cellsOf(rows[4]).map(textOf)).toEqual(['{{#rows leaves.next_week}}{{.team}}', '{{.kind}}', '{{.member}}', '{{.d1}}', '{{.d2}}', '{{.d3}}', '{{.d4}}', '{{.d5}}', '{{.note}}'])
    // 토큰 줄의 요일 칸은 바탕을 비우고(칠한 보기 칸이었어도) 칠할 색을 표시로 들고 있다
    expect(cellFillOf(cellsOf(rows[4])[3])).toBeNull()
    expect(cellsOf(rows[4])[3]).toContain(BLUE)
    expect(slide).toContain('출장및교육')  // 교육/출장 표는 손대지 않는다
    const scan = await scanFormTemplate(r.bytes, 'pptx')
    expect(scan.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('휴가 요일 칸을 칠하고 팀 칸을 합치며, 줄이 많으면 장을 이어 붙인다', async () => {
    const r = await autoTokenizeTemplate(await pack(), 'weekly_report_pptx')
    if (!r.changed) throw new Error('not changed')
    const leave = (member: string, kind: string, on: number[], team = '부산운영팀') => ({
      team, kind, member, title: '', dates: '', note: '',
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`d${n}`, on.includes(n) ? kind.slice(0, 1) : ''])),
    })
    const model = (next: ReturnType<typeof leave>[]) => ({
      report: { next_week_day1: '2', next_week_day2: '3', next_week_day3: '4', next_week_day4: '5', next_week_day5: '6' },
      kpi: {}, sections: [], tasks: [],
      leaves: { this_week: [], next_week: next, this_week_summary: '하정철 매니저(연차 10/27)', next_week_summary: '' },
    }) as unknown as CatalogModel
    const options = { max_lines_per_cell: 12, max_rows_per_slide: 2, item_cap: 0, empty_text: '', continuation_label: '(계속)' }
    const out = await renderPptx(r.bytes, model([leave('김민준', '연차', [1]), leave('최진혁', '반차', [1, 2]), leave('외부인', '연차', [5], '협력사')]), {}, options)
    const zip = await JSZip.loadAsync(out)
    const slides = await Promise.all((await deckOrder(zip)).map((n) => zip.file(n)!.async('string')))
    expect(slides).toHaveLength(2)  // 휴가 줄 셋은 한 장 — 주간 표의 max_rows_per_slide(2)를 따르지 않는다
    const rows = rowsOf(leaveTableOf(slides[1]))
    expect(cellsOf(rows[2]).slice(3, 8).map(textOf)).toEqual(['2', '3', '4', '5', '6'])
    expect(textOf(cellsOf(rows[3])[0])).toBe('하정철 매니저(연차 10/27)')
    const people = rows.slice(4).map(cellsOf)
    expect(people.map((cells) => [textOf(cells[1]), textOf(cells[2])])).toEqual([['연차', '김민준'], ['반차', '최진혁'], ['연차', '외부인']])
    expect(people.map((cells) => cells.slice(3, 8).map((cell) => (cellFillOf(cell) ? '■' : '□')).join(''))).toEqual(['■□□□□', '■■□□□', '□□□□■'])
    for (const cells of people) for (const cell of cells.slice(3, 8)) {
      expect(textOf(cell)).toBe('')
      expect(cell).not.toContain('<a:r>')  // 빈 런(기본 18pt)이 행을 키우지 않게
    }
    // 같은 팀은 세로로 합치고, 다른 팀은 새로 시작
    expect(people[0][0]).toMatch(/^<a:tc rowSpan="2">/)
    expect(people[1][0]).toMatch(/^<a:tc vMerge="1">/)
    expect(textOf(people[2][0])).toBe('협력사')
    expect(slides[1]).not.toContain(CELL_MARK_URI)
    expect(slides[1]).not.toContain('{{')

    // 휴가 줄이 한 장의 행 수(10)를 넘으면 그 장을 이어 붙인다
    const many = Array.from({ length: 12 }, (_, i) => leave(`사람${i + 1}`, '연차', [1]))
    const out2 = await renderPptx(r.bytes, model(many), {}, options)
    const zip2 = await JSZip.loadAsync(out2)
    const slides2 = await Promise.all((await deckOrder(zip2)).map((n) => zip2.file(n)!.async('string')))
    expect(slides2).toHaveLength(3)
    expect(rowsOf(leaveTableOf(slides2[1])).length - 4).toBe(10)
    expect(rowsOf(leaveTableOf(slides2[2])).length - 4).toBe(2)

    // 휴가가 없으면 사람 줄 없이 머리글·요약만
    const none = await renderPptx(r.bytes, model([]), {}, options)
    const zip3 = await JSZip.loadAsync(none)
    const last = await zip3.file((await deckOrder(zip3))[1])!.async('string')
    expect(rowsOf(leaveTableOf(last))).toHaveLength(4)
  })
})
