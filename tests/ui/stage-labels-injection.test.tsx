// @vitest-environment jsdom
// SP5b W2 — 프로젝트 단계 이름(workflow.wbs_stage_labels)이 칩·대기 사유 문구에 들어간다. 없는 칸·공급자 밖은 기본 이름
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StageChip } from '@/components/wbs/shared'
import { StageLabelsProvider } from '@/components/wbs/StageLabelsProvider'
import { stageText } from '@/lib/domain/waitReason'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const t = (k: string) => `dict:${k}`

describe('단계 이름 주입', () => {
  let root: Root, el: HTMLDivElement
  beforeEach(() => { el = document.createElement('div'); document.body.append(el); root = createRoot(el) })
  afterEach(() => { act(() => root.unmount()); el.remove() })
  it('StageChip 의 title — 프로젝트 이름, 없는 칸은 사전, 공급자 밖도 사전', async () => {
    await act(async () => { root.render(<StageLabelsProvider labels={{ im: '내부 검토' }}><StageChip stage="im" t={t as never} /><StageChip stage="xx" t={t as never} /></StageLabelsProvider>) })
    const chips = el.querySelectorAll('[data-wbs-stage]')
    expect(chips[0].getAttribute('title')).toBe('내부 검토')
    expect(chips[1].getAttribute('title')).toBe('dict:wbs.stageXx')
    await act(async () => { root.render(<StageChip stage="im" t={t as never} />) })
    expect(el.querySelector('[data-wbs-stage]')!.getAttribute('title')).toBe('dict:wbs.stageIm')
  })
  it('대기 사유의 stageText', () => {
    expect(stageText('im', { im: '내부 검토' })).toBe('im(내부 검토)')
    expect(stageText('im')).toBe('im(검수 대기)')
    expect(stageText(null, { none: '대기' })).toBe('단계 없음')
  })
})
