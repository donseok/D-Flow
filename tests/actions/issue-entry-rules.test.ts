import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ context: vi.fn(), insert: vi.fn(), result: { data: { id: 'i1', code: 'RS-RND-001' }, error: null as null | { code: string; message: string } } }))
vi.mock('@/lib/issues/context', () => ({ loadIssueEntryContext: h.context }))
vi.mock('@/lib/auth', () => ({ getSession: async () => ({ id: 'user', email: 'user@example.com', user_metadata: {} }) }))
vi.mock('@/lib/authz', async () => {
  const { makeMemberActor } = await import('../fixtures/actor')
  return { requireProjectMember: async () => ({ ok: true, actor: makeMemberActor('p1', [], { userId: 'user' }) }),
    requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), getActor: vi.fn() }
})
vi.mock('@/lib/ai/minute-issue-draft', () => ({ MINUTE_ISSUE_DRAFT_SYSTEM_PROMPT: '', buildFallbackMinuteIssueDraft: vi.fn(), buildMinuteIssueDraft: vi.fn(), buildMinuteIssueDraftPrompt: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => ({ from: () => {
  const q = { insert: h.insert, select: () => q, single: async () => h.result, delete: () => q,
    eq: () => Promise.resolve({ error: null }) }
  h.insert.mockReturnValue(q)
  return q
} }) }))
import { createIssue } from '@/app/actions/issues'
import { requireModule } from '@/lib/modules/gate'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
import { ISSUE_DB_MESSAGES, ERR_ISSUE_RETRY } from '@/lib/issues/errors'
import { TEST_ISSUE_VOCAB } from '../fixtures/issue-areas'
const AREA = { id: '00000000-0000-0000-7e57-000000001bb1', code: 'RND', name: '연구', sortOrder: 1, active: true }
const input = (over: Record<string, unknown> = {}) => ({ title: '새 이슈', body: '', severity: 'medium' as const,
  startDate: null, dueDate: null, assigneeMemberIds: [], areaId: null, analysis: null, ...over })
beforeEach(() => {
  h.insert.mockReset()
  h.result = { data: { id: 'i1', code: 'RS-RND-001' }, error: null }
  h.context.mockResolvedValue({ ok: true, value: { policy: DEFAULT_ID_POLICY, rules: { areaRequired: false, analysis: 'optional' }, areas: [AREA], vocab: TEST_ISSUE_VOCAB } })
})
describe('서버 이슈 등록 규칙', () => {
  it('영역 정책인데 영역이 없으면 insert 전에 거부한다', async () => {
    h.context.mockResolvedValue({ ok: true, value: { policy: { ...DEFAULT_ID_POLICY, pattern: '{area}-{seq:3}' },
      rules: { areaRequired: true, analysis: 'off' }, areas: [AREA], vocab: TEST_ISSUE_VOCAB } })
    expect(await createIssue('p1', input())).toEqual({ ok: false, error: ISSUE_DB_MESSAGES.ISSUE_AREA_REQUIRED })
    expect(h.insert).not.toHaveBeenCalled()
  })
  it('필수 분석 없이 새로 등록할 수 없다', async () => {
    h.context.mockResolvedValue({ ok: true, value: { policy: DEFAULT_ID_POLICY, rules: { areaRequired: true, analysis: 'required' }, areas: [AREA], vocab: TEST_ISSUE_VOCAB } })
    expect(await createIssue('p1', input({ areaId: AREA.id }))).toEqual({ ok: false, error: ISSUE_DB_MESSAGES.ISSUE_ANALYSIS_REQUIRED })
  })
  it('비활성 영역은 저장 전에 거부한다', async () => {
    h.context.mockResolvedValue({ ok: true, value: { policy: DEFAULT_ID_POLICY, rules: { areaRequired: false, analysis: 'off' }, areas: [{ ...AREA, active: false }], vocab: TEST_ISSUE_VOCAB } })
    expect(await createIssue('p1', input({ areaId: AREA.id }))).toEqual({ ok: false, error: ISSUE_DB_MESSAGES.ISSUE_AREA_INACTIVE })
    expect(h.insert).not.toHaveBeenCalled()
  })
  it('문맥 조회 실패는 등록을 막는다', async () => {
    h.context.mockResolvedValue({ ok: false, error: '설정 조회 실패' })
    expect(await createIssue('p1', input())).toEqual({ ok: false, error: '설정 조회 실패' })
    expect(h.insert).not.toHaveBeenCalled()
  })
  it('분석 off는 입력 묶음을 거부하고 분석 관문도 확인한다', async () => {
    h.context.mockResolvedValue({ ok: true, value: { policy: DEFAULT_ID_POLICY, rules: { areaRequired: false, analysis: 'off' }, areas: [AREA], vocab: TEST_ISSUE_VOCAB } })
    const analysis = { majorName: '연구관리', subProcess: '실험', ownerDepartment: '연구팀', relatedSystems: [], sourceType: 'other', sourceDetail: '' }
    expect(await createIssue('p1', input({ areaId: AREA.id, analysis }))).toMatchObject({ ok: false })
    expect(vi.mocked(requireModule)).toHaveBeenCalledWith({ projectId: 'p1' }, 'issue_analysis')
    expect(h.insert).not.toHaveBeenCalled()
  })
  it('성공은 DB code이며 issueNo를 응답하지 않는다', async () => {
    expect(await createIssue('p1', input())).toEqual({ ok: true, id: 'i1', code: 'RS-RND-001' })
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ area_id: null, major_id: null, source_type: null }))
    expect(vi.mocked(requireModule)).toHaveBeenCalledWith({ projectId: 'p1' }, 'issues')
  })
  it.each(['23505', '40P01', '55P03'])('경합 %s는 원문 없는 다시 시도 문구', async code => {
    h.result.error = { code, message: 'duplicate key value violates unique constraint "issues_project_code_uidx"' }
    expect(await createIssue('p1', input())).toEqual({ ok: false, error: ERR_ISSUE_RETRY })
  })
  it.each(['ISSUE_CODE_EXHAUSTED', 'CONFIG_INVALID:calendar.timezone'])('DB 토큰 %s는 고정 문구', async message => {
    h.result.error = { code: '22023', message }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try { expect(await createIssue('p1', input())).toEqual({ ok: false, error: ISSUE_DB_MESSAGES[message.split(':')[0]] }) }
    finally { log.mockRestore() }
  })
})
