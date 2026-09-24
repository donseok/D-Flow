import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  UsageError, parseArgs, parseDiffArgs, execFailureMessage, parseDsn, checkReaderRole, validateRehearseHost, validateOutDir, checkRawSource,
  PGOPTIONS, catalogArgs, presenceOf, containerStateOf, runSucceeded,
} from '../../scripts/lib/baseline-cli.mjs'

describe('parseArgs — 운영 접속은 --execute 로만', () => {
  it('허용 모드 넷', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ mode: 'dry-run' })
    expect(parseArgs(['--execute'])).toEqual({ mode: 'execute' })
    expect(parseArgs(['--from-raw', 'raw/x'])).toEqual({ mode: 'from-raw', rawDir: 'raw/x' })
    expect(parseArgs(['--from-raw', 'raw/x', '--out', '/tmp/o'])).toEqual({ mode: 'from-raw', rawDir: 'raw/x', outDir: '/tmp/o' })
    expect(parseArgs(['--rehearse', '--out', '/tmp/o'])).toEqual({ mode: 'rehearse', outDir: '/tmp/o' })
  })
  it('인자 없음·오타·조합·남는 인자·값 없는 옵션은 전부 사용법 오류', () => {
    for (const argv of [
      [], ['--dryrun'], ['--dry'], ['-n'], ['--execute', '--dry-run'], ['--dry-run', '--execute'],
      ['--execute', 'x'], ['--from-raw'], ['--from-raw', '--execute'], ['--rehearse'], ['--rehearse', '--out'],
      ['--out', '/tmp/o'], ['--execute', '--out', '/tmp/o'], ['--from-raw', 'a', '--out', '/o', 'extra'],
      ['--from-raw', 'a', '--from-raw', 'b'],
    ]) {
      expect(() => parseArgs(argv), JSON.stringify(argv)).toThrow(UsageError)
    }
  })
})

describe('parseDiffArgs — baseline-diff 는 기본값이 커밋된 파일 + 로컬 DB 뿐(CI)', () => {
  it('인자 없음·--raw <dir>·--snapshot', () => {
    expect(parseDiffArgs([])).toEqual({ snapshot: false, rawDir: null })
    expect(parseDiffArgs(['--snapshot'])).toEqual({ snapshot: true, rawDir: null })
    expect(parseDiffArgs(['--raw', 'raw/x'])).toEqual({ snapshot: false, rawDir: 'raw/x' })
  })
  it('모르는 인자·값 없는 --raw·중복·--snapshot 과 --raw 동시(스냅샷은 DB 없이 쓰는 별도 모드)는 사용법 오류', () => {
    for (const argv of [['--execute'], ['--raw'], ['--raw', '--snapshot'], ['raw/x'], ['--snapshot', '--snapshot'],
      ['--raw', 'a', '--raw', 'b'], ['--snap'], ['--raw', 'raw/x', '--snapshot'], ['--snapshot', '--raw', 'raw/x']]) {
      expect(() => parseDiffArgs(argv), JSON.stringify(argv)).toThrow(UsageError)
    }
  })
})

describe('execFailureMessage — docker exec 실패를 원인별로, 인자(SQL)는 싣지 않고', () => {
  const SQL = 'select json_build_object(\'policies\', …)'
  const err = (over: Record<string, unknown>) => Object.assign(new Error(`Command failed: docker exec db psql -c ${SQL}`), over)
  it('시간 초과는 몇 초에 끊었는지 말한다', () => {
    const msg = execFailureMessage('로컬 카탈로그', err({ code: 'ETIMEDOUT', signal: 'SIGKILL', status: null }), { timeoutMs: 180_000 })
    expect(msg).toContain('로컬 카탈로그')
    expect(msg).toContain('180초')
    expect(msg).toContain('SIGKILL')
    expect(msg).not.toContain(SQL)
  })
  it('docker 가 없으면 그렇게 말한다', () => {
    expect(execFailureMessage('로컬 카탈로그', err({ code: 'ENOENT', status: null }), { timeoutMs: 1 })).toMatch(/docker 를 찾지 못했다/)
  })
  it('종료 코드와 stderr·stdout 첫 줄 몇 개(다듬어서)만 싣고 db:start/db:reset 을 안내한다', () => {
    const stderr = '\n  ERROR:  relation "x" does not exist  \nLINE 1: a\nl3\nl4\nl5\nl6\nl7\n'
    const msg = execFailureMessage('로컬 pg_dump', err({ status: 1, stderr, stdout: 'partial\n' }), { timeoutMs: 1 })
    expect(msg).toContain('exit 1')
    expect(msg).toContain('stderr| ERROR:  relation "x" does not exist')
    expect(msg).not.toContain('does not exist  ')
    expect(msg).toContain('stdout| partial')
    expect(msg).not.toContain('l6')
    expect(msg).toContain('npm run db:start && npm run db:reset')
    expect(msg).not.toContain(SQL)
    expect(msg).not.toContain('Command failed')
  })
  it('아주 긴 줄은 자른다', () => {
    const msg = execFailureMessage('로컬 카탈로그', err({ status: 1, stderr: 'x'.repeat(5000) }), { timeoutMs: 1 })
    expect(msg.length).toBeLessThan(1000)
  })
})

