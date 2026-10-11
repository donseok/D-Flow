'use client'
import { useEffect } from 'react'

// 저장하지 않은 편집이 있는 자리 수와 안내 문구. 여러 행이 동시에 걸어도 묻는 것은 한 번이다(듣는 쪽은 문서에 하나).
let dirtyCount = 0
let message = ''

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirtyCount > 0) e.preventDefault()
}

/** 앱 안의 링크(사이드바·브레드크럼 등)를 눌러 떠나는 경우 — 라우터에는 이탈을 막는 길이 없어 클릭을 먼저 잡는다 */
function onClickCapture(e: MouseEvent) {
  if (dirtyCount === 0 || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!a || a.target === '_blank' || a.hasAttribute('download')) return
  const to = new URL(a.href, location.href)
  if (to.origin === location.origin && to.pathname === location.pathname && to.search === location.search) return   // 같은 화면 안의 이동(#앵커)
  if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation() }
}

/**
 * 저장하지 않은 편집이 있는 동안 화면을 떠나려 하면 묻는다 — 탭 닫기·새로고침(브라우저 기본 확인)과 앱 안의 링크 이동(확인 창).
 * 행마다 저장 버튼이 따로 있는 표에서 입력만 하고 다른 메뉴로 가면 경고 없이 사라지던 것을 막는다(2026-10-11 사용자 테스트 — 팀 구성).
 */
export function useLeaveGuard(dirty: boolean, text: string) {
  useEffect(() => {
    if (!dirty) return
    message = text
    if (dirtyCount++ === 0) {
      window.addEventListener('beforeunload', onBeforeUnload)
      document.addEventListener('click', onClickCapture, true)
    }
    return () => {
      if (--dirtyCount === 0) {
        window.removeEventListener('beforeunload', onBeforeUnload)
        document.removeEventListener('click', onClickCapture, true)
      }
    }
  }, [dirty, text])
}
