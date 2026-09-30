import { createHash } from 'node:crypto'
import { BRANDING_MAX_BYTES, makeBrandingPath, type BrandingExt, type BrandingSlot } from './brandingPath'

export type LogoFileResult =
  | { ok: true; bytes: Buffer; path: string; contentType: 'image/png' | 'image/jpeg' | 'image/webp' }
  | { ok: false; error: string }

function format(bytes: Uint8Array): { ext: BrandingExt; contentType: 'image/png' | 'image/jpeg' | 'image/webp' } | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((x, i) => bytes[i] === x)) return { ext: 'png', contentType: 'image/png' }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { ext: 'jpg', contentType: 'image/jpeg' }
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' }
  }
  return null
}

/** MIME 이름은 신뢰하지 않는다. 파일 첫 바이트와 실제 길이로 검증하고 내용 주소를 만든다. */
export async function inspectBrandLogo(workspaceId: string, slot: BrandingSlot, file: File): Promise<LogoFileResult> {
  if (file.size === 0 || file.size > BRANDING_MAX_BYTES) return { ok: false, error: '로고는 1바이트 이상 256KB 이하여야 합니다.' }
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length !== file.size || bytes.length > BRANDING_MAX_BYTES) return { ok: false, error: '로고 크기를 확인할 수 없습니다.' }
  const kind = format(bytes)
  if (!kind) return { ok: false, error: 'PNG·JPEG·WebP 이미지만 올릴 수 있습니다.' }
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  return { ok: true, bytes, path: makeBrandingPath({ workspaceId, slot, hash, ext: kind.ext }), contentType: kind.contentType }
}
