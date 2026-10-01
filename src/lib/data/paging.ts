// PostgREST 전량 읽기 — 서버는 한 응답을 max_rows(로컬 supabase/config.toml·호스팅 기본 1000)에서 조용히 자른다.
// 한 번에 읽으면 잘린 목록이 완전한 목록처럼 보이고, 빠진 행은 '존재하지 않음'으로 읽힌다(에러 3원칙 ① 위반).
// 호출부가 유일 키로 끝나는 정렬(마지막이 id 등)과 count: 'exact' 를 건 쿼리를 범위마다 만들어 넘긴다.

/** 한 페이지 크기 — max_rows(1000) 이하. 서버 상한이 더 낮아도 받은 행 수만큼 전진하고 총합을 count 로 대조하므로 빠지지 않는다. */
export const PAGE_SIZE = 1000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
  count?: number | null
}

/**
 * 끝까지 읽은 행 전체. page(from, to) 는 그 범위(양끝 포함)의 쿼리다 — `.order(…).order('id').range(from, to)` 와
 * `select(…, { count: 'exact' })`. 첫 페이지의 count 가 총합이다.
 * throw: 조회 오류, count 없음(잘림을 확인할 수 없다), 다 읽은 행 수 ≠ count(잘림·페이지 사이 변경). 오류 문구의 머리는 label 이다.
 */
export async function fetchAllPages<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  let total: number | null = null
  for (let from = 0; ;) {
    const res = await page(from, from + pageSize - 1)
    if (res.error) throw new Error(`${label} 조회 실패: ${res.error.message}`)
    if (total === null) {
      if (typeof res.count !== 'number') throw new Error(`${label} 행 수(count)를 받지 못해 잘림을 확인할 수 없습니다`)
      total = res.count
    }
    const rows = res.data ?? []
    out.push(...rows)
    if (rows.length === 0 || out.length >= total) break
    from += rows.length   // 서버 상한이 pageSize 보다 작아도 받은 만큼 전진한다
  }
  if (out.length !== total) throw new Error(`${label} 목록을 끝까지 읽지 못했습니다(${out.length}/${total}건) — 읽는 중에 행이 바뀌었거나 응답이 잘렸습니다. 잠시 후 다시 시도하세요.`)
  return out
}

/**
 * 키셋 쪽 나눔 — 바뀌지 않는 유일 키(id·PK) 오름차순으로, 앞 쪽 마지막 행 다음부터 읽는다(SP4 A1-1 K1·K2).
 * offset 쪽 나눔(fetchAllPages)은 쪽 사이의 정렬 이동·삽입+삭제에서 한 행이 두 번, 다른 한 행이 0번 읽히고 행 수가 같아 count 대조를
 * 통과한다. 키셋은 이미 있던 행이 밀리지 않으므로 그 꼴이 원리적으로 없다. 손실 경로(replace 백업·getComputedWbs)가 쓴다.
 * page(after, limit) 는 `after` 가 null 이면 첫 쪽, 아니면 그 행의 키보다 큰 행만 — 키 오름차순 정렬 + `.limit(limit)` +
 * `select(…, { count: 'exact' })` 쿼리다. 첫 쪽의 count 가 총합이다.
 * 끝: 첫 쪽이 count 만큼 다 담았으면(같은 문장의 스냅숏) 거기서, 아니면 빈 쪽이 올 때까지(서버 상한이 limit 보다 작을 수 있어
 * 짧은 쪽을 끝으로 믿지 않는다).
 * throw: 조회 오류, count 없음, 같은 키 두 번(키셋 조건이 빠진 쿼리 — 방어), 다 읽은 행 수 ≠ count(읽는 중 순변화). 문구 머리는 label.
 */
export async function fetchAllByKeyset<T>(
  label: string,
  keyOf: (row: T) => string,
  page: (after: T | null, limit: number) => PromiseLike<PageResult<T>>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = []
  const seen = new Set<string>()
  let total: number | null = null
  let after: T | null = null
  for (;;) {
    const res = await page(after, pageSize)
    if (res.error) throw new Error(`${label} 조회 실패: ${res.error.message}`)
    if (total === null) {
      if (typeof res.count !== 'number') throw new Error(`${label} 행 수(count)를 받지 못해 잘림을 확인할 수 없습니다`)
      total = res.count
    }
    const rows = res.data ?? []
    for (const row of rows) {
      const key = keyOf(row)
      if (seen.has(key)) throw new Error(`${label} 같은 행을 두 번 읽었습니다 — 쪽 나눔 키가 어긋났습니다. 잠시 후 다시 시도하세요.`)
      seen.add(key)
      out.push(row)
    }
    if (rows.length === 0) break
    if (after === null && out.length === total) break
    after = rows[rows.length - 1]
  }
  if (out.length !== total) throw new Error(`${label} 목록을 끝까지 읽지 못했습니다(${out.length}/${total}건) — 읽는 중에 행이 바뀌었거나 응답이 잘렸습니다. 잠시 후 다시 시도하세요.`)
  return out
}
