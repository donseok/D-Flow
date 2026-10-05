// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentVersionStatus } from '@/components/doc/DocumentVersionStatus'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
})

describe('DocumentVersionStatus UI (D6-§8-docs, Q11)', () => {
  it('최신 버전을 열람할 때 최신 배지를 표시하고 이전 버전 경고를 노출하지 않는다', () => {
    act(() => {
      root.render(
        <DocumentVersionStatus
          currentVersionNo={3}
          viewingVersionNo={3}
          isDraft={false}
          latestHref="/doc/latest"
        />,
      )
    })

    const badge = document.querySelector('[data-testid="doc-version-badge"]')
    expect(badge?.textContent).toContain('v3')
    expect(badge?.textContent).toContain('(최신)')

    expect(document.querySelector('[data-testid="doc-version-old-warning"]')).toBeNull()
    expect(document.querySelector('[data-testid="doc-status-published-chip"]')).toBeTruthy()
  })

  it('이전 버전을 열람할 때 경고 배너 및 최신 버전 이동 링크를 노출한다', () => {
    act(() => {
      root.render(
        <DocumentVersionStatus
          currentVersionNo={5}
          viewingVersionNo={2}
          isDraft={false}
          latestHref="/wiki/topic-1"
        />,
      )
    })

    const warning = document.querySelector('[data-testid="doc-version-old-warning"]')
    expect(warning).toBeTruthy()
    expect(warning?.textContent).toContain('이전 버전(v2)을 열람 중입니다.')
    expect(warning?.textContent).toContain('최신 버전은 v5입니다.')

    const link = document.querySelector('[data-testid="doc-version-latest-link"]') as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link.getAttribute('href')).toBe('/wiki/topic-1')
  })

  it('초안(Draft) 상태일 때 초안 칩을 표시한다', () => {
    act(() => {
      root.render(
        <DocumentVersionStatus
          currentVersionNo={1}
          viewingVersionNo={1}
          isDraft={true}
        />,
      )
    })

    const draftChip = document.querySelector('[data-testid="doc-status-draft-chip"]')
    expect(draftChip).toBeTruthy()
    expect(draftChip?.textContent).toContain('초안 (Draft)')
  })
})
