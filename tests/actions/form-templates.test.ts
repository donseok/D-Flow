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

import { activateFormTemplate, deactivateFormTemplate, prepareFormTemplateUpload, registerFormTemplate } from '@/app/actions/formTemplates'

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


function storedZip(files: { name: string; data: string }[]): Uint8Array {
  const locals: Buffer[] = []
  const cds: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name)
    const data = Buffer.from(f.data)
    const local = Buffer.alloc(30 + name.length + data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    data.copy(local, 30 + name.length)
    locals.push(local)
    const cd = Buffer.alloc(46 + name.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(name.length, 28)
    cd.writeUInt32LE(offset, 42)
    name.copy(cd, 46)
    cds.push(cd)
    offset += local.length
  }
  const cdSize = cds.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...cds, eocd])
}

const pptxBytes = () => storedZip([
  { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>' },
  { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
])

describe('registerFormTemplate', () => {
  const incoming = `ws/ws-1/p/${P}/weekly_report_pptx/incoming/${T}.pptx`

  it('패키지가 맞으면 스캔 결과를 담은 비활성 행을 v<n> 에 넣는다', async () => {
    const moved: string[] = []
    const inserted: { version?: number; active?: boolean; placeholders?: { tokenScan?: boolean; engineVersion?: string; placeholders?: unknown[] }; uploaded_by?: string; storage_path?: string }[] = []
    h.adminFor.mockImplementation(() => ({
      admin: {
        storage: { from: () => ({
          info: async () => ({ data: { created_at: new Date().toISOString() }, error: null }),
          download: async () => ({ data: pptxBytes(), error: null }),
          move: async (from: string, to: string) => { moved.push(`${from} -> ${to}`); return { data: {}, error: null } },
          remove: async () => ({ data: [], error: null }),
        }) },
        from: () => ({
          select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: { version: 2 }, error: null }) }) }) }) }) }),
          insert: (row: typeof inserted[number]) => ({ select: () => ({ single: async () => { inserted.push(row); return { data: { id: row }, error: null } } }) }),
        }),
      },
    }))
    const r = await registerFormTemplate(P, 'weekly_report_pptx', incoming, 'Weekly.PPTX')
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'weekly')
    expect(r).toMatchObject({ ok: true, version: 3, path: `ws/ws-1/p/${P}/weekly_report_pptx/v3.pptx`, warnings: [] })
    expect(moved).toEqual([`${incoming} -> ws/ws-1/p/${P}/weekly_report_pptx/v3.pptx`])
    expect(inserted[0]).toMatchObject({ active: false, uploaded_by: 'u-admin', version: 3, placeholders: { engineVersion: 'forms-engine.v1', format: 'pptx', placeholders: [], issues: [] } })
    expect(inserted[0].placeholders).not.toHaveProperty('tokenScan')
  })

  it('DRM·만료 파일은 행을 만들지 않고 incoming 을 지운다', async () => {
    const removed: string[][] = []
    const download = vi.fn(async () => ({ data: Uint8Array.from([1, 2, 3, 4]), error: null }))
    h.adminFor.mockImplementation(() => ({
      admin: {
        storage: { from: () => ({
          info: async () => ({ data: { created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() }, error: null }),
          download, remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null } },
          move: async () => ({ data: null, error: null }),
        }) },
        from: () => { throw new Error('db') },
      },
    }))
    expect(await registerFormTemplate(P, 'weekly_report_pptx', incoming, 'a.pptx')).toMatchObject({ ok: false, code: 'FORM_GONE' })
    expect(removed).toEqual([[incoming]])
    expect(download).not.toHaveBeenCalled()

    removed.length = 0
    h.adminFor.mockImplementation(() => ({
      admin: {
        storage: { from: () => ({
          info: async () => ({ data: { created_at: new Date().toISOString() }, error: null }),
          download: async () => ({ data: Uint8Array.from([1, 2, 3, 4]), error: null }),
          remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null } },
          move: async () => ({ data: null, error: null }),
        }) },
        from: () => { throw new Error('db') },
      },
    }))
    expect(await registerFormTemplate(P, 'weekly_report_pptx', incoming, 'a.pptx')).toMatchObject({ ok: false, code: 'PROTECTED' })
    expect(removed).toEqual([[incoming]])
  })

  it('다른 종류는 그 모듈을 묻고, 관리자 거부와 모듈 끄기는 스토리지에 닿지 않는다', async () => {
    expect(await registerFormTemplate(P, 'issue_analysis_pptx', 'nope', 'a.pptx')).toMatchObject({ ok: false })
    expect(requireModule).toHaveBeenCalledWith({ projectId: P }, 'issue_analysis')
    h.guard.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await registerFormTemplate(P, 'weekly_report_pptx', incoming, 'a.pptx')).toMatchObject({ ok: false, error: '권한 없음' })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: '모듈이 꺼져 있습니다.' })
    h.guard.mockResolvedValue({ ok: true, actor })
    expect(await registerFormTemplate(P, 'weekly_report_pptx', incoming, 'a.pptx')).toMatchObject({ ok: false, error: '모듈이 꺼져 있습니다.' })
    expect(h.adminFor).not.toHaveBeenCalled()
  })

  it('자리표시자 문법 오류면 행 없이 incoming 을 지운다', async () => {
    const removed: string[][] = []
    const slide = `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/></p:nvSpPr><p:txBody><a:p><a:r><a:t>{{BAD}}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
    h.adminFor.mockImplementation(() => ({
      admin: {
        storage: { from: () => ({
          info: async () => ({ data: { created_at: new Date().toISOString() }, error: null }),
          download: async () => ({ data: storedZip([
            { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>' },
            { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
            { name: 'ppt/slides/slide1.xml', data: slide },
          ]), error: null }),
          remove: async (paths: string[]) => { removed.push(paths); return { data: [], error: null } },
          move: async () => ({ data: {}, error: null }),
        }) },
        from: () => { throw new Error('no row') },
      },
    }))
    expect(await registerFormTemplate(P, 'weekly_report_pptx', incoming, 'a.pptx')).toMatchObject({ ok: false, code: 'FORM_SCAN' })
    expect(removed).toEqual([[incoming]])
  })
})
