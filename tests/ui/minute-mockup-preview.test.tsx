// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesignSpecPreview } from '@/components/minutes/DesignSpecPreview'
import { MinuteMockupModal } from '@/components/minutes/MinuteMockupModal'
import { MockupPreview } from '@/components/minutes/MockupPreview'
import { normalizeDesignSpec, normalizeMockupSpec } from '@/lib/domain/mockup'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

const spec = normalizeMockupSpec({
  title: '회원 관리 목업',
  screens: [
    {
      id: 'login',
      title: '로그인',
      summary: '이메일과 비밀번호를 입력해 인증합니다.',
      components: [
        { type: 'heading', text: '로그인 화면' },
        { type: 'badge', text: 'SSO' },
        { type: 'input', text: '이메일' },
        { type: 'select', text: '역할 선택', items: ['관리자', '일반'] },
        { type: 'button', text: '들어가기', goto: 'home' },
        { type: 'button', text: '이동 없음' },
      ],
    },
    {
      id: 'home',
      title: '홈',
      components: [
        { type: 'text', text: '<b>홈 화면</b>' },
        { type: 'stats', text: '지표', items: ['사용자: 120명', '대기: 3건'] },
        { type: 'tabs', text: '탭', items: ['목록', '통계'] },
        { type: 'card', text: '요약 카드', items: ['항목 1', '항목 2'] },
        { type: 'image', text: '차트 영역' },
      ],
    },
  ],
})!

const designSpec = normalizeDesignSpec({
  title: '회원 관리 프로그램 설계서',
  overview: '사내 회원 및 권한 신청 흐름을 표준화합니다.',
  requirements: [
    { id: 'FR-01', category: '인증', title: 'SSO 로그인', description: '사내 계정으로 로그인한다.', priority: 'high' },
    { id: 'FR-02', category: '권한', title: '권한 신청', description: '역할을 선택해 신청한다.', priority: 'medium' },
  ],
  screens: [
    { id: 'login', name: '로그인 화면', purpose: '사용자 인증', elements: ['이메일 입력', '로그인 버튼'], flow: '인증 후 홈으로 이동' },
  ],
  rules: [{ kind: 'auth', title: '비밀번호 보안', detail: '비밀번호는 평문 저장하지 않는다.' }],
  openQuestions: ['외부 협력사 계정 허용 여부'],
})!

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const screenText = () => document.body.querySelector('[data-testid="mockup-screen"]')!.textContent ?? ''
const tab = (name: string) =>
  [...document.body.querySelectorAll('[role="tab"]')].find(el => el.textContent?.includes(name)) as HTMLButtonElement

describe('MockupPreview', () => {
  it('첫 화면·요약·확장 부품을 그리고 탭으로 화면을 바꾼다', () => {
    act(() => root.render(<MockupPreview spec={spec} />))
    expect(screenText()).toContain('로그인 화면')
    expect(screenText()).toContain('SSO')
    expect(container.textContent).toContain('이메일과 비밀번호를 입력해 인증합니다.')
    act(() => tab('홈').click())
    expect(screenText()).toContain('홈 화면')
    expect(screenText()).toContain('사용자: 120명')
    expect(screenText()).toContain('차트 영역')
  })

  it('goto 있는 버튼은 대상 화면으로 이동하고 이전 화면 버튼으로 돌아올 수 있다', () => {
    act(() => root.render(<MockupPreview spec={spec} />))
    const buttons = [...container.querySelectorAll('[data-testid="mockup-screen"] button')] as HTMLButtonElement[]
    expect(buttons[1].disabled).toBe(true)
    expect(buttons[0].textContent).toContain('min.mockup.gotoPrefix 홈')
    act(() => buttons[0].click())
    expect(screenText()).toContain('홈 화면')

    const backBtn = [...container.querySelectorAll('button')].find(b => b.textContent?.includes('min.mockup.back'))!
    act(() => backBtn.click())
    expect(screenText()).toContain('로그인 화면')
  })

  it('글은 텍스트로만 그린다(HTML 이 요소가 되지 않는다)', () => {
    act(() => root.render(<MockupPreview spec={spec} />))
    act(() => tab('홈').click())
    expect(container.querySelector('[data-testid="mockup-screen"] b')).toBeNull()
    expect(screenText()).toContain('<b>홈 화면</b>')
  })
})

describe('DesignSpecPreview', () => {
  it('설계서 섹션(개요·요구사항·화면·규칙·미결 사항)을 그리고 마크다운 원문 보기로 전환할 수 있다', () => {
    act(() => root.render(<DesignSpecPreview spec={designSpec} />))
    const preview = container.querySelector('[data-testid="design-spec-preview"]')!
    expect(preview.textContent).toContain('회원 관리 프로그램 설계서')
    expect(preview.textContent).toContain('사내 회원 및 권한 신청 흐름을 표준화합니다.')
    expect(preview.textContent).toContain('FR-01')
    expect(preview.textContent).toContain('SSO 로그인')
    expect(preview.textContent).toContain('외부 협력사 계정 허용 여부')

    const toggleMd = [...preview.querySelectorAll('button')].find(b => b.textContent?.includes('min.spec.viewRaw'))!
    act(() => toggleMd.click())
    expect(preview.querySelector('pre')?.textContent).toContain('# 회원 관리 프로그램 설계서')
  })
})

describe('MinuteMockupModal — 통합 설계서·목업 스튜디오', () => {
  it('설계서 탭에서 시작해 화면 목업 탭을 누르면 지연 생성하고, 피드백 재생성 시 버전을 추가한다', async () => {
    const specV2 = normalizeDesignSpec({
      ...designSpec,
      title: '회원 관리 프로그램 설계서 v2',
    })!
    const onLoadSpec = vi.fn().mockResolvedValue({ ok: true as const, value: specV2 })
    const onLoadMockup = vi.fn().mockResolvedValue({ ok: true as const, value: spec })
    const onClose = vi.fn()

    act(() => {
      root.render(
        <MinuteMockupModal
          initialTab="spec"
          designSpec={designSpec}
          onLoadSpec={onLoadSpec}
          onLoadMockup={onLoadMockup}
          onClose={onClose}
        />,
      )
    })

    expect(document.body.textContent).toContain('회원 관리 프로그램 설계서')

    // 피드백 입력 후 다시 생성 → v2 추가
    const input = document.body.querySelector('input')!
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '보안 감사 요건을 추가해 주세요')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const regenBtn = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('min.blueprint.regenerate'))!
    await act(async () => {
      regenBtn.click()
    })
    expect(onLoadSpec).toHaveBeenCalledWith('보안 감사 요건을 추가해 주세요', designSpec)
    expect(document.body.textContent).toContain('회원 관리 프로그램 설계서 v2')

    // 연속 보완은 직전 결과를 기준으로, 과거 버전을 선택하면 그 버전을 기준으로 한다.
    await act(async () => { regenBtn.click() })
    expect(onLoadSpec).toHaveBeenLastCalledWith('', specV2)
    const versionOne = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'v1')!
    act(() => versionOne.click())
    await act(async () => { regenBtn.click() })
    expect(onLoadSpec).toHaveBeenLastCalledWith('', designSpec)

    // 화면 목업 탭 전환 → onLoadMockup 자동 호출
    const mockupTab = document.body.querySelector<HTMLButtonElement>('[data-testid="blueprint-tab-mockup"]')!
    await act(async () => {
      mockupTab.click()
    })
    expect(onLoadMockup).toHaveBeenCalledTimes(1)
    expect(screenText()).toContain('로그인 화면')
  })
})
