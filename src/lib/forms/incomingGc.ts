// 양식 업로드의 고아 incoming 객체 정리(정본 §4.7.1) — 잡 `form-templates-gc` 의 본체.
// 브라우저가 form-templates 버킷의 ws/<wid>/p/<pid>/<form_kind>/incoming/<파일> 에 올리고 등록 액션을 부르지 않은 객체만 남는다
// (등록이 성공하면 move, 실패하면 remove 로 사라진다). created_at 이 24시간을 넘은 것만 지운다 — 그보다 젊은 객체는 등록을 기다리는 중일 수 있다.
// 목록을 한 곳이라도 읽지 못하면 아무것도 지우지 않고 실패를 돌려준다(조회 실패를 "지울 것 없음"으로 위장하지 않는다).
// 등록된 양식(v<n> 경로)은 읽지도 않는다 — incoming 폴더만 내려간다.

const BUCKET = 'form-templates'
export const INCOMING_GRACE_MS = 24 * 60 * 60 * 1000
const PAGE = 1000
const REMOVE_BATCH = 100

type StorageEntry = { name: string; id: string | null; created_at?: string | null }
type StorageError = { message: string } | null
/** service_role 클라이언트에서 이 잡이 쓰는 부분만 */
export interface IncomingGcClient {
  storage: {
    from(bucket: string): {
      list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: string } }):
        PromiseLike<{ data: StorageEntry[] | null; error: StorageError }>
      remove(paths: string[]): PromiseLike<{ data: unknown[] | null; error: StorageError }>
    }
  }
}

export type IncomingGcResult =
  | { ok: false; stage: 'list'; error: string }
  | { ok: true; scanned: number; deleted: number; failed: number; skippedYoung: number; skippedNoTime: number }

/** 한 접두의 목록 전 페이지. 실패는 throw — 일부만 읽고 지우지 않는다. */
async function listAll(client: IncomingGcClient, prefix: string): Promise<StorageEntry[]> {
  const out: StorageEntry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return out
  }
}

const folders = (entries: StorageEntry[]) => entries.filter((e) => e.id === null).map((e) => e.name)

async function listIncoming(client: IncomingGcClient): Promise<{ name: string; createdAt: string | null }[]> {
  const objects: { name: string; createdAt: string | null }[] = []
  for (const w of folders(await listAll(client, 'ws'))) {
    if (!folders(await listAll(client, `ws/${w}`)).includes('p')) continue
    for (const p of folders(await listAll(client, `ws/${w}/p`))) {
      for (const kind of folders(await listAll(client, `ws/${w}/p/${p}`))) {
        const dir = `ws/${w}/p/${p}/${kind}`
        if (!folders(await listAll(client, dir)).includes('incoming')) continue
        for (const f of await listAll(client, `${dir}/incoming`)) {
          if (f.id === null) continue
          objects.push({ name: `${dir}/incoming/${f.name}`, createdAt: f.created_at ?? null })
        }
      }
    }
  }
  return objects
}

export async function runFormTemplatesGc(client: IncomingGcClient, now: number = Date.now()): Promise<IncomingGcResult> {
  let objects: { name: string; createdAt: string | null }[]
  try {
    objects = await listIncoming(client)
  } catch (e) {
    return { ok: false, stage: 'list', error: e instanceof Error ? e.message : String(e) }
  }

  const expired: string[] = []
  let skippedYoung = 0
  let skippedNoTime = 0
  for (const o of objects) {
    const t = o.createdAt ? Date.parse(o.createdAt) : NaN
    // 시각을 읽을 수 없는 객체는 지우지 않는다(fail-closed). 미래 시각(시계 차이)은 젊은 것으로 본다.
    if (!Number.isFinite(t)) { skippedNoTime++; continue }
    if (now - t <= INCOMING_GRACE_MS) { skippedYoung++; continue }
    expired.push(o.name)
  }

  let deleted = 0
  let failed = 0
  for (let i = 0; i < expired.length; i += REMOVE_BATCH) {
    const batch = expired.slice(i, i + REMOVE_BATCH)
    const { data, error } = await client.storage.from(BUCKET).remove(batch)
    // remove 는 실제로 지운 객체를 돌려준다 — 그 수만 삭제로 센다. 남은 것은 다음 실행이 다시 시도한다.
    const removed = error ? 0 : Math.min((data ?? []).length, batch.length)
    deleted += removed
    failed += batch.length - removed
    if (error) console.error('[forms] incoming 정리 삭제 실패:', error.message)
  }
  return { ok: true, scanned: objects.length, deleted, failed, skippedYoung, skippedNoTime }
}
