import { describe, expect, it } from 'vitest'
import { assessFormActivation } from '@/lib/forms/activation'
import type { Placeholder } from '@/lib/report/engine/types'

const ph = (token: string, path: string, kind: Placeholder['kind'] = 'value'): Placeholder => ({
  token, kind, path, scope: [], location: {}, mergedRuns: false,
})
const report = (placeholders: Placeholder[], issues: { code: string; severity: 'error' | 'warning'; message: string }[] = []) => ({
  engineVersion: 'forms-engine.v1' as const, format: 'pptx' as const, placeholders, issues,
})

describe('양식 활성화 완전성(정본 §4.7.3)', () => {
  it('카탈로그에 닿는 값 토큰은 매핑이 비어도 통과하고, 권장 토큰 부재는 막지 않는다', () => {
    const r = assessFormActivation('weekly_report_pptx', report([ph('{{report.project_name}}', 'report.project_name')]), {})
    expect(r).toEqual({ ok: true })
  })
  it('카탈로그에 없는 토큰은 미매핑 목록과 함께 거부한다', () => {
    const r = assessFormActivation('weekly_report_pptx', report([
      ph('{{report.project_name}}', 'report.project_name'),
      ph('{{report.no_such}}', 'report.no_such'),
    ]), {})
    expect(r).toMatchObject({ ok: false, code: 'UNMAPPED', unmapped: ['{{report.no_such}}'] })
  })
  it('매핑이 카탈로그 경로로 이어 주면 통과한다', () => {
    const token = '{{customer.title}}'
    const r = assessFormActivation('weekly_report_pptx', report([ph(token, 'customer.title')]), { [token]: 'report.project_name' })
    expect(r).toEqual({ ok: true })
  })
  it('값 토큰에 목록 경로가 오면 TYPE_MISMATCH 다', () => {
    const r = assessFormActivation('weekly_report_pptx', report([ph('{{sections}}', 'sections')]), {})
    expect(r).toMatchObject({ ok: false, code: 'TYPE_MISMATCH' })
  })
  it('저장된 스캔 오류는 활성화하지 않는다', () => {
    const r = assessFormActivation('weekly_report_pptx', report(
      [ph('{{report.project_name}}', 'report.project_name')],
      [{ code: 'ROWS_OUTSIDE_TABLE', severity: 'error', message: '표 밖' }],
    ), {})
    expect(r).toMatchObject({ ok: false, code: 'SCAN' })
  })
  it('engineVersion 이 다르면 재스캔(재등록)을 요구하고, 형식이 깨지면 모양 오류다', () => {
    expect(assessFormActivation('weekly_report_pptx', { ...report([]), engineVersion: 'forms-engine.v0' }, {})).toMatchObject({ ok: false, code: 'RESCAN' })
    expect(assessFormActivation('weekly_report_pptx', { engineVersion: 'forms-engine.v1', format: 'xlsx', placeholders: [], issues: [] }, {})).toMatchObject({ ok: false, code: 'SHAPE' })
    expect(assessFormActivation('weekly_report_pptx', null, {})).toMatchObject({ ok: false, code: 'SHAPE' })
  })
})
