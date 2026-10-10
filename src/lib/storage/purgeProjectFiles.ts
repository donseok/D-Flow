// 지운 프로젝트의 저장소 파일 정리 — DB 삭제(delete_project)는 파일을 지우지 않는다.
// 접두(ws/<wid>/p/<pid>/) 아래를 폴더마다 끝 페이지까지 나열해 모은 뒤 묶음으로 지운다. 프로젝트는 이미 지워졌으므로 실패해도 되돌릴 것이 없다 —
// 실패를 숨기지 않고 남은 파일 수(orphaned)와 나열하지 못한 버킷(unlisted)으로 돌려준다(호출부가 사용자에게 알리고 로그를 남긴다).
// 나열이 도중에 실패한 버킷은 지우지 않는다 — 일부만 지우면 남은 수를 셀 수 없다.

const PAGE = 1000
const REMOVE_BATCH = 100
/** 경로 깊이의 상한 — 규약(ws/<wid>/p/<pid>/<entity>/<id>/<파일>)보다 넉넉히. 넘으면 그 버킷은 나열 실패로 본다 */
const MAX_DEPTH = 6

type StorageEntry = { name: string; id: string | null }
type StorageError = { message: string } | null
/** service_role 클라이언트에서 이 정리가 쓰는 부분만 */
export interface ProjectFilesClient {
  storage: {
    from(bucket: string): {
      list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }):
        PromiseLike<{ data: StorageEntry[] | null; error: StorageError }>
      remove(paths: string[]): PromiseLike<{ data: unknown[] | null; error: StorageError }>
    }
  }
}

export interface ProjectFilesPurgeResult {
  /** 지운 파일 수 */
  removed: number
  /** 찾았지만 지우지 못한 파일 수 */
  orphaned: number
  /** 나열하지 못해 손대지 않은 버킷 — 남은 파일 수를 모른다 */
  unlisted: string[]
}

/** 한 폴더의 전 페이지. 실패는 throw */
async function listAll(client: ProjectFilesClient, bucket: string, dir: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage.from(bucket).list(dir, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return out
  }
}

/** dir 아래의 모든 파일 경로(폴더는 id 가 null 이다 — 내려간다) */
async function collect(client: ProjectFilesClient, bucket: string, dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH) throw new Error(`경로가 너무 깊다: ${dir}`)
  for (const entry of await listAll(client, bucket, dir)) {
    const path = `${dir}/${entry.name}`
    if (entry.id === null) await collect(client, bucket, path, depth + 1, out)
    else out.push(path)
  }
}

/**
 * buckets 의 prefix 아래 파일을 전부 지운다. prefix 는 delete_project 가 돌려준 접두(끝의 '/' 는 떼고 쓴다).
 * 형식이 ws/<id>/p/<id> 가 아니면 아무것도 하지 않고 전 버킷을 unlisted 로 돌려준다(엉뚱한 범위를 지우지 않는다).
 */
export async function purgeProjectFiles(client: ProjectFilesClient, prefix: string, buckets: readonly string[]): Promise<ProjectFilesPurgeResult> {
  const result: ProjectFilesPurgeResult = { removed: 0, orphaned: 0, unlisted: [] }
  const dir = prefix.replace(/\/+$/, '')
  if (!/^ws\/[0-9a-f-]{36}\/p\/[0-9a-f-]{36}$/i.test(dir)) {
    console.error('[purgeProjectFiles] 접두 형식이 어긋났다 — 아무것도 지우지 않는다')
    return { ...result, unlisted: [...buckets] }
  }
  for (const bucket of buckets) {
    const paths: string[] = []
    try {
      await collect(client, bucket, dir, 0, paths)
    } catch (e) {
      console.error('[purgeProjectFiles] 나열 실패 — 이 버킷은 지우지 않는다', { bucket, cause: e instanceof Error ? e.message : String(e) })
      result.unlisted.push(bucket)
      continue
    }
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH)
      let done = 0
      try {
        const { data, error } = await client.storage.from(bucket).remove(batch)
        if (error) console.error('[purgeProjectFiles] 삭제 실패', { bucket, count: batch.length, cause: error.message })
        // 응답이 지운 객체 목록이다 — 목록에 없는 것은 남았다고 센다
        else done = Array.isArray(data) ? Math.min(data.length, batch.length) : 0
      } catch (e) {
        console.error('[purgeProjectFiles] 삭제 요청 실패', { bucket, count: batch.length, cause: e instanceof Error ? e.message : String(e) })
      }
      result.removed += done
      result.orphaned += batch.length - done
    }
  }
  return result
}
