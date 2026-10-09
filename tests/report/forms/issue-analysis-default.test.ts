// 제품 기본 이슈 분석서 양식(assets/default/issue_analysis_pptx.pptx — scripts/forms/build-defaults.mjs 가 만든다).
// 구성: 표지 → 영역별 종합 → 영역별 이슈 목록 → 영역별 원인 분석 → 영역별 개선기회. 영역마다 한 장(넘치면 이어지는 장)이고
// 이슈·개선기회가 행, 이슈의 원인들·개선기회의 연결 이슈들이 그 행의 셀 안 목록이다. 제품 고정 슬라이드(프로세스 체계도)는 없다
// (docs/baseline/sp6-issue-analysis-decision.md).
import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RENDER_OPTIONS, engineFor, validatePlaceholders } from '@/lib/report/engine'
import { emptyIssueAnalysisCatalog } from '@/lib/report/catalog/issueAnalysisBuild'
import type {
  IssueAnalysisCatalogArea, IssueAnalysisCatalogIssue, IssueAnalysisCatalogModel, IssueAnalysisCatalogOpportunity,
} from '@/lib/report/catalog/types'
import { defaultFormAssetPath } from '@/lib/report/forms/loadTemplate'
import { SENTINELS_BY_SP, findSentinels, zipTextParts } from '../../fixtures/legacy-sentinels'

const OPTIONS = DEFAULT_RENDER_OPTIONS.issue_analysis_pptx
const engine = engineFor('pptx')
const template = async () => new Uint8Array(await readFile(defaultFormAssetPath('issue_analysis_pptx')))

const issue = (code: string, over: Partial<IssueAnalysisCatalogIssue> = {}): IssueAnalysisCatalogIssue => ({
  code, title: `${code} 제목`, body: `${code} 본문`, sub_process: '', owner_department: `${code} 부서`,
  status: 'open', status_code: 'open', status_label: '열림', custom: {}, severity: 'high', severity_label: '높음',
  related_systems: [], source_lines: [],
  causes: [{ category: 'process', category_label: '절차', direct_cause: `${code} 직접 원인`, root_cause: `${code} 근본 원인` }],
  ...over,
})
const area = (
  code: string, name: string, issues: IssueAnalysisCatalogIssue[],
  opportunities: IssueAnalysisCatalogOpportunity[] = [],
): IssueAnalysisCatalogArea => ({
  code, name, issues, opportunities,
  summary: {
    total_count: issues.length,
    status: { open: issues.length, in_progress: 0, resolved: 0, on_hold: 0 },
    severity_counts: [{ code: 'high', label: '높음', count: issues.length }, { code: 'low', label: '낮음', count: 0 }],
    owner_departments: issues.map((i) => i.owner_department),
    related_systems: [`${name} 시스템`],
  },
})
/** 영역 목록에서 평탄화 목록과 요약을 만든다(카탈로그 빌더와 같은 모양) */
function model(areas: IssueAnalysisCatalogArea[]): IssueAnalysisCatalogModel {
  return {
    summary: {
      project_name: '합성 프로젝트', author_name: '작성자 갑', author_team: 'T1', generated_at: '2026-10-08T00:00:00Z',
      date_label: '26.10.08', issue_count: areas.reduce((n, a) => n + a.issues.length, 0), area_count: areas.length,
    },
    areas,
    issues: areas.flatMap((a) => a.issues.map((i) => ({ ...i, area_code: a.code, area_name: a.name }))),
    opportunities: areas.flatMap((a) => a.opportunities.map((o) => ({ ...o, area_code: a.code, area_name: a.name }))),
  }
}
/** 영역 3개·이슈 5건·원인·개선기회 3건 */
const rich = () => model([
  area('A1', '기획 영역', [issue('ISS-001'), issue('ISS-002')], [{
    no: 1, title: '검토 절차 통합', description: '검토 단계를 하나로 묶는다.',
    issues: [{ code: 'ISS-001', title: 'ISS-001 제목' }, { code: 'ISS-002', title: 'ISS-002 제목' }],
  }]),
  area('A2', '실행 영역', [issue('ISS-003', { severity_label: '보통', status_label: '진행중' }), issue('ISS-004')], [{
    no: 1, title: '일정 공유 자동화', description: '일정 변경을 자동으로 알린다.', issues: [{ code: 'ISS-004', title: 'ISS-004 제목' }],
  }]),
  area('A3', '지원 영역', [issue('ISS-005', {
    causes: [
      { category: 'process', category_label: '절차', direct_cause: '담당이 정해지지 않았다', root_cause: '역할 정의가 없다' },
      { category: 'tool', category_label: '도구', direct_cause: '알림이 가지 않는다', root_cause: '추가 확인 필요' },
    ],
  })], [{ no: 1, title: '담당 지정', description: '요청마다 담당을 정한다.', issues: [{ code: 'ISS-005', title: 'ISS-005 제목' }] }]),
])

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
/** 덱 순서대로 슬라이드의 문단 텍스트 */
async function slideTexts(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes)
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])![1], /Target="([^"]+)"/.exec(m[0])![1]]))
  const pres = await zip.file('ppt/presentation.xml')!.async('string')
  const order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => `ppt/${target.get(m[1])}`)
  return Promise.all(order.map(async (path) => {
    const xml = await zip.file(path)!.async('string')
    return [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t\b[^>]*>([^<]*)<\/a:t>/g)].map((t) => decode(t[1])).join(''))
      .join('\n')
  }))
}
/** 덱 순서대로 슬라이드의 표 — 행 → 셀 → 문단 텍스트 */
async function slideTables(bytes: Uint8Array): Promise<string[][][][]> {
  const zip = await JSZip.loadAsync(bytes)
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')!.async('string')
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])![1], /Target="([^"]+)"/.exec(m[0])![1]]))
  const pres = await zip.file('ppt/presentation.xml')!.async('string')
  const order = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => `ppt/${target.get(m[1])}`)
  return Promise.all(order.map(async (path) => {
    const xml = await zip.file(path)!.async('string')
    return [...xml.matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)].map((tr) =>
      [...tr[1].matchAll(/<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/g)].map((tc) =>
        [...tc[1].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map((p) => [...p[1].matchAll(/<a:t\b[^>]*>([^<]*)<\/a:t>/g)].map((t) => decode(t[1])).join(''))))
  }))
}
const render = async (m: IssueAnalysisCatalogModel, options = OPTIONS) => engine.render(await template(), m, {}, options)

