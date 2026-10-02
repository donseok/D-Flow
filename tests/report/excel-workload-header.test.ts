// 엑셀 '4) 담당자별 워크로드' 머리는 표시 요일 라벨을 따른다(SP5 A 과제 15 — 5칸 고정 폐기). 합계·비고 열은 그 뒤로 밀린다.
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildReportWorkbook } from '@/lib/report/excel'
import { buildWeeklyReportModel } from '@/lib/report/weekly'
import { calendarOf } from '@/lib/domain/calendar'
import { calSeoulMon } from '../helpers/calendarFixture'

const sixDay = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5, 6], weekStart: [{ day: 'monday', from: null }] })

async function headerOf(calendar = sixDay): Promise<string[]> {
  const model = buildWeeklyReportModel([], { name: 'Acme' }, '2026-06-30', { teams: ['RES'], calendar })
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await buildReportWorkbook(model, 'Acme'))
  const ws = wb.worksheets[0]
  let header: string[] = []
  ws.eachRow((row) => {
    const vals = (row.values as unknown[]).slice(1).map(v => (v == null ? '' : String(v)))
    if (vals[1] === '담당자' && vals[2] !== '산출물') header = vals
  })
  return header
}

describe('엑셀 워크로드 머리', () => {
  it('근무 [1..6] → 월~토 6칸, 합계·비고가 그 뒤', async () => {
    const h = await headerOf()
    expect(h.slice(0, 10)).toEqual(['#', '담당자', '월', '화', '수', '목', '금', '토', '합계', '비고'])
  })
  it('월~금 달력은 옛 머리와 같다(월~금 5칸 + 합계·비고)', async () => {
    const h = await headerOf(calSeoulMon)
    expect(h.slice(0, 9)).toEqual(['#', '담당자', '월', '화', '수', '목', '금', '합계', '비고'])
  })
})
