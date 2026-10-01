import { describe, expect, it } from 'vitest'
import { describeAuthzChange, AUTHZ_CAUSE_LABEL, AUTHZ_KIND_LABEL } from '@/lib/domain/authzEvents'

describe('describeAuthzChange — 권한 변경 한 줄 요약', () => {
  it('플랫폼 관리자: 지정과 해제', () => {
    expect(describeAuthzChange('platform_admin', null, { granted: true, granted_by: 'u1' })).toBe('지정')
    expect(describeAuthzChange('platform_admin', { granted: true }, null)).toBe('해제')
  })
  it('워크스페이스 등급: 소속 추가·등급 변경·소속 제거', () => {
    expect(describeAuthzChange('workspace_role', null, { role: 'member', invited_by: 'u1' })).toBe('소속 추가 (멤버)')
    expect(describeAuthzChange('workspace_role', { role: 'member' }, { role: 'admin' })).toBe('멤버 → 관리자')
    expect(describeAuthzChange('workspace_role', { role: 'admin' }, null)).toBe('소속 제거 (관리자)')
  })
  it('프로젝트 권한: 부여·변경·회수', () => {
    expect(describeAuthzChange('project_access', null, { access_role: 'member', access_granted_by: 'u1' })).toBe('부여 (멤버)')
    expect(describeAuthzChange('project_access', { access_role: 'member' }, { access_role: 'admin' })).toBe('멤버 → 관리자')
    expect(describeAuthzChange('project_access', { access_role: 'admin' }, null)).toBe('회수 (관리자)')
  })
  it('모르는 모양은 지어내지 않고 원문을 보인다', () => {
    expect(describeAuthzChange('workspace_role', { role: 'owner' }, { role: 'admin' })).toBe('owner → 관리자')
    expect(describeAuthzChange('platform_admin', { x: 1 }, { y: 2 })).toBe('변경 내용을 읽지 못했습니다')
    expect(describeAuthzChange('project_access', 'bad', 7)).toBe('변경 내용을 읽지 못했습니다')
  })
  it('종류·원인 라벨이 있다', () => {
    expect(AUTHZ_KIND_LABEL.platform_admin).toBe('플랫폼 관리자')
    expect(AUTHZ_KIND_LABEL.workspace_role).toBe('워크스페이스 등급')
    expect(AUTHZ_KIND_LABEL.project_access).toBe('프로젝트 권한')
    expect(AUTHZ_CAUSE_LABEL.direct).toBe('직접 변경')
    expect(AUTHZ_CAUSE_LABEL.cascade).toBe('연쇄(소속 변경)')
    expect(AUTHZ_CAUSE_LABEL.parent_deleted).toBe('상위 삭제')
  })
})
