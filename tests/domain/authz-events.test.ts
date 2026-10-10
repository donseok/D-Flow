import { describe, expect, it } from 'vitest'
import { describeAuthzChange, authzCauseLabel, authzKindLabel, AUTHZ_CAUSE_LABEL, AUTHZ_KIND_LABEL } from '@/lib/domain/authzEvents'

describe('describeAuthzChange — 권한 변경 한 줄 요약', () => {
  it('플랫폼 관리자: 지정과 해제', () => {
    expect(describeAuthzChange('platform_admin', null, { granted: true, granted_by: 'u1' })).toBe('지정')
    expect(describeAuthzChange('platform_admin', { granted: true }, null)).toBe('해제')
  })
  it('비밀번호 재설정(0053): 관리자가 재설정 — 모르는 모양은 지어내지 않는다', () => {
    expect(describeAuthzChange('password_reset', null, { reset: true })).toBe('관리자가 재설정')
    expect(describeAuthzChange('password_reset', null, { reset: false })).toBe('변경 내용을 읽지 못했습니다')
    expect(describeAuthzChange('password_reset', { reset: true }, null)).toBe('변경 내용을 읽지 못했습니다')
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
  it('명단 권한의 활성 전환(SP4 — 전·후에 active): 비활성화·다시 활성, 권한과 함께 바뀌면 ` · ` 로 잇는다', () => {
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, { access_role: 'admin', active: false }))
      .toBe('비활성화 (관리자)')
    expect(describeAuthzChange('project_access', { access_role: 'member', active: false }, { access_role: 'member', active: true }))
      .toBe('다시 활성 (멤버)')
    expect(describeAuthzChange('project_access', { access_role: 'member', active: false }, { access_role: 'admin', active: true }))
      .toBe('멤버 → 관리자 · 다시 활성')
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, { access_role: 'member', active: true }))
      .toBe('관리자 → 멤버')
    expect(describeAuthzChange('project_access', null, { access_role: 'member', access_granted_by: null, active: true })).toBe('부여 (멤버)')
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, null)).toBe('회수 (관리자)')
  })
  it('명단 행의 추가·삭제 기록도 active 를 읽는다 — 비활성 행이면 권한이 생기지 않았거나 이미 정지돼 있었다(A1-3 리뷰 M2)', () => {
    expect(describeAuthzChange('project_access', null, { access_role: 'member', access_granted_by: null, active: false })).toBe('부여 (멤버, 비활성)')
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: false }, null)).toBe('회수 (관리자, 비활성)')
    // active 가 없는 옛 기록·워크스페이스 등급은 그대로
    expect(describeAuthzChange('project_access', { access_role: 'admin' }, null)).toBe('회수 (관리자)')
    expect(describeAuthzChange('workspace_role', null, { role: 'member', active: false })).toBe('소속 추가 (멤버)')
  })
  it('명단 권한의 update 회수·부여 — 권한 칸이 null 로·null 에서(옛 모양도 읽는다)', () => {
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, { access_role: null, active: true }))
      .toBe('회수 (관리자)')
    expect(describeAuthzChange('project_access', { access_role: 'admin' }, { access_role: null })).toBe('회수 (관리자)')
    expect(describeAuthzChange('project_access', { access_role: null, active: true }, { access_role: 'member', active: true }))
      .toBe('부여 (멤버)')
  })
  it('인물의 활성 전환(SP4 — {person_active}): 인물 비활성 (권한 정지)·인물 다시 활성, 바뀌지 않았거나 모르는 값은 읽지 못한다', () => {
    expect(describeAuthzChange('project_access', { person_active: true }, { person_active: false })).toBe('인물 비활성 (권한 정지)')
    expect(describeAuthzChange('project_access', { person_active: false }, { person_active: true })).toBe('인물 다시 활성')
    expect(describeAuthzChange('project_access', { person_active: true }, { person_active: true })).toBe('변경 내용을 읽지 못했습니다')
    expect(describeAuthzChange('project_access', { person_active: 'yes' }, { person_active: false })).toBe('변경 내용을 읽지 못했습니다')
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, { access_role: 'admin', active: true }))
      .toBe('변경 내용을 읽지 못했습니다')
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
    expect(AUTHZ_KIND_LABEL.password_reset).toBe('비밀번호')
    expect(AUTHZ_CAUSE_LABEL.direct).toBe('직접 변경')
    expect(AUTHZ_CAUSE_LABEL.cascade).toBe('연쇄(소속 변경)')
    expect(AUTHZ_CAUSE_LABEL.parent_deleted).toBe('상위 삭제')
    expect(authzKindLabel('project_access')).toBe(AUTHZ_KIND_LABEL.project_access)
    expect(authzCauseLabel('cascade')).toBe(AUTHZ_CAUSE_LABEL.cascade)
  })
})
