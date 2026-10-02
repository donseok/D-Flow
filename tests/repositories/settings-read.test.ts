import { describe, expect, it, vi } from 'vitest'

// 봇 저장소의 getProjectConfig 는 화면과 같은 해석기를 감싼다(R8) — 해석기 자체는 tests/settings 가 본다.
const resolver = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: resolver.getProjectConfig }))

import { createSupabaseProjectSettingsRepository } from '@/lib/repositories/supabase/settings'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { keysetTable } from '../helpers/keysetTable'

type QueryResponse = { data: unknown; error: unknown; count?: number | null }

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  for (const method of ['insert', 'upsert', 'update', 'delete', 'rpc']) {
    builder[method] = vi.fn(() => { throw new Error(`write attempted: ${method}`) })
  }
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject)
  return builder
}

function healthyBuilders(overrides: Partial<Record<string, QueryResponse>> = {}) {
  const responses: Record<string, QueryResponse> = {
    projects: {
      data: {
        id: 'p1', name: 'Acme 구축', start_date: '2026-01-05', end_date: '2026-12-31',
        base_date: '2026-07-18',
      },
      error: null,
    },
    // 휴일은 달력 로더(키셋 끝까지 + kind — SP5 A 과제 13)가 읽는다 — 아래 from 이 keysetTable 로 흉내 낸다
    holidays: { data: [{ date: '2026-08-15', name: null, kind: 'off' }, { date: '2026-10-03', name: null, kind: 'off' }], error: null },
    wbs_items: { data: null, error: null, count: 120 },
    project_members: { data: null, error: null, count: 14 },
    ...overrides,
  }
  const builders: Record<string, ReturnType<typeof queryBuilder>> = {}
  const hr = responses.holidays as QueryResponse
  const holidays = hr.error
    ? keysetTable([], { error: { message: String((hr.error as { code?: string }).code ?? 'error') } })
    : keysetTable(((hr.data ?? []) as Record<string, unknown>[]).map((r) => ({ project_id: 'p1', ...r })))
  const from = vi.fn((table: string) => {
    if (table === 'holidays') return holidays.make()
    const response = responses[table]
    if (!response) throw new Error(`unexpected table: ${table}`)
    builders[table] ??= queryBuilder(response)
    return builders[table]
  })
  return { from, builders, holidays }
}

