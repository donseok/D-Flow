// 회의록 첨부 청소(SP5 B3 과제10)의 순수 판정. 부작용 없음 — vitest 로 검증한다.
// .mjs 인 까닭: 수동 스크립트(scripts/minutes/sweep-attachments.mjs)와 스케줄 잡(/api/cron/minutes-attachments-gc)이 같은 판정을 쓴다 —
// 스크립트는 src 의 TS 를 import 하지 못하므로 둘이 함께 읽을 수 있는 형식으로 둔다(판정을 두 벌로 적지 않는다).
//
// 대상은 minutes 버킷의 minute-files 세그먼트뿐이다(ws/<wid>/p/<pid|_>/minute-files/<minute>/<파일>). 본문(minutes 세그먼트)과
// 과거 버전 원본은 어떤 경우에도 후보가 아니다 — 버전 경로는 세그먼트와 무관하게 참조로 친다(WORM 근거).
//
// 두 일:
//  ① 고아 객체 — minute_files 어느 행(톰스톤 포함)에도, minute_versions 에도 없는 minute-files 객체. 업로드 직후 확정 전인 객체를
//     지우지 않도록 생성 뒤 유예(기본 24시간)가 지난 것만. 시각을 읽을 수 없는 객체는 지우지 않는다(fail-closed).
//  ② 미정리 톰스톤 — deleted_at 이 있고 purged_at 이 없는 첨부 행. 객체가 남아 있으면 지운 뒤, 없으면 바로 purged_at 을 채운다.

export const GRACE_MS = 24 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** minute-files 세그먼트의 규약 경로인가 — DB storage_ws 와 같은 모양(7칸, ws/·/p/, 워크스페이스·엔터티 uuid, 프로젝트 uuid|_). */
export function isMinuteFilesPath(name) {
  const s = String(name ?? '').split('/')
  return s.length === 7 && s[0] === 'ws' && UUID.test(s[1]) && s[2] === 'p'
    && (s[3] === '_' || UUID.test(s[3])) && s[4] === 'minute-files' && UUID.test(s[5]) && s[6].length > 0
}

/** 로그용 — 파일 이름(사용자가 올린 이름)을 싣지 않는다. 회의록 id 까지만. */
export function safePathLabel(name) {
  const s = String(name ?? '').split('/')
  return s.length === 7 ? `${s.slice(0, 6).join('/')}/…` : '(규약 밖 경로)'
}

/**
 * @param {{
 *   objects: { name: string, createdAt: string | null }[],
 *   files: { id: string, filePath: string, role: string, deletedAt: string | null, purgedAt: string | null }[],
 *   versionPaths: (string | null)[],
 *   now: number,
 *   graceMs?: number,
 * }} input
 * @returns {{ orphans: string[], purgeObjects: { id: string, path: string }[], markPurged: { id: string }[], skippedYoung: number, skippedNoTime: number }}
 */
export function planSweep({ objects, files, versionPaths, now, graceMs = GRACE_MS }) {
  if (!Number.isFinite(now)) throw new Error('기준 시각이 없다')
  if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('유예 시간이 올바르지 않다')
  const referenced = new Set()
  for (const f of files) referenced.add(f.filePath)
  for (const p of versionPaths) if (p) referenced.add(p)
  const present = new Set(objects.map(o => o.name))

  const orphans = []
  let skippedYoung = 0
  let skippedNoTime = 0
  const seen = new Set()
  for (const o of objects) {
    if (seen.has(o.name)) continue
    seen.add(o.name)
    if (!isMinuteFilesPath(o.name) || referenced.has(o.name)) continue
    const t = o.createdAt ? Date.parse(o.createdAt) : NaN
    if (!Number.isFinite(t)) { skippedNoTime++; continue }
    // 경계: 정확히 유예만큼 지난 객체는 대상이다(>=). 미래 시각(시계 차이)은 젊은 것으로 본다.
    if (now - t < graceMs) { skippedYoung++; continue }
    orphans.push(o.name)
  }

  const purgeObjects = []
  const markPurged = []
  for (const f of files) {
    if (f.role !== 'attachment' || !f.deletedAt || f.purgedAt) continue
    // 톰스톤 경로가 규약 밖이면(옛 형식) 객체를 지우지 않는다 — 버킷 정책·경로 판정이 어긋난 행은 사람이 본다.
    if (!isMinuteFilesPath(f.filePath)) continue
    if (present.has(f.filePath)) purgeObjects.push({ id: f.id, path: f.filePath })
    else markPurged.push({ id: f.id })
  }
  return { orphans, purgeObjects, markPurged, skippedYoung, skippedNoTime }
}

/** --apply 직전 재검증 — 그 사이 확정·버전 참조가 생긴 고아 후보는 빼야 한다. */
export function stillOrphan(path, { fileRefs, versionRefs }) {
  return isMinuteFilesPath(path) && fileRefs === 0 && versionRefs === 0
}
