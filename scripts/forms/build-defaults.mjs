/** Rebuild the neutral default form assets from scratch — no source Office package is read. */
import { mkdir, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'

const dest = new URL('../../src/lib/report/assets/default/', import.meta.url)
// A4 가로(10.83" × 7.5"). 옛 base 파일에서 읽던 슬라이드 크기를 상수로 둔다.
const SLIDE = { cx: 9906000, cy: 6858000 }
// zip 항목 시각을 고정해 내용이 같으면 바이트도 같게 한다.
const STAMP = new Date('2026-10-05T00:00:00Z')
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const emu = n => Math.round(n * 914400)
const paragraph = (text, size = 1800, { bold = false, align = '' } = {}) => `<a:p>${align ? `<a:pPr algn="${align}"/>` : '<a:pPr/>'}<a:r><a:rPr lang="ko-KR" sz="${size}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="243247"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="맑은 고딕"/></a:rPr><a:t>${escape(text)}</a:t></a:r><a:endParaRPr lang="ko-KR"/></a:p>`
/** text 가 배열이면 문단 여러 개다({{#items}} 블록은 문단 단위). */
const shape = (id, text, x, y, w, h, size, style) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${[text].flat().map(t => paragraph(t, size, style)).join('')}</p:txBody></p:sp>`
const row = (cells, height) => `<a:tr h="${emu(height)}">${cells.map(t => `<a:tc><a:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraph(t, 1400)}</a:txBody><a:tcPr marL="91440" marR="91440" marT="91440" marB="91440"/></a:tc>`).join('')}</a:tr>`
const table = (headers, cells, width) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Report table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(.5)}" y="${emu(1.6)}"/><a:ext cx="${emu(width)}" cy="${emu(3.5)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${headers.map(() => `<a:gridCol w="${emu(width / headers.length)}"/>`).join('')}</a:tblGrid>${row(headers, .45)}${row(cells, 3.05)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
const slideXml = body => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`

// 이슈 분석서의 표 — 열 너비가 다르고 여러 열이라 가는 테두리와 머리 행 채움을 둔다.
const edges = ['L', 'R', 'T', 'B'].map(side => `<a:ln${side} w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="C5CEDA"/></a:solidFill><a:prstDash val="solid"/></a:ln${side}>`).join('')
/** 셀 값이 배열이면 문단 여러 개다(셀 안 {{#items}} 블록은 문단 단위). */
const gridRow = (cells, height, head = false) => `<a:tr h="${emu(height)}">${cells.map(t => `<a:tc><a:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${[t].flat().map(line => paragraph(line, 1100, { bold: head })).join('')}</a:txBody><a:tcPr marL="72000" marR="72000" marT="54000" marB="54000">${edges}${head ? '<a:solidFill><a:srgbClr val="E8EEF5"/></a:solidFill>' : '<a:noFill/>'}</a:tcPr></a:tc>`).join('')}</a:tr>`
/** rows: [cells, height, head?][] — 머리 행·고정 행·{{#rows}} 행을 위에서 아래로. */
const grid = (id, y, widths, rows) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="Table ${id}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(.5)}" y="${emu(y)}"/><a:ext cx="${emu(widths.reduce((a, b) => a + b, 0))}" cy="${emu(rows.reduce((a, r) => a + r[1], 0))}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid>${widths.map(w => `<a:gridCol w="${emu(w)}"/>`).join('')}</a:tblGrid>${rows.map(r => gridRow(...r)).join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`

// 제품 고유의 최소 테마. 글꼴·색은 슬라이드의 런이 직접 정하므로 여기 값은 PowerPoint 의 기본 팔레트로만 쓰인다.
const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'
const line = w => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/></a:ln>`
const THEME_COLORS = { dk1: '1F2937', lt1: 'FFFFFF', dk2: '243247', lt2: 'E8EEF5', accent1: '2563EB', accent2: '0F766E', accent3: 'D97706', accent4: '7C3AED', accent5: 'DC2626', accent6: '64748B', hlink: '0563C1', folHlink: '954F72' }
const fonts = '<a:latin typeface="Arial"/><a:ea typeface="맑은 고딕"/><a:cs typeface=""/>'
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="D-Flow"><a:themeElements><a:clrScheme name="D-Flow">${Object.entries(THEME_COLORS).map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme><a:fontScheme name="D-Flow"><a:majorFont>${fonts}</a:majorFont><a:minorFont>${fonts}</a:minorFont></a:fontScheme><a:fmtScheme name="D-Flow"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`

function weeklySlides(width) {
  const title = '{{report.project_name}} · 주간보고'
  const subtitle = '{{report.week_label}} | 계획 {{kpi.plan}} · 실적 {{kpi.actual}}'
  const headers = ['구분', '금주 실적', '차주 계획', '이슈']
  const cells = ['{{#slide sections}}{{.name}}', '{{.this_content}}', '{{.next_content}}', '{{.this_issue}}']
  const head = `${shape(2, title, .5, .3, width, .6, 2600)}${shape(3, subtitle, .5, 1, width, .4, 1600)}`
  return [slideXml(head), slideXml(`${head}${table(headers, cells, width)}`)]
}

/**
 * 이슈 분석서: 표지 → 영역별 종합 → 영역별 이슈 목록 → 영역별 원인 분석 → 영역별 개선기회.
 * 영역마다 한 장이고 이슈·개선기회가 행이다 — 이슈의 원인들·개선기회의 연결 이슈들은 그 행의 셀 안 {{#items}} 문단이다.
 * 긴 본문·원인은 {{#rows}} 행에 두어 엔진의 넘침 분할(행 수·셀 줄 수)을 탄다.
 */
function issueAnalysisSlides(width) {
  const page = shape(9, '{{slide.page}} / {{slide.page_count}}', .5, 7.05, width, .3, 1000, { align: 'r' })
  const heading = (title, subtitle, titleWidth = width) => `${shape(2, title, .5, .3, titleWidth, .6, 2400)}${shape(3, subtitle, .5, .95, titleWidth, .4, 1400)}`
  const cover = `${shape(2, '{{summary.project_name}} · 이슈 분석', .5, .3, width, .6, 2600)}${shape(3, '{{summary.date_label}} | 영역 {{summary.area_count}}개 · 전체 {{summary.issue_count}}건', .5, 1, width, .4, 1600)}${shape(4, '작성 {{summary.author_name}}', .5, 1.5, width, .4, 1200)}`
  const status = '열림 {{.summary.status.open}} · 진행중 {{.summary.status.in_progress}} · 해결 {{.summary.status.resolved}} · 보류 {{.summary.status.on_hold}}'
  const overview = `${heading('영역별 종합 {{slide.continuation}}', '{{summary.project_name}} | 영역 {{summary.area_count}}개 · 전체 {{summary.issue_count}}건')}${grid(4, 1.6, [2.6, .9, .9, .9, .9, .9, 1.4, 1.33], [
    [['영역', '전체', '열림', '진행중', '해결', '보류', '주관 부서', '관련 시스템'], .4, true],
    [['{{#rows areas}}{{.code}} {{.name}}', '{{.summary.total_count}}', '{{.summary.status.open}}', '{{.summary.status.in_progress}}', '{{.summary.status.resolved}}', '{{.summary.status.on_hold}}', '{{.summary.owner_departments}}', '{{.summary.related_systems}}{{/rows}}'], .5],
  ])}${page}`
  const areaIssues = `${heading('{{#slide areas}}{{.code}} {{.name}} · 이슈 목록 {{slide.continuation}}', `전체 {{.summary.total_count}}건 | ${status}`, width - 2.2)}${shape(5, ['심각도별', '{{#items .summary.severity_counts}}{{.label}} {{.count}}건{{/items}}'], .5 + width - 2, .3, 2, 1.2, 1100)}${grid(4, 1.6, [1.1, 2, 4.4, .75, .78, .8], [
    [['코드', '이슈', '내용', '심각도', '상태', '주관 부서'], .4, true],
    [['{{#rows .issues}}{{.code}}', '{{.title}}', '{{.body}}', '{{.severity_label}}', '{{.status_label}}', '{{.owner_department}}{{/rows}}'], .8],
  ])}${page}`
  const causes = `${heading('{{#slide areas}}{{.code}} {{.name}} · 원인 분석 {{slide.continuation}}', `전체 {{.summary.total_count}}건 | ${status}`)}${grid(4, 1.6, [1.1, 2.6, 6.13], [
    [['코드', '이슈', '원인 — [분류] 직접 원인 / 근본 원인'], .4, true],
    [['{{#rows .issues}}{{.code}}', '{{.title}}', ['{{#items .causes}}[{{.category_label}}] {{.direct_cause}}', '근본 원인: {{.root_cause}}{{/items}}{{/rows}}']], .8],
  ])}${page}`
  const opportunities = `${heading('{{#slide areas}}{{.code}} {{.name}} · 개선기회 {{slide.continuation}}', '전체 {{.summary.total_count}}건의 이슈를 묶은 개선 방향')}${grid(4, 1.6, [.7, 2.6, 3.7, 2.83], [
    [['번호', '개선기회', '개선 방향', '연결 이슈'], .4, true],
    [['{{#rows .opportunities}}{{.no}}', '{{.title}}', '{{.description}}', '{{#items .issues}}{{.code}} {{.title}}{{/items}}{{/rows}}'], .8],
  ])}${page}`
  return [cover, overview, areaIssues, causes, opportunities].map(slideXml)
}

async function presentation(kind) {
  const width = SLIDE.cx / 914400 - 1
  const slides = kind === 'weekly_report_pptx' ? weeklySlides(width) : issueAnalysisSlides(width)
  // A fresh OPC package with slides, one blank layout, one master and the theme only — no OLE/media.
  const clean = new JSZip()
  const put = (name, data) => clean.file(name, data, { date: STAMP, createFolders: false })
  const ns = 'http://schemas.openxmlformats.org/'
  const rel = (entries) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${ns}officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`
  const tree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>'
  const namespaces = `xmlns:a="${ns}drawingml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships" xmlns:p="${ns}presentationml/2006/main"`
  const numbers = slides.map((_, index) => index + 1)
  for (const n of numbers) {
    put(`ppt/slides/slide${n}.xml`, slides[n - 1])
    put(`ppt/slides/_rels/slide${n}.xml.rels`, rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]))
  }
  put('ppt/theme/theme1.xml', THEME)
  put('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank">${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  put('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rel([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  put('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${namespaces}><p:cSld>${tree}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`)
  put('ppt/slideMasters/_rels/slideMaster1.xml.rels', rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]))
  put('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${numbers.map(n => `<p:sldId id="${255 + n}" r:id="rId${n + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${SLIDE.cx}" cy="${SLIDE.cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  put('ppt/_rels/presentation.xml.rels', rel([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...numbers.map(n => [`rId${n + 1}`, 'slide', `slides/slide${n}.xml`])]))
  put('_rels/.rels', rel([['rId1', 'officeDocument', 'ppt/presentation.xml']]))
  const parts = [['ppt/presentation.xml', 'presentation.main'], ...numbers.map(n => [`ppt/slides/slide${n}.xml`, 'slide']), ['ppt/slideMasters/slideMaster1.xml', 'slideMaster'], ['ppt/slideLayouts/slideLayout1.xml', 'slideLayout']]
  put('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.map(([p, type]) => `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`)
  await writeFile(new URL(`${kind}.pptx`, dest), await clean.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
}

async function workbook(kind) {
  const book = new ExcelJS.Workbook()
  book.creator = 'D-Flow'
  book.created = new Date('2026-10-05T00:00:00Z')
  book.modified = book.created
  const weekly = kind === 'weekly_report_xlsx'
  const sheet = book.addWorksheet(weekly ? '주간보고' : 'WBS', { views: [{ state: 'frozen', ySplit: 4 }] })
  sheet.addRow([weekly ? '{{report.project_name}} · 주간보고' : '{{project.name}} · WBS'])
  sheet.addRow(weekly ? ['{{report.week_label}}', '{{report.week_range}}'] : ['기간', '{{project.start_date}}', '~', '{{project.end_date}}'])
  sheet.addRow(['계획', '{{kpi.plan}}', '실적', '{{kpi.actual}}'])
  const headers = weekly ? ['구분', '금주 실적', '차주 계획', '금주 이슈', '차주 이슈'] : ['번호', '단계', '작업명', '산출물', '담당', '시작일', '종료일', '계획 (%)', '실적 (%)', '상태']
  sheet.addRow(headers)
  sheet.addRow(weekly
    ? ['{{#rows sections}}{{.name}}', '{{.this_content}}', '{{.next_content}}', '{{.this_issue}}', '{{.next_issue}}{{/rows}}']
    : ['{{#rows wbs_items}}{{.no}}', '{{.level_label}}', '{{.name}}', '{{.deliverable}}', '{{.owner_text}}', '{{.planned_start}}', '{{.planned_end}}', '{{.planned_pct}}', '{{.actual_pct}}', '{{.status_label}}{{/rows}}'])
  sheet.mergeCells(1, 1, 1, headers.length)
  if (!weekly) {
    for (const address of ['B2', 'D2']) sheet.getCell(address).numFmt = 'yyyy-mm-dd'
  }
  sheet.columns.forEach((col, index) => { col.width = weekly ? (index ? 36 : 20) : ([8, 16, 36, 30, 22, 16, 16, 14, 14, 18][index]) })
  sheet.eachRow((r, n) => {
    r.height = n === 5 ? 75 : 26
    r.eachCell(c => {
      c.font = { name: '맑은 고딕', size: 11, bold: n === 1 || n === 4, color: { argb: 'FF243247' } }
      c.alignment = { vertical: 'top', wrapText: true }
      if (n === 4) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }
    })
  })
  if (!weekly) [6, 7].forEach(c => { const cell = sheet.getCell(5, c); cell.style = { ...cell.style, numFmt: 'yyyy-mm-dd' } })
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  await writeFile(new URL(`${kind}.xlsx`, dest), Buffer.from(await book.xlsx.writeBuffer()))
}
await mkdir(dest, { recursive: true })
for (const kind of ['weekly_report_pptx', 'issue_analysis_pptx']) await presentation(kind)
for (const kind of ['weekly_report_xlsx', 'wbs_export_xlsx']) await workbook(kind)
