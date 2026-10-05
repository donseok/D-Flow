import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { renderPptx } from '@/lib/report/engine/pptx'
import { FormRenderError, type RenderOptions } from '@/lib/report/engine/types'

const options: RenderOptions = {
  max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)',
}

async function pack(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(files)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array' })
}

const weekly = (partial: Record<string, unknown>) => partial as unknown as CatalogModel

const shape = (id: string, paragraphs: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t"/></p:nvSpPr><p:txBody>${paragraphs}</p:txBody></p:sp>`

const slide = (body: string) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`

async function textOf(bytes: Uint8Array, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file(path)
  if (!file) throw new Error(`missing ${path}`)
  return file.async('string')
}

describe('PptxFormEngine.render', () => {
  it('값 토큰을 넣고, 토큰 밖 런의 서식은 둔다', async () => {
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(shape('4',
        '<a:p><a:r><a:rPr b="1"/><a:t>라벨</a:t></a:r><a:r><a:t> {{report.project_name}}</a:t></a:r></a:p>',
      )),
    })
    const out = await renderPptx(bytes, weekly({ report: { project_name: '알파' } }), {}, options)
    const xml = await textOf(out, 'ppt/slides/slide1.xml')
    expect(xml).toContain('<a:rPr b="1"/><a:t>라벨</a:t>')
    expect(xml).toContain('<a:t> 알파</a:t>')
    expect(xml).not.toContain('{{')
  })

  it('여러 런에 걸친 토큰은 첫 런 서식으로 합친다', async () => {
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(shape('4',
        '<a:p><a:r><a:rPr b="1"/><a:t>{{report.</a:t></a:r><a:r><a:t>project_name}}</a:t></a:r></a:p>',
      )),
    })
    const xml = await textOf(await renderPptx(bytes, weekly({ report: { project_name: '알파' } }), {}, options), 'ppt/slides/slide1.xml')
    expect(xml).toContain('<a:rPr b="1"/><a:t>알파</a:t>')
    expect(xml).not.toContain('project_name')
  })

  it('빈 값은 empty_text 이고, 개행은 다음 문단으로 나눈다', async () => {
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(shape('4',
        '<a:p><a:r><a:t>앞 {{report.project_name}} 뒤</a:t></a:r></a:p>',
      )),
    })
    const empty = await textOf(await renderPptx(bytes, weekly({ report: { project_name: '' } }), {}, { ...options, empty_text: '없음' }), 'ppt/slides/slide1.xml')
    expect(empty).toContain('앞 없음 뒤')
    const lines = await textOf(await renderPptx(bytes, weekly({ report: { project_name: '가\n나' } }), {}, options), 'ppt/slides/slide1.xml')
    expect(lines).toContain('앞 가 뒤')
    expect(lines).toContain('<a:t>나</a:t>')
    expect(lines.match(/<a:p\b/g)).toHaveLength(2)
  })

  it('스캔 오류와 카탈로그에 없는 경로는 출력 없이 던진다', async () => {
    const bad = await pack({
      'ppt/slides/slide1.xml': slide(shape('4', '<a:p><a:r><a:t>{{BAD}}</a:t></a:r></a:p>')),
    })
    await expect(renderPptx(bad, weekly({ report: { project_name: '알파' } }), {}, options)).rejects.toMatchObject({ code: 'MALFORMED_TOKEN' })
    const missing = await pack({
      'ppt/slides/slide1.xml': slide(shape('4', '<a:p><a:r><a:t>{{title}}</a:t></a:r></a:p>')),
    })
    await expect(renderPptx(missing, weekly({ report: {} }), {}, options)).rejects.toBeInstanceOf(FormRenderError)
    const mapped = await textOf(
      await renderPptx(missing, weekly({ report: { project_name: '알파' } }), { '{{title}}': 'report.project_name' }, options),
      'ppt/slides/slide1.xml',
    )
    expect(mapped).toContain('알파')
  })

  it('{{#items}} 는 항목마다 문단을 만들고 상한은 외 N건으로 접는다', async () => {
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(shape('4', '<a:p><a:r><a:t>{{#items issues}}{{.}}{{/items}}</a:t></a:r></a:p>')),
    })
    const xml = await textOf(await renderPptx(bytes, weekly({ report: {}, issues: ['하나', '둘'] }), {}, options), 'ppt/slides/slide1.xml')
    expect(xml).toContain('<a:t>하나</a:t>')
    expect(xml).toContain('<a:t>둘</a:t>')
    expect(xml).not.toContain('#items')
    const capped = await textOf(
      await renderPptx(bytes, weekly({ report: {}, issues: ['하나', '둘', '셋'] }), {}, { ...options, item_cap: 1 }),
      'ppt/slides/slide1.xml',
    )
    expect(capped).toContain('하나')
    expect(capped).toContain('외 2건')
    expect(capped).not.toContain('>둘<')
    const none = await textOf(
      await renderPptx(bytes, weekly({ report: {}, issues: [] }), {}, { ...options, empty_text: '없음' }),
      'ppt/slides/slide1.xml',
    )
    expect(none).toContain('없음')
    expect(none.match(/<a:p\b/g)).toHaveLength(1)
  })

  it('{{#rows}} 는 행을 복제하고 0건이면 그 행을 지운다', async () => {
    const row = '<a:tr><a:tc><a:txBody><a:p><a:r><a:t>{{#rows sections}}{{.name}}{{/rows}}</a:t></a:r></a:p></a:txBody></a:tc></a:tr>'
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="t"/></p:nvGraphicFramePr><a:graphic><a:tbl>${row}<a:tr><a:tc><a:txBody><a:p><a:r><a:t>꼬리</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphic></p:graphicFrame>`),
    })
    const xml = await textOf(await renderPptx(bytes, weekly({
      report: {}, sections: [{ name: '갑' }, { name: '을' }],
    }), {}, options), 'ppt/slides/slide1.xml')
    expect(xml.match(/<a:tr\b/g)).toHaveLength(3)
    expect(xml).toContain('갑')
    expect(xml).toContain('을')
    expect(xml).toContain('꼬리')
    const gone = await textOf(await renderPptx(bytes, weekly({ report: {}, sections: [] }), {}, options), 'ppt/slides/slide1.xml')
    expect(gone.match(/<a:tr\b/g)).toHaveLength(1)
    expect(gone).not.toContain('#rows')
  })

  it('{{#slide}} 는 항목 수만큼 복제해 OPC 에 잇고, 0건이면 슬라이드를 뺀다', async () => {
    const body = slide(shape('9', '<a:p><a:r><a:t>{{#slide areas}}{{.name}}</a:t></a:r></a:p><a:p><a:r><a:t>{{slide.page}}/{{slide.page_count}}</a:t></a:r></a:p>'))
      .replace('<p:sld ', '<p:sld><p:custDataLst><p:tags r:id="rIdT"/></p:custDataLst><p14:creationId xmlns:p14="p14" val="1"/>')
    const bytes = await pack({
      '[Content_Types].xml': '<?xml version="1.0"?><Types><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
      'ppt/presentation.xml': '<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': body,
      'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tags" Target="../tags/tag1.xml"/></Relationships>',
      'docProps/app.xml': '<Properties><Slides>1</Slides></Properties>',
    })
    const model = { summary: { project_name: 'P' }, areas: [{ name: '구역1' }, { name: '구역2' }] } as unknown as CatalogModel
    const out = await renderPptx(bytes, model, {}, options)
    const zip = await JSZip.loadAsync(out)
    const first = await zip.file('ppt/slides/slide1.xml')!.async('string')
    const secondName = Object.keys(zip.files).find((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) && n !== 'ppt/slides/slide1.xml')
    expect(secondName).toBeTruthy()
    const second = await zip.file(secondName!)!.async('string')
    expect(first).toContain('구역1')
    expect(second).toContain('구역2')
    expect(first).toContain('1/2')
    expect(second).toContain('2/2')
    expect(first).toContain('custDataLst')
    expect(second).not.toContain('custDataLst')
    expect(second).not.toContain('val="1"')
    const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
    expect(rels).toContain('rIdFm1')
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    expect(pres).toContain('r:id="rId2"')
    expect(pres).toContain('r:id="rIdFm1"')
    expect(pres).toContain('id="257"')
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    expect(ct).toContain(`/ppt/slides/${secondName!.split('/').pop()}`)
    const app = await zip.file('docProps/app.xml')!.async('string')
    expect(app).toContain('<Slides>2</Slides>')
    const rels2 = secondName!.replace('ppt/slides/', 'ppt/slides/_rels/').replace(/\.xml$/, '.xml.rels')
    expect(await zip.file(rels2)!.async('string')).not.toContain('tags')

    const none = await renderPptx(bytes, { summary: {}, areas: [] } as unknown as CatalogModel, {}, options)
    const empty = await JSZip.loadAsync(none)
    expect(empty.file('ppt/slides/slide1.xml')).toBeNull()
    expect(await empty.file('ppt/presentation.xml')!.async('string')).not.toContain('rId2')
    expect(await empty.file('docProps/app.xml')!.async('string')).toContain('<Slides>0</Slides>')
  })
})
