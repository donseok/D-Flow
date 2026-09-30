import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { inspectBrandLogo } from '@/lib/settings/logoFile'

const h = vi.hoisted(() => ({ guard: vi.fn(), adminFor: vi.fn(), upload: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.guard }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
import { uploadBrandLogo } from '@/app/actions/branding'

const WID = '00000000-0000-4000-8000-00000000bb01'
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const jpg = Uint8Array.from([255, 216, 255, 224, 0])
const webp = Uint8Array.from([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), 0])
const file = (bytes: Uint8Array, type = 'image/svg+xml') => ({ size: bytes.byteLength, type,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }) as File

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ ok: true, actor: { userId: 'admin' } })
  h.upload.mockResolvedValue({ data: { path: 'x' }, error: null })
  h.adminFor.mockReturnValue({ admin: { storage: { from: () => ({ upload: h.upload }) } } })
})

describe('로고 파일 검증과 업로드', () => {
  it.each([
    [png, 'png', 'image/png'], [jpg, 'jpg', 'image/jpeg'], [webp, 'webp', 'image/webp'],
  ])('파일 첫 바이트로 %s 형식을 판정한다', async (bytes, ext, mime) => {
    const result = await inspectBrandLogo(WID, 'mark', file(bytes))
    expect(result).toMatchObject({ ok: true, contentType: mime, path: expect.stringMatching(new RegExp(`^ws/${WID}/branding/mark-[0-9a-f]{16}\\.${ext}$`)) })
  })
  it('SVG·알 수 없는 형식·빈 파일·256KB 초과를 거부한다', async () => {
    for (const bytes of [Buffer.from('<svg></svg>'), Uint8Array.from([1, 2, 3]), new Uint8Array(), new Uint8Array(262145)]) {
      expect((await inspectBrandLogo(WID, 'mark', file(bytes))).ok).toBe(false)
    }
  })
  it('관리자 확인 뒤 service_role 로 바이트와 판정 MIME을 올리고 경로를 돌린다', async () => {
    const result = await uploadBrandLogo(WID, 'mark', file(png))
    expect(h.guard).toHaveBeenCalledWith(WID)
    expect(h.adminFor).toHaveBeenCalledWith({ workspaceId: WID })
    expect(h.upload).toHaveBeenCalledWith(expect.stringMatching(/mark-[0-9a-f]{16}\.png$/), expect.any(Buffer), { contentType: 'image/png', upsert: true })
    expect(result).toMatchObject({ ok: true, path: expect.stringMatching(/\.png$/) })
  })
  it('권한 거부·잘못된 슬롯은 파일을 읽거나 올리지 않는다', async () => {
    const read = vi.fn(async () => png.buffer)
    h.guard.mockResolvedValueOnce({ ok: false, error: '권한 없음' })
    expect(await uploadBrandLogo(WID, 'mark', { size: 12, arrayBuffer: read } as never)).toEqual({ ok: false, error: '권한 없음' })
    expect(await uploadBrandLogo(WID, 'other' as never, { size: 12, arrayBuffer: read } as never)).toMatchObject({ ok: false })
    expect(read).not.toHaveBeenCalled()
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('업로드 실패는 경로를 성공으로 돌려주지 않는다', async () => {
    h.upload.mockResolvedValue({ data: null, error: { message: 'offline' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await uploadBrandLogo(WID, 'mark', file(png))).toMatchObject({ ok: false, error: expect.stringContaining('올리지 못했습니다') })
  })
})

describe('로고는 <img> 로만 그린다(스펙 §5.4)', () => {
  // 로고 바이트가 문서 안으로 들어가는 길을 막는다 — 업로드 검증을 통과한 이미지라도 마크업으로 풀어 넣지 않는다.
  it.each([
    'src/components/settings/LogoEditor.tsx',
    'src/components/ui/BrandMark.tsx',
    'src/app/(app)/projects/page.tsx',
  ])('%s 에 dangerouslySetInnerHTML 이 없다', (file) => {
    expect(readFileSync(file, 'utf8')).not.toContain('dangerouslySetInnerHTML')
  })
})
