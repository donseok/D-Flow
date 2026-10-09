// 원격 첫 부트스트랩의 순수 부분 — 인자·대상 해석(금지 대상 거부)·멱등 판정·입력 검증·실행 전 출력.
// 스크립트 본체(scripts/bootstrap-remote.mjs)는 원격이 없어 실행해 보지 못한다 — 원문 검사로 가드·비밀값 취급만 고정한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MIN_PASSWORD, bootstrapDecision, bootstrapInputProblems, bootstrapPlanLines, parseBootstrapArgs, resolveBootstrapTarget,
} from '../../scripts/lib/bootstrap-remote.mjs'
import { FORBIDDEN_REFS } from '../../scripts/lib/targets.mjs'

const STG = 'stgrefstgrefstgrefst'
const PRD = 'prdrefprdrefprdrefpr'
const ENV = { STAGING_REF: STG, PROD_REF: PRD }

describe('parseBootstrapArgs', () => {
  it('--target 필수, --yes 는 선택, 순서 무관', () => {
    expect(parseBootstrapArgs(['--target', 'staging'])).toEqual({ ok: true, target: 'staging', yes: false })
    expect(parseBootstrapArgs(['--yes', '--target', 'prod'])).toEqual({ ok: true, target: 'prod', yes: true })
    expect(parseBootstrapArgs([])).toMatchObject({ ok: false })
    expect(parseBootstrapArgs(['--target'])).toMatchObject({ ok: false })
    expect(parseBootstrapArgs(['--target', '--yes'])).toMatchObject({ ok: false })
  })
  it('모르는 인자는 거부 — 금지 대상 검사를 끄는 플래그 같은 것은 없다', () => {
    for (const extra of ['--force', '--allow-forbidden', '--skip-guard', '--password=x', 'staging']) {
      expect(parseBootstrapArgs(['--target', 'staging', extra]), extra).toMatchObject({ ok: false })
    }
  })
})

