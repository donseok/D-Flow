// 워크스페이스 생성 입력의 순수 검증 — 서버 액션과 생성 폼이 같은 함수를 쓴다(dev-bootstrap 과 같은 규칙).
import { describe, expect, it } from 'vitest'
import { NON_CORE_MODULES } from '@/lib/modules/defaults'
import { checkWorkspaceCreate, splitDomainsInput, suggestedInviteDomain } from '@/lib/workspace/createInput'

const base = { name: '새 조직', slug: 'new-org' }

describe('checkWorkspaceCreate', () => {
  it('기본값 — 첫 관리자는 만드는 사람(null), 허용 모듈은 비core 전부, 시간대·초대 허용 도메인은 쓰지 않는다(null)', () => {
    expect(checkWorkspaceCreate(base)).toEqual({ ok: true, value: { name: '새 조직', slug: 'new-org', adminEmail: null, modules: [...NON_CORE_MODULES], timezone: null, inviteDomains: null } })
    expect(checkWorkspaceCreate({ ...base, adminEmail: '', timezone: '' })).toMatchObject({ ok: true, value: { adminEmail: null, timezone: null } })
  })
  it('이름 — 앞뒤 공백을 걷고, 비었거나 80자 초과·줄바꿈이면 거부', () => {
    expect(checkWorkspaceCreate({ ...base, name: '  조직  ' })).toMatchObject({ ok: true, value: { name: '조직' } })
    expect(checkWorkspaceCreate({ ...base, name: '   ' })).toEqual({ ok: false, code: 'name_required', field: 'name' })
    expect(checkWorkspaceCreate({ slug: 'a1' })).toEqual({ ok: false, code: 'name_required', field: 'name' })
    expect(checkWorkspaceCreate({ ...base, name: 'x'.repeat(81) })).toEqual({ ok: false, code: 'name_too_long', field: 'name' })
    expect(checkWorkspaceCreate({ ...base, name: 'a\nb' })).toEqual({ ok: false, code: 'name_too_long', field: 'name' })
  })
  it.each(['A-team', 'a', '-abc', 'has space', 'under_score', ' padded ', 'a'.repeat(64), '한글', ''])('slug %j 는 거부 — 조용히 고치지 않는다', (slug) => {
    expect(checkWorkspaceCreate({ ...base, slug })).toEqual({ ok: false, code: 'slug_invalid', field: 'slug' })
  })
  it.each(['ab', 'a1', '0team', 'team-2026', 'a'.repeat(63)])('slug %j 는 통과(DB check 와 같은 식)', (slug) => {
    expect(checkWorkspaceCreate({ ...base, slug })).toMatchObject({ ok: true, value: { slug } })
  })
  it('첫 관리자 이메일 — 소문자·공백 정리, 형식 밖은 거부', () => {
    expect(checkWorkspaceCreate({ ...base, adminEmail: '  Owner@Example.COM ' })).toMatchObject({ ok: true, value: { adminEmail: 'owner@example.com' } })
    expect(checkWorkspaceCreate({ ...base, adminEmail: 'not-an-email' })).toEqual({ ok: false, code: 'email_invalid', field: 'adminEmail' })
    expect(checkWorkspaceCreate({ ...base, adminEmail: 42 })).toEqual({ ok: false, code: 'email_invalid', field: 'adminEmail' })
  })
  it('허용 모듈 — 빈 배열은 core 만, 중복은 걷고 레지스트리 순으로, 모르는 id·core id 는 거부(조용히 버리지 않는다)', () => {
    expect(checkWorkspaceCreate({ ...base, modules: [] })).toMatchObject({ ok: true, value: { modules: [] } })
    expect(checkWorkspaceCreate({ ...base, modules: ['wiki', 'kanban', 'wiki'] })).toMatchObject({ ok: true, value: { modules: ['kanban', 'wiki'] } })
    expect(checkWorkspaceCreate({ ...base, modules: ['kanban', 'nope'] })).toEqual({ ok: false, code: 'modules_invalid', field: 'modules' })
    expect(checkWorkspaceCreate({ ...base, modules: ['wbs'] })).toEqual({ ok: false, code: 'modules_invalid', field: 'modules' })
    expect(checkWorkspaceCreate({ ...base, modules: 'kanban' })).toEqual({ ok: false, code: 'modules_invalid', field: 'modules' })
  })
  it('시간대 — IANA 이름만, 오프셋 꼴·모르는 이름은 거부', () => {
    expect(checkWorkspaceCreate({ ...base, timezone: 'Asia/Tokyo' })).toMatchObject({ ok: true, value: { timezone: 'Asia/Tokyo' } })
    expect(checkWorkspaceCreate({ ...base, timezone: '+09:00' })).toEqual({ ok: false, code: 'timezone_invalid', field: 'timezone' })
    expect(checkWorkspaceCreate({ ...base, timezone: 'Nowhere/City' })).toEqual({ ok: false, code: 'timezone_invalid', field: 'timezone' })
  })
  it('초대 허용 도메인 — 선택. 비우면 쓰지 않는다(null — 명시 [] 로 저장해 배포 기본값을 덮지 않는다)', () => {
    for (const inviteDomains of [undefined, null, []]) {
      expect(checkWorkspaceCreate({ ...base, inviteDomains })).toMatchObject({ ok: true, value: { inviteDomains: null } })
    }
  })
  it('초대 허용 도메인 — 설정 키의 파서와 같은 규칙: 소문자·@ 접두 제거·중복 제거, * 는 단독만', () => {
    expect(checkWorkspaceCreate({ ...base, inviteDomains: [' Example.COM ', '@partner.co.kr', 'example.com'] }))
      .toMatchObject({ ok: true, value: { inviteDomains: ['example.com', 'partner.co.kr'] } })
    expect(checkWorkspaceCreate({ ...base, inviteDomains: ['*'] })).toMatchObject({ ok: true, value: { inviteDomains: ['*'] } })
    const INVALID = { ok: false, code: 'domains_invalid', field: 'inviteDomains' }
    expect(checkWorkspaceCreate({ ...base, inviteDomains: ['*', 'example.com'] })).toEqual(INVALID)
    expect(checkWorkspaceCreate({ ...base, inviteDomains: ['*.example.com'] })).toEqual(INVALID)
    expect(checkWorkspaceCreate({ ...base, inviteDomains: ['exa mple.com'] })).toEqual(INVALID)
    expect(checkWorkspaceCreate({ ...base, inviteDomains: ['http://example.com/x'] })).toEqual(INVALID)
    expect(checkWorkspaceCreate({ ...base, inviteDomains: 'example.com' })).toEqual(INVALID)          // 목록이어야 한다(폼이 나눠 보낸다)
    expect(checkWorkspaceCreate({ ...base, inviteDomains: [42] })).toEqual(INVALID)
    expect(checkWorkspaceCreate({ ...base, inviteDomains: Array.from({ length: 51 }, (_, i) => `d${i}.example.com`) })).toEqual(INVALID)
  })
  it('객체가 아니면 거부', () => {
    for (const raw of [null, undefined, 'x', 3, []]) expect(checkWorkspaceCreate(raw)).toEqual({ ok: false, code: 'input_invalid', field: null })
  })
})

describe('생성 폼의 도메인 입력 도우미', () => {
  it('splitDomainsInput — 쉼표·공백·줄바꿈으로 나누고 빈 조각을 버린다', () => {
    expect(splitDomainsInput(' example.com, partner.co.kr\n  third.org ,, ')).toEqual(['example.com', 'partner.co.kr', 'third.org'])
    expect(splitDomainsInput('   ')).toEqual([])
  })
  it('suggestedInviteDomain — 첫 관리자 이메일의 도메인(정규형), 형식이 아니면 null', () => {
    expect(suggestedInviteDomain(' Owner@Example.COM ')).toBe('example.com')
    expect(suggestedInviteDomain('owner@')).toBeNull()
    expect(suggestedInviteDomain('')).toBeNull()
    expect(suggestedInviteDomain('not-an-email')).toBeNull()
  })
})
