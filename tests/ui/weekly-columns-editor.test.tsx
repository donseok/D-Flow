// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_WEEKLY_COLUMNS } from '@/lib/domain/weeklyColumns'
const h = vi.hoisted(() => ({ save: vi.fn(), uncertain: false }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  return { useLocale: () => ({ t }) }
})
vi.mock('@/components/settings/useSettingsCommand', () => ({ useSettingsCommand: () => ({ save: h.save, pending: false, uncertain: h.uncertain, error: '', fieldErrors: {}, saved: false, clear: vi.fn() }) }))
import { WeeklyColumnsEditor } from '@/components/settings/WeeklyColumnsEditor'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => { h.save.mockClear(); h.uncertain = false; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!
const render = async (canEdit = true) => act(async () => root.render(<WeeklyColumnsEditor projectId="p1" revision={4} value={DEFAULT_WEEKLY_COLUMNS} canEdit={canEdit} />))
describe('weekly item settings editor', () => {
  it('reorders stable ids and saves the project-scoped definition', async () => {
    await render()
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="이슈 및 주요 이벤트 위로"]')!.click() })
    await act(async () => button('저장').click())
    expect(h.save).toHaveBeenCalledWith({ 'weekly.columns': [DEFAULT_WEEKLY_COLUMNS[1], DEFAULT_WEEKLY_COLUMNS[0]] })
  })
  it('adds a new item but prevents saving its empty name and prevents deleting the final item', async () => {
    await render()
    await act(async () => button('항목 추가').click())
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(3)
    expect(button('저장').disabled).toBe(true)
    const remove = () => button('삭제')
    await act(async () => remove().click())
    await act(async () => remove().click())
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1)
    expect(remove().disabled).toBe(true)
  })
  it('disables configuration changes for a read-only user', async () => {
    await render(false)
    expect(Array.from(host.querySelectorAll('input')).every(i => i.disabled)).toBe(true)
    expect(button('항목 추가').disabled).toBe(true)
    expect(button('저장')).toBeUndefined()
  })
})
