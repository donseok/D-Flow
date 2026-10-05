import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { assessFormActivation } from '@/lib/forms/activation'
import { engineFor, scanFormTemplate } from '@/lib/report/engine/scan'

async function zip(files: Record<string, string>): Promise<Uint8Array> {
  const z = new JSZip()
  for (const [name, data] of Object.entries(files)) z.file(name, data)
  return z.generateAsync({ type: 'uint8array' })
}

const slide = (body: string) =>
  `<p:sld><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`

describe('FormEngine.scan', () => {
  it('pptx 문단의 값 토큰은 위치와 함께 읽고, 마스터·노트는 보지 않는다', async () => {
    const report = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="23" name="title"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{ report.project_name }}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
      'ppt/slideMasters/slideMaster1.xml': slide(`<p:sp><p:txBody><a:p><a:r><a:t>{{kpi.plan}}</a:t></a:r></a:p></p:txBody></p:sp>`),
      'ppt/notesSlides/notesSlide1.xml': slide(`<p:sp><p:txBody><a:p><a:r><a:t>{{report.week_label}}</a:t></a:r></a:p></p:txBody></p:sp>`),
    }), 'pptx')
    expect(report.engineVersion).toBe('forms-engine.v1')
    expect(report.format).toBe('pptx')
    expect(report.placeholders).toEqual([
      expect.objectContaining({
        token: '{{report.project_name}}', kind: 'value', path: 'report.project_name', scope: [],
        mergedRuns: false, location: { slide: 1, shapeId: '23', paragraph: 0 },
      }),
    ])
    expect(report.issues.filter((i) => i.severity === 'error')).toEqual([])
    expect(assessFormActivation('weekly_report_pptx', report, {})).toEqual({ ok: true })
    expect(engineFor('pptx').format).toBe('pptx')
  })

  it('런에 걸친 토큰은 병합하고 SPLIT_RUN 경고만 남긴다', async () => {
    const report = await scanFormTemplate(await zip({
      'ppt/slides/slide2.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="4" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{report.</a:t></a:r><a:r><a:t>project_name}}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    }), 'pptx')
    expect(report.placeholders[0]).toMatchObject({ token: '{{report.project_name}}', mergedRuns: true, location: { slide: 2, paragraph: 0 } })
    expect(report.issues.map((i) => i.code)).toEqual(['SPLIT_RUN'])
    expect(assessFormActivation('weekly_report_pptx', report, {})).toEqual({ ok: true })
  })

  it('표 밖 {{#rows}}·세로 병합 행·닫히지 않은 {{#items}}·3단 중첩은 오류다', async () => {
    const outside = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{#rows sections}}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    }), 'pptx')
    expect(outside.issues.map((i) => i.code)).toContain('ROWS_OUTSIDE_TABLE')

    const merged = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="tbl"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl><a:tr>` +
        `<a:tc rowSpan="2"><a:txBody><a:p><a:r><a:t>{{#rows sections}}</a:t></a:r></a:p></a:txBody></a:tc>` +
        `<a:tc><a:txBody><a:p><a:r><a:t>{{/rows}}</a:t></a:r></a:p></a:txBody></a:tc>` +
        `</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      ),
    }), 'pptx')
    expect(merged.issues.map((i) => i.code)).toContain('VERTICAL_MERGE_IN_ROWS')
    expect(merged.placeholders[0].location.table).toEqual({ row: 0, col: 0 })

    const span = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="tbl"/></p:nvGraphicFramePr><a:graphic><a:graphicData><a:tbl>` +
        `<a:tr><a:tc><a:txBody><a:p><a:r><a:t>{{#rows sections}}</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
        `<a:tr><a:tc><a:txBody><a:p><a:r><a:t>{{/rows}}</a:t></a:r></a:p></a:txBody></a:tc></a:tr>` +
        `</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
      ),
    }), 'pptx')
    expect(span.issues.map((i) => i.code)).toContain('ROWS_SPAN_ROWS')

    const open = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{#items issues}}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    }), 'pptx')
    expect(open.issues.map((i) => i.code)).toContain('UNCLOSED_BLOCK')

    const deep = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{#items a}}{{#items b}}{{#items c}}{{/items}}{{/items}}{{/items}}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    }), 'pptx')
    expect(deep.issues.map((i) => i.code)).toContain('TYPE_MISMATCH')
  })

  it('{{#slide}} 가 차트 파트를 가리키면 경고하고, 한 슬라이드에 둘이면 오류다', async () => {
    const warned = await scanFormTemplate(await zip({
      'ppt/slides/slide3.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="9" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{#slide areas}}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
      'ppt/slides/_rels/slide3.xml.rels': `<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
    }), 'pptx')
    expect(warned.issues.map((i) => i.code)).toEqual(['SHARED_PART_ON_CLONE'])

    const twice = await scanFormTemplate(await zip({
      'ppt/slides/slide1.xml': slide(
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{#slide areas}}</a:t></a:r></a:p><a:p><a:r><a:t>{{#slide sections}}</a:t></a:r></a:p></p:txBody></p:sp>`,
      ),
    }), 'pptx')
    expect(twice.issues.map((i) => i.code)).toContain('MULTIPLE_SLIDE_BLOCKS')
  })

  it('xlsx 는 셀 값만 보고, {{#slide}} 와 세로 병합 반복 행은 거부하며 차트는 경고다', async () => {
    const report = await scanFormTemplate(await zip({
      'xl/workbook.xml': `<workbook><sheets><sheet name="공정보고" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/sharedStrings.xml': `<sst><si><t>{{#rows wbs_items}}</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="C12" t="inlineStr"><is><r><t>{{report.</t></r><r><t>project_name}}</t></r></is></c></row></sheetData><mergeCells><mergeCell ref="A1:A2"/></mergeCells><headerFooter><oddHeader>{{kpi.plan}}</oddHeader></headerFooter></worksheet>`,
      'xl/charts/chart1.xml': `<c:chart/>`,
    }), 'xlsx')
    expect(report.placeholders.map((p) => ({ token: p.token, cell: p.location.cell, sheet: p.location.sheet, merged: p.mergedRuns }))).toEqual([
      { token: '{{#rows wbs_items}}', cell: 'A1', sheet: '공정보고', merged: false },
      { token: '{{report.project_name}}', cell: 'C12', sheet: '공정보고', merged: true },
    ])
    expect(report.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['VERTICAL_MERGE_IN_ROWS', 'SPLIT_RUN', 'ROUNDTRIP_LOSS']))
    expect(report.issues.map((i) => i.code)).not.toContain('SLIDE_IN_XLSX')
    expect(report.placeholders.some((p) => p.path === 'kpi.plan')).toBe(false)

    const slide = await scanFormTemplate(await zip({
      'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="B2" t="inlineStr"><is><t>{{#slide areas}}</t></is></c></row></sheetData></worksheet>`,
    }), 'xlsx')
    expect(slide.issues.map((i) => i.code)).toContain('SLIDE_IN_XLSX')
    expect(assessFormActivation('weekly_report_pptx', { tokenScan: false, engineVersion: 'forms-engine.v1', format: 'pptx', placeholders: [], issues: [] }, {})).toMatchObject({ ok: false, code: 'RESCAN' })
  })
})
