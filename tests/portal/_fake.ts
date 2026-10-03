// 포털 로더 테스트용 가짜 Supabase 클라이언트(과제 9) — tests/data/portal-v0.test.ts 의 빌더와 같은 꼴에 필터 기록을 더했다.
// 표 이름별 행, fail 이면 그 표 조회 오류. eq·neq·in·is 는 실제로 거르고(점 경로 = 임베드), or 는 기록만, 정렬·상한·range 는 가져갈 때 적용한다.
type Row = Record<string, unknown>
export type FakeCall = { table: string; select: string; filters: [string, string, unknown][]; ors: string[]; limit: number | null }

/** maxRows = PostgREST max_rows 흉내 — 한 응답이 그 수에서 잘린다(.range 로 끝까지 읽는지 판별) */
export function fake(tables: Record<string, Row[]>, opts: { fail?: string | string[]; maxRows?: number } = {}) {
  const maxRows = opts.maxRows ?? Infinity
  const calls: FakeCall[] = []
  const fails = new Set(Array.isArray(opts.fail) ? opts.fail : opts.fail ? [opts.fail] : [])
  const get = (r: Row, c: string) => c.split('.').reduce<unknown>((v, k) => (v as Row | null | undefined)?.[k], r)
  return {
    calls,
    from(table: string) {
      const rec: FakeCall = { table, select: '', filters: [], ors: [], limit: null }
      calls.push(rec)
      let rows = [...(tables[table] ?? [])]
      let counted = false
      let cap = Infinity
      const keys: [string, boolean][] = []
      /** 정렬 → limit 상한까지(전체 결과) */
      const sorted = () => (keys.length ? [...rows].sort((a, b) => {
        for (const [c, asc] of keys) { const x = String(get(a, c) ?? ''), y = String(get(b, c) ?? ''); if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1) }
        return 0
      }) : rows).slice(0, cap)
      const q: Record<string, unknown> = {
        select: (c: string, o?: { count?: string }) => { rec.select = c; counted = !!o?.count; return q },
        eq: (c: string, v: unknown) => { rec.filters.push(['eq', c, v]); rows = rows.filter((r) => get(r, c) === v); return q },
        neq: (c: string, v: unknown) => { rec.filters.push(['neq', c, v]); rows = rows.filter((r) => get(r, c) !== v); return q },
        in: (c: string, vs: unknown[]) => { rec.filters.push(['in', c, vs]); rows = rows.filter((r) => vs.includes(get(r, c))); return q },
        is: (c: string, v: unknown) => { rec.filters.push(['is', c, v]); rows = rows.filter((r) => (get(r, c) ?? null) === v); return q },
        or: (f: string) => { rec.ors.push(f); return q },
        order: (c: string, o?: { ascending?: boolean }) => { keys.push([c, o?.ascending !== false]); return q },
        limit: (n: number) => { rec.limit = n; cap = n; return q },
        lte: () => q, gte: () => q, gt: () => q, ilike: () => q,
        range: (a: number, b: number) => Promise.resolve(fails.has(table)
          ? { data: null, error: { message: 'down' }, count: null }
          : { data: sorted().slice(a, Math.min(b + 1, a + maxRows)), error: null, count: counted ? rows.length : null }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(fails.has(table)
          ? { data: null, error: { message: 'down' } } : { data: sorted().slice(0, maxRows), error: null }).then(res, rej),
      }
      return q
    },
  }
}
