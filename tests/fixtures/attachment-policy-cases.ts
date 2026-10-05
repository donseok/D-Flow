import { DEFAULT_ATTACHMENT_POLICY } from '@/lib/minutes/attachmentPolicy'
const d = DEFAULT_ATTACHMENT_POLICY
export const ATTACHMENT_POLICY_CASES: { name: string; raw: unknown; ok: boolean }[] = [
  { name: '제품 기본값', raw: d, ok: true },
  { name: '최소 경계', raw: { ...d, maxFileBytes: 1, maxCount: 1, maxTotalBytes: 1 }, ok: true },
  { name: '꺼짐·확장자 빈 목록', raw: { ...d, enabled: false, allowedExtensions: [] }, ok: true },
  { name: '확장자 목록', raw: { ...d, allowedExtensions: ['pdf', 'png'] }, ok: true },
  { name: 'null', raw: null, ok: false }, { name: '배열', raw: [], ok: false },
  { name: '누락', raw: {}, ok: false }, { name: '모르는 필드', raw: { ...d, mimeTypes: [] }, ok: false },
  { name: '문자열 boolean', raw: { ...d, enabled: 'true' }, ok: false },
  { name: '미리보기 null', raw: { ...d, previewEnabled: null }, ok: false },
  ...[0, -1, 20_971_521, 1.5, '20'].map(maxFileBytes => ({ name: `용량 ${maxFileBytes}`, raw: { ...d, maxFileBytes }, ok: false })),
  ...[0, 11, 1.5, '2'].map(maxCount => ({ name: `개수 ${maxCount}`, raw: { ...d, maxCount }, ok: false })),
  ...[1, 209_715_201, 20_971_520.5, '100'].map(maxTotalBytes => ({ name: `총량 ${maxTotalBytes}`, raw: { ...d, maxTotalBytes }, ok: false })),
  ...[['PDF'], ['.pdf'], ['pdf', 'pdf'], ['a'.repeat(11)], [1], Array.from({ length: 31 }, (_, i) => `x${i}`)]
    .map((allowedExtensions, i) => ({ name: `잘못된 확장자 ${i}`, raw: { ...d, allowedExtensions }, ok: false })),
]