describe('strict Supabase project settings repository', () => {
  it('maps project, holidays, and head counts without selecting any secret-shaped column', async () => {
    const { from, builders, holidays } = healthyBuilders()
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    const result = await repository.getSafeSettings('p1')
    expect(result).toEqual({
      ok: true,
      data: {
        projectId: 'p1',
        name: 'Acme 구축',
        startDate: '2026-01-05',
        endDate: '2026-12-31',
        baseDate: '2026-07-18',
        holidays: ['2026-08-15', '2026-10-03'],
        workDates: [],
        wbsItemCount: 120,
        memberCount: 14,
      },
    })
    const projectSelect = builders.projects.select as ReturnType<typeof vi.fn>
    expect(String(projectSelect.mock.calls[0][0])).not.toMatch(/email|key|secret|token|env|account/i)
    // projects 에는 updated_at 열이 없다(E30) — 고르면 조회 전체가 실패한다
    expect(String(projectSelect.mock.calls[0][0])).not.toContain('updated_at')
    expect(builders.projects.eq).toHaveBeenCalledWith('id', 'p1')
    expect(builders.wbs_items.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(builders.project_members.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(builders.wbs_items.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(builders.project_members.eq).toHaveBeenCalledWith('project_id', 'p1')
    expect(holidays.log[0]).toEqual(expect.arrayContaining([
      { method: 'eq', args: ['project_id', 'p1'] }, { method: 'select', args: ['date, name, kind', { count: 'exact' }] },
    ]))
    // 반환 계약에도 키·계정·환경변수 형태의 값이 존재하지 않는다.
    expect(JSON.stringify(result)).not.toMatch(/email|file_path|signed|secret|token|env/i)
    for (const builder of Object.values(builders)) {
      for (const method of ['insert', 'upsert', 'update', 'delete']) {
        expect(builder[method]).not.toHaveBeenCalled()
      }
    }
  })

  it('keeps an invisible project as a successful null, not an error', async () => {
    const { from } = healthyBuilders({ projects: { data: null, error: null } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({ ok: true, data: null })
  })

  it('keeps a project with zero holidays, items, and members as a valid snapshot', async () => {
    const { from } = healthyBuilders({
      holidays: { data: [], error: null },
      wbs_items: { data: null, error: null, count: 0 },
      project_members: { data: null, error: null, count: 0 },
    })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toMatchObject({
      ok: true,
      data: { holidays: [], wbsItemCount: 0, memberCount: 0 },
    })
  })

  it('surfaces a project body failure as retryable PROJECT_SETTINGS_READ_FAILED', async () => {
    const { from } = healthyBuilders({ projects: { data: null, error: { code: '08006' } } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_READ_FAILED',
      retryable: true,
    })
  })

  it('keeps a holiday query failure distinct from an empty holiday list', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { from } = healthyBuilders({ holidays: { data: null, error: { code: '42P01' } } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    // 달력 로더의 실패(ConfigUnavailableError)는 재시도 가능으로 낸다 — 원문(코드)은 로그에만(SP5 A 과제 13)
    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_HOLIDAYS_READ_FAILED',
      retryable: true,
    })
    err.mockRestore()
  })

  it('splits off days from specific working days (kind) — a work row is not a holiday', async () => {
    const { from } = healthyBuilders({ holidays: { data: [
      { date: '2026-08-15', name: '휴무', kind: 'off' }, { date: '2026-08-22', name: null, kind: 'work' },
    ], error: null } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toMatchObject({
      ok: true, data: { holidays: ['2026-08-15'], workDates: ['2026-08-22'] },
    })
  })

  it('surfaces a head-count query failure as PROJECT_SETTINGS_COUNTS_READ_FAILED', async () => {
    const { from } = healthyBuilders({ project_members: { data: null, error: { code: '08006' } } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_COUNTS_READ_FAILED',
      retryable: true,
    })
  })

  it('never disguises a missing count as zero rows', async () => {
    const { from } = healthyBuilders({ wbs_items: { data: null, error: null, count: null } })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    await expect(repository.getSafeSettings('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_COUNTS_READ_FAILED',
      retryable: false,
    })
  })

  it('rejects a project row whose id widens the requested scope', async () => {
    const { from } = healthyBuilders({
      projects: {
        data: {
          id: 'p2', name: '다른 프로젝트', start_date: null, end_date: null,
          base_date: null,
        },
        error: null,
      },
    })
    const repository = createSupabaseProjectSettingsRepository({ from } as never)

    const result = await repository.getSafeSettings('p1')
    expect(result).toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_READ_FAILED',
      retryable: false,
    })
    expect(JSON.stringify(result)).not.toContain('다른 프로젝트')
  })
})

describe('project config read (getProjectConfig) — 봇 대시보드 도구의 마일스톤 키워드 출처', () => {
  it('해석기 결과를 그대로 넘기고 요청 클라이언트를 주입한다', async () => {
    const cfg = makeProjectConfig({ 'core.level_labels': ['Phase'], 'core.milestone_keywords': ['Kick-off', '논문 제출'] })
    resolver.getProjectConfig.mockResolvedValueOnce(cfg)
    const client = { from: vi.fn() }
    const repository = createSupabaseProjectSettingsRepository(client as never)

    await expect(repository.getProjectConfig('p1')).resolves.toEqual({ ok: true, data: cfg })
    expect(resolver.getProjectConfig).toHaveBeenCalledWith('p1', { client })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('해석기의 ConfigUnavailableError 는 retryable PROJECT_SETTINGS_READ_FAILED — 기본 키워드로 대신하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resolver.getProjectConfig.mockRejectedValueOnce(new ConfigUnavailableError('프로젝트 설정 조회 실패: db down'))
    const repository = createSupabaseProjectSettingsRepository({ from: vi.fn() } as never)

    await expect(repository.getProjectConfig('p1')).resolves.toEqual({
      ok: false,
      errorCode: 'PROJECT_SETTINGS_READ_FAILED',
      retryable: true,
    })
    vi.restoreAllMocks()
  })

  it('예상 밖 오류는 재시도 가능으로 위장하지 않고 던진다', async () => {
    resolver.getProjectConfig.mockRejectedValueOnce(new TypeError('bug'))
    const repository = createSupabaseProjectSettingsRepository({ from: vi.fn() } as never)
    await expect(repository.getProjectConfig('p1')).rejects.toThrow('bug')
  })
})
