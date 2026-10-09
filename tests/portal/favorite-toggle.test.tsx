// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ post: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ postPrefsNow: h.post }))
vi.mock('@/lib/portal/reload', () => ({ reloadPortalPage: h.refresh }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})
import { toggleFavorite } from '@/lib/portal/favorites'
import { FavoritesProvider, useFavorites } from '@/components/portal/FavoritesProvider'
import { FavoriteToggle } from '@/components/portal/FavoriteToggle'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
let api: ReturnType<typeof useFavorites>
function Commands() { api = useFavorites(); return null }
const WS = '00000000-0000-0000-7e57-000000001849'
beforeEach(() => { h.post.mockReset().mockResolvedValue({ ok: true }); h.refresh.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
async function render(initial: string[] | null = []) { await act(async () => root.render(<FavoritesProvider workspaceId={WS} initial={initial}><FavoriteToggle projectId="a" projectName="Alpha" /><FavoriteToggle projectId="b" projectName="Beta" /><Commands /></FavoritesProvider>)) }
describe('즐겨찾기 범위와 저장 직렬화', () => {
  it('20개 상한은 켜기만 막고 끄기는 허용한다', () => {
    const full = Array.from({ length: 20 }, (_, i) => String(i))
    expect(toggleFavorite(full, 'new')).toEqual({ ok: false, reason: 'max' })
    expect(toggleFavorite(full, '1')).toEqual({ ok: true, next: full.filter(i => i !== '1') })
  })
  it('상한의 꺼진 버튼은 비활성 사유를 읽을 수 있다', async () => {
    await render(Array.from({ length: 20 }, (_, i) => i ? String(i) : 'a'))
    expect(host.querySelector('[aria-label="Beta 즐겨찾기"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(host.textContent).toContain('즐겨찾기는 20개까지입니다')
    expect(host.querySelector('[aria-label="Alpha 즐겨찾기"]')?.getAttribute('aria-disabled')).toBeNull()
  })
  it('연속 두 조작은 최신 성공 목록에서 만들고 완료 뒤 한번 refresh한다', async () => {
    let release!: (r: { ok: boolean }) => void
    h.post.mockImplementationOnce(() => new Promise(r => { release = r }))
    await render()
    let a!: Promise<void>, b!: Promise<void>
    await act(async () => { a = api.toggle('a'); b = api.toggle('b') })
    expect(h.post).toHaveBeenCalledTimes(1)
    await act(async () => { release({ ok: true }); await Promise.all([a, b]) })
    expect(h.post.mock.calls).toEqual([[{ prefs: { favoriteProjectIds: ['a'] }, workspaceId: WS }], [{ prefs: { favoriteProjectIds: ['a', 'b'] }, workspaceId: WS }]])
    expect(api.ids.has('a') && api.ids.has('b')).toBe(true)
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
  it('실패한 앞 조작은 다음 저장 목록에 섞이지 않는다', async () => {
    h.post.mockResolvedValueOnce({ ok: false })
    await render()
    await act(async () => { await Promise.all([api.toggle('a'), api.toggle('b')]) })
    expect(h.post.mock.calls[1][0]).toEqual({ prefs: { favoriteProjectIds: ['b'] }, workspaceId: WS })
    expect(api.ids.has('a')).toBe(false)
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('즐겨찾기를 저장하지 못했습니다')
  })
  it('네트워크 실패는 되돌리고 refresh하지 않는다', async () => {
    h.post.mockRejectedValueOnce(new Error('offline'))
    await render(['b'])
    await act(async () => { await api.toggle('a') })
    expect([...api.ids]).toEqual(['b']); expect(h.refresh).not.toHaveBeenCalled()
  })
  it('선행 설정 조회 실패는 빈 목록으로 덮어쓰지 않는다', async () => {
    await render(null)
    await act(async () => { await api.toggle('a') })
    expect(h.post).not.toHaveBeenCalled(); expect(api.disabled).toBe(true)
  })
})
