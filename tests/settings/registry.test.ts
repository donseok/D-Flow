// 설정 레지스트리(스펙 §3.6·§1.4·개정 §2.6) — 24키 등록(SP5 A 의 calendar.* 여섯 포함 — 같은 이름이 두 스코프, SP5 B1 의 issues.* 둘), 로드 단언, G0-4 의 네 선언은 형 검사만(등록하지 않는다), 사전 키.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULE_IDS } from '@/lib/modules/defaults'
import type { ModuleId } from '@/lib/modules/defaults'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'
import {
  DEPLOY_DEFAULT_KEYS, KEY_PATTERN, PROJECT_SETTINGS, REQUIRED_ON_CREATE, RETIRED_KEYS, SETTINGS_SCHEMA_VERSION, WORKSPACE_SETTINGS,
  assertRegistry, defineSetting, settingDef, type Parsed, type SettingDef,
} from '@/lib/settings/registry'
import { DEFAULT_MILESTONE_KEYWORDS, parseLevelLabels, parseStageCredits } from '@/lib/settings/defs/project'
import { normalizeDomain, parseAllowedDomainsSetting } from '@/lib/settings/defs/workspace'
import { CATALOG_META, PLANNED_KEYS } from '@/lib/settings/catalog-meta'
import { DEFAULT_STAGE_CREDITS } from '@/lib/domain/stageCredits'

const ALL = [...WORKSPACE_SETTINGS, ...PROJECT_SETTINGS] as readonly SettingDef[]
const KEYS = ALL.map((d) => d.key)

