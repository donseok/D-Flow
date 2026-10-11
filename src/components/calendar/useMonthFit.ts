'use client'
import { useLayoutEffect, useRef, useState } from 'react'

/** 한 주 줄의 최소 높이 — 이보다 낮아지면 맞추기를 포기하고 화면이 스크롤된다(낮은 창·가로 폰) */
const MIN_ROW = 64
/** 칸 안쪽 여백(p-1.5 위아래) + 날짜 줄(h-6) + 그 아래 간격(mt-1) */
const CELL_CHROME = 12 + 24 + 4
/** 항목 칩 한 줄(글자 줄 + py-0.5) + 줄 사이 간격(space-y-1) */
const CHIP_ROW = 24

export interface MonthFit {
  /** 달력 격자(요일 머리 + 날짜 칸)에 단다 */
  gridRef: React.RefObject<HTMLDivElement | null>
  /** 한 주 줄의 높이(px). 아직 재지 못했으면 null — 그때는 칸의 기본 최소 높이로 그린다 */
  rowHeight: number | null
  /** 한 칸에 그릴 수 있는 줄 수('+N 더보기' 줄 포함). 재기 전에는 fallbackRows */
  rowsPerCell: number
}

/**
 * 월 달력을 화면 높이에 맞춘다 — 그 달의 주(4~6줄)가 스크롤 없이 한 화면에 들어오게 줄 높이를 나눈다.
 * 격자의 위치는 머리·도구 줄 높이에 따라 달라지므로 CSS 상수로 두지 않고 잰다: 스크롤 주인(main)의 보이는 높이에서
 * 격자 위쪽에 놓인 것과 격자 아래 여백을 빼고 주 수로 나눈다. 창 크기가 바뀌거나 주 수가 달라지면 다시 잰다.
 */
export function useMonthFit(weeks: number, fallbackRows: number): MonthFit {
  const gridRef = useRef<HTMLDivElement | null>(null)
  const [rowHeight, setRowHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid || weeks <= 0) return
    const main = grid.closest('main')
    const measure = () => {
      const viewTop = main ? main.getBoundingClientRect().top : 0
      const viewH = main ? main.clientHeight : window.innerHeight
      // 스크롤을 맨 위로 올렸을 때 격자가 놓이는 자리 — 지금 스크롤 위치와 무관하게 같은 답이 나온다
      const top = grid.getBoundingClientRect().top - viewTop + (main?.scrollTop ?? 0)
      // 격자 아래에 남는 것: 격자를 감싼 상자들의 아래 여백·테두리(main 까지). 달력은 화면의 마지막 요소다
      let below = 0
      for (let el: HTMLElement | null = grid.parentElement; el; el = el === main ? null : el.parentElement) {
        const cs = getComputedStyle(el)
        below += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
      }
      const head = grid.querySelector<HTMLElement>('[data-cal-head]')?.offsetHeight ?? 0
      const gaps = weeks                                     // gap-px — 머리와 주 사이, 주와 주 사이
      const fit = Math.floor((viewH - top - below - head - gaps - 2) / weeks)
      setRowHeight(fit >= MIN_ROW ? fit : null)
    }
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    if (main) ro?.observe(main)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [weeks])

  const rowsPerCell = rowHeight === null ? fallbackRows : Math.max(1, Math.floor((rowHeight - CELL_CHROME) / CHIP_ROW))
  return { gridRef, rowHeight, rowsPerCell }
}

/** 칸에 n 개가 있을 때 보일 칩 수 — 다 들어가면 전부, 넘치면 한 줄을 '+N 더보기'에 내준다 */
export function visibleChips(n: number, rowsPerCell: number): number {
  return n <= rowsPerCell ? n : Math.max(0, rowsPerCell - 1)
}
