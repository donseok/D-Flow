'use client'

import { useId, type ReactNode } from 'react'

/**
 * 입력 필드 상태 계약(개정 §5.7.1, SP3b 스펙 §4.5, 계획 판정 Q25) — 라벨·설명·오류를 aria 로 잇고, 읽기 전용(선택·복사 가능)과
 * 비활성을 구분한다. 설명을 placeholder 에만 두지 않는다(설명은 별 요소). 컨트롤은 render-prop 으로 받아 input·textarea·select 에 같이 쓴다.
 * 'checking'·Select·Combobox 상태는 SPU1.
 */
export type FieldControlProps = {
  id: string
  'aria-invalid'?: true
  'aria-describedby'?: string
  readOnly?: boolean
  disabled?: boolean
  className: string
}

export function Field({ label, description, error, readOnly = false, disabled = false, children }: {
  label: ReactNode
  description?: ReactNode
  error?: string | null
  readOnly?: boolean
  disabled?: boolean
  children: (control: FieldControlProps) => ReactNode
}) {
  const id = useId()
  const descId = `${id}-desc`
  const errId = `${id}-err`
  const describedBy = [description ? descId : null, error ? errId : null].filter(Boolean).join(' ') || undefined
  const className =
    `h-(--control-h) w-full rounded-(--radius-control) border bg-surface px-3 text-control text-fg outline-none ` +
    `transition-[border-color] duration-(--motion-fast) placeholder:text-fg-muted focus:border-border-focus focus:ring-2 focus:ring-border-focus/25 ` +
    `disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-fg-disabled read-only:bg-surface-subtle ` +
    (error ? 'border-danger' : 'border-border-input')
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-meta font-semibold text-fg-secondary">{label}</label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, readOnly: readOnly || undefined, disabled: disabled || undefined, className })}
      {description && <p id={descId} className="text-meta text-fg-secondary">{description}</p>}
      {error && <p id={errId} className="text-meta font-medium text-danger">{error}</p>}
    </div>
  )
}
