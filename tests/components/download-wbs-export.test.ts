// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { downloadWbsExport, exportFailureKey } from '@/components/import/downloadWbsExport'

// 설정 화면(접기)과 마법사 완료 화면(펼침)이 같이 쓰는 내보내기 다운로드. <a href> 로 받으면 409·422·400 JSON 이 탭에
// 날것으로 떴다 — fetch 로 받아 실패 본문의 error 를 호출부(토스트)에 돌려준다.
beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('200 이면 ok 이고 filename* 에서 푼 이름으로 내려받는다', async () => {
  const filename = 'WBS_Acme_2026-09-27.xlsx'
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'Content-Disposition': `attachment; filename="wbs_export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}` },
  }))
  vi.stubGlobal('fetch', fetchMock)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.download).toBe(filename)
    expect(this.href).toBe('blob:x')
  })
  expect(await downloadWbsExport('p1', { expand: false })).toEqual({ ok: true })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/export?projectId=p1')
  expect(click).toHaveBeenCalledTimes(1)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x')
  expect(document.querySelector('a[download]')).toBeNull() // 임시 링크는 치운다
})

it('409 면 본문의 error·code 를 돌려주고 파일을 만들지 않는다(옛 서버처럼 code 가 없으면 null)', async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ error: 'X', code: 'PROFILE_REQUIRED' }), { status: 409 }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await downloadWbsExport('p1', { expand: true })).toEqual({ ok: false, error: 'X', status: 409, code: 'PROFILE_REQUIRED' })
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'X' }), { status: 409 }))
  expect(await downloadWbsExport('p1', { expand: true })).toEqual({ ok: false, error: 'X', status: 409, code: null })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/export?projectId=p1&expand=1')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('JSON 이 아닌 500 이면 error 는 null — 파일을 만들지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn<(url: string) => Promise<Response>>(async () => new Response('<html>Internal Server Error</html>', { status: 500 })))
  expect(await downloadWbsExport('p1', { expand: false })).toEqual({ ok: false, error: null, status: 500, code: null })
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('expand 는 쿼리의 &expand=1 로만 갈리고 projectId 는 인코딩한다', async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ error: 'Y' }), { status: 422 }))
  vi.stubGlobal('fetch', fetchMock)
  await downloadWbsExport('p 1&x', { expand: true })
  await downloadWbsExport('p 1&x', { expand: false })
  expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
    '/api/export?projectId=p%201%26x&expand=1',
    '/api/export?projectId=p%201%26x',
  ])
})

// 실패 토스트의 설명은 서버 본문(한국어)을 그대로 쓰지 않고 상태 코드로 사전 키를 고른다(최종 리뷰 UI M-1).
it('exportFailureKey — 422·400 은 사전 키, 400 은 호출부(접기·펼침)로 갈린다, 409·PROFILE_REQUIRED 는 더 없다 — 그 밖은 null(제목만)', () => {
  expect(exportFailureKey(409, true)).toBeNull()
  expect(exportFailureKey(422, false)).toBe('settings.exportErrProfileCorrupt')
  expect(exportFailureKey(422, true)).toBe('settings.exportErrProfileCorrupt')
  expect(exportFailureKey(400, false)).toBe('settings.exportErrProfileTooDeep')
  expect(exportFailureKey(400, true)).toBe('importWizard.exportProfileUnsupported')
  for (const s of [401, 403, 404, null]) expect(exportFailureKey(s, false)).toBeNull()
})

// A2-2 리뷰 정확성 P3(U5) — 팀 원천 실패(503 TEAMS_UNAVAILABLE)·설정 조회 실패(503)·표준 빌더 결함(500)은 제목만 떠 재시도해도 되는지 몰랐다
it('exportFailureKey — TEAMS_UNAVAILABLE·5xx 는 "잠시 후 다시" 안내(접기·펼침 같다)', () => {
  for (const expand of [false, true]) {
    expect(exportFailureKey(503, expand, 'TEAMS_UNAVAILABLE')).toBe('settings.exportErrRetry')
    expect(exportFailureKey(503, expand)).toBe('settings.exportErrRetry')
    expect(exportFailureKey(500, expand)).toBe('settings.exportErrRetry')
  }
  expect(exportFailureKey(503, false, 'SOMETHING_NEW')).toBeNull()   // 모르는 code 는 그대로 추측하지 않는다
})

// 같은 422·409 가 단계 이름 손상·부재(과제 27)와 양식 손상·부재 두 뜻을 갖게 됐다 — 상태 코드만 보면 정상 양식을 비우라는
// 틀린 처방이 나간다(최종 리뷰 FN-7). 본문의 code 를 먼저 보고, code 가 없으면(옛 서버) 상태 코드로 고른다.
it('exportFailureKey — code 가 CONFIG_INVALID·CONFIG_REQUIRED 면 단계 이름 안내, PROFILE_CORRUPT 는 양식 안내, 모르는 code(PROFILE_REQUIRED 포함)는 null', () => {
  expect(exportFailureKey(422, false, 'CONFIG_INVALID')).toBe('settings.exportErrLevelLabels')
  expect(exportFailureKey(422, false, 'CONFIG_INVALID')).not.toBe('settings.exportErrProfileCorrupt')
  expect(exportFailureKey(409, true, 'CONFIG_REQUIRED')).toBe('settings.exportErrLevelLabels')
  expect(exportFailureKey(409, false, 'CONFIG_REQUIRED')).toBe('settings.exportErrLevelLabels')
  expect(exportFailureKey(422, true, 'PROFILE_CORRUPT')).toBe('settings.exportErrProfileCorrupt')
  expect(exportFailureKey(409, true, 'PROFILE_REQUIRED')).toBeNull()   // 409·PROFILE_REQUIRED 는 더 없다(SP4 §4.3) — 모르는 code
  expect(exportFailureKey(422, false, 'SOMETHING_NEW')).toBeNull()
  expect(exportFailureKey(422, false, null)).toBe('settings.exportErrProfileCorrupt')
})

// 오프라인 등으로 fetch 가 던지면(최종 리뷰 UI m-4) 거부가 호출부 밖으로 새어 토스트 없이 끝났다 — 같은 실패 모양으로 돌려준다.
it('fetch 가 던지면 ok:false(error·status null) — 던지지 않고 파일도 만들지 않는다', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  await expect(downloadWbsExport('p1', { expand: false })).resolves.toEqual({ ok: false, error: null, status: null, code: null })
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(err).toHaveBeenCalled()
})
