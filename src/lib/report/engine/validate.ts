/**
 * 양식 패키지 검증(정본 §4.7.2). 매직바이트·DRM·OPC 본체·매크로·zip 안전·라운드트립 경고.
 * 토큰 문법 스캔은 FormEngine.scan 이다. 이 함수는 패키지 거부 사유와 라운드트립 경고만 본다.
 */
import { inflateRawSync } from 'node:zlib'
import type { FormFormat } from './types'

export const FORM_ZIP_MAX_ENTRIES = 5_000
export const FORM_ZIP_MAX_UNCOMPRESSED = 100 * 1024 * 1024

const PPTX_MAIN = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
const XLSX_MAIN = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const VBA_TYPE = 'application/vnd.ms-office.vbaproject'

const ERR_PROTECTED = '파일이 DRM으로 보호되었거나 유효한 OOXML(pptx·xlsx)이 아닙니다. 보호 해제된 파일을 다시 올리세요.'
const ERR_PACKAGE = '양식 파일의 구성이 올바르지 않습니다. pptx 는 프레젠테이션, xlsx 는 통합 문서여야 합니다.'
const ERR_MACRO = '매크로가 포함된 양식은 받을 수 없습니다.'
const ERR_ZIP = '양식 압축을 안전하게 열 수 없습니다. 항목 수·압축 해제 크기·경로를 확인하세요.'

export function hasZipHeader(header: Uint8Array): boolean {
  return header.length >= 4
    && header[0] === 0x50
    && header[1] === 0x4b
    && (
      (header[2] === 0x03 && header[3] === 0x04)
      || (header[2] === 0x05 && header[3] === 0x06)
      || (header[2] === 0x07 && header[3] === 0x08)
    )
}

/** 매직바이트가 아니면 protected. 빈 헤더도 protected(파일이 없다는 진단은 호출부). */
export function classifyFormHeader(header: Uint8Array): 'ready' | 'protected' {
  return hasZipHeader(header) ? 'ready' : 'protected'
}

export interface PackageWarning { code: 'ROUNDTRIP_LOSS'; message: string }
export type PackageResult =
  | { ok: true; warnings: PackageWarning[] }
  | { ok: false; code: 'PROTECTED' | 'PACKAGE' | 'MACRO' | 'ZIP'; error: string }

interface ZipEntry { name: string; method: number; compSize: number; uncompSize: number; localOffset: number; flags: number }

function u16(b: Uint8Array, o: number): number { return b[o] | (b[o + 1] << 8) }
function u32(b: Uint8Array, o: number): number { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

function findEocd(b: Uint8Array): number {
  const min = Math.max(0, b.length - 22 - 65535)
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) return i
  }
  return -1
}

function unsafeName(name: string): boolean {
  if (name.length === 0 || name.includes('\0')) return true
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) return true
  const parts = name.split(/[/\\]/)
  return parts.some((p) => p === '..')
}

function readEntries(b: Uint8Array): ZipEntry[] | null {
  const eocd = findEocd(b)
  if (eocd < 0 || eocd + 22 > b.length) return null
  const count = u16(b, eocd + 10)
  const cdSize = u32(b, eocd + 12)
  const cdOff = u32(b, eocd + 16)
  if (count > FORM_ZIP_MAX_ENTRIES) return null
  if (cdOff > b.length || cdSize > b.length - cdOff) return null
  const entries: ZipEntry[] = []
  let o = cdOff
  const end = cdOff + cdSize
  for (let n = 0; n < count; n++) {
    if (o + 46 > end || u32(b, o) !== 0x02014b50) return null
    const flags = u16(b, o + 8)
    const method = u16(b, o + 10)
    const compSize = u32(b, o + 20)
    const uncompSize = u32(b, o + 24)
    const nameLen = u16(b, o + 28)
    const extraLen = u16(b, o + 30)
    const commentLen = u16(b, o + 32)
    const localOffset = u32(b, o + 42)
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) return null
    const nameAt = o + 46
    if (nameAt + nameLen + extraLen + commentLen > end) return null
    let name: string
    try { name = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(nameAt, nameAt + nameLen)) }
    catch { return null }
    if (unsafeName(name) || (flags & 0x1) !== 0) return null
    entries.push({ name, method, compSize, uncompSize, localOffset, flags })
    o = nameAt + nameLen + extraLen + commentLen
  }
  return entries
}

