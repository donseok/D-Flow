// Storage 객체 키 규약(SP2 §3.1) — ws/<wid>/p/<pid 또는 _>/<entity>/<id>/<파일>. 스토리지 RLS(0007)의 storage_ws·storage_project·
// storage_entity_id 가 같은 세그먼트(2·4·6번째)를 읽는다. 파서는 형식이 틀리면 null — 호출부가 거부 사유로 쓴다(throw 금지).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTITIES = ['minutes', 'minute-files', 'deliverables', 'issue-attachments'] as const
export type StorageEntity = (typeof ENTITIES)[number]
export interface StoragePathParts { workspaceId: string; projectId: string | null; entity: StorageEntity; entityId: string; fileName: string }

function fileNameOk(f: string): boolean {
  return f.length > 0 && f.length <= 200 && !f.includes('/') && f !== '.' && f !== '..' && !/[\s\p{Cc}]/u.test(f.replace(/ /g, ''))
}

export function makeStoragePath(p: StoragePathParts): string {
  if (!UUID.test(p.workspaceId) || (p.projectId !== null && !UUID.test(p.projectId)) || !UUID.test(p.entityId)
    || !(ENTITIES as readonly string[]).includes(p.entity) || !fileNameOk(p.fileName)) {
    throw new Error('저장 경로 입력이 올바르지 않습니다.')
  }
  return `ws/${p.workspaceId}/p/${p.projectId ?? '_'}/${p.entity}/${p.entityId}/${p.fileName}`
}

export function parseStoragePath(path: string): StoragePathParts | null {
  if (typeof path !== 'string') return null
  const s = path.split('/')
  if (s.length !== 7 || s[0] !== 'ws' || s[2] !== 'p') return null
  const [, ws, , pid, entity, id, file] = s
  if (!UUID.test(ws) || !(pid === '_' || UUID.test(pid)) || !UUID.test(id)) return null
  if (!(ENTITIES as readonly string[]).includes(entity) || !fileNameOk(file)) return null
  return { workspaceId: ws.toLowerCase(), projectId: pid === '_' ? null : pid.toLowerCase(), entity: entity as StorageEntity, entityId: id.toLowerCase(), fileName: file }
}

export function isStoragePathFor(path: string, e: Omit<StoragePathParts, 'fileName'>): boolean {
  const p = parseStoragePath(path)
  return !!p && p.workspaceId === e.workspaceId.toLowerCase() && p.projectId === (e.projectId?.toLowerCase() ?? null)
    && p.entity === e.entity && p.entityId === e.entityId.toLowerCase()
}
