import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 가드 스크립트의 배선 — 임시 디렉터리의 가짜 .env 파일로 돌린다. 거절 경로와 판정만 보며 접속하지 않는다.
const ROOT = resolve(__dirname, '../..')
const FORBIDDEN = 'https://rglfgrwwwwdqejohdnty.supabase.co'
const REMOTE = 'https://abcdefghijklmnopqrst.supabase.co'
const LOCAL = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SERVICE_ROLE_KEY=svc\n'
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dflow-env-guard-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const run = (script: string, files: Record<string, string>, extraEnv: Record<string, string> = {}) => {
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  // 부모(vitest)의 NODE_ENV=test 는 Next 로더가 .env.local 을 건너뛰게 한다 — npm run dev 와 같은 조건으로 지운다.
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const k of ['NODE_ENV', 'NEXT_PUBLIC_SUPABASE_URL', '__NEXT_PROCESSED_ENV', 'PROD_REF', 'STAGING_REF', 'FORCE_PROD_DEV',
    'BOOTSTRAP_EMAIL', 'BOOTSTRAP_PASSWORD']) delete env[k]
  Object.assign(env, extraEnv)
  const r = spawnSync(process.execPath, [join(ROOT, script)], { cwd: dir, env, input: '', encoding: 'utf8', timeout: 20_000 })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}
const predev = (files: Record<string, string>, extraEnv?: Record<string, string>) => run('scripts/check-env-target.mjs', files, extraEnv)

