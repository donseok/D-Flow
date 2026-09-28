// 테스트 파일의 vi.mock 이 셋업의 mock 을 이긴다(과제 2 의 page-gate.test 가 여기에 기댄다). importActual 은 진짜 모듈을 준다(gate.test 가 기댄다).
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/modules/gate', () => ({ requireModule: vi.fn(async () => ({ ok: false, error: 'file-level' })) }))
import { requireModule } from '@/lib/modules/gate'

describe('셋업 mock 과 파일 mock 의 우선순위', () => {
  it('파일의 vi.mock 이 이긴다', async () => {
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: false, error: 'file-level' })
  })
  it('vi.importActual 은 진짜 구현이다', async () => {
    const actual = await vi.importActual<typeof import('@/lib/modules/gate')>('@/lib/modules/gate')
    expect(vi.isMockFunction(actual.requireModule)).toBe(false)
    expect(typeof actual.moduleState).toBe('function')
  })
})
