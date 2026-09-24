import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const MIG = join(process.cwd(), 'supabase/migrations')
const RB = join(process.cwd(), 'supabase/rollbacks')
const list = (d: string) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.sql')) : [])
const NO_ROLLBACK = new Set(['0000_baseline.sql']) // pg_dump 기준선 — 되돌아갈 이전 상태가 없다

describe('마이그레이션 파일 규약', () => {
  const forward = list(MIG)
  it('supabase/migrations 에 롤백 파일이 없다(CLI 가 함께 적용한다)', () => {
    expect(forward.filter((f) => f.includes('_rollback'))).toEqual([])
  })
  it('이름은 NNNN_snake.sql', () => {
    expect(forward.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toEqual([])
  })
  it('번호는 파일 단위로 유일', () => {
    const nums = forward.map((f) => f.slice(0, 4))
    expect(nums.filter((n, i) => nums.indexOf(n) !== i)).toEqual([])
  })
  it('정방향마다 롤백 쌍(0000 제외)', () => {
    const rbs = new Set(list(RB))
    const missing = forward.filter((f) => !NO_ROLLBACK.has(f) && !rbs.has(f.replace(/\.sql$/, '_rollback.sql')))
    expect(missing).toEqual([])
  })
  it('짝 없는 롤백이 없다', () => {
    const fw = new Set(forward)
    expect(list(RB).filter((r) => !fw.has(r.replace(/_rollback\.sql$/, '.sql')))).toEqual([])
  })
})
