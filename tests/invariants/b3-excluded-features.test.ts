import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { DEFAULT_ATTACHMENT_POLICY } from '@/lib/minutes/attachmentPolicy'

// SP5 스펙 B3 완료 조건 — "두지 않는 것"(개정 SP5-5·SP5-6, 비평 S13): allowedMimeTypes·externalDownloadEnabled 키,
// 업로드 예약 표(P8-RJ-1), 버전별 첨부 스냅샷(P8-NG-4). 계획에서 되살리지 않는다 — 레지스트리·스키마·코드 grep 으로 0건을 고정한다.
const ROOT = process.cwd()
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p, exts))
    else if (exts.some(e => name.endsWith(e))) out.push(p)
  }
  return out
}
const FORBIDDEN_KEYS = /allowedMimeTypes|allowed_mime_types_policy|externalDownloadEnabled|external_download_enabled/

describe('B3 에서 두지 않는 것', () => {
  it('첨부 정책 필드는 정확히 여섯 — MIME 허용 목록·외부 다운로드 스위치 없음', () => {
    expect(Object.keys(DEFAULT_ATTACHMENT_POLICY).sort()).toEqual(
      ['allowedExtensions', 'enabled', 'maxCount', 'maxFileBytes', 'maxTotalBytes', 'previewEnabled'])
  })
  it('설정 레지스트리에 해당 키 0건', () => {
    const keys = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS].map(d => d.key)
    expect(keys.filter(k => /mime|external_?download|externalDownload/i.test(k))).toEqual([])
  })
  it('코드(src·scripts)에 해당 식별자 0건', () => {
    const hits = [...walk(join(ROOT, 'src'), ['.ts', '.tsx']), ...walk(join(ROOT, 'scripts'), ['.mjs', '.ts'])]
      .filter(f => FORBIDDEN_KEYS.test(readFileSync(f, 'utf8')))
      .map(f => f.slice(ROOT.length + 1))
    expect(hits).toEqual([])
  })
  it('스키마에 업로드 예약 표·버전별 첨부 스냅샷 표 0건', () => {
    const sql = walk(join(ROOT, 'supabase/migrations'), ['.sql']).map(f => readFileSync(f, 'utf8')).join('\n')
    const tables = [...sql.matchAll(/create table (?:if not exists )?public\.([a-z_]+)/gi)].map(m => m[1].toLowerCase())
    expect(tables.filter(t => /reserv|upload_(slot|ticket|intent)|minute_version_(files|attachments)|version_attachments/.test(t))).toEqual([])
    expect(FORBIDDEN_KEYS.test(sql)).toBe(false)
  })
})
