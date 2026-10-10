// 번호가 아니라 접미로 찾는다(V4) — 창 직전에 번호가 바뀌어도 이 테스트는 그대로다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_PREF_KEYS, RETIRED_PREF_KEYS } from '@/lib/prefs/split'

const dir = (d: string) => join(process.cwd(), d)
/** 이행(SP3b UI-2) 뒤에 처음 생긴 계정 키 — 처음부터 계정 행에만 쓰여 옮길 것이 없다. 새 마이그레이션 없이 키를 더한 차례대로(UI-3 과제 8) */
const ADDED_AFTER_MIGRATION = ['projectsView'] as const
/** 이행은 옮겼지만 그 뒤 코드에서만 폐기한 계정 키 — 마이그레이션 없이 읽기·쓰기만 걷었다(저장된 옛 값은 무시된다). locale: 한국어 전용 결정(2026-10-10) */
const RETIRED_AFTER_MIGRATION: readonly string[] = ['locale']
const find = (d: string, suffix: string) => readdirSync(dir(d)).find((f) => f.endsWith(suffix))

describe('account_preferences 마이그레이션 원문', () => {
  const fwd = find('supabase/migrations', '_account_preferences.sql')
  const rb = find('supabase/rollbacks', '_account_preferences_rollback.sql')
  it('정방향·롤백·리허설 파일이 있고 번호가 같다', () => {
    expect(fwd).toBeDefined(); expect(rb).toBeDefined()
    expect(rb!.slice(0, 4)).toBe(fwd!.slice(0, 4))
    expect(find('supabase/rehearsal', '_account_preferences_seed.sql')?.slice(0, 4)).toBe(fwd!.slice(0, 4))
    expect(find('supabase/rehearsal', '_account_preferences_smoke.sql')?.slice(0, 4)).toBe(fwd!.slice(0, 4))
  })
  it('이행의 계정 키 목록 + 이행 뒤에 새로 생긴 계정 키 = 코드의 ACCOUNT_PREF_KEYS(한쪽만 고치면 키가 워크스페이스 행에 남는다)', () => {
    const text = readFileSync(join(dir('supabase/migrations'), fwd!), 'utf8')
    const m = /-- ACCOUNT_KEYS: ([^\n]+)/.exec(text)
    expect(m, '정방향 파일 머리에 "-- ACCOUNT_KEYS: …" 줄이 있어야 한다').not.toBeNull()
    expect([...m![1].split(',').map((s) => s.trim()).filter((k) => !RETIRED_AFTER_MIGRATION.includes(k)), ...ADDED_AFTER_MIGRATION]).toEqual([...ACCOUNT_PREF_KEYS])
    // 이행 뒤에 생긴 키는 워크스페이스 행에 있던 적이 없다 — 옮길 것이 없으니 이행 원문에 나오지 않아야 한다(옛 키를 여기 숨기지 못하게)
    for (const k of ADDED_AFTER_MIGRATION) expect(text, k).not.toContain(k)
    const migrated = ACCOUNT_PREF_KEYS.filter((k) => !(ADDED_AFTER_MIGRATION as readonly string[]).includes(k))
    for (const k of migrated) expect(text.split(`'${k}'`).length - 1, k).toBeGreaterThanOrEqual(2)   // 이행 + 사후검사
    // 이행이 지운 은퇴 키만 — 이행 뒤 코드에서 폐기한 키는 이행 원문에 '삭제'로 나오지 않는다
    for (const k of RETIRED_PREF_KEYS.filter((k) => !RETIRED_AFTER_MIGRATION.includes(k))) expect(text.split(`'${k}'`).length - 1, k).toBeGreaterThanOrEqual(2)   // 삭제 + 사후검사
    for (const k of RETIRED_AFTER_MIGRATION) expect(RETIRED_PREF_KEYS as readonly string[], k).toContain(k)
    expect(text).toContain('SP3B_ACCOUNT_PREFS_POSTCHECK')
  })
  it('U2a-2 수정(Y2·Y3) — uuid 캐스트는 CASE 가드 안에서만, notifRead 를 재배치하고 롤백이 합친다, 계정 키 이동을 기준값으로 대조한다', () => {
    const text = readFileSync(join(dir('supabase/migrations'), fwd!), 'utf8')
    const rbText = readFileSync(join(dir('supabase/rollbacks'), rb!), 'utf8')
    // '::uuid' 는 모두 'case when … then …::uuid end' 안에 있다 — 술어 평가 순서에 기대지 않는다
    const casts = text.split('\n').filter((l) => l.includes('::uuid') && !l.trim().startsWith('--'))
    expect(casts.length).toBeGreaterThanOrEqual(2)
    for (const l of casts) expect(l, l).toMatch(/case when [^)]*~\* '[^']+' then [^)]*::uuid end/)
    expect(text).toContain("prefs - 'notifRead'")
    expect(text).toMatch(/jsonb_build_object\('notifRead'/)
    expect(rbText).toMatch(/jsonb_build_object\('notifRead'/)
    expect(text).toContain("set_config('sp3b.account_rows_expected'")
    expect(text).toContain("current_setting('sp3b.account_rows_expected'")
  })
})
