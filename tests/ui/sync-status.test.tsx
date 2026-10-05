// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SyncStatus } from '@/components/ui/SyncStatus'
import { editSessionStore } from '@/lib/sync/editSession'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  editSessionStore.clearAll()
  editSessionStore.setConnectionState('online')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

const mount = async () => {
  await act(async () => root.render(<SyncStatus />))
}

describe('SyncStatus component', () => {
  it('서버 초기 상태와 클라이언트 상태가 달라도 hydration 오류 없이 최신 상태를 표시한다', async () => {
    container.innerHTML = renderToString(<SyncStatus />)
    expect(container.innerHTML).toBe('')
    editSessionStore.setSession('hydration', 'wbs', 'i-1', 'failed')
    const errors: unknown[] = []
    await act(async () => {
      root = hydrateRoot(container, <SyncStatus />, { onRecoverableError: error => errors.push(error) })
    })
    expect(errors).toEqual([])
    expect(container.textContent).toContain('확인 필요 1')
  })
  it('저장 중인 세션이 있으면 "저장 중..."을 표시한다', async () => {
    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'saving')
    await mount()
    expect(container.textContent).toContain('저장 중...')
  })

  it('실패나 충돌이 있으면 "확인 필요 n"을 표시한다', async () => {
    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'failed')
    editSessionStore.setSession('s-2', 'wbs', 'i-2', 'conflict')
    await mount()
    expect(container.textContent).toContain('확인 필요 2')
  })

  it('오프라인 상태이면 "연결 끊김"을 표시한다', async () => {
    editSessionStore.setConnectionState('offline')
    await mount()
    expect(container.textContent).toContain('연결 끊김')
  })

  it('동기화 완료 상태이고 저장 시각이 있으면 "동기화됨"을 표시한다', async () => {
    editSessionStore.setSession('s-1', 'wbs', 'i-1', 'saved')
    await mount()
    expect(container.textContent).toContain('동기화됨')
  })
})
