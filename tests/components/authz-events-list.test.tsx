// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const list = vi.fn()
vi.mock('@/app/actions/authzEvents', () => ({ listAuthzEvents: (...a: unknown[]) => list(...a) }))
import { AuthzEventsList } from '@/components/settings/AuthzEventsList'

const view = (id: number, over: Record<string, unknown> = {}) => ({
  id, kind: 'workspace_role' as const, kindLabel: '워크스페이스 등급', summary: '멤버 → 관리자', causeLabel: '직접 변경',
  actorName: '김관리', targetName: '이멤버', projectName: null, createdAt: '2026-09-30T03:00:00Z', ...over,
})

describe('AuthzEventsList', () => {
  let host: HTMLDivElement, root: Root
  beforeEach(() => { list.mockReset(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  let n = 0     // 초기 상태는 마운트 때만 읽는다 — 다시 그릴 때는 새로 마운트한다
  const render = (initial: unknown) => act(() => root.render(<AuthzEventsList key={++n} workspaceId="ws-1" initial={initial as never} />))
  const click = async (text: string) => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!.click() })

  it('행위자·대상·요약·원인·시각을 보이고 지워진 계정은 그 이름 그대로 보인다', () => {
    render({ ok: true, rows: [view(2), view(1, { actorName: '삭제된 계정', kind: 'project_access', kindLabel: '프로젝트 권한', projectName: '알파', summary: '권한 부여 — 멤버' })], nextBefore: null })
    expect(host.textContent).toContain('김관리')
    expect(host.textContent).toContain('이멤버')
    expect(host.textContent).toContain('멤버 → 관리자')
    expect(host.textContent).toContain('직접 변경')
    expect(host.textContent).toContain('삭제된 계정')
    expect(host.textContent).toContain('알파')
    expect(host.textContent).toContain('2026')
  })

  it('이력이 없으면 빈 상태 문구, 조회 실패면 오류 — 둘을 섞지 않는다', () => {
    render({ ok: true, rows: [], nextBefore: null })
    expect(host.textContent).toContain('권한 변경 기록이 없습니다.')
    render({ ok: false, error: '권한 변경 이력을 불러오지 못했습니다.' })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('권한 변경 이력을 불러오지 못했습니다.')
    expect(host.textContent).not.toContain('권한 변경 기록이 없습니다.')
  })

  it('이전 기록 더 보기는 커서로 이어 붙이고, 새로고침은 처음부터 다시 읽는다', async () => {
    render({ ok: true, rows: [view(21)], nextBefore: 21 })
    list.mockResolvedValueOnce({ ok: true, rows: [view(20, { summary: '소속 제거 — 멤버' })], nextBefore: null })
    await click('이전 기록')
    expect(list).toHaveBeenCalledWith('ws-1', { before: 21 })
    expect(host.textContent).toContain('멤버 → 관리자')
    expect(host.textContent).toContain('소속 제거 — 멤버')
    expect(host.textContent).not.toContain('이전 기록 더 보기')
    list.mockResolvedValueOnce({ ok: true, rows: [view(30)], nextBefore: null })
    await click('새로고침')
    expect(list).toHaveBeenLastCalledWith('ws-1', undefined)
    expect(host.textContent).not.toContain('소속 제거 — 멤버')
  })

  it('불러오기 중 오류가 나면 기존 목록을 지우지 않고 오류를 보인다', async () => {
    render({ ok: true, rows: [view(2)], nextBefore: 2 })
    list.mockRejectedValueOnce(new Error('network'))
    await click('이전 기록')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('불러오지 못했습니다')
    expect(host.textContent).toContain('이멤버')
  })
})
