import { describe, expect, it } from 'vitest'
import {
  CATALOG_REGISTRY,
  detectRequiredRoots,
  formatCatalogValue,
  getCatalogForKind,
  resolveCatalogPath,
} from '@/lib/report/catalog'
import { FormRenderError, type Placeholder } from '@/lib/report/engine/types'

describe('SP6 데이터 카탈로그 (Data Catalog)', () => {
  describe('1. 양식 종류별 카탈로그 등록 및 기본 경로 검증', () => {
    it('4종의 양식 종류가 모두 등록되어 있다', () => {
      expect(CATALOG_REGISTRY.weekly_report_pptx).toBeDefined()
      expect(CATALOG_REGISTRY.weekly_report_xlsx).toBeDefined()
      expect(CATALOG_REGISTRY.issue_analysis_pptx).toBeDefined()
      expect(CATALOG_REGISTRY.wbs_export_xlsx).toBeDefined()
    })

    it('weekly 카탈로그에 핵심 경로들이 존재한다', () => {
      const cat = getCatalogForKind('weekly_report_pptx')
      expect(cat['report.project_name']?.type).toBe('text')
      expect(cat['report.week_label']?.type).toBe('text')
      expect(cat['report.week_tag']?.type).toBe('text')
      expect(cat['report.week_range']?.type).toBe('text')
      expect(cat['report.prev_week_range']?.type).toBe('text')
      expect(cat['report.next_week_range']?.type).toBe('text')
      expect(cat['report.week_start']?.type).toBe('date')
      expect(cat['report.today']?.type).toBe('date')
      expect(cat['kpi.plan']?.type).toBe('pct1')
      expect(cat['kpi.actual']?.type).toBe('pct1')
      expect(cat['kpi.variance']?.type).toBe('pp1')
      expect(cat['kpi.total']?.type).toBe('int')
      expect(cat['sections']?.type).toBe('list<record>')
      expect(cat['wbs_groups.curr']?.type).toBe('list<record>')
      expect(cat['issues']?.type).toBe('list<text>')
      expect(cat['issues_detail']?.type).toBe('list<record>')
      expect(cat['events']?.type).toBe('list<text>')
      expect(cat['meetings.this_week']?.type).toBe('list<record>')
      expect(cat['announcements.this_week']?.type).toBe('list<record>')
      expect(cat['attendance.this_week']?.type).toBe('list<record>')
      expect(cat['phases']?.type).toBe('list<record>')
      expect(cat['plan_actual']?.type).toBe('list<record>')
      expect(cat['workload']?.type).toBe('list<record>')
      expect(cat['wbs_rows']?.type).toBe('list<record>')
      expect(cat['ai_comment']?.type).toBe('list<record>')
    })

    it('주차 원자 토큰 5종이 weekly 카탈로그에 존재한다 (개정 §4.5.2)', () => {
      const cat = getCatalogForKind('weekly_report_pptx')
      expect(cat['report.week_year']?.type).toBe('int')
      expect(cat['report.week_month']?.type).toBe('int')
      expect(cat['report.week_ordinal']?.type).toBe('int')
      expect(cat['report.week_end']?.type).toBe('date')
      expect(cat['report.week_days']?.type).toBe('list<record>')

      const weekDaysFields = cat['report.week_days']?.recordFields
      expect(weekDaysFields?.['.date']?.type).toBe('date')
      expect(weekDaysFields?.['.dow']?.type).toBe('int')
    })

    it('issue_analysis 카탈로그에 핵심 경로 및 SP5b 상태 필드가 존재한다', () => {
      const cat = getCatalogForKind('issue_analysis_pptx')
      expect(cat['summary.project_name']?.type).toBe('text')
      expect(cat['summary.author_name']?.type).toBe('text')
      expect(cat['summary.issue_count']?.type).toBe('int')
      expect(cat['summary.area_count']?.type).toBe('int')
      expect(cat['areas']?.type).toBe('list<record>')
      expect(cat['issues']?.type).toBe('list<record>')
      expect(cat['opportunities']?.type).toBe('list<record>')

      // areas[].issues 하위 필드
      const areaFields = cat['areas']?.recordFields
      const issueFields = areaFields?.['.issues']?.recordFields
      expect(issueFields?.['.status']?.type).toBe('text')
      expect(issueFields?.['.status_code']?.type).toBe('text')
      expect(issueFields?.['.status_label']?.type).toBe('text')
      expect(issueFields?.['.severity']?.type).toBe('text')
      expect(issueFields?.['.severity_label']?.type).toBe('text')
      expect(issueFields?.['.causes']?.type).toBe('list<record>')

      // 평탄화 issues 하위 필드
      const flatIssueFields = cat['issues']?.recordFields
      expect(flatIssueFields?.['.area_code']?.type).toBe('text')
      expect(flatIssueFields?.['.area_name']?.type).toBe('text')
      expect(flatIssueFields?.['.status_code']?.type).toBe('text')
      expect(flatIssueFields?.['.status_label']?.type).toBe('text')
    })

    it('wbs_export 카탈로그에 핵심 경로들이 존재한다', () => {
      const cat = getCatalogForKind('wbs_export_xlsx')
      expect(cat['project.name']?.type).toBe('text')
      expect(cat['project.start_date']?.type).toBe('date')
      expect(cat['wbs_items']?.type).toBe('list<record>')
      expect(cat['teams']?.type).toBe('list<record>')
      expect(cat['holidays']?.type).toBe('list<record>')
      expect(cat['kpi.plan']?.type).toBe('pct1')

      const itemFields = cat['wbs_items']?.recordFields
      expect(itemFields?.['.no']?.type).toBe('int')
      expect(itemFields?.['.weight_pct']?.type).toBe('pct1')
      expect(itemFields?.['.status']?.type).toBe('text')
      expect(itemFields?.['.status_label']?.type).toBe('text')
      expect(itemFields?.['.owners']?.type).toBe('list<record>')
    })
  })

  describe('2. 카탈로그 경로 해석 (resolveCatalogPath)', () => {
    it('절대 경로를 정상 해석한다', () => {
      const res = resolveCatalogPath('weekly_report_pptx', 'report.project_name')
      expect(res).not.toBeNull()
      expect(res?.field.type).toBe('text')
      expect(res?.isCustom).toBe(false)
    })

    it('PPTX 내장 슬라이드 토큰을 해석한다', () => {
      const p = resolveCatalogPath('weekly_report_pptx', 'slide.page')
      expect(p).not.toBeNull()
      expect(p?.field.type).toBe('int')

      const c = resolveCatalogPath('weekly_report_pptx', 'slide.continuation')
      expect(c).not.toBeNull()
      expect(c?.field.type).toBe('text')
    })

    it('XLSX 양식에서는 slide 내장 토큰이 절대 경로로 해석되지 않는다', () => {
      const res = resolveCatalogPath('weekly_report_xlsx', 'slide.page')
      expect(res).toBeNull()
    })

    it('sections 블록 내부 상대 경로를 해석한다', () => {
      const scope = ['{{#rows sections}}']
      const res = resolveCatalogPath('weekly_report_pptx', '.this_content', scope)
      expect(res).not.toBeNull()
      expect(res?.field.type).toBe('list<text>')

      const nameRes = resolveCatalogPath('weekly_report_pptx', '.name', scope)
      expect(nameRes?.field.type).toBe('text')
    })

    it('areas -> .issues 중첩 블록 내부 상대 경로를 해석한다', () => {
      const scope = ['{{#slide areas}}', '{{#rows .issues}}']
      const codeRes = resolveCatalogPath('issue_analysis_pptx', '.code', scope)
      expect(codeRes).not.toBeNull()
      expect(codeRes?.field.type).toBe('text')

      const statusRes = resolveCatalogPath('issue_analysis_pptx', '.status_label', scope)
      expect(statusRes?.field.type).toBe('text')
    })

    it('스칼라 목록 블록 안에서 {{.}} 상대 경로를 해석한다', () => {
      const scope = ['{{#items wbs_groups.curr}}', '{{#items .lines}}']
      const res = resolveCatalogPath('weekly_report_pptx', '.', scope)
      expect(res).not.toBeNull()
      expect(res?.field.type).toBe('text')
    })

    it('유효하지 않은 상대 경로는 null을 반환한다', () => {
      const scope = ['{{#rows sections}}']
      expect(resolveCatalogPath('weekly_report_pptx', '.non_existent', scope)).toBeNull()
    })
  })

  describe('3. SP5c 사용자 정의 필드 (.custom.<key>) 해석', () => {
    it('sections 블록 안에서 .custom.<key>는 list<text>로 해석된다', () => {
      const scope = ['{{#rows sections}}']
      const res = resolveCatalogPath('weekly_report_pptx', '.custom.memo', scope)
      expect(res).not.toBeNull()
      expect(res?.isCustom).toBe(true)
      expect(res?.customKey).toBe('memo')
      expect(res?.field.type).toBe('list<text>')
    })

    it('areas[].issues 블록 안에서 .custom.<key>는 text로 해석된다', () => {
      const scope = ['{{#slide areas}}', '{{#rows .issues}}']
      const res = resolveCatalogPath('issue_analysis_pptx', '.custom.priority_reason', scope)
      expect(res).not.toBeNull()
      expect(res?.isCustom).toBe(true)
      expect(res?.customKey).toBe('priority_reason')
      expect(res?.field.type).toBe('text')
    })

    it('평탄화 issues 블록 안에서 .custom.<key>가 해석된다', () => {
      const scope = ['{{#rows issues}}']
      const res = resolveCatalogPath('issue_analysis_pptx', '.custom.customer_code', scope)
      expect(res).not.toBeNull()
      expect(res?.isCustom).toBe(true)
      expect(res?.field.type).toBe('text')
    })

    it('wbs_items 블록 안에서 .custom.<key>가 해석된다', () => {
      const scope = ['{{#rows wbs_items}}']
      const res = resolveCatalogPath('wbs_export_xlsx', '.custom.vendor', scope)
      expect(res).not.toBeNull()
      expect(res?.isCustom).toBe(true)
      expect(res?.field.type).toBe('text')
    })

    it('custom 필드를 지원하지 않는 블록에서는 .custom.<key>가 거부된다', () => {
      const scope = ['{{#rows meetings.this_week}}']
      const res = resolveCatalogPath('weekly_report_pptx', '.custom.foo', scope)
      expect(res).toBeNull()
    })

    it('activeCustomKeys가 지정된 경우 목록에 없는 key는 null이다', () => {
      const scope = ['{{#rows sections}}']
      const active = ['memo', 'tag']
      expect(resolveCatalogPath('weekly_report_pptx', '.custom.memo', scope, active)).not.toBeNull()
      expect(resolveCatalogPath('weekly_report_pptx', '.custom.other', scope, active)).toBeNull()
    })

    it('key 규칙(소문자 snake_case 32자 이하)을 위반하면 거부된다', () => {
      const scope = ['{{#rows sections}}']
      expect(resolveCatalogPath('weekly_report_pptx', '.custom.UPPER', scope)).toBeNull()
      expect(resolveCatalogPath('weekly_report_pptx', '.custom.has-hyphen', scope)).toBeNull()
      expect(resolveCatalogPath('weekly_report_pptx', '.custom.a'.repeat(40), scope)).toBeNull()
    })
  })

  describe('4. 값 서식화 (formatCatalogValue)', () => {
    it('빈 값(null, undefined, 빈 문자열, 빈 배열)은 empty_text로 채운다', () => {
      const opts = { empty_text: '-' }
      expect(formatCatalogValue(null, 'text', 'pptx', opts)).toBe('-')
      expect(formatCatalogValue(undefined, 'int', 'pptx', opts)).toBe('-')
      expect(formatCatalogValue('', 'text', 'pptx', opts)).toBe('-')
      expect(formatCatalogValue([], 'list<text>', 'pptx', opts)).toBe('-')
    })

    it('pct1: pptx는 formatPct1, xlsx는 round1 숫자로 서식화한다', () => {
      expect(formatCatalogValue(66.666, 'pct1', 'pptx')).toBe('66.7')
      expect(formatCatalogValue(66.666, 'pct1', 'xlsx')).toBe(66.7)
    })

    it('pp1: pptx는 부호 포함 formatPp1, xlsx는 숫자로 서식화한다', () => {
      expect(formatCatalogValue(1.5, 'pp1', 'pptx')).toBe('+1.5')
      expect(formatCatalogValue(-2.34, 'pp1', 'pptx')).toBe('-2.3')
      expect(formatCatalogValue(1.5, 'pp1', 'xlsx')).toBe(1.5)
    })

    it('int: pptx는 문자열, xlsx는 정수 숫자로 반환한다', () => {
      expect(formatCatalogValue(1234, 'int', 'pptx')).toBe('1234')
      expect(formatCatalogValue(1234.4, 'int', 'xlsx')).toBe(1234)
    })

    it('date: pptx는 YYYY-MM-DD 문자열, xlsx는 Date 객체로 반환한다', () => {
      expect(formatCatalogValue('2026-10-05', 'date', 'pptx')).toBe('2026-10-05')
      const xlsxVal = formatCatalogValue('2026-10-05', 'date', 'xlsx')
      expect(xlsxVal).toBeInstanceOf(Date)
    })

    it('list<text>: 개행(\\n)으로 이어붙인다', () => {
      const list = ['라인1', '라인2', '라인3']
      expect(formatCatalogValue(list, 'list<text>', 'pptx')).toBe('라인1\n라인2\n라인3')
    })

    it('list<record>를 값으로 서식화 시도하면 TYPE_MISMATCH 에러를 던진다', () => {
      expect(() => formatCatalogValue([{ a: 1 }], 'list<record>', 'pptx')).toThrow(FormRenderError)
    })
  })

  describe('5. 한국어 고정 서식 라벨 불변식 (R4-18, COV-09)', () => {
    it('주차 서식 라벨 설명 및 규약이 한국어 고정임을 명시한다', () => {
      const cat = getCatalogForKind('weekly_report_pptx')
      expect(cat['report.week_label'].description).toContain('2026년 7월 1주차')
      expect(cat['report.week_tag'].description).toContain('7월1주차')
      expect(cat['report.week_range'].description).toContain('6/29~7/3')
    })
  })

  describe('6. 필수 데이터 로더 감지 (detectRequiredRoots)', () => {
    it('플레이스홀더 목록에서 필요한 루트들을 추출한다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{report.project_name}}', kind: 'value', path: 'report.project_name', scope: [], location: {}, mergedRuns: false },
        { token: '{{#rows sections}}', kind: 'rows', path: 'sections', scope: [], location: {}, mergedRuns: false },
        { token: '{{.this_content}}', kind: 'value', path: '.this_content', scope: ['{{#rows sections}}'], location: {}, mergedRuns: false },
        { token: '{{.custom.memo}}', kind: 'value', path: '.custom.memo', scope: ['{{#rows sections}}'], location: {}, mergedRuns: false },
      ]

      const { roots, hasCustomFields } = detectRequiredRoots(placeholders)
      expect(roots.has('report')).toBe(true)
      expect(roots.has('sections')).toBe(true)
      expect(hasCustomFields).toBe(true)
    })
  })
})
