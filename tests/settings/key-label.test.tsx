// C4 — 설정 키는 사람이 읽는 이름으로 보인다(이름이 있는 키만 — 없으면 키 그대로).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { settingKeyLabel } from '@/lib/settings/keyLabel'
import { ConfigStateNotice } from '@/components/settings/ConfigStateNotice'

describe('settingKeyLabel', () => {
  it('이름이 있는 키는 사전의 이름', () => {
    expect(settingKeyLabel('calendar.timezone')).toBe('시간대')
    expect(settingKeyLabel('core.level_labels')).toBe('WBS 단계 이름')
  })
  it('이름이 없는 키는 키 그대로', () => {
    expect(settingKeyLabel('no.such_key')).toBe('no.such_key')
  })
  it('레지스트리의 모든 키가 이름을 가진다(이름 없는 키 목록 = 빈 목록)', () => {
    const unnamed = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS].map(d => d.key).filter(k => settingKeyLabel(k) === k)
    expect(unnamed).toEqual([])
  })
})

describe('ConfigStateNotice', () => {
  it('손상 설정 안내는 키가 아니라 이름을 보인다', () => {
    const html = renderToStaticMarkup(<ConfigStateNotice kind="invalid" keyName="calendar.timezone" message="형식" />)
    expect(html).toContain('손상되었거나 비어 있는 설정: 시간대')
    expect(html).not.toContain('설정: calendar.timezone')
  })
})
