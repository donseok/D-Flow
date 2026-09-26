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
  if (out.length !== total) throw new Error(`${label} 가 잘려 왔습니다(${out.length}/${total})`)
  return out
}