describe('parseDsn', () => {
  const DSN = 'postgresql://staging_reader.abcdefghijklmnopqrst:p%40ss@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'
  it('userinfo 비밀번호를 디코드하고 표시용 문자열은 가린다', () => {
    const c = parseDsn(DSN)
    expect(c).toMatchObject({ host: 'aws-0-ap-northeast-2.pooler.supabase.com', port: '5432', user: 'staging_reader.abcdefghijklmnopqrst', password: 'p@ss', database: 'postgres', sslmode: 'require' })
    expect(c.display).toBe('postgresql://staging_reader.abcdefghijklmnopqrst:***@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres')
    expect(c.display).not.toContain('p@ss')
  })
  it('쿼리의 password= 는 마스킹 경로 밖이라 중단 — 메시지에 값이 새지 않는다', () => {
    const bad = 'postgresql://staging_reader.x@h:5432/postgres?password=S3cret'
    expect(() => parseDsn(bad)).toThrow(/password=/)
    try { parseDsn(bad) } catch (e) { expect((e as Error).message).not.toContain('S3cret') }
  })
  it('sslmode 는 require 만(없으면 require)', () => {
    expect(parseDsn(`${DSN}?sslmode=require`).sslmode).toBe('require')
    for (const m of ['disable', 'prefer', 'allow', 'verify-ca', 'verify-full']) expect(() => parseDsn(`${DSN}?sslmode=${m}`)).toThrow(/sslmode/)
  })
  it('모르는 쿼리 파라미터는 버리지 않고 중단', () => {
    expect(() => parseDsn(`${DSN}?pgbouncer=true`)).toThrow(/pgbouncer/)
  })
  it('URL 아님·비밀번호 없음·다른 스킴은 중단', () => {
    expect(() => parseDsn('not a url')).toThrow()
    expect(() => parseDsn('postgresql://u@h:5432/db')).toThrow(/비밀번호/)
    expect(() => parseDsn('mysql://u:p@h/db')).toThrow(/postgresql/)
  })
})

describe('checkReaderRole — 쓰기 가능한 롤이면 접속 전에 멈춘다', () => {
  it('관리 롤 거부', () => {
    for (const u of ['postgres', 'postgres.abcdefghijklmnopqrst', 'service_role', 'x_service_role', 'supabase_admin',
      'supabase_storage_admin.abc', 'supabase_read_only_user', '']) {
      expect(() => checkReaderRole(u), u).toThrow(/읽기 전용 롤이 아니다/)
    }
  })
  it('읽기 롤 통과', () => {
    expect(() => checkReaderRole('staging_reader.abcdefghijklmnopqrst')).not.toThrow()
    expect(() => checkReaderRole('baseline_reader')).not.toThrow()
  })
})

describe('validateRehearseHost — 리허설은 docker 컨테이너 이름으로만', () => {
  it('맨 컨테이너 이름 통과', () => {
    expect(() => validateRehearseHost('dflow-rh-src')).not.toThrow()
    expect(() => validateRehearseHost('db_1')).not.toThrow()
  })
  it('도메인·IP·localhost·숫자 주소 거부', () => {
    for (const h of ['aws-0-ap-northeast-2.pooler.supabase.com', 'db.abcdefghijklmnopqrst.supabase.co', '127.0.0.1', '10.0.0.5',
      '[::1]', 'localhost', 'LOCALHOST', '2130706433', '0x7f000001', 'host.docker.internal', '', '-x']) {
      expect(() => validateRehearseHost(h), h).toThrow()
    }
  })
})

