// ConfigStateNotice 의 상태 → StatusMessage 종류(스펙 §6.4 둘째 줄, W18). C 의 config-state-notice 테스트는 그대로 초록이어야 한다
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfigStateNotice, NOTICE_STATUS } from '@/components/settings/ConfigStateNotice'

const html = (p: Parameters<typeof ConfigStateNotice>[0]) => renderToStaticMarkup(<ConfigStateNotice {...p} />)

describe('ConfigStateNotice → StatusMessage', () => {
  it('매핑 표', () => {
    expect(NOTICE_STATUS).toEqual({ unavailable: 'partial_error', invalid: 'partial_error', required: 'needs_setup', disabled: 'disabled', field: 'partial_error', patch: 'partial_error' })
  })
  it('조회 실패 — partial_error, 루트 표지 둘 유지, 막는 오류(role=alert)', () => {
    const h = html({ kind: 'unavailable', locale: 'ko' })
    expect(h).toContain('data-config-state="unavailable"'); expect(h).toContain('data-config-load-error')
    expect(h).toContain('data-status-kind="partial_error"'); expect(h).toContain('role="alert"')
  })
  it('설정 손상 — 그 키 자리에 사유, 관리자에게만 설정 경로', () => {
    const admin = html({ kind: 'invalid', locale: 'ko', keyName: 'views.default', message: '형식', isAdmin: true, settingsHref: '/p/x/settings' })
    expect(admin).toContain('views.default'); expect(admin).toContain('href="/p/x/settings"')
    const member = html({ kind: 'invalid', locale: 'ko', keyName: 'views.default', settingsHref: '/p/x/settings' })
    expect(member).not.toContain('href="/p/x/settings"'); expect(member).toContain('관리자에게 문의하세요.')
  })
  it('필요 설정 없음 — needs_setup(막는 오류가 아니다)', () => {
    const h = html({ kind: 'required', locale: 'ko', keyName: 'core.level_labels', isAdmin: true, settingsHref: '/p/one/settings' })
    expect(h).toContain('data-status-kind="needs_setup"'); expect(h).toContain('role="status"'); expect(h).toContain('href="/p/one/settings"')
  })
  it('비활성 모듈 — disabled + 켜는 경로', () => {
    const h = html({ kind: 'disabled', locale: 'ko', message: '칸반이 꺼져 있습니다.', isAdmin: true, settingsHref: '#project-modules' })
    expect(h).toContain('data-status-kind="disabled"'); expect(h).toContain('href="#project-modules"'); expect(h).toContain('칸반이 꺼져 있습니다.')
  })
  it('패치 전체 거부·필드 오류 — role=alert(저장 바 위 자리)', () => {
    for (const kind of ['patch', 'field'] as const) {
      const h = html({ kind, locale: 'ko', message: '거부' })
      expect(h).toContain('role="alert"'); expect(h).toContain('거부'); expect(h).toContain(`data-config-state="${kind}"`)
    }
  })
  it('옛 모양(delayed 색·임의 반경)을 쓰지 않는다 — 상태 모양은 StatusMessage 하나', () => {
    expect(html({ kind: 'invalid', locale: 'ko' })).not.toMatch(/delayed|danger-weak|border-danger|rounded-xl/)
  })
})
