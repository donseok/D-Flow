import { beforeEach, describe, expect, it, vi } from 'vitest'

// Task 1b — 리뷰어 실측(Task 1 리뷰) 시나리오의 회귀 고정. 완료 화면의 펼침 내보내기는 계층 다음에 '세부업무' 열을 끼워
// 논리·팀 열을 +1 밀고, 양식 밖 팀(팀B)을 끝에 붙인다. 그 파일을 저장 양식으로 다시 읽으면 산출물·시작=null,
// 종료=시작일, 실적%=날짜 일련값, 담당=[] 이 되어 틀린 값이 쓰였다. 이제 inspect 가 불일치를 알리고, 마법사는 감지 결과로
// 시작하며, 저장 양식을 확인 없이 보내면 execute 가 409 로 막는다. 엑셀 모듈(export·detect·parse·link)은 실물이다.
// SP4: execute 는 명령 id 를 받고 import_wbs_cmd(service_role RPC)로 쓴다 — 팀은 요청 범위 원천, 영수증 선확인은 세션(§4.4).
const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  getProjectConfig: vi.fn(),
  rpc: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/teams/register', () => ({ ensureProjectTeams: vi.fn() }))
// 혼합 프로젝트의 공용 팀 참조 판정(Z4) — 이 파일은 그 경우를 보지 않는다: 참조 없음
vi.mock('@/lib/teams/referencedCommon', () => ({ referencedCommonTeamCodes: async () => new Map<string, string>() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    // 영수증 선확인 — 이 시나리오의 명령은 처음이다(append 라 백업을 읽지 않는다)
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = async () => ({ data: null, error: null })
      return q
    },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ rpc: mocks.rpc })) }))
vi.mock('@/lib/settings/write', () => ({ writeProjectSettingsInternal: vi.fn() }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn(async () => undefined) }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { writeProjectSettingsInternal } from '@/lib/settings/write'
import { projectOwnTeams, projectTeams } from '@/lib/teams/source'
import { POST as inspect } from '@/app/api/import/inspect/route'
import { POST as execute } from '@/app/api/import/execute/route'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { buildWorkbookWithProfile } from '@/lib/excel/exportWithProfile'
import { computeTree } from '@/lib/domain/rollup'
import { teamOrderMap, type Team } from '@/lib/domain/teams'
import { initialWizardState, reducer } from '@/lib/domain/importWizard'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { ImportItem } from '@/lib/excel/validate'
import type { WbsRow } from '@/lib/domain/types'
import { makeActor, WS } from '../fixtures/actor'
import { calUtcSun } from '../helpers/calendarFixture'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const COMMAND_ID = '55555555-5555-4555-8555-555555555555'
const SAVED: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
}
/** 이 프로젝트의 전용 팀 — 파일의 두 팀(대조를 통과한다) */
const TEAMS: Team[] = ['팀A', '팀B'].map((code, i) => ({
  id: `own-${i}`, code, name: code, color: '#6b7280', sortOrder: i, active: true, progressVisible: true, projectId: PROJECT_ID, workspaceId: WS,
}))
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
], '2026-07-02', calUtcSun, { subActTeamOrder: teamOrderMap(['팀A', '팀B']) })

const built = buildWorkbookWithProfile(items, SAVED, [], { expandSubActs: true, levelLabels: [] }, 'Acme')
if (!built.ok) throw new Error(built.error)
const FILE = new Blob([built.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

function req(fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof execute>[0]
}
const executeWith = (profile: ExcelProfile, extra: Record<string, string> = {}) => execute(req({
  file: FILE, projectId: PROJECT_ID, profile: JSON.stringify(profile), mode: 'append', saveProfile: 'false', registerTeams: 'false',
  commandId: COMMAND_ID, ...extra,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor() })
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'], 'wbs.excel_profile': SAVED }))
  vi.mocked(projectTeams).mockResolvedValue(TEAMS)
  vi.mocked(projectOwnTeams).mockResolvedValue(TEAMS)
  mocks.rpc.mockResolvedValue({ data: { status: 'applied', mode: 'append', count: 2, command_id: COMMAND_ID }, error: null })
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
    expect(mocks.rpc.mock.calls[0][0]).toBe('import_wbs_cmd')
    const sent = mocks.rpc.mock.calls[0][1].p_items as ImportItem[]
    const task = sent.find(i => i.name === '착수')!
    expect(task).toMatchObject({ deliverable: '계획서', plannedStart: '2026-07-01', plannedEnd: '2026-07-03' })
    // 두 팀 담당이라 splitLeafOwners 가 팀별 sub-act 로 나눈다 — 담당·실적은 트리 전체에서 본다.
    expect(new Set(sent.flatMap(i => i.owners.map(o => o.team)))).toEqual(new Set(['팀A', '팀B']))
    expect(sent.every(i => i.actualPct == null || i.actualPct <= 100)).toBe(true)
    expect(sent.some(i => i.actualPct === 40)).toBe(true)
  })

  it('마법사 기본값으로 실행하면 감지 양식이 저장 양식을 덮어쓰지 않는다(불일치 → 양식 저장 기본 꺼짐)', async () => {
    const body = await (await inspect(req({ file: FILE, projectId: PROJECT_ID }))).json()
    const state = reducer(initialWizardState, { type: 'inspectSuccess', detection: body.detection, savedProfile: body.savedProfile })
    const res = await executeWith(state.profile!, { saveProfile: String(state.saveProfile) })
    expect(res.status).toBe(200)
    expect((await res.json()).profileSaved).toBe(false)
    expect(writeProjectSettingsInternal).not.toHaveBeenCalled()   // 양식 저장의 유일한 경로
  })
})
