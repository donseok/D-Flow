// SP6 S1 — forms.* 네 키(정본 §4.4.6·§4.4.7, 개정 §2.8.2). 활성 행·미매핑 토큰은 여기 범위가 아니다.
import { describe, expect, it } from 'vitest'
import { settingDef } from '@/lib/settings/registry'
import { DEFAULT_RENDER_OPTIONS } from '@/lib/report/engine/types'
import {
  FORM_SETTING_KEYS, defaultFormSetting, isFormCatalogPath, normalizeMappingKey, parseFormSetting,
} from '@/lib/settings/defs/forms'

const base = (kind: 'weekly_report_pptx' | 'weekly_report_xlsx' | 'issue_analysis_pptx' | 'wbs_export_xlsx', over: Record<string, unknown> = {}) => ({
  ...defaultFormSetting(kind),
  ...over,
  options: { ...DEFAULT_RENDER_OPTIONS[kind], ...(over.options as object | undefined) },
})

describe('forms.* 등록', () => {
  it('네 키는 프로젝트 관리자·immediate/none·FormsManager 이고 소유 모듈이 양식과 같다', () => {
    const modules = {
      'forms.weekly_report_pptx': 'weekly',
      'forms.weekly_report_xlsx': 'weekly',
      'forms.issue_analysis_pptx': 'issue_analysis',
      'forms.wbs_export_xlsx': 'wbs',
    } as const
    for (const key of FORM_SETTING_KEYS) {
      const d = settingDef('project', key)!
      expect(d.scope).toBe('project')
      expect(d.editor).toBe('project_admin')
      expect(d.module).toBe(modules[key])
      expect(d.apply).toBe('immediate')
      expect([...d.impact]).toEqual(['none'])
      expect(d.sql).toBeNull()
      expect(d.widget).toEqual({ kind: 'custom', component: 'FormsManager' })
      expect(d.parse(d.default)).toEqual({ ok: true, value: d.default })
    }
    expect(settingDef('workspace', 'forms.weekly_report_pptx')).toBeUndefined()
  })
})

describe('parseFormSetting', () => {
  it('기본값은 템플릿 없음·빈 매핑·종류별 넘침 기본값', () => {
    const v = parseFormSetting('weekly_report_pptx', defaultFormSetting('weekly_report_pptx'))
    expect(v).toEqual({ ok: true, value: {
      template_id: null,
      mapping: {},
      options: { max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)' },
    } })
  })

  it('template_id 는 UUID 를 소문자로 두고, 그 외는 거부한다', () => {
    const id = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
    const ok = parseFormSetting('wbs_export_xlsx', base('wbs_export_xlsx', { template_id: id }))
    expect(ok.ok && ok.value.template_id).toBe(id.toLowerCase())
    expect(parseFormSetting('wbs_export_xlsx', base('wbs_export_xlsx', { template_id: 'not-a-uuid' })).ok).toBe(false)
    expect(parseFormSetting('wbs_export_xlsx', base('wbs_export_xlsx', { template_id: '' })).ok).toBe(false)
  })

  it('매핑 키는 토큰 복합 키로 정규화하고, 값은 그 양식의 카탈로그 경로만 받는다', () => {
    const raw = base('weekly_report_pptx', {
      mapping: {
        '{{ title }}': 'report.project_name',
        '{{#rows list}}/{{.a}}': '.this_content',
        '{{#rows sections}}/{{.custom.cost_center}}': '.custom.cost_center',
      },
    })
    const v = parseFormSetting('weekly_report_pptx', raw)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.value.mapping).toEqual({
        '{{title}}': 'report.project_name',
        '{{#rows list}}/{{.a}}': '.this_content',
        '{{#rows sections}}/{{.custom.cost_center}}': '.custom.cost_center',
      })
    }
    expect(parseFormSetting('weekly_report_pptx', base('weekly_report_pptx', { mapping: { '{{title}}': 'project.name' } })).ok).toBe(false)
    expect(parseFormSetting('wbs_export_xlsx', base('wbs_export_xlsx', { mapping: { '{{name}}': '.this_content' } })).ok).toBe(false)
    expect(parseFormSetting('weekly_report_xlsx', base('weekly_report_xlsx', { mapping: { '{{p}}': 'slide.page' } })).ok).toBe(false)
    expect(parseFormSetting('issue_analysis_pptx', base('issue_analysis_pptx', { mapping: { '{{p}}': 'slide.page' } })).ok).toBe(true)
    expect(parseFormSetting('weekly_report_pptx', base('weekly_report_pptx', { mapping: { '{{/rows}}': 'sections' } })).ok).toBe(false)
    expect(parseFormSetting('weekly_report_pptx', base('weekly_report_pptx', { mapping: { '{{title}}': '.custom.NotAKey' } })).ok).toBe(false)
  })

  it('정규화 뒤 같은 키면 거부하고, 알 수 없는 키·0 상한·제어 문자를 받지 않는다', () => {
    expect(normalizeMappingKey('{{ title }}')).toBe('{{title}}')
    expect(parseFormSetting('weekly_report_pptx', base('weekly_report_pptx', {
      mapping: { '{{title}}': 'report.project_name', '{{ title }}': 'report.week_label' },
    })).ok).toBe(false)
    expect(parseFormSetting('weekly_report_pptx', { ...base('weekly_report_pptx'), extra: 1 }).ok).toBe(false)
    expect(parseFormSetting('weekly_report_pptx', base('weekly_report_pptx', { options: { max_lines_per_cell: 0 } })).ok).toBe(false)
    expect(parseFormSetting('weekly_report_xlsx', base('weekly_report_xlsx', { options: { max_rows_per_slide: 1.5 } })).ok).toBe(false)
    expect(parseFormSetting('issue_analysis_pptx', base('issue_analysis_pptx', { options: { item_cap: -1 } })).ok).toBe(false)
    expect(parseFormSetting('issue_analysis_pptx', base('issue_analysis_pptx', { options: { empty_text: '없음\n' } })).ok).toBe(false)
    expect(parseFormSetting('weekly_report_pptx', null).ok).toBe(false)
  })

  it('카탈로그 경로 판정은 양식마다 다르다', () => {
    expect(isFormCatalogPath('weekly_report_pptx', 'report.week_year')).toBe(true)
    expect(isFormCatalogPath('wbs_export_xlsx', 'report.week_year')).toBe(false)
    expect(isFormCatalogPath('wbs_export_xlsx', 'wbs_items')).toBe(true)
    expect(isFormCatalogPath('weekly_report_pptx', '.')).toBe(true)
    expect(isFormCatalogPath('wbs_export_xlsx', '.custom.lot_no')).toBe(true)
    expect(isFormCatalogPath('weekly_report_pptx', '.nope')).toBe(false)
  })
})
