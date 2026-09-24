import { describe, it, expect } from 'vitest'
import {
  FORBIDDEN_REFS, LOCAL_DSN, assertNotForbidden, resolveTarget, detectEnvTarget, mergeEnv, localEnvFromStatus,
  parseEnvFile, localAdminEnv, classifySupabaseUrl, devEnvVerdict,
} from '../../scripts/lib/targets.mjs'

const ORIGIN_PROD = 'rglfgrwwwwdqejohdnty'
const ORIGIN_STAGING = 'abtyahghvvkcriawffty'

describe('FORBIDDEN_REFS', () => {
  it('원본 리포 운영·스테이징 ref 둘을 담는다', () => {
    expect(FORBIDDEN_REFS).toEqual([ORIGIN_PROD, ORIGIN_STAGING])
  })
})

describe('assertNotForbidden', () => {
  it('금지 ref 를 포함하면 throw', () => {
    expect(() => assertNotForbidden(`https://${ORIGIN_PROD}.supabase.co`)).toThrow(/금지/)
    expect(() => assertNotForbidden(`postgresql://u.${ORIGIN_STAGING}:p@h/db`)).toThrow(/금지/)
  })
  it('readonly-baseline 예외만 통과', () => {
    expect(() => assertNotForbidden(ORIGIN_PROD, { allowForbidden: 'readonly-baseline' })).not.toThrow()
  })
  it('다른 값은 통과', () => { expect(() => assertNotForbidden('http://127.0.0.1:54321')).not.toThrow() })
})

describe('resolveTarget', () => {
  it('local 은 로컬 DSN', () => {
    expect(resolveTarget('local', {})).toEqual({ name: 'local', kind: 'local', dsn: LOCAL_DSN, ref: null })
  })
  it('LOCAL_DB_URL 로 덮어써도 금지 ref 면 throw', () => {
    expect(() => resolveTarget('local', { LOCAL_DB_URL: `postgresql://x.${ORIGIN_PROD}:p@h/db` })).toThrow(/금지/)
  })
  it('원격은 env 미설정이면 throw(fail-closed)', () => {
    expect(() => resolveTarget('prod', {})).toThrow(/PROD_REF 미설정/)
    expect(() => resolveTarget('staging', { STAGING_REF: '  ' })).toThrow(/STAGING_REF 미설정/)
  })
  it('원격 env 에 금지 ref 를 넣어도 throw', () => {
    expect(() => resolveTarget('prod', { PROD_REF: ORIGIN_PROD })).toThrow(/금지/)
  })
  it('원격 정상', () => {
    expect(resolveTarget('staging', { STAGING_REF: 'newstagingref0000000' }))
      .toEqual({ name: 'staging', kind: 'remote', dsn: null, ref: 'newstagingref0000000' })
  })
  it('모르는 대상은 throw', () => { expect(() => resolveTarget('dev' as never, {})).toThrow(/local\|staging\|prod/) })
})

describe('detectEnvTarget', () => {
  const env = (url: string) => `X=1\nNEXT_PUBLIC_SUPABASE_URL=${url}\n`
  it('로컬 URL', () => {
    expect(detectEnvTarget(env('http://127.0.0.1:54321'), {})).toBe('local')
    expect(detectEnvTarget(env('http://localhost:54321/'), {})).toBe('local')
  })
  it('금지 ref 는 forbidden', () => {
    expect(detectEnvTarget(env(`https://${ORIGIN_PROD}.supabase.co`), {})).toBe('forbidden')
  })
  it('env 로 등록한 원격', () => {
    expect(detectEnvTarget(env('https://newprodref000000000000.supabase.co'), { PROD_REF: 'newprodref000000000000' })).toBe('prod')
  })
  it('[회귀] 빈 값은 다음 줄을 URL 로 오인하지 않는다', () => {
    expect(detectEnvTarget(`NEXT_PUBLIC_SUPABASE_URL=\n\nX=https://${ORIGIN_PROD}.supabase.co`, {})).toBe('unknown')
  })
  it('파일 없음(빈 문자열)은 unknown', () => { expect(detectEnvTarget('', {})).toBe('unknown') })
})

describe('mergeEnv', () => {
  it('기존 키는 교체, 없는 키는 추가, 나머지 줄은 보존', () => {
    const out = mergeEnv('A=1\n# c\nGEMINI_API_KEY=g\n', { A: '2', B: '3' })
    expect(out).toBe('A=2\n# c\nGEMINI_API_KEY=g\nB=3\n')
  })
})

