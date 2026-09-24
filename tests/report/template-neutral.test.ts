import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_RE, GRAPHIC_FRAME_RE, GROUP_SHAPE_RE, SHAPE_RE, TABLE_CELL_RE, TABLE_ROW_RE, shapeIdPattern,
} from '@/lib/report/issues/slideXml'

/* 보고서 기본 양식 두 개가 원 고객사 흔적 없이 중립이고, 렌더러(templateFill.ts · issues/*)가 좌표로 집는
 * 구조는 그대로인지 본다. 중립본은 고객사 원본에서 한 번 만들었다 — 원본이 없는 이 리포에서는 다시 만들 수 없어
 * 생성 스크립트는 두지 않는다. */

const ASSETS = 'src/lib/report/assets'
// 일부러 난독화한 거부 목록: 원 고객사·원 브랜드·원 샘플 ID 토큰을 유니코드 이스케이프로 적고 실행 시 조립한다.
// 평범한 리포 검색에 고객사명이 걸리지 않게 하려는 것이니 글자로 풀어 적지 않는다.
// 모든 zip 항목(XML·rels·docProps·테마·바이너리)에서 utf8·utf16le 로 0건이어야 한다(대소문자 무시).
const DENY_TOKENS = [
  '\u0064\u0063\u0075\u0062\u0065', '\u0064\u002d\u0063\u0075\u0062\u0065',
  '\u0064\u006f\u006e\u0067\u006b\u0075\u006b', '\ub3d9\uad6d', '\uc528\uc5e0', '\uc81c\uac15',
  '\ud640\ub529\uc2a4', '\uc2dc\uc2a4\ud15c\uc988', '\uc804\ub7b5\ud300',
  '\u006c\u0075\u0078\u0074\u0065\u0065\u006c', '\u0061\u0070\u0070\u0073\u0074\u0065\u0065\u006c',
  '\u0073\u0074\u0065\u0065\u006c\u0073\u0068\u006f\u0070',
  '\u0065\u0062\u0069\u007a', '\u0065\u002d\u0062\u0069\u007a',
  '\u0037\u0030\uc8fc\ub144', '\ub9c8\uc2a4\ud130\ud50c\ub79c', '\u0050\u0049\u002d\u0049\u002d',
]
// 두 글자 약칭은 압축된 미디어 바이트에 우연히 나올 수 있어 텍스트 항목에서만, 단어 경계·대소문자 구분으로 본다.
const DENY_WORD = '\u0044\u004b'
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
const DENY_RE = new RegExp(DENY_TOKENS.map(escapeRe).join('|'), 'gi')
const DENY_WORD_RE = new RegExp(`\\b${DENY_WORD}\\b`, 'g')
const TEXT_PART = /\.(xml|rels|vml)$/
const NEUTRAL_AUTHOR = 'D-Flow'
// 원 양식의 로고·CI 미디어 7종(sha256). 같은 바이트가 다시 들어오면 안 된다.
const LOGO_SHA256 = [
  '3796fb5ad82fb260d7dbfccd3d83209ce922df370aefab4282654bb6fdbc2913', // 고객사 로고
  'cb661ddc864ac1c7bfa6d7b43e227c8b40b416bd9fabfe94f5e8b18246185154', // 계열사 로고
  '55ba708e78d71bd82158f691e9b1de4a5b0b43ec5ae079249c637171afccce65', // 고객사 로고(소)
  'a2ad86b037ef0671f4cd65492470f9f07448d5d5f5454eb9ac0208092b60973a', // CI 'K' 워터마크
  'a2efb724e4ed1fe3cc940016013013eeef70e4a43fa45eabe8595406d2cd83de', // CI 적색 띠
  'c58bbe8c56a2a37ae8185dd661598f860c89208d3b1a3359f3ea69b7772a7099', // 기념 로고 표지 배경
  'a7ba002c8ab8de2abe681a4e2dc13b6ae9e78d1f611afcd9839a3cab8d43e109', // CI 'K' 그라데이션 패널
]
const BRAND_COLOR_RE = /\bval="(?:002452|C51F2A)"/i

const load = async (file: string) => JSZip.loadAsync(await readFile(`${ASSETS}/${file}`))
const text = (zip: JSZip, path: string) => zip.file(path)!.async('string')

const count = (xml: string, re: RegExp, id: string) =>
  (xml.match(re) ?? []).filter(el => shapeIdPattern(id).test(el)).length
