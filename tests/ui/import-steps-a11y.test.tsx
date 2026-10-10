// @vitest-environment jsdom
// 가져오기 단계 표시의 접근성(SP4 #23 — B-3 리뷰 P3): 스크린리더가 원 안 숫자와 n/3 을 두 번 읽고("1 1/3 파일 선택") 완료를 듣지 못했다.
// 눈에 보이는 숫자·n/3·라벨은 aria-hidden, 읽는 문구는 sr-only 한 줄("3단계 중 1단계: 파일 선택(완료)") — 완료 단계는 그 표지를 함께 읽는다.
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { t, type DictKey } from '@/lib/i18n/dict'
import { StepBadge, stepSrText } from '@/components/import/ImportWizard'

const tKo = (k: DictKey) => t(k)

/** 보조기술이 읽는 글 — aria-hidden 가지를 뺀 텍스트 */
function spoken(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return ''
  return [...node.childNodes].map(spoken).join('')
}
function mount(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('가져오기 단계 표시 — 스크린리더 문구', () => {
  it('완료 단계는 "3단계 중 1단계: 파일 선택(완료)" 한 번만 읽는다 — 원 안 숫자·n/3·눈에 보이는 라벨은 aria-hidden', () => {
    const sr = stepSrText(tKo, 1, 3, tKo('importWizard.step1Label'), true)
    expect(sr).toBe('3단계 중 1단계: 파일 선택(완료)')
    const el = mount(renderToString(<StepBadge n={1} total={3} label={tKo('importWizard.step1Label')} active={false} done srText={sr} />))
    expect(spoken(el).trim()).toBe(sr)
    expect(el.textContent).toContain('1/3') // 눈에는 그대로 보인다
    expect(el.querySelector('.sr-only')?.textContent).toBe(sr)
  })
  it('진행 중·남은 단계는 완료 표지 없이 읽는다', () => {
    const sr = stepSrText(tKo, 2, 3, tKo('importWizard.step2Label'), false)
    expect(sr).toBe('3단계 중 2단계: 확인 및 실행')
    const el = mount(renderToString(<StepBadge n={2} total={3} label={tKo('importWizard.step2Label')} active done={false} srText={sr} />))
    expect(spoken(el).trim()).toBe(sr)
    expect(el.textContent).toContain('2') // 원 안 숫자(눈에만)
  })
  it('마법사는 단계마다 완료 여부를 넣은 읽기 문구를 넘긴다', () => {
    const src = readFileSync('src/components/import/ImportWizard.tsx', 'utf8')
    expect(src).toMatch(/<StepBadge[^>]*srText=\{stepSrText\(t, i \+ 1, all\.length, t\(label\), done\)\}/)
  })
})