describe('localEnvFromStatus', () => {
  it('supabase status -o env 출력을 앱 env 로 옮긴다', () => {
    const status = 'API_URL="http://127.0.0.1:54321"\nANON_KEY="anon"\nSERVICE_ROLE_KEY="svc"\nDB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\n'
    expect(localEnvFromStatus(status)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'svc',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    })
  })
  it('필수 키가 없으면 throw', () => { expect(() => localEnvFromStatus('API_URL="x"\n')).toThrow(/ANON_KEY/) })
})

describe('parseEnvFile — 가드와 실제 접속이 같은 값을 보도록 .env 를 한 번만 읽는다', () => {
  it('KEY=값 을 읽고 \\r·짝 맞는 따옴표·따옴표 밖 # 주석을 벗긴다(값은 끝 줄 우선 — Next 와 같다)', () => {
    const { values, duplicates, problems } = parseEnvFile('# 주석\r\nA=1\r\nB="two words"\nC=\'x#y\'\nD=plain # 꼬리 주석\nE=\n')
    expect(values).toEqual({ A: '1', B: 'two words', C: 'x#y', D: 'plain', E: '' })
    expect(duplicates).toEqual([])
    expect(problems).toEqual([])
  })
  it('같은 키가 두 번 이상이면 duplicates 에 한 번 싣고, values 는 마지막 값', () => {
    const { values, duplicates } = parseEnvFile('U=http://127.0.0.1:54321\nX=1\nU=https://remote.example.co\nU=3\n')
    expect(duplicates).toEqual(['U'])
    expect(values.U).toBe('3')
  })
  it('Next(dotenv)가 키로 읽는 비정규형 — 들여쓰기·export·콜론 — 도 키로 세고 problems 로 보고한다', () => {
    const { values, duplicates, problems } = parseEnvFile('U=http://127.0.0.1:54321\n  U=https://a.example.co\nexport V=1\nW: 2\n')
    expect(duplicates).toEqual(['U'])
    expect(values).toEqual({ U: 'https://a.example.co', V: '1', W: '2' })
    expect(problems).toEqual([
      { line: 2, key: 'U', kind: 'indented' },
      { line: 3, key: 'V', kind: 'export' },
      { line: 4, key: 'W', kind: 'colon' },
    ])
  })
  it('URL 처럼 콜론 뒤에 공백이 없는 줄은 키가 아니다', () => {
    expect(parseEnvFile('http://127.0.0.1:54321\n').values).toEqual({})
  })
})

describe('localAdminEnv — dev-bootstrap 이 createClient 에 넘길 값(가드가 본 값 그대로)', () => {
  const LOCAL = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SERVICE_ROLE_KEY=svc\n'
  it('정상 로컬이면 URL·서비스 키를 돌려준다', () => {
    expect(localAdminEnv(LOCAL)).toEqual({ url: 'http://127.0.0.1:54321', serviceRoleKey: 'svc' })
    expect(localAdminEnv(LOCAL.replace('54321', '54321"').replace('=http', '="http'))).toEqual({ url: 'http://127.0.0.1:54321', serviceRoleKey: 'svc' })
  })
  it('[F1] 로컬 줄 뒤에 원격 URL 이 덧붙으면 거절 — 가드는 첫 줄, 접속은 끝 줄을 보던 구멍', () => {
    expect(() => localAdminEnv(`${LOCAL}NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n`)).toThrow(/NEXT_PUBLIC_SUPABASE_URL.*두 번/)
    expect(() => localAdminEnv(`${LOCAL}SUPABASE_SERVICE_ROLE_KEY=other\n`)).toThrow(/SUPABASE_SERVICE_ROLE_KEY.*두 번/)
  })
  it('들여쓴·export·콜론 형태의 키는 거절', () => {
    expect(() => localAdminEnv('  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_SERVICE_ROLE_KEY=svc\n')).toThrow(/indented/)
    expect(() => localAdminEnv('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nexport SUPABASE_SERVICE_ROLE_KEY=svc\n')).toThrow(/export/)
  })
  it('키가 없거나 비었으면 거절', () => {
    expect(() => localAdminEnv('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n')).toThrow(/SUPABASE_SERVICE_ROLE_KEY.*없다/)
    expect(() => localAdminEnv('NEXT_PUBLIC_SUPABASE_URL=\nSUPABASE_SERVICE_ROLE_KEY=svc\n')).toThrow(/NEXT_PUBLIC_SUPABASE_URL.*없다/)
  })
  it('원격 URL 은 거절(로컬 전용)', () => {
    expect(() => localAdminEnv('NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=svc\n')).toThrow(/로컬이 아니다/)
  })
  it('파일 어디에든 금지 ref 가 있으면 거절 — 주석·다른 키 안이라도', () => {
    expect(() => localAdminEnv(`${LOCAL}# https://${ORIGIN_PROD}.supabase.co\n`)).toThrow(/금지/)
    expect(() => localAdminEnv(`${LOCAL}OTHER_URL=https://${ORIGIN_STAGING}.supabase.co\n`)).toThrow(/금지/)
  })
})

