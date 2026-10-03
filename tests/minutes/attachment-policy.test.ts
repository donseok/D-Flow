import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MINUTES_ATTACHMENT_MAX_BYTES, MINUTES_ATTACHMENTS_MAX_COUNT } from '@/lib/domain/minutes'
import { attachmentPreviewKind, attachmentRejection, DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy } from '@/lib/minutes/attachmentPolicy'

const small = { ...DEFAULT_ATTACHMENT_POLICY, maxFileBytes: 100, maxCount: 2, maxTotalBytes: 150 }
describe('첨부 정책의 엄격한 저장 계약', () => {
  it('현행 20MiB/10개가 기본값이며 운영 버킷 상한과 일치한다', () => {
    expect(MINUTES_ATTACHMENT_MAX_BYTES).toBe(20_971_520)
    expect(MINUTES_ATTACHMENTS_MAX_COUNT).toBe(10)
    expect(parseAttachmentPolicy(DEFAULT_ATTACHMENT_POLICY)).toEqual({ ok: true, value: DEFAULT_ATTACHMENT_POLICY })
    expect(readFileSync('supabase/migrations/0001_storage_realtime.sql', 'utf8')).toContain('20971520')
  })
  it.each([null, [], 1, 'policy', {}, { ...small, extra: 1 }, { ...small, previewEnabled: undefined }])('잘못된 구조 %j를 기본값으로 풀지 않는다', raw => {
    expect(parseAttachmentPolicy(raw).ok).toBe(false)
  })
  it.each([0, -1, 20_971_521, 1.5, NaN, Infinity, '100'])('개당 용량 %j 거부', maxFileBytes => {
    expect(parseAttachmentPolicy({ ...small, maxFileBytes }).ok).toBe(false)
  })
  it.each([0, 11, 1.5, NaN, '2'])('개수 %j 거부', maxCount => {
    expect(parseAttachmentPolicy({ ...small, maxCount }).ok).toBe(false)
  })
  it.each([99, 201, 150.5, NaN, '150'])('총 용량 %j 거부', maxTotalBytes => {
    expect(parseAttachmentPolicy({ ...small, maxTotalBytes }).ok).toBe(false)
  })
  it.each([['PDF'], ['.pdf'], ['p-df'], ['a'.repeat(11)], ['pdf', 'pdf'], [1], Array.from({ length: 31 }, (_, i) => `x${i}`)].map(extensions => [extensions] as [unknown]))('확장자 %j 거부', allowedExtensions => {
    expect(parseAttachmentPolicy({ ...small, allowedExtensions }).ok).toBe(false)
  })
  it('null과 빈 목록을 구별하며 입력 목록과 별개인 값으로 반환한다', () => {
    const extensions = ['pdf', 'docx']
    const parsed = parseAttachmentPolicy({ ...small, allowedExtensions: extensions })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error(parsed.error)
    extensions.push('exe')
    expect(parsed.value.allowedExtensions).toEqual(['pdf', 'docx'])
    expect(parseAttachmentPolicy({ ...small, allowedExtensions: [] }).ok).toBe(true)
    expect(attachmentRejection({ ...small, allowedExtensions: [] }, { fileName: 'x.pdf', size: 1 }, { count: 0, bytes: 0 })).toBe('EXTENSION')
  })
})
describe('사전 제한과 안전한 미리보기', () => {
  it('운영 기본값이 좁은 정책을 덮지 않고 파일/개수/총량을 각각 거부한다', () => {
    const file = { fileName: 'file.PDF', size: 50 }, active = { count: 1, bytes: 100 }
    expect(attachmentRejection(small, file, active)).toBeNull()
    expect(attachmentRejection({ ...small, enabled: false }, file, active)).toBe('DISABLED')
    expect(attachmentRejection(small, file, { ...active, count: 2 })).toBe('LIMIT')
    expect(attachmentRejection(small, { ...file, size: 101 }, active)).toBe('TOO_LARGE')
    expect(attachmentRejection(small, { ...file, size: 51 }, active)).toBe('TOTAL_EXCEEDED')
    expect(attachmentRejection({ ...small, allowedExtensions: ['png'] }, file, active)).toBe('EXTENSION')
    expect(attachmentRejection(small, { ...file, size: NaN }, active)).toBe('INVALID')
  })
  it.each([['x.png','image/png','image'],['x.JPG','image/jpeg','image'],['x.gif','image/gif','image'],['x.webp','image/webp','image'],['x.pdf','application/pdf','pdf']])('확장자와 객체 MIME이 맞는 %s만 미리본다', (name, mime, kind) => {
    expect(attachmentPreviewKind(small, name, mime)).toBe(kind)
    expect(attachmentPreviewKind({ previewEnabled: false }, name, mime)).toBeNull()
  })
  it.each([['x.svg','image/svg+xml'],['x.html','text/html'],['x.png.svg','image/png'],['x.pdf','text/html'],['x.png','image/jpeg'],['x','image/png'],['x.png',null]])('위험 형식·위조 %s는 미리보기 서명이 없다', (name, mime) => {
    expect(attachmentPreviewKind(small, name, mime)).toBeNull()
  })
})