const slideIds = (presentation: string) => presentation.match(/<p:sldId\b/g)?.length ?? 0
const paragraphs = (xml: string) =>
  (xml.match(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g) ?? []).map(p =>
    [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map(m => m[1]).join(''))
function cells(frameXml: string): string[][] {
  return (frameXml.match(TABLE_ROW_RE) ?? []).map(row => row.match(TABLE_CELL_RE) ?? [])
}
function frameById(slideXml: string, id: string): string {
  const frames = (slideXml.match(GRAPHIC_FRAME_RE) ?? []).filter(el => shapeIdPattern(id).test(el))
  expect(frames).toHaveLength(1)
  return frames[0]
}

describe.each(['weekly-template.pptx', 'issue-analysis-template.pptx'])('%s 중립성', file => {
  it('모든 zip 항목에 거부 목록 토큰이 없다', async () => {
    const zip = await load(file)
    const hits: string[] = []
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue
      const bytes = await entry.async('nodebuffer')
      for (const enc of ['utf8', 'utf16le'] as const) {
        const m = bytes.toString(enc).match(DENY_RE)
        if (m) hits.push(`${name} [${enc}]: ${m.length}건`)
      }
      if (TEXT_PART.test(name)) {
        const m = bytes.toString('utf8').match(DENY_WORD_RE)
        if (m) hits.push(`${name} [약칭]: ${m.length}건`)
      }
    }
    expect(hits).toEqual([])
  })

  it('원 로고·CI 미디어와 바이트가 같은 파일이 없다', async () => {
    const zip = await load(file)
    const media = Object.keys(zip.files).filter(name => name.startsWith('ppt/media/'))
    expect(media.length).toBeGreaterThan(0)
    for (const name of media) {
      const digest = createHash('sha256').update(await zip.file(name)!.async('nodebuffer')).digest('hex')
      expect(LOGO_SHA256, name).not.toContain(digest)
    }
  })

  it('표지 썸네일이 없고 문서 속성·테마 이름·브랜드 색이 중립이다', async () => {
    const zip = await load(file)
    expect(zip.file('docProps/thumbnail.jpeg')).toBeNull()
    expect(await text(zip, '_rels/.rels')).not.toContain('thumbnail')
    expect(await text(zip, '[Content_Types].xml')).not.toMatch(/Extension="jpe?g"/i)
    // 작성자·수정자는 중립값과 정확히 같아야 한다(원 작성자 계정을 거부 목록에 두지 않고 값으로 고정한다).
    const core = await text(zip, 'docProps/core.xml')
    const prop = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}\\b[^>]*>([^<]*)</${tag}>`))?.[1]
    expect(prop(core, 'dc:creator')).toBe(NEUTRAL_AUTHOR)
    expect(prop(core, 'cp:lastModifiedBy')).toBe(NEUTRAL_AUTHOR)
    expect(prop(core, 'cp:revision')).toBe('1')
    expect(core).not.toContain('cp:lastPrinted')
    // 원 작성 이력(편집 시간·단어/문단 수·회사명·최근 사용 색)도 남기지 않는다.
    const app = await text(zip, 'docProps/app.xml')
    for (const tag of ['TotalTime', 'Words', 'Paragraphs']) expect(prop(app, tag), tag).toBe('0')
    expect(prop(app, 'Company') ?? '').toBe('')
    expect(await text(zip, 'ppt/presProps.xml')).not.toContain('clrMru')
    const theme = await text(zip, 'ppt/theme/theme1.xml')
    expect(theme).toContain('<a:clrScheme name="D-Flow">')
    expect(theme).toContain('<a:fontScheme name="D-Flow">')
    const colored: string[] = []
    for (const [name, entry] of Object.entries(zip.files)) {
      if (!entry.dir && /\.xml$/.test(name) && BRAND_COLOR_RE.test(await entry.async('string'))) colored.push(name)
    }
    expect(colored).toEqual([])
  })
})

describe('weekly-template.pptx — templateFill 이 집는 구조', () => {
  it('슬라이드 2장, slide2 표는 3×3 이고 셀 스켈레톤(불릿·무불릿 문단)이 남아 있다', async () => {
    const zip = await load('weekly-template.pptx')
    expect(slideIds(await text(zip, 'ppt/presentation.xml'))).toBe(2)
    const slide2 = await text(zip, 'ppt/slides/slide2.xml')
    // templateFill cellAt/mapTableCell 과 같은 방식으로 행·셀을 센다.
    const grid = cells(slide2)
    expect(grid.map(row => row.length)).toEqual([3, 3, 3])
    expect(grid[1][1]).toContain('<a:buChar')
    expect(grid[1][1]).toContain('<a:buNone')
    expect(grid[2][2]).toContain('<a:buChar')
    expect(grid[0][1]).toMatch(/<a:pPr\b[\s\S]*?<\/a:pPr>/)
    expect(grid[0][1]).toMatch(/<a:rPr\b[\s\S]*?<\/a:rPr>/)
    // 연속 슬라이드 복제 시 지우는 think-cell 태그와 그 관계
    expect(slide2).toContain('<p:custDataLst>')
    expect(await text(zip, 'ppt/slides/_rels/slide2.xml.rels')).toMatch(/relationships\/tags"/)
  })

  it('slide2 표 본문은 중립 예시다', async () => {
    const slide2 = await text(await load('weekly-template.pptx'), 'ppt/slides/slide2.xml')
    const grid = cells(slide2)
    expect(paragraphs(grid[1][1])[0]).toMatch(/^예시 작업 1/)
    expect(paragraphs(grid[1][2])[0]).toMatch(/^예시 작업 4/)
    expect(paragraphs(grid[2][2])[0]).toContain('예시 이벤트')
  })
})

describe('issue-analysis-template.pptx — jszipRenderer 가 집는 구조', () => {
  // [슬라이드, 요소 정규식, id 목록] — 렌더러가 mapShape·singleElementById·deleteShapeOrConnector·deleteGroupShape 로
  // 정확히 1개를 요구하는 요소들(jszipRenderer.ts · processSlideRenderer.ts 의 id 상수).
  const SP_OR_CXN = new RegExp(`${SHAPE_RE.source}|${CONNECTOR_RE.source}`, 'g')
  const REQUIRED: Array<[number, RegExp, string[]]> = [
    [1, SHAPE_RE, ['2', '5']],
    [2, SHAPE_RE, ['16']], [4, SHAPE_RE, ['16']], [11, SHAPE_RE, ['16']],
    [3, SHAPE_RE, ['5', '6']],
    [5, SHAPE_RE, [
      '5', '6', '146', '145', '100', '116', '102', '111', '51', '70', '77', '103', '92',
      '128', '125', '135', '126', '134', '127', '129', '130', '108', '107',
    ]],
    [5, SP_OR_CXN, [
      '55', '60', '63', '66', '69', '73', '76', '83', '91', '95', '101', '105', '106', '114', '115', '117',
      '53', '54', '71', '72', '78', '79', '80', '86', '87', '93', '94', '107', '108', '109', '110', '113',
      '118', '119', '120', '121', '123', '136', '137', '139',
    ]],
    [5, CONNECTOR_RE, ['101']],
    [5, GROUP_SHAPE_RE, ['124']],
    [6, SHAPE_RE, ['5', '6', '146', '145', '100', '52', '49', '48', '56', '58', '60', '50', '57', '59', '61']],
    [6, CONNECTOR_RE, ['65', '66', '67', '68']],
    [8, SHAPE_RE, ['5', '6', '146', '100', '48', '49', '51', '53']],
    [9, SHAPE_RE, ['5', '6', '146', '100']],
    [10, SHAPE_RE, ['5', '6', '146', '100']],
    [12, SHAPE_RE, ['3', '6', '89', '45', '46', '54', '55']],
    [12, SP_OR_CXN, ['45', '46', '50', '54', '55', '57', '58', '60', '61', '63', '64', '71', '72', '73', '74']],
    [12, CONNECTOR_RE, ['71']],
    [12, GROUP_SHAPE_RE, ['47']],
  ]

  it('원본 슬라이드 12장(sourceSlide 1~12)이 그대로 있다', async () => {
    const zip = await load('issue-analysis-template.pptx')
    expect(slideIds(await text(zip, 'ppt/presentation.xml'))).toBe(12)
    for (let n = 1; n <= 12; n += 1) {
      expect(zip.file(`ppt/slides/slide${n}.xml`), `slide${n}`).not.toBeNull()
      expect(zip.file(`ppt/slides/_rels/slide${n}.xml.rels`), `slide${n} rels`).not.toBeNull()
    }
  })

  it.each(REQUIRED)('slide%i 에서 렌더러가 집는 요소가 정확히 1개씩 있다(%s)', async (n, re, ids) => {
    const xml = await text(await load('issue-analysis-template.pptx'), `ppt/slides/slide${n}.xml`)
    const counts = Object.fromEntries(ids.map(id => [id, count(xml, re, id)]))
    expect(counts).toEqual(Object.fromEntries(ids.map(id => [id, 1])))
  })

  it('이슈 표 행 수(용량+1)와 5열, 원인 표 2행이 그대로다', async () => {
    const zip = await load('issue-analysis-template.pptx')
    const tables = async (n: number) =>
      ((await text(zip, `ppt/slides/slide${n}.xml`)).match(GRAPHIC_FRAME_RE) ?? []).filter(el => el.includes('<a:tbl>'))
    // area-summary(8, 용량 3)·continuation(9, 용량 5): fillIssueTable 은 슬라이드의 유일한 표를 집는다.
    for (const [n, rows] of [[8, 4], [9, 6]] as const) {
      const [table, ...rest] = await tables(n)
      expect(rest).toHaveLength(0)
      expect(cells(table).map(row => row.length)).toEqual(Array(rows).fill(5))
    }
    const slide10 = await text(zip, 'ppt/slides/slide10.xml')
    expect(cells(frameById(slide10, '14')).map(row => row.length)).toEqual([5, 5])
    expect(cells(frameById(slide10, '13')).map(row => row.length)).toEqual([2, 2])
  })

  it('샘플 이슈 ID·본문은 중립 예시다', async () => {
    const zip = await load('issue-analysis-template.pptx')
    const idCells: string[] = []
    for (const [n, frame] of [[8, '54'], [9, '14'], [10, '14']] as const) {
      const grid = cells(frameById(await text(zip, `ppt/slides/slide${n}.xml`), frame))
      for (const row of grid.slice(1)) {
        idCells.push(paragraphs(row[0]).join(''))
        expect(paragraphs(row[1]).join(' ')).toMatch(/^예시 이슈 \d/)
      }
    }
    expect(idCells).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 3].map(n => `ISS-02-0${n}`))
  })
})
