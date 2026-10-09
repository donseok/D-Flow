// @vitest-environment jsdom
// 터치 타깃(개정 §5.10.2 — 터치 상호작용 영역 44px 이상). 아이콘 버튼은 보이는 크기를 그대로 두고 누르는 영역만 가운데 44px 로 넓힌다
// (TOUCH_TARGET — 투명 ::before, size-11 = 44px). 닫기·햄버거가 그 클래스를 빠뜨리면 34·32·28px 로 돌아간다.
import { describe, expect, it, vi } from 'vitest'
import { render } from '../shell/_dom'
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
import { TOUCH_TARGET } from '@/components/ui/touchTarget'
import { IconButton } from '@/components/ui/IconButton'
import { Modal, ModalCloseButton } from '@/components/ui/Modal'
import { ToastProvider, useToast } from '@/components/ui/Toast'
import { MobileNavDrawer } from '@/components/app/MobileNavDrawer'
import { useEffect } from 'react'

const PARTS = TOUCH_TARGET.split(/\s+/)
const has = (el: Element | null) => { const c = (el?.getAttribute('class') ?? '').split(/\s+/); return PARTS.every((p) => c.includes(p)) }

describe('TOUCH_TARGET', () => {
  it('가운데 정렬한 44px(size-11) 투명 영역 — 기준은 버튼 자신(relative)', () => {
    expect(PARTS).toEqual(expect.arrayContaining(['relative', 'before:absolute', 'before:size-11', 'before:left-1/2', 'before:top-1/2',
      'before:-ml-5.5', 'before:-mt-5.5', "before:content-['']"]))
    // 보이는 크기를 바꾸는 유틸(폭·높이·패딩)은 없다
    expect(PARTS.filter((p) => /^(?:h|w|size|min-h|min-w|p[xytblr]?)-/.test(p))).toEqual([])
    expect(PARTS.filter((p) => /translate|scale|rotate/.test(p))).toEqual([])        // 이동 전환 없음(목록의 hover 이동 금지 검사와 같은 뜻)
  })
  it('IconButton — 조작 높이 정사각형(36) 그대로, 누르는 영역 44', () => {
    const { container } = render(<IconButton icon={<i />} aria-label="닫기" variant="ghost" />)
    const btn = container.querySelector('button')!
    expect(has(btn)).toBe(true)
    expect(btn.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-(--control-h)', 'h-(--control-h)']))
  })
  it('모달 닫기 — 보이는 크기 32(h-8 w-8), 누르는 영역 44. 열린 모달의 닫기가 그 버튼이다', () => {
    const { container } = render(<ModalCloseButton label="닫기" />)
    const btn = container.querySelector('button')!
    expect(has(btn)).toBe(true)
    expect(btn.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-8', 'w-8']))
    render(<Modal open onClose={() => {}} title="제목"><p>본문</p></Modal>)
    const close = [...document.querySelectorAll('[role="dialog"] button[aria-label="common.close"]')].find((b) => b.getAttribute('tabindex') !== '-1')
    expect(close).toBeTruthy(); expect(has(close!)).toBe(true)
  })
  it('토스트 닫기 — 보이는 크기 28(h-7 w-7), 누르는 영역 44', () => {
    function Fire() { const { toast } = useToast(); useEffect(() => { toast({ title: '저장했습니다' }) }, [toast]); return null }
    render(<ToastProvider><Fire /></ToastProvider>)
    const close = document.querySelector('button[aria-label="ui.toastDismiss"]')
    expect(close).toBeTruthy(); expect(has(close)).toBe(true)
    expect(close!.getAttribute('class')).toMatch(/\bh-7\b.*\bw-7\b/)
  })
  it('드로어 닫기 — 누르는 영역 44. 백드롭은 다른 겹침과 같은 bg-black/50(다크에서 밝은 fg 를 덮지 않는다)', () => {
    render(<MobileNavDrawer open onClose={() => {}} workspaceSwitcher={null} groups={[]} pathname="/w/a" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    expect(has(document.querySelector('button[aria-label="메뉴 닫기"]'))).toBe(true)
    const backdrop = document.querySelector('[data-drawer-backdrop]')!.getAttribute('class')!.split(/\s+/)
    expect(backdrop).toContain('bg-black/50'); expect(backdrop.filter((c) => c.startsWith('bg-fg'))).toEqual([])
  })
})
