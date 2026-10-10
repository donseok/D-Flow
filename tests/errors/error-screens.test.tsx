// @vitest-environment jsdom
// 셸 밖 오류 화면(src/app/error.tsx·global-error.tsx)과 참조 ID(개정 §5.10.3 — 지원용 참조 ID, 내부 구현은 노출하지 않는다).
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '../shell/_dom'
import { KO } from '@/lib/i18n/dict/ko'
import { PAGE_MARKERS } from '../../scripts/lib/e2e.mjs'

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko', t: (k: string) => (KO as Record<string, string>)[k] ?? k }),
}))
// 범위 오류 화면(위험 파일)은 이 테스트의 대상이 아니다 — 참조 ID 가 그 아래 붙는지만 본다
vi.mock('@/components/app/ScopeError', () => ({ ScopeError: ({ reset }: { reset: () => void }) => <div data-scope-error><button onClick={reset}>다시 시도</button></div> }))

import RootError from '@/app/error'
import GlobalError from '@/app/global-error'
import AppError from '@/app/(app)/error'
import GlobalScopeError from '@/app/(app)/(global)/error'
import WsError from '@/app/(app)/w/[slug]/error'
import ProjectError from '@/app/(app)/p/[projectId]/error'
import { ErrorReference } from '@/components/errors/ErrorReference'

const DIGEST = '2874501163'
const boom = (digest?: string) => Object.assign(new Error('SELECT * FROM secret_table failed at db.internal'), digest ? { digest } : {})
const ko = (k: keyof typeof KO) => KO[k]
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

afterEach(() => { vi.restoreAllMocks() })

describe('src/app/error.tsx — 범위 밖 경로(/login·/invite·/share·루트)의 오류', () => {
  it('h1 하나가 알림 영역 안에 있고 문구는 E2E 오류 표지와 같다', () => {
    const { container } = render(<RootError error={boom(DIGEST)} reset={vi.fn()} />)
    const h1s = container.querySelectorAll('h1')
    expect(h1s).toHaveLength(1)
    expect(h1s[0].textContent).toBe('화면을 불러오지 못했습니다')
    expect(h1s[0].closest('[role="alert"]')).not.toBeNull()
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    const marker = (PAGE_MARKERS as [string, string][]).find(([name]) => name === 'error-boundary')![1]
    expect(container.innerHTML).toContain(marker)
  })
  it('참조 ID(error.digest)를 보이고, 오류 메시지·스택은 보이지 않는다', () => {
    const { container } = render(<RootError error={boom(DIGEST)} reset={vi.fn()} />)
    const ref = container.querySelector('[data-error-reference]')!
    expect(ref.querySelector('code')!.textContent).toBe(DIGEST)
    expect(ref.textContent).toContain('참조 ID')
    expect(container.textContent).not.toMatch(/secret_table|db\.internal|SELECT/)
  })
  it('다시 시도는 reset 을 부르고, 처음으로는 전체 새로 고침 링크(/)다', () => {
    const reset = vi.fn()
    const { container } = render(<RootError error={boom(DIGEST)} reset={reset} />)
    fireEvent.click([...container.querySelectorAll('button')].find((b) => b.textContent === '다시 시도')!)
    expect(reset).toHaveBeenCalledOnce()
    const home = [...container.querySelectorAll('a')].find((a) => a.textContent === '처음으로')!
    expect(home.getAttribute('href')).toBe('/')
  })
  it('digest 가 없으면(브라우저에서만 난 오류) 참조 ID 자리를 그리지 않는다', () => {
    const { container } = render(<RootError error={boom()} reset={vi.fn()} />)
    expect(container.querySelector('[data-error-reference]')).toBeNull()
    expect(container.querySelector('h1')).not.toBeNull()
  })
})

describe('ErrorReference — 복사', () => {
  it('복사 버튼이 digest 를 클립보드에 쓰고 결과를 알린다', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = render(<ErrorReference digest={DIGEST} t={ko} />)
    const button = container.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('참조 ID 복사')
    fireEvent.click(button)
    await flush()
    expect(writeText).toHaveBeenCalledExactlyOnceWith(DIGEST)
    expect(button.textContent).toBe('복사했습니다')
    expect(container.querySelector('[role="status"]')!.textContent).toBe('복사했습니다')
  })
  it('클립보드를 쓸 수 없어도 던지지 않는다 — 값은 화면에 남아 직접 고를 수 있다', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    const { container } = render(<ErrorReference digest={DIGEST} t={ko} />)
    fireEvent.click(container.querySelector('button')!)
    await flush()
    expect(container.querySelector('button')!.textContent).toBe('복사')
    expect(container.querySelector('code')!.className).toContain('select-all')
  })
})

describe('src/app/global-error.tsx — 루트 레이아웃 오류', () => {
  it('자체 <html>·<body> 를 그리고 같은 오류 본문·참조 ID 를 싣는다', () => {
    const html = renderToStaticMarkup(<GlobalError error={boom(DIGEST)} reset={vi.fn()} />)
    expect(html).toMatch(/^<html lang="ko"/)
    expect(html).toContain('<body')
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1)
    expect(html).toContain('화면을 불러오지 못했습니다')
    expect(html).toContain(DIGEST)
    expect(html).not.toMatch(/secret_table|db\.internal/)
  })
  it('인라인 스크립트를 싣지 않는다 — 제품이 라이트 전용이라 깜박임 방지 스크립트가 없다(엄격한 CSP 에 해시 허용도 없다)', () => {
    const html = renderToStaticMarkup(<GlobalError error={boom(DIGEST)} reset={vi.fn()} />)
    expect(html).not.toContain('<script')
  })
  it('전역 CSS 를 스스로 불러온다(레이아웃이 불러오던 것은 따라오지 않는다) — 의미 토큰 클래스를 쓴다', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/app/global-error.tsx', 'utf8')
    expect(src).toMatch(/^import '\.\/globals\.css'$/m)
    expect(src).not.toMatch(/style=\{\{/)
  })
})

describe('범위 오류 경계 넷 — ScopeError 아래에 참조 ID', () => {
  it.each([['(app)', AppError], ['(global)', GlobalScopeError], ['w/[slug]', WsError], ['p/[projectId]', ProjectError]] as const)('%s/error.tsx', (_name, Boundary) => {
    const reset = vi.fn()
    const { container } = render(<Boundary error={boom(DIGEST)} reset={reset} />)
    expect(container.querySelector('[data-scope-error]')).not.toBeNull()
    expect(container.querySelector('[data-error-reference] code')!.textContent).toBe(DIGEST)
    fireEvent.click([...container.querySelectorAll('button')].find((b) => b.textContent === '다시 시도')!)
    expect(reset).toHaveBeenCalledOnce()
  })
})

describe('사전 — 오류 화면 문구가 있다', () => {
  it.each(['error.title', 'error.retryHint', 'error.contactHint', 'error.retry', 'error.home', 'error.refLabel', 'error.refHint', 'error.refCopy', 'error.refCopied', 'error.refCopyLabel'] as const)('%s', (key) => {
    expect(KO[key]).toBeTruthy()
  })
})
