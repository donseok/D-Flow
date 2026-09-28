// 로고 객체 경로(스펙 D19) — ws/<workspaceId>/branding/<slot>-<sha256 앞 16자>.<png|jpg|webp>. Storage 정책("branding read", 0012 ⑪)이
// 같은 모양을 SQL 로 판정한다 — tests/rls/storage-realtime.test.ts ⑯ 이 두 판정을 같은 표본으로 맞댄다. 순수 모듈.
export const BRANDING_BUCKET = 'branding'
export const BRANDING_MAX_BYTES = 262_144
export const BRANDING_SLOTS = ['full', 'full_dark', 'mark'] as const
export type BrandingSlot = (typeof BRANDING_SLOTS)[number]
export const BRANDING_EXTS = ['png', 'jpg', 'webp'] as const
export type BrandingExt = (typeof BRANDING_EXTS)[number]
export interface BrandingPath { workspaceId: string; slot: BrandingSlot; hash: string; ext: BrandingExt }

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FILE = /^(full|full_dark|mark)-([0-9a-f]{16})\.(png|jpg|webp)$/

export function parseBrandingPath(path: unknown): { ok: true; value: BrandingPath } | { ok: false; error: string } {
  if (typeof path !== 'string') return { ok: false, error: '경로가 문자열이 아닙니다.' }
  const parts = path.split('/')
  if (parts.length !== 4) return { ok: false, error: '경로 조각은 넷이어야 합니다.' }
  const [root, workspaceId, dir, file] = parts
  if (root !== 'ws' || dir !== 'branding') return { ok: false, error: '경로는 ws/<워크스페이스>/branding/ 아래여야 합니다.' }
  if (!UUID_LOWER.test(workspaceId)) return { ok: false, error: '워크스페이스 id 가 uuid 가 아닙니다.' }
  const m = FILE.exec(file)
  if (!m) return { ok: false, error: '파일 이름은 <full|full_dark|mark>-<16자 요약>.<png|jpg|webp> 여야 합니다.' }
  return { ok: true, value: { workspaceId, slot: m[1] as BrandingSlot, hash: m[2], ext: m[3] as BrandingExt } }
}

export function makeBrandingPath(p: BrandingPath): string {
  return `ws/${p.workspaceId}/branding/${p.slot}-${p.hash}.${p.ext}`
}
