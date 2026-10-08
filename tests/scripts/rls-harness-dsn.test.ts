// RLS 하네스의 접속 대상 — 체크아웃의 supabase/config.toml [db] port 를 따른다(전용 스택을 띄운 워크트리가 메인 스택에 붙지 않게).
import { describe, expect, it } from 'vitest'
import { LOCAL_DSN } from '../../scripts/lib/targets.mjs'
import { PROTECTED_DB_MARK, assertNotProtected, configDsn } from '../rls/harness'

const toml = (db: string) => `project_id = "x"\n\n[api]\nport = 54521\n\n[db]\n${db}\n\n[db.pooler]\nport = 54529\n\n[studio]\nport = 54523\n`

describe('configDsn', () => {
  it('[db] port 를 쓴다 — [api]·[db.pooler] 의 port 는 보지 않는다', () => {
    expect(configDsn(toml('# Port\nport = 54522\nshadow_port = 54520'))).toBe('postgresql://postgres:postgres@127.0.0.1:54522/postgres')
  })
  it('[db] 절이나 port 가 없으면 LOCAL_DSN', () => {
    expect(configDsn('[api]\nport = 54521\n')).toBe(LOCAL_DSN)
    expect(configDsn(toml('shadow_port = 54520'))).toBe(LOCAL_DSN)
  })
})

describe('assertNotProtected', () => {
  const pool = (rows: Array<{ mark: string | null }>) => ({ query: async () => ({ rows }) }) as never
  it('표식이 없으면 지난다', async () => {
    await expect(assertNotProtected(pool([{ mark: null }]))).resolves.toBeUndefined()
    await expect(assertNotProtected(pool([{ mark: 'other' }]))).resolves.toBeUndefined()
  })
  it('표식이 있으면 멈춘다 — 표식을 못 읽어도 멈춘다', async () => {
    await expect(assertNotProtected(pool([{ mark: `x ${PROTECTED_DB_MARK}` }]))).rejects.toThrow(PROTECTED_DB_MARK)
    await expect(assertNotProtected(pool([]))).rejects.toThrow('표식')
  })
})
