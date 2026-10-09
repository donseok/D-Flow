// 청소 잡의 실행부(SP5 B3 과제10). 클라이언트를 받아 읽기 → 판정 → (apply 면) 삭제한다.
// 호출자는 둘이다 — 수동 스크립트(scripts/minutes/sweep-attachments.mjs — 대상 가드·env 는 그쪽 몫, 기본 dry-run)와
// 스케줄 잡(src/app/api/cron/minutes-attachments-gc/route.ts — 인증은 authorizeJob, 항상 apply). 가짜 클라이언트로 시험한다(tests/scripts/attachment-sweep-run.test.ts).
import { GRACE_MS, planSweep, safePathLabel, stillOrphan } from './attachmentSweep.mjs'

const BUCKET = 'minutes'
export const PAGE = 1000

/** 한 접두의 목록 전 페이지. 실패는 throw — 일부만 읽고 고아를 판정하지 않는다. */
export async function listAll(admin, prefix) {
  const out = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`버킷 목록 실패(${safePathLabel(prefix)}): ${error.message}`)
    out.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return out
  }
}

/** ws/<wid>/p/<pid>/minute-files/<minute>/<파일> 만 내려간다 — 본문 minutes 세그먼트는 읽지도 않는다. */
export async function listMinuteFileObjects(admin) {
  const folders = entries => entries.filter(e => e.id === null).map(e => e.name)
  const objects = []
  for (const w of folders(await listAll(admin, 'ws'))) {
    if (!folders(await listAll(admin, `ws/${w}`)).includes('p')) continue
    for (const p of folders(await listAll(admin, `ws/${w}/p`))) {
      if (!folders(await listAll(admin, `ws/${w}/p/${p}`)).includes('minute-files')) continue
      for (const m of folders(await listAll(admin, `ws/${w}/p/${p}/minute-files`))) {
        for (const f of await listAll(admin, `ws/${w}/p/${p}/minute-files/${m}`)) {
          if (f.id === null) continue
          objects.push({ name: `ws/${w}/p/${p}/minute-files/${m}/${f.name}`, createdAt: f.created_at ?? null })
        }
      }
    }
  }
  return objects
}

async function selectAll(admin, table, columns, filter = q => q) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await filter(admin.from(table).select(columns)).order('id').range(from, from + PAGE - 1)
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE) return rows
  }
}

async function refCount(admin, table, path) {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq('file_path', path)
  if (error) throw new Error(`${table} 재검증 실패: ${error.message}`)
  return count ?? 0
}

/**
 * @param {*} admin service_role 클라이언트
 * @param {{ apply: boolean, now?: number, log?: (s: string) => void, warn?: (s: string) => void }} opts
 * @returns {Promise<{ ok: false, stage: 'read', error: string } | { ok: true, summary: Record<string, number>, failures: number }>}
 */
export async function runSweep(admin, { apply, now = Date.now(), log = console.log, warn = console.error }) {
  let objects, files, versions
  try {
    objects = await listMinuteFileObjects(admin)
    files = await selectAll(admin, 'minute_files', 'id, file_path, role, deleted_at, purged_at')
    versions = await selectAll(admin, 'minute_versions', 'id, file_path', q => q.not('file_path', 'is', null))
  } catch (e) {
    return { ok: false, stage: 'read', error: e instanceof Error ? e.message : String(e) }
  }
  const plan = planSweep({
    now, graceMs: GRACE_MS, objects,
    files: files.map(f => ({ id: f.id, filePath: f.file_path, role: f.role, deletedAt: f.deleted_at, purgedAt: f.purged_at })),
    versionPaths: versions.map(v => v.file_path),
  })
  const summary = {
    scannedObjects: objects.length, minuteFiles: files.length, versions: versions.length,
    orphans: plan.orphans.length, tombstoneObjects: plan.purgeObjects.length, tombstoneMarkOnly: plan.markPurged.length,
    skippedYoung: plan.skippedYoung, skippedNoTime: plan.skippedNoTime,
  }
  for (const p of plan.orphans.slice(0, 50)) log(`  고아 ${safePathLabel(p)}`)
  for (const t of plan.purgeObjects.slice(0, 50)) log(`  톰스톤 객체 minute_file=${t.id}`)
  for (const t of plan.markPurged.slice(0, 50)) log(`  톰스톤 정리 기록만 minute_file=${t.id}`)
  if (!apply) return { ok: true, summary, failures: 0 }

  let failures = 0
  const markPurged = async id => {
    const { error } = await admin.from('minute_files').update({ purged_at: new Date(now).toISOString() })
      .eq('id', id).not('deleted_at', 'is', null).is('purged_at', null)
    if (error) { failures++; warn(`  ✗ purged_at 기록 실패 minute_file=${id}: ${error.message}`) }
  }
  for (const path of plan.orphans) {
    try {
      // 판정과 삭제 사이에 확정·버전 참조가 생겼을 수 있다 — 지우기 직전에 다시 본다.
      const ok = stillOrphan(path, { fileRefs: await refCount(admin, 'minute_files', path), versionRefs: await refCount(admin, 'minute_versions', path) })
      if (!ok) { log(`  건너뜀(그 사이 참조됨) ${safePathLabel(path)}`); continue }
      const { data, error } = await admin.storage.from(BUCKET).remove([path])
      if (error || (data ?? []).length !== 1) throw new Error(error?.message ?? `삭제 ${(data ?? []).length}건`)
    } catch (e) {
      failures++
      warn(`  ✗ 고아 삭제 실패 ${safePathLabel(path)}: ${e instanceof Error ? e.message : e}`)
    }
  }
  for (const t of plan.purgeObjects) {
    const { error } = await admin.storage.from(BUCKET).remove([t.path])
    if (error) { failures++; warn(`  ✗ 톰스톤 객체 삭제 실패 minute_file=${t.id}: ${error.message}`); continue }
    await markPurged(t.id)
  }
  for (const t of plan.markPurged) await markPurged(t.id)
  return { ok: true, summary, failures }
}
