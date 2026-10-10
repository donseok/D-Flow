import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { ConfigStateNotice } from '@/components/settings/ConfigStateNotice'
import { ensureEnLoaded } from '@/lib/i18n/dict'

describe('ConfigStateNotice', () => {
  it('영문 조회 오류에 서버의 한국어 원문을 싣지 않는다', async () => {
    await ensureEnLoaded()
    const html = renderToStaticMarkup(<ConfigLoadError locale="en" keyName="core.level_labels" error="설정 값이 올바르지 않습니다." />)
    expect(html).toContain('Corrupted or empty setting: core.level_labels')
    expect(html).not.toContain('설정 값이 올바르지 않습니다.')
    expect(html).toContain('data-config-load-error')
  })
  it('필요 설정 없음은 관리자에게 복구 경로, 일반 사용자에게 문의 안내를 준다', () => {
    const admin = renderToStaticMarkup(<ConfigStateNotice kind="required" locale="ko" keyName="core.level_labels" isAdmin settingsHref="/p/one/settings" />)
    const member = renderToStaticMarkup(<ConfigStateNotice kind="required" locale="ko" keyName="core.level_labels" />)
    expect(admin).toContain('href="/p/one/settings"')
    expect(member).toContain('관리자에게 문의하세요.')
  })
  it('키 손상은 조회 실패와 구분하고 관리자에게 설정 경로를 보여 준다', () => {
    const html = renderToStaticMarkup(<ConfigLoadError locale="ko" keyName="core.milestone_keywords" error="내부 오류" kind="invalid"
      isAdmin settingsHref="/p/one/settings" />)
    expect(html).toContain('data-config-state="invalid"')
    expect(html).toContain('설정이 손상되었습니다.')
    expect(html).toContain('href="/p/one/settings"')
    expect(html).not.toContain('내부 오류')
  })
})
