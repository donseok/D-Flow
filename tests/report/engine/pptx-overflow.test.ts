import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { renderPptx } from '@/lib/report/engine/pptx'
import type { RenderOptions } from '@/lib/report/engine/types'

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

const cell = (text: string) => `<a:tc><a:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody></a:tc>`

function texts(xml: string): string[] {
  return [...xml.matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((match) => match[1])
}

async function slidesOf(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
  return Promise.all(names.map((name) => zip.file(name)!.async('string')))
}

describe('PptxFormEngine §4.4.6 overflow', () => {
  it('단순 목록은 셀 줄 예산으로 슬라이드를 나누고 짧은 셀은 empty_text 다', async () => {
    const body = [
      shape('4', '<a:p><a:r><a:t>{{#items issues}}{{.}}{{/items}}</a:t></a:r></a:p>'),
      shape('5', '<a:p><a:r><a:t>{{#items events}}{{.}}{{/items}}</a:t></a:r></a:p>'),
      shape('6', '<a:p><a:r><a:t>{{slide.continuation}} {{slide.page}}/{{slide.page_count}}</a:t></a:r></a:p>'),
    ].join('')
    const bytes = await pack({
      '[Content_Types].xml': '<?xml version="1.0"?><Types><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
      'ppt/presentation.xml': '<p:presentation xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': slide(body).replace('<p:sld ', '<p:sld><p:custDataLst><p:tags r:id="rIdT"/></p:custDataLst><p14:creationId xmlns:p14="p14" val="1"/>'),
      'ppt/slides/_rels/slide1.xml.rels': '<Relationships><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tags" Target="../tags/tag1.xml"/></Relationships>',
      'docProps/app.xml': '<Properties><Slides>1</Slides></Properties>',
    })
    const out = await renderPptx(bytes, weekly({ report: {}, issues: ['하나', '둘'], events: ['만'] }), {}, {
      ...options, max_lines_per_cell: 1, empty_text: '없음',
    })
    const zip = await JSZip.loadAsync(out)
    const [first, second] = await slidesOf(out)
    expect(texts(first)).toEqual(expect.arrayContaining(['하나', '만']))
    expect(first).toContain('1/2')
    expect(first).not.toContain('(계속)')
    expect(texts(second)).toEqual(expect.arrayContaining(['둘', '없음']))
    expect(second).toContain('(계속)')
    expect(second).toContain('2/2')
    expect(second).not.toContain('custDataLst')
    expect(second).not.toContain('val="1"')
    const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
    expect(rels).toContain('rIdFm1')
    expect(await zip.file('docProps/app.xml')!.async('string')).toContain('<Slides>2</Slides>')
  })

  it('그룹이 찢기면 다음 페이지 제목에 continuation_label 을 붙인다', async () => {
    const paras = [
      '<a:p><a:r><a:t>{{#items wbs_groups.curr}}{{.title}}</a:t></a:r></a:p>',
      '<a:p><a:r><a:t>{{#items .lines}}{{.}}{{/items}}</a:t></a:r></a:p>',
      '<a:p><a:r><a:t>{{/items}}</a:t></a:r></a:p>',
    ].join('')
    const bytes = await pack({ 'ppt/slides/slide1.xml': slide(shape('4', paras)) })
    const model = weekly({
      report: {},
      wbs_groups: { curr: [{ title: '가', num: 1, lines: ['나', '다'] }] },
    })
    const [first, second] = await slidesOf(await renderPptx(bytes, model, {}, { ...options, max_lines_per_cell: 2, continuation_label: '다음' }))
    expect(texts(first)).toContain('가')
    expect(texts(first)).toContain('나')
    expect(texts(second).some((text) => text.includes('다음'))).toBe(true)
    expect(texts(second)).toContain('다')
    expect(second).not.toContain('(계속)')
  })

  it('{{#rows}} 가 행 상한을 넘으면 헤더를 반복한 슬라이드로 나눈다', async () => {
    const table = `<p:graphicFrame><a:graphic><a:tbl>${[
      `<a:tr>${cell('헤더')}</a:tr>`,
      `<a:tr>${cell('{{#rows sections}}{{.name}}{{/rows}}')}</a:tr>`,
    ].join('')}</a:tbl></a:graphic></p:graphicFrame>`
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(`${table}${shape('6', '<a:p><a:r><a:t>{{slide.continuation}}</a:t></a:r></a:p>')}`),
    })
    const [first, second] = await slidesOf(await renderPptx(bytes, weekly({
      report: {}, sections: [{ name: '갑' }, { name: '을' }, { name: '병' }],
    }), {}, { ...options, max_rows_per_slide: 2 }))
    expect(texts(first).filter((text) => text === '헤더')).toHaveLength(1)
    expect(texts(first)).toEqual(expect.arrayContaining(['갑', '을']))
    expect(texts(first)).not.toContain('병')
    expect(first).not.toContain('(계속)')
    expect(texts(second).filter((text) => text === '헤더')).toHaveLength(1)
    expect(texts(second)).toContain('병')
    expect(second).toContain('(계속)')
  })

  it('행 셀이 줄 예산을 넘으면 연속 행으로 나누고 첫 셀에 i/n 을 붙인다', async () => {
    const name = '가'.repeat(30)
    const table = `<p:graphicFrame><a:graphic><a:tbl><a:tr>${cell('{{#rows sections}}{{.name}}')}${cell('{{.code}}{{/rows}}')}</a:tr></a:tbl></a:graphic></p:graphicFrame>`
    const bytes = await pack({ 'ppt/slides/slide1.xml': slide(table) })
    const [only] = await slidesOf(await renderPptx(bytes, weekly({
      report: {}, sections: [{ name, code: '끝' }],
    }), {}, { ...options, max_lines_per_cell: 1 }))
    const values = texts(only).filter((text) => text !== '')
    expect(values).toHaveLength(3)
    expect(values[0].endsWith('(계속) 1/2')).toBe(true)
    expect(values[1]).toBe('끝')
    expect(values[2].endsWith('(계속) 2/2')).toBe(true)
    const stripped = [values[0], values[2]].map((text) => text.replace(/ \(계속\) \d+\/\d+$/, '')).join('')
    expect(stripped).toBe(name)
    expect(await slidesOf(await renderPptx(bytes, weekly({ report: {}, sections: [{ name, code: '끝' }] }), {}, options))).toHaveLength(1)
  })

  it('값 토큰 단독은 넘침으로 슬라이드를 만들지 않는다', async () => {
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(shape('4', '<a:p><a:r><a:t>{{report.project_name}}</a:t></a:r></a:p>')),
    })
    const slides = await slidesOf(await renderPptx(bytes, weekly({ report: { project_name: '가'.repeat(40) } }), {}, { ...options, max_lines_per_cell: 1 }))
    expect(slides).toHaveLength(1)
    expect(texts(slides[0])[0]).toBe('가'.repeat(40))
  })

  it('{{#slide}} 항목의 넘침 페이지는 그 항목 순서 안에 둔다', async () => {
    const body = slide([
      shape('4', '<a:p><a:r><a:t>{{#slide areas}}{{.name}}</a:t></a:r></a:p>'),
      shape('5', '<a:p><a:r><a:t>{{#items .summary.owner_departments}}{{.}}{{/items}}</a:t></a:r></a:p>'),
      shape('6', '<a:p><a:r><a:t>{{slide.continuation}} {{slide.page}}/{{slide.page_count}}</a:t></a:r></a:p>'),
    ].join(''))
    const bytes = await pack({ 'ppt/slides/slide1.xml': body })
    const model = {
      summary: { project_name: 'P' },
      areas: [
        { name: '구역1', summary: { owner_departments: ['하나', '둘'] } },
        { name: '구역2', summary: { owner_departments: ['만'] } },
      ],
    } as unknown as CatalogModel
    const slides = await slidesOf(await renderPptx(bytes, model, {}, { ...options, max_lines_per_cell: 1 }))
    expect(slides).toHaveLength(3)
    expect(texts(slides[0])).toEqual(expect.arrayContaining(['구역1', '하나']))
    expect(slides[0]).toContain('1/3')
    expect(slides[0]).not.toContain('(계속)')
    expect(texts(slides[1])).toEqual(expect.arrayContaining(['구역1', '둘']))
    expect(slides[1]).toContain('(계속)')
    expect(slides[1]).toContain('2/3')
    expect(texts(slides[2])).toEqual(expect.arrayContaining(['구역2', '만']))
    expect(slides[2]).toContain('3/3')
    expect(slides[2]).not.toContain('(계속)')
  })
})
