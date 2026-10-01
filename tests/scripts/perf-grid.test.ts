import { createHash } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import { GRID_SHAPE, classifyRuns, gridProjectName, gridRowCount, gridRows, gridTarget, mulberry32, parsePhases, rowCountVerdict, summarize } from '../../scripts/perf-grid.mjs'
import { STALL_STAGES, stalledRun, withDeadline } from '../../scripts/perf-grid.mjs'
import { measureArgs } from '../../scripts/perf-grid.mjs'
import { BROWSER_PER_RUN, CHECKPOINTS_MS, dueCheckpoint, frameStats, longTaskBefore, maxRowsOf, ownersVerdict, prefsMismatch, scrollPlan, timedClose } from '../../scripts/perf-grid.mjs'
import { median, percentile } from '../../scripts/lib/perf.mjs'

const CTX = {
  projectId: '00000000-0000-0000-7e57-000000001510', today: '2026-09-29',
  teamIds: ['00000000-0000-0000-7e57-000000001511', '00000000-0000-0000-7e57-000000001512', '00000000-0000-0000-7e57-000000001513', '00000000-0000-0000-7e57-000000001514', '00000000-0000-0000-7e57-000000001515'],
  memberIds: Array.from({ length: 20 }, (_, i) => `00000000-0000-0000-7e57-0000000015${String(20 + i).padStart(2, '0')}`),
}

describe('gridRows — 1만 행 합성(스펙 §3.2)', () => {
  const g = gridRows(CTX)
  it('같은 입력이면 같은 행(고정 PRNG)', () => {
    expect(gridRows(CTX)).toEqual(g)
    expect([mulberry32(7)(), mulberry32(7)()]).toEqual([mulberry32(7)(), mulberry32(7)()])
  })
  it('행 수 = 10+100+1000+9000 = 10,110, 깊이 4, 부모가 먼저', () => {
    expect(g.wbs).toHaveLength(GRID_SHAPE.phases * (1 + GRID_SHAPE.tasks * (1 + GRID_SHAPE.activities * (1 + GRID_SHAPE.details))))
    expect(g.wbs).toHaveLength(10110)
    expect(new Set(g.wbs.map((r) => r.level_idx))).toEqual(new Set([0, 1, 2, 3]))
    const seen = new Set<string>()
    for (const r of g.wbs) { if (r.parent_id) expect(seen.has(r.parent_id)).toBe(true); seen.add(r.id) }
  })
  it('분리 부모 접힘이 행 수를 줄이지 않게 is_owner_split 은 전부 false(판정 Q9)', () => {
    expect(g.wbs.every((r) => r.is_owner_split === false)).toBe(true)
  })
  it('잎마다 primary 담당 하나, 팀 5·담당 20 안에서', () => {
    const leaves = g.wbs.filter((r) => r.level_idx === 3)
    expect(g.owners).toHaveLength(leaves.length)
    expect(new Set(g.owners.map((o) => o.team_id)).size).toBe(5)
    expect(new Set(leaves.map((r) => r.assignee_member_id)).size).toBeLessThanOrEqual(20)
  })
})

