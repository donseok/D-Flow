'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * 모달 폼에 저장하지 않은 입력이 있는지 — Modal 의 `dirty` 에 넘겨 Esc·바깥 클릭·X 로 닫을 때 한 번 묻게 한다
 * (2026-10-12 사용자 테스트 UX-01 — 회의·공지·근태·이슈 폼이 경고 없이 닫히며 입력을 버렸다).
 *
 * 기준값은 "열린 직후 자리잡은 폼"이다. 폼들은 열릴 때 effect 로 초기값을 다시 채우므로 열린 그 렌더의 값은 아직 옛 값이다 —
 * 그 채움이 끝난 다음 틱의 값을 기준으로 잡는다. `resetKeys` 는 열린 채로 폼을 다시 채우는 값(수정 대상 등)이다.
 */
export function useModalDirty(open: boolean, value: unknown, resetKeys: readonly unknown[] = []): boolean {
  const snapshot = JSON.stringify(value)
  const latest = useRef(snapshot)
  useEffect(() => { latest.current = snapshot }, [snapshot])
  const [baseline, setBaseline] = useState<string | null>(null)

  useEffect(() => {
    setBaseline(null)
    if (!open) return
    const timer = window.setTimeout(() => setBaseline(latest.current), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ...resetKeys])

  return open && baseline !== null && baseline !== snapshot
}
