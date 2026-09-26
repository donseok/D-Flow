import { describe, it, expect } from 'vitest'
import { makeStoragePath, parseStoragePath, isStoragePathFor } from '@/lib/domain/storagePath'

const W = '11111111-1111-4111-8111-111111111111'
const P = '22222222-2222-4222-8222-222222222222'
const E = '33333333-3333-4333-8333-333333333333'

describe('storagePath', () => {
  it('왕복: 프로젝트 있음·없음', () => {
    const a = makeStoragePath({ workspaceId: W, projectId: P, entity: 'issue-attachments', entityId: E, fileName: '1700-a.pdf' })
    expect(a).toBe(`ws/${W}/p/${P}/issue-attachments/${E}/1700-a.pdf`)
    expect(parseStoragePath(a)).toEqual({ workspaceId: W, projectId: P, entity: 'issue-attachments', entityId: E, fileName: '1700-a.pdf' })
    const b = makeStoragePath({ workspaceId: W, projectId: null, entity: 'minutes', entityId: E, fileName: 'm.md' })
    expect(b).toBe(`ws/${W}/p/_/minutes/${E}/m.md`)
    expect(parseStoragePath(b)?.projectId).toBeNull()
  })
  it.each([
    'garbage', `${E}/1700-a.pdf`, `ws/not-a-uuid/p/_/minutes/${E}/f`, `ws/${W}/p/xx/minutes/${E}/f`,
    `ws/${W}/p/_/unknown/${E}/f`, `ws/${W}/p/_/minutes/${E}/`, `ws/${W}/p/_/minutes/${E}/a/b`, `ws/${W}/p/_/minutes/${E}/..`,
    `ws/${W}/q/_/minutes/${E}/f`, ` ws/${W}/p/_/minutes/${E}/f`,
  ])('형식이 틀리면 null: %s', (s) => { expect(parseStoragePath(s)).toBeNull() })
  it('make 는 틀린 입력을 거부한다', () => {
    expect(() => makeStoragePath({ workspaceId: 'x', projectId: null, entity: 'minutes', entityId: E, fileName: 'f' })).toThrow()
    expect(() => makeStoragePath({ workspaceId: W, projectId: null, entity: 'minutes', entityId: E, fileName: 'a/b' })).toThrow()
  })
  it('isStoragePathFor 는 네 스코프가 모두 같아야 true', () => {
    const p = makeStoragePath({ workspaceId: W, projectId: P, entity: 'deliverables', entityId: E, fileName: 'f' })
    expect(isStoragePathFor(p, { workspaceId: W, projectId: P, entity: 'deliverables', entityId: E })).toBe(true)
    expect(isStoragePathFor(p, { workspaceId: W, projectId: null, entity: 'deliverables', entityId: E })).toBe(false)
    expect(isStoragePathFor(p, { workspaceId: W, projectId: P, entity: 'minutes', entityId: E })).toBe(false)
  })
})
