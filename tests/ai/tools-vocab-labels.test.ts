import { describe, expect, it, vi } from 'vitest'
import { createGetAttendanceTool } from '@/lib/ai/tools/attendance'
import { createListMeetingsTool } from '@/lib/ai/tools/meetings'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import type { AttendanceRepository, AttendanceRepositoryRecord, MeetingRepository, ProjectMeetingSnapshot } from '@/lib/repositories/types'
import { repositoryOk } from '@/lib/repositories/types'
import { buildEvidencePack } from '@/lib/ai/chat/evidence'
import { deterministicEvidenceAnswer } from '@/lib/ai/chat/orchestrator'
import { defaultVocab } from '@/lib/settings/vocab'
import { fixedToolTeams } from '../helpers/tool-team-source'
import { fixedToolVocab } from '../helpers/tool-vocab-source'

// 근태 유형·회의 범주의 표시 이름은 그 프로젝트의 설정 어휘다 — 도구가 code 곁에 이름을 싣고, 결정적 답변(LLM 없음)은 그 이름을 보인다.
// 오케스트레이터의 고정 사본은 이름을 못 실은 결과의 폴백일 뿐이다.
const context: ToolExecutionContext = {
  userId: 'user-1', capabilities: ['meetings:read', 'attendance:read'], allowedProjectIds: ['p1'],
  pageContext: null, now: '2031-03-04T09:00:00+00:00', timezone: 'UTC',
}
const relabel = <K extends 'attendance.types' | 'meetings.categories'>(key: K, code: string, label: string) =>
  defaultVocab(key).map(e => (e.code === code ? { ...e, label } : e)) as ReturnType<typeof defaultVocab<K>>

const attendanceRepo: AttendanceRepository = {
  listRecords: vi.fn(async () => repositoryOk<AttendanceRepositoryRecord[]>([
    { id: 'a1', projectId: 'p1', memberId: 'm1', memberName: '가', teamCodes: [], date: '2031-03-04', type: 'annual' },
    { id: 'a2', projectId: 'p1', memberId: 'm2', memberName: '나', teamCodes: [], date: '2031-03-04', type: 'gone' },
  ])),
}
const meetingRepo: MeetingRepository = {
  listProjectMeetings: vi.fn(async () => repositoryOk<ProjectMeetingSnapshot>({
    meetings: [{
      id: 'm1', projectId: 'p1', title: '정기 점검', meetingDate: '2031-03-04', startTime: '10:00', endTime: '11:00', location: null,
      category: 'routine', body: '', recurrence: 'none', recurrenceUntil: null, createdBy: 'u1', createdByName: '가',
      createdAt: '2031-03-01T00:00:00Z', updatedAt: '2031-03-01T00:00:00Z', attendeeIds: [],
    }],
    exceptions: [],
  })),
  getMeetingDetail: vi.fn(),
}
const range = { projectId: 'p1', from: '2031-03-01', to: '2031-03-07' }
const pack = (tool: string, records: object[]) => buildEvidencePack([{
  callId: 'c1', tool,
  result: { status: 'ok' as const, facts: {}, records: records as Record<string, unknown>[], sources: [], asOf: context.now, truncated: false, warnings: [] },
}])

describe('도구 결과 — code 곁에 설정 어휘의 이름을 싣는다', () => {
  it('근태: typeLabel 은 그 프로젝트가 붙인 이름, 목록 밖 code 는 code 그대로. code(type)는 계약대로 남는다', async () => {
    const vocab = fixedToolVocab({ 'attendance.types': relabel('attendance.types', 'annual', '정기 휴가') })
    const r = await createGetAttendanceTool(attendanceRepo, fixedToolTeams(), vocab).execute(range, context)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.result.records.map(x => [x.type, x.typeLabel])).toEqual([['annual', '정기 휴가'], ['gone', 'gone']])
  })
  it('회의: categoryLabel 은 그 프로젝트가 붙인 이름', async () => {
    const vocab = fixedToolVocab({ 'meetings.categories': relabel('meetings.categories', 'routine', '주간 점검') })
    const r = await createListMeetingsTool(meetingRepo, vocab).execute(range, context)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.result.records[0]).toMatchObject({ category: 'routine', categoryLabel: '주간 점검' })
    expect(vocab.calls).toEqual(['p1:meetings.categories'])
  })
  it('회의: 어휘를 못 읽어도 도구는 성공한다 — 이름 없이 code 만 싣고 사유를 로그에 남긴다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await createListMeetingsTool(meetingRepo, fixedToolVocab({}, { throwOn: 'meetings.categories' })).execute(range, context)
    if (!r.ok) throw new Error(r.error.message)
    expect(r.result.records[0].category).toBe('routine')
    expect(r.result.records[0]).not.toHaveProperty('categoryLabel')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
  it('회의: 볼 수 없는 프로젝트면 어휘를 읽지 않는다', async () => {
    const vocab = fixedToolVocab()
    const r = await createListMeetingsTool(meetingRepo, vocab).execute({ ...range, projectId: 'p-other' }, context)
    expect(r.ok).toBe(false)
    expect(vocab.calls).toEqual([])
  })
})

describe('결정적 답변 — 실린 이름을 code 자리에 보인다', () => {
  it('이름이 있으면 그 이름으로, 이름 칸은 따로 나열하지 않는다', () => {
    const answer = deterministicEvidenceAnswer(pack('get_attendance', [{ memberName: '가', date: '2031-03-04', type: 'annual', typeLabel: '정기 휴가' }]), 'UTC')
    expect(answer).toContain('유형: 정기 휴가')
    expect(answer).not.toMatch(/typeLabel|연차/)
    const meeting = deterministicEvidenceAnswer(pack('list_meetings', [{ title: '정기 점검', category: 'routine', categoryLabel: '주간 점검' }]), 'UTC')
    expect(meeting).toContain('분류: 주간 점검')
    expect(meeting).not.toContain('categoryLabel')
  })
  it('이름이 없는 결과는 고정 사본으로 읽는다(폴백)', () => {
    expect(deterministicEvidenceAnswer(pack('get_attendance', [{ memberName: '가', type: 'annual' }]), 'UTC')).toContain('유형: 연차')
  })
  it('짝이 되는 code 칸이 없는 …Label 칸은 숨기지 않는다', () => {
    expect(deterministicEvidenceAnswer(pack('get_project_dashboard', [{ name: '가', scheduleLabel: 'onTrack' }]), 'UTC')).toContain('일정 판정: 정상 궤도')
  })
})
