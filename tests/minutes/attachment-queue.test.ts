import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTACHMENT_POLICY, type AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import {
  drop, enqueue, formatBytes, mayPreview, nextPending, reservedUsage, retry, setStatus, type QueueItem,
} from '@/lib/minutes/attachmentQueue'

// SP5 B3 과제 8 — 첨부 패널의 대기열 전이. 화면 사전 확인은 안내용이고 최종 판정은 DB 가드(0021)다.
const policy = (over: Partial<AttachmentPolicy> = {}): AttachmentPolicy =>
  ({ ...DEFAULT_ATTACHMENT_POLICY, maxFileBytes: 100, maxCount: 3, maxTotalBytes: 250, ...over })
const f = (key: string, size = 10, name = `${key}.pdf`) => ({ key, name, size })

describe('enqueue — 확정 첨부 + 진행 중 대기열이 한도 몫이다', () => {
  it('통과분은 대기로, 한도를 넘는 파일은 재시도 없는 실패로 넣는다', () => {
    const q = enqueue(policy(), [{ size: 10 }], [], [f('a'), f('b'), f('c')])
    expect(q.map(x => [x.key, x.status, x.rejection ?? null, x.retryable ?? null])).toEqual([
      ['a', 'pending', null, null], ['b', 'pending', null, null], ['c', 'failed', 'LIMIT', false],
    ])
  })
  it('개당·총용량·확장자·꺼짐을 순서대로 거른다', () => {
    expect(enqueue(policy(), [], [], [f('big', 101)])[0].rejection).toBe('TOO_LARGE')
    expect(enqueue(policy(), [{ size: 100 }, { size: 100 }], [], [f('t', 60)])[0].rejection).toBe('TOTAL_EXCEEDED')
    expect(enqueue(policy({ allowedExtensions: ['png'] }), [], [], [f('x', 1, 'x.pdf')])[0].rejection).toBe('EXTENSION')
    expect(enqueue(policy({ allowedExtensions: [] }), [], [], [f('x', 1, 'x.png')])[0].rejection).toBe('EXTENSION')
    expect(enqueue(policy({ enabled: false }), [], [], [f('x')])[0].rejection).toBe('DISABLED')
  })
  it('실패 항목은 예약 몫에서 빠진다', () => {
    const q: QueueItem[] = [{ key: 'z', fileName: 'z.pdf', size: 90, status: 'failed', error: 'x', retryable: true }]
    expect(reservedUsage([{ size: 10 }, { size: null }], q)).toEqual({ count: 2, bytes: 10 })
  })
})

describe('전이 — 한 번에 하나, 실패만 재시도, 진행 중은 빼지 않는다', () => {
  const base = enqueue(policy(), [], [], [f('a'), f('b')])
  it('nextPending 은 진행 중이 있으면 null', () => {
    expect(nextPending(base)?.key).toBe('a')
    expect(nextPending(setStatus(base, 'a', 'uploading'))).toBeNull()
    expect(nextPending(setStatus(base, 'a', 'recording'))).toBeNull()
    expect(nextPending(setStatus(base, 'a', 'failed', 'x'))?.key).toBe('b')
  })
  it('서버 실패는 재시도 가능, 재시도는 정책을 다시 보고 대기로', () => {
    const failed = setStatus(base, 'a', 'failed', '네트워크')
    expect(failed[0]).toMatchObject({ status: 'failed', error: '네트워크', retryable: true })
    expect(retry(policy(), [], failed, 'a')[0]).toEqual({ key: 'a', fileName: 'a.pdf', size: 10, status: 'pending' })
    // 그 사이 확정 첨부가 늘어 한도에 닿았으면 재시도 대신 정책 거부로 바뀐다
    expect(retry(policy(), [{ size: 1 }, { size: 1 }], failed, 'a')[0]).toMatchObject({ status: 'failed', rejection: 'LIMIT', retryable: false })
  })
  it('정책 거부는 재시도하지 않는다', () => {
    const q = enqueue(policy(), [], [], [f('big', 101)])
    expect(retry(policy(), [], q, 'big')).toEqual(q)
  })
  it('drop 은 전송·확정 중 항목을 지키고, force 로만 뺀다', () => {
    const up = setStatus(base, 'a', 'uploading')
    expect(drop(up, 'a').map(x => x.key)).toEqual(['a', 'b'])
    expect(drop(up, 'a', { force: true }).map(x => x.key)).toEqual(['b'])
    expect(drop(up, 'b').map(x => x.key)).toEqual(['a'])
  })
})

describe('표시 도우미', () => {
  it('formatBytes', () => {
    expect([0, 1023, 1024, 1536, 10 * 1024, 20_971_520, null, -1].map(formatBytes))
      .toEqual(['0 B', '1023 B', '1 KB', '1.5 KB', '10 KB', '20 MB', '—', '—'])
  })
  it('mayPreview 는 안전 확장자 + previewEnabled 일 때만(서버가 객체 MIME 으로 다시 판정)', () => {
    expect(mayPreview({ previewEnabled: true }, 'a.PNG')).toBe(true)
    expect(mayPreview({ previewEnabled: true }, 'a.pdf')).toBe(true)
    expect(mayPreview({ previewEnabled: true }, 'a.svg')).toBe(false)
    expect(mayPreview({ previewEnabled: true }, 'a.pdf.html')).toBe(false)
    expect(mayPreview({ previewEnabled: false }, 'a.png')).toBe(false)
    expect(mayPreview(null, 'a.png')).toBe(false)
  })
})
