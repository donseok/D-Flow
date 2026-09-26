import { describe, expect, it } from 'vitest'
import { fetchAllPages } from '@/lib/data/paging'

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
