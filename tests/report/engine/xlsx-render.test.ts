import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { renderXlsx } from '@/lib/report/engine/xlsx'
import { FormRenderError, type RenderOptions } from '@/lib/report/engine/types'

const options: RenderOptions = {
  max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)',
}

async function book(fill: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  fill(wb.addWorksheet('공정보고'))
  return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer)
}

async function open(bytes: Uint8Array): Promise<ExcelJS.Worksheet> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(bytes) as never)
  return wb.getWorksheet('공정보고')!
}

const weekly = (partial: Record<string, unknown>) => partial as unknown as CatalogModel

describe('XlsxFormEngine.render', () => {
  it('값 토큰을 셀 서식은 유지한 채 넣고, 숫자 토큰은 숫자 셀이 된다', async () => {
    const bytes = await book((sheet) => {
      sheet.getCell('A1').value = '{{report.project_name}}'
      sheet.getCell('A1').font = { bold: true }
      sheet.getCell('B1').value = '{{kpi.total}}'
      sheet.getCell('C1').value = { richText: [{ text: '{{report.' }, { text: 'project_name}}' }] }
    })
    const sheet = await open(await renderXlsx(bytes, weekly({ report: { project_name: '알파' }, kpi: { total: 3 } }), {}, options))
    expect(sheet.getCell('A1').value).toBe('알파')
    expect(sheet.getCell('A1').font?.bold).toBe(true)
    expect(sheet.getCell('B1').value).toBe(3)
    expect(sheet.getCell('C1').value).toBe('알파')
  })

  it('빈 값은 empty_text, {{#items}} 는 셀 안 개행이고 상한은 외 N건이다', async () => {
    const bytes = await book((sheet) => {
      sheet.getCell('A1').value = '{{report.project_name}}'
      sheet.getCell('A2').value = '{{#items issues}}{{.}}{{/items}}'
    })
    const empty = await open(await renderXlsx(bytes, weekly({ report: { project_name: '' }, issues: [] }), {}, { ...options, empty_text: '없음' }))
    expect(empty.getCell('A1').value).toBe('없음')
    expect(empty.getCell('A2').value).toBe('없음')
    const lines = await open(await renderXlsx(bytes, weekly({ report: { project_name: '가\n나' }, issues: ['하나', '둘', '셋'] }), {}, { ...options, item_cap: 1 }))
    expect(lines.getCell('A1').value).toBe('가\n나')
    expect(lines.getCell('A2').value).toBe('하나\n외 2건')
  })

  it('{{#rows}} 는 아래 행을 밀며 복제하고, 0건이면 그 행을 지운다', async () => {
    const bytes = await book((sheet) => {
      const row = sheet.getRow(2)
      row.getCell(1).value = '{{#rows sections}}{{.name}}{{/rows}}'
      row.height = 18
      sheet.getCell('A3').value = '꼬리'
    })
    const model = weekly({ report: {}, sections: [{ name: '갑' }, { name: '을' }] })
    const sheet = await open(await renderXlsx(bytes, model, {}, options))
    expect(sheet.getCell('A2').value).toBe('갑')
    expect(sheet.getCell('A3').value).toBe('을')
    expect(sheet.getCell('A4').value).toBe('꼬리')
    expect(sheet.getRow(3).height).toBe(18)
    const gone = await open(await renderXlsx(bytes, weekly({ report: {}, sections: [] }), {}, options))
    expect(gone.getCell('A2').value).toBe('꼬리')
    expect(gone.getCell('A3').value).toBeNull()
  })

  it('{{#slide}} 와 카탈로그 밖 경로는 출력 없이 던진다', async () => {
    const slide = await book((sheet) => { sheet.getCell('A1').value = '{{#slide areas}}' })
    await expect(renderXlsx(slide, weekly({ report: {} }), {}, options)).rejects.toMatchObject({ code: 'SLIDE_IN_XLSX' })
    const missing = await book((sheet) => { sheet.getCell('A1').value = '{{title}}' })
    await expect(renderXlsx(missing, weekly({ report: {} }), {}, options)).rejects.toBeInstanceOf(FormRenderError)
    const mapped = await open(await renderXlsx(missing, weekly({ report: { project_name: '알파' } }), { '{{title}}': 'report.project_name' }, options))
    expect(mapped.getCell('A1').value).toBe('알파')
  })
})
