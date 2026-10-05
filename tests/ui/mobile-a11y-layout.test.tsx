// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StatusMessage } from '@/components/ui/StatusMessage'

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

describe('짧은 화면의 채움 시트 하한 (D6-§9-mobile-a11y)', () => {
  it('높이 560px 이하에서는 문서 스크롤로 되돌리고 시트 본문을 300px 밑으로 줄이지 않는다', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const start = css.indexOf('@media (max-height: 560px)')
    expect(start).toBeGreaterThan(0)
    const block = css.slice(start, css.indexOf('@media', start + 1))
    expect(block).toContain('.app-main:has([data-frame="fill"]) { overflow-y: auto; scrollbar-gutter: stable; }')
    expect(block).toContain('[data-frame="fill"] > [data-frame-body] { flex: none; min-height: 300px; }')
    expect(block).not.toMatch(/display\s*:/)
  })
})

describe('StatusMessage Compact + Blocking 방어 (D6-§9-mobile-a11y, SP4 관찰 ③)', () => {
  it('compact + blocking partial_error인 경우 role="alert" 및 명확한 테두리/바탕 스타일을 적용한다', () => {
    act(() => {
      root.render(
        <StatusMessage
          kind="partial_error"
          title="작업 동기화 실패"
          detail="일부 작업의 변경사항이 서버에 저장되지 않았습니다."
          compact={true}
          blocking={true}
        />,
      )
    })

    const alertEl = document.querySelector('[role="alert"]')
    expect(alertEl).toBeTruthy()
    expect(alertEl?.className).toContain('border-danger/30')
    expect(alertEl?.className).toContain('bg-danger-weak/30')
  })

  it('compact 비-blocking partial_error인 경우 role="status" 및 일반 compact 여백을 사용한다', () => {
    act(() => {
      root.render(
        <StatusMessage
          kind="partial_error"
          title="경고 알림"
          compact={true}
          blocking={false}
        />,
      )
    })

    const statusEl = document.querySelector('[role="status"]')
    expect(statusEl).toBeTruthy()
    expect(statusEl?.className).not.toContain('border-danger/30')
    expect(statusEl?.className).toContain('py-2')
  })
})
