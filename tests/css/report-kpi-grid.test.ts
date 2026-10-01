// 보고서 모달 KPI 칸 폭(U1b 리뷰 R3 P2·수정 G4) — 모달(max-w-2xl, 672px) 안 4열이면 칸 내용 폭이 ~106px 이고 아이콘 36px 를 빼면
// 수치 칸이 ~58px 라 28px 수치('-11.8%p' ≈ 116px)가 카드 밖으로 넘치고 아이콘과 겹쳤다. 열 수는 뷰포트가 아니라 모달 폭에 맞춘다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const modal = readFileSync(join(process.cwd(), 'src/components/report/ReportModal.tsx'), 'utf8')

describe('보고서 모달 KPI 격자', () => {
  it('KPI 넷의 격자는 4열로 가지 않는다 — 좁은 화면 1열, 그 위 2열', () => {
    const i = modal.indexOf('<KpiCard label="전체 실적"')
    const section = modal.slice(modal.lastIndexOf('<section', i), i)
    expect(section).toMatch(/className="grid grid-cols-1 gap-3 sm:grid-cols-2"/)
    expect(section).not.toMatch(/grid-cols-4/)
  })
})
