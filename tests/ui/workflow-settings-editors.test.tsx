// @vitest-environment jsdom
// SP5b W2 — 설정 화면 WBS 흐름 편집기 둘과 크레딧 정책: 바뀐 키만 한 명령으로 쓰고(정책은 표와 함께), 서버 사유(검수 중인 단계 삭제 등)를 그 자리에 보인다
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...a: unknown[]) => h.update(...a), getSettingsCommandOutcome: vi.fn() }))
import { ApprovalStepsEditor } from '@/components/settings/ApprovalStepsEditor'
import { StageLabelsEditor } from '@/components/settings/StageLabelsEditor'
import { StageCreditSlider } from '@/components/settings/StageCreditSlider'
import { DEFAULT_APPROVAL_STEPS } from '@/lib/domain/approvalSteps'

const setValue = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}
const OK = { ok: true, kind: 'applied', commandId: 'c', revision: 9, rebased: false }

describe('WBS 흐름 편집기', () => {
  let root: Root, el: HTMLDivElement
  beforeEach(() => { vi.clearAllMocks(); el = document.createElement('div'); document.body.append(el); root = createRoot(el) })
  afterEach(() => { act(() => root.unmount()); el.remove() })

  it('단계 이름 — 채운 칸만 저장, 모두 비우면 키를 지운다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<StageLabelsEditor projectId="p" value={{ im: '내부 검토' }} revision={3} canEdit />) })
    await act(async () => setValue(el.querySelector<HTMLInputElement>('[data-stage-label="xx"]')!, ' 납품 '))
    await act(async () => el.querySelector<HTMLButtonElement>('[data-stage-labels-save]')!.click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 3, set: { 'workflow.wbs_stage_labels': { im: '내부 검토', xx: '납품' } }, unset: [] })
    await act(async () => { setValue(el.querySelector<HTMLInputElement>('[data-stage-label="xx"]')!, ''); setValue(el.querySelector<HTMLInputElement>('[data-stage-label="im"]')!, '') })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-stage-labels-save]')!.click())
    expect(h.update.mock.calls[1][1]).toMatchObject({ set: {}, unset: ['workflow.wbs_stage_labels'] })
  })

  it('승인 단계 — 단계를 더해 2단으로, 선행 기준 final 을 한 명령으로. 서버 사유를 보인다', async () => {
    h.update.mockResolvedValueOnce({ ok: false, kind: 'invalid', code: 'CONFIG_IN_USE', commandId: 'c', error: '사용 중', retryable: false,
      fieldErrors: [{ key: 'workflow.approval_steps', message: "'client' 단계로 검수 중인 항목이 1건 있어 지울 수 없습니다." }] })
    await act(async () => { root.render(<ApprovalStepsEditor projectId="p" steps={DEFAULT_APPROVAL_STEPS} distinct={true} gate="reached" revision={5} canEdit />) })
    await act(async () => el.querySelector<HTMLButtonElement>('[data-approval-step-add]')!.click())
    const inputs = el.querySelectorAll<HTMLInputElement>('li[data-approval-step] input')
    await act(async () => { setValue(inputs[2], 'client'); setValue(inputs[3], '고객 승인') })
    await act(async () => el.querySelector<HTMLInputElement>('[data-predecessor-gate="final"]')!.click())
    await act(async () => el.querySelector<HTMLButtonElement>('[data-approval-steps-save]')!.click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 5, set: {
      'workflow.approval_steps': [{ code: 'review', label: null, approver: 'subtree_or_admin' }, { code: 'client', label: '고객 승인', approver: 'admin' }],
      'workflow.predecessor_gate': 'final',
    } })
    expect(Object.keys(h.update.mock.calls[0][1].set)).not.toContain('workflow.approval_distinct_approvers')
    expect(el.querySelector('[data-approval-steps-error]')?.textContent).toContain('검수 중인 항목')
  })

  it('승인 단계 — 기존 단계 code 는 고칠 수 없고, 마지막 하나는 지울 수 없다', async () => {
    await act(async () => { root.render(<ApprovalStepsEditor projectId="p" steps={DEFAULT_APPROVAL_STEPS} distinct={true} gate="reached" revision={5} canEdit />) })
    expect(el.querySelector<HTMLInputElement>('li[data-approval-step] input')!.disabled).toBe(true)
    expect([...el.querySelectorAll<HTMLButtonElement>('li button')].find((b) => b.textContent === 'settings.workflow.stepRemove')!.disabled).toBe(true)
  })

  it('크레딧 — 정책 {5,5} 로 바꾸고 반례 표를 정책과 한 명령으로 저장한다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<StageCreditSlider projectId="p" initial={{ default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } }} initialPolicy={{ step: 5, min_gap: 10 }} editable revision={7} />) })
    await act(async () => setValue(el.querySelector<HTMLInputElement>('[data-credit-policy-gap]')!, '5'))
    const save = el.querySelector<HTMLButtonElement>('[data-credit-save]')!
    await act(async () => save.click())   // 검토
    await act(async () => save.click())   // 저장
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 7, set: {
      'workflow.stage_credits': { default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } }, 'workflow.credit_policy': { step: 5, min_gap: 5 },
    } })
  })
})
