// 제품 기본 이슈 분석서 양식(assets/default/issue_analysis_pptx.pptx — scripts/forms/build-defaults.mjs 가 만든다).
// 구성: 표지 → 영역별 종합 → 영역별 이슈 목록 → 이슈별 원인 분석 → 개선기회. 제품 고정 슬라이드(프로세스 체계도)는 없다
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
/** 영역 3개·이슈 5건·원인·개선기회 2건 */
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
  })]),
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
      [4, '{{#slide issues}}'],
      [4, '{{#slide issues}}/{{#rows .causes}}'],
      [5, '{{#slide opportunities}}'],
      [5, '{{#slide opportunities}}/{{#rows .issues}}'],
    ])
  })

  it('양식 문구에 지운 원본의 샘플 문구·방법론 용어가 없다', async () => {
    const hits = (await zipTextParts(await template())).flatMap((p) => findSentinels(p.text, SENTINELS_BY_SP.SP6).map((w) => `${p.name}: ${w}`))
    expect(hits).toEqual([])
  })
})

describe('기본 이슈 분석서 양식 — 렌더', () => {
  it('영역 3개·이슈 5건·원인·개선기회가 표지 → 영역별 종합 → 이슈 목록 → 원인 분석 → 개선기회 순으로 실린다', async () => {
    const slides = await slideTexts(await render(rich()))
    expect(slides).toHaveLength(1 + 1 + 3 + 5 + 2)
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

    const causeSlides = rest.slice(3, 8)
    expect(causeSlides.map((s) => s.split('\n')[0].trim())).toEqual(['ISS-001', 'ISS-002', 'ISS-003', 'ISS-004', 'ISS-005'].map((c) => `${c} · 원인 분석`))
    expect(causeSlides[0]).toContain('A1 기획 영역 | 심각도 높음 · 상태 열림')
    expect(causeSlides[0]).toContain('ISS-001 직접 원인')
    expect(causeSlides[0]).toContain('ISS-001 근본 원인')
    for (const text of ['절차', '담당이 정해지지 않았다', '역할 정의가 없다', '도구', '알림이 가지 않는다', '추가 확인 필요']) expect(causeSlides[4]).toContain(text)

    const opportunitySlides = rest.slice(8)
    expect(opportunitySlides[0]).toContain('개선기회 1 · 검토 절차 통합')
    expect(opportunitySlides[0]).toContain('A1 기획 영역')
    expect(opportunitySlides[0]).toContain('검토 단계를 하나로 묶는다.')
    expect(opportunitySlides[0]).toContain('연결 이슈 ISS-001')
    expect(opportunitySlides[0]).toContain('연결 이슈 ISS-002')
    expect(opportunitySlides[1]).toContain('일정 공유 자동화')
    expect(opportunitySlides[1]).toContain('연결 이슈 ISS-004')

    expect(slides.join('\n')).not.toContain('{{')
    expect(slides.at(-1)).toContain(`${slides.length} / ${slides.length}`)   // 쪽 번호
  })

  it('렌더 결과에 미치환 토큰이 없고, 지운 원본의 샘플 문구·방법론 용어도 없다', async () => {
    const bytes = await render(rich())
    const scan = await engine.scan(bytes)
    expect(scan.issues).toEqual([])
    expect(scan.placeholders).toEqual([])
    const hits = (await zipTextParts(bytes)).flatMap((p) => findSentinels(p.text, SENTINELS_BY_SP.SP6).map((w) => `${p.name}: ${w}`))
    expect(hits).toEqual([])
  })

  it('원인·개선기회가 0건이어도 렌더된다 — 원인 표는 머리 행만, 개선기회 장은 빠진다', async () => {
    const bare = model([
      area('A1', '기획 영역', [issue('ISS-001', { causes: [] }), issue('ISS-002', { causes: [] })]),
      area('A2', '실행 영역', [issue('ISS-003', { causes: [] })]),
    ])
    const slides = await slideTexts(await render(bare))
    expect(slides).toHaveLength(1 + 1 + 2 + 3)
    expect(slides.join('\n')).not.toContain('{{')
    expect(slides.join('\n')).not.toContain('개선기회')
    expect(slides[4]).toContain('ISS-001 · 원인 분석')
    expect(slides[4]).toMatch(/원인 분류\n직접 원인\n근본 원인\n5 \/ 7$/)   // 머리 행 다음이 바로 쪽 번호 — 원인 행이 없다
  })

  it('저장 실행이 필요 없는 빈 모델도 렌더된다 — 표지와 영역별 종합(행 없음)만 남는다', async () => {
    const slides = await slideTexts(await render(emptyIssueAnalysisCatalog()))
    expect(slides).toHaveLength(2)
    expect(slides.join('\n')).not.toContain('{{')
  })

  it('영역 12개 — 영역별 종합이 행 상한(5)으로 세 장에 나뉘고 영역을 하나도 잃지 않는다', async () => {
    const many = model(Array.from({ length: 12 }, (_, n) => area(`A${n + 1}`, `영역 ${n + 1}번`, [issue(`ISS-${n + 1}`)])))
    const slides = await slideTexts(await render(many))
    expect(slides).toHaveLength(1 + 3 + 12 + 12)
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
    const slides = await slideTexts(await render(long))
    const areaSlides = slides.filter((s) => s.startsWith('A1 기획 영역 · 이슈 목록'))
    expect(areaSlides.length).toBeGreaterThan(1)
    expect(areaSlides[1]).toContain(OPTIONS.continuation_label)
    const squash = (s: string) => s.replace(/\s+/g, '')
    const joined = squash(areaSlides.join(''))
    expect(joined).toContain('BODY-END')
    expect(joined.split('가나다라마바사아자차').length - 1).toBe(1_818)       // 본문 조각을 이으면 반복 횟수가 그대로다
    const causeSlides = slides.filter((s) => s.startsWith('ISS-001 · 원인 분석'))
    expect(squash(causeSlides.join(''))).toContain('CAUSE-END')
    expect(squash(causeSlides.join('')).split('원인서술문장입니다.').length - 1).toBe(120)
    expect(slides.join('\n')).not.toContain('{{')
  })

  it('행 상한을 프로젝트 옵션으로 바꾸면 그 값으로 나뉜다', async () => {
    const many = model([area('A1', '기획 영역', Array.from({ length: 7 }, (_, n) => issue(`ISS-${n + 1}`)))])
    const slides = await slideTexts(await render(many, { ...OPTIONS, max_rows_per_slide: 3 }))
    expect(slides.filter((s) => s.startsWith('A1 기획 영역 · 이슈 목록'))).toHaveLength(3)
  })
})
