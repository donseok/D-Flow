// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from './_dom'
const h = vi.hoisted(() => ({ push: vi.fn(), toast: vi.fn(), pathname: '/p/p1/issues', search: 'view=board&q=x' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }), usePathname: () => h.pathname, useSearchParams: () => new URLSearchParams(h.search) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: h.toast }) }))
import { ProjectSwitcher } from '@/components/app/ProjectSwitcher'

const P = (id: string, name: string, status = 'active') => ({ id, name, status: status as 'active', isAdmin: false })
const projects = [P('p1', 'Apollo'), P('p2', 'Borealis'), P('p3', 'Cygnus', 'done')]
const fetchMock = () => global.fetch as unknown as ReturnType<typeof vi.fn>
beforeEach(() => { vi.clearAllMocks(); global.fetch = vi.fn() as never })

describe('ProjectSwitcher(★6, D41)', () => {
  it('combobox·listbox ARIA, 구획 즐겨찾기 → 최근 → 전체, 입력으로 거른다', () => {
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={['p3']} recentIds={['p2']} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input); fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id)
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['즐겨찾기', '최근 방문', '전체'])
    fireEvent.change(input, { target: { value: 'bor' } })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Borealis'), expect.stringContaining('Borealis')])
  })
  it('목록에 없는 즐겨찾기·최근 id 는 그리지 않는다(다른 워크스페이스·숨김 — W14)', () => {
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={['gone']} recentIds={['also-gone']} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['전체'])
  })
  it('목록 조회 실패(projectsFailed)면 "일치하는 프로젝트가 없습니다" 대신 실패 문구(U2b-2 권한 리뷰 Y3)', () => {
    render(<ProjectSwitcher currentProjectId="p1" projects={[]} favoriteIds={['p1']} recentIds={[]} projectsFailed />)
    fireEvent.focus(screen.getByRole('combobox'))
    const box = screen.getByRole('listbox').textContent ?? ''
    expect(box).toContain('프로젝트 목록을 불러오지 못했습니다'); expect(box).not.toContain('일치하는 프로젝트가 없습니다')
  })
  it('Enter — 전환 라우트 → push, 꺼진 모듈이면 토스트', async () => {
    fetchMock().mockResolvedValue({ ok: true, json: async () => ({ href: '/p/p2/dashboard', fallbackModule: 'issues' }) })
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={[]} recentIds={[]} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'Bor' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/p/p2/dashboard'))
    expect(fetchMock().mock.calls[0][0]).toBe('/api/nav/switch-target?project=p2&path=%2Fp%2Fp1%2Fissues&query=%3Fview%3Dboard%26q%3Dx')
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '이 프로젝트에서는 이슈를 사용하지 않아 개요를 열었습니다.' }))
  })
  it('같은 모듈이 켜져 있으면 토스트 없이 이동', async () => {
    fetchMock().mockResolvedValue({ ok: true, json: async () => ({ href: '/p/p2/issues?view=board', fallbackModule: null }) })
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={[]} recentIds={[]} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'Bor' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/p/p2/issues?view=board'))
    expect(h.toast).not.toHaveBeenCalled()
  })
  it('라우트 실패·degraded — 개요로 가고 사유 토스트(위장 금지)', async () => {
    fetchMock().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={[]} recentIds={[]} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'Bor' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/p/p2/dashboard'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '설정을 불러오지 못해 개요를 열었습니다' }))
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('degraded 응답 — 개요로 가고 같은 사유 토스트', async () => {
    fetchMock().mockResolvedValue({ ok: true, json: async () => ({ href: '/p/p2/dashboard', fallbackModule: null, degraded: true }) })
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={[]} recentIds={[]} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input); fireEvent.change(input, { target: { value: 'Bor' } }); fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/p/p2/dashboard'))
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '설정을 불러오지 못해 개요를 열었습니다' }))
  })
  it('Esc 는 목록을 닫는다, Home·End 는 처음·끝', () => {
    render(<ProjectSwitcher currentProjectId="p1" projects={projects} favoriteIds={[]} recentIds={[]} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input); fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'End' })
    const last = screen.getAllByRole('option').at(-1)!
    expect(input.getAttribute('aria-activedescendant')).toBe(last.id)
    fireEvent.keyDown(input, { key: 'Home' })
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
})