describe('등록 키', () => {
  it('정확히 39키 — 워크스페이스 13, 프로젝트 26(SP3a §3.6 표 + SP5 A calendar.* 두 스코프 + SP5 B1 issues.* 둘 + B4 어휘 다섯 + B2 최상위 폴더 + SP5b 이슈 상태 + SP5b W1 흐름 다섯)', () => {
    expect(WORKSPACE_SETTINGS.map((d) => d.key)).toEqual(['modules.allowed', 'ai.enabled', 'invites.allowed_domains', 'branding.product_name',
      'branding.logo', 'branding.accent', 'branding.mail_from_name', 'navigation.menu', 'calendar.timezone', 'calendar.working_days', 'calendar.week_start', 'minutes.attachments', 'minutes.root_folders'])
    expect(PROJECT_SETTINGS.map((d) => d.key)).toEqual(['core.level_labels', 'core.extra_axis_label', 'core.milestone_keywords',
      'wbs.excel_profile', 'modules.enabled', 'workflow.stage_credits',
      'workflow.credit_policy', 'workflow.wbs_stage_labels', 'workflow.approval_steps', 'workflow.approval_distinct_approvers', 'workflow.predecessor_gate',
      'calendar.timezone', 'calendar.working_days', 'calendar.week_start',
      'issues.id_policy', 'issues.analysis', 'minutes.attachments',
      'attendance.types', 'meetings.categories', 'issues.severities', 'issues.sources', 'issues.cause_categories', 'workflow.issue_statuses', 'fields.wbs_item', 'fields.issue', 'fields.weekly_row'])
    for (const k of ['agents.stage_workflow', 'portal.widgets', 'views.default', 'core.stage_credits']) {
      expect(KEYS, k).not.toContain(k)
    }
  })
  it('편집 주체·모듈·widget 이 §3.6 표와 같다', () => {
    const row = (k: string) => { const d = ALL.find((x) => x.key === k)!; return [d.scope, d.editor, d.module, d.widget.kind, d.apply, [...d.impact]] }
    expect(row('modules.allowed')).toEqual(['workspace', 'platform_admin', 'settings', 'custom', 'immediate', ['recompute']])
    expect(row('ai.enabled')).toEqual(['workspace', 'workspace_admin', 'settings', 'boolean', 'immediate', ['none']])
    expect(row('invites.allowed_domains')).toEqual(['workspace', 'workspace_admin', 'settings', 'text_list', 'immediate', ['none']])
    expect(row('branding.accent')).toEqual(['workspace', 'workspace_admin', 'settings', 'custom', 'immediate', ['none']])
    expect(row('core.level_labels')).toEqual(['project', 'project_admin', 'wbs', 'custom', 'immediate', ['none']])
    expect(row('core.milestone_keywords')).toEqual(['project', 'project_admin', 'wbs', 'text_list', 'immediate', ['recompute']])
    expect(row('modules.enabled')).toEqual(['project', 'project_admin', 'settings', 'custom', 'immediate', ['recompute']])
    expect(row('workflow.stage_credits')).toEqual(['project', 'project_admin', 'wbs', 'custom', 'immediate', ['future_only']])
    // SP5 B2 — SP7 전까지 키 전체가 platform_admin(D21)
    expect(row('minutes.root_folders')).toEqual(['workspace', 'platform_admin', 'minutes', 'custom', 'immediate', ['future_only']])
    // SP5 B4 어휘 — 참조 검사가 있는 guarded, 소유 모듈은 그 어휘를 쓰는 기능
    expect(row('attendance.types')).toEqual(['project', 'project_admin', 'attendance', 'vocab', 'immediate', ['guarded']])
    expect(row('meetings.categories')).toEqual(['project', 'project_admin', 'meetings', 'vocab', 'immediate', ['guarded']])
    expect(row('issues.severities')).toEqual(['project', 'project_admin', 'issues', 'vocab', 'immediate', ['guarded']])
    expect(row('issues.sources')).toEqual(['project', 'project_admin', 'issue_analysis', 'vocab', 'immediate', ['guarded']])
    expect(row('issues.cause_categories')).toEqual(['project', 'project_admin', 'issue_analysis', 'vocab', 'immediate', ['guarded']])
    // SP5b I(D1) — 이슈 표시 상태는 어휘 계열의 여섯째 키(개정 §2.8.2 immediate/guarded)
    expect(row('workflow.issue_statuses')).toEqual(['project', 'project_admin', 'issues', 'vocab', 'immediate', ['guarded']])
    // SP5b W1(스펙 §4.5, 개정 §2.8.2) — 흐름 다섯 키. 크레딧 표는 workflow_value_of 로도 읽힌다(D20)
    expect(row('workflow.credit_policy')).toEqual(['project', 'project_admin', 'wbs', 'custom', 'immediate', ['future_only']])
    expect(row('workflow.wbs_stage_labels')).toEqual(['project', 'project_admin', 'wbs', 'custom', 'immediate', ['none']])
    expect(row('workflow.approval_steps')).toEqual(['project', 'project_admin', 'wbs', 'custom', 'immediate', ['future_only', 'guarded']])
    expect(row('workflow.approval_distinct_approvers')).toEqual(['project', 'project_admin', 'wbs', 'boolean', 'immediate', ['future_only']])
    expect(row('workflow.predecessor_gate')).toEqual(['project', 'project_admin', 'wbs', 'select', 'immediate', ['recompute']])
    expect(settingDef('project', 'workflow.stage_credits')!.sql).toEqual({ readers: ['apply_workflow_event', 'workflow_value_of'] })
    // SQL 판독·seedFrom·edit 은 SP3a 에서 stage_credits·없음·accent 하나였고 SP5 A 의 프로젝트 calendar.* 가 더한다(tests/settings/calendar-keys).
    // SP5 B1 의 issues.* 둘은 SQL 판독만 더한다(tests/settings/issues-defs)
    expect(ALL.filter((d) => d.sql !== null).map((d) => `${d.scope}/${d.key}`)).toEqual(['workspace/minutes.attachments', 'workspace/minutes.root_folders', 'project/workflow.stage_credits',
      'project/workflow.credit_policy', 'project/workflow.approval_steps', 'project/workflow.approval_distinct_approvers', 'project/workflow.predecessor_gate',
      'project/calendar.timezone', 'project/calendar.working_days', 'project/calendar.week_start',
      'project/issues.id_policy', 'project/issues.analysis', 'project/minutes.attachments',
      'project/attendance.types', 'project/meetings.categories', 'project/issues.severities', 'project/issues.sources', 'project/workflow.issue_statuses', 'project/fields.wbs_item', 'project/fields.issue', 'project/fields.weekly_row'])
    expect(ALL.filter((d) => d.reindexOn).map((d) => `${d.scope}/${d.key}`)).toEqual([
      'project/fields.wbs_item', 'project/fields.issue', 'project/fields.weekly_row',
    ])
    expect(ALL.filter((d) => d.edit).map((d) => `${d.scope}/${d.key}`)).toEqual(['workspace/branding.accent', 'project/calendar.week_start',
      'project/attendance.types', 'project/meetings.categories', 'project/issues.severities', 'project/issues.sources', 'project/issues.cause_categories',
      'project/workflow.issue_statuses'])
  })
  it('settingDef 는 스코프와 키로 찾는다 — 다른 스코프의 키는 없음', () => {
    expect(settingDef('project', 'core.level_labels')?.key).toBe('core.level_labels')
    expect(settingDef('workspace', 'core.level_labels')).toBeUndefined()
    expect(settingDef('project', 'modules.allowed')).toBeUndefined()
    expect(settingDef('workspace', 'nope.key')).toBeUndefined()
  })
  it('assertRegistry 가 통과한다 — 모듈 목록을 넘겨도. 세대는 1, 은퇴 키는 없다, 배포 기본값은 세 키', () => {
    expect(() => assertRegistry()).not.toThrow()
    expect(() => assertRegistry({ moduleIds: MODULE_IDS })).not.toThrow()
    expect(SETTINGS_SCHEMA_VERSION).toBe(1)
    expect(RETIRED_KEYS).toEqual([])
    expect(ALL.filter((d) => d.deployDefault).map((d) => d.key)).toEqual([...DEPLOY_DEFAULT_KEYS])
    expect(settingDef('workspace', 'invites.allowed_domains')!.deployDefault!.env).toBe('INVITE_ALLOWED_DOMAINS')
    expect(settingDef('workspace', 'branding.product_name')!.deployDefault!.env).toBe('NEXT_PUBLIC_BRAND_NAME')
    expect(settingDef('workspace', 'branding.mail_from_name')!.deployDefault!.env).toBe('MAIL_FROM_NAME')
  })
  it('assertRegistry 는 틀린 키·모르는 모듈·기본값 parse 실패·빈 impact 를 잡는다', () => {
    const bad = (extra: Partial<SettingDef>) => [{ ...settingDef('project', 'core.extra_axis_label')!, ...extra } as SettingDef]
    expect(() => assertRegistry({ defs: bad({ key: 'Core.axis' }) } as never)).toThrow(/키 이름/)
    expect(() => assertRegistry({ defs: bad({ key: 'core.extra_axis_label' }), moduleIds: ['dashboard'] } as never)).toThrow(/모듈/)
    expect(() => assertRegistry({ defs: bad({ default: 42 }) } as never)).toThrow(/기본값/)
    expect(() => assertRegistry({ defs: bad({ impact: [] as unknown as readonly ['none'] }) } as never)).toThrow(/impact/)
    expect(KEY_PATTERN.test('core.level_labels')).toBe(true)
    expect(KEY_PATTERN.test('core.level-labels')).toBe(false)
  })
  it('기본값은 자기 parse 를 통과한다(REQUIRED_ON_CREATE 는 제외)', () => {
    for (const d of ALL) {
      if (d.default === REQUIRED_ON_CREATE) continue
      expect(d.parse(d.default), d.key).toEqual({ ok: true, value: d.default })
    }
    expect(settingDef('project', 'core.level_labels')!.default).toBe(REQUIRED_ON_CREATE)
  })
  it('늘 명시(explicit) 키는 프로젝트 core.level_labels·modules.enabled 둘 — 0012 생성 RPC 의 필수 키 리터럴과 같다(FN-3)', () => {
    const explicit = ALL.filter((d) => d.explicit).map((d) => `${d.scope}/${d.key}`)
    expect(explicit.sort()).toEqual(['project/core.level_labels', 'project/modules.enabled'])
    const sql = readFileSync('supabase/migrations/0012_settings.sql', 'utf8')
    const m = /foreach k in array array\[([^\]]*)\] loop/.exec(sql)
    expect(m, '0012 생성 RPC 의 필수 키 루프').not.toBeNull()
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => `project/${x[1]}`).sort()).toEqual(explicit)
    // REQUIRED_ON_CREATE 는 explicit 이 흡수한다 — 생성 필수인데 unset 할 수 있는 키는 로드 단언이 막는다
    for (const d of ALL) if (d.default === REQUIRED_ON_CREATE) expect(d.explicit, d.key).toBe(true)
    const loose = [{ ...settingDef('project', 'core.level_labels')!, explicit: undefined }] as unknown as SettingDef[]
    expect(() => assertRegistry({ defs: loose })).toThrow(/explicit/)
  })
  it('명시(explicit) 키 = NNNN_authz_carry 의 apply_project_settings 거부 목록(CR-6) — 뒤 SP 가 explicit 키를 더하면 같은 커밋에서 RPC 를 고친다', () => {
    const explicit = ALL.filter((d) => d.explicit).map((d) => `${d.scope}/${d.key}`).sort()
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('_authz_carry.sql'))   // 번호가 아니라 접미로 찾는다
    expect(files, '_authz_carry 마이그레이션').toHaveLength(1)
    const m = /foreach k in array array\[([^\]]*)\] loop/.exec(readFileSync(`supabase/migrations/${files[0]}`, 'utf8'))
    expect(m, 'apply_project_settings 의 명시 키 루프').not.toBeNull()
    expect([...m![1].matchAll(/'([^']+)'/g)].map((x) => `project/${x[1]}`).sort()).toEqual(explicit)
  })
})

