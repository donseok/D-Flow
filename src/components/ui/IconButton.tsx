'use client'

import type { ReactNode } from 'react'
import { Button, type ButtonProps } from './Button'
import { TOUCH_TARGET } from './touchTarget'

/** 아이콘만 있는 버튼 — 접근 이름(aria-label)은 타입으로 필수다(SP3b 스펙 §4.5). 크기는 조작 높이의 정사각형, 누르는 영역은 44px(TOUCH_TARGET) */
export type IconButtonProps = Omit<ButtonProps, 'children' | 'icon' | 'aria-label'> & { icon: ReactNode; 'aria-label': string }

export function IconButton({ icon, className = '', ...rest }: IconButtonProps) {
  return <Button {...rest} className={`w-(--control-h) px-0 ${TOUCH_TARGET} ${className}`}>{icon}</Button>
}
