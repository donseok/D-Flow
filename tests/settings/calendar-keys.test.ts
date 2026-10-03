// calendar.* 6키(SP5 스펙 §4.2·D6·D44·D54, 개정 §2.8.1·§2.8.2·§2.8.7) — 정의·seedFrom·편집(요일 하나 → 서버가 규칙 목록)·카탈로그·사전.
import { describe, expect, it } from 'vitest'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'
import { CATALOG_META, PLANNED_KEYS } from '@/lib/settings/catalog-meta'
import { copyWeekStartRules, weekStartToStored } from '@/lib/settings/defs/project'
import { settingDef, type EditCtx } from '@/lib/settings/registry'
import { DEFAULT_WEEK_RULES, WEEK_START_DAYS, type WeekStartRule } from '@/lib/domain/calendar'
import { RULES_MON_TO_SUN } from '../fixtures/calendar-golden'

const KEYS = ['calendar.timezone', 'calendar.working_days', 'calendar.week_start'] as const
const MON0: WeekStartRule[] = [{ day: 'monday', from: null }]
const ctx = (over: Partial<Extract<EditCtx, { scope: 'project' }>> = {}): EditCtx =>
  ({ scope: 'project', projectId: '00000000-0000-0000-7e57-0000000019a0', today: '2026-09-23', loadWeekKeys: async () => ['2026-09-21'], ...over })

describe('정의 — 두 스코프에 같은 이름 셋(스펙 §4.2 정의 행)', () => {
  it.each(KEYS)('%s — 워크스페이스·프로젝트 둘 다, 소유 모듈 settings, 즉시 적용', (key) => {
    const ws = settingDef('workspace', key)!, p = settingDef('project', key)!
    expect([ws.scope, ws.module, ws.editor, ws.apply]).toEqual(['workspace', 'settings', 'workspace_admin', 'immediate'])
    expect([p.scope, p.module, p.editor, p.apply]).toEqual(['project', 'settings', 'project_admin', 'immediate'])
    expect(p.seedFrom?.key).toBe(key)                                   // 생성 시 복사(상속 아님)
    expect(ws.seedFrom).toBeUndefined()
    for (const d of [ws, p]) expect(d.parse(d.default), `${d.scope}/${key}`).toMatchObject({ ok: true })
  })
  it('기본값 — UTC·월~금·일요일(워크스페이스는 요일 하나, 프로젝트는 규칙 목록)', () => {
    expect(settingDef('workspace', 'calendar.timezone')!.default).toBe('UTC')
    expect(settingDef('project', 'calendar.timezone')!.default).toBe('UTC')
    expect(settingDef('workspace', 'calendar.working_days')!.default).toEqual([1, 2, 3, 4, 5])
    expect(settingDef('workspace', 'calendar.week_start')!.default).toBe('sunday')
    expect(settingDef('project', 'calendar.week_start')!.default).toEqual(DEFAULT_WEEK_RULES)
  })
  it('위젯 — 워크스페이스 주 시작은 select(일·월 — D6), 나머지는 전용 편집기', () => {
    const w = settingDef('workspace', 'calendar.week_start')!.widget
    expect(w.kind).toBe('select')
    if (w.kind === 'select') {
      expect(w.options.map((o) => o.value)).toEqual([...WEEK_START_DAYS])
      for (const o of w.options) { expect(KO[o.labelKey], o.labelKey).toBeTruthy(); expect((EN as Record<string, string>)[o.labelKey], o.labelKey).toBeTruthy() }
    }
    expect(settingDef('project', 'calendar.week_start')!.widget).toEqual({ kind: 'custom', component: 'WeekStartEditor' })
    expect(settingDef('project', 'calendar.timezone')!.widget).toEqual({ kind: 'custom', component: 'TimezoneSelect' })
    expect(settingDef('project', 'calendar.working_days')!.widget).toEqual({ kind: 'custom', component: 'WorkingDaysEditor' })
  })
  it('SQL 판독 — 근무 요일은 is_workday, 주 시작은 키 함수·트리거·참조 검사(패리티 대상)', () => {
    expect(settingDef('project', 'calendar.working_days')!.sql).toEqual({ readers: ['is_workday'] })
    expect(settingDef('project', 'calendar.week_start')!.sql).toEqual({ readers: ['week_key_of', 'weekly_reports_week_key_guard', 'settings_ref_check'] })
    expect(settingDef('project', 'calendar.timezone')!.sql).toBeNull()
    expect(settingDef('project', 'calendar.week_start')!.impact).toEqual(['future_only', 'recompute'])
  })
  it('검증 — 오프셋 꼴 tz·빈 근무 요일·목록 아닌 규칙은 parse 실패', () => {
    expect(settingDef('project', 'calendar.timezone')!.parse('+09:00').ok).toBe(false)
    expect(settingDef('project', 'calendar.working_days')!.parse([]).ok).toBe(false)
    expect(settingDef('project', 'calendar.week_start')!.parse('sunday').ok).toBe(false)
    expect(settingDef('workspace', 'calendar.week_start')!.parse([{ day: 'sunday', from: null }]).ok).toBe(false)
  })
})

