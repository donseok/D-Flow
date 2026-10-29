// 표 칸 줄 서식(lineStyles) — 회사 양식 보기 칸에서 줄 종류별 문단 서식을 배워 두고, 보고서의 칸 줄에 입힌다.
// 줄 배치(rowLayout) — 한 장의 데이터 영역에 건을 내용 줄 수로 담고 행 높이를 나눈다(사람이 긴 건은 한 장에 하나로 쓰는 꼴).
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  LINE_STYLE_URI, applyLineStyles, attachPalette, classifyLines, learnPalette, rowLayoutOf,
} from '@/lib/report/engine/lineStyles'
import { autoTokenizeTemplate } from '@/lib/report/forms/autoTokens'
import { deckOrder, renderPptx } from '@/lib/report/engine/pptx'
import { weeklyCatalogTasks } from '@/lib/report/catalog/weeklyBuild'
import type { CatalogModel } from '@/lib/report/catalog/types'

const TITLE = '<a:pPr marL="0" indent="0"><a:buNone/></a:pPr>'
const LABEL = '<a:pPr marL="92075" lvl="1"><a:buFont typeface="Wingdings"/><a:buChar char="§"/></a:pPr>'
const ITEM = '<a:pPr marL="257175" lvl="1" indent="-171450"><a:buChar char="–"/></a:pPr>'
const SUB = '<a:pPr marL="85725" lvl="1" indent="0"><a:buNone/></a:pPr>'
const RPR = '<a:rPr lang="ko-KR" sz="1200"/>'
const para = (pPr: string, text: string) => `<a:p>${pPr}<a:r>${RPR}<a:t>${text}</a:t></a:r></a:p>`
const tc = (paras: string, tcPr = '<a:tcPr anchor="t"/>') => `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${paras}</a:txBody>${tcPr}</a:tc>`

/** 사람이 쓴 보기 칸 — 제목, ● 항목 이름(서식 글머리), 값이 빈 "수행실적:" 아래의 – 세부(서식 글머리), ㄴ 하위 */
const humanCell = () => tc([
  para(TITLE, '[통합관제] 크레인 제한'),
  para(LABEL, ' 목적 : 26t 이상 제한'),
  para(LABEL, ' 일정 : 10/01 ~ 10/13'),
  para(LABEL, ' 수행실적:'),
  para(ITEM, '프로그램 개발 및 테스트'),
  para(SUB, '    ㄴ 이송스케줄 유효성'),
  para(ITEM, '운영계 반영 (10/13)'),
].join(''))