describe('resolveBootstrapTarget', () => {
  it('ref 로 Supabase 주소를 만든다', () => {
    expect(resolveBootstrapTarget('staging', ENV)).toEqual({ name: 'staging', ref: STG, url: `https://${STG}.supabase.co`, host: `${STG}.supabase.co` })
    expect(resolveBootstrapTarget('prod', ENV)).toMatchObject({ name: 'prod', ref: PRD, url: `https://${PRD}.supabase.co` })
  })
  it('자체호스트 — BOOTSTRAP_SUPABASE_URL 을 쓰되 그 주소가 대상의 ref 를 담아야 한다', () => {
    const env = { PROD_REF: 'supabase.corp.example', BOOTSTRAP_SUPABASE_URL: 'https://supabase.corp.example/' }
    expect(resolveBootstrapTarget('prod', env)).toEqual({ name: 'prod', ref: 'supabase.corp.example', url: 'https://supabase.corp.example', host: 'supabase.corp.example' })
    expect(() => resolveBootstrapTarget('prod', { ...env, BOOTSTRAP_SUPABASE_URL: 'https://other.corp.example' })).toThrow(/어긋난다/)
  })
  it('local 과 모르는 대상은 거부', () => {
    expect(() => resolveBootstrapTarget('local', ENV)).toThrow(/dev:bootstrap/)
    expect(() => resolveBootstrapTarget('production', ENV)).toThrow(/staging\|prod/)
    expect(() => resolveBootstrapTarget(undefined as never, ENV)).toThrow(/staging\|prod/)
  })
  it('ref 가 없으면 멈춘다(fail-closed) — 짐작한 주소로 붙지 않는다', () => {
    expect(() => resolveBootstrapTarget('staging', {})).toThrow(/STAGING_REF 미설정/)
    expect(() => resolveBootstrapTarget('prod', { STAGING_REF: STG })).toThrow(/PROD_REF 미설정/)
  })
  it.each(FORBIDDEN_REFS)('금지 ref(원본 DB) 는 ref 로도 주소로도 거부 — %s', (forbidden) => {
    expect(() => resolveBootstrapTarget('prod', { PROD_REF: forbidden })).toThrow(/금지/)
    expect(() => resolveBootstrapTarget('staging', { STAGING_REF: forbidden })).toThrow(/금지/)
    expect(() => resolveBootstrapTarget('prod', { PROD_REF: PRD, BOOTSTRAP_SUPABASE_URL: `https://${forbidden}.supabase.co` })).toThrow(/금지/)
    // 보이지 않는 문자로 쪼갠 ref 도
    expect(() => resolveBootstrapTarget('prod', { PROD_REF: PRD, BOOTSTRAP_SUPABASE_URL: `https://${forbidden.slice(0, 5)}​${forbidden.slice(5)}.supabase.co` })).toThrow(/금지/)
  })
  it('주소가 다른 대상을 가리키면 거부 — 스테이징이라 부르고 운영에 붙지 않는다', () => {
    expect(() => resolveBootstrapTarget('staging', { ...ENV, BOOTSTRAP_SUPABASE_URL: `https://${PRD}.supabase.co` })).toThrow(/어긋난다/)
    expect(() => resolveBootstrapTarget('prod', { ...ENV, BOOTSTRAP_SUPABASE_URL: `https://${STG}.supabase.co` })).toThrow(/어긋난다/)
  })
  it('로컬 주소·평문 http·계정 정보가 든 주소·URL 아님은 거부', () => {
    expect(() => resolveBootstrapTarget('prod', { ...ENV, BOOTSTRAP_SUPABASE_URL: 'https://127.0.0.1:54321' })).toThrow(/로컬/)
    expect(() => resolveBootstrapTarget('prod', { ...ENV, BOOTSTRAP_SUPABASE_URL: `http://${PRD}.supabase.co` })).toThrow(/https/)
    expect(() => resolveBootstrapTarget('prod', { ...ENV, BOOTSTRAP_SUPABASE_URL: `https://user:pw@${PRD}.supabase.co` })).toThrow(/계정 정보/)
    expect(() => resolveBootstrapTarget('prod', { ...ENV, BOOTSTRAP_SUPABASE_URL: 'not a url' })).toThrow(/URL 이 아니다/)
  })
})

describe('bootstrapDecision — 멱등', () => {
  it('플랫폼 관리자가 이미 있으면 skip(아무것도 하지 않는다)', () => {
    expect(bootstrapDecision({ count: 1, error: null })).toMatchObject({ action: 'skip' })
    expect(bootstrapDecision({ count: 7 })).toMatchObject({ action: 'skip' })
  })
  it('0명일 때만 proceed', () => { expect(bootstrapDecision({ count: 0, error: null })).toMatchObject({ action: 'proceed' }) })
  it('수를 읽지 못했으면 abort — 모르는 채로 만들지 않는다', () => {
    expect(bootstrapDecision({ count: null, error: { message: 'boom' } })).toMatchObject({ action: 'abort' })
    expect(bootstrapDecision({ count: 0, error: { message: 'boom' } })).toMatchObject({ action: 'abort' })
    for (const count of [null, undefined, -1, 1.5, Number.NaN, '0' as never]) expect(bootstrapDecision({ count }), String(count)).toMatchObject({ action: 'abort' })
  })
})

