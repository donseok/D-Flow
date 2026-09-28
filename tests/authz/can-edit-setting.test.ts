// 설정 키 editor 등급(스펙 §3.3) — 가드가 스코프 등급을 이미 판정한 뒤의 남은 판정. 모르는 editor·스코프에 안 맞는 editor 는 거부(fail-closed).
import { describe, expect, it } from 'vitest'
import { canEditSetting } from '@/lib/domain/authz'
import { makeActor, makeSuperuser } from '../fixtures/actor'

describe('canEditSetting', () => {
  const user = makeActor(), su = makeSuperuser()
  it('프로젝트 스코프는 project_admin 키만', () => {
    expect(canEditSetting('project', 'project_admin', user)).toBe(true)
    expect(canEditSetting('project', 'workspace_admin', su)).toBe(false)
    expect(canEditSetting('project', 'platform_admin', su)).toBe(false)
  })
  it('워크스페이스 스코프는 workspace_admin, platform_admin 은 슈퍼유저만', () => {
    expect(canEditSetting('workspace', 'workspace_admin', user)).toBe(true)
    expect(canEditSetting('workspace', 'platform_admin', user)).toBe(false)
    expect(canEditSetting('workspace', 'platform_admin', su)).toBe(true)
    expect(canEditSetting('workspace', 'project_admin', su)).toBe(false)
  })
  it('모르는 editor 값은 거부', () => {
    expect(canEditSetting('workspace', 'owner' as never, su)).toBe(false)
    expect(canEditSetting('project', 'owner' as never, su)).toBe(false)
  })
})
