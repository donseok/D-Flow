// 외부 업로드의 자동 편철 판독(minutes.auto_file_by_path — lib/minutes/autoFile.ts).
// 우선순위: 배포 env 명시 false(전체 끔) → 그 프로젝트의 설정 값(기본 true) → 프로젝트 없는 회의록은 제품 기본값.
// 판독 실패는 추측하지 않고({ ok: false }), 손상 값은 편철하지 않는 쪽으로 간다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
// externalApi 는 AI·위키 후처리까지 끌고 온다 — 이 스위트가 보는 것은 차단 스위치(env) 하나다
vi.mock('@/lib/minutes/externalApi', () => ({ folderPathKillSwitch: () => process.env.MINUTES_FOLDER_PATH_ENABLED === 'false' }))

import { AUTO_FILE_BY_PATH_DEFAULT, loadAutoFileByPath } from '@/lib/minutes/autoFile'
import { settingDef } from '@/lib/settings/registry'

const P_A = '00000000-0000-4000-8000-0000000000a1'
const P_B = '00000000-0000-4000-8000-0000000000b1'
const KEY = 'minutes.auto_file_by_path'
type State = { status: 'set' | 'default'; value: boolean } | { status: 'invalid'; error: string }
const cfg = (projectId: string, state: State, over: Record<string, unknown> = {}) => ({ projectId, schemaAhead: false, keys: { [KEY]: state }, ...over })

beforeEach(() => { h.getProjectConfig.mockReset(); vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', '') })
afterEach(() => { vi.unstubAllEnvs() })

describe('정의 — minutes.auto_file_by_path', () => {
  it('프로젝트 스코프·minutes 모듈·기본 true·이후 업로드부터(future_only), 참/거짓만 받는다', () => {
    const def = settingDef('project', KEY)!
    expect(def).toMatchObject({ scope: 'project', module: 'minutes', default: true, editor: 'project_admin', apply: 'immediate', impact: ['future_only'], sql: null, widget: { kind: 'boolean' } })
    expect(def.parse(false)).toEqual({ ok: true, value: false })
    expect(def.parse(true)).toEqual({ ok: true, value: true })
    for (const bad of ['true', 1, null, undefined, {}]) expect(def.parse(bad).ok, String(bad)).toBe(false)
    expect(settingDef('workspace', KEY)).toBeUndefined()
    expect(AUTO_FILE_BY_PATH_DEFAULT).toBe(def.default)
  })
})

describe('loadAutoFileByPath', () => {
  it('저장값·기본값을 그대로 돌려준다 — 넘긴 읽기 클라이언트로 그 프로젝트의 설정을 읽는다', async () => {
    const client = { from: vi.fn() }
    h.getProjectConfig.mockResolvedValueOnce(cfg(P_A, { status: 'set', value: false }))
    expect(await loadAutoFileByPath(P_A, { client: client as never })).toEqual({ ok: true, value: false })
    expect(h.getProjectConfig).toHaveBeenCalledWith(P_A, { client })
    h.getProjectConfig.mockResolvedValueOnce(cfg(P_A, { status: 'default', value: true }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: true, value: true })
  })

  it('격리 — 한 프로젝트가 꺼도 다른 프로젝트는 자기 값(켬)이다', async () => {
    h.getProjectConfig.mockImplementation(async (pid: string) => cfg(pid, pid === P_A ? { status: 'set', value: false } : { status: 'default', value: true }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: true, value: false })
    expect(await loadAutoFileByPath(P_B)).toEqual({ ok: true, value: true })
  })

  it('프로젝트 없는 회의록은 설정을 읽지 않고 제품 기본값(켬)', async () => {
    expect(await loadAutoFileByPath(null)).toEqual({ ok: true, value: true })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })

  it('env 가 명시 false 면 설정을 읽지도 않고 끈다 — 프로젝트가 있든 없든', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: true, value: false })
    expect(await loadAutoFileByPath(null)).toEqual({ ok: true, value: false })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })

  it.each(['true', '', '1', 'FALSE', 'off'])('env %j 는 차단이 아니다 — 설정을 따른다(정확히 false 만 끈다)', async (value) => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', value)
    h.getProjectConfig.mockResolvedValue(cfg(P_A, { status: 'set', value: false }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: true, value: false })
    h.getProjectConfig.mockResolvedValue(cfg(P_A, { status: 'default', value: true }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: true, value: true })
  })

  it('손상된 값은 편철하지 않는 쪽으로(false) — 기본값(켬)으로 되살리지 않는다. 로그를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getProjectConfig.mockResolvedValueOnce(cfg(P_A, { status: 'invalid', error: '참/거짓이어야 합니다.' }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: true, value: false })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('판독 실패·다른 프로젝트의 문서·앞선 세대는 { ok: false } — 편철 여부를 추측하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getProjectConfig.mockRejectedValueOnce(new Error('프로젝트 설정 조회 실패: boom'))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: false })
    h.getProjectConfig.mockResolvedValueOnce(cfg(P_B, { status: 'set', value: true }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: false })
    h.getProjectConfig.mockResolvedValueOnce(cfg(P_A, { status: 'set', value: true }, { schemaAhead: true }))
    expect(await loadAutoFileByPath(P_A)).toEqual({ ok: false })
    spy.mockRestore()
  })
})
