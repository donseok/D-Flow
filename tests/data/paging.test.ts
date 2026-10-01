import { describe, expect, it } from 'vitest'
import { fetchAllByKeyset, fetchAllPages } from '@/lib/data/paging'

// PostgREST 흉내 — 한 응답은 maxRows 에서 잘리고, count 는 총합이다(count: 'exact').
function table(rows: number[], opts: { maxRows?: number; count?: number | null; failAt?: number } = {}) {
  const calls: Array<[number, number]> = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    if (opts.failAt === from) return { data: null, error: { message: 'down' }, count: null }
    const end = Math.min(to + 1, from + (opts.maxRows ?? 1000))
    return { data: rows.slice(from, end), error: null, count: opts.count === undefined ? rows.length : opts.count }
  }
  return { page, calls }
}
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('fetchAllPages — max_rows 를 넘는 표를 끝까지, 잘리면 throw', () => {
  it('1500행은 두 페이지로 전부', async () => {
    const t = table(range(1500))
    expect(await fetchAllPages('t', t.page)).toEqual(range(1500))
    expect(t.calls).toEqual([[0, 999], [1000, 1999]])
  })

  it('서버 상한이 페이지보다 작아도(max_rows 300) 받은 만큼 전진해 빠짐없이', async () => {
    const t = table(range(1000), { maxRows: 300 })
    expect(await fetchAllPages('t', t.page)).toEqual(range(1000))
    expect(t.calls.map(c => c[0])).toEqual([0, 300, 600, 900])
  })

  it('빈 표는 한 번 묻고 []', async () => {
    const t = table([])
    expect(await fetchAllPages('t', t.page)).toEqual([])
    expect(t.calls).toHaveLength(1)
  })

  it('다 읽은 행 수가 count 와 다르면 잘린 것 — throw(빈 목록·부분 목록으로 위장하지 않는다)', async () => {
    const p = fetchAllPages('projects', table(range(3), { count: 4 }).page)
    await expect(p).rejects.toThrow('projects 목록을 끝까지 읽지 못했습니다(3/4건)')
    await expect(p).rejects.toThrow('잠시 후 다시 시도하세요')   // 이 문구를 그대로 보이는 화면·API 가 할 일을 알린다
  })

  it('count 가 없으면 잘림을 확인할 수 없다 — throw', async () => {
    await expect(fetchAllPages('teams', table(range(3), { count: null }).page)).rejects.toThrow('teams 행 수(count)를 받지 못해')
  })

  it('중간 페이지 오류도 throw — 앞 페이지만으로 돌려주지 않는다', async () => {
    await expect(fetchAllPages('teams', table(range(1500), { failAt: 1000 }).page)).rejects.toThrow('teams 조회 실패: down')
  })
})

// 키셋 쪽 나눔(SP4 A1-1 K1·K2) — offset 은 쪽 사이의 정렬 이동·삽입+삭제에서 중복 1 + 누락 1 을 만들고 행 수가 같아 count 대조를
// 통과한다. 바뀌지 않는 유일 키 다음부터 읽으면 이미 있던 행은 밀리지 않는다.
/** PostgREST 키셋 흉내 — 키 오름차순, after(마지막 행) 보다 큰 키만, 한 응답은 maxRows 에서 잘린다. onPage(n) 은 n 번째 응답 뒤에 표를 바꾼다. */
function keyed(initial: string[], opts: { maxRows?: number; onPage?: (n: number, rows: string[]) => void; ignoreAfter?: boolean } = {}) {
  let rows = [...initial]
  const calls: Array<[string | null, number]> = []
  const page = async (after: string | null, limit: number) => {
    calls.push([after, limit])
    const sorted = [...rows].sort()
    const count = sorted.length
    const data = sorted.filter((k) => opts.ignoreAfter || after === null || k > after).slice(0, Math.min(limit, opts.maxRows ?? 1000))
    opts.onPage?.(calls.length, rows)
    return { data, error: null, count }
  }
  return { page, calls, set: (next: string[]) => { rows = next } }
}
const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `k${String(i + from).padStart(5, '0')}`)

describe('fetchAllByKeyset — 바뀌지 않는 키 다음부터 읽는다(쪽 사이 변경에도 중복·누락 0)', () => {
  it('1500행은 마지막 키 다음부터 — 끝은 빈 쪽으로 확인한다', async () => {
    const t = keyed(ids(1500))
    expect(await fetchAllByKeyset('t', (k: string) => k, t.page)).toEqual(ids(1500))
    expect(t.calls).toEqual([[null, 1000], ['k00999', 1000], ['k01499', 1000]])
  })

  it('첫 쪽에 count 만큼 다 왔으면 한 번으로 끝난다(같은 문장의 스냅숏)', async () => {
    const t = keyed(ids(3))
    expect(await fetchAllByKeyset('t', (k: string) => k, t.page)).toEqual(ids(3))
    expect(t.calls).toHaveLength(1)
  })

  it('서버 상한이 쪽보다 작아도(max_rows 300) 빠짐없이', async () => {
    const t = keyed(ids(1000), { maxRows: 300 })
    expect(await fetchAllByKeyset('t', (k: string) => k, t.page)).toEqual(ids(1000))
  })

  it('[K2] 쪽 사이에 앞 구간으로 삽입돼도(총합이 쪽 크기의 배수) 이미 있던 행이 중복·누락되지 않는다', async () => {
    const base = ids(2000)
    const t = keyed(base, { onPage: (n, rows) => { if (n === 1) t.set([...rows, 'k00500a']) } })
    const out = await fetchAllByKeyset('t', (k: string) => k, t.page)
    expect(new Set(out).size).toBe(out.length)
    expect(out).toEqual(base)
  })

  it('[K2] 앞 구간 삽입 + 뒤 구간 삭제(순증 0) — 지운 행은 사라졌으니 count 와 달라 throw(중복으로 메워 통과하지 않는다)', async () => {
    const base = ids(1500)
    const t = keyed(base, { onPage: (n, rows) => { if (n === 1) t.set([...rows.filter((k) => k !== 'k01200'), 'k00500a']) } })
    await expect(fetchAllByKeyset('t', (k: string) => k, t.page)).rejects.toThrow('t 목록을 끝까지 읽지 못했습니다(1499/1500건)')
  })

  it('[K2] 같은 키가 두 번 오면 throw — 키셋 조건이 빠진 쿼리를 완전한 목록으로 돌려주지 않는다', async () => {
    const t = keyed(ids(5), { maxRows: 2, ignoreAfter: true })
    await expect(fetchAllByKeyset('t', (k: string) => k, t.page)).rejects.toThrow('t 같은 행을 두 번 읽었습니다')
  })

  it('조회 오류·count 없음은 throw', async () => {
    await expect(fetchAllByKeyset('t', (k: string) => k, async () => ({ data: null, error: { message: 'down' }, count: null })))
      .rejects.toThrow('t 조회 실패: down')
    await expect(fetchAllByKeyset('t', (k: string) => k, async () => ({ data: ['a'], error: null, count: null })))
      .rejects.toThrow('t 행 수(count)를 받지 못해')
  })
})
