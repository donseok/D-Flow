import { beforeEach, describe, expect, it, vi } from 'vitest'

// Task 1b — 리뷰어 실측(Task 1 리뷰) 시나리오의 회귀 고정. 완료 화면의 펼침 내보내기는 계층 다음에 '세부업무' 열을 끼워
// 논리·팀 열을 +1 밀고, 양식 밖 팀(팀B)을 끝에 붙인다. 그 파일을 저장 양식으로 다시 읽으면 산출물·시작=null,
// 종료=시작일, 실적%=날짜 일련값, 담당=[] 이 되어 틀린 값이 쓰였다. 이제 inspect 가 불일치를 알리고, 마법사는 감지 결과로
// 시작하며, 저장 양식을 확인 없이 보내면 execute 가 409 로 막는다. 엑셀 모듈(export·detect·parse·link)은 실물이다.
const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  getProjectConfig: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin, requireWorkspaceAdmin: vi.fn() }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/teams/master', () => ({
  projectTeamRowsSync: vi.fn(() => [{ code: '팀A' }, { code: '팀B' }]),
  teamsForProjectSync: vi.fn(() => [{ code: '팀A' }, { code: '팀B' }]),
}))
vi.mock('@/app/actions/teams', () => ({ addTeam: vi.fn() }))
vi.mock('@/app/actions/projectTeams', () => ({ addProjectTeam: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({ rpc: mocks.rpc })) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { POST as inspect } from '@/app/api/import/inspect/route'
import { POST as execute } from '@/app/api/import/execute/route'
import { buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap } from '@/lib/domain/teams'
import { initialWizardState, reducer } from '@/lib/domain/importWizard'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ImportItem } from '@/lib/excel/validate'
import type { WbsRow } from '@/lib/domain/types'
import { makeActor } from '../fixtures/actor'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const SAVED: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const row = (over: Partial<WbsRow>): WbsRow => ({
  id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x',
  biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [], isOwnerSplit: false, ...over,
})
const items = computeTree([
  row({ id: 'P', parentId: null, code: '1', sortOrder: 0, name: '준비' }),
  row({ id: 'T', parentId: 'P', code: '1.1', sortOrder: 1, name: '착수', deliverable: '계획서',
    plannedStart: '2026-07-01', plannedEnd: '2026-07-03', actualPct: 40,
    owners: [{ team: '팀A', kind: 'primary' }, { team: '팀B', kind: 'support' }] }),
], '2026-07-02', new Set(), { subActTeamOrder: teamOrderMap(['팀A', '팀B']) })

const built = buildWorkbookWithProfile(items, SAVED, [], { expandSubActs: true }, 'Acme')
if (!built.ok) throw new Error(built.error)
const FILE = new Blob([built.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

function req(fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof execute>[0]
}
const executeWith = (profile: ExcelProfile, extra: Record<string, string> = {}) => execute(req({
  file: FILE, projectId: PROJECT_ID, profile: JSON.stringify(profile), mode: 'append', saveProfile: 'false', registerTeams: 'false', ...extra,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor() })
  mocks.getProjectConfig.mockResolvedValue({ levelLabels: ['단계', '작업'], excelProfile: SAVED })
  mocks.rpc.mockResolvedValue({ data: 2, error: null })
})

describe('펼침 내보내기 → 저장 양식이 있는 프로젝트로 재임포트', () => {
  it('inspect 가 밀린 열·양식 밖 팀을 알리고, 마법사는 감지 결과로 시작한다', async () => {
    const body = await (await inspect(req({ file: FILE, projectId: PROJECT_ID }))).json()
    expect(body.profileMismatch).toEqual({
      fields: ['deliverable', 'start', 'end', 'actualPct', 'teamColumns'], extraTeams: ['팀B'], missingTeams: [],
    })
    const state = reducer(initialWizardState, { type: 'inspectSuccess', detection: body.detection, savedProfile: body.savedProfile })
    expect(state.profileSource).toBe('detected')
    expect(state.profile).toEqual(body.detection.profile)
  })

  it('저장 양식을 확인 없이 보내면 409 — RPC 에 닿지 않아 틀린 값이 쓰이지 않는다', async () => {
    const res = await executeWith(SAVED)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PROFILE_MISMATCH')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('마법사 기본값(감지 결과)으로 실행하면 산출물·일정·실적·두 팀 담당이 제 값으로 들어간다', async () => {
    const body = await (await inspect(req({ file: FILE, projectId: PROJECT_ID }))).json()
    const state = reducer(initialWizardState, { type: 'inspectSuccess', detection: body.detection, savedProfile: body.savedProfile })
    const res = await executeWith(state.profile!)
    expect(res.status).toBe(200)
    const sent = mocks.rpc.mock.calls[0][1].p_items as ImportItem[]
    const task = sent.find(i => i.name === '착수')!
    expect(task).toMatchObject({ deliverable: '계획서', plannedStart: '2026-07-01', plannedEnd: '2026-07-03' })
    // 두 팀 담당이라 splitLeafOwners 가 팀별 sub-act 로 나눈다 — 담당·실적은 트리 전체에서 본다.
    expect(new Set(sent.flatMap(i => i.owners.map(o => o.team)))).toEqual(new Set(['팀A', '팀B']))
    expect(sent.every(i => i.actualPct == null || i.actualPct <= 100)).toBe(true)
    expect(sent.some(i => i.actualPct === 40)).toBe(true)
  })
})