describe('parse — 워크스페이스 키', () => {
  const P = (k: string) => settingDef('workspace', k)!.parse
  it('modules.allowed 는 비core id 의 유일 목록', () => {
    expect(P('modules.allowed')(['kanban', 'minutes'])).toEqual({ ok: true, value: ['kanban', 'minutes'] })
    expect(P('modules.allowed')(['wbs']).ok).toBe(false)             // core
    expect(P('modules.allowed')(['kanban', 'kanban']).ok).toBe(false)
    expect(P('modules.allowed')(['issue_analysis']).ok).toBe(true)    // SP5 B1 부터 비core 모듈
    expect(P('modules.allowed')(['issue_mega']).ok).toBe(false)       // 모르는 id
    expect(P('modules.allowed')('kanban').ok).toBe(false)
  })
  it('ai.enabled 는 boolean 만', () => {
    expect(P('ai.enabled')(false)).toEqual({ ok: true, value: false })
    expect(P('ai.enabled')('false').ok).toBe(false)
  })
  it('invites.allowed_domains(D40) — 정규화·거부·별표 단독', () => {
    expect(normalizeDomain(' @Example.COM. ')).toEqual({ ok: true, value: 'example.com' })
    expect(normalizeDomain('한글.kr')).toEqual({ ok: true, value: 'xn--bj0bj06e.kr' })
    expect(normalizeDomain('*.example.com').ok).toBe(false)
    expect(normalizeDomain('exa mple.com').ok).toBe(false)
    expect(normalizeDomain('localhost').ok).toBe(false)             // 라벨 둘 이상
    expect(parseAllowedDomainsSetting(['Acme.test', 'acme.test', 'example.com'])).toEqual({ ok: true, value: ['acme.test', 'example.com'] })
    expect(parseAllowedDomainsSetting([])).toEqual({ ok: true, value: [] })            // 명시 [] = 초대 불가
    expect(parseAllowedDomainsSetting(['*'])).toEqual({ ok: true, value: ['*'] })
    expect(parseAllowedDomainsSetting(['*', 'a.com']).ok).toBe(false)                    // 섞이면 거부
    expect(parseAllowedDomainsSetting(['bad domain']).ok).toBe(false)                    // 버리지 않고 거부
    expect(parseAllowedDomainsSetting('example.com').ok).toBe(false)
    // C2-F3 — URL 파서가 자르거나 푸는 문자(/ ? # \ : % soft hyphen)는 조용히 잘라 저장하지 않고 거부한다
    for (const raw of ['acme.test/x', 'acme.test?x', 'acme.test#x', 'acme.test\\x', 'acme.test:8080', 'acm%65.test', 'ac\u00ADme.test', 'ａcme.test']) {
      expect(normalizeDomain(raw).ok, raw).toBe(false)
    }
    expect(parseAllowedDomainsSetting(['acme.test/x']).ok).toBe(false)
    expect(normalizeDomain('10.0.0.5').ok).toBe(false)   // L-2 — IPv4 는 도메인이 아니다
    const dd = settingDef('workspace', 'invites.allowed_domains')!.deployDefault!
    expect(dd.parse('example.com, ACME.test')).toEqual(['example.com', 'acme.test'])
    expect(dd.parse(undefined)).toBeUndefined()
    expect(dd.parse('*')).toEqual(['*'])
  })
  it('branding.product_name·mail_from_name — 1~40자, 제어 문자 금지, 앞뒤 공백 정리. mail_from_name 은 null 허용', () => {
    expect(P('branding.product_name')('  Acme PM ')).toEqual({ ok: true, value: 'Acme PM' })
    expect(P('branding.product_name')('a'.repeat(41)).ok).toBe(false)
    expect(P('branding.product_name')('').ok).toBe(false)
    expect(P('branding.product_name')('Acme\u0007').ok).toBe(false)
    expect(P('branding.mail_from_name')(null)).toEqual({ ok: true, value: null })
    expect(P('branding.mail_from_name')('Acme\n알림').ok).toBe(false)
    expect(P('branding.mail_from_name')('Acme 알림')).toEqual({ ok: true, value: 'Acme 알림' })
  })
  it('branding.logo — 세 슬롯, 각각 null 또는 그 슬롯의 경로', () => {
    const ws = '00000000-0000-0000-7e57-00000000aa01'
    const ok = { full: `ws/${ws}/branding/full-0123456789abcdef.png`, full_dark: null, mark: null }
    expect(P('branding.logo')(ok)).toEqual({ ok: true, value: ok })
    expect(P('branding.logo')({ ...ok, mark: `ws/${ws}/branding/full-0123456789abcdef.png` }).ok).toBe(false)   // 슬롯이 다르다
    expect(P('branding.logo')({ full: null, mark: null }).ok).toBe(false)                                         // 키 누락
    expect(P('branding.logo')({ ...ok, extra: null }).ok).toBe(false)
  })
  it('branding.accent — 저장 형태는 parse, 입력은 edit.parseInput, 파생은 edit.toStored', async () => {
    const d = settingDef('workspace', 'branding.accent')! as SettingDef
    expect(d.parse(null)).toEqual({ ok: true, value: null })
    expect(d.parse('red;}').ok).toBe(false)
    expect(d.parse('</style>').ok).toBe(false)
    expect(d.edit!.parseInput('#315CDB')).toEqual({ ok: true, value: '#315CDB' })
    expect(d.edit!.parseInput({ base: '#315cdb' }).ok).toBe(false)
    const stored = await d.edit!.toStored(undefined, '#315CDB', { scope: 'workspace', workspaceId: 'w' })
    expect(stored.ok).toBe(true)
    if (stored.ok) expect(d.parse(stored.value)).toEqual({ ok: true, value: stored.value })
    const rejected = await d.edit!.toStored(undefined, '#b93845', { scope: 'workspace', workspaceId: 'w' })
    expect(rejected.ok).toBe(false)
    expect(await d.edit!.toStored(undefined, null, { scope: 'workspace', workspaceId: 'w' })).toEqual({ ok: true, value: null })
  })
  it('navigation.menu — order 는 유일하고 등록된 id, 라벨 1~20자·꺾쇠 금지', () => {
    const p = P('navigation.menu')
    expect(p({ order: ['p.wbs', 'p.issues'], labels: { 'p.wbs': '작업' } })).toEqual({ ok: true, value: { order: ['p.wbs', 'p.issues'], labels: { 'p.wbs': '작업' } } })
    expect(p({ order: ['p.wbs', 'p.wbs'], labels: {} }).ok).toBe(false)
    expect(p({ order: ['p.gantt'], labels: {} }).ok).toBe(false)
    expect(p({ order: [], labels: { 'p.wbs': '<b>작업</b>' } }).ok).toBe(false)
    expect(p({ order: [], labels: { 'p.wbs': 'x'.repeat(21) } }).ok).toBe(false)
    expect(p({ order: [], labels: { 'p.nope': '작업' } }).ok).toBe(false)
    expect(p({ order: [] }).ok).toBe(false)
  })
})

