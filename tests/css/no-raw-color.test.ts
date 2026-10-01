// 원색·임의 층 금지(SP3b 스펙 §8.1·E26, 개정 §5.5.7) — className 에 쓰는 유틸 모양만 본다(style 객체의 '#fff'·color-mix 는 모양이 달라 걸리지 않는다 —
// 계산된 색은 style 로 넘긴다, 레인 A 알림 1). 상수(TEAM_SLOTS·MS_CHIP·STATUS_META·도메인 색 표)에 든 클래스도 잡으려고 모든 줄을 본다.
// 허용 목록 = UI-1 이 마지막으로 rebase 한 main 의 위반 파일(E26). 파일마다 종류별 최대 건수 — 목록은 줄기만 한다(건수가 늘면 실패).
import { describe, expect, it } from 'vitest'
import { srcFiles } from './lib/cssTokens'

export const PATTERNS = {
  hex: /-\[[^\]\s"'`]*#[0-9a-fA-F]{3,8}[^\]\s"'`]*\]/g,
  rgb: /-\[[^\]\s"'`]*rgba?\([^\]\s"'`]*\]/g,
  z: /(?<![\w-])(?:[a-z0-9:[\]-]*:)?-?z-\[[^\]]+\]/g,
  palette: /(?<![\w-])(?:[a-z0-9:[\]-]*:)?(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|placeholder|decoration|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950)(?:\/[\w.[\]]+)?(?![\w-])/g,
} as const
type Kind = keyof typeof PATTERNS
type Counts = Partial<Record<Kind, number>>

export function countRaw(text: string): Counts {
  const out: Counts = {}
  for (const k of Object.keys(PATTERNS) as Kind[]) {
    const n = (text.match(PATTERNS[k]) ?? []).length
    if (n) out[k] = n
  }
  return out
}

/** 파일 → 종류별 최대 건수와 사유(주인 — 이행하는 SP) */
export const ALLOW: Record<string, Counts & { why: string }> = {
  'src/components/agents/RosterBoard.tsx': { hex: 13, z: 4, why: '좌석표 고유 색·층 — 화면 소유 SP(UI-5, 개정 §5.9.4)' },
  'src/components/agents/SeatSpeech.tsx': { hex: 1, why: '좌석표 말풍선 — 화면 소유 SP(UI-5)' },
  'src/components/minutes/MinuteBlockPopover.tsx': { z: 2, why: '회의록 화면 내부 층 — SP5(화면 소유)' },
  'src/components/minutes/MinuteSelectionBubble.tsx': { z: 1, why: '회의록 화면 내부 층 — SP5(화면 소유)' },
  'src/components/ui/DayPopover.tsx': { z: 2, why: '날짜 팝오버 내부 층 — 화면 소유 SP(UI-5)' },
  'src/components/wbs/RowDetailPanel.tsx': { z: 1, why: 'WBS 인스펙터 층 — UI-2b 레일(D56)' },
  'src/components/wbs/WbsGanttSheet.tsx': { z: 3, why: '작업 계획의 z 셋 — z-[25] 는 행 relative z-10 안, z-[45](진척 렌즈 fixed)·z-[60](툴바 토글)은 문서 층에서 셸(70) 아래로 경쟁하는 전역 층(U1b 리뷰 R2 P3) — UI-2b/SPU2 가 토큰으로(전체 화면 +1 은 UI-2b 과제 30 이 FAB 를 --z-rail 로 내리며 뺐다)' },
  'src/components/weekly/SheetCell.tsx': { hex: 10, rgb: 1, palette: 1, why: '주간 시트(엑셀 모사) — SP4 화면 이행' },
  'src/components/weekly/WeeklyAiRewriteModal.tsx': { palette: 12, why: '주간 AI 다시쓰기 — SP4 화면 이행' },
  'src/components/weekly/WeeklyLintPanel.tsx': { palette: 8, why: '주간 점검 패널 — SP4 화면 이행' },
  'src/components/weekly/WeeklySheetView.tsx': { hex: 4, palette: 12, why: '주간 시트(엑셀 모사) — SP4 화면 이행' },
  'src/lib/domain/issues.ts': { palette: 1, why: '이슈 도메인 색 표 — SP5b(상태 정의 파생)' },
  'src/lib/domain/projectColors.ts': { palette: 6, why: '프로젝트 색 표 — SP4(팀·영역 색 이행)' },
}

describe('no-raw-color', () => {
  const found = new Map(srcFiles(/\.tsx?$/).map(([f, t]) => [f, countRaw(t)] as const).filter(([, c]) => Object.keys(c).length))
  it('허용 목록 밖 파일은 0건', () => {
    expect([...found].filter(([f]) => !(f in ALLOW)).map(([f, c]) => `${f} ${JSON.stringify(c)}`)).toEqual([])
  })
  it('허용 목록의 건수는 적힌 수 이하다(늘면 실패 — 목록은 줄기만 한다)', () => {
    const over: string[] = []
    for (const [f, c] of found) {
      const a = ALLOW[f]
      if (!a) continue
      for (const k of Object.keys(c) as Kind[]) if ((c[k] ?? 0) > (a[k] ?? 0)) over.push(`${f} ${k} ${c[k]} > ${a[k] ?? 0}`)
    }
    expect(over).toEqual([])
  })
  it('허용 목록에 죽은 항목이 없다(0건이 된 파일은 뺀다)', () => {
    expect(Object.keys(ALLOW).filter((f) => !found.has(f))).toEqual([])
  })
  it('정규식이 살아 있다 — 모양별 표본', () => {
    expect(countRaw("className='bg-[#fff] shadow-[0_1px_rgba(0,0,0,.1)] z-[60] md:z-[70] bg-amber-500/90 hover:text-rose-400'")).toEqual({ hex: 1, rgb: 1, z: 2, palette: 2 })
    expect(countRaw("className='bg-neutral bg-neutral-weak text-warning z-(--z-modal) z-10'")).toEqual({})
    expect(countRaw("style={{ color: '#fff', background: 'rgba(0,0,0,.1)' }}")).toEqual({})
  })
})
