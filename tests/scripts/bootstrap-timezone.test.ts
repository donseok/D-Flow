// dev:bootstrap 의 BOOTSTRAP_TIMEZONE(스펙 D13 ②·W19) — 새 워크스페이스에는 늘 기록(기본 UTC), 다시 돌릴 때는 명시했을 때만 덮는다(BOOTSTRAP_MODULES 관례).
// 값 검증은 calendar.ts parseTimezone 의 .mjs 사본이다 — 골든 표본 전부에서 두 판정이 같아야 한다(사본이 갈라지면 여기서 잡는다).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BOOTSTRAP_TIMEZONE, bootstrapTimezonePlan, parseBootstrapTimezone } from '../../scripts/lib/bootstrap-timezone.mjs'
import { parseTimezone } from '@/lib/domain/calendar'
import { GOLDEN_TZ_NAMES, GOLDEN_TZ_REJECT } from '../fixtures/calendar-golden'

describe('parseBootstrapTimezone', () => {
  it('없으면 UTC(제품 기본값과 같다)', () => {
    expect(DEFAULT_BOOTSTRAP_TIMEZONE).toBe('UTC')
    expect(parseBootstrapTimezone(undefined)).toEqual({ ok: true, value: 'UTC' })
  })
  it('빈 문자열·공백은 거부 — 조용히 UTC 로 바꾸지 않는다', () => {
    expect(parseBootstrapTimezone('').ok).toBe(false)
    expect(parseBootstrapTimezone('   ').ok).toBe(false)
  })
  it.each(['+09:00', 'GMT+1', 'Asia/Seol'])('%j 는 거부(오프셋 꼴·없는 이름 — D54·R5)', (bad) => {
    expect(parseBootstrapTimezone(bad).ok).toBe(false)
  })
  it('대소문자는 정규화한 표기로, 별칭은 고른 이름 그대로(J2)', () => {
    expect(parseBootstrapTimezone('utc')).toEqual({ ok: true, value: 'UTC' })
    expect(parseBootstrapTimezone('asia/seoul')).toEqual({ ok: true, value: 'Asia/Seoul' })
    expect(parseBootstrapTimezone('Asia/Kolkata')).toEqual({ ok: true, value: 'Asia/Kolkata' })
  })
  it.each(['EST', 'GMT0', 'PST', 'IST'])('"/" 없는 허용 밖 이름 %j 는 거부(L1)', (bad) => {
    expect(parseBootstrapTimezone(bad).ok).toBe(false)
  })
})

describe('parseTimezone 과 같은 판정(사본 대조)', () => {
  // L1('/' 없는 이름 닫힌 허용 목록)·J2(별칭 보존 — Asia/Kolkata·Europe/Kyiv 는 골든에 있다) 표본을 더한다
  it.each([...GOLDEN_TZ_NAMES, ...GOLDEN_TZ_REJECT, 'utc', 'gmt', 'EST', 'GMT0', 'PST', 'CET', 'IST', 'NST', 'EST5EDT', 'pst8pdt', 'Etc/UTC', 'asia/seoul', ' Asia/Seoul ', 'UTC+9', '\u22129'])('%j', (raw) => {
    const ts = parseTimezone(raw)
    const mjs = parseBootstrapTimezone(raw)
    expect(mjs.ok).toBe(ts.ok)
    if (ts.ok && mjs.ok) expect(mjs.value).toBe(ts.value)
  })
})

describe('bootstrapTimezonePlan — 재실행 규칙', () => {
  it('새 워크스페이스(값 없음)는 env 가 없어도 기본값을 기록한다', () => {
    expect(bootstrapTimezonePlan({ envValue: undefined, existingValues: {} })).toEqual({ ok: true, write: true, value: 'UTC' })
    expect(bootstrapTimezonePlan({ envValue: undefined, existingValues: null })).toEqual({ ok: true, write: true, value: 'UTC' })
  })
  it('기존 값이 있고 env 를 주지 않았으면 그대로 둔다(설정 화면에서 바꾼 값을 되돌리지 않는다)', () => {
    expect(bootstrapTimezonePlan({ envValue: undefined, existingValues: { 'calendar.timezone': 'Europe/Berlin' } }))
      .toEqual({ ok: true, write: false, value: 'UTC' })
  })
  it('env 를 명시하면 기존 값을 덮는다', () => {
    expect(bootstrapTimezonePlan({ envValue: 'America/Los_Angeles', existingValues: { 'calendar.timezone': 'Europe/Berlin' } }))
      .toEqual({ ok: true, write: true, value: 'America/Los_Angeles' })
  })
  it('잘못된 값은 쓰기 판정 전에 실패', () => {
    expect(bootstrapTimezonePlan({ envValue: '+09:00', existingValues: {} })).toMatchObject({ ok: false })
  })
})

describe('dev-bootstrap.mjs 의 배선(정적) — 계정 전에 검증, 설정 RPC 한 길', () => {
  const src = readFileSync('scripts/dev-bootstrap.mjs', 'utf8')
  it('BOOTSTRAP_TIMEZONE 을 계정 생성보다 먼저 검증한다', () => {
    const parse = src.indexOf('parseBootstrapTimezone(process.env.BOOTSTRAP_TIMEZONE)')
    const createUser = src.indexOf('auth.admin.createUser')
    expect(parse).toBeGreaterThan(-1)
    expect(parse).toBeLessThan(createUser)
  })
  it('시간대는 apply_workspace_settings 로만 쓴다(설정 표 직접 쓰기 0)', () => {
    expect(src).toContain("bootstrapTimezonePlan(")
    expect(src).toMatch(/set\['calendar\.timezone'\]\s*=/)
    expect(src).not.toMatch(/from\('workspace_settings'\)\.(update|upsert|insert)/)
  })
})
