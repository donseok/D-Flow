// @vitest-environment jsdom
// 입력 필드 상태(SP3b 스펙 §4.5·§8.1) — 라벨·설명·오류 배선, 읽기 전용 ≠ 비활성
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Field } from '@/components/ui/Field'

const render = (props: Partial<Parameters<typeof Field>[0]> = {}) => {
  const d = document.createElement('div')
  d.innerHTML = renderToStaticMarkup(<Field label="이름" {...props}>{(p) => <input {...p} placeholder="예: 홍길동" />}</Field>)
  return { root: d, input: d.querySelector('input')!, label: d.querySelector('label')! }
}

describe('Field', () => {
  it('라벨이 컨트롤을 가리킨다', () => {
    const { input, label } = render()
    expect(label.getAttribute('for')).toBe(input.id)
    expect(input.hasAttribute('aria-invalid')).toBe(false)
    expect(input.hasAttribute('aria-describedby')).toBe(false)
  })
  it('오류면 aria-invalid, 설명과 오류 id 둘이 aria-describedby 에', () => {
    const { root, input } = render({ description: '팀에서 부르는 이름', error: '이름을 입력하세요' })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const ids = input.getAttribute('aria-describedby')!.split(' ')
    expect(ids).toHaveLength(2)
    expect(ids.map((i) => root.querySelector(`[id="${i}"]`)!.textContent)).toEqual(['팀에서 부르는 이름', '이름을 입력하세요'])
    expect(input.className).toMatch(/border-danger/)
  })
  it('설명은 placeholder 가 아니라 별 요소다', () => {
    const { root } = render({ description: '팀에서 부르는 이름' })
    expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toContain('팀에서 부르는 이름')
  })
  it('읽기 전용은 readOnly(선택·복사 가능), 비활성은 disabled — 둘은 다르다', () => {
    const ro = render({ readOnly: true }).input
    expect(ro.readOnly).toBe(true)
    expect(ro.disabled).toBe(false)
    const off = render({ disabled: true }).input
    expect(off.disabled).toBe(true)
    expect(off.readOnly).toBe(false)
  })
  it('높이·반경은 토큰, 경계는 border-input', () => {
    const { input } = render()
    expect(input.className).toMatch(/h-\(--control-h\)/)
    expect(input.className).toMatch(/rounded-\(--radius-control\)/)
    expect(input.className).toMatch(/border-border-input/)
  })
})
