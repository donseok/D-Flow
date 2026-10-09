// @vitest-environment jsdom
// 외부 업로드 폴더 자동 정리 스위치(minutes.auto_file_by_path — 프로젝트 설정 '회의록' 범주). 한 명령으로 그 키만 쓴다(expectedRevision CAS).
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const h = vi.hoisted(() => ({ update: vi.fn(), outcome: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('@/app/actions/settings', () => ({ updateProjectSettings: (...a: unknown[]) => h.update(...a), getSettingsCommandOutcome: (...a: unknown[]) => h.outcome(...a) }))
import { MinutesAutoFileEditor } from '@/components/settings/MinutesAutoFileEditor'
import { settingsKo } from '@/lib/i18n/dict/settings'
import { settingsEn } from '@/lib/i18n/dict/settings.en'

const KEY = 'minutes.auto_file_by_path'
const OK = { ok: true, kind: 'applied', commandId: 'c', revision: 9, rebased: false }

describe('MinutesAutoFileEditor', () => {
  let root: Root, el: HTMLDivElement
  beforeEach(() => { vi.clearAllMocks(); el = document.createElement('div'); document.body.append(el); root = createRoot(el) })
  afterEach(() => { act(() => root.unmount()); el.remove() })
  const sw = () => el.querySelector<HTMLButtonElement>('[role="switch"]')!
  const save = () => el.querySelector<HTMLButtonElement>('[data-minutes-auto-file-save]')!

  it('지금 값을 그리고, 바뀐 것이 없으면 저장할 수 없다 — 켬·끔마다 그 상태의 설명을 보인다', async () => {
    await act(async () => { root.render(<MinutesAutoFileEditor projectId="p" value revision={3} canEdit />) })
    expect(sw().getAttribute('aria-checked')).toBe('true')
    expect(sw().textContent).toBe(`settings.${KEY}.on`)
    expect(el.textContent).toContain(`settings.${KEY}.onHint`)
    expect(save().disabled).toBe(true)
    await act(async () => sw().click())
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(el.textContent).toContain(`settings.${KEY}.offHint`)
    expect(save().disabled).toBe(false)
  })

  it('끄고 저장 — 패치는 그 키 하나(false), expectedRevision. 저장 뒤에는 다시 저장할 것이 없다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<MinutesAutoFileEditor projectId="p-1" value revision={3} canEdit />) })
    await act(async () => sw().click())
    await act(async () => save().click())
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0]).toBe('p-1')
    expect(h.update.mock.calls[0][1]).toMatchObject({ expectedRevision: 3, set: { [KEY]: false }, unset: [] })
    expect(el.querySelector('[role="status"]')?.textContent).toBe('settings.workflow.saved')
    expect(save().disabled).toBe(true)
    // 다시 켜면 true 를 쓴다(키를 지우지 않는다 — 기본값이 바뀌어도 고른 값이 남는다)
    await act(async () => sw().click())
    await act(async () => save().click())
    expect(h.update.mock.calls[1][1]).toMatchObject({ expectedRevision: 9, set: { [KEY]: true }, unset: [] })
  })

  it('손상 값 — 사유를 보이고 같은 값(켬)이어도 다시 저장해 고칠 수 있다', async () => {
    h.update.mockResolvedValue(OK)
    await act(async () => { root.render(<MinutesAutoFileEditor projectId="p" value={null} revision={3} canEdit invalid />) })
    expect(el.querySelector('[role="alert"]')?.textContent).toBe(`settings.${KEY}.invalid`)
    expect(sw().getAttribute('aria-checked')).toBe('true')
    expect(save().disabled).toBe(false)
    await act(async () => save().click())
    expect(h.update.mock.calls[0][1]).toMatchObject({ set: { [KEY]: true } })
    expect(el.querySelector('[role="alert"]')).toBeNull()
    expect(save().disabled).toBe(true)
  })

  it('서버가 거부하면(충돌·필드 오류) 그 문구를 보이고 고른 값은 남는다', async () => {
    h.update.mockResolvedValue({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: 'c', error: '설정 값이 올바르지 않습니다.', retryable: false,
      fieldErrors: [{ key: KEY, message: '참/거짓이어야 합니다.' }] })
    await act(async () => { root.render(<MinutesAutoFileEditor projectId="p" value revision={3} canEdit />) })
    await act(async () => sw().click())
    await act(async () => save().click())
    expect(el.querySelector('[role="alert"]')?.textContent).toBe('참/거짓이어야 합니다.')
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(save().disabled).toBe(false)
  })

  it('권한이 없으면 스위치는 잠기고 저장 단추가 없다', async () => {
    await act(async () => { root.render(<MinutesAutoFileEditor projectId="p" value={false} revision={3} canEdit={false} />) })
    expect(sw().disabled).toBe(true)
    expect(sw().getAttribute('aria-checked')).toBe('false')
    expect(el.querySelector('[data-minutes-auto-file-save]')).toBeNull()
  })

  it('문구는 ko·en 둘 다 있다', () => {
    for (const suffix of ['label', 'desc', 'switch', 'on', 'off', 'onHint', 'offHint', 'invalid']) {
      const k = `settings.${KEY}.${suffix}`
      expect((settingsKo as Record<string, string>)[k], `ko ${k}`).toBeTruthy()
      expect((settingsEn as Record<string, string>)[k], `en ${k}`).toBeTruthy()
    }
  })
})
