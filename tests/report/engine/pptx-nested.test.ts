// 행 반복 안의 목록 반복(정본 §4.4.3 — {{#rows}} 셀 안 {{#items}})과 그 넘침(§4.4.6).
// 바깥은 {{#slide}}(§4.4.4)까지 겹친다: 슬라이드(영역) → 표 행(이슈) → 셀 문단(원인).
// 깊이의 한계는 스펙 그대로다 — {{#items}} 는 2단까지(§4.4.5), 반복 단위는 행 하나(§4.4.3)라 {{#rows}} 안의 {{#rows}} 는 없다.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { assessFormActivation } from '@/lib/forms/activation'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { renderPptx } from '@/lib/report/engine/pptx'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { validatePlaceholders } from '@/lib/report/engine/scanner'
import { renderXlsx } from '@/lib/report/engine/xlsx'
import type { RenderOptions } from '@/lib/report/engine/types'
import { defaultFormAssetPath } from '@/lib/report/forms/loadTemplate'

const options: RenderOptions = {
  max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)',
}

async function pack(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(files)) zip.file(name, data)
  return zip.generateAsync({ type: 'uint8array' })
}

const para = (text: string) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`
const shape = (id: string, ...paragraphs: string[]) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t"/></p:nvSpPr><p:txBody>${paragraphs.map(para).join('')}</p:txBody></p:sp>`
const slide = (...body: string[]) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body.join('')}</p:spTree></p:cSld></p:sld>`
/** 셀 하나 — 인자마다 문단 하나 */
const cell = (...paragraphs: string[]) => `<a:tc><a:txBody>${paragraphs.map(para).join('')}</a:txBody></a:tc>`
const table = (...rows: string[]) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="tbl"/></p:nvGraphicFramePr><a:graphic><a:tbl>${rows.map((r) => `<a:tr>${r}</a:tr>`).join('')}</a:tbl></a:graphic></p:graphicFrame>`

