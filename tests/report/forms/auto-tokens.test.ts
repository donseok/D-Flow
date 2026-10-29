// 자리표시자 없는 주간보고 PPT 양식의 표 자동 연결(계획 2026-10-28-weekly-form-auto-tokens.md).
// 머리글 낱말·열 너비·가로 병합으로 "구분 | 실적 | 계획" 표를 찾아 첫 데이터 행에 {{#rows sections}} 토큰을,
// 구분 열이 없는 "금주 실적 | 차주 계획" 두 열 표에는 업무 건 단위 {{#rows tasks}} 토큰을 넣는다. 머리글 날짜는 그 주 자리표시자로.
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { autoTokenizeTemplate } from '@/lib/report/forms/autoTokens'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { deckOrder, renderPptx } from '@/lib/report/engine/pptx'
import { weeklyCatalogTasks } from '@/lib/report/catalog/weeklyBuild'
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

/** 42주차 보고서 꼴 — 구분 열 없이 "금주 실적 | 차주 계획" 두 열, 데이터 행 2개(사람이 한 장에 둘씩 썼다). 영역 이름은 내용 앞의 [..] */
const twoColTable = (a: string, b: string) => table(9, [4500000, 4500000], [
  { h: 337135, cells: [{ text: '금주 (2026.10.05~2026.10.16) 실적' }, { text: '차주 (2026.10.19~2026.10.23) 계획' }] },
  { h: 2250347, cells: [{ text: [`[${a}] 이번 주 한 일`, '- 세부'] }, { text: `[${a}] 다음 주 할 일` }] },
  { h: 2741109, cells: [{ text: `[${b}] 이번 주 한 일` }, {}] },
])

/** 월간 요약 표 — "금월 주요 실적 | 차월 주요 계획". 주간 표가 아니다 */
const monthTable = () => table(10, [1000000, 4000000, 4000000], [
  { h: 600000, cells: [{}, { text: '금월 주요 실적' }, { text: '차월 주요 계획 (작성 선택 사항)' }] },
  { h: 4500000, cells: [{ text: '부산운영팀' }, { text: '[스마트물류 2단계] 진행' }, { text: '[스마트물류 2단계] 계속' }] },
])

const weekly = (sections: { name: string; this_content: string[]; next_content: string[] }[]) =>
  ({ report: { project_name: '부산운영팀' }, kpi: {}, sections }) as unknown as CatalogModel

