import { describe, expect, it } from 'vitest'
import {
  isValidPath,
  parseTokenBody,
  scanRunTokens,
  scanTextTokens,
  validatePlaceholders,
} from '@/lib/report/engine/scanner'
import type { Placeholder, PlaceholderLocation, RenderMapping } from '@/lib/report/engine/types'

describe('SP6 자리표시자 스캐너 및 검증기 (Placeholder Scanner & Validator)', () => {
  describe('1. 경로 문법 검사 (isValidPath)', () => {
    it('유효한 절대 경로를 통과시킨다', () => {
      expect(isValidPath('report.week_range')).toBe(true)
      expect(isValidPath('sections')).toBe(true)
      expect(isValidPath('kpi.plan')).toBe(true)
      expect(isValidPath('wbs_groups.curr')).toBe(true)
    })

    it('유효한 상대 경로를 통과시킨다', () => {
      expect(isValidPath('.')).toBe(true)
      expect(isValidPath('.name')).toBe(true)
      expect(isValidPath('.this_content')).toBe(true)
      expect(isValidPath('.custom.review_notes')).toBe(true)
      expect(isValidPath('.summary.status.open')).toBe(true)
    })

    it('대문자, 하이픈, 공백, 특수문자가 섞인 경로는 거부한다 (정본 §4.4.1)', () => {
      expect(isValidPath('Report.week_range')).toBe(false)
      expect(isValidPath('report.week-range')).toBe(false)
      expect(isValidPath('report .week')).toBe(false)
      expect(isValidPath('report..week')).toBe(false)
      expect(isValidPath('report.')).toBe(false)
      expect(isValidPath('.Name')).toBe(false)
      expect(isValidPath('.has-hyphen')).toBe(false)
    })
  })

  describe('2. 토큰 본문 파싱 (parseTokenBody)', () => {
    it('값 토큰을 파싱하고 공백을 정규화한다', () => {
      const res = parseTokenBody('  report.week_range  ')
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect(res.kind).toBe('value')
        expect(res.path).toBe('report.week_range')
        expect(res.token).toBe('{{report.week_range}}')
      }
    })

    it('블록 열기 토큰을 파싱한다 (#rows, #slide, #items)', () => {
      const rows = parseTokenBody('#rows   sections')
      expect(rows.ok).toBe(true)
      if (rows.ok) {
        expect(rows.kind).toBe('rows')
        expect(rows.path).toBe('sections')
        expect(rows.token).toBe('{{#rows sections}}')
      }

      const slide = parseTokenBody('#slide areas')
      expect(slide.ok).toBe(true)
      if (slide.ok) {
        expect(slide.kind).toBe('slide')
        expect(slide.path).toBe('areas')
        expect(slide.token).toBe('{{#slide areas}}')
      }

      const items = parseTokenBody('#items .lines')
      expect(items.ok).toBe(true)
      if (items.ok) {
        expect(items.kind).toBe('items')
        expect(items.path).toBe('.lines')
        expect(items.token).toBe('{{#items .lines}}')
      }
    })

    it('블록 닫기 토큰을 파싱한다 (/rows, /items)', () => {
      const closeRows = parseTokenBody('  /rows  ')
      expect(closeRows.ok).toBe(true)
      if (closeRows.ok) {
        expect(closeRows.kind).toBe('close_rows')
        expect(closeRows.token).toBe('{{/rows}}')
      }

      const closeItems = parseTokenBody('/items')
      expect(closeItems.ok).toBe(true)
      if (closeItems.ok) {
        expect(closeItems.kind).toBe('close_items')
        expect(closeItems.token).toBe('{{/items}}')
      }
    })

    it('잘못된 토큰 구문은 실패를 반환한다 (MALFORMED_TOKEN 사유)', () => {
      expect(parseTokenBody('').ok).toBe(false)
      expect(parseTokenBody('   ').ok).toBe(false)
      expect(parseTokenBody('#loop items').ok).toBe(false)
      expect(parseTokenBody('/slide').ok).toBe(false) // slide는 닫는 토큰이 없음 (정본 §4.4.1)
      expect(parseTokenBody('#rows').ok).toBe(false)  // 경로 누락
      expect(parseTokenBody('Upper.Case').ok).toBe(false)
    })
  })

  describe('3. 텍스트 토큰 스캐너 (scanTextTokens)', () => {
    const loc: PlaceholderLocation = { slide: 2, shapeId: '10' }

    it('텍스트에서 단일 및 복수 토큰을 정확히 추출한다', () => {
      const text = '프로젝트명: {{report.project_name}} (주차: {{report.week_range}})'
      const { placeholders, issues } = scanTextTokens(text, loc)
      expect(issues).toHaveLength(0)
      expect(placeholders).toHaveLength(2)
      expect(placeholders[0].token).toBe('{{report.project_name}}')
      expect(placeholders[0].kind).toBe('value')
      expect(placeholders[1].token).toBe('{{report.week_range}}')
    })

    it('블록 스코프 스택을 올바르게 추적한다', () => {
      const text = '{{#rows sections}}구분: {{.name}}, 실적: {{.this_content}}{{/rows}}'
      const { placeholders, issues } = scanTextTokens(text, loc)
      expect(issues).toHaveLength(0)
      expect(placeholders).toHaveLength(3)

      expect(placeholders[0].token).toBe('{{#rows sections}}')
      expect(placeholders[0].scope).toEqual([])

      expect(placeholders[1].token).toBe('{{.name}}')
      expect(placeholders[1].scope).toEqual(['{{#rows sections}}'])

      expect(placeholders[2].token).toBe('{{.this_content}}')
      expect(placeholders[2].scope).toEqual(['{{#rows sections}}'])
    })

    it('닫는 괄호가 누락된 경우 MALFORMED_TOKEN 에러를 보고한다', () => {
      const text = '프로젝트: {{report.project_name'
      const { placeholders, issues } = scanTextTokens(text, loc)
      expect(placeholders).toHaveLength(0)
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('MALFORMED_TOKEN')
    })

    it('열리지 않은 블록의 닫기 태그는 UNCLOSED_BLOCK 에러를 보고한다', () => {
      const text = '내용: {{.lines}}{{/items}}'
      const { issues } = scanTextTokens(text, loc)
      expect(issues).toHaveLength(1)
      expect(issues[0].code).toBe('UNCLOSED_BLOCK')
    })
  })

  describe('4. 런 병합 스캔 (scanRunTokens, 스파이크 ①)', () => {
    const loc: PlaceholderLocation = { slide: 2, shapeId: '20' }

    it('단일 런 안의 토큰은 mergedRuns: false이다', () => {
      const runs = [
        { text: '전주 주요활동 (' },
        { text: '{{report.prev_week_range}}' },
        { text: ')' },
      ]
      const { placeholders, issues } = scanRunTokens(runs, loc)
      expect(issues).toHaveLength(0)
      expect(placeholders).toHaveLength(1)
      expect(placeholders[0].mergedRuns).toBe(false)
      expect(placeholders[0].token).toBe('{{report.prev_week_range}}')
    })

    it('여러 런에 걸쳐 쪼개진 토큰을 인식하고 SPLIT_RUN 경고를 낸다', () => {
      const runs = [
        { text: '금주 실적: {{report.' },
        { text: 'week_' },
        { text: 'range}} 안내' },
      ]
      const { placeholders, issues } = scanRunTokens(runs, loc)
      expect(placeholders).toHaveLength(1)
      expect(placeholders[0].token).toBe('{{report.week_range}}')
      expect(placeholders[0].mergedRuns).toBe(true)

      const splitWarn = issues.find(i => i.code === 'SPLIT_RUN')
      expect(splitWarn).toBeDefined()
      expect(splitWarn?.severity).toBe('warning')
    })
  })

  describe('5. 플레이스홀더 검증기 (validatePlaceholders)', () => {
    it('카탈로그에 존재하는 유효한 플레이스홀더들은 에러 없이 통과한다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{report.project_name}}', kind: 'value', path: 'report.project_name', scope: [], location: {}, mergedRuns: false },
        { token: '{{#rows sections}}', kind: 'rows', path: 'sections', scope: [], location: {}, mergedRuns: false },
        { token: '{{.name}}', kind: 'value', path: '.name', scope: ['{{#rows sections}}'], location: {}, mergedRuns: false },
        { token: '{{.this_content}}', kind: 'value', path: '.this_content', scope: ['{{#rows sections}}'], location: {}, mergedRuns: false },
      ]

      const issues = validatePlaceholders(placeholders, 'weekly_report_pptx')
      const errors = issues.filter(i => i.severity === 'error')
      expect(errors).toHaveLength(0)
    })

    it('카탈로그에도 매핑에도 없는 토큰은 UNKNOWN_TOKEN 에러를 낸다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{invalid.token}}', kind: 'value', path: 'invalid.token', scope: [], location: {}, mergedRuns: false },
      ]
      const issues = validatePlaceholders(placeholders, 'weekly_report_pptx')
      expect(issues.some(i => i.code === 'UNKNOWN_TOKEN')).toBe(true)
    })

    it('XLSX 양식에 {{#slide}}가 있으면 SLIDE_IN_XLSX 에러를 낸다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{#slide areas}}', kind: 'slide', path: 'areas', scope: [], location: {}, mergedRuns: false },
      ]
      const issues = validatePlaceholders(placeholders, 'weekly_report_xlsx')
      expect(issues.some(i => i.code === 'SLIDE_IN_XLSX')).toBe(true)
    })

    it('동일 슬라이드에 {{#slide}}가 2개 이상 있으면 MULTIPLE_SLIDE_BLOCKS 에러를 낸다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{#slide areas}}', kind: 'slide', path: 'areas', scope: [], location: { slide: 3 }, mergedRuns: false },
        { token: '{{#slide issues}}', kind: 'slide', path: 'issues', scope: [], location: { slide: 3 }, mergedRuns: false },
      ]
      const issues = validatePlaceholders(placeholders, 'issue_analysis_pptx')
      expect(issues.some(i => i.code === 'MULTIPLE_SLIDE_BLOCKS')).toBe(true)
    })

    it('값 토큰에 list<record>를 쓰면 TYPE_MISMATCH 에러를 낸다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{sections}}', kind: 'value', path: 'sections', scope: [], location: {}, mergedRuns: false },
      ]
      const issues = validatePlaceholders(placeholders, 'weekly_report_pptx')
      expect(issues.some(i => i.code === 'TYPE_MISMATCH')).toBe(true)
    })

    it('블록 토큰에 스칼라 경로를 쓰면 TYPE_MISMATCH 에러를 낸다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{#rows report.project_name}}', kind: 'rows', path: 'report.project_name', scope: [], location: {}, mergedRuns: false },
      ]
      const issues = validatePlaceholders(placeholders, 'weekly_report_pptx')
      expect(issues.some(i => i.code === 'TYPE_MISMATCH')).toBe(true)
    })

    it('매핑을 통해 알 수 없는 토큰을 카탈로그 경로로 성공적으로 잇는다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{my_title}}', kind: 'value', path: 'my_title', scope: [], location: {}, mergedRuns: false },
        { token: '{{#rows my_list}}', kind: 'rows', path: 'my_list', scope: [], location: {}, mergedRuns: false },
        { token: '{{.my_text}}', kind: 'value', path: '.my_text', scope: ['{{#rows my_list}}'], location: {}, mergedRuns: false },
      ]
      const mapping: RenderMapping = {
        '{{my_title}}': 'report.project_name',
        '{{#rows my_list}}': 'sections',
        '{{#rows my_list}}/{{.my_text}}': '.name',
      }

      const issues = validatePlaceholders(placeholders, 'weekly_report_pptx', mapping)
      const errors = issues.filter(i => i.severity === 'error')
      expect(errors).toHaveLength(0)
    })

    it('권장 토큰이 누락된 유효한 양식에는 RECOMMENDED_MISSING 경고를 낸다', () => {
      const placeholders: Placeholder[] = [
        { token: '{{report.project_name}}', kind: 'value', path: 'report.project_name', scope: [], location: {}, mergedRuns: false },
      ]
      const issues = validatePlaceholders(placeholders, 'weekly_report_pptx')
      const rec = issues.find(i => i.code === 'RECOMMENDED_MISSING')
      expect(rec).toBeDefined()
      expect(rec?.severity).toBe('warning')
    })
  })
})
