import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG_META, PLANNED_KEYS } from '@/lib/settings/catalog-meta'
import { catalogAutoSections, replaceCatalogAutoSections } from '@/lib/settings/catalogDoc'
import { OPERATIONAL_SETTINGS } from '@/lib/settings/operational'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'

const file = 'docs/settings-catalog.md'
const expectedStatus: Record<string, string> = {
  'modules.allowed': 'verified', 'ai.enabled': 'verified', 'invites.allowed_domains': 'verified',
  'branding.product_name': 'stored', 'branding.logo': 'stored', 'branding.accent': 'stored', 'branding.mail_from_name': 'verified',
  'navigation.menu': 'stored', 'core.level_labels': 'verified', 'core.extra_axis_label': 'stored',
  'core.milestone_keywords': 'verified', 'wbs.excel_profile': 'verified', 'modules.enabled': 'verified', 'workflow.stage_credits': 'wired',
  // SP5 A — 달력 셋(스펙 D44: 정의·편집·소비처·테스트 네 연결). 두 스코프가 같은 키 이름을 쓴다(워크스페이스 기본값 → 프로젝트 생성 시 복사)
  'calendar.timezone': 'verified', 'calendar.working_days': 'verified', 'calendar.week_start': 'verified',
  // SP3b UI-3 — 정의·테스트(네 연결 ①④)까지. 편집기(과제 6·7)·소비처(과제 10·14)가 붙으면 올린다
  'portal.widgets': 'stored', 'views.default': 'stored',
}

/** 정의는 있으나 편집 컴포넌트가 아직 없는 custom 위젯(닫힌 목록) — SP5 A 의 calendar.* 는 키 정의(과제 4)가 화면 장착(과제 25·26)보다 먼저다.
 * 그 키가 verified 로 오르기 전(과제 29)에 컴포넌트가 생기거나 위젯 이름이 실재 컴포넌트로 바뀌어야 한다 */
const PENDING_CUSTOM_WIDGETS: Readonly<Record<string, string>> = {
  // SP5 A 과제 25 가 셋(TimezoneSelect·WorkingDaysEditor·WeekStartEditor)을 만들어 비었다(판정 J1) — 과제 29 가 빈 목록을 완료 조건으로 본다
  // SP3b UI-3 — 키 정의(과제 2·3, U3-2)가 편집기(과제 6·7, U3-3)보다 먼저다. 편집기를 만드는 과제가 그 항목을 지운다(아래 죽은 항목 검사)
  PortalWidgetsEditor: 'SP3b UI-3 과제 6 — portal.widgets 편집기(네 연결 ②)',
  ViewsDefaultEditor: 'SP3b UI-3 과제 7 — views.default 편집기(네 연결 ②)',
}

describe('설정 카탈로그 동기화', () => {
  it('22정의(키 이름 19)의 메타·마감 상태와 소비처·테스트 경로가 유효하다', () => {
    const defs = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS]
    expect(defs).toHaveLength(22)
    expect(Object.keys(CATALOG_META).sort()).toEqual([...new Set(defs.map(def => def.key))].sort())
    expect(Object.fromEntries(defs.map(def => [def.key, CATALOG_META[def.key].status]))).toEqual(expectedStatus)
    for (const def of defs) {
      const meta = CATALOG_META[def.key]
      if (meta.status === 'verified') expect(meta.tests.length, def.key).toBeGreaterThan(0)
      for (const path of [...meta.consumers, ...meta.tests]) expect(existsSync(path), `${def.key}: ${path}`).toBe(true)
    }
  })

  it('custom 편집 UI(widget.component)는 src/components/settings 에 실재하는 컴포넌트다 — 카탈로그의 편집 UI 칸이 상태(verified)를 반박하지 않게', () => {
    // A2 최종 리뷰 완료 P2-3(FF5): wbs.excel_profile 이 존재하지 않는 'ExcelProfilePanel' 을 가리킨 채 verified 였다
    for (const def of [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS]) {
      if (def.widget.kind !== 'custom') continue
      if (PENDING_CUSTOM_WIDGETS[def.widget.component]) continue          // 아래 it 이 닫힌 목록으로 따로 본다
      const path = `src/components/settings/${def.widget.component}.tsx`
      expect(existsSync(path), `${def.key}: ${path}`).toBe(true)
      expect(readFileSync(path, 'utf8'), `${def.key}: export ${def.widget.component}`).toMatch(new RegExp(`export (function|const) ${def.widget.component}\\b`))
    }
  })

  it('아직 없는 custom 편집 UI 는 닫힌 목록뿐이고, 그 키는 verified 가 아니며, 컴포넌트가 생기면 항목을 지운다(죽은 항목 실패)', () => {
    const defs = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS]
    for (const [component, why] of Object.entries(PENDING_CUSTOM_WIDGETS)) {
      expect(why, component).toMatch(/^(SP5 A|SP3b UI-3) 과제 \d+/)
      expect(existsSync(`src/components/settings/${component}.tsx`), `${component} 가 생겼다 — 이 항목을 지운다`).toBe(false)
      const users = defs.filter((d) => d.widget.kind === 'custom' && d.widget.component === component)
      expect(users.length, `${component} 를 쓰는 정의가 없다 — 죽은 항목`).toBeGreaterThan(0)
      for (const d of users) expect(CATALOG_META[d.key].status, `${d.scope}/${d.key}`).not.toBe('verified')
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

describe('PLANNED_KEYS — SP5 의 남은 키는 체크포인트 이름으로(스펙 §1.1 정본 결정 9 행)', () => {
  it('달력 셋은 등록돼 목록에 없고, SP5 행은 B1~B4 체크포인트를 적는다', () => {
    expect(PLANNED_KEYS.filter((k) => k.key.startsWith('calendar.'))).toEqual([])
    const sp5 = PLANNED_KEYS.filter((k) => k.sp.startsWith('SP5 '))
    expect(sp5.length).toBeGreaterThan(0)
    for (const k of sp5) expect(k.sp, k.key).toMatch(/^SP5 B[1-4]$/)
    const where = Object.fromEntries(sp5.map((k) => [`${k.scope}/${k.key}`, k.sp]))
    expect(where).toMatchObject({
      'project/issues.id_policy': 'SP5 B1', 'project/issues.analysis': 'SP5 B1',
      'workspace/minutes.attachments': 'SP5 B3', 'project/minutes.attachments': 'SP5 B3',
      'workspace/minutes.root_folders': 'SP5 B2',
      'project/issues.severities': 'SP5 B4', 'project/issues.cause_categories': 'SP5 B4', 'project/issues.sources': 'SP5 B4',
      'project/attendance.types': 'SP5 B4', 'project/meetings.categories': 'SP5 B4',
    })
  })
})
