// supabase/rehearsal/compare-catalog.mjs 의 컨테이너 선택(계획 P10, 스펙 D42·K2) — 리허설이 전용 스택 DSN 을 받고도 메인 스택(사용자
// 데이터) 컨테이너의 카탈로그를 뜨지 않게 한다. CLI 본체는 import 때 돌지 않는다(테스트·다른 스크립트가 함수만 쓴다).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FORBIDDEN_REFS } from '../../scripts/lib/targets.mjs'
import { MAIN_STACK, dbContainer, hostPortOf } from '../../supabase/rehearsal/compare-catalog.mjs'

const dsn = (port: string) => `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`

afterEach(() => { vi.restoreAllMocks() })

describe('dbContainer — 리허설 도구가 붙을 DB 컨테이너', () => {
  // 컨테이너 → 그 5432/tcp 가 열린 호스트 포트(docker port). 실제 docker 대신 표로 흉내 낸다
  const ports = (m: Record<string, string>) => vi.fn((c: string) => {
    if (!Object.hasOwn(m, c)) throw new Error(`docker port ${c} 실패: No such container`)
    return m[c]
  })
  const STACKS = { 'supabase_db_lane-a-sp4': '54522', 'supabase_db_lane.b_2': '54422', [MAIN_STACK.container]: '54322' }

  it('[K7] SUPABASE_DB_CONTAINER 가 있으면 그 컨테이너 — 단 그 컨테이너의 호스트 포트가 DSN 포트와 같을 때만', () => {
    const p = ports(STACKS)
    expect(dbContainer({ SUPABASE_DB_CONTAINER: 'supabase_db_lane-a-sp4', LOCAL_DB_URL: dsn('54522') }, p)).toBe('supabase_db_lane-a-sp4')
    expect(dbContainer({ SUPABASE_DB_CONTAINER: 'supabase_db_lane.b_2', LOCAL_DB_URL: dsn('54422') }, p)).toBe('supabase_db_lane.b_2')
    expect(p).toHaveBeenCalledWith('supabase_db_lane-a-sp4')
  })

  it('[K7] 남은 env 가 메인 컨테이너를 가리키고 DSN 은 전용 스택이면 throw — 엉뚱한 DB 끼리 대조·사용자 DB 에 롤백하지 않는다', () => {
    const p = ports(STACKS)
    const e = { SUPABASE_DB_CONTAINER: MAIN_STACK.container, LOCAL_DB_URL: dsn('54522') }
    expect(() => dbContainer(e, p)).toThrow(`${MAIN_STACK.container} 의 DB 포트 54322 ≠ DSN 포트 54522`)
  })

  it('[K7] 전용 컨테이너 이름 + DSN 없음(기본 = 메인 54322)도 throw — 이름과 DSN 이 어긋난다', () => {
    expect(() => dbContainer({ SUPABASE_DB_CONTAINER: 'supabase_db_lane-a-sp4' }, ports(STACKS))).toThrow('54522 ≠ DSN 포트 54322')
  })

  it('[K7] 포트를 확인하지 못하면(컨테이너 없음) throw — 확인 없이 믿지 않는다', () => {
    expect(() => dbContainer({ SUPABASE_DB_CONTAINER: 'supabase_db_gone', LOCAL_DB_URL: dsn('54522') }, ports(STACKS))).toThrow('No such container')
  })

  it('접두가 다르거나 공백·빈 꼬리면 throw — 다른 프로젝트의 컨테이너에 붙지 않는다(docker 에 묻기 전에)', () => {
    const p = ports(STACKS)
    for (const bad of ['pms-app', 'supabase_rest_d-flow-sp4', ' supabase_db_x', 'supabase_db_x y', 'supabase_db_', 'supabase_db_x;rm']) {
      expect(() => dbContainer({ SUPABASE_DB_CONTAINER: bad }, p), bad).toThrow('SUPABASE_DB_CONTAINER')
    }
    expect(p).not.toHaveBeenCalled()
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

describe('hostPortOf — docker port <c> 5432/tcp 출력의 호스트 포트', () => {
  it('IPv4·IPv6 두 줄이 같은 포트면 그 포트', () => {
    expect(hostPortOf('0.0.0.0:54522\n[::]:54522\n')).toBe('54522')
    expect(hostPortOf('127.0.0.1:54322')).toBe('54322')
  })
  it('비었거나 포트가 둘 이상이면 throw', () => {
    expect(() => hostPortOf('')).toThrow('호스트 포트')
    expect(() => hostPortOf('0.0.0.0:54522\n[::]:54322')).toThrow('호스트 포트')
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