describe('validateOutDir — 리허설 출력은 리포 기준선 자리를 건드리지 않는다(파일 정체 dev·ino 로 비교)', () => {
  let base: string, root: string
  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'dflow-outdir-')))
    root = join(base, 'Repo')
    mkdirSync(join(root, 'supabase'), { recursive: true })
    mkdirSync(join(root, '.superpowers'), { recursive: true })
    mkdirSync(join(base, 'outside'))
    symlinkSync(root, join(base, 'link-to-repo'))
    symlinkSync(join(base, 'outside'), join(base, 'link-to-outside'))
    symlinkSync(join(root, 'supabase'), join(root, '.superpowers', 'sneaky'))
  })
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('리포 밖(없는 경로 포함)·리포 .superpowers/ 하위·밖을 가리키는 심링크는 통과', () => {
    expect(validateOutDir(join(base, 'outside', 'new', 'deeper'), root)).toBe(join(base, 'outside', 'new', 'deeper'))
    expect(() => validateOutDir(join(root, '.superpowers', 'rehearsal'), root)).not.toThrow()
    expect(validateOutDir(join(base, 'link-to-outside', 'x'), root)).toBe(join(base, 'outside', 'x'))
  })
  it('상대경로·리포 루트·supabase/·그 밖의 리포 경로·.superpowers 자체 거부', () => {
    for (const p of ['rel/out', root, `${root}/`, join(root, 'supabase'), join(root, 'docs', 'x'), join(root, 'scripts'),
      join(root, '.superpowers', '..', 'supabase'), join(root, '.superpowers')]) {
      expect(() => validateOutDir(p, root), p).toThrow()
    }
  })
  // 대소문자 무시 파일시스템(APFS 기본)에서만 의미가 있다 — 구분하는 파일시스템에선 REPO 는 정말 다른(새) 디렉터리다.
  it('대소문자만 다른 경로(APFS 는 대소문자 무시)로 리포에 들어오면 거부', ({ skip }) => {
    if (!existsSync(join(base, 'REPO'))) skip()
    for (const p of [join(base, 'repo'), join(base, 'REPO', 'supabase'), join(base, 'rEpO', 'docs')]) {
      expect(() => validateOutDir(p, root), p).toThrow()
    }
  })
  it('리포를 가리키는 심링크·.superpowers 안에서 supabase/ 로 새는 심링크는 거부', () => {
    expect(() => validateOutDir(join(base, 'link-to-repo'), root)).toThrow()
    expect(() => validateOutDir(join(base, 'link-to-repo', 'supabase', 'x'), root)).toThrow()
    expect(() => validateOutDir(join(root, '.superpowers', 'sneaky', 'x'), root)).toThrow()
  })
})

describe('validateOutDir — macOS firmlink(/System/Volumes/Data/…)도 같은 파일(dev·ino)이면 거부', () => {
  const repo = resolve(__dirname, '../..')
  const alias = join('/System/Volumes/Data', repo)
  const same = (() => {
    try { const a = statSync(alias), b = statSync(repo); return a.dev === b.dev && a.ino === b.ino } catch { return false }
  })()
  it.skipIf(!same)('firmlink 경로·그 하위 supabase/docs 거부, .superpowers 하위는 통과', () => {
    expect(() => validateOutDir(alias, repo)).toThrow()
    expect(() => validateOutDir(join(alias, 'supabase'), repo)).toThrow()
    expect(() => validateOutDir(join(alias, 'docs', 'baseline'), repo)).toThrow()
    expect(() => validateOutDir(join(alias.toLowerCase(), 'docs'), repo)).toThrow()
    expect(() => validateOutDir(join(alias, '.superpowers', 'rehearsal-x'), repo)).not.toThrow()
  })
})

describe('checkRawSource — 운영이 아닌 원본은 리포 기준선 자리에 쓰지 않는다', () => {
  it('리포로 쓰기는 source=prod 만', () => {
    expect(() => checkRawSource({ source: 'prod' }, { intoRepo: true })).not.toThrow()
    for (const meta of [{ source: 'rehearsal' }, {}, { source: 'PROD' }, null]) {
      expect(() => checkRawSource(meta, { intoRepo: true }), JSON.stringify(meta)).toThrow(UsageError)
    }
  })
  it('--out 으로 리포 밖에 쓰면 출처와 무관하게 허용', () => {
    expect(() => checkRawSource({ source: 'rehearsal' }, { intoRepo: false })).not.toThrow()
  })
})

