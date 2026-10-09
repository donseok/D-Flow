import { describe, expect, it } from 'vitest'
import { describeAuthzChange, authzCauseLabel, authzKindLabel, AUTHZ_CAUSE_LABEL, AUTHZ_KIND_LABEL } from '@/lib/domain/authzEvents'
import { registerEn } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import { translatorFor } from '@/lib/i18n/translate'

registerEn(EN)
const en = translatorFor('en')

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
  })
})

describe('영어 번역 함수를 넘기면 라벨·요약이 영어다(넘기지 않으면 위의 한국어 그대로)', () => {
  it('종류·원인 라벨', () => {
    expect(authzKindLabel('platform_admin', en)).toBe('Platform admin')
    expect(authzKindLabel('workspace_role', en)).toBe('Workspace role')
    expect(authzKindLabel('project_access', en)).toBe('Project access')
    expect(authzKindLabel('password_reset', en)).toBe('Password')
    expect(authzCauseLabel('direct', en)).toBe('Direct change')
    expect(authzCauseLabel('cascade', en)).toBe('Cascade (membership change)')
    expect(authzCauseLabel('parent_deleted', en)).toBe('Parent deleted')
    expect(authzKindLabel('project_access')).toBe(AUTHZ_KIND_LABEL.project_access)
    expect(authzCauseLabel('cascade')).toBe(AUTHZ_CAUSE_LABEL.cascade)
  })
  it('요약 — 역할 이름은 기존 role.* 키를 따르고, 모르는 역할 값은 원문 그대로다', () => {
    expect(describeAuthzChange('platform_admin', null, { granted: true }, en)).toBe('Assigned')
    expect(describeAuthzChange('platform_admin', { granted: true }, null, en)).toBe('Removed')
    expect(describeAuthzChange('password_reset', null, { reset: true }, en)).toBe('Reset by an admin')
    expect(describeAuthzChange('workspace_role', null, { role: 'member' }, en)).toBe('Added to workspace (Member)')
    expect(describeAuthzChange('workspace_role', { role: 'admin' }, null, en)).toBe('Removed from workspace (Admin)')
    expect(describeAuthzChange('workspace_role', { role: 'member' }, { role: 'admin' }, en)).toBe('Member → Admin')
    expect(describeAuthzChange('workspace_role', { role: 'owner' }, { role: 'admin' }, en)).toBe('owner → Admin')
    expect(describeAuthzChange('project_access', { access_role: 'admin' }, null, en)).toBe('Revoked (Admin)')
    expect(describeAuthzChange('project_access', null, { access_role: 'member', active: false }, en)).toBe('Granted (Member, inactive)')
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, { access_role: 'admin', active: false }, en)).toBe('Deactivated (Admin)')
    expect(describeAuthzChange('project_access', { access_role: 'member', active: false }, { access_role: 'admin', active: true }, en)).toBe('Member → Admin · Reactivated')
    expect(describeAuthzChange('project_access', { access_role: 'admin', active: true }, { access_role: null, active: true }, en)).toBe('Revoked (Admin)')
    expect(describeAuthzChange('project_access', { person_active: true }, { person_active: false }, en)).toBe('Person deactivated (access suspended)')
    expect(describeAuthzChange('project_access', { person_active: false }, { person_active: true }, en)).toBe('Person reactivated')
    expect(describeAuthzChange('platform_admin', { x: 1 }, { y: 2 }, en)).toBe('Could not read this change')
  })
})
