// supabase/rehearsal/compare-catalog.mjs 의 컨테이너 선택(계획 P10, 스펙 D42·K2) — 리허설이 전용 스택 DSN 을 받고도 메인 스택(사용자
// 데이터) 컨테이너의 카탈로그를 뜨지 않게 한다. CLI 본체는 import 때 돌지 않는다(테스트·다른 스크립트가 함수만 쓴다).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FORBIDDEN_REFS } from '../../scripts/lib/targets.mjs'
import { MAIN_STACK, dbContainer } from '../../supabase/rehearsal/compare-catalog.mjs'

const dsn = (port: string) => `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`

afterEach(() => { vi.restoreAllMocks() })

describe('dbContainer — 리허설 도구가 붙을 DB 컨테이너', () => {
  it('SUPABASE_DB_CONTAINER 가 있으면 그 컨테이너 — DSN 포트와 무관하다', () => {
    expect(dbContainer({ SUPABASE_DB_CONTAINER: 'supabase_db_lane-a-sp4', LOCAL_DB_URL: dsn('54522') })).toBe('supabase_db_lane-a-sp4')
    expect(dbContainer({ SUPABASE_DB_CONTAINER: 'supabase_db_lane.b_2' })).toBe('supabase_db_lane.b_2')
  })

  it('접두가 다르거나 공백·빈 꼬리면 throw — 다른 프로젝트의 컨테이너에 붙지 않는다', () => {
    for (const bad of ['pms-app', 'supabase_rest_d-flow-sp4', ' supabase_db_x', 'supabase_db_x y', 'supabase_db_', 'supabase_db_x;rm']) {
      expect(() => dbContainer({ SUPABASE_DB_CONTAINER: bad }), bad).toThrow('SUPABASE_DB_CONTAINER')
    }
  })

  it('env 가 없고 DSN 도 없으면 기본 DSN(메인 스택 54322)이라 메인 컨테이너', () => {
    expect(MAIN_STACK.dbPort).toBe('54322')
    expect(dbContainer({})).toBe(MAIN_STACK.container)
  })

  it('env 가 빈 문자열이면 없는 것과 같다', () => {
    expect(dbContainer({ SUPABASE_DB_CONTAINER: '', LOCAL_DB_URL: dsn('54322') })).toBe(MAIN_STACK.container)
  })

  it('env 가 없고 LOCAL_DB_URL 이 메인 스택(54322)이면 메인 컨테이너', () => {
    expect(dbContainer({ LOCAL_DB_URL: dsn('54322') })).toBe(MAIN_STACK.container)
  })

  it('env 가 없고 LOCAL_DB_URL 이 전용 스택(54522)이면 throw — 전용 DSN 에 메인 컨테이너를 짝짓지 않는다', () => {
    expect(() => dbContainer({ LOCAL_DB_URL: dsn('54522') })).toThrow('SUPABASE_DB_CONTAINER')
    expect(() => dbContainer({ LOCAL_DB_URL: dsn('54522') })).toThrow('54522')
  })

  it('금지 ref 가 든 DSN 은 throw — 원본 DB 금지(scripts/lib/targets.mjs)', () => {
    expect(() => dbContainer({ LOCAL_DB_URL: `postgresql://postgres:x@db.${FORBIDDEN_REFS[0]}.supabase.co:5432/postgres` }))
      .toThrow('금지된 원본 DB 좌표')
  })
})

describe('CLI 본체', () => {
  it('import 때 돌지 않는다 — 사용법 오류를 찍거나 exitCode 를 바꾸지 않는다', async () => {
    vi.resetModules()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const before = process.exitCode
    await import('../../supabase/rehearsal/compare-catalog.mjs')
    expect(err).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(before)
  })
})
