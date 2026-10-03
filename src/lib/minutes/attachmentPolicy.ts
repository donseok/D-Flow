/** SP5 B3: 정책/미리보기의 순수 계약. 클라이언트는 설정 정의 런타임을 가져오지 않는다. */
import type { Parsed } from '@/lib/settings/def'
import { MINUTES_ATTACHMENT_MAX_BYTES, MINUTES_ATTACHMENTS_MAX_COUNT } from '@/lib/domain/minutes'

export interface AttachmentPolicy {
  enabled: boolean
  maxFileBytes: number
  maxCount: number
  maxTotalBytes: number
  allowedExtensions: string[] | null
  previewEnabled: boolean
}

/** 운영 상한은 제품 기본값의 원천이다. 저장 정책을 읽은 뒤 이 값으로 덮지 않는다. */
export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = {
  enabled: true,
  maxFileBytes: MINUTES_ATTACHMENT_MAX_BYTES,
  maxCount: MINUTES_ATTACHMENTS_MAX_COUNT,
  maxTotalBytes: MINUTES_ATTACHMENT_MAX_BYTES * MINUTES_ATTACHMENTS_MAX_COUNT,
  allowedExtensions: null,
  previewEnabled: true,
}

const FIELDS = Object.keys(DEFAULT_ATTACHMENT_POLICY).sort().join(',')
const fail = (error: string): Parsed<AttachmentPolicy> => ({ ok: false, error })

export function parseAttachmentPolicy(raw: unknown): Parsed<AttachmentPolicy> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('첨부 정책은 객체여야 합니다.')
  if (Object.keys(raw).sort().join(',') !== FIELDS) return fail('첨부 정책의 필드가 빠졌거나 모르는 필드가 있습니다.')
  const x = raw as Record<string, unknown>
  if (typeof x.enabled !== 'boolean' || typeof x.previewEnabled !== 'boolean') return fail('첨부·미리보기 사용 여부는 참·거짓이어야 합니다.')
  if (!Number.isSafeInteger(x.maxFileBytes) || (x.maxFileBytes as number) < 1 || (x.maxFileBytes as number) > MINUTES_ATTACHMENT_MAX_BYTES) {
    return fail(`개당 용량은 1~${MINUTES_ATTACHMENT_MAX_BYTES}바이트여야 합니다.`)
  }
  if (!Number.isSafeInteger(x.maxCount) || (x.maxCount as number) < 1 || (x.maxCount as number) > MINUTES_ATTACHMENTS_MAX_COUNT) {
    return fail(`첨부 개수는 1~${MINUTES_ATTACHMENTS_MAX_COUNT}개여야 합니다.`)
  }
  const maxFileBytes = x.maxFileBytes as number
  const maxCount = x.maxCount as number
  if (!Number.isSafeInteger(x.maxTotalBytes) || (x.maxTotalBytes as number) < maxFileBytes || (x.maxTotalBytes as number) > maxFileBytes * maxCount) {
    return fail('총 용량은 개당 용량 이상, 개당 용량 × 첨부 개수 이하여야 합니다.')
  }
  let allowedExtensions: string[] | null = null
  if (x.allowedExtensions !== null) {
    if (!Array.isArray(x.allowedExtensions) || x.allowedExtensions.length > 30
      || x.allowedExtensions.some(e => typeof e !== 'string' || !/^[a-z0-9]{1,10}$/.test(e))
      || new Set(x.allowedExtensions).size !== x.allowedExtensions.length) {
      return fail('확장자는 소문자 영숫자 1~10자의 중복 없는 목록(최대 30개)이어야 합니다.')
    }
    // 호출자의 배열을 보관하지 않는다. []는 모든 확장자 거부, null은 제한 없음이다.
    allowedExtensions = [...x.allowedExtensions] as string[]
  }
  return { ok: true, value: {
    enabled: x.enabled, previewEnabled: x.previewEnabled, maxFileBytes, maxCount,
    maxTotalBytes: x.maxTotalBytes as number, allowedExtensions,
  } }
}

export function attachmentExtension(fileName: string): string {
  return /\.([a-z0-9]+)$/i.exec(fileName)?.[1].toLowerCase() ?? ''
}

export type AttachmentRejection = 'INVALID' | 'DISABLED' | 'LIMIT' | 'TOO_LARGE' | 'TOTAL_EXCEEDED' | 'EXTENSION'
/** 사전 안내용. 확정의 최종 권한·객체 메타·동시 개수 판정은 DB 가드가 한다. */
export function attachmentRejection(
  policy: AttachmentPolicy,
  file: { fileName: string; size: number },
  active: { count: number; bytes: number },
): AttachmentRejection | null {
  if (!policy.enabled) return 'DISABLED'
  if (!Number.isSafeInteger(file.size) || file.size < 1
    || !Number.isSafeInteger(active.count) || active.count < 0
    || !Number.isSafeInteger(active.bytes) || active.bytes < 0) return 'INVALID'
  if (active.count >= policy.maxCount) return 'LIMIT'
  if (file.size > policy.maxFileBytes) return 'TOO_LARGE'
  if (active.bytes + file.size > policy.maxTotalBytes) return 'TOTAL_EXCEEDED'
  if (policy.allowedExtensions !== null && !policy.allowedExtensions.includes(attachmentExtension(file.fileName))) return 'EXTENSION'
  return null
}

const PREVIEW_MIME: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
}
export type AttachmentPreviewKind = 'image' | 'pdf'
/** MIME은 Storage 객체 메타를 전달한다. 행/브라우저가 선언한 mime만으로 서명하지 않는다. */
export function attachmentPreviewKind(
  policy: Pick<AttachmentPolicy, 'previewEnabled'>,
  fileName: string,
  objectMime: string | null,
): AttachmentPreviewKind | null {
  if (!policy.previewEnabled || objectMime === null) return null
  const ext = attachmentExtension(fileName)
  const expected = PREVIEW_MIME[ext]
  if (!expected || objectMime.trim().toLowerCase() !== expected) return null
  return ext === 'pdf' ? 'pdf' : 'image'
}