describe('측정 판정', () => {
  it('DOM 행 수가 시드 행 수와 다르면 실패 — max_rows 잘림을 측정으로 삼지 않는다(D51)', () => {
    expect(() => rowCountVerdict(10110, 10110)).not.toThrow()
    expect(() => rowCountVerdict(1000, 10110)).toThrow(/1000.*10110/)
  })
  it('요약은 run 마다의 중앙값', () => {
    const runs = [1, 5, 3].map((x) => ({ firstRowMs: x, longTaskMs: x * 2, frameAvgMs: 16, framesOver50: x, htmlEndMs: x * 10, ttfbMs: x, domRows: 10110 }))
    expect(summarize(runs)).toEqual({ firstRowMs: 3, longTaskMs: 6, frameAvgMs: 16, framesOver50: 3, htmlEndMs: 30, ttfbMs: 3, domRows: 10110, excluded: {} })
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
  })
  it('null(스크롤 여지 없음·첫 행 없음)은 그 키의 중앙값에서 빼고 뺀 수를 적는다 — 0 으로 세면 중앙값이 내려간다(D14)', () => {
    const base = { firstRowMs: 1, longTaskMs: 0, framesOver50: 0, htmlEndMs: 1, ttfbMs: 1, domRows: 1011 }
    const s = summarize([{ ...base, frameAvgMs: null }, { ...base, frameAvgMs: 30 }, { ...base, frameAvgMs: 50 }])
    expect(s.frameAvgMs).toBe(40)
    expect(s.excluded).toEqual({ frameAvgMs: 1 })
    expect(summarize([{ ...base, frameAvgMs: null }]).frameAvgMs).toBeNull()
  })
  it.each([
    ['LOCAL_DB_URL 없음', { LOCAL_DB_URL: undefined }, /LOCAL_DB_URL/],
    ['레인 A 54322', { LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }, /54422/],
    ['앱 3000', { appUrl: 'http://127.0.0.1:3000' }, /3000/],
    ['원격 Supabase', { supabaseUrl: 'https://x.supabase.co' }, /로컬이 아니다/],
  ])('대상 거부 — %s', (_n, over, re) => {
    const env = { LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres', supabaseUrl: 'http://127.0.0.1:54421', appUrl: 'http://127.0.0.1:3201', ...over }
    expect(() => gridTarget(env)).toThrow(re)
  })
})

describe('measure 인자 — measureArgs(순수)', () => {
  it('기본값 — 10단계·5회·120초·기준 주소 없음·라벨 ui0', () => {
    expect(measureArgs([])).toEqual({ phases: 10, runs: 5, timeoutMs: 120_000, base: null, label: 'ui0' })
    expect(measureArgs(['--phases', '3', '--runs', '2', '--timeout-ms', '60000', '--label', 'spu2-p3', '--base', 'http://127.0.0.1:3202']))
      .toEqual({ phases: 3, runs: 2, timeoutMs: 60_000, base: 'http://127.0.0.1:3202', label: 'spu2-p3' })
  })
  it('--label 은 라벨 형식(KEY_RE)만 — 경로 문자로 산출 폴더 밖에 쓰지 않는다(UI-0 안전 리뷰 P3-2)', () => {
    for (const bad of ['../../../../tmp/x', 'a/b', 'UI0', '']) expect(() => measureArgs(['--label', bad])).toThrow(/--label/)
  })
  it('모르는 인자·값 없음·범위 밖은 throw', () => {
    expect(() => measureArgs(['--nope', '1'])).toThrow(/알 수 없는/)
    expect(() => measureArgs(['--runs'])).toThrow(/값이 없다/)
    expect(() => measureArgs(['--runs', '0'])).toThrow(/--runs/)
    expect(() => measureArgs(['--timeout-ms', '999'])).toThrow(/--timeout-ms/)
  })
})

describe('규모 인자 --phases(1·3·5·10)', () => {
  it.each([[1, 1011], [3, 3033], [5, 5055], [10, 10110]])('phases %i → 시드 행 %i', (n, rows) => {
    expect(gridRowCount(n)).toBe(rows)
    const g = gridRows({ ...CTX, phases: n })
    expect(g.wbs).toHaveLength(rows)
    expect(g.owners).toHaveLength(n * 900)
    expect(g.wbs.filter((r) => r.level_idx === 0)).toHaveLength(n)
  })
  it('phases 를 안 주거나 10 이면 출력이 바이트 단위로 이전과 같다(고정 해시)', () => {
    const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex')
    const golden = '3d596b07977301f7ecee5fead9d45b1e5f295aebaa3249d859c63ea723809e8d'
    expect(sha(gridRows(CTX))).toBe(golden)
    expect(sha(gridRows({ ...CTX, phases: 10 }))).toBe(golden)
  })
  it('프로젝트 이름 — 10 은 PERF-GRID, 그 밖은 PERF-GRID-p<N>', () => {
    expect(gridProjectName(10)).toBe('PERF-GRID')
    expect(gridProjectName(1)).toBe('PERF-GRID-p1')
    expect(gridProjectName(5)).toBe('PERF-GRID-p5')
  })
  it('parsePhases — 기본 10, 허용 밖은 거부', () => {
    expect(parsePhases(undefined)).toBe(10)
    expect(parsePhases('3')).toBe(3)
    for (const bad of ['0', '2', '4', '11', '-1', 'abc', '', '3.5']) expect(() => parsePhases(bad)).toThrow(/--phases/)
  })
  it('gridRows 도 허용 밖 phases 를 거부', () => {
    expect(() => gridRows({ ...CTX, phases: 2 })).toThrow(/phases/)
  })
})

describe('응답 없음은 오류가 아니라 결과 — classifyRuns', () => {
  const ok = { status: 'ok', firstRowMs: 900, longTaskMs: 0, frameAvgMs: 16, framesOver50: 0, htmlEndMs: 100, ttfbMs: 50, domRows: 1011 }
  const dead = { status: 'unresponsive', timeoutMs: 60000, domRowsAt: [{ atMs: 5000, rows: 518 }, { atMs: 15000, rows: null }] }
  it('응답한 run 만 있으면 exit 0, unresponsive 거짓', () => {
    expect(classifyRuns([ok, ok])).toEqual({ unresponsive: false, exitCode: 0, statuses: ['ok', 'ok'], median: summarize([ok, ok]) })
  })
  it('한 run 이라도 응답 없음이면 exit 2 — 오류(1)와 구분, 응답한 run 의 중앙값은 남긴다', () => {
    const r = classifyRuns([ok, dead, ok])
    expect(r.unresponsive).toBe(true)
    expect(r.exitCode).toBe(2)
    expect(r.statuses).toEqual(['ok', 'unresponsive', 'ok'])
    expect(r.median).toEqual(summarize([ok, ok]))
  })
  it('전부 응답 없음이면 median 은 null', () => {
    expect(classifyRuns([dead])).toEqual({ unresponsive: true, exitCode: 2, statuses: ['unresponsive'], median: null })
  })
})

describe('응답 뒤 단계의 상한 — 멈춘 run 은 끝없이 기다리지 않고 멈춘 단계를 남긴다(과제 5 권고 3, 과제 5b)', () => {
  const ok = { status: 'ok', firstRowMs: 900, longTaskMs: 0, frameAvgMs: 16, framesOver50: 0, htmlEndMs: 100, ttfbMs: 50, domRows: 1011 }
  it('withDeadline — 기한 안에 끝나면 그 값', async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toStrictEqual({ ok: true, value: 7 })
  })
  it('withDeadline — 기한을 넘기면 ok 거짓(끝나지 않는 page.evaluate 를 더 기다리지 않는다 — 과제 5 의 5,055행 15분 멈춤)', async () => {
    await expect(withDeadline(new Promise(() => {}), 20)).resolves.toStrictEqual({ ok: false })
  })
  it('withDeadline — 기한 안의 거부는 그대로 거부(닫힌 페이지는 결과가 아니라 오류 → exit 1)', async () => {
    await expect(withDeadline(Promise.reject(new Error('Target page, context or browser has been closed')), 1000)).rejects.toThrow(/closed/)
  })
  it('withDeadline — 먼저 끝나면 기한 타이머를 남기지 않는다', async () => {
    vi.useFakeTimers()
    try {
      await withDeadline(Promise.resolve(1), 60_000)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('stalledRun — unresponsive + 멈춘 단계(load 응답 전 · settle 행 수 안정 대기 · scroll 스크롤 측정), 그 밖의 단계는 거부', () => {
    expect(STALL_STAGES).toEqual(['load', 'settle', 'scroll'])
    expect(stalledRun('load', { timeoutMs: 60000, domRowsAt: [{ atMs: 5000, rows: null }] }))
      .toStrictEqual({ status: 'unresponsive', stalledAt: 'load', timeoutMs: 60000, domRowsAt: [{ atMs: 5000, rows: null }] })
    expect(stalledRun('settle', { timeoutMs: 60000, domRowsAt: [] })).toStrictEqual({ status: 'unresponsive', stalledAt: 'settle', timeoutMs: 60000, domRowsAt: [] })
    expect(stalledRun('scroll', { timeoutMs: 120000, domRowsAt: [], domRows: 3033 }))
      .toStrictEqual({ status: 'unresponsive', stalledAt: 'scroll', timeoutMs: 120000, domRowsAt: [], domRows: 3033 })
    expect(() => stalledRun('render', { timeoutMs: 1000, domRowsAt: [] })).toThrow(/단계/)
  })
  it('멈춘 run 은 응답 없음으로 센다 — 중앙값에서 빠지고 exit 2(결과), 오류(1)가 아니다', () => {
    const stalled = stalledRun('scroll', { timeoutMs: 120000, domRowsAt: [], domRows: 3033 })
    expect(classifyRuns([ok, stalled])).toEqual({ unresponsive: true, exitCode: 2, statuses: ['ok', 'unresponsive'], median: summarize([ok]) })
  })
})

describe('측정 조립의 순수 조각(UI-0 결정성 리뷰 P3 — D12·D13·D15)', () => {
  it('프레임 통계 — 첫 간격(측정 시작 → 첫 rAF)은 빼고 평균·50ms 초과 수·프레임 수', () => {
    expect(frameStats([5, 16, 16, 61])).toEqual({ frameAvgMs: 31, framesOver50: 1, frameCount: 3 })
    expect(frameStats([5])).toEqual({ frameAvgMs: null, framesOver50: 0, frameCount: 0 })
    expect(frameStats([])).toEqual({ frameAvgMs: null, framesOver50: 0, frameCount: 0 })
  })
  it('첫 행까지의 긴 작업 합 — 첫 행 전에 시작한 작업만, 첫 행이 없으면 null(0 이 아니다)', () => {
    expect(longTaskBefore([[10, 60], [100, 80], [500, 70]], 400)).toBe(140)
    expect(longTaskBefore([], 100)).toBe(0)
    expect(longTaskBefore([[10, 60]], null)).toBeNull()
  })
  it('행 수 표본의 체크포인트 — 지난 것 가운데 아직 안 적은 첫 것(한 반복에 하나), 상한 밖 체크포인트는 없다', () => {
    expect(CHECKPOINTS_MS).toEqual([5000, 15000, 30000, 60000])
    expect(dueCheckpoint(4000, 120_000, [])).toBeUndefined()
    expect(dueCheckpoint(5200, 120_000, [])).toBe(5000)
    expect(dueCheckpoint(16_000, 120_000, [5000])).toBe(15_000)
    expect(dueCheckpoint(16_000, 120_000, [])).toBe(5000)
    expect(dueCheckpoint(61_000, 30_000, [5000, 15_000, 30_000])).toBeUndefined()
  })
  it('1,000행 스크롤은 행 높이로 — 목표 1,000 × 행 높이, 한 프레임 10행(행 높이가 바뀌어도 같은 행 수·프레임 수 — 비교 Q07 의 전제)', () => {
    expect(scrollPlan(40)).toEqual({ rowHeight: 40, targetPx: 40_000, stepPx: 400 })
    expect(scrollPlan(32)).toEqual({ rowHeight: 32, targetPx: 32_000, stepPx: 320 })
    for (const bad of [0, -1, null, Number.NaN, 1.5]) expect(() => scrollPlan(bad)).toThrow(/행 높이/)
  })
  it('max_rows — 래퍼가 고정한 config.toml 의 값을 읽는다(없으면 멈춘다)', () => {
    expect(maxRowsOf('[api]\nenabled = true\nport = 54421\nmax_rows = 20000\n\n[db]\nport = 54422\n')).toBe(20_000)
    expect(() => maxRowsOf('[api]\nport = 54421\n')).toThrow(/max_rows/)
  })
  it('item_owners 총수 < max_rows — 앱의 무범위 item_owners 조회가 잘리면 담당 배지가 순서 없이 빠진 채 행 수 대조는 통과한다(D12·D51)', () => {
    expect(() => ownersVerdict(17_148, 20_000)).not.toThrow()
    expect(() => ownersVerdict(20_000, 20_000)).toThrow(/item_owners 20000.*max_rows 20000/)
    expect(() => ownersVerdict(null, 20_000)).toThrow(/item_owners/)
  })
})

describe('측정 시작 상태·run 격리(UI-0 결정성 리뷰 P2 — D6·D7)', () => {
  it('측정 계정의 선호값 확인 — 행마다 고정 객체(계정 행: 테마 light, 워크스페이스 행: pin)와 정확히 같아야 한다(간트 일 폭·개요 번호·완료 숨김 없음)', () => {
    const want = { sidebarCollapsed: false, locale: 'ko', theme: 'light' }
    expect(prefsMismatch([{ workspace_id: 'wA', prefs: { ...want } }], want)).toEqual([])
    expect(prefsMismatch([{ workspace_id: 'wA', prefs: { ...want, wbsGanttScale: 48 } }, { workspace_id: 'wB', prefs: { ...want, theme: 'dark' } }], want)).toEqual(['wA', 'wB'])
    expect(prefsMismatch([], want)).toEqual(['(소속 없음)'])
  })
  it('닫기 소요·시간 초과를 run 표본에 — 단계마다 상한, 앞 단계가 넘어도 다음 단계(브라우저 닫기)를 부른다, 닫기 오류는 삼킨다', async () => {
    const fast = () => Promise.resolve()
    const never = () => new Promise<void>(() => {})
    await expect(timedClose([[fast, 1000], [fast, 1000]])).resolves.toMatchObject({ closeTimedOut: false })
    const calls: string[] = []
    const r = await timedClose([[() => { calls.push('context'); return never() }, 20], [() => { calls.push('browser'); return fast() }, 1000]])
    expect(r.closeTimedOut).toBe(true)
    expect(calls).toEqual(['context', 'browser'])
    expect(r.closeMs).toBeGreaterThanOrEqual(0)
    await expect(timedClose([[() => Promise.reject(new Error('already closed')), 1000]])).resolves.toMatchObject({ closeTimedOut: false })
  })
  it('run 마다 브라우저를 새로 띄운다(프로세스 격리) — 결과 JSON 이 그 방식을 적는다', () => {
    expect(BROWSER_PER_RUN).toBe(true)
  })
})