const texts = (xml: string) => [...xml.matchAll(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g)].map((m) => [...m[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(''))
const pPrs = (xml: string) => [...xml.matchAll(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g)].map((m) => /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(m[0])?.[0] ?? '')

describe('classifyLines — 사람이 칸을 쓰는 줄 종류', () => {
  it('제목·항목 이름·세부·하위를 앞 줄 문맥과 함께 가른다', () => {
    expect(classifyLines([
      '[생산계획] 간트 연동',
      '  ▪ 목적 : 라미나 연계',
      ' 담당자 : 김민준',
      ' 수행실적:',
      '운영계 반영(10/06)',        // 값이 빈 항목 이름 아래 → 세부
      '–  프로그램 개발',
      '    ㄴ 구매 라미나 입고',
      '    확정하는 일자로 변경',   // 하위 줄이 접혀 이어진 줄 → 하위
      '–. 스마트물류 2-2단계',
      '    ┕ B-34호 가동',
      '수행계획',                    // 이름만 있는 항목 이름
      '모니터링',
      '[다음 건] 제목',
      '그냥 글',                     // 제목 뒤 열린 항목 이름이 없으면 본문
    ])).toEqual(['title', 'label', 'label', 'label', 'item', 'item', 'sub', 'sub', 'item', 'sub', 'label', 'item', 'title', 'body'])
  })
})

describe('learnPalette · applyLineStyles', () => {
  it('보기 칸에서 종류마다 가장 흔한 서식을 배우고, 글자로 적은 글머리는 서식 글머리일 때 지운다', () => {
    const minority = tc([para('<a:pPr marL="0"/>', '[분류] 제목'), para('<a:pPr marL="0"/>', '  ▪ 목적 : 글자 글머리')].join(''))
    const palette = learnPalette([humanCell(), humanCell(), minority])
    expect(palette.title?.pPr).toBe(TITLE)
    expect(palette.label).toMatchObject({ pPr: LABEL, lead: 1, auto: true })
    expect(palette.item).toMatchObject({ pPr: ITEM, lead: 0, auto: true })
    expect(palette.sub).toMatchObject({ pPr: SUB, lead: 4, auto: false })
    expect(palette.body).toBeUndefined()

    // 엔진이 웹 줄로 그린 칸(모든 줄이 토큰 문단의 서식) → 줄 종류별 서식
    const plain = '<a:pPr marL="0"/>'
    const rendered = attachPalette(tc([
      para(plain, '[구내운송] 세로고정 상차'),
      para(plain, '  ▪ 목적 : 상차위치 방지'),
      para(plain, ' 담당자 : 유남'),
      para(plain, ' 수행실적:'),
      para(plain, '운영계 반영(10/06)'),
      para(plain, '–  프로그램 개발'),
      para(plain, 'ㄴ 코일 이송 & 제한'),
    ].join('')), palette)
    expect(rendered).toContain(LINE_STYLE_URI)
    const out = applyLineStyles(`<a:tbl><a:tr h="1">${rendered}</a:tr></a:tbl>`)
    expect(out).not.toContain(LINE_STYLE_URI)
    expect(out).not.toContain('<a:extLst>')
    expect(texts(out)).toEqual([
      '[구내운송] 세로고정 상차',
      ' 목적 : 상차위치 방지',         // 글자 ▪ 는 지우고 서식 글머리(§)가 붙는다, 앞 공백은 표본처럼 한 칸
      ' 담당자 : 유남',
      ' 수행실적:',
      '운영계 반영(10/06)',
      '프로그램 개발',                 // 글자 – 는 지우고 서식 글머리(–)
      '    ㄴ 코일 이송 &amp; 제한',   // 하위 줄은 표본처럼 네 칸 들여쓴다
    ])
    expect(pPrs(out)).toEqual([TITLE, LABEL, LABEL, LABEL, ITEM, ITEM, SUB])
  })

  it('attachPalette 는 tcPr 모양(자기 닫힘·자식 있음·없음)마다 extLst 를 마지막 자식으로 둔다', () => {
    const palette = learnPalette([humanCell()])
    const a = attachPalette(tc(para(TITLE, 'x')), palette)
    expect(a).toMatch(/<a:tcPr anchor="t"><a:extLst><a:ext uri="\{5B0F7C3E-[^"]+"><dfl:lineStyles [^>]*>[\s\S]*<\/a:extLst><\/a:tcPr><\/a:tc>$/)
    const b = attachPalette(tc(para(TITLE, 'x'), '<a:tcPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:tcPr>'), palette)
    expect(b).toMatch(/<\/a:solidFill><a:extLst>[\s\S]*<\/a:extLst><\/a:tcPr><\/a:tc>$/)
    const c = attachPalette(tc(para(TITLE, 'x'), ''), palette)
    expect(c).toMatch(/<\/a:txBody><a:tcPr><a:extLst>[\s\S]*<\/a:extLst><\/a:tcPr><\/a:tc>$/)
    // 다시 붙이면 바꾼다(겹치지 않는다)
    expect(attachPalette(a, palette).split(LINE_STYLE_URI)).toHaveLength(2)
    // 팔레트가 없는 칸은 그대로
    const none = tc(para(TITLE, 'x'))
    expect(applyLineStyles(none)).toBe(none)
  })

  it('rowLayoutOf 는 줄 배치 힌트(데이터 영역·글자 크기)가 있을 때만 값을 준다', () => {
    const palette = learnPalette([humanCell()])
    expect(rowLayoutOf(`<a:tr>${attachPalette(tc(para(TITLE, 'x')), palette)}</a:tr>`)).toBeNull()
    const row = `<a:tr>${attachPalette(tc(para(TITLE, 'x')), palette, { area: 4991456, fontSize: 1200 })}</a:tr>`
    expect(rowLayoutOf(row)).toEqual({ area: 4991456, line: 12 * 12700 * 1.3, pad: 91440 })
  })
})

describe('두 열 양식 → 보고서 — 사람이 쓴 꼴(줄 서식·한 장 배치)', () => {
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
  const headerCell = (text: string) => tc(para('<a:pPr algn="ctr"><a:buNone/></a:pPr>', text))
  const table = (rows: string[]) => `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/>`
    + `<a:tblGrid><a:gridCol w="4500000"/><a:gridCol w="4500000"/></a:tblGrid>${rows.join('')}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
  const slide = (body: string) => `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
  async function pack(): Promise<Uint8Array> {
    const zip = new JSZip()
    const xml = slide(table([
      `<a:tr h="337135">${headerCell('금주 (2026.10.05~2026.10.16) 실적')}${headerCell('차주 (2026.10.19~2026.10.23) 계획')}</a:tr>`,
      `<a:tr h="2250347">${humanCell()}${humanCell()}</a:tr>`,
      `<a:tr h="2741109">${humanCell()}${tc(para(TITLE, ''))}</a:tr>`,
    ]))
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('ppt/presentation.xml', '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')
    zip.file('ppt/_rels/presentation.xml.rels', `<Relationships><Relationship Id="rId1" Type="${REL}/slide" Target="slides/slide1.xml"/></Relationships>`)
    zip.file('ppt/slides/slide1.xml', xml)
    return zip.generateAsync({ type: 'uint8array' })
  }

  it('웹 글에 보기 칸의 줄 서식을 입히고, 짧은 건은 둘씩 같은 높이로 · 옆 건과 합치면 한 장을 넘는 긴 건은 혼자 한 장으로 놓는다', async () => {
    const r = await autoTokenizeTemplate(await pack(), 'weekly_report_pptx')
    expect(r.changed).toBe(true)
    if (!r.changed) return
    expect(r.detection.lineStyles).toEqual(['title', 'label', 'item', 'sub'])
    const short = (n: number) => `[구내운송] 짧은 건 ${n}\n 목적 : 방지\n 수행실적:\n운영계 반영`
    const long = ['[스마트물류-SM] 긴 건', ' 목적 : 운영', ' 수행실적', ...Array.from({ length: 19 }, (_, i) => `–  항목 ${i + 1}`)].join('\n')
    const tasks = weeklyCatalogTasks(
      [{ id: '1', reportId: 'w', areaId: 'a', thisContent: [short(1), short(2), long, short(3)].join('\n\n'), nextContent: short(1), thisIssue: '', nextIssue: '' }],
      [{ id: 'a', code: '001', name: '구내운송', sortOrder: 1, active: true, teams: [] }],
    )
    const model = { report: { week_range_ymd: 'A', next_week_range_ymd: 'B' }, kpi: {}, sections: [], tasks } as unknown as CatalogModel
    const out = await renderPptx(r.bytes, model, {}, {
      max_lines_per_cell: r.detection.linesPerCell, max_rows_per_slide: r.detection.rowsPerSlide, item_cap: 0, empty_text: '', continuation_label: '(계속)',
    })
    const zip = await JSZip.loadAsync(out)
    const slides = await Promise.all((await deckOrder(zip)).map((n) => zip.file(n)!.async('string')))
    expect(slides).toHaveLength(3)
    const rowsOf = (xml: string) => [...xml.matchAll(/<a:tr h="(\d+)">([\s\S]*?)<\/a:tr>/g)].map((m) => ({ h: Number(m[1]), xml: m[2] }))
    const area = 2250347 + 2741109
    // 1장: 짧은 건 둘 — 데이터 영역을 반씩
    const first = rowsOf(slides[0]).slice(1)
    expect(first.map((row) => row.h)).toEqual([area / 2, area / 2])
    expect(texts(first[0].xml)).toEqual(['[구내운송] 짧은 건 1', ' 목적 : 방지', ' 수행실적:', '운영계 반영', '[구내운송] 짧은 건 1', ' 목적 : 방지', ' 수행실적:', '운영계 반영'])
    expect(pPrs(first[0].xml).slice(0, 4)).toEqual([TITLE, LABEL, LABEL, ITEM])
    // 2장: 다음 건과 합치면 한 장(24줄)을 넘는 긴 건(22줄)은 혼자, 한 장 전체 높이
    const second = rowsOf(slides[1]).slice(1)
    expect(second).toHaveLength(1)
    expect(second[0].h).toBe(area)
    expect(texts(second[0].xml)).toContain('항목 19')
    expect(second[0].xml).not.toContain('(계속)')
    // 3장: 남은 짧은 건 하나 — 한 장 전체
    expect(rowsOf(slides[2]).slice(1).map((row) => row.h)).toEqual([area])
    for (const xml of slides) {
      expect(xml).not.toContain(LINE_STYLE_URI)
      expect(xml).not.toContain('{{')
    }
  })
})