describe('기본 이슈 분석서 양식 — 스캔', () => {
  it('미지 토큰 0 — 스캔·카탈로그 검증 지적이 없고 자리표시자가 다섯 장에 걸쳐 있다', async () => {
    const scan = await engine.scan(await template())
    expect(scan.issues).toEqual([])
    expect(validatePlaceholders(scan.placeholders, 'issue_analysis_pptx', {})).toEqual([])
    expect([...new Set(scan.placeholders.map((p) => p.location.slide))]).toEqual([1, 2, 3, 4, 5])
    const blocks = scan.placeholders.filter((p) => p.kind !== 'value').map((p) => [p.location.slide, [...p.scope, p.token].join('/')])
    expect(blocks).toEqual([
      [2, '{{#rows areas}}'],
      [3, '{{#slide areas}}'],
      [3, '{{#slide areas}}/{{#items .summary.severity_counts}}'],
      [3, '{{#slide areas}}/{{#rows .issues}}'],
      [4, '{{#slide areas}}'],
      [4, '{{#slide areas}}/{{#rows .issues}}'],
      [4, '{{#slide areas}}/{{#rows .issues}}/{{#items .causes}}'],
      [5, '{{#slide areas}}'],
      [5, '{{#slide areas}}/{{#rows .opportunities}}'],
      [5, '{{#slide areas}}/{{#rows .opportunities}}/{{#items .issues}}'],
    ])
  })

  it('양식 문구에 지운 원본의 샘플 문구·방법론 용어가 없다', async () => {
    const hits = (await zipTextParts(await template())).flatMap((p) => findSentinels(p.text, SENTINELS_BY_SP.SP6).map((w) => `${p.name}: ${w}`))
    expect(hits).toEqual([])
  })
})

