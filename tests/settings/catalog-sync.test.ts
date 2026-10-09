import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATALOG_META, PLANNED_KEYS } from '@/lib/settings/catalog-meta'
import { catalogAutoSections, replaceCatalogAutoSections } from '@/lib/settings/catalogDoc'
import { OPERATIONAL_SETTINGS } from '@/lib/settings/operational'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'

const file = 'docs/settings-catalog.md'
const expectedStatus: Record<string, string> = {
  'fields.wbs_item': 'verified', 'fields.issue': 'verified', 'fields.weekly_row': 'verified',
  'modules.allowed': 'verified', 'ai.enabled': 'verified', 'invites.allowed_domains': 'verified',
  'branding.product_name': 'stored', 'branding.logo': 'wired', 'branding.accent': 'wired', 'branding.mail_from_name': 'verified',
  'navigation.menu': 'wired', 'core.level_labels': 'verified', 'core.extra_axis_label': 'wired',
  'core.milestone_keywords': 'verified', 'wbs.excel_profile': 'verified', 'modules.enabled': 'verified', 'workflow.stage_credits': 'verified', 'workflow.issue_statuses': 'verified',
  // SP5 A — 달력 셋(스펙 D44: 정의·편집·소비처·테스트 네 연결). 두 스코프가 같은 키 이름을 쓴다(워크스페이스 기본값 → 프로젝트 생성 시 복사)
  'calendar.timezone': 'verified', 'calendar.working_days': 'verified', 'calendar.week_start': 'verified',
  // SP3b UI-3 — 정의·테스트(네 연결 ①④)까지. 편집기(과제 6·7)·소비처(과제 10·14)가 붙으면 올린다
  'portal.widgets': 'wired', 'views.default': 'wired',
  // SPU1 — 로컬 초안 정책. 정의·편집기·소비처(초안 저장소 판정 + 위키 편집기)·테스트
  'security.local_drafts': 'wired',
  // SP8 — 관리자 알림 정책. 정의·편집기·소비처(발행 관문 emit)·테스트
  'notify.policy': 'wired',
  // SP5 B1 — 정의·편집·소비처·테스트 네 연결
  'issues.id_policy': 'verified', 'issues.analysis': 'verified', 'minutes.attachments': 'verified',
  // SP5 B4 — 어휘 다섯. 정의만 먼저(stored) — 트리거·소비처·편집기가 이어지면 verified 로 올린다
  'attendance.types': 'verified', 'meetings.categories': 'verified', 'issues.severities': 'verified', 'issues.sources': 'verified', 'issues.cause_categories': 'verified',
  // SP5 B2 — 최상위 폴더 모드. SQL(create_team·ensure_team_roots)·편집기·앱 소비처(편철 정규화 v2.9)·검증 네 연결
  'minutes.root_folders': 'verified',
  // 정본 §3.3 — 외부 업로드의 자동 편철(env 의 설정화). 정의·편집기·소비처(업로드 라우트)·테스트. 편집 화면 눈확인·업로드 완주 전이라 wired
  'minutes.auto_file_by_path': 'wired',
  // SP5b — 흐름 다섯(+크레딧 표). 정의·SQL·승인 액션(W1)·화면 주입·편집기(W2)·합성 S1/S3/S9-workflow(Z) 뒤 verified
  'workflow.credit_policy': 'verified', 'workflow.wbs_stage_labels': 'verified', 'workflow.approval_steps': 'verified',
  'workflow.approval_distinct_approvers': 'verified', 'workflow.predecessor_gate': 'verified',
  // SP6 — 정의·parse·관리 화면 FormTemplatesManager·렌더 소비·부정 테스트 6 완료 뒤 verified
  'forms.weekly_report_pptx': 'verified', 'forms.weekly_report_xlsx': 'verified', 'forms.issue_analysis_pptx': 'verified', 'forms.wbs_export_xlsx': 'verified',
}

/** 정의는 있으나 편집 컴포넌트가 아직 없는 custom 위젯(닫힌 목록) — SP6 양식 관리 화면까지 완료되어 비어 있다. */
const PENDING_CUSTOM_WIDGETS: Readonly<Record<string, string>> = {}

describe('설정 카탈로그 동기화', () => {
  it('48정의(키 이름 44)의 메타·마감 상태와 소비처·테스트 경로가 유효하다', () => {
    const defs = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS]
    expect(defs).toHaveLength(48)
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
      expect(why, component).toMatch(/^(SP5 A|SP3b UI-3|SP5 (A|B1|B3)|SP5b W2|SP6 Phase S) 과제/)
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

describe('PLANNED_KEYS — SP5 의 키는 전부 등록됐다(스펙 §1.1 정본 결정 9 행·D44)', () => {
  it('달력 셋·B1 이슈 둘·B2 최상위 폴더·B3 첨부·B4 어휘 다섯은 등록돼 목록에 SP5 행이 없다', () => {
    expect(PLANNED_KEYS.filter((k) => k.key.startsWith('calendar.'))).toEqual([])
    expect(PLANNED_KEYS.filter((k) => k.key === 'issues.id_policy' || k.key === 'issues.analysis')).toEqual([])   // SP5 B1 과제 3 이 등록
    expect(PLANNED_KEYS.filter((k) => k.sp.startsWith('SP5 '))).toEqual([])                                    // B2 가 minutes.root_folders 를 등록 — 마지막 행
  })
})