describe('check-env-target.mjs (predev) — Next 로더가 실제로 쓸 값을 판정한다', () => {
  it('로컬 한 줄이면 통과', () => {
    const r = predev({ '.env.local': LOCAL })
    expect(r.code).toBe(0)
    expect(r.out).toContain('dev 대상: local')
  })
  it('NEXT_PUBLIC_SUPABASE_URL 이 두 번이면 멈춘다', () => {
    const r = predev({ '.env.local': `${LOCAL}NEXT_PUBLIC_SUPABASE_URL=${REMOTE}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/\.env\.local 에 NEXT_PUBLIC_SUPABASE_URL 이 두 번 이상/)
  })
  it('[ENV.j-1] NBSP 로 들여쓴 줄로 덧붙인 URL — 금지 ref 면 차단, 원격이면 모호로 멈춘다', () => {
    expect(predev({ '.env.local': `${LOCAL}\u00A0NEXT_PUBLIC_SUPABASE_URL=${FORBIDDEN}\n` }).out).toMatch(/차단: \.env\.local 에 원본 DB 좌표/)
    const r = predev({ '.env.local': `${LOCAL}\u00A0NEXT_PUBLIC_SUPABASE_URL=${REMOTE}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/두 번 이상/)
  })
  it('[ENV.j-2] NBSP 를 = 앞에 둔 키도 같은 키로 본다', () => {
    const r = predev({ '.env.local': `${LOCAL}NEXT_PUBLIC_SUPABASE_URL\u00A0=${REMOTE}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/두 번 이상/)
  })
  it('[ENV.j-3] 외톨이 CR 로 이어 붙인 줄', () => {
    const joined = (url: string) => `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\rNEXT_PUBLIC_SUPABASE_URL=${url}\n`
    const f = predev({ '.env.local': joined(FORBIDDEN) })
    expect(f.code).toBe(1)
    expect(f.out).toMatch(/차단/)
    const r = predev({ '.env.local': joined(REMOTE) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/두 번 이상/)
  })
  it('[ENV.j-4] U+2028 로 끝난 줄 뒤의 키', () => {
    const tail = (url: string) => `${LOCAL}X='a'\u2028NEXT_PUBLIC_SUPABASE_URL=${url}\n`
    expect(predev({ '.env.local': tail(FORBIDDEN) }).out).toMatch(/차단/)
    const r = predev({ '.env.local': tail(REMOTE) })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/두 번 이상/)
  })
  it('[ENV.j-5] .env.development.local 이 .env.local 을 이기면 그 값을 판정한다', () => {
    const r = predev({ '.env.local': LOCAL, '.env.development.local': `NEXT_PUBLIC_SUPABASE_URL=${REMOTE}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/출처: \.env\.development\.local/)
    expect(predev({ '.env.local': LOCAL, '.env.development.local': `NEXT_PUBLIC_SUPABASE_URL=${FORBIDDEN}\n` }).out)
      .toMatch(/차단: \.env\.development\.local/)
  })
  it('[ENV.j-6] 셸 환경변수가 파일을 이기면 그 값을 판정한다', () => {
    const r = predev({ '.env.local': LOCAL }, { NEXT_PUBLIC_SUPABASE_URL: REMOTE })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/출처: 셸 환경변수/)
    expect(predev({ '.env.local': LOCAL }, { NEXT_PUBLIC_SUPABASE_URL: FORBIDDEN }).out).toMatch(/차단: 셸 환경변수/)
    expect(predev({ '.env.local': LOCAL }, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }).code).toBe(0)
  })
  it('쓰이지 않는 파일·주석의 금지 ref 도 멈춘다', () => {
    expect(predev({ '.env.local': LOCAL, '.env': `# 예전 ${FORBIDDEN}\n` }).out).toMatch(/차단: \.env 에/)
  })
  it('[ENV.i] 값에 TAB 이 낀 로컬 흉내 URL 은 판독 불가', () => {
    const r = predev({ '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=http://localhost\t.example.com\n' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/판독 불가/)
  })
})

describe('dev-bootstrap.mjs — 접속 전 거절과 원인별 처방', () => {
  const boot = (files: Record<string, string>, extraEnv?: Record<string, string>) => run('scripts/dev-bootstrap.mjs', files, extraEnv)
  it('[F1] 로컬 줄 뒤에 원격 URL 이 덧붙으면 거절 — 남는 줄을 지우라고 한다', () => {
    const r = boot({ '.env.local': `${LOCAL}NEXT_PUBLIC_SUPABASE_URL=${REMOTE}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/NEXT_PUBLIC_SUPABASE_URL 가 두 번 이상/)
    expect(r.out).toMatch(/남는 줄을 지우고 KEY=값 한 줄만 남긴다/)
  })
  it('금지 ref 가 주석에만 있어도 거절 — 언급하는 줄·주석을 모두 지우라고 한다', () => {
    const r = boot({ '.env.local': `${LOCAL}# ${FORBIDDEN}\n` })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/언급하는 줄·주석을 모두 지운다/)
  })
  it('.env.local 이 없거나 서비스 키가 없으면 env:local 로 다시 만들라고 한다', () => {
    const none = boot({})
    expect(none.code).toBe(1)
    expect(none.out).toMatch(/npm run env:local/)
    const r = boot({ '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/SUPABASE_SERVICE_ROLE_KEY 가 없다.*npm run env:local/)
  })
  it('[ENV.i] TAB 이 낀 URL 은 로컬이 아니다', () => {
    const r = boot({ '.env.local': 'NEXT_PUBLIC_SUPABASE_URL=http://localhost\t.example.com\nSUPABASE_SERVICE_ROLE_KEY=svc\n' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/로컬이 아니다/)
  })
  it('비밀번호가 8자 미만이면 계정을 만들기 전에 거절', () => {
    const r = boot({ '.env.local': LOCAL }, { BOOTSTRAP_EMAIL: 'a@example.com', BOOTSTRAP_PASSWORD: 'short7!' })
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/8자 이상/)
  })
})

describe('wiki-health.mjs — 접속 전 거절', () => {
  // service_role 로 PostgREST 를 읽는 스크립트다 — dev-bootstrap 과 같은 localAdminEnv 관문을 지나야 한다.
  const health = (files: Record<string, string>, extraEnv?: Record<string, string>) => run('scripts/wiki-health.mjs', files, extraEnv)
  it('금지 ref 가 주석에만 있어도 거절 — 언급하는 줄·주석을 모두 지우라고 한다', () => {
    const r = health({ '.env.local': `${LOCAL}# ${FORBIDDEN}\n` })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/언급하는 줄·주석을 모두 지운다/)
  })
  it('금지되지 않은 원격 URL 도 로컬이 아니라 거절', () => {
    const r = health({ '.env.local': `NEXT_PUBLIC_SUPABASE_URL=${REMOTE}\nSUPABASE_SERVICE_ROLE_KEY=svc\n` })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/로컬이 아니다/)
  })
  it('.env.local 이 없으면 env:local 로 다시 만들라고 한다', () => {
    const r = health({})
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/npm run env:local/)
  })
  it('셸 환경변수는 .env.local 을 대신하지 못한다 — 파일이 없으면 셸 값이 있어도 거절', () => {
    const r = health({}, { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'svc' })
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/npm run env:local/)
  })
})
