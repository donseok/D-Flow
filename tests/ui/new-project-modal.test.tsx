// @vitest-environment jsdom
// NewProjectModal 의 클라이언트 측 라벨 사전검증(리뷰 F 라운드1 — 서버 액션과 같은 순수 함수로
// 미리 막는다). 프로덕션에서는 서버 액션이 throw 한 메시지가 클라이언트에 전달되지 않으므로
// (React Flight 가 digest 만 보낸다), 여기서 막지 못하면 사용자는 원인 불명의 일반 에러만 본다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }),
}))
vi.mock('@/app/actions/project', () => ({
  createProject: mocks.createProject,
}))

import { NewProjectModal } from '@/components/home/NewProjectModal'

function setValue(input: HTMLInputElement, next: string) {
  // React 제어 입력 — 네이티브 setter 로 값 주입 후 input 이벤트를 발생시켜야 onChange 가 탄다.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, next)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('NewProjectModal — 단계 라벨 클라이언트 사전검증', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    mocks.createProject.mockReset()
    mocks.refresh.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  function openModal() {
    root = createRoot(container)
    act(() => root.render(<NewProjectModal />))
    const trigger = container.querySelector('button')!
    act(() => trigger.click())
  }

  it('라벨이 중복되면 validateLevelSettings 의 에러를 그대로 보여주고 createProject 는 부르지 않는다', async () => {
    openModal()
    const nameInput = document.querySelector<HTMLInputElement>('input[placeholder="home.phName"]')!
    const levelsInput = document.querySelector<HTMLInputElement>('input[placeholder="home.phLevels"]')!
    act(() => setValue(nameInput, '신규 프로젝트'))
    act(() => setValue(levelsInput, '단계,단계'))

    const createBtn = document.querySelector<HTMLButtonElement>('button.btn-primary')!
    await act(async () => {
      createBtn.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain('단계 이름이 중복됩니다.')
    expect(mocks.createProject).not.toHaveBeenCalled()
  })

  it('유효한 라벨이면 split·trim 된 배열로 createProject 를 부른다', async () => {
    mocks.createProject.mockResolvedValue(undefined)
    openModal()
    const nameInput = document.querySelector<HTMLInputElement>('input[placeholder="home.phName"]')!
    const levelsInput = document.querySelector<HTMLInputElement>('input[placeholder="home.phLevels"]')!
    act(() => setValue(nameInput, '신규 프로젝트'))
    act(() => setValue(levelsInput, ' 단계 , 작업 '))

    const createBtn = document.querySelector<HTMLButtonElement>('button.btn-primary')!
    await act(async () => {
      createBtn.click()
      await Promise.resolve()
    })

    expect(mocks.createProject).toHaveBeenCalledWith('신규 프로젝트', null, null, null, ['단계', '작업'])
  })

  it('라벨 입력에 aria-describedby 로 힌트가 연결되고 aria-required 가 켜져 있다', () => {
    openModal()
    const levelsInput = document.querySelector<HTMLInputElement>('input[placeholder="home.phLevels"]')!
    expect(levelsInput.getAttribute('aria-required')).toBe('true')
    const describedBy = levelsInput.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toBe('home.hintLevels')
  })
})
