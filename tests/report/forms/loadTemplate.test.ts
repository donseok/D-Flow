import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.hoisted(() => vi.fn())
const maybeSingle = vi.hoisted(() => vi.fn())
const download = vi.hoisted(() => vi.fn())
const from = vi.hoisted(() => vi.fn())

vi.mock('fs/promises', () => ({ readFile }))
vi.mock('@/lib/supabase/adminFor', () => ({
  adminFor: () => ({ admin: { from, storage: { from: () => ({ download }) } } }),
}))

import { FormTemplateLoadError, loadFormTemplate } from '@/lib/report/forms/loadTemplate'

const TPL = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  readFile.mockReset()
  maybeSingle.mockReset()
  download.mockReset()
  from.mockReset()
  from.mockImplementation((table: string) => {
    if (table !== 'form_templates') throw new Error(table)
    const q = { select: () => q, eq: () => q, maybeSingle }
    return q
  })
})

describe('loadFormTemplate (정본 §4.6.4·§4.7.4)', () => {
  it('template_id 가 없으면 기본 파일을 읽는다', async () => {
    readFile.mockResolvedValue(Buffer.from('pptx'))
    const loaded = await loadFormTemplate('p1', 'weekly_report_pptx', null)
    expect(loaded.source).toBe('default')
    expect(loaded.bytes).toEqual(new Uint8Array(Buffer.from('pptx')))
    expect(String(readFile.mock.calls[0][0])).toContain('src/lib/report/assets/default/weekly_report_pptx.pptx')
    expect(from).not.toHaveBeenCalled()
  })

  it('기본 파일이 없으면 500 으로 올릴 오류이고 성공으로 위장하지 않는다', async () => {
    readFile.mockRejectedValue(new Error('ENOENT'))
    await expect(loadFormTemplate('p1', 'weekly_report_pptx', null)).rejects.toBeInstanceOf(FormTemplateLoadError)
  })

  it('활성 행이 없으면 기본 파일을 읽지 않는다', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    await expect(loadFormTemplate('p1', 'weekly_report_pptx', TPL)).rejects.toBeInstanceOf(FormTemplateLoadError)
    expect(readFile).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })
})