describe('assertNotForbidden — 보이지 않는 문자로 쪼갠 ref 도 잡는다', () => {
  it('soft hyphen·ZWSP·NBSP 를 끼워도 throw (URL 파서는 soft hyphen 을 지워 그 호스트로 간다)', () => {
    for (const sep of ['\u00AD', '\u200B', '\u00A0', '\t']) {
      expect(() => assertNotForbidden(`https://rglfg${sep}rwwwwdqejohdnty.supabase.co`), JSON.stringify(sep)).toThrow(/금지/)
    }
  })
})

describe('classifySupabaseUrl — 값 하나를 엄격하게 판정(new URL 로 파싱)', () => {
  it('로컬: http(s) + 호스트가 정확히 127.0.0.1 또는 localhost', () => {
    for (const u of ['http://127.0.0.1:54321', 'http://localhost:54321/', 'https://localhost', 'http://LOCALHOST:54321']) {
      expect(classifySupabaseUrl(u, {}), u).toBe('local')
    }
  })
  it('[ENV.i] 값 어디에든 공백·제어·서식 문자가 있으면 로컬이 아니다 — URL 파서가 지워 다른 호스트로 간다', () => {
    for (const u of ['http://localhost\t.example.com', 'http://localhost\uFEFF.example.com', 'http://localhost\u00A0.example.com',
      'http://127.0.0.1:54321\u00A0', ' http://127.0.0.1:54321', 'http://127.0.0.1:54321\u2028', 'http://local\u00ADhost:54321']) {
      expect(classifySupabaseUrl(u, {}), JSON.stringify(u)).toBe('unknown')
    }
  })
  it('호스트가 localhost 로 시작만 하거나, userinfo 가 있거나, http(s) 가 아니면 로컬이 아니다', () => {
    for (const u of ['http://localhost.example.com:54321', 'http://127.0.0.1.nip.io', 'http://user:pw@127.0.0.1:54321',
      'http://tok@localhost:54321', 'http://127.0.0.1:54321@evil.example.com', 'ftp://127.0.0.1', 'localhost:54321', 'not a url']) {
      expect(classifySupabaseUrl(u, {}), u).toBe('unknown')
    }
  })
  it('금지 ref 는 forbidden — 호스트 안에 보이지 않는 문자를 끼워도', () => {
    expect(classifySupabaseUrl(`https://${ORIGIN_PROD}.supabase.co`, {})).toBe('forbidden')
    expect(classifySupabaseUrl(`https://rglfg\u00ADrwwwwdqejohdnty.supabase.co`, {})).toBe('forbidden')
  })
  it('env 로 등록한 원격, 빈 값', () => {
    expect(classifySupabaseUrl('https://newprodref000000000000.supabase.co', { PROD_REF: 'newprodref000000000000' })).toBe('prod')
    expect(classifySupabaseUrl('https://newstgref0000000000000.supabase.co', { STAGING_REF: 'newstgref0000000000000' })).toBe('staging')
    expect(classifySupabaseUrl('', {})).toBe('unknown')
    expect(classifySupabaseUrl(undefined, {})).toBe('unknown')
  })
})

describe('parseEnvFile — dotenv 처럼 줄을 가른다(가드가 Next 보다 좁게 읽지 않게)', () => {
  it('NBSP 들여쓰기·NBSP 뒤 = 도 키로 세고, 외톨이 CR·U+2028 도 줄 끝으로 본다', () => {
    const text = 'U=http://127.0.0.1:54321\n\u00A0U=https://a.example.co\nV\u00A0=1\rU=x\nW=1\u2028U=y\n'
    const { values, duplicates, problems } = parseEnvFile(text)
    expect(duplicates).toEqual(['U'])
    expect(values).toEqual({ U: 'y', V: '1', W: '1' })
    expect(problems).toEqual([{ line: 2, key: 'U', kind: 'indented' }])
  })
})