async function slidesOf(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes)
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
  return Promise.all(names.map((name) => zip.file(name)!.async('string')))
}
const paragraphsOf = (xml: string) => [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
  .map((p) => [...p[1].matchAll(/<a:t\b[^>]*>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(''))
/** 표의 행 → 셀 → 문단 텍스트 */
const rowsOf = (xml: string): string[][][] => [...xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)]
  .map((tr) => [...tr[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((tc) => paragraphsOf(tc[1])))
const titleOf = (xml: string) => paragraphsOf(xml.slice(0, xml.indexOf('<p:graphicFrame')))[0]
const sha = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** 영역(슬라이드) → 이슈(행) → 원인(셀 문단 둘: 분류·직접 원인 / 근본 원인) */
const NESTED = slide(
  shape('2', '{{#slide areas}}{{.name}} {{slide.continuation}}'),
  table(
    cell('코드') + cell('원인'),
    cell('{{#rows .issues}}{{.code}}') + cell('{{#items .causes}}[{{.category_label}}] {{.direct_cause}}', '근본: {{.root_cause}}{{/items}}{{/rows}}'),
  ),
  shape('9', '{{slide.page}}/{{slide.page_count}}'),
)
const cause = (n: number | string) => ({ category: 'c', category_label: `분류${n}`, direct_cause: `직접${n}`, root_cause: `근본${n}` })
const causes = (count: number, prefix = '') => Array.from({ length: count }, (_, n) => cause(`${prefix}${n + 1}`))
const issueOf = (code: string, list: unknown[]) => ({ code, title: `${code} 제목`, causes: list })
const analysis = (areas: unknown[]) => ({ summary: {}, areas, issues: [], opportunities: [] }) as unknown as CatalogModel
const nested = () => pack({ 'ppt/slides/slide1.xml': NESTED })

describe('행 반복 안의 목록 반복 — 스캔·검증', () => {
  it('슬라이드 → 행 → 셀 문단 세 겹을 scope 로 읽고 카탈로그 검증을 지난다. 엔진 버전은 그대로다', async () => {
    const scan = await scanFormTemplate(await nested(), 'pptx')
    expect(scan.engineVersion).toBe('forms-engine.v1')
    expect(scan.issues).toEqual([])
    expect(scan.placeholders.filter((p) => p.kind !== 'value').map((p) => [...p.scope, p.token].join('/'))).toEqual([
      '{{#slide areas}}',
      '{{#slide areas}}/{{#rows .issues}}',
      '{{#slide areas}}/{{#rows .issues}}/{{#items .causes}}',
    ])
    expect(scan.placeholders.find((p) => p.token === '{{.root_cause}}')).toMatchObject({
      scope: ['{{#slide areas}}', '{{#rows .issues}}', '{{#items .causes}}'], location: { slide: 1, shapeId: '4', table: { row: 1, col: 1 }, paragraph: 1 },
    })
    expect(validatePlaceholders(scan.placeholders, 'issue_analysis_pptx', {})).toEqual([])
    // 저장된 스캔(JSON 왕복)으로 활성화 판정을 지난다
    expect(assessFormActivation('issue_analysis_pptx', JSON.parse(JSON.stringify(scan)), {})).toEqual({ ok: true })
  })

  it('안쪽 경로가 바깥 항목의 필드가 아니면 활성화를 거부한다 — 없는 필드·스칼라 필드·안쪽 값 토큰', async () => {
    const form = (inner: string) => pack({
      'ppt/slides/slide1.xml': slide(shape('2', '{{#slide areas}}{{.name}}'), table(cell('{{#rows .issues}}{{.code}}') + cell(`${inner}{{/rows}}`))),
    })
    const check = async (inner: string) => {
      const scan = await scanFormTemplate(await form(inner), 'pptx')
      expect(scan.issues).toEqual([])   // 문법은 맞다 — 경로 판정은 카탈로그 검증(활성화)이 한다
      return {
        issues: validatePlaceholders(scan.placeholders, 'issue_analysis_pptx', {}).map((i) => [i.code, i.token]),
        activation: assessFormActivation('issue_analysis_pptx', scan, {}),
      }
    }
    // 이슈에는 lines 가 없다(주간 그룹의 필드) — 안쪽 블록과 그 안의 값 토큰이 함께 걸린다
    const unknown = await check('{{#items .lines}}{{.}}{{/items}}')
    expect(unknown.issues).toEqual([['UNKNOWN_TOKEN', '{{#items .lines}}'], ['UNKNOWN_TOKEN', '{{.}}']])
    expect(unknown.activation).toMatchObject({ ok: false, code: 'UNMAPPED', unmapped: ['{{#items .lines}}', '{{.}}'] })
    // 이슈의 title 은 목록이 아니다
    const scalar = await check('{{#items .title}}x{{/items}}')
    expect(scalar.issues).toEqual([['TYPE_MISMATCH', '{{#items .title}}']])
    expect(scalar.activation).toMatchObject({ ok: false, code: 'TYPE_MISMATCH' })
    // 안쪽 항목(원인)에는 code 가 없다 — 바깥 행(이슈)의 필드를 안쪽에서 찾지 않는다
    const outerField = await check('{{#items .causes}}{{.code}}{{/items}}')
    expect(outerField.issues).toEqual([['UNKNOWN_TOKEN', '{{.code}}']])
    // 렌더도 부분 출력 없이 멈춘다
    await expect(renderPptx(await form('{{#items .lines}}{{.}}{{/items}}'), analysis([]), {}, options)).rejects.toMatchObject({ code: 'MISSING_PATH' })
  })

  it('스펙의 깊이를 넘는 중첩은 스캔 오류다 — 행 안의 행, 셀 안 목록 3단', async () => {
    const rowsInRows = await scanFormTemplate(await pack({
      'ppt/slides/slide1.xml': slide(table(cell('{{#rows areas}}{{.name}}') + cell('{{#rows .issues}}{{.code}}{{/rows}}{{/rows}}'))),
    }), 'pptx')
    expect(rowsInRows.issues.filter((i) => i.severity === 'error')).toEqual([
      expect.objectContaining({ code: 'TYPE_MISMATCH', token: '{{#rows .issues}}', location: expect.objectContaining({ slide: 1, table: { row: 0, col: 1 } }) }),
    ])
    expect(assessFormActivation('issue_analysis_pptx', rowsInRows, {})).toMatchObject({ ok: false, code: 'SCAN' })
    await expect(renderPptx(await pack({
      'ppt/slides/slide1.xml': slide(table(cell('{{#rows areas}}{{.name}}') + cell('{{#rows .issues}}{{.code}}{{/rows}}{{/rows}}'))),
    }), analysis([]), {}, options)).rejects.toMatchObject({ code: 'TYPE_MISMATCH' })

    const deep = await scanFormTemplate(await pack({
      'ppt/slides/slide1.xml': slide(table(cell('{{#rows ai_comment}}{{#items .left}}{{#items .lines}}{{#items .lines}}{{.}}{{/items}}{{/items}}{{/items}}{{/rows}}'))),
    }), 'pptx')
    expect(deep.issues.map((i) => [i.code, i.token])).toEqual([['TYPE_MISMATCH', '{{#items .lines}}']])

    const sheet = await scanFormTemplate(await pack({
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>{{#rows wbs_items}}{{.name}}</t></is></c><c r="B2" t="inlineStr"><is><t>{{#rows .owners}}{{.team_code}}{{/rows}}</t></is></c></row></sheetData></worksheet>',
    }), 'xlsx')
    expect(sheet.issues.map((i) => [i.code, i.token, i.location?.cell])).toEqual([['TYPE_MISMATCH', '{{#rows .owners}}', 'B2']])
  })

  it('{{/rows}} 를 생략한 표 둘이 같은 행 번호에 {{#rows}} 를 두어도 중첩이 아니다', async () => {
    const scan = await scanFormTemplate(await pack({
      'ppt/slides/slide1.xml': slide(
        table(cell('머리'), cell('{{#rows areas}}{{.name}}')),
        table(cell('머리'), cell('{{#rows issues}}{{.code}}')),
      ),
    }), 'pptx')
    expect(scan.issues).toEqual([])
  })
})

describe('행 반복 안의 목록 반복 — 렌더', () => {
  it('바깥 2 × 안쪽 3·0·7 — 영역마다 한 장, 이슈마다 한 행, 원인마다 문단 둘이다', async () => {
    const out = await slidesOf(await renderPptx(await nested(), analysis([
      { name: '갑', issues: [issueOf('I1', causes(3)), issueOf('I2', [])] },
      { name: '을', issues: [issueOf('I3', causes(7))] },
    ]), {}, options))
    expect(out).toHaveLength(2)
    expect(out.map(titleOf)).toEqual(['갑 ', '을 '])
    expect(rowsOf(out[0])).toEqual([
      [['코드'], ['원인']],
      [['I1'], ['[분류1] 직접1', '근본: 근본1', '[분류2] 직접2', '근본: 근본2', '[분류3] 직접3', '근본: 근본3']],
      [['I2'], ['']],   // 안쪽 0건 — 행은 남고 셀은 빈 문단 하나(§4.4.5 최상위 블록 0개)
    ])
    expect(rowsOf(out[1])).toHaveLength(2)
    expect(rowsOf(out[1])[1][1]).toHaveLength(14)
    expect(out.join('')).not.toContain('{{')
    expect(out.join('')).not.toContain('(계속)')
    expect(out[1]).toContain('2/2')
  })

  it('안쪽 0건의 표시는 표 밖 {{#items}} 와 같다 — empty_text 한 문단. 바깥 0건은 행·장이 빠진다', async () => {
    const withText = { ...options, empty_text: '없음' }
    const out = await slidesOf(await renderPptx(await nested(), analysis([
      { name: '갑', issues: [issueOf('I1', [])] },
      { name: '을', issues: [] },
    ]), {}, withText))
    expect(rowsOf(out[0])).toEqual([[['코드'], ['원인']], [['I1'], ['없음']]])
    expect(rowsOf(out[1])).toEqual([[['코드'], ['원인']]])   // 이슈 0건 — 템플릿 행을 지우고 머리 행만(§4.4.3)
    expect(await slidesOf(await renderPptx(await nested(), analysis([]), {}, withText))).toHaveLength(0)   // 영역 0건 — 장이 빠진다(§4.4.4)
  })

  it('행 수가 상한을 넘으면 같은 영역의 이어지는 장으로 넘긴다 — 이슈·원인을 하나도 잃지 않는다', async () => {
    const out = await slidesOf(await renderPptx(await nested(), analysis([
      { name: '갑', issues: Array.from({ length: 7 }, (_, n) => issueOf(`I${n + 1}`, causes(2, `${n + 1}-`))) },
      { name: '을', issues: [issueOf('J1', causes(1, 'j'))] },
    ]), {}, { ...options, max_rows_per_slide: 3 }))
    expect(out.map(titleOf)).toEqual(['갑 ', '갑 (계속)', '갑 (계속)', '을 '])
    expect(out.map((xml) => rowsOf(xml).length - 1)).toEqual([3, 3, 1, 1])
    for (const xml of out) expect(rowsOf(xml)[0]).toEqual([['코드'], ['원인']])   // 머리 행은 장마다
    const body = out.slice(0, 3).flatMap((xml) => rowsOf(xml).slice(1))
    expect(body.map((row) => row[0][0])).toEqual(['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7'])
    expect(body.map((row) => row[1])).toEqual(Array.from({ length: 7 }, (_, n) => [
      `[분류${n + 1}-1] 직접${n + 1}-1`, `근본: 근본${n + 1}-1`, `[분류${n + 1}-2] 직접${n + 1}-2`, `근본: 근본${n + 1}-2`,
    ]))
    expect(out[3]).toContain('4/4')
  })

  it('한 행의 안쪽 목록이 셀 줄 예산을 넘으면 연속 행으로, 그 행들이 상한을 넘으면 이어지는 장으로 — 잘림 0건', async () => {
    const many = causes(20)
    const expected = many.flatMap((c) => [`[${c.category_label}] ${c.direct_cause}`, `근본: ${c.root_cause}`])
    const bytes = await nested()
    const render = (o: RenderOptions) => renderPptx(bytes, analysis([{ name: '갑', issues: [issueOf('I1', many), issueOf('I2', causes(1, 'k'))] }]), {}, o)
    const lines = (cells: string[][][]) => cells.flatMap((row) => row[1])

    // 40줄 ÷ 15줄 = 연속 행 3개. 행 상한 5 안이라 한 장이다
    const [one, ...rest] = await slidesOf(await render(options))
    expect(rest).toEqual([])
    const rows = rowsOf(one).slice(1)
    expect(rows.map((row) => row[0])).toEqual([['I1 (계속) 1/3'], ['(계속) 2/3'], ['(계속) 3/3'], ['I2']])
    expect(rows.slice(0, 3).map((row) => row[1].length)).toEqual([15, 15, 10])   // 문단 경계에서만 나뉜다
    expect(lines(rows.slice(0, 3))).toEqual(expected)   // 40문단이 순서대로 한 번씩 — 잘림·중복 없음
    expect(rows[3][1]).toEqual(['[분류k1] 직접k1', '근본: 근본k1'])

    // 행 상한 2 — 연속 행 3 + 다음 이슈 1 = 4행이 두 장에 걸친다. 같은 영역의 이어지는 장이다
    const paged = await slidesOf(await render({ ...options, max_rows_per_slide: 2 }))
    expect(paged.map(titleOf)).toEqual(['갑 ', '갑 (계속)'])
    const all = paged.flatMap((xml) => rowsOf(xml).slice(1))
    expect(all.map((row) => row[0][0])).toEqual(['I1 (계속) 1/3', '(계속) 2/3', '(계속) 3/3', 'I2'])
    expect(lines(all.slice(0, 3))).toEqual(expected)
    expect(paged.join('')).not.toContain('{{')
  })

  it('item_cap 은 행 안의 목록에도 같다 — 넘는 항목은 외 N건 한 줄', async () => {
    const [only] = await slidesOf(await renderPptx(await nested(), analysis([{ name: '갑', issues: [issueOf('I1', causes(5))] }]), {}, { ...options, item_cap: 2 }))
    expect(rowsOf(only)[1][1]).toEqual(['[분류1] 직접1', '근본: 근본1', '[분류2] 직접2', '근본: 근본2', '외 3건'])
  })

  it('셀 안 목록은 2단(그룹 → 줄)까지 겹친다(§4.4.5) — 표 밖의 같은 블록과 같은 글이 나온다', async () => {
    const bytes = await pack({
      'ppt/slides/slide1.xml': slide(table(cell('{{#rows ai_comment}}{{.left_title}}') + cell('{{#items .left}}{{.title}}', '{{#items .lines}}- {{.}}{{/items}}', '{{/items}}{{/rows}}'))),
    })
    expect((await scanFormTemplate(bytes, 'pptx')).issues).toEqual([])
    const model = {
      report: {},
      ai_comment: [{ left_title: '요약', left: [{ title: '가', lines: ['하나', '둘'] }, { title: '나', lines: [] }] }],
    } as unknown as CatalogModel
    const [only] = await slidesOf(await renderPptx(bytes, model, {}, options))
    const [[title, body]] = rowsOf(only)
    expect(title).toEqual(['요약'])
    expect(body.filter((line) => line !== '')).toEqual(['가', '- 하나', '- 둘', '나'])
  })

  it('xlsx 도 행 안의 목록을 셀 줄로 쌓는다 — 0건은 empty_text', async () => {
    const book = new ExcelJS.Workbook()
    const sheet = book.addWorksheet('목록')
    sheet.getCell('A1').value = '{{#rows wbs_items}}{{.name}}'
    sheet.getCell('B1').value = '{{#items .owners}}{{.team_code}} {{.team_name}}{{/items}}{{/rows}}'
    const bytes = new Uint8Array(await book.xlsx.writeBuffer() as ArrayBuffer)
    expect((await scanFormTemplate(bytes, 'xlsx')).issues).toEqual([])
    const model = {
      project: {}, wbs_items: [
        { name: '작업 1', owners: [{ team_code: 'T1', team_name: '일팀' }, { team_code: 'T2', team_name: '이팀' }] },
        { name: '작업 2', owners: [] },
      ],
    } as unknown as CatalogModel
    const out = new ExcelJS.Workbook()
    await out.xlsx.load(Buffer.from(await renderXlsx(bytes, model, {}, { ...options, empty_text: '없음' })) as never)
    const rendered = out.getWorksheet('목록')!
    expect([1, 2].map((r) => [rendered.getCell(r, 1).value, rendered.getCell(r, 2).value])).toEqual([
      ['작업 1', 'T1 일팀\nT2 이팀'], ['작업 2', '없음'],
    ])
  })
})

describe('단일 반복 양식은 그대로다 — 이 변경 전 엔진의 출력과 슬라이드 XML 이 같다', () => {
  // 해시는 변경 전 엔진(main 856e2005)으로 뽑았다. 값이 달라지면 이미 활성화된 양식의 출력이 바뀐 것이다 — 해시를 고치지 말고 원인을 찾는다.
  /** 옛 기본 이슈 분석서의 원인 분석 장과 같은 꼴: 이슈마다 한 장 + 원인이 행 + 표 밖 목록 */
  const SINGLE = slide(
    shape('2', '{{#slide issues}}{{.code}} {{slide.continuation}}', '{{.area_name}}'),
    shape('5', '심각도별', '{{#items .related_systems}}{{.}}{{/items}}'),
    table(
      cell('분류') + cell('직접') + cell('근본'),
      cell('{{#rows .causes}}{{.category_label}}') + cell('{{.direct_cause}}') + cell('{{.root_cause}}{{/rows}}'),
    ),
    shape('9', '{{slide.page}}/{{slide.page_count}}'),
  )
  const flat = [
    { code: 'I1', area_name: '갑', related_systems: ['하나', '둘'], causes: causes(7) },                                              // 행 상한 넘침
    { code: 'I2', area_name: '을', related_systems: [], causes: [{ ...cause(1), direct_cause: '가나다라 '.repeat(120) }] },             // 셀 줄 넘침
    { code: 'I3', area_name: '병', related_systems: ['셋'], causes: [] },                                                             // 0행
  ]

  it('{{#slide}} + {{#rows}} + 표 밖 {{#items}} — 행 넘침·셀 넘침·0행', async () => {
    const bytes = await pack({ 'ppt/slides/slide1.xml': SINGLE })
    const out = await slidesOf(await renderPptx(bytes, { summary: {}, areas: [], issues: flat, opportunities: [] } as unknown as CatalogModel, {}, options))
    expect(out.map(sha)).toEqual(['1a55661f76e7d9c1', '34dfdc4f4ca9b918', '5b21ff909d20deb0', '04935ca535ab4108'])
  })

  it('기본 주간보고 양식', async () => {
    const weekly = {
      report: { project_name: '합성 과제', week_label: '1주차' }, kpi: { plan: 12.3, actual: 10 },
      sections: Array.from({ length: 3 }, (_, n) => ({
        name: `구분 ${n + 1}`, this_content: Array.from({ length: n * 20 + 1 }, (_, i) => `금주 ${n + 1}-${i + 1}`),
        next_content: [`차주 ${n + 1}`], this_issue: n ? ['확인 필요'] : [], next_issue: [],
      })),
    } as unknown as CatalogModel
    const out = await slidesOf(await renderPptx(new Uint8Array(await readFile(defaultFormAssetPath('weekly_report_pptx'))), weekly, {}, options))
    expect(out.map(sha)).toEqual(['e5079598417204c0', '1db90d0572a1ac4b', '567d522226657a82', '532cc25e93c3d63b'])
  })

  it('이 변경 전에 저장된 스캔으로 재스캔 없이 활성화 판정을 지나고, 지금 스캔도 같은 값이다', async () => {
    // 변경 전 엔진이 form_templates.placeholders 에 남긴 모양 그대로(블록 토큰만 추림)
    const stored = {
      engineVersion: 'forms-engine.v1', format: 'pptx', issues: [],
      placeholders: [
        { token: '{{#slide issues}}', kind: 'slide', path: 'issues', scope: [], location: { slide: 1, paragraph: 0, shapeId: '2' }, mergedRuns: false },
        { token: '{{.code}}', kind: 'value', path: '.code', scope: ['{{#slide issues}}'], location: { slide: 1, paragraph: 0, shapeId: '2' }, mergedRuns: false },
        { token: '{{#rows .causes}}', kind: 'rows', path: '.causes', scope: ['{{#slide issues}}'], location: { slide: 1, paragraph: 0, shapeId: '4', table: { row: 1, col: 0 } }, mergedRuns: false },
        { token: '{{.root_cause}}', kind: 'value', path: '.root_cause', scope: ['{{#slide issues}}', '{{#rows .causes}}'], location: { slide: 1, paragraph: 0, shapeId: '4', table: { row: 1, col: 2 } }, mergedRuns: false },
      ],
    }
    expect(assessFormActivation('issue_analysis_pptx', stored, {})).toEqual({ ok: true })
    const now = await scanFormTemplate(await pack({ 'ppt/slides/slide1.xml': SINGLE }), 'pptx')
    expect(now.engineVersion).toBe(stored.engineVersion)
    expect(now.issues).toEqual([])
    for (const kept of stored.placeholders) expect(now.placeholders).toContainEqual(kept)
  })
})