describe('세션 설정 — 끊긴 클라이언트가 원본에 idle in transaction 으로 남지 않게', () => {
  it('PGOPTIONS 에 읽기 전용·idle_in_transaction timeout', () => {
    expect(PGOPTIONS).toContain('-c default_transaction_read_only=on')
    expect(PGOPTIONS).toContain('-c idle_in_transaction_session_timeout=15000')
  })
  it('카탈로그 트랜잭션: begin read only → set local 넷(idle 포함) → 쿼리 → rollback', () => {
    const args = catalogArgs('select 1')
    const cmds = args.filter((_: string, i: number) => args[i - 1] === '-c')
    expect(cmds[0]).toBe('begin transaction isolation level repeatable read read only')
    expect(cmds).toContain('set local idle_in_transaction_session_timeout = 15000')
    expect(cmds.at(-2)).toBe('select 1')
    expect(cmds.at(-1)).toBe('rollback')
    expect(args).toContain('ON_ERROR_STOP=1')
  })
})

describe('presenceOf — docker ps 가 실패하면 "없다"가 아니라 모른다', () => {
  it('성공한 ps 만 있다/없다로 읽는다', () => {
    expect(presenceOf({ status: 0, stdout: 'a1b2c3\n' })).toBe('present')
    expect(presenceOf({ status: 0, stdout: '\n' })).toBe('absent')
  })
  it('비정상 종료(죽은 소켓)·시간 초과·실행 불가·출력 없음은 unknown', () => {
    expect(presenceOf({ status: 1, stdout: '' })).toBe('unknown')
    expect(presenceOf({ status: null, signal: 'SIGTERM', error: new Error('spawnSync docker ETIMEDOUT'), stdout: '' })).toBe('unknown')
    expect(presenceOf({ status: null, error: Object.assign(new Error('spawnSync docker ENOENT'), { code: 'ENOENT' }) })).toBe('unknown')
    expect(presenceOf({ status: 0, stdout: null })).toBe('unknown')
  })
})

describe('containerStateOf — docker container inspect 의 "상태 종료코드"', () => {
  it('상태와 컨테이너 자신의 종료 코드', () => {
    expect(containerStateOf({ status: 0, stdout: 'exited 0\n' })).toEqual({ status: 'exited', exitCode: 0 })
    expect(containerStateOf({ status: 0, stdout: 'running 0\n' })).toEqual({ status: 'running', exitCode: 0 })
    expect(containerStateOf({ status: 0, stdout: 'exited 143\n' })).toEqual({ status: 'exited', exitCode: 143 })
  })
  it('없는 컨테이너·docker 실패·모르는 출력은 null(확인 불가)', () => {
    expect(containerStateOf({ status: 1, stdout: '' })).toBeNull()
    expect(containerStateOf({ status: null, error: new Error('ETIMEDOUT'), stdout: '' })).toBeNull()
    expect(containerStateOf({ status: 0, stdout: 'garbage' })).toBeNull()
  })
})

describe('runSucceeded — CLI 종료 코드만 믿지 않는다(start -a 는 자기에게 온 SIGTERM/SIGINT 에 0 으로 먼저 끝난다)', () => {
  const exited0 = { status: 'exited', exitCode: 0 }
  it('CLI 0 · 컨테이너 exited 0 · 시간 안 · 오류 없음일 때만 성공', () => {
    expect(runSucceeded({ code: 0, error: null, timedOut: false, state: exited0 })).toBe(true)
  })
  it('CLI 가 0 이어도 컨테이너가 아직 돌거나·0 이 아니게 끝났거나·상태를 모르면 실패', () => {
    expect(runSucceeded({ code: 0, error: null, timedOut: false, state: { status: 'running', exitCode: 0 } })).toBe(false)
    expect(runSucceeded({ code: 0, error: null, timedOut: false, state: { status: 'exited', exitCode: 143 } })).toBe(false)
    expect(runSucceeded({ code: 0, error: null, timedOut: false, state: null })).toBe(false)
  })
  it('CLI 비정상·시간 초과·spawn 오류는 컨테이너가 0 이어도 실패', () => {
    expect(runSucceeded({ code: 1, error: null, timedOut: false, state: exited0 })).toBe(false)
    expect(runSucceeded({ code: null, error: null, timedOut: false, state: exited0 })).toBe(false)
    expect(runSucceeded({ code: 0, error: null, timedOut: true, state: exited0 })).toBe(false)
    expect(runSucceeded({ code: 0, error: new Error('spawn'), timedOut: false, state: exited0 })).toBe(false)
  })
})
