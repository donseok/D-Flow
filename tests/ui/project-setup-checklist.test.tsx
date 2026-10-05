// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { ProjectSetupChecklist } from '@/components/settings/ProjectSetupChecklist'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let box: HTMLDivElement
afterEach(() => { act(() => root.unmount()); box.remove(); localStorage.clear() })

it('중단 뒤 이어하고 다른 계정·프로젝트에는 진행 위치를 공유하지 않는다', async () => {
  box = document.createElement('div'); document.body.append(box); root = createRoot(box)
  const mount = async (userId = 'user', projectId = 'project') => {
    await act(async () => root.render(<ProjectSetupChecklist key={`${userId}:${projectId}`} userId={userId} projectId={projectId} />))
  }
  const click = async (text: string) => {
    await act(async () => [...box.querySelectorAll('button')].find(b => b.textContent === text)!.click())
  }
  await mount(); await click('확인했어요 · 다음'); await click('나중에 이어하기')
  await mount('other'); expect(box.textContent).toContain('1 / 4 · 기본 정보')
  await mount(); expect(box.textContent).toContain('준비 체크리스트 이어하기')
  await click('준비 체크리스트 이어하기'); expect(box.textContent).toContain('2 / 4 · 사용 기능')
  await mount('user', 'other-project'); expect(box.textContent).toContain('1 / 4 · 기본 정보')
})
