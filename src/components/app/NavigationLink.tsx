'use client'
import Link from 'next/link'
import { useEffect, useRef, useState, type ComponentProps } from 'react'

/** 메뉴 전체의 동적 조회 대신, 사용자가 가리키거나 키보드로 고른 목적지만 본문까지 미리 읽는다. */
export function NavigationLink({ onMouseEnter, onMouseLeave, onFocus, onBlur, ...props }: ComponentProps<typeof Link>) {
  const [ready, setReady] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return <Link {...props} prefetch={ready && props['aria-current'] !== 'page'}
    onMouseEnter={(e) => { cancel(); timer.current = setTimeout(() => { timer.current = null; setReady(true) }, 120); onMouseEnter?.(e) }}
    onMouseLeave={(e) => { cancel(); setReady(false); onMouseLeave?.(e) }}
    onFocus={(e) => { cancel(); setReady(true); onFocus?.(e) }}
    onBlur={(e) => { cancel(); setReady(false); onBlur?.(e) }} />
}
