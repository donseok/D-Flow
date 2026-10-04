import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { FORM_ZIP_MAX_ENTRIES, FORM_ZIP_MAX_UNCOMPRESSED, hasZipHeader, validateFormPackage } from '@/lib/report/engine/validate'

const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const enc = (s: string) => Buffer.from(s, 'utf8')

function zip(files: { name: string; data: Uint8Array; method?: number; uncomp?: number }[]): Uint8Array {
  const locals: Buffer[] = []
  const cds: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const stored = f.method !== 8
    const data = stored ? Buffer.from(f.data) : Buffer.from(deflateRawSync(f.data))
    const uncomp = f.uncomp ?? f.data.length
    const local = Buffer.alloc(30 + name.length + data.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(stored ? 0 : 8, 8)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(uncomp, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    data.copy(local, 30 + name.length)
    locals.push(local)
    const cd = Buffer.alloc(46 + name.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(stored ? 0 : 8, 10)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(uncomp, 24)
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

const types = (part: string, contentType: string) =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${contentType}"/></Types>`
const pptx = (extra: { name: string; data: Uint8Array }[] = []) => zip([
  { name: '[Content_Types].xml', data: enc(types('ppt/presentation.xml', PPTX_TYPE)) },
  { name: 'ppt/presentation.xml', data: enc('<p:presentation/>') },
  ...extra.map((e) => ({ ...e })),
])
const xlsx = () => zip([
  { name: '[Content_Types].xml', data: enc(types('xl/workbook.xml', XLSX_TYPE)) },
  { name: 'xl/workbook.xml', data: enc('<workbook/>') },
])

describe('양식 패키지 검증(정본 §4.7.2)', () => {
  it('PK 매직이 아니면 protected 다', () => {
    expect(hasZipHeader(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    expect(validateFormPackage(Uint8Array.from([1, 2, 3, 4, 5]), 'pptx')).toMatchObject({ ok: false, code: 'PROTECTED' })
  })
  it('pptx·xlsx 본 PART 와 콘텐츠 타입이 맞으면 통과하고, 형식이 바뀌면 거부한다', () => {
    expect(validateFormPackage(pptx(), 'pptx')).toEqual({ ok: true, warnings: [] })
    expect(validateFormPackage(xlsx(), 'xlsx')).toEqual({ ok: true, warnings: [] })
    expect(validateFormPackage(pptx(), 'xlsx')).toMatchObject({ ok: false, code: 'PACKAGE' })
    expect(validateFormPackage(zip([
      { name: '[Content_Types].xml', data: enc(types('ppt/presentation.xml', 'text/plain')) },
      { name: 'ppt/presentation.xml', data: enc('<p:presentation/>') },
    ]), 'pptx')).toMatchObject({ ok: false, code: 'PACKAGE' })
  })
  it('deflate 로 압축된 본 PART 도 읽는다', () => {
    const packed = zip([
      { name: '[Content_Types].xml', data: enc(types('ppt/presentation.xml', PPTX_TYPE)), method: 8 },
      { name: 'ppt/presentation.xml', data: enc('<p:presentation/>'), method: 8 },
    ])
    expect(validateFormPackage(packed, 'pptx')).toEqual({ ok: true, warnings: [] })
  })
  it('매크로 콘텐츠 타입과 vbaProject.bin 을 거부한다', () => {
    const macroType = zip([
      { name: '[Content_Types].xml', data: enc(types('ppt/presentation.xml', PPTX_TYPE).replace('</Types>', '<Override PartName="/ppt/vbaProject.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>')) },
      { name: 'ppt/presentation.xml', data: enc('<p:presentation/>') },
    ])
    expect(validateFormPackage(macroType, 'pptx')).toMatchObject({ ok: false, code: 'MACRO' })
    expect(validateFormPackage(pptx([{ name: 'ppt/vbaProject.bin', data: enc('bin') }]), 'pptx')).toMatchObject({ ok: false, code: 'MACRO' })
  })
  it('경로 탈출·절대 경로·항목 수·압축 해제 합을 거부한다', () => {
    expect(validateFormPackage(zip([{ name: '../x', data: enc('a') }]), 'pptx')).toMatchObject({ ok: false, code: 'ZIP' })
    expect(validateFormPackage(zip([{ name: '/etc/passwd', data: enc('a') }]), 'pptx')).toMatchObject({ ok: false, code: 'ZIP' })
    const huge = zip([{ name: '[Content_Types].xml', data: enc('x'), uncomp: FORM_ZIP_MAX_UNCOMPRESSED + 1 }])
    expect(validateFormPackage(huge, 'pptx')).toMatchObject({ ok: false, code: 'ZIP' })
    const eocd = Buffer.alloc(22)
    eocd.writeUInt32LE(0x06054b50, 0)
    eocd.writeUInt16LE(FORM_ZIP_MAX_ENTRIES + 1, 10)
    const tooMany = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), eocd])
    expect(validateFormPackage(tooMany, 'pptx')).toMatchObject({ ok: false, code: 'ZIP' })
  })
  it('차트·피벗·워크시트 확장 서식은 경고이고 등록을 막지 않는다', () => {
    const chart = validateFormPackage(zip([
      { name: '[Content_Types].xml', data: enc(types('xl/workbook.xml', XLSX_TYPE)) },
      { name: 'xl/workbook.xml', data: enc('<workbook/>') },
      { name: 'xl/charts/chart1.xml', data: enc('<c:chart/>') },
      { name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet><conditionalFormatting/></worksheet>') },
    ]), 'xlsx')
    expect(chart.ok).toBe(true)
    if (!chart.ok) return
    expect(chart.warnings.map((w) => w.message).join('\n')).toMatch(/xl\/charts\//)
    expect(chart.warnings.map((w) => w.message).join('\n')).toMatch(/conditionalFormatting|조건부/)
  })
})