describe('기본 이슈 분석서 양식 — 렌더', () => {
  it('영역 3개·이슈 5건·원인·개선기회가 표지 → 영역별 종합 → 이슈 목록 → 원인 분석 → 개선기회 순으로, 영역마다 한 장씩 실린다', async () => {
    const slides = await slideTexts(await render(rich()))
    expect(slides).toHaveLength(1 + 1 + 3 + 3 + 3)
    const [cover, overview, ...rest] = slides
    expect(cover).toContain('합성 프로젝트 · 이슈 분석')
    expect(cover).toContain('26.10.08 | 영역 3개 · 전체 5건')
    expect(cover).toContain('작성 작성자 갑')
    for (const name of ['A1 기획 영역', 'A2 실행 영역', 'A3 지원 영역']) expect(overview).toContain(name)
    expect(overview).toContain('영역별 종합')
    expect(overview).toContain('ISS-005 부서')          // 주관 부서
    expect(overview).toContain('지원 영역 시스템')       // 관련 시스템

    const areaSlides = rest.slice(0, 3)
    expect(areaSlides[0]).toContain('A1 기획 영역 · 이슈 목록')
    expect(areaSlides[0]).toContain('전체 2건 | 열림 2 · 진행중 0 · 해결 0 · 보류 0')
    expect(areaSlides[0]).toContain('높음 2건')
    expect(areaSlides[0]).toContain('낮음 0건')
    for (const text of ['ISS-001', 'ISS-001 제목', 'ISS-001 본문', 'ISS-002 본문']) expect(areaSlides[0]).toContain(text)
    expect(areaSlides[1]).toContain('ISS-003')
    expect(areaSlides[1]).toContain('보통')
    expect(areaSlides[1]).toContain('진행중')
    expect(areaSlides[2]).toContain('ISS-005 본문')

    // 원인 분석 — 영역마다 한 장, 이슈가 행, 그 이슈의 원인이 셀 안 문단 둘씩
    const causeSlides = rest.slice(3, 6)
    expect(causeSlides.map((s) => s.split('\n')[0])).toEqual(['A1 기획 영역', 'A2 실행 영역', 'A3 지원 영역'].map((n) => `${n} · 원인 분석 `))
    expect(causeSlides[0]).toContain('전체 2건 | 열림 2 · 진행중 0 · 해결 0 · 보류 0')
    expect(causeSlides[0]).toContain([
      'ISS-001', 'ISS-001 제목', '[절차] ISS-001 직접 원인', '근본 원인: ISS-001 근본 원인',
      'ISS-002', 'ISS-002 제목', '[절차] ISS-002 직접 원인', '근본 원인: ISS-002 근본 원인',
    ].join('\n'))
    expect(causeSlides[2]).toContain([
      'ISS-005', 'ISS-005 제목', '[절차] 담당이 정해지지 않았다', '근본 원인: 역할 정의가 없다', '[도구] 알림이 가지 않는다', '근본 원인: 추가 확인 필요',
    ].join('\n'))

    // 개선기회 — 영역마다 한 장, 개선기회가 행, 연결 이슈가 셀 안 문단
    const opportunitySlides = rest.slice(6)
    expect(opportunitySlides.map((s) => s.split('\n')[0])).toEqual(['A1 기획 영역', 'A2 실행 영역', 'A3 지원 영역'].map((n) => `${n} · 개선기회 `))
    expect(opportunitySlides[0]).toContain(['1', '검토 절차 통합', '검토 단계를 하나로 묶는다.', 'ISS-001 ISS-001 제목', 'ISS-002 ISS-002 제목'].join('\n'))
    expect(opportunitySlides[1]).toContain(['1', '일정 공유 자동화', '일정 변경을 자동으로 알린다.', 'ISS-004 ISS-004 제목'].join('\n'))
    expect(opportunitySlides[2]).toContain('담당 지정')

    expect(slides.join('\n')).not.toContain('{{')
    expect(slides.at(-1)).toContain(`${slides.length} / ${slides.length}`)   // 쪽 번호
  })

  it('영역 2개 × 이슈 12건·1건, 원인 0~3개 — 원인 분석은 영역당 한 장에서 행 상한(5)마다 이어지는 장으로 넘기고 이슈·원인을 하나도 잃지 않는다', async () => {
    const causesOf = (code: string, count: number) => Array.from({ length: count }, (_, n) => ({
      category: 'process', category_label: '절차', direct_cause: `${code} 직접 ${n + 1}`, root_cause: `${code} 근본 ${n + 1}`,
    }))
    const first = Array.from({ length: 12 }, (_, n) => `ISS-${String(n + 1).padStart(3, '0')}`)
    const data = model([
      area('A1', '기획 영역', first.map((code, n) => issue(code, { causes: causesOf(code, n % 4) }))),   // 원인 0·1·2·3개가 번갈아
      area('A2', '실행 영역', [issue('ISS-101', { causes: causesOf('ISS-101', 3) })]),
    ])
    const bytes = await render(data)
    const texts = await slideTexts(bytes)
    const tables = await slideTables(bytes)
    const at = texts.flatMap((text, index) => (text.includes(' · 원인 분석 ') ? [index] : []))
    expect(at.map((index) => texts[index].split('\n')[0])).toEqual([
      'A1 기획 영역 · 원인 분석 ', `A1 기획 영역 · 원인 분석 ${OPTIONS.continuation_label}`, `A1 기획 영역 · 원인 분석 ${OPTIONS.continuation_label}`,
      'A2 실행 영역 · 원인 분석 ',
    ])
    const pages = at.map((index) => tables[index])
    for (const page of pages) expect(page[0].map((c) => c[0])).toEqual(['코드', '이슈', '원인 — [분류] 직접 원인 / 근본 원인'])   // 머리 행은 장마다
    expect(pages.map((page) => page.length - 1)).toEqual([5, 5, 2, 1])
    const rows = pages.flatMap((page) => page.slice(1))
    expect(rows.map((row) => row[0][0])).toEqual([...first, 'ISS-101'])                       // 이슈마다 한 행, 순서 그대로
    expect(rows.map((row) => row[1][0])).toEqual([...first, 'ISS-101'].map((code) => `${code} 제목`))
    const everyIssue = data.areas.flatMap((a) => a.issues)
    expect(rows.map((row) => row[2])).toEqual(everyIssue.map((i) => (
      i.causes.length ? i.causes.flatMap((c) => [`[${c.category_label}] ${c.direct_cause}`, `근본 원인: ${c.root_cause}`]) : ['']   // 원인 0건 — 빈 문단 하나
    )))
    expect(texts.join('\n')).not.toContain('{{')
  })

  it('원인이 한 셀의 줄 예산(15)을 넘는 이슈는 연속 행으로 나뉘고, 원인 문단은 한 번씩 그대로 실린다', async () => {
    const many = Array.from({ length: 12 }, (_, n) => ({ category: 'process', category_label: '절차', direct_cause: `직접 원인 ${n + 1}번`, root_cause: `근본 원인 ${n + 1}번` }))
    const bytes = await render(model([area('A1', '기획 영역', [issue('ISS-001', { causes: many }), issue('ISS-002')])]))
    const texts = await slideTexts(bytes)
    const tables = await slideTables(bytes)
    const rows = texts.flatMap((text, index) => (text.includes(' · 원인 분석 ') ? tables[index].slice(1) : []))
    expect(rows.map((row) => row[0][0])).toEqual([`ISS-001 ${OPTIONS.continuation_label} 1/2`, `${OPTIONS.continuation_label} 2/2`, 'ISS-002'])
    expect(rows.slice(0, 2).map((row) => row[2].length)).toEqual([15, 9])   // 24문단 — 문단 경계에서만 나뉜다
    expect(rows.slice(0, 2).flatMap((row) => row[2])).toEqual(many.flatMap((c) => [`[절차] ${c.direct_cause}`, `근본 원인: ${c.root_cause}`]))
  })

  it('렌더 결과에 미치환 토큰이 없고, 지운 원본의 샘플 문구·방법론 용어도 없다', async () => {
    const bytes = await render(rich())
    const scan = await engine.scan(bytes)
    expect(scan.issues).toEqual([])
    expect(scan.placeholders).toEqual([])
    const hits = (await zipTextParts(bytes)).flatMap((p) => findSentinels(p.text, SENTINELS_BY_SP.SP6).map((w) => `${p.name}: ${w}`))
    expect(hits).toEqual([])
  })

  it('원인·개선기회가 0건이어도 렌더된다 — 원인 분석은 이슈 행에 빈 원인 칸, 개선기회 표는 머리 행만', async () => {
    const bare = model([
      area('A1', '기획 영역', [issue('ISS-001', { causes: [] }), issue('ISS-002', { causes: [] })]),
      area('A2', '실행 영역', [issue('ISS-003', { causes: [] })]),
    ])
    const bytes = await render(bare)
    const slides = await slideTexts(bytes)
    const tables = await slideTables(bytes)
    expect(slides).toHaveLength(1 + 1 + 2 + 2 + 2)
    expect(slides.join('\n')).not.toContain('{{')
    expect(slides[4]).toContain('A1 기획 영역 · 원인 분석')
    expect(tables[4].slice(1)).toEqual([[['ISS-001'], ['ISS-001 제목'], ['']], [['ISS-002'], ['ISS-002 제목'], ['']]])
    // 저장 실행은 이슈가 있는 영역마다 개선기회를 하나 이상 요구한다(storedRun) — 이 경우는 양식을 직접 쓰는 호출에서만 생긴다
    expect(slides[6]).toContain('A1 기획 영역 · 개선기회')
    expect(tables[6]).toHaveLength(1)
    expect(tables[7]).toHaveLength(1)
  })

  it('저장 실행이 필요 없는 빈 모델도 렌더된다 — 표지와 영역별 종합(행 없음)만 남는다', async () => {
    const slides = await slideTexts(await render(emptyIssueAnalysisCatalog()))
    expect(slides).toHaveLength(2)
    expect(slides.join('\n')).not.toContain('{{')
  })

  it('영역 12개 — 영역별 종합이 행 상한(5)으로 세 장에 나뉘고 영역을 하나도 잃지 않는다', async () => {
    const many = model(Array.from({ length: 12 }, (_, n) => area(`A${n + 1}`, `영역 ${n + 1}번`, [issue(`ISS-${n + 1}`)])))
    const slides = await slideTexts(await render(many))
    expect(slides).toHaveLength(1 + 3 + 12 + 12 + 12)
    const overview = slides.slice(1, 4)
    expect(overview[0]).toContain('영역별 종합')
    expect(overview[0]).not.toContain(OPTIONS.continuation_label)
    expect(overview[1]).toContain(`영역별 종합 ${OPTIONS.continuation_label}`)
    expect(overview[2]).toContain(`영역별 종합 ${OPTIONS.continuation_label}`)
    for (const page of overview) expect(page).toContain('주관 부서')   // 머리 행은 장마다 반복
    const names = (page: string) => [...page.matchAll(/A\d+ 영역 (\d+)번/g)].map((m) => Number(m[1]))
    expect(overview.map((page) => names(page).length)).toEqual([5, 5, 2])
    expect(overview.flatMap(names)).toEqual(Array.from({ length: 12 }, (_, n) => n + 1))
    expect(slides.slice(4, 16).map((s) => s.split('\n')[0])).toEqual(many.areas.map((a) => `${a.code} ${a.name} · 이슈 목록 `))
  })

  it('긴 본문(20,000자)·긴 원인 — 연속 행·연속 장으로 나뉘고 원문을 잃지 않는다', async () => {
    const body = `${'가나다라마바사아자차 '.repeat(1_818)}BODY-END`
    const direct = `${'원인 서술 문장입니다. '.repeat(120)}CAUSE-END`
    const long = model([area('A1', '기획 영역', [issue('ISS-001', {
      body, causes: [{ category: 'process', category_label: '절차', direct_cause: direct, root_cause: '짧은 근본 원인' }],
    })])])
    expect(body.length).toBeGreaterThanOrEqual(20_000)
    const bytes = await render(long)
    const slides = await slideTexts(bytes)
    const areaSlides = slides.filter((s) => s.startsWith('A1 기획 영역 · 이슈 목록'))
    expect(areaSlides.length).toBeGreaterThan(1)
    expect(areaSlides[1]).toContain(OPTIONS.continuation_label)
    const squash = (s: string) => s.replace(/\s+/g, '')
    const joined = squash(areaSlides.join(''))
    expect(joined).toContain('BODY-END')
    expect(joined.split('가나다라마바사아자차').length - 1).toBe(1_818)       // 본문 조각을 이으면 반복 횟수가 그대로다
    // 원인 칸만 이어 붙이면 원문 그대로다 — 조각 사이에 다른 칸의 글이 끼지 않게 표에서 그 열만 읽는다
    const tables = await slideTables(bytes)
    const causeRows = slides.flatMap((text, index) => (text.startsWith('A1 기획 영역 · 원인 분석') ? tables[index].slice(1) : []))
    expect(causeRows.length).toBeGreaterThan(1)
    expect(causeRows[0][0][0]).toBe(`ISS-001 ${OPTIONS.continuation_label} 1/${causeRows.length}`)
    expect(squash(causeRows.flatMap((row) => row[2]).join(''))).toBe(squash(`[절차] ${direct}근본 원인: 짧은 근본 원인`))
    expect(slides.join('\n')).not.toContain('{{')
  })

  it('행 상한을 프로젝트 옵션으로 바꾸면 그 값으로 나뉜다', async () => {
    const many = model([area('A1', '기획 영역', Array.from({ length: 7 }, (_, n) => issue(`ISS-${n + 1}`)))])
    const slides = await slideTexts(await render(many, { ...OPTIONS, max_rows_per_slide: 3 }))
    expect(slides.filter((s) => s.startsWith('A1 기획 영역 · 이슈 목록'))).toHaveLength(3)
  })
})
