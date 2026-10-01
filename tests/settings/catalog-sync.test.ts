import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG_META } from '@/lib/settings/catalog-meta'
import { catalogAutoSections, replaceCatalogAutoSections } from '@/lib/settings/catalogDoc'
import { OPERATIONAL_SETTINGS } from '@/lib/settings/operational'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'

const file = 'docs/settings-catalog.md'
const expectedStatus: Record<string, string> = {
  'modules.allowed': 'verified', 'ai.enabled': 'verified', 'invites.allowed_domains': 'verified',
  'branding.product_name': 'stored', 'branding.logo': 'stored', 'branding.accent': 'stored', 'branding.mail_from_name': 'verified',
  'navigation.menu': 'stored', 'core.level_labels': 'verified', 'core.extra_axis_label': 'stored',
  'core.milestone_keywords': 'verified', 'wbs.excel_profile': 'verified', 'modules.enabled': 'verified', 'workflow.stage_credits': 'wired',
}

describe('설정 카탈로그 동기화', () => {
  it('14키의 메타·마감 상태와 소비처·테스트 경로가 유효하다', () => {
    const defs = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS]
    expect(defs).toHaveLength(14)
    expect(Object.keys(CATALOG_META).sort()).toEqual(defs.map(def => def.key).sort())
    expect(Object.fromEntries(defs.map(def => [def.key, CATALOG_META[def.key].status]))).toEqual(expectedStatus)
    for (const def of defs) {
      const meta = CATALOG_META[def.key]
      if (meta.status === 'verified') expect(meta.tests.length, def.key).toBeGreaterThan(0)
      for (const path of [...meta.consumers, ...meta.tests]) expect(existsSync(path), `${def.key}: ${path}`).toBe(true)
    }
  })

  it('운영 설정 이름은 유일하고 소유 파일이 존재한다', () => {
    expect(new Set(OPERATIONAL_SETTINGS.map(def => def.name)).size).toBe(OPERATIONAL_SETTINGS.length)
    for (const def of OPERATIONAL_SETTINGS) for (const path of def.owner) expect(existsSync(path), `${def.name}: ${path}`).toBe(true)
  })

  it('자동 절은 레지스트리·메타데이터와 같다', () => {
    const before = readFileSync(file, 'utf8')
    const after = replaceCatalogAutoSections(before)
    if (process.env.CATALOG_WRITE === '1' && after !== before) writeFileSync(file, after)
    else expect(before).toBe(after)
    expect(Object.keys(catalogAutoSections()).sort()).toEqual(['1', '2', '4', '5'])
  })

  it('수기 절의 근거 파일과 심볼이 실재한다', () => {
    const manual = readFileSync(file, 'utf8').replace(/<!-- catalog:auto:\d+:start -->[\s\S]*?<!-- catalog:auto:\d+:end -->/g, '')
    for (const match of manual.matchAll(/`(src\/[^`]+\.[cm]?[jt]sx?)`(?:\S{0,3}\s+`([A-Za-z_$][\w$]*)`)?/g)) {
      const [, path, symbol] = match
      expect(existsSync(path), path).toBe(true)
      // 식별자 경계로 본다 — 부분 문자열이면 GET·Locale 같은 짧은 이름이 파일 어디에든 걸린다.
      if (symbol) expect(new RegExp(`(?<![\\w$])${symbol.replace(/\$/g, '\\$')}(?![\\w$])`).test(readFileSync(path, 'utf8')), `${path}: ${symbol}`).toBe(true)
    }
  })
})
