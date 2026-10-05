/** Rebuild neutral form assets using the existing neutral Office package and ExcelJS. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'

const dest = new URL('../../src/lib/report/assets/default/', import.meta.url)
const base = new URL('../../src/lib/report/assets/weekly-template.pptx', import.meta.url)
const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const emu = n => Math.round(n * 914400)
const paragraph = (text, size = 1800) => `<a:p><a:pPr/><a:r><a:rPr lang="ko-KR" sz="${size}"><a:solidFill><a:srgbClr val="243247"/></a:solidFill><a:latin typeface="Arial"/><a:ea typeface="맑은 고딕"/></a:rPr><a:t>${escape(text)}</a:t></a:r><a:endParaRPr lang="ko-KR"/></a:p>`
const shape = (id, text, x, y, w, h, size) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraph(text, size)}</p:txBody></p:sp>`
const row = (cells, height) => `<a:tr h="${emu(height)}">${cells.map(t => `<a:tc><a:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraph(t, 1400)}</a:txBody><a:tcPr marL="91440" marR="91440" marT="91440" marB="91440"/></a:tc>`).join('')}</a:tr>`
const table = (headers, cells, width) => `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Report table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(.5)}" y="${emu(1.6)}"/><a:ext cx="${emu(width)}" cy="${emu(3.5)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${headers.map(() => `<a:gridCol w="${emu(width / headers.length)}"/>`).join('')}</a:tblGrid>${row(headers, .45)}${row(cells, 3.05)}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`

async function presentation(kind) {
  const source = await JSZip.loadAsync(await readFile(base))
  const pres = await source.file('ppt/presentation.xml').async('string')
  const dimensions = pres.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
  const width = Number(dimensions[1]) / 914400 - 1
  const weekly = kind === 'weekly_report_pptx'
  const title = weekly ? '{{report.project_name}} · 주간보고' : '{{summary.project_name}} · 이슈 분석'
  const subtitle = weekly ? '{{report.week_label}} | 계획 {{kpi.plan}} · 실적 {{kpi.actual}}' : '{{summary.date_label}} | 전체 {{summary.issue_count}}건'
  const headers = weekly ? ['구분', '금주 실적', '차주 계획', '이슈'] : ['코드', '이슈', '내용', '상태']
  const cells = weekly
    ? ['{{#slide sections}}{{.name}}', '{{.this_content}}', '{{.next_content}}', '{{.this_issue}}']
    : ['{{#slide issues}}{{.code}}', '{{.title}}', '{{.body}}', '{{.status_label}}']
  const detail = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shape(2, title, .5, .3, width, .6, 2600)}${shape(3, subtitle, .5, 1, width, .4, 1600)}${table(headers, cells, width)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  // Copy only presentation content into a fresh OPC package; no inherited OLE/media.
  const clean = new JSZip()
  const ns = 'http://schemas.openxmlformats.org/'
  const rel = (entries) => `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${ns}package/2006/relationships">${entries.map(([id, type, target]) => `<Relationship Id="${id}" Type="${ns}officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`
  const tree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>'
  const namespaces = `xmlns:a="${ns}drawingml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships" xmlns:p="${ns}presentationml/2006/main"`
  clean.file('ppt/slides/slide1.xml', detail.replace(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/, ''))
  clean.file('ppt/slides/slide2.xml', detail)
  for (const n of [1, 2]) clean.file(`ppt/slides/_rels/slide${n}.xml.rels`, rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]))
  clean.file('ppt/theme/theme1.xml', await source.file('ppt/theme/theme1.xml').async('string'))
  clean.file('ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldLayout ${namespaces} type="blank" preserve="1"><p:cSld name="Blank">${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
  clean.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rel([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]))
  clean.file('ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8"?><p:sldMaster ${namespaces}><p:cSld>${tree}</p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`)
  clean.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', rel([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]))
  clean.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${namespaces}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="${dimensions[1]}" cy="${dimensions[2]}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`)
  clean.file('ppt/_rels/presentation.xml.rels', rel([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'slide', 'slides/slide1.xml'], ['rId3', 'slide', 'slides/slide2.xml']]))
  clean.file('_rels/.rels', rel([['rId1', 'officeDocument', 'ppt/presentation.xml']]))
  const parts = [['ppt/presentation.xml', 'presentation.main'], ['ppt/slides/slide1.xml', 'slide'], ['ppt/slides/slide2.xml', 'slide'], ['ppt/slideMasters/slideMaster1.xml', 'slideMaster'], ['ppt/slideLayouts/slideLayout1.xml', 'slideLayout']]
  clean.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${parts.map(([p, type]) => `<Override PartName="/${p}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.${type}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`)
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