describe('bootstrapInputProblems', () => {
  const ok = { email: 'admin@example.com', password: 'x'.repeat(MIN_PASSWORD), slug: 'main', workspaceName: '본사' }
  it('정상 입력은 문제 0', () => { expect(bootstrapInputProblems(ok)).toEqual([]) })
  it('이메일·비밀번호 길이·slug·이름을 각각 잡는다', () => {
    expect(bootstrapInputProblems({ ...ok, email: 'Admin@Example.com' })).toHaveLength(1)
    expect(bootstrapInputProblems({ ...ok, email: 'nope' })).toHaveLength(1)
    expect(bootstrapInputProblems({ ...ok, password: 'short' })).toHaveLength(1)
    expect(bootstrapInputProblems({ ...ok, slug: 'Bad Slug' })).toHaveLength(1)
    expect(bootstrapInputProblems({ ...ok, workspaceName: '  ' })).toHaveLength(1)
    expect(bootstrapInputProblems({ email: '', password: '', slug: '', workspaceName: '' })).toHaveLength(4)
  })
  it('문제 문구에 비밀번호 값이 들어가지 않는다', () => {
    expect(bootstrapInputProblems({ ...ok, password: 'hunter2' }).join(' ')).not.toContain('hunter2')
  })
})

describe('bootstrapPlanLines', () => {
  const target = { name: 'staging', ref: STG, url: `https://${STG}.supabase.co`, host: `${STG}.supabase.co` }
  it('대상과 할 일을 적는다 — 비밀값은 인자로 받지도 않는다', () => {
    const lines = bootstrapPlanLines({ target, email: 'admin@example.com', slug: 'main', workspaceName: '본사', modules: ['kanban', 'wiki'], timezone: null })
    const text = lines.join('\n')
    expect(lines[0]).toBe(`대상: staging (ref ${STG}) — ${STG}.supabase.co`)
    expect(text).toContain('admin@example.com')
    expect(text).toContain('main(본사)')
    expect(text).toContain('허용 모듈 2개')
    expect(bootstrapPlanLines({ target, email: 'a@b.co', slug: 'main', workspaceName: 'x', modules: [], timezone: 'Asia/Tokyo' }).join('\n')).toContain('시간대 Asia/Tokyo')
  })
})

describe('scripts/bootstrap-remote.mjs — 원문 검사', () => {
  const src = readFileSync('scripts/bootstrap-remote.mjs', 'utf8')
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  it('대상 해석 → 멱등 판정 → 확인 → 쓰기 순서다', () => {
    const at = (needle: string) => { const i = code.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i }
    const order = [at('resolveBootstrapTarget(parsedArgs.target)'), at('bootstrapDecision({ count, error })'), at('if (!parsedArgs.yes)'), at(".from('workspaces').upsert("), at('admin.auth.admin.createUser(')]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('비밀값은 환경 변수·가린 프롬프트로만 — 인자·.env 파일·출력에 없다', () => {
    expect(code).not.toMatch(/readFileSync|writeFileSync|\.env\.local/)
    expect(code).toContain("process.env.BOOTSTRAP_SERVICE_ROLE_KEY || await askHidden(")
    expect(code).toContain("process.env.BOOTSTRAP_PASSWORD || await askHidden(")
    // 출력 호출(console.*·fail)의 인자에 비밀값 변수가 들어가지 않는다 — 조건식의 변수 이름은 출력이 아니다
    const outputs = [...code.matchAll(/(?:console\.(?:log|error)|\bfail)\(([^\n]*)/g)].map((m) => m[1])
    expect(outputs.length).toBeGreaterThan(10)
    for (const args of outputs) expect(args, args).not.toMatch(/\bpassword\b|\bserviceRoleKey\b/)
  })
  it('금지 대상 예외(allowForbidden)·로컬 전용 도우미를 쓰지 않는다', () => {
    expect(src).not.toContain('allowForbidden')
    expect(src).not.toContain('localAdminEnv')
  })
  it('dev-bootstrap 의 로컬 전용 가드는 그대로다', () => {
    const dev = readFileSync('scripts/dev-bootstrap.mjs', 'utf8')
    expect(dev).toContain("target = localAdminEnv(readFileSync('.env.local', 'utf8'))")
  })
  it('package.json 에 실행 이름이 있다', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts['remote:bootstrap']).toBe('node scripts/bootstrap-remote.mjs')
  })
})
