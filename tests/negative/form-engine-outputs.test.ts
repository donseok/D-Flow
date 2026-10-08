// tests/negative/form-engine-outputs.test.ts
// 부정 테스트 6(스펙 개정 §4.5.4, P4-§4, DC-08 가드).
// 제조 단어가 없는 픽스처로 주간 PPT/XLSX·분석서 PPT·WBS 엑셀을 렌더했을 때,
// 템플릿 샘플 토큰('예시 이슈', '예시:', 'ISS-02-', '국내영업팀', '해외영업팀', '영업 모듈', '온라인 주문 포털', '원가손익분석', '외주가공')과
// 지운 원본 이슈분석서 양식의 샘플 문구·방법론 용어(SP6 센티널 — tests/fixtures/legacy-sentinels.ts 의 formSamples)가
// 출력 zip 의 모든 텍스트 파트(슬라이드, 노트, docProps, rels 등)에서 0건이어야 한다.
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { engineFor, DEFAULT_RENDER_OPTIONS, type FormKind } from '@/lib/report/engine'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { defaultFormAssetPath } from '@/lib/report/forms/loadTemplate'
import { SENTINELS_BY_SP, findSentinels, zipTextParts } from '../fixtures/legacy-sentinels'

const SAMPLE_TOKENS = [
  '예시 이슈',
  '예시:',
  'ISS-02-',
  '국내영업팀',
  '해외영업팀',
  '영업 모듈',
  '온라인 주문 포털',
  '원가손익분석',
  '외주가공',
] as const

const kinds: FormKind[] = ['weekly_report_pptx', 'weekly_report_xlsx', 'issue_analysis_pptx', 'wbs_export_xlsx']

/** 제조·영업 샘플 토큰이 일절 없는 중립/연구 과제형 픽스처 데이터 */
const neutralModel = (count: number) => ({
  report: { project_name: '중립 연구 개발 프로젝트', week_label: '2026년 10월 1주차', week_range: '2026-10-05 ~ 2026-10-10' },
  summary: { project_name: '중립 연구 개발 프로젝트', date_label: '2026-10-05', issue_count: count },
  project: { name: '중립 연구 개발 프로젝트', start_date: '2026-10-05', end_date: '2026-12-31' },
  kpi: { plan: 50, actual: 48 },
  sections: Array.from({ length: count }, (_, n) => ({
    name: `연구단위 ${n + 1}`,
    this_content: [`이론 정립 ${n + 1}`, `알고리즘 검증 ${n + 1}`],
    next_content: [`실험 평가 ${n + 1}`],
    this_issue: [],
    next_issue: [],
  })),
  issues: Array.from({ length: count }, (_, n) => ({
    code: `RS-${n + 1}`,
    title: `연구 이슈 ${n + 1}`,
    body: `측정 오차 분석 및 보정 작업 ${n + 1}`,
    status_label: '조사중',
  })),
  wbs_items: Array.from({ length: count }, (_, n) => ({
    no: n + 1,
    level_label: '연구작업',
    name: `세부 태스크 ${n + 1}`,
    deliverable: `보고서 ${n + 1}`,
    owner_text: '연구팀',
    planned_start: '2026-10-05',
    planned_end: '2026-10-20',
    planned_pct: 100,
    actual_pct: 80,
    status_label: '진행중',
  })),
}) as unknown as CatalogModel

function modelFor(kind: FormKind, count: number): CatalogModel {
  const model = neutralModel(count) as unknown as Record<string, unknown>
  if (kind.startsWith('weekly')) {
    delete model.project
    delete model.summary
    delete model.wbs_items
  } else if (kind.startsWith('issue')) {
    delete model.project
    delete model.report
    delete model.wbs_items
    model.areas = []
  } else {
    delete model.report
    delete model.summary
  }
  return model as unknown as CatalogModel
}

function findSampleTokens(text: string): string[] {
  const found: string[] = []
  for (const token of SAMPLE_TOKENS) {
    if (text.includes(token)) {
      found.push(token)
    }
  }
  // 영문 낱말(Mega·Major)은 낱말 경계로, 나머지는 부분 문자열로 본다(일치 규칙은 sentinels.mjs 하나)
  return [...found, ...findSentinels(text, SENTINELS_BY_SP.SP6)]
}

describe('부정 테스트 6 — 기본 4종 양식 출력의 템플릿 샘플 토큰 0건 검증 (스펙 §4.5.4)', () => {
  describe.each(kinds)('양식: %s', (kind) => {
    it.each([0, 1, 5])('행 수 %i개 렌더 결과의 모든 zip 텍스트 파트에 금지 토큰이 없다', async (count) => {
      const bytes = await readFile(defaultFormAssetPath(kind))
      const engine = engineFor(kind.endsWith('pptx') ? 'pptx' : 'xlsx')
      const result = await engine.render(bytes, modelFor(kind, count), {}, DEFAULT_RENDER_OPTIONS[kind])
      const parts = await zipTextParts(result)

      const violations: { part: string; tokens: string[] }[] = []
      for (const { name, text } of parts) {
        const hits = findSampleTokens(text)
        if (hits.length > 0) {
          violations.push({ part: name, tokens: hits })
        }
      }

      expect(violations).toEqual([])
    })
  })

  it('대조군 검증 — 픽스처에 금지 샘플 토큰이 포함되면 정상적으로 탐지된다', async () => {
    const bytes = await readFile(defaultFormAssetPath('weekly_report_pptx'))
    const engine = engineFor('pptx')
    const model = modelFor('weekly_report_pptx', 1) as unknown as { sections: { this_content: string[] }[] }
    model.sections[0].this_content = ['온라인 주문 포털 구축 지연', '해외영업팀 인터뷰']
    const result = await engine.render(bytes, model as unknown as CatalogModel, {}, DEFAULT_RENDER_OPTIONS.weekly_report_pptx)
    const parts = await zipTextParts(result)

    const allHits = parts.flatMap((p) => findSampleTokens(p.text))
    expect(allHits).toContain('온라인 주문 포털')
    expect(allHits).toContain('해외영업팀')
  })

  it('대조군 검증 — 이슈 분석서 픽스처에 원본 샘플 문구·방법론 용어가 들면 탐지된다', async () => {
    const bytes = await readFile(defaultFormAssetPath('issue_analysis_pptx'))
    const model = modelFor('issue_analysis_pptx', 1) as unknown as { issues: { code: string; title: string }[] }
    const [, estimate, , , mega, , subProcess, , prefix] = SENTINELS_BY_SP.SP6
    model.issues[0] = { ...model.issues[0], code: `${prefix}02-01`, title: `${mega} 02 ${estimate} · ${subProcess}` }
    const result = await engineFor('pptx').render(bytes, model as unknown as CatalogModel, {}, DEFAULT_RENDER_OPTIONS.issue_analysis_pptx)
    const allHits = (await zipTextParts(result)).flatMap((p) => findSampleTokens(p.text))
    for (const token of [prefix, mega, estimate, subProcess]) expect(allHits).toContain(token)
  })
})
