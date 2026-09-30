import { describe, expect, it } from 'vitest'
import { resolveBrandMark } from '@/lib/settings/brandMark'

describe('resolveBrandMark', () => {
  it('업로드한 마크가 제품명 기본 글리프보다 우선한다', () => {
    expect(resolveBrandMark('D-Flow', '/api/brand/ws/mark')).toEqual({ kind: 'image', src: '/api/brand/ws/mark' })
  })
  it('마크가 없을 때 D-Flow 는 흐름 아이콘을 쓴다', () => {
    expect(resolveBrandMark('D-Flow', null)).toEqual({ kind: 'flow' })
  })
  it('다른 제품명은 첫 글자 모노그램을 쓴다', () => {
    expect(resolveBrandMark('아크메 PM', null)).toEqual({ kind: 'monogram', letter: '아' })
  })
})