describe('parse — 프로젝트 키', () => {
  const P = (k: string) => settingDef('project', k)!.parse
  it('core.level_labels — 1~10, 공백 정리, 빈 이름·중복 거부. 트리 깊이는 보지 않는다', () => {
    expect(parseLevelLabels([' Phase ', 'Task'])).toEqual({ ok: true, value: ['Phase', 'Task'] })
    expect(parseLevelLabels([]).ok).toBe(false)
    expect(parseLevelLabels(Array.from({ length: 11 }, (_, i) => `L${i}`)).ok).toBe(false)
    expect(parseLevelLabels(['Phase', ' Phase']).ok).toBe(false)
    expect(parseLevelLabels(['Phase', '']).ok).toBe(false)
    expect(parseLevelLabels(['Phase', 1]).ok).toBe(false)
    expect(P('core.level_labels')).toBe(parseLevelLabels)
  })
  it('core.extra_axis_label — null 또는 1~20자', () => {
    expect(P('core.extra_axis_label')(null)).toEqual({ ok: true, value: null })
    expect(P('core.extra_axis_label')(' Track ')).toEqual({ ok: true, value: 'Track' })
    expect(P('core.extra_axis_label')('').ok).toBe(false)
    expect(P('core.extra_axis_label')('x'.repeat(21)).ok).toBe(false)
  })
  it('core.milestone_keywords — 소문자 정규화, 항목 1~40자, 빈 배열 허용(마커 0건). 기본값은 옛 project.ts:58 의 6개', () => {
    expect(P('core.milestone_keywords')(['Kick-Off', ' 오픈 '])).toEqual({ ok: true, value: ['kick-off', '오픈'] })
    expect(P('core.milestone_keywords')([])).toEqual({ ok: true, value: [] })
    expect(P('core.milestone_keywords')(['']).ok).toBe(false)
    expect(P('core.milestone_keywords')(['x'.repeat(41)]).ok).toBe(false)
    expect(DEFAULT_MILESTONE_KEYWORDS).toEqual(['마일스톤', 'milestone', '킥오프', 'kick-off', '오픈', '완료보고'])
    expect(settingDef('project', 'core.milestone_keywords')!.default).toEqual(DEFAULT_MILESTONE_KEYWORDS)
  })
  it('wbs.excel_profile — null 또는 validateProfile 통과', () => {
    expect(P('wbs.excel_profile')(null)).toEqual({ ok: true, value: null })
    expect(P('wbs.excel_profile')({}).ok).toBe(false)
    expect(P('wbs.excel_profile')({ version: 2 }).ok).toBe(false)
  })
  it('modules.enabled — PROJECT_TOGGLABLE 의 유일 목록. 기본값은 9개 전부(OFF_ON_CREATE 가 빈 목록)', () => {
    expect(P('modules.enabled')(['kanban', 'agents'])).toEqual({ ok: true, value: ['kanban', 'agents'] })
    expect(P('modules.enabled')(['minutes']).ok).toBe(false)     // 워크스페이스 층
    expect(P('modules.enabled')(['wbs']).ok).toBe(false)         // core
    expect(P('modules.enabled')(['kanban', 'kanban']).ok).toBe(false)
    expect(settingDef('project', 'modules.enabled')!.default).toEqual(['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot'])
  })
  it('workflow.stage_credits — validateStageCredits 와 같은 답, 정책 주입(SP5b — 레지스트리 판독은 고정 불변식만, 정책과의 교차는 저장 검사)', () => {
    expect(parseStageCredits(DEFAULT_STAGE_CREDITS)).toEqual({ ok: true, value: DEFAULT_STAGE_CREDITS })
    expect(parseStageCredits({ default: { as: 0, ip: 20, rw: 30, im: 90, xx: 100 } }).ok).toBe(true)
    expect(parseStageCredits({ default: { as: 0, ip: 22, rw: 30, im: 90, xx: 100 } }).ok).toBe(false)   // 5 단위
    expect(parseStageCredits({ default: { as: 0, ip: 30, rw: 50, im: 80, xx: 90 } }).ok).toBe(false)    // xx=100
    // SP5b(의도적 수정 표): 정책 인자를 받는다 — 개정 §3.3.4 반례 0/20/25/90/100 은 {5,5} 에서 통과, 기본 정책에서 거부
    expect(parseStageCredits({ default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } }, { step: 5, min_gap: 5 }).ok).toBe(true)
    expect(parseStageCredits({ default: { as: 0, ip: 20, rw: 25, im: 90, xx: 100 } }).ok).toBe(false)
    // 레지스트리 parse 는 고정 불변식만(STRUCTURAL) — 저장된 표가 정책 변경으로 invalid 가 되지 않는다
    expect(settingDef('project', 'workflow.stage_credits')!.parse({ default: { as: 0, ip: 22, rw: 23, im: 90, xx: 100 } }).ok).toBe(true)
    expect(settingDef('project', 'workflow.stage_credits')!.parse({ default: { as: 0, ip: 30, rw: 30, im: 90, xx: 100 } }).ok).toBe(false)
    expect(settingDef('project', 'workflow.stage_credits')!.default).toEqual(DEFAULT_STAGE_CREDITS)
  })
})

