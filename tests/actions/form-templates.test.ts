import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
import { makeAdminActor } from '../fixtures/actor'
import { requireModule } from '@/lib/modules/gate'

const P = '00000000-0000-0000-7e57-000000001432'
const T = '00000000-0000-0000-7e57-000000001431'
const actor = makeAdminActor(P, { userId: 'u-admin' })
const h = vi.hoisted(() => ({
  guard: vi.fn(),
  adminFor: vi.fn(),
  config: vi.fn(),
  rpc: vi.fn(),
  row: null as unknown,
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.guard }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.config }))

import { activateFormTemplate, deactivateFormTemplate, prepareFormTemplateUpload } from '@/app/actions/formTemplates'

const scan = {
  engineVersion: 'forms-engine.v1', format: 'pptx', issues: [],
  placeholders: [{ token: '{{report.project_name}}', kind: 'value', path: 'report.project_name', scope: [], location: {}, mergedRuns: false }],
}
const command = { expectedRevision: 4, commandId: T }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ ok: true, actor })
  h.row = { id: T, form_kind: 'weekly_report_pptx', placeholders: scan }
  h.rpc.mockResolvedValue({ data: { status: 'applied', revision: 5 }, error: null })
  h.adminFor.mockImplementation(() => ({
    admin: {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.row, error: null }) }) }) }),
      }),
      rpc: h.rpc,
    },
  }))
  h.config.mockResolvedValue({
    schemaAhead: false,
    keys: {
      'forms.weekly_report_pptx': { status: 'default', value: { template_id: null, mapping: {}, options: {} }, from: 'product' },
      'forms.issue_analysis_pptx': { status: 'default', value: { template_id: null, mapping: {}, options: {} }, from: 'product' },
      'fields.weekly_row': { status: 'default', value: [], from: 'product' },
      'fields.issue': { status: 'default', value: [{ key: 'cause', active: true }, { key: 'old', active: false }], from: 'product' },
    },
  })
})

describe('prepareFormTemplateUpload', () => {
  it('관리자와 모듈 뒤에서 incoming 경로를 돌려주고 파일 본문은 받지 않는다', async () => {
    const r = await prepareFormTemplateUpload(P, 'weekly_report_pptx', 'Weekly.PPTX', 1024)
    expect(h.guard).toHaveBeenCalledWith(P)
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'weekly')
    expect(r).toMatchObject({ ok: true })
    expect((r as { path: string }).path).toMatch(new RegExp(`^ws/ws-1/p/${P}/weekly_report_pptx/incoming/[0-9a-f-]{36}\\.pptx$`))
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('종류마다 그 모듈을 묻는다', async () => {
    await prepareFormTemplateUpload(P, 'issue_analysis_pptx', 'a.pptx', 1)
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'issue_analysis')
    await prepareFormTemplateUpload(P, 'wbs_export_xlsx', 'a.xlsx', FORM_MAX())
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'wbs')
  })
  it('매크로·옛 형식·크기·권한 밖은 경로를 주지 않는다', async () => {
    h.guard.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
    expect(await prepareFormTemplateUpload(P, 'weekly_report_pptx', 'a.pptx', 10)).toEqual({ ok: false, error: '권한 없음' })
    expect(requireModule).not.toHaveBeenCalled()
    for (const [kind, name, size] of [
      ['weekly_report_pptx', 'a.pptm', 10],
      ['weekly_report_xlsx', 'a.xls', 10],
      ['weekly_report_pptx', 'a.pptx', 0],
      ['weekly_report_pptx', 'a.pptx', 10_485_761],
      ['nope', 'a.pptx', 10],
    ] as const) {
      expect((await prepareFormTemplateUpload(P, kind, name, size)).ok, `${kind} ${name} ${size}`).toBe(false)
    }
  })
  it('모듈이 꺼지면 경로를 만들지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: '모듈이 꺼져 있습니다.' })
    expect(await prepareFormTemplateUpload(P, 'weekly_report_pptx', 'a.pptx', 10)).toMatchObject({ ok: false, error: '모듈이 꺼져 있습니다.' })
  })
})

function FORM_MAX() { return 10_485_760 }

describe('activateFormTemplate · deactivateFormTemplate', () => {
  it('매핑이 되면 가드의 행위자로 활성화 RPC 를 부른다', async () => {
    const r = await activateFormTemplate(P, T, command)
    expect(r).toEqual({ ok: true, status: 'applied', revision: 5 })
    expect(h.rpc).toHaveBeenCalledWith('activate_form_template', expect.objectContaining({
      p_project_id: P, p_template_id: T, p_expected_revision: 4, p_command_id: T, p_actor: 'u-admin', p_schema_version: 1,
    }))
  })
  it('미매핑이면 RPC 를 부르지 않고 토큰을 돌려준다', async () => {
    h.row = { id: T, form_kind: 'weekly_report_pptx', placeholders: {
      ...scan,
      placeholders: [...scan.placeholders, { token: '{{report.no_such}}', kind: 'value', path: 'report.no_such', scope: [], location: {}, mergedRuns: false }],
    } }
    const r = await activateFormTemplate(P, T, command)
    expect(r).toMatchObject({ ok: false, code: 'UNMAPPED', unmapped: ['{{report.no_such}}'] })
    expect(h.rpc).not.toHaveBeenCalled()
  })
  it('이슈 양식은 issue_analysis 모듈을 묻고, 활성 해제 RPC 를 부른다', async () => {
    h.row = { id: T, form_kind: 'issue_analysis_pptx', placeholders: {
      engineVersion: 'forms-engine.v1', format: 'pptx', issues: [],
      placeholders: [{ token: '{{summary.project_name}}', kind: 'value', path: 'summary.project_name', scope: [], location: {}, mergedRuns: false }],
    } }
    await deactivateFormTemplate(P, T, command)
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'issue_analysis')
    expect(h.rpc).toHaveBeenCalledWith('deactivate_form_template', expect.objectContaining({ p_actor: 'u-admin', p_template_id: T }))
  })
  it('관리자가 아니면 행을 읽지 않는다', async () => {
    h.guard.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await activateFormTemplate(P, T, command)).toMatchObject({ ok: false, error: '권한 없음' })
    expect(await deactivateFormTemplate(P, T, command)).toMatchObject({ ok: false, error: '권한 없음' })
    expect(h.adminFor).not.toHaveBeenCalled()
  })
})
