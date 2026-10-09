import { readFile } from 'node:fs/promises'
import { posix } from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { engineFor, validatePlaceholders, DEFAULT_RENDER_OPTIONS, type FormKind } from '@/lib/report/engine'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { defaultFormAssetPath } from '@/lib/report/forms/loadTemplate'

const kinds: FormKind[] = ['weekly_report_pptx', 'weekly_report_xlsx', 'issue_analysis_pptx', 'wbs_export_xlsx']
const data = (count: number) => ({
  report: { project_name: '검증 프로젝트', week_label: '검증 주차', week_range: '2026-10-05 ~ 2026-10-10' },
  summary: { project_name: '검증 프로젝트', date_label: '2026-10-05', issue_count: count },
  project: { name: '검증 프로젝트', start_date: '2026-10-05', end_date: '2026-12-31' },
  kpi: { plan: 0, actual: 0 },
  sections: Array.from({ length: count }, (_, n) => ({ name: `구분 ${n}`, this_content: [`금주 ${n}`, '둘째 줄'], next_content: [`차주 ${n}`], this_issue: [], next_issue: [] })),
  issues: Array.from({ length: count }, (_, n) => ({ code: `I${n}`, title: `이슈 ${n}`, body: `내용 ${n}`, status_label: '미조치' })),
  wbs_items: Array.from({ length: count }, (_, n) => ({ no: n, level_label: '작업', name: `작업 ${n}`, deliverable: '', owner_text: '', planned_start: '2026-10-05', planned_end: '', planned_pct: 0, actual_pct: 0, status_label: '미착수' })),
}) as unknown as CatalogModel

function modelFor(kind: FormKind, count: number): CatalogModel {
  const model = data(count) as unknown as Record<string, unknown>
  if (kind.startsWith('weekly')) { delete model.project; delete model.summary; delete model.wbs_items }
  else if (kind.startsWith('issue')) {
    delete model.project; delete model.report; delete model.wbs_items
    // 기본 양식의 반복은 전부 영역 아래다 — 이슈를 한 영역에 싣는다(이슈가 없으면 영역도 없다)
    model.areas = count ? [{ code: 'A1', name: '검증 영역', summary: { total_count: count }, issues: model.issues, opportunities: [] }] : []
  }
  else { delete model.report; delete model.summary }
  return model as unknown as CatalogModel
}

describe.each(kinds)('기본 양식 %s', kind => {
  it('실제 파일이 존재하고 권장 토큰과 카탈로그 검증을 통과한다', async () => {
    const bytes = await readFile(defaultFormAssetPath(kind))
    const engine = engineFor(kind.endsWith('pptx') ? 'pptx' : 'xlsx')
    const scan = await engine.scan(bytes)
    expect(scan.issues).toEqual([])
    expect(validatePlaceholders(scan.placeholders, kind, {})).toEqual([])
    expect(scan.placeholders.length).toBeGreaterThan(4)
    const zip = await JSZip.loadAsync(bytes)
    expect(zip.file('[Content_Types].xml')).not.toBeNull()
    expect(Object.keys(zip.files).filter(p => /embedding|chart|oleObject/i.test(p))).toEqual([])
    for (const entry of Object.values(zip.files)) {
      if (!entry.name.endsWith('.rels')) continue
      const xml = await entry.async('string')
      expect(xml).not.toContain('TargetMode="External"')
      const base = entry.name === '_rels/.rels' ? '' : posix.dirname(entry.name).replace(/\/_rels$/, '')
      for (const match of xml.matchAll(/Target="([^"]+)"/g)) {
        const target = posix.normalize(posix.join(base, match[1]))
        expect(zip.file(target), target).not.toBeNull()
      }
    }
  })
  it.each([0, 1, 8, 17])('%i행 병합 후 미치환 토큰 없이 전체 데이터를 출력한다', async count => {
    const bytes = await readFile(defaultFormAssetPath(kind))
    const engine = engineFor(kind.endsWith('pptx') ? 'pptx' : 'xlsx')
    const result = await engine.render(bytes, modelFor(kind, count), {}, DEFAULT_RENDER_OPTIONS[kind])
    const scan = await engine.scan(result)
    expect(scan.issues).toEqual([])
    expect(scan.placeholders).toEqual([])
    if (kind.endsWith('xlsx')) {
      const book = new ExcelJS.Workbook()
      await book.xlsx.load(Buffer.from(result) as never)
      const sheet = book.worksheets[0]
      expect(sheet.rowCount).toBe(4 + count)
      expect(sheet.getCell('B3').value).toBe(0)
      if (count && kind === 'wbs_export_xlsx') {
        expect(sheet.getCell('A5').value).toBe(0)
        expect(sheet.getCell('F5').value).toBeInstanceOf(Date)
        expect(sheet.getCell('H5').value).toBe(0)
      }
    } else {
      const zip = await JSZip.loadAsync(result)
      const slides = Object.keys(zip.files).filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      const xml = (await Promise.all(slides.map(p => zip.file(p)!.async('string')))).join('\n')
      for (let n = 0; n < count; n++) expect(xml).toContain(kind.startsWith('weekly') ? `구분 ${n}` : `이슈 ${n}`)
      // 주간: 표지 + 구분마다 한 장. 이슈 분석: 표지 + 영역별 종합 + 영역 하나의 이슈 목록·원인 분석(행 상한 5 로 이어지는 장)·개선기회 한 장
      const perArea = Math.ceil(count / DEFAULT_RENDER_OPTIONS[kind].max_rows_per_slide)
      expect(slides.length).toBe(kind.startsWith('weekly') ? count + 1 : 2 + (count ? perArea * 2 + 1 : 0))
    }
  })
})