describe('G0-4 — 등록하지 않는 네 선언이 형 검사를 통과하고 parse 가 돈다(스펙 §1.4)', () => {
  type ApprovalStep = { code: string; label: string | null; approver: 'subtree_or_admin' | 'admin' }
  type WeekDay = 'sunday' | 'monday'
  type WeekRule = { day: WeekDay; from: string | null }
  type FieldDef = { key: string; type: string; label: string }
  type IssueStatus = { code: string; label: string | null; category: 'open' | 'in_progress' | 'resolved' | 'on_hold' }
  const list = <T,>(guard: (x: unknown) => x is T) => (raw: unknown): Parsed<T[]> =>
    Array.isArray(raw) && raw.every(guard) ? { ok: true, value: raw } : { ok: false, error: '목록이 아니다' }
  const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null
  const parseApprovalSteps = list((x): x is ApprovalStep => isObj(x) && typeof x.code === 'string')
  const parseWeekRules = list((x): x is WeekRule => isObj(x) && (x.day === 'sunday' || x.day === 'monday'))
  const parseFieldDefs = list((x): x is FieldDef => isObj(x) && typeof x.key === 'string')
  const parseIssueStatuses = list((x): x is IssueStatus => isObj(x) && typeof x.code === 'string')
  const parseWeekDay = (raw: unknown): Parsed<WeekDay> => raw === 'sunday' || raw === 'monday' ? { ok: true, value: raw } : { ok: false, error: '요일' }
  const changeWeekStart = (prev: WeekRule[] | undefined, day: WeekDay): Parsed<WeekRule[]> => ({ ok: true, value: [...(prev ?? []), { day, from: null }] })
  const DEFAULT_ISSUE_STATUSES: IssueStatus[] = [{ code: 'open', label: null, category: 'open' }]
  const asModule = (m: string) => m as ModuleId

  const approvalSteps = defineSetting<'workflow.approval_steps', ApprovalStep[]>({ key: 'workflow.approval_steps', scope: 'project', module: asModule('wbs'),
    default: [{ code: 'review', label: null, approver: 'subtree_or_admin' }], parse: parseApprovalSteps,
    widget: { kind: 'custom', component: 'ApprovalStepsEditor' }, editor: 'project_admin', apply: 'immediate',
    impact: ['future_only', 'guarded'], sql: { readers: ['apply_workflow_event', 'guard_workflow_actual', 'guard_workflow_columns'] } })
  const weekStart = defineSetting<'calendar.week_start', WeekRule[], WeekDay>({ key: 'calendar.week_start', scope: 'project', module: asModule('settings'),
    default: [{ day: 'sunday', from: null }], parse: parseWeekRules,
    widget: { kind: 'custom', component: 'WeekStartEditor' }, editor: 'project_admin', apply: 'immediate',
    impact: ['future_only', 'recompute'], sql: { readers: ['week_key_of'] },
    seedFrom: { key: 'calendar.week_start', map: (day) => [{ day: day as WeekDay, from: null }] },
    edit: { parseInput: parseWeekDay, toStored: changeWeekStart } })
  const issueFields = defineSetting<'fields.issue', FieldDef[]>({ key: 'fields.issue', scope: 'project', module: asModule('issues'),
    default: [], parse: parseFieldDefs, widget: { kind: 'custom', component: 'FieldDefsEditor' },
    editor: 'project_admin', apply: 'immediate', impact: ['guarded'], sql: { readers: ['enforce_custom_fields'] }, reindexOn: ['label', 'searchable', 'options.label'] })
  const issueStatuses = defineSetting<'workflow.issue_statuses', IssueStatus[]>({ key: 'workflow.issue_statuses', scope: 'project', module: asModule('issues'),
    default: DEFAULT_ISSUE_STATUSES, parse: parseIssueStatuses,
    widget: { kind: 'custom', component: 'IssueStatusesEditor' }, editor: 'project_admin', apply: 'immediate',
    impact: ['guarded'], sql: { readers: ['enforce_issue_workflow'] } })

  it('네 선언의 parse·seedFrom.map·edit 이 돈다(복합 영향·부수효과·변환 복사·입력≠저장)', async () => {
    expect(approvalSteps.parse(approvalSteps.default)).toEqual({ ok: true, value: approvalSteps.default })
    // 네 선언 모두 기본값이 자기 parse 를 지난다(G0-4 — 형만 보지 않고 실제로 부른다, FM-6)
    for (const d of [weekStart, issueFields, issueStatuses]) expect(d.parse(d.default), d.key).toEqual({ ok: true, value: d.default })
    expect(weekStart.seedFrom!.map!('monday')).toEqual([{ day: 'monday', from: null }])
    expect(weekStart.edit!.parseInput('friday').ok).toBe(false)
    expect(await weekStart.edit!.toStored(weekStart.default as WeekRule[], 'monday', { scope: 'project', projectId: 'p', today: '2026-09-28' }))
      .toEqual({ ok: true, value: [{ day: 'sunday', from: null }, { day: 'monday', from: null }] })
    expect(issueFields.reindexOn).toEqual(['label', 'searchable', 'options.label'])
    expect(issueStatuses.impact).toEqual(['guarded'])
    // SP5b W1 이 workflow.approval_steps 를 실제로 등록했다(이 선언은 형 검사 표본으로 남는다)
    expect(KEYS).toContain(approvalSteps.key)
  })
})

