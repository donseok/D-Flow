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

it('409 면 본문의 error 를 돌려주고 파일을 만들지 않는다', async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => new Response(JSON.stringify({ error: 'X' }), { status: 409 }))
  vi.stubGlobal('fetch', fetchMock)
  expect(await downloadWbsExport('p1', { expand: true })).toEqual({ ok: false, error: 'X', status: 409 })
  expect(fetchMock.mock.calls[0][0]).toBe('/api/export?projectId=p1&expand=1')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('JSON 이 아닌 500 이면 error 는 null — 파일을 만들지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn<(url: string) => Promise<Response>>(async () => new Response('<html>Internal Server Error</html>', { status: 500 })))
  expect(await downloadWbsExport('p1', { expand: false })).toEqual({ ok: false, error: null, status: 500 })
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
it('exportFailureKey — 409·422·400 은 사전 키, 400 은 호출부(접기·펼침)로 갈린다, 그 밖은 null(제목만)', () => {
  expect(exportFailureKey(409, true)).toBe('importWizard.exportProfileNeedsSaved')
  expect(exportFailureKey(422, false)).toBe('settings.exportErrProfileCorrupt')
  expect(exportFailureKey(422, true)).toBe('settings.exportErrProfileCorrupt')
  expect(exportFailureKey(400, false)).toBe('settings.exportErrProfileTooDeep')
  expect(exportFailureKey(400, true)).toBe('importWizard.exportProfileUnsupported')
  for (const s of [401, 403, 404, 500, null]) expect(exportFailureKey(s, false)).toBeNull()
})