describe('localAdminEnv — 엄격한 URL·원인별 kind', () => {
  const svc = 'SUPABASE_SERVICE_ROLE_KEY=svc\n'
  const kindOf = (text: string) => { try { localAdminEnv(text); return 'ok' } catch (e) { return (e as { kind?: string }).kind } }
  it('[ENV.i] TAB·U+FEFF·NBSP 가 낀 URL, localhost.example.com, userinfo 는 not-local', () => {
    for (const u of ['http://localhost\t.example.com', 'http://localhost\uFEFF.example.com', 'http://localhost\u00A0.example.com',
      'http://localhost.example.com:54321', 'http://user:pw@127.0.0.1:54321']) {
      expect(kindOf(`NEXT_PUBLIC_SUPABASE_URL=${u}\n${svc}`), JSON.stringify(u)).toBe('not-local')
    }
  })
  it('실패 원인마다 kind 가 다르다 — 부트스트랩이 원인별 처방을 낸다', () => {
    expect(kindOf(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n${svc}`)).toBe('ok')
    expect(kindOf(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n${svc}`)).toBe('duplicate')
    expect(kindOf(`export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n${svc}`)).toBe('noncanonical')
    expect(kindOf('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n')).toBe('missing')
    expect(kindOf(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n${svc}# ${ORIGIN_PROD}\n`)).toBe('forbidden')
  })
})

describe('devEnvVerdict — predev 판정(순수). Next 가 실제로 쓸 값과 그 값의 모든 원천을 본다', () => {
  const LOCAL_TEXT = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n'
  const file = (path: string, contents: string) => ({ path, contents })
  it('Next 가 쓸 값이 로컬이고 원천이 깨끗하면 local', () => {
    expect(devEnvVerdict({ files: [file('.env.local', LOCAL_TEXT)], shellUrl: undefined, url: 'http://127.0.0.1:54321' }, {}).verdict).toBe('local')
  })
  it('읽힌 어느 파일에든 금지 ref 가 있으면 forbidden — 쓰이지 않는 줄·주석이라도, 파일 이름을 댄다', () => {
    const v = devEnvVerdict({ files: [file('.env.local', LOCAL_TEXT), file('.env', `# old https://${ORIGIN_STAGING}.supabase.co\n`)], shellUrl: undefined, url: 'http://127.0.0.1:54321' }, {})
    expect(v.verdict).toBe('forbidden')
    expect(v.source).toBe('.env')
  })
  it('셸 환경변수가 금지 ref 면 forbidden', () => {
    const shellUrl = `https://${ORIGIN_PROD}.supabase.co`
    expect(devEnvVerdict({ files: [file('.env.local', LOCAL_TEXT)], shellUrl, url: shellUrl }, {}).verdict).toBe('forbidden')
  })
  it('한 파일에 URL 키가 둘 이상이면 ambiguous', () => {
    const v = devEnvVerdict({ files: [file('.env.local', LOCAL_TEXT + LOCAL_TEXT)], shellUrl: undefined, url: 'http://127.0.0.1:54321' }, {})
    expect(v).toEqual({ verdict: 'ambiguous', source: '.env.local' })
  })
  it('Next 가 쓸 값이 원격이거나 이상하면 그 판정(unknown/prod)을 그대로', () => {
    expect(devEnvVerdict({ files: [file('.env.local', LOCAL_TEXT)], shellUrl: undefined, url: 'https://abcdefghijklmnopqrst.supabase.co' }, {}).verdict).toBe('unknown')
    expect(devEnvVerdict({ files: [], shellUrl: undefined, url: 'http://localhost\t.example.com' }, {}).verdict).toBe('unknown')
    expect(devEnvVerdict({ files: [], shellUrl: undefined, url: undefined }, {}).verdict).toBe('unknown')
    expect(devEnvVerdict({ files: [], shellUrl: undefined, url: 'https://p00000000000000000000.supabase.co' }, { PROD_REF: 'p00000000000000000000' }).verdict).toBe('prod')
  })
})
