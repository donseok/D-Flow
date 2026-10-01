import type { PageResult } from '@/lib/data/paging'

type Row = Record<string, unknown>
export type Call = { method: string; args: unknown[] }

/**
 * PostgREST 키셋 흉내(SP4 A2) — 쿼리(make)마다 필터·정렬·한도를 기억하고, eq·is·in·gt 를 실제로 적용하며 order 열 순으로 정렬한다.
 * 한 응답을 maxRows 에서 자르고 count 는 필터에 맞는 행 수다(count: 'exact'). log 는 쿼리별 호출 목록이다.
 * error 면 그 표의 모든 조회가 실패, afterResponse(n, rows) 는 n 번째 응답을 만든 뒤 표를 바꾼다(쪽 사이의 동시 변경).
 * 여러 표를 흉내 내려면 표마다 keysetTable 을 만들고 클라이언트의 from(table) 에서 그 표의 make() 를 돌려준다.
 */
type Cmp = (a: unknown, b: unknown) => number
const cmpOf: Cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
/** 최상위 쉼표로 나눈다(괄호 안의 쉼표는 그대로) */
function splitTop(expr: string): string[] {
  const out: string[] = []
  let depth = 0, cur = ''
  for (const ch of expr) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur) out.push(cur)
  return out
}
function condOf(term: string): (r: Row) => boolean {
  const and = /^and\((.*)\)$/.exec(term)
  if (and) { const parts = splitTop(and[1]).map(condOf); return (r) => parts.every((f) => f(r)) }
  const m = /^([^.]+)\.(eq|gt|gte|lt|is|in)\.(.*)$/.exec(term)
  if (!m) throw new Error(`keysetTable.or: 해석할 수 없는 항 ${term}`)
  const [, col, op, val] = m
  if (op === 'is') return (r) => (r[col] ?? null) === (val === 'null' ? null : val)
  if (op === 'in') {
    const list = /^\((.*)\)$/.exec(val)?.[1].split(',') ?? []
    return (r) => list.includes(String(r[col]))
  }
  return (r) => {
    const d = cmpOf(r[col], val)
    return op === 'eq' ? d === 0 : op === 'gt' ? d > 0 : op === 'gte' ? d >= 0 : d < 0
  }
}
function orFilter(expr: string): (r: Row) => boolean {
  const terms = splitTop(expr).map(condOf)
  return (r) => terms.some((f) => f(r))
}

export function keysetTable(initial: readonly Row[], opts: {
  maxRows?: number; error?: { message: string }; afterResponse?: (n: number, rows: Row[]) => Row[] | void
} = {}) {
  let rows: Row[] = [...initial]
  const log: Call[][] = []
  const cmp = (a: unknown, b: unknown) =>
    (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
  const make = () => {
    const calls: Call[] = []
    log.push(calls)
    const orders: string[] = []
    const filters: Array<(r: Row) => boolean> = []
    let limit = Number.MAX_SAFE_INTEGER
    let single = false
    const q: Record<string, unknown> = {}
    const rec = (method: string, args: unknown[]) => { calls.push({ method, args }); return q }
    q.select = (...args: unknown[]) => rec('select', args)
    q.eq = (c: string, v: unknown) => { filters.push((r) => r[c] === v); return rec('eq', [c, v]) }
    q.is = (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return rec('is', [c, v]) }
    q.in = (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return rec('in', [c, vs]) }
    q.gt = (c: string, v: unknown) => { filters.push((r) => cmp(r[c], v) > 0); return rec('gt', [c, v]) }
    q.gte = (c: string, v: unknown) => { filters.push((r) => cmp(r[c], v) >= 0); return rec('gte', [c, v]) }
    // PostgREST or 필터의 작은 부분집합 — `a.op.v,and(b.op.v,c.op.v)`(op: eq·gt·gte·lt·is·in). 복합 키셋(item_owners·포트폴리오 스냅샷)·가시 범위 팀의 꼴
    q.or = (expr: string) => { filters.push(orFilter(expr)); return rec('or', [expr]) }
    q.order = (c: string) => { orders.push(c); return rec('order', [c]) }
    q.limit = (n: number) => { limit = n; return rec('limit', [n]) }
    q.maybeSingle = () => { single = true; return rec('maybeSingle', []) }
    q.then = (resolve: (v: PageResult<Row> | { data: Row | null; error: null }) => unknown, reject: (e: unknown) => unknown) => {
      if (opts.error) return Promise.resolve({ data: null, error: opts.error, count: null }).then(resolve as never, reject)
      const hit = rows.filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => { for (const c of orders) { const d = cmp(a[c], b[c]); if (d) return d } return 0 })
      if (single) return Promise.resolve({ data: hit[0] ? { ...hit[0] } : null, error: null }).then(resolve as never, reject)
      const data = hit.slice(0, Math.min(limit, opts.maxRows ?? 1000)).map((r) => ({ ...r }))
      const res = { data, error: null, count: hit.length }
      const next = opts.afterResponse?.(log.length, rows.map((r) => ({ ...r })))
      if (next) rows = next
      return Promise.resolve(res).then(resolve as never, reject)
    }
    return q
  }
  return { make, log }
}