function inflateEntry(b: Uint8Array, e: ZipEntry): Uint8Array | null {
  if (e.localOffset + 30 > b.length || u32(b, e.localOffset) !== 0x04034b50) return null
  const nameLen = u16(b, e.localOffset + 26)
  const extraLen = u16(b, e.localOffset + 28)
  const start = e.localOffset + 30 + nameLen + extraLen
  if (start + e.compSize > b.length) return null
  const raw = b.subarray(start, start + e.compSize)
  try {
    if (e.method === 0) return raw.length === e.compSize ? raw : null
    if (e.method !== 8) return null
    const out = inflateRawSync(raw, { maxOutputLength: e.uncompSize })
    if (out.length !== e.uncompSize) return null
    return out
  } catch { return null }
}

function overrides(xml: string): { part: string; type: string }[] {
  const out: { part: string; type: string }[] = []
  for (const tag of xml.matchAll(/<Override\b([^>]*)\/?>/g)) {
    const part = /PartName="([^"]+)"/i.exec(tag[1])
    const type = /ContentType="([^"]+)"/i.exec(tag[1])
    if (part && type) out.push({ part: part[1], type: type[1] })
  }
  return out
}

/**
 * 중앙 디렉터리의 선언 크기로 zip 폭탄·경로 탈출을 거절한 뒤, 필요한 XML 만 푼다.
 * 토큰 구조 오류는 보지 않는다.
 */
export function validateFormPackage(bytes: Uint8Array, format: FormFormat): PackageResult {
  if (!hasZipHeader(bytes.subarray(0, 4))) return { ok: false, code: 'PROTECTED', error: ERR_PROTECTED }
  const entries = readEntries(bytes)
  if (!entries) return { ok: false, code: 'ZIP', error: ERR_ZIP }
  let sum = 0
  for (const e of entries) {
    sum += e.uncompSize
    if (sum > FORM_ZIP_MAX_UNCOMPRESSED) return { ok: false, code: 'ZIP', error: ERR_ZIP }
  }
  const byName = new Map(entries.map((e) => [e.name, e]))
  const typesEntry = byName.get('[Content_Types].xml')
  if (!typesEntry) return { ok: false, code: 'PACKAGE', error: ERR_PACKAGE }
  const typesBytes = inflateEntry(bytes, typesEntry)
  if (!typesBytes) return { ok: false, code: 'PACKAGE', error: ERR_PACKAGE }
  const typesXml = new TextDecoder('utf-8', { fatal: false }).decode(typesBytes)
  if (typesXml.toLowerCase().includes(VBA_TYPE) || entries.some((e) => e.name.toLowerCase().endsWith('vbaproject.bin'))) {
    return { ok: false, code: 'MACRO', error: ERR_MACRO }
  }
  const mainName = format === 'pptx' ? 'ppt/presentation.xml' : 'xl/workbook.xml'
  const mainType = format === 'pptx' ? PPTX_MAIN : XLSX_MAIN
  const main = byName.get(mainName)
  const typed = overrides(typesXml).some((o) => o.part.replace(/^\/+/, '') === mainName && o.type === mainType)
  if (!main || !typed) return { ok: false, code: 'PACKAGE', error: ERR_PACKAGE }
  if (!inflateEntry(bytes, main)) return { ok: false, code: 'PACKAGE', error: ERR_PACKAGE }

  const warnings: PackageWarning[] = []
  const prefixes = ['xl/charts/', 'xl/pivotTables/', 'xl/pivotCache/', 'xl/drawings/', 'xl/externalLinks/']
  for (const prefix of prefixes) {
    if (entries.some((e) => e.name.startsWith(prefix))) {
      warnings.push({ code: 'ROUNDTRIP_LOSS', message: `${prefix} 파트가 있어 저장 때 빠질 수 있습니다.` })
    }
  }
  for (const e of entries) {
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(e.name)) continue
    const xml = inflateEntry(bytes, e)
    if (!xml) return { ok: false, code: 'PACKAGE', error: ERR_PACKAGE }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(xml)
    if (text.includes('<conditionalFormatting') || text.includes('<dataValidations') || text.includes('<extLst')) {
      warnings.push({ code: 'ROUNDTRIP_LOSS', message: `${e.name} 에 조건부 서식·데이터 유효성·확장 목록이 있어 저장 때 빠질 수 있습니다.` })
    }
  }
  return { ok: true, warnings }
}