describe('프로젝트 calendar.week_start 의 seedFrom·편집(개정 §2.8.7 — 목록은 서버가 만든다)', () => {
  const def = settingDef('project', 'calendar.week_start')!
  it('생성 = [{ day: <워크스페이스 요일>, from: null }]', () => {
    expect(def.seedFrom!.map!('monday')).toEqual([{ day: 'monday', from: null }])
    expect(def.seedFrom!.map!('sunday')).toEqual([{ day: 'sunday', from: null }])
  })
  it('복사 = [{ day: <원본 마지막 규칙의 day>, from: null }] — 전환 이력은 옮기지 않는다', () => {
    expect(copyWeekStartRules(RULES_MON_TO_SUN)).toEqual([{ day: 'sunday', from: null }])
    expect(copyWeekStartRules(MON0)).toEqual(MON0)
  })
  it('편집 입력은 요일 하나 — 목록을 보내면 parseInput 실패(CONFIG_INVALID)', () => {
    expect(def.edit!.parseInput('sunday')).toEqual({ ok: true, value: 'sunday' })
    expect(def.edit!.parseInput(RULES_MON_TO_SUN).ok).toBe(false)
  })
  it('toStored — 문서가 있으면 다음 주부터의 전환, 0건이면 교체', async () => {
    expect(await weekStartToStored(MON0, 'sunday', ctx())).toEqual({ ok: true, value: RULES_MON_TO_SUN })
    expect(await weekStartToStored(MON0, 'sunday', ctx({ loadWeekKeys: async () => [] }))).toEqual({ ok: true, value: [{ day: 'sunday', from: null }] })
    expect(await weekStartToStored(undefined, 'monday', ctx({ loadWeekKeys: async () => [] }))).toEqual({ ok: true, value: MON0 })
  })
  it('toStored 는 fail-closed — 워크스페이스 문맥·오늘 없음·문서 키 판독기 없음은 실패, 판독 오류는 그대로 던진다', async () => {
    expect((await weekStartToStored(MON0, 'sunday', { scope: 'workspace', workspaceId: 'w' })).ok).toBe(false)
    expect((await weekStartToStored(MON0, 'sunday', ctx({ today: '' }))).ok).toBe(false)
    expect((await weekStartToStored(MON0, 'sunday', ctx({ loadWeekKeys: undefined }))).ok).toBe(false)
    await expect(weekStartToStored(MON0, 'sunday', ctx({ loadWeekKeys: async () => { throw new Error('판독 실패') } }))).rejects.toThrow('판독 실패')
  })
})

describe('카탈로그·사전(D44 — 들어가는 체크포인트에서 planned 를 벗는다)', () => {
  it('PLANNED_KEYS 에 calendar.* 가 없고, 남은 SP5 행은 체크포인트 이름(B1~B4)으로 적혀 있다', () => {
    expect(PLANNED_KEYS.filter((p) => p.key.startsWith('calendar.'))).toEqual([])
    const sp5 = PLANNED_KEYS.filter((p) => p.sp.startsWith('SP5 '))
    expect(sp5.length).toBe(8)   // SP5 B1 과제 3 이 issues.id_policy·issues.analysis 를 등록해 10 → 8
    for (const p of sp5) expect(p.sp, p.key).toMatch(/^SP5 B[1-4]$/)
  })
  it.each(KEYS)('%s — 메타는 SP5 A·verified(과제 29 — 정의·편집·소비처·테스트 네 연결)', (key) => {
    expect(CATALOG_META[key]).toMatchObject({ status: 'verified', sp: 'SP5 A' })
  })
  it('라벨·설명 사전이 ko·en 둘 다 있다', () => {
    for (const key of KEYS) for (const s of ['label', 'desc']) {
      const k = `settings.${key}.${s}` as keyof typeof KO
      expect(KO[k], k).toBeTruthy(); expect((EN as Record<string, string>)[k], k).toBeTruthy()
    }
  })
})
