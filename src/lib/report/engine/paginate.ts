import type { NarrativeGroup } from '../narrative'
import { subLineText } from '../xml'

/* ── 셀 용량·페이지 분할(순수). 템플릿 셀 높이가 고정 → 넘치는 내용은 잘라내지 않고
 *    slide2를 복제한 연속 슬라이드로 이어 붙인다(활동 항목 유실 없음). ── */

/** 항목 목록을 max개로 제한하고 초과분은 '외 N건' 한 줄로 요약 — 이슈/이벤트 셀 전용.
 *  시트 경로(sheetNarrative REPORT_ITEM_LIMIT)와 동일한 표시 규칙(max건 + '외 N건'). */
export function capItems(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max), `외 ${items.length - max}건`]
}

/** 시각적 줄수 추정 — 12pt·콘텐츠 셀폭 4.67" 기준 전각(한글·CJK) 약 26자/줄, 영문·숫자는 반각(0.5). */
const FULLWIDTH_PER_LINE = 26
export function lineCost(text: string): number {
  let w = 0
  for (const ch of text) w += ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.5
  return Math.max(1, Math.ceil(w / FULLWIDTH_PER_LINE))
}

/** 그룹 줄수 = 헤더 + 들여쓴 하위 항목들(줄바꿈 추정 포함) — 실제 렌더 문자열과 동일 기준. */
const groupCost = (phase: string, items: string[], fmt: (item: string) => string): number =>
  lineCost(phase) + items.reduce((s, it) => s + lineCost(fmt(it)), 0)

/** 최하위 상세 줄('.' 마커) 여부 — 담당/소제목 헤더('-'·일반 줄)와 구분(분할 시 헤더-상세 찢김 방지용). */
const isChildLine = (s: string): boolean => s.trimStart().startsWith('.')

/** 그룹들을 페이지(셀)당 budget 시각줄 이내로 분할. 그룹 사이 빈 줄 1도 예산에 포함.
 *  새 페이지에 통째로 들어가는 그룹은 쪼개지 않고 이월하고, 한 페이지를 넘는 그룹만
 *  항목 단위로 쪼개 '(계속)' 헤더로 잇는다. 빈 입력은 1페이지(빈 그룹 목록)로. */
export function paginateGroups(
  groups: NarrativeGroup[], budget: number,
  lineFormatter: (item: string) => string = subLineText,
): NarrativeGroup[][] {
  const pages: NarrativeGroup[][] = []
  let page: NarrativeGroup[] = []
  let used = 0
  const flush = () => { if (page.length) pages.push(page); page = []; used = 0 }
  for (const g of groups) {
    let phase = g.phase
    let items = g.items
    for (;;) {
      const sep = page.length ? 1 : 0            // 직전 그룹과의 빈 줄
      const remain = budget - used - sep
      const total = groupCost(phase, items, lineFormatter)
      if (total <= remain || (!page.length && !items.length)) {
        page.push({ phase, num: g.num, items })  // 통째로 수용(빈 페이지의 거대 헤더는 방어적 수용)
        used += sep + total
        break
      }
      if (page.length && total <= budget) { flush(); continue }  // 새 페이지로 통째 이월
      let cost = lineCost(phase), take = 0       // 분할: 남은 공간에 들어가는 항목까지
      while (take < items.length && cost + lineCost(lineFormatter(items[take])) <= remain) {
        cost += lineCost(lineFormatter(items[take]))
        take += 1
      }
      // 상세('.') 직전의 헤더가 페이지 끝에 홀로 남지 않게 헤더부터 다음 페이지로 이월
      if (take > 0 && take < items.length && isChildLine(items[take]) && !isChildLine(items[take - 1])) take -= 1
      if (take === 0) {
        if (page.length) { flush(); continue }
        take = 1                                 // 예산보다 큰 단일 항목 — 최소 진행 보장
      }
      page.push({ phase, num: g.num, items: items.slice(0, take) })
      flush()
      const rest = items.slice(take)
      // 상세('.') 중간에서 끊겼으면 직전 헤더를 '(계속)'으로 반복해 담당 문맥 유지.
      // take=1(헤더만 실은 페이지)에는 재삽입하지 않음 — 동일 상태 반복(무한 루프) 방지.
      if (take > 1 && rest.length && isChildLine(rest[0])) {
        const hdr = items.slice(0, take).reverse().find(s => !isChildLine(s))
        if (hdr) rest.unshift(hdr.endsWith(' (계속)') ? hdr : `${hdr} (계속)`)
      }
      items = rest
      if (!items.length) break // 강제 수용(take=1)이 마지막 항목이면 빈 '(계속)' 페이지를 만들지 않는다
      phase = phase.endsWith(' (계속)') ? phase : `${g.phase} (계속)`
    }
  }
  flush()
  return pages.length ? pages : [[]]
}

/** 불릿 줄 목록을 셀 예산(시각 줄수) 단위 페이지로 분할 — 이슈/이벤트 셀 전용. 항목 유실·'외 N건' 캡 없이 전부.
 *  paginateGroups와 달리 줄 사이 빈 줄(구분자)이 없다 — 이슈/이벤트 불릿은 붙여 렌더되므로 실측 줄수와 일치.
 *  예산을 단독 초과하는 한 줄은 자기 페이지에 그대로 싣는다(잘라내지 않음). 빈 목록은 빈 1페이지. */
export function paginateLines(lines: string[], budget: number): string[][] {
  const pages: string[][] = []
  let page: string[] = []
  let used = 0
  for (const line of lines) {
    const c = lineCost(line)
    if (page.length && used + c > budget) { pages.push(page); page = []; used = 0 }
    page.push(line)
    used += c
  }
  if (page.length) pages.push(page)
  return pages.length ? pages : [[]]
}
