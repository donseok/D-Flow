// @vitest-environment jsdom
/**
 * 회의록 Mermaid 렌더 설정 — 또박또박(원본 앱)과 같은 모습으로 그린다.
 *
 * 1) htmlLabels:false 금지 — mermaid 11 의 통합 렌더러는 SVG 텍스트 라벨을 가로로 옮기지 않고
 *    (labelHelper: translate(0, -h/2)) text-anchor:middle 에 기대는데, mindmap 노드 라벨에는 그 값이
 *    붙지 않는다. 결과: 글자가 노드 중심에서 시작해 오른쪽으로 반 폭만큼 밀린다(2026-09-10 제보).
 * 2) 색은 또박또박과 같은 내장 테마 'default' 하나다(제품이 라이트 전용 — 2026-10-10). 앱 팔레트를 themeVariables 로
 *    덮으면 mindmap 섹션 색(cScale*)이 거기서 파생돼 원본과 다른 색이 된다.
 * 3) securityLevel 'strict' 유지 — HTML 라벨 출력은 mermaid 가 DOMPurify 로 정화한다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg data-testid="mmd"></svg>' })),
}))

vi.mock('mermaid', () => ({ default: { initialize: mocks.initialize, render: mocks.render } }))

import { MarkdownView } from '@/components/minutes/MarkdownView'

const MINDMAP = '```mermaid\nmindmap\n  root["원가 모델 설계"]\n    a["입력 조건 매핑"]\n```'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.initialize.mockClear()
  mocks.render.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function renderView() {
  await act(async () => { root.render(<MarkdownView content={MINDMAP} />) })
  // 동적 import('mermaid') → initialize → render → setState 까지 흘려보낸다
  await act(async () => { await new Promise(r => setTimeout(r, 0)) })
}

function lastConfig(): Record<string, unknown> {
  const calls = mocks.initialize.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][0] as Record<string, unknown>
}

describe('회의록 Mermaid 렌더 설정', () => {
  it('SVG 텍스트 라벨(htmlLabels:false)을 강제하지 않는다 — mindmap 라벨 밀림 방지', async () => {
    await renderView()
    expect(lastConfig().htmlLabels).not.toBe(false)
    expect(container.querySelector('.minutes-mermaid svg')).not.toBeNull()
  })

  it('또박또박과 같은 default 테마 — 색을 themeVariables 로 덮지 않는다', async () => {
    await renderView()
    const cfg = lastConfig()
    expect(cfg.theme).toBe('default')
    const vars = (cfg.themeVariables ?? {}) as Record<string, unknown>
    for (const key of ['primaryColor', 'primaryBorderColor', 'primaryTextColor', 'lineColor', 'secondaryColor', 'tertiaryColor']) {
      expect(vars[key], key).toBeUndefined()
    }
  })

  it('OS 가 다크여도 default 테마다 — 화면 테마를 읽지 않는다', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }))
    document.documentElement.classList.add('dark')
    try {
      await renderView()
      expect(lastConfig().theme).toBe('default')
    } finally { document.documentElement.classList.remove('dark'); vi.unstubAllGlobals() }
  })

  it('securityLevel strict 를 유지한다', async () => {
    await renderView()
    expect(lastConfig().securityLevel).toBe('strict')
  })

  it('한 번 마운트에 initialize·render 를 한 번만 부른다(테마 준비를 기다리는 두 번째 렌더가 없다)', async () => {
    await renderView()
    expect(mocks.initialize).toHaveBeenCalledTimes(1)
    expect(mocks.render).toHaveBeenCalledTimes(1)
  })
})