describe('카탈로그 메타와 사전', () => {
  it('등록 키마다 메타가 있고 마감 상태가 §3.6 표와 같다. 미등록 네 키는 PLANNED_KEYS 에 있다', () => {
    expect(Object.keys(CATALOG_META).sort()).toEqual([...new Set(KEYS)].sort())
    const status = (k: string) => CATALOG_META[k as keyof typeof CATALOG_META].status
    // wbs.excel_profile 은 SP4 A2 가 verified 로 올렸다(표준 레이아웃·한 경로 내보내기·표기 — catalog-meta.ts 의 그 행)
    expect(['modules.allowed', 'ai.enabled', 'invites.allowed_domains', 'branding.mail_from_name', 'core.level_labels', 'core.milestone_keywords', 'modules.enabled', 'wbs.excel_profile']
      .map(status)).toEqual(Array(8).fill('verified'))
    expect(['branding.product_name', 'branding.logo', 'branding.accent', 'navigation.menu', 'core.extra_axis_label'].map(status))
      .toEqual(Array(5).fill('stored'))
    // SP5b Z — 크레딧 표와 흐름 다섯은 정의·SQL·승인 액션(W1)·화면 주입·편집기(W2)·합성(Z) 뒤 verified
    expect(['workflow.stage_credits', 'workflow.credit_policy', 'workflow.wbs_stage_labels', 'workflow.approval_steps', 'workflow.approval_distinct_approvers',
      'workflow.predecessor_gate'].map(status)).toEqual(Array(6).fill('verified'))
    // SP5 A 과제 29 — 달력 셋은 정의·편집·소비처·테스트 네 연결이 끝나 verified(스펙 D44)
    expect(['calendar.timezone', 'calendar.working_days', 'calendar.week_start'].map(status)).toEqual(Array(3).fill('verified'))
    expect(PLANNED_KEYS.map((p) => p.key)).toEqual(expect.arrayContaining(['portal.widgets', 'views.default']))
    expect(PLANNED_KEYS.some((p) => KEYS.includes(p.key))).toBe(false)
  })
  it('키마다 라벨·설명 사전 키가 ko·en 둘 다 있다', () => {
    for (const k of KEYS) {
      for (const suffix of ['label', 'desc']) {
        const dictKey = `settings.${k}.${suffix}` as keyof typeof KO
        expect(KO[dictKey], dictKey).toBeTruthy()
        expect((EN as Record<string, string>)[dictKey], dictKey).toBeTruthy()
      }
    }
  })
})