describe('autoTokenizeTemplate — 주간 PPT 표 자동 연결', () => {
  it('"구분 | 전주 | 금주" 표의 첫 데이터 행에 토큰을 넣고 표본 행을 지우고, 행 높이를 표본 행 평균에 맞추고 머리글 날짜를 바꾼다', async () => {
    const bytes = await pack([slide(title(2, '본부 주요 업무') + busanTable())])
    const r = await autoTokenizeTemplate(bytes, 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.detection).toEqual({
      slide: 1,
      columns: { name: 0, this: 1, next: 2 },
      headers: { name: '구분', this: '전주 (41,42주차, 10/05~10/16)', next: '금주 (43주차, 10/19~10/23)' },
      removedRows: 1,
      removedSlides: 0,
      rowsPerSlide: 2,
      // 표본 행 평균 높이 (4521115+300000)/2 에서 여백을 빼고 9pt 줄 높이로 나눈다
      linesPerCell: Math.floor((2410558 - 91440) / (9 * 12700 * 1.2)),
      datedHeaders: 2,
      lineStyles: [],  // 구분 열 표는 줄 서식을 배우지 않는다(영역마다 한 줄 — sections)
    })
    const xml = await slideXml(r.bytes, 1)
    const trs = rows(xml)
    expect(trs).toHaveLength(3)
    // 두 자리 "MM/DD~MM/DD" 는 같은 서식의 자리표시자로 — 실적 열은 그 주, 계획 열은 다음 주
    expect(cellTexts(trs[0])).toEqual(['구분', '전주 (41,42주차, {{report.week_range_mmdd}})', '금주 (43주차, {{report.next_week_range_mmdd}})', '일시', ''])
    expect(cellTexts(trs[2])).toEqual(['{{#rows sections}}{{.name}}', '{{.this_content}}', '{{.next_content}}', '26/01/01', '26/12/31'])
    expect(/<a:tr h="2410558">/.test(trs[2])).toBe(true)
    // 토큰 런은 원래 첫 런의 서식을 입고, 머리글·일시 칸은 그대로다
    expect(trs[2]).toContain('<a:rPr lang="ko-KR" sz="900" b="0"/><a:t>{{.this_content}}</a:t>')
    expect(trs[2]).toContain('<a:tcPr anchor="ctr"/>')
    expect(xml).toContain('본부 주요 업무')
    // 엔진 스캔은 rows 블록 안의 상대 토큰 세 개를 그 표 그 행에서 본다
    const scanned = await scanFormTemplate(r.bytes, 'pptx')
    expect(scanned.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(scanned.placeholders.map((p) => [p.token, p.kind, p.scope, p.location.table])).toEqual([
      ['{{report.week_range_mmdd}}', 'value', [], { row: 0, col: 1 }],
      ['{{report.next_week_range_mmdd}}', 'value', [], { row: 0, col: 2 }],
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

  it('이미 토큰이 있는 양식·다른 종류·표 없음은 바꾸지 않는다', async () => {
    const tokened = await pack([slide(title(2, '{{report.project_name}}') + busanTable())])
    expect(await autoTokenizeTemplate(tokened, 'weekly_report_pptx')).toEqual({ changed: false, reason: 'has_tokens' })
    const plain = await pack([slide(title(2, '본부 주요 업무') + busanTable())])
    expect(await autoTokenizeTemplate(plain, 'issue_analysis_pptx')).toEqual({ changed: false, reason: 'unsupported_kind' })
    expect(await autoTokenizeTemplate(await pack([slide(title(2, '표지'))]), 'weekly_report_pptx')).toEqual({ changed: false, reason: 'no_table' })
  })

  it('구분 열이 없는 "금주 실적 | 차주 계획" 두 열 표는 업무 건(tasks) 단위로 잇고, 표본 행 수·칸 크기를 줄 수로 돌려준다', async () => {
    const r = await autoTokenizeTemplate(await pack([slide(title(2, '주간 업무') + twoColTable('생산계획', '통합관제'))]), 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.detection).toEqual({
      slide: 1,
      columns: { name: null, this: 0, next: 1 },
      headers: { name: '', this: '금주 (2026.10.05~2026.10.16) 실적', next: '차주 (2026.10.19~2026.10.23) 계획' },
      removedRows: 1,
      removedSlides: 0,
      rowsPerSlide: 2,
      linesPerCell: Math.floor(((2250347 + 2741109) / 2 - 91440) / (9 * 12700 * 1.2)),
      datedHeaders: 2,
      lineStyles: ['title', 'item'],  // 보기 칸의 "[a] …" 제목 줄과 "- 세부" 줄
    })
    const trs = rows(await slideXml(r.bytes, 1))
    expect(trs).toHaveLength(2)
    expect(cellTexts(trs[0])).toEqual(['금주 ({{report.week_range_ymd}}) 실적', '차주 ({{report.next_week_range_ymd}}) 계획'])
    expect(cellTexts(trs[1])).toEqual(['{{#rows tasks}}{{.this_tagged}}', '{{.next_tagged}}'])
    expect(/<a:tr h="2495728">/.test(trs[1])).toBe(true)
    // 보기 내용은 패턴일 뿐 — 데이터 행의 글자와 표본 행은 남지 않는다
    expect(trs[1]).not.toContain('생산계획')
    expect(trs.join('')).not.toContain('통합관제')
    const scanned = await scanFormTemplate(r.bytes, 'pptx')
    expect(scanned.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(scanned.placeholders.map((p) => p.token)).toEqual(['{{report.week_range_ymd}}', '{{report.next_week_range_ymd}}', '{{#rows tasks}}', '{{.this_tagged}}', '{{.next_tagged}}'])
  })

  it('월 단위 머리글(금월 | 차월) 표는 주간 표로 보지 않고, 구분 열이 있는 표를 두 열 표보다 앞세운다', async () => {
    expect(await autoTokenizeTemplate(await pack([slide(monthTable())]), 'weekly_report_pptx')).toEqual({ changed: false, reason: 'no_table' })
    const r = await autoTokenizeTemplate(await pack([slide(monthTable()), slide(twoColTable('a', 'b'))]), 'weekly_report_pptx')
    expect(r.changed && r.detection.slide).toBe(2)
    if (r.changed) expect(await slideXml(r.bytes, 1)).toContain('[스마트물류 2단계] 진행')  // 월 표는 그대로
    const named = await autoTokenizeTemplate(await pack([slide(twoColTable('a', 'b')), slide(busanTable())]), 'weekly_report_pptx')
    expect(named.changed && named.detection.columns).toEqual({ name: 0, this: 1, next: 2 })
    expect(named.changed && named.detection.slide).toBe(2)
  })

  it('같은 표를 바로 뒤 슬라이드에 되풀이했으면 첫 장만 남기고 지운다 — 노트 슬라이드·rels·콘텐츠 타입·sldIdLst 까지', async () => {
    const SLIDE_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    const xmls = [slide(title(2, '표지')), slide(twoColTable('a', 'b')), slide(twoColTable('c', 'd')), slide(twoColTable('e', 'f')), slide(title(2, '교육/출장') + dayGridTable())]
    const zip = new JSZip()
    zip.file('[Content_Types].xml', `<Types>${xmls.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${SLIDE_CT}"/>`).join('')}`
      + '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>')
    zip.file('ppt/presentation.xml', `<p:presentation><p:sldIdLst>${xmls.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`)
    zip.file('ppt/_rels/presentation.xml.rels', `<Relationships>${xmls.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`)
    xmls.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml))
    zip.file('ppt/slides/_rels/slide3.xml.rels', `<Relationships><Relationship Id="rId2" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout6.xml"/></Relationships>`)
    zip.file('ppt/notesSlides/notesSlide1.xml', '<p:notes/>')
    zip.file('ppt/notesSlides/_rels/notesSlide1.xml.rels', `<Relationships><Relationship Id="rId2" Type="${REL}/slide" Target="../slides/slide3.xml"/></Relationships>`)
    zip.file('docProps/app.xml', '<Properties><Slides>5</Slides></Properties>')
    const r = await autoTokenizeTemplate(await zip.generateAsync({ type: 'uint8array' }), 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.detection.slide).toBe(2)
    expect(r.detection.removedSlides).toBe(2)
    const out = await JSZip.loadAsync(r.bytes)
    expect(await deckOrder(out)).toEqual(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide5.xml'])
    for (const gone of ['ppt/slides/slide3.xml', 'ppt/slides/slide4.xml', 'ppt/slides/_rels/slide3.xml.rels', 'ppt/notesSlides/notesSlide1.xml', 'ppt/notesSlides/_rels/notesSlide1.xml.rels']) {
      expect(out.file(gone)).toBeNull()
    }
    const rels = await out.file('ppt/_rels/presentation.xml.rels')!.async('string')
    expect([...rels.matchAll(/Target="([^"]+)"/g)].map((m) => m[1])).toEqual(['slides/slide1.xml', 'slides/slide2.xml', 'slides/slide5.xml'])
    const types = await out.file('[Content_Types].xml')!.async('string')
    expect([...types.matchAll(/PartName="([^"]+)"/g)].map((m) => m[1])).toEqual(['/ppt/slides/slide1.xml', '/ppt/slides/slide2.xml', '/ppt/slides/slide5.xml'])
    expect(await out.file('docProps/app.xml')!.async('string')).toContain('<Slides>3</Slides>')
    // 남긴 표에는 토큰, 뒤 슬라이드(교육/출장)는 그대로
    expect(await slideXml(r.bytes, 2)).toContain('{{#rows tasks}}')
    expect(await slideXml(r.bytes, 5)).toContain('휴가')
    // 머리글이 다른 표가 사이에 끼면 되풀이가 아니다
    const mixed = await autoTokenizeTemplate(await pack([slide(twoColTable('a', 'b')), slide(busanTable()), slide(twoColTable('c', 'd'))]), 'weekly_report_pptx')
    expect(mixed.changed && mixed.detection.slide).toBe(2)
    expect(mixed.changed && mixed.detection.removedSlides).toBe(0)
  })

  it('두 열 표는 엔진이 웹 내용을 업무 건마다 한 줄(같은 건의 금주·차주 나란히)로 채우고 양식의 줄 수마다 다음 슬라이드로 잇는다', async () => {
    const r = await autoTokenizeTemplate(await pack([slide(twoColTable('a', 'b'))]), 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    const areas = [
      { id: 'q', code: '001', name: '품질설계', sortOrder: 1, active: true, teams: [] },
      { id: 'y', code: '002', name: '야드관리', sortOrder: 2, active: true, teams: [] },
      { id: 'g', code: '003', name: '구내운송', sortOrder: 3, active: true, teams: [] },
    ]
    const sheet = [
      { id: '1', reportId: 'w', areaId: 'q', thisContent: '[생산계획] 간트 연동\n  ▪ 일정 : 09/14 ~ 10/23\n–  프로그램 개발', nextContent: '[생산계획] 간트 연동\n–  운영계 반영', thisIssue: '', nextIssue: '' },
      { id: '2', reportId: 'w', areaId: 'y', thisContent: '', nextContent: '', thisIssue: '', nextIssue: '' },
      { id: '3', reportId: 'w', areaId: 'g', thisContent: '세로고정 상차 순서 조정\n 담당자 : 유남\n\n[구내운송] C61 게이트 편성', nextContent: '[구내운송] 출하차량 입문 개선', thisIssue: '', nextIssue: '' },
    ]
    const tasks = weeklyCatalogTasks(sheet as never, areas as never)
    const model = {
      report: { week_range_ymd: '2026.10.26~2026.10.30', next_week_range_ymd: '2026.11.02~2026.11.06' }, kpi: {}, sections: [], tasks,
    } as unknown as CatalogModel
    const out = await renderPptx(r.bytes, model, {}, { ...options, max_rows_per_slide: r.detection.rowsPerSlide, max_lines_per_cell: r.detection.linesPerCell })
    const zip = await JSZip.loadAsync(out)
    const order = await deckOrder(zip)
    expect(order).toHaveLength(2)
    const texts = await Promise.all(order.map((n) => zip.file(n)!.async('string')))
    const first = rows(texts[0])
    expect(first).toHaveLength(1 + 2)
    expect(cellTexts(first[0])).toEqual(['금주 (2026.10.26~2026.10.30) 실적', '차주 (2026.11.02~2026.11.06) 계획'])
    // 같은 제목의 금주·차주 건이 한 줄 — 사람이 적은 들여쓰기 그대로, 영역 이름표 없이
    expect(cellTexts(first[1])).toEqual(['[생산계획] 간트 연동\n  ▪ 일정 : 09/14 ~ 10/23\n–  프로그램 개발', '[생산계획] 간트 연동\n–  운영계 반영'])
    // 제목에 [분류] 가 없으면 [영역 이름] 을 붙인다. 글이 없는 영역(야드관리)은 줄이 없다
    expect(cellTexts(first[2])).toEqual(['[구내운송] 세로고정 상차 순서 조정\n 담당자 : 유남', ''])
    const second = rows(texts[1])
    expect(second).toHaveLength(1 + 2)
    expect(cellTexts(second[1])).toEqual(['[구내운송] C61 게이트 편성', ''])
    expect(cellTexts(second[2])).toEqual(['', '[구내운송] 출하차량 입문 개선'])
    for (const x of texts) {
      expect(x).not.toContain('{{')
      expect(x).not.toContain('이번 주 한 일')
      expect(x).not.toContain('야드관리')
    }
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
