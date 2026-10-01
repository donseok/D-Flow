// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from './_dom'
const h = vi.hoisted(() => ({ queueWorkspacePref: vi.fn(), queueProjectVisit: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueWorkspacePref: h.queueWorkspacePref, queueProjectVisit: h.queueProjectVisit, queueUiPref: vi.fn() }))
import { ShellScope, ShellScopeProvider, useShellScope } from '@/components/app/ShellScope'

const WS = { id: '00000000-0000-0000-7e57-000000001721', slug: 'acme', name: 'Acme' }
const P = '00000000-0000-0000-7e57-000000001722'
let seen: unknown = 'unset'
function Reader() { seen = useShellScope(); return null }
beforeEach(() => { vi.clearAllMocks(); document.cookie = 'dflow-ws=; max-age=0; path=/'; seen = 'unset' })

describe('ShellScope — 게시 저장소(D38 ②)·쿠키(D3)·최근 방문(§5.4.3)', () => {
  it('첫 게시 전에는 null, 게시 뒤 범위가 보인다', () => {
    const { rerender } = render(<ShellScopeProvider><Reader /></ShellScopeProvider>)
    expect(seen).toBeNull()
    rerender(<ShellScopeProvider><Reader /><ShellScope workspace={WS} projectId={null} projects={[]} /></ShellScopeProvider>)
    expect(seen).toEqual({ workspace: WS, projectId: null, projects: [] })
  })
  it('공급자 밖의 useShellScope 는 null(범위 없음)', () => {
    render(<Reader />)
    expect(seen).toBeNull()
  })
  it('쿠키는 값이 다를 때만 쓴다 — 형식 밖 슬러그는 쓰지 않는다', () => {
    const set = vi.spyOn(Document.prototype, 'cookie', 'set')
    render(<ShellScopeProvider><ShellScope workspace={WS} projectId={null} projects={[]} /></ShellScopeProvider>)
    expect(set).toHaveBeenCalledWith('dflow-ws=acme; path=/; max-age=31536000; samesite=lax')
    set.mockClear()
    render(<ShellScopeProvider><ShellScope workspace={WS} projectId={null} projects={[]} /></ShellScopeProvider>)
    expect(set).not.toHaveBeenCalled()
    render(<ShellScopeProvider><ShellScope workspace={{ ...WS, slug: 'Bad;x' }} projectId={null} projects={[]} /></ShellScopeProvider>)
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
  })
  it('프로젝트 범위면 방문만 알린다 — 목록은 서버가 자기 행에 앞으로 넣는다(Y1: 모름·옛 목록으로 덮지 않는다)', () => {
    render(<ShellScopeProvider><ShellScope workspace={WS} projectId={P} projects={[]} /></ShellScopeProvider>)
    expect(h.queueProjectVisit).toHaveBeenCalledWith(WS.id, P)
    expect(h.queueWorkspacePref).not.toHaveBeenCalled()
  })
  it('워크스페이스 범위(프로젝트 없음)는 방문을 쓰지 않는다', () => {
    render(<ShellScopeProvider><ShellScope workspace={WS} projectId={null} projects={[]} /></ShellScopeProvider>)
    expect(h.queueProjectVisit).not.toHaveBeenCalled()
  })
  it('persist=false(플랫폼 관리자의 비소속 보기)면 쿠키·방문을 쓰지 않고 게시만 한다', () => {
    const set = vi.spyOn(Document.prototype, 'cookie', 'set')
    render(<ShellScopeProvider><Reader /><ShellScope workspace={WS} projectId={P} projects={[]} persist={false} /></ShellScopeProvider>)
    expect(set).not.toHaveBeenCalled(); expect(h.queueProjectVisit).not.toHaveBeenCalled()
    expect(seen).toEqual({ workspace: WS, projectId: P, projects: [] })
    set.mockRestore()
  })
})
