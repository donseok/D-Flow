// 번호가 아니라 접미로 찾는다(V4) — 창 직전에 번호가 바뀌어도 이 테스트는 그대로다.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCOUNT_PREF_KEYS, RETIRED_PREF_KEYS } from '@/lib/prefs/split'

const dir = (d: string) => join(process.cwd(), d)
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
  it('이행의 계정 키 목록 = 코드의 ACCOUNT_PREF_KEYS(한쪽만 고치면 키가 워크스페이스 행에 남는다)', () => {
    const text = readFileSync(join(dir('supabase/migrations'), fwd!), 'utf8')
    const m = /-- ACCOUNT_KEYS: ([^\n]+)/.exec(text)
    expect(m, '정방향 파일 머리에 "-- ACCOUNT_KEYS: …" 줄이 있어야 한다').not.toBeNull()
    expect(m![1].split(',').map((s) => s.trim())).toEqual([...ACCOUNT_PREF_KEYS])
    for (const k of ACCOUNT_PREF_KEYS) expect(text.split(`'${k}'`).length - 1, k).toBeGreaterThanOrEqual(2)   // 이행 + 사후검사
    for (const k of RETIRED_PREF_KEYS) expect(text.split(`'${k}'`).length - 1, k).toBeGreaterThanOrEqual(2)   // 삭제 + 사후검사
    expect(text).toContain('SP3B_ACCOUNT_PREFS_POSTCHECK')
  })
})
