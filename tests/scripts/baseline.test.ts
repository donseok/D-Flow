import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  postprocessDump, buildStorageRealtimeSql, diffCatalog, findForbiddenLines, findSecretLikeLines, findEmails, auditOutputs, CATALOG_SQL,
  normalizeDumpForCompare, diffDumps, baselineExtensions, roundTripResidue, checkRoundTrip, diffExtensions, EXTENSION_DEPS_SQL,
  renderLiveCatalogSnapshot, baselineMigrationProblem, LOCAL_PREFLIGHT_SQL,
} from '../../scripts/lib/baseline.mjs'

const DUMP = [
  '\\restrict AbC123',
  'SET statement_timeout = 0;',
  'CREATE SCHEMA public;',
  "COMMENT ON SCHEMA public IS 'standard public schema';",
  'CREATE TABLE public.projects (id uuid NOT NULL);',
  'GRANT ALL ON TABLE public.projects TO authenticated;',
  'GRANT SELECT ON TABLE public.projects TO staging_reader;',
  'REVOKE ALL ON TABLE public.projects FROM some_custom_role;',
  'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;',
  '\\unrestrict AbC123',
].join('\n')

describe('findForbiddenLines', () => {
  it('모든 금지 ref 행을 1부터 센 줄 번호·ref 로만 돌려준다(본문은 싣지 않는다 — 같은 줄의 비밀이 새지 않게)', () => {
    expect(findForbiddenLines("a\nx rglfgrwwwwdqejohdnty y\nb\nabtyahghvvkcriawffty")).toEqual([
      { line: 2, ref: 'rglfgrwwwwdqejohdnty' },
      { line: 4, ref: 'abtyahghvvkcriawffty' },
    ])
    expect(findForbiddenLines('clean\ntext')).toEqual([])
  })
})

describe('findSecretLikeLines — 스키마 본문에 박힌 자격증명(대시보드 Database Webhook 의 Authorization 헤더 등)', () => {
  const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlc2lnbmF0dXJl'
  const names = (text: string) => findSecretLikeLines(text).map((h: { pattern: string }) => h.pattern)
  it('각 패턴을 잡고 줄 번호를 1부터 센다', () => {
    const text = [
      'select 1;',
      `  headers := '{"Authorization":"Bearer ${JWT}"}';`,
      `select '${JWT}';`,
      "perform stripe('sk_live_51Habc');",
      "select 'sbp_0123456789abcdef0123456789';",
      "select '{\"role\":\"service_role\",\"key\":\"a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7\"}';",
      "api_key := 'abcdefghijklmnop';",
      "select dblink('postgresql://admin:hunter2@db.example.com/postgres');",
    ].join('\n')
    const hits = findSecretLikeLines(text)
    expect(hits.filter((h: { line: number }) => h.line === 1)).toEqual([])
    expect(hits).toEqual(expect.arrayContaining([
      { line: 2, pattern: 'jwt' }, { line: 2, pattern: 'bearer' }, { line: 3, pattern: 'jwt' },
      { line: 4, pattern: 'stripe-key' }, { line: 5, pattern: 'supabase-pat' }, { line: 6, pattern: 'service-role-literal' },
      { line: 7, pattern: 'assigned-secret' }, { line: 8, pattern: 'url-credentials' },
    ]))
  })
  it('확장 패턴 — 웹훅·키 형식별로 하나씩 잡는다', () => {
    const cases: [string, string][] = [
      ["headers := jsonb_build_object('apikey', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz')", 'sb-secret'],
      ['\'{"Authorization":"Basic ZmFrZXVzZXI6ZmFrZXBhc3N3b3Jk"}\'', 'basic-auth'],
      ['\'{"Authorization":"0123456789abcdef0123"}\'', 'auth-header-json'],
      ['\'{\\"apikey\\":\\"0123456789abcdef0123\\"}\'', 'auth-header-json'],
      ["jsonb_build_object('Content-Type','application/json','x-api-key','0123456789abcdef0123')", 'auth-header-pair'],
      ["url := 'https://hooks.slack.com/services/T000/B000/XXXX'", 'slack-webhook'],
      ["url := 'https://discord.com/api/webhooks/123/abc'", 'discord-webhook'],
      ["url := 'https://discordapp.com/api/webhooks/123/abc'", 'discord-webhook'],
      ["select 'https://user:pa55word@example.com/x'", 'url-credentials'],
      ["select 'redis://default:pa55word@cache:6379'", 'url-credentials'],
      ["select 'postgresql://admin:hunter2@db.example.com/postgres'", 'url-credentials'],
      ["url := 'https://tok3nABCDEF0123456789@hooks.example.com/x'", 'url-credentials'],
      ["url := 'https://svc:@hooks.example.com/x'", 'url-credentials'],
      ["url := 'https://api.example.com/v1?api_key=abcd1234efgh'", 'url-query-secret'],
      ["url := 'https://api.example.com/v1?x=1&token=abcd1234efgh'", 'url-query-secret'],
      ["select 'sk-proj-abcdefghijklmnopqrstuvwx'", 'openai-key'],
      ["select 'whsec_abcdefgh'", 'stripe-webhook-secret'],
      ["select 'rk_live_abcdef'", 'stripe-key'],
      ["select 'AKIAABCDEFGHIJKLMNOP'", 'aws-access-key'],
      ["select 'AIzaSyA-abcdefghijklmnopqrstuvwxyz01234'", 'google-api-key'],
      ["select 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'", 'github-token'],
      ["select 'github_pat_11ABCDEFG'", 'github-token'],
      ["select 'xoxb-1234-5678'", 'slack-token'],
      ["perform dblink_connect('host=db.example.com dbname=app user=etl password=s3cr3tpw')", 'conninfo-password'],
    ]
    for (const [line, pattern] of cases) expect(names(line), line).toContain(pattern)
  })
  it('자리표시자·연결식·평범한 비교는 헤더/비밀번호 패턴에 걸리지 않는다', () => {
    const normal = [
      '\'{"Authorization":"Bearer <token>"}\'',
      "jsonb_build_object('apikey', '${SUPABASE_KEY}')",
      "headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_key'))",
      "    WHERE u.password = crypt(p_password, u.password);",
      "    IF p_password = '' THEN RETURN false; END IF;",
      "select 'https://example.com/path?page=2&sort=name'",
      "select 'https://example.com/contact?to=ops.admin@example.org'",
      "select 'mailto:ops.admin@example.org'",
    ].join('\n')
    expect(names(normal)).toEqual([])
  })
  it('결과에 값 자체를 싣지 않는다(패턴 이름과 줄 번호만)', () => {
    const hits = findSecretLikeLines(`select '${JWT}';`)
    expect(JSON.stringify(hits)).not.toContain('eyJ')
    expect(Object.keys(hits[0]).sort()).toEqual(['line', 'pattern'])
  })
  it('평범한 RLS·권한 SQL 은 걸리지 않는다', () => {
    const normal = [
      "CREATE POLICY p ON public.x FOR ALL TO authenticated USING ((auth.role() = 'service_role'::text));",
      "  USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text))",
      "GRANT ALL ON TABLE public.projects TO service_role;",
      "    v_claims := current_setting('request.jwt.claims', true)::jsonb;",
      '    password_hash text NOT NULL,',
      'CREATE FUNCTION public.issue_token(p_user uuid) RETURNS text',
      "    token_kind text DEFAULT 'share'::text,",
      "    IF secret IS NULL THEN RAISE EXCEPTION 'missing'; END IF;",
      "select 'postgresql://localhost/db';",
      "COMMENT: bearer tokens are rotated",
      "  v_setting_name := 'app.settings.service_role_key_name';",
    ].join('\n')
    expect(names(normal)).toEqual([])
  })
})

describe('findEmails — 막지는 않고 보고만(로컬 부분은 가린다)', () => {
  it('줄 번호와 가린 주소를 돌려준다', () => {
    expect(findEmails("a\nwhere email = 'alice.kim@example.com' or email = 'x@y.co'\nnone")).toEqual([
      { line: 2, masked: 'a***@example.com' },
      { line: 2, masked: 'x***@y.co' },
    ])
  })
  it('원래 주소를 결과 어디에도 싣지 않는다', () => {
    expect(JSON.stringify(findEmails("'alice.kim@example.com'"))).not.toContain('alice.kim')
  })
  it('URL userinfo(scheme://user:pass@host · scheme://token@host)는 이메일이 아니다 — 비밀번호 첫 글자·호스트를 싣지 않는다', () => {
    for (const line of [
      "select 'https://svc:Sup3rSecretPw9@hooks.example.com/x'",
      "select 'https://tok3nABCDEF0123456789@hooks.example.com/x'",
      "perform dblink('postgresql://reader.ref:Zq9secretPW@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres')",
      "select 'HTTPS://u:p%40ss@host.example.com'",
    ]) expect(findEmails(line), line).toEqual([])
  })
  it('URL 밖·URL 경로/쿼리의 주소와 mailto: 는 그대로 보고한다', () => {
    expect(findEmails("select 'https://u:pw123456@h.example.com/a', 'ops.admin@example.org'")).toEqual([{ line: 1, masked: 'o***@example.org' }])
    expect(findEmails("select 'https://example.com/contact?to=ops.admin@example.org'")).toEqual([{ line: 1, masked: 'o***@example.org' }])
    expect(findEmails("select 'mailto:ops.admin@example.org'")).toEqual([{ line: 1, masked: 'o***@example.org' }])
  })
})

describe('auditOutputs — 막는 검사(금지 ref·자격증명)가 먼저, 이메일 보고는 그다음', () => {
  it('걸린 것이 없으면 이메일만 보고(경로:줄  가린 주소)', () => {
    expect(auditOutputs({ 'a.sql': "select 1;\nselect 'ops.admin@example.org';" })).toEqual({
      problems: [], emails: ['a.sql:2  o***@example.org'],
    })
  })
  it('자격증명이 하나라도 걸리면 이메일 보고를 아예 하지 않고, 결과에 값·호스트·비밀번호 조각이 없다', () => {
    const r = auditOutputs({
      'a.sql': "select 'https://svc:Sup3rSecretPw9@hooks.example.com/x';",
      'b.json': '"ops.admin@example.org"',
    })
    expect(r.problems).toEqual(['자격증명? a.sql:1 (url-credentials) — 값은 가림'])
    expect(r.emails).toEqual([])
    const all = JSON.stringify(r)
    for (const leak of ['Sup3r', 'S***', 'hooks.example.com', 'svc', 'ops.admin', 'o***']) expect(all).not.toContain(leak)
  })
  it('비밀번호 없는 userinfo(https://<token>@host)도 막고 이메일로 새지 않는다', () => {
    const r = auditOutputs({ 'a.sql': "select 'https://tok3nABCDEF0123456789@hooks.example.com/x';" })
    expect(r.problems).toEqual(['자격증명? a.sql:1 (url-credentials) — 값은 가림'])
    expect(r.emails).toEqual([])
  })
  it('금지 ref 만 걸려도 이메일 보고는 하지 않는다(행 본문도 싣지 않는다)', () => {
    const r = auditOutputs({ 'a.sql': "select 'rglfgrwwwwdqejohdnty', 'ops.admin@example.org';" })
    expect(r.problems).toEqual(['금지 ref  a.sql:1 (rglfgrwwwwdqejohdnty) — 본문은 가림'])
    expect(r.emails).toEqual([])
  })
})

describe('postprocessDump', () => {
  const ext = [{ name: 'vector', schema: 'public' }, { name: 'pgcrypto', schema: 'extensions' }]
  it('메타명령·public 스키마 생성/주석을 지운다', () => {
    const { sql } = postprocessDump(DUMP, ext)
    expect(sql).not.toMatch(/\\restrict|\\unrestrict|CREATE SCHEMA public;|COMMENT ON SCHEMA public/)
    expect(sql).toContain('CREATE TABLE public.projects')
  })
  it('표준 롤 GRANT 는 남기고 그 밖의 롤 GRANT/REVOKE 는 제거·보고', () => {
    const { sql, droppedGrants } = postprocessDump(DUMP, ext)
    expect(sql).toContain('TO authenticated;')
    expect(sql).toContain('TO service_role;')
    expect(sql).not.toContain('staging_reader')
    expect(droppedGrants).toHaveLength(2)
  })
  it('확장을 파일 머리에 스키마 그대로 생성한다', () => {
    const { sql } = postprocessDump(DUMP, ext)
    expect(sql.indexOf('create extension if not exists "vector" with schema public;')).toBeLessThan(sql.indexOf('CREATE TABLE'))
    expect(sql).toContain('create extension if not exists "pgcrypto" with schema extensions;')
  })
  it('확장 생성 직후, 덤프 본문 앞에서 플랫폼의 public 기본 권한을 걷는다 — 객체가 acldefault 에서 출발해야 덤프의 GRANT/REVOKE 가 맞다', () => {
    const { sql } = postprocessDump(DUMP, ext)
    const lines = sql.split('\n')
    const revokes = ['tables', 'sequences', 'functions'].map((k) =>
      `alter default privileges for role postgres in schema public revoke all on ${k} from anon, authenticated, service_role;`)
    const at = revokes.map((l) => lines.indexOf(l))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(Math.min(...at)).toBeGreaterThan(lines.indexOf('create extension if not exists "pgcrypto" with schema extensions;'))
    expect(Math.max(...at)).toBeLessThan(lines.indexOf('SET statement_timeout = 0;'))
    // 덤프 끝의 FOR ROLE postgres 기본 권한 GRANT 는 그대로 남아 플랫폼 기본값을 되살린다.
    expect(lines.indexOf('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;'))
      .toBeGreaterThan(Math.max(...at))
  })
  it('금지 ref 가 본문에 있으면 줄 번호와 함께 throw', () => {
    expect(() => postprocessDump(`${DUMP}\nselect 'https://rglfgrwwwwdqejohdnty.supabase.co';`, ext)).toThrow(/금지.*\d+행/)
  })
  it('금지 ref 가 여러 줄이면 한 번에 모든 줄 번호를 보고한다(재접속 없이 한 번에 고치게)', () => {
    const dump = ['select 1;', "select 'rglfgrwwwwdqejohdnty';", 'select 2;', "select 'abtyahghvvkcriawffty';"].join('\n')
    let message = ''
    try { postprocessDump(dump, []) } catch (e) { message = (e as Error).message }
    expect(message).toMatch(/2건/)
    expect(message).toMatch(/2행.*rglfgrwwwwdqejohdnty/)
    expect(message).toMatch(/4행.*abtyahghvvkcriawffty/)
  })
  it('금지 ref 오류는 행 본문을 싣지 않는다 — 같은 줄의 키가 터미널로 새지 않게', () => {
    const key = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz'
    const dump = `perform net.http_post(headers := jsonb_build_object('apikey', '${key}'), url := 'https://rglfgrwwwwdqejohdnty.supabase.co/x');`
    let message = ''
    try { postprocessDump(dump, []) } catch (e) { message = (e as Error).message }
    expect(message).toMatch(/1행/)
    expect(message).not.toContain(key)
    expect(message).not.toContain('http_post')
  })
  it('ALTER DEFAULT PRIVILEGES 의 TO/FROM·FOR ROLE 롤 검사로 필터링한다', () => {
    const ext = [{ name: 'vector', schema: 'public' }]
    const { sql: sql1, droppedGrants: d1 } = postprocessDump('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO staging_reader;', ext)
    expect(sql1).not.toContain('staging_reader')
    expect(d1).toHaveLength(1)
    const { sql: sql2 } = postprocessDump('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;', ext)
    expect(sql2).toContain('TO service_role;')
    const { sql: sql3, droppedGrants: d3 } = postprocessDump('ALTER DEFAULT PRIVILEGES FOR ROLE some_owner IN SCHEMA public GRANT ALL ON TABLES TO anon;', ext)
    expect(sql3).not.toContain('some_owner')
    expect(d3).toHaveLength(1)
  })
  it('트레일링 절(WITH GRANT OPTION, GRANTED BY, CASCADE)을 제거하고 롤만 파싱한다', () => {
    const ext = [{ name: 'vector', schema: 'public' }]
    const { sql: sql1 } = postprocessDump('GRANT SELECT ON TABLE public.projects TO anon, authenticated, service_role WITH GRANT OPTION;', ext)
    expect(sql1).toContain('WITH GRANT OPTION;')
    const { sql: sql2, droppedGrants: d2 } = postprocessDump('GRANT ALL ON TABLE public.x TO anon GRANTED BY staging_reader;', ext)
    expect(sql2).not.toContain('staging_reader')
    expect(d2).toHaveLength(1)
    const { sql: sql3 } = postprocessDump('REVOKE ALL ON TABLE public.x FROM PUBLIC CASCADE;', ext)
    expect(sql3).toContain('FROM PUBLIC CASCADE;')
  })
  it('중첩된 트레일링 절(여럿 조합)을 반복 제거한다', () => {
    const ext = [{ name: 'vector', schema: 'public' }]
    const { sql: sql1 } = postprocessDump('GRANT SELECT ON TABLE t TO anon WITH GRANT OPTION GRANTED BY postgres;', ext)
    expect(sql1).toContain('TO anon WITH GRANT OPTION GRANTED BY postgres;')
    const { sql: sql2 } = postprocessDump('GRANT SELECT ON TABLE t TO anon, authenticated WITH GRANT OPTION GRANTED BY postgres;', ext)
    expect(sql2).toContain('TO anon, authenticated WITH GRANT OPTION GRANTED BY postgres;')
    const { sql: sql3, droppedGrants: d3 } = postprocessDump('GRANT ALL ON TABLE public.x TO anon WITH GRANT OPTION GRANTED BY staging_reader;', ext)
    expect(sql3).not.toContain('staging_reader')
    expect(d3).toHaveLength(1)
  })
  it('FOR ROLE 에서 따옴표를 제거하고 정규화한다', () => {
    const ext = [{ name: 'vector', schema: 'public' }]
    const { sql: sql1 } = postprocessDump('ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA public GRANT ALL ON TABLES TO anon;', ext)
    expect(sql1).toContain('TO anon;')
  })
  it('FOR ROLE supabase_admin 기본 권한은 지우고 보고한다 — postgres 가 그 롤의 기본 권한을 바꿀 수 없다(42501)', () => {
    const dump = [
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA public GRANT ALL ON TABLES TO service_role;',
      'GRANT ALL ON TABLE public.x TO supabase_admin;',
    ].join('\n')
    const { sql, droppedGrants } = postprocessDump(dump, [])
    expect(sql).toContain('FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;')
    expect(sql).not.toMatch(/FOR ROLE "?supabase_admin/)
    // 일반 GRANT 의 대상 롤로서는 그대로 둔다 — 막힌 것은 남의 기본 권한을 바꾸는 FOR ROLE 뿐이다.
    expect(sql).toContain('GRANT ALL ON TABLE public.x TO supabase_admin;')
    expect(droppedGrants).toHaveLength(2)
  })
  it('최상위 DDL 줄의 …atomic 식별자를 따옴표로 감싼다 — CLI 분할기가 BEGIN ATOMIC 본문으로 오인하지 않게', () => {
    const dump = [
      '-- Name: apply_item_atomic(p_id uuid, p_is_atomic boolean); Type: FUNCTION; Schema: public; Owner: -',
      "CREATE FUNCTION public.apply_item_atomic(p_id uuid, p_is_atomic boolean DEFAULT false, p_note text DEFAULT 'x_atomic'::text) RETURNS void",
      '    LANGUAGE plpgsql',
      '    AS $_$',
      'begin',
      '  perform public.other_atomic(p_id);',
      'end;',
      '$_$;',
      'REVOKE ALL ON FUNCTION public.apply_item_atomic(p_id uuid, p_is_atomic boolean) FROM PUBLIC;',
      'GRANT ALL ON FUNCTION public.apply_item_atomic(p_id uuid, p_is_atomic boolean) TO service_role;',
      'CREATE TRIGGER t AFTER INSERT ON public.x FOR EACH ROW EXECUTE FUNCTION public."already_atomic"();',
    ].join('\n')
    const { sql } = postprocessDump(dump, [])
    expect(sql).toContain('CREATE FUNCTION public."apply_item_atomic"(p_id uuid, "p_is_atomic" boolean DEFAULT false, p_note text DEFAULT \'x_atomic\'::text)')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public."apply_item_atomic"(p_id uuid, "p_is_atomic" boolean) FROM PUBLIC;')
    expect(sql).toContain('GRANT ALL ON FUNCTION public."apply_item_atomic"(p_id uuid, "p_is_atomic" boolean) TO service_role;')
    // 본문(달러 인용)·주석·문자열 리터럴·이미 따옴표인 식별자는 그대로 — 분할기가 보지 않는 곳이고 운영 원문을 바꾸지 않는다.
    expect(sql).toContain('  perform public.other_atomic(p_id);')
    expect(sql).toContain('-- Name: apply_item_atomic(p_id uuid, p_is_atomic boolean);')
    expect(sql).toContain('EXECUTE FUNCTION public."already_atomic"();')
    expect(sql).not.toContain('""')
  })
  it('SQL 표준 함수 본문의 BEGIN ATOMIC 키워드는 건드리지 않는다', () => {
    const { sql } = postprocessDump('CREATE FUNCTION public.f() RETURNS integer\n    LANGUAGE sql\n    BEGIN ATOMIC\n SELECT 1;\nEND;', [])
    expect(sql).toContain('    BEGIN ATOMIC')
    expect(sql).not.toContain('"ATOMIC"')
  })
})

const CAT = {
  policies: [
    { schema: 'storage', table: 'objects', name: 'minutes_read', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: "(bucket_id = 'minutes'::text)", with_check: null },
    { schema: 'storage', table: 'objects', name: 'minutes_insert', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'INSERT', qual: null, with_check: "(bucket_id = 'minutes'::text)" },
    { schema: 'realtime', table: 'messages', name: 'receive_own_notification_channel', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: '(realtime.topic() = (\'user-\'::text || (auth.uid())::text))', with_check: null },
    { schema: 'public', table: 'projects', name: 'p_read', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: 'true', with_check: null },
  ],
  functions: [], triggers: [], rls_tables: ['projects'],
  buckets: [{ id: 'minutes', name: 'my-minutes-bucket', public: false, file_size_limit: 52428800, allowed_mime_types: null }],
  extensions: [] as { name: string; schema: string }[],
  publication_tables: [{ schema: 'public', table: 'weekly_report_rows' }],
}

describe('buildStorageRealtimeSql', () => {
  const { forward, rollback } = buildStorageRealtimeSql(CAT)
  it('storage·realtime 정책만 생성하고 public 정책은 기준선 몫으로 뺀다', () => {
    expect(forward).toContain('create policy "minutes_read" on storage.objects as permissive for select to authenticated using ((bucket_id = \'minutes\'::text));')
    expect(forward).toContain('create policy "minutes_insert" on storage.objects as permissive for insert to authenticated with check ((bucket_id = \'minutes\'::text));')
    expect(forward).toContain('on realtime.messages')
    expect(forward).not.toContain('p_read')
  })
  it('버킷을 멱등 insert', () => {
    expect(forward).toContain("insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('minutes', 'my-minutes-bucket', false, 52428800, null) on conflict (id) do nothing;")
  })
  it('롤백은 정책 drop + 버킷 delete', () => {
    expect(rollback).toContain('drop policy if exists "minutes_read" on storage.objects;')
    expect(rollback).toContain("delete from storage.buckets where id in ('minutes');")
  })
  it('버킷 delete 는 Storage 의 직접 삭제 차단(storage.allow_delete_query)을 그 문장에만 풀고 되돌린다', () => {
    const lines = rollback.split('\n')
    const del = lines.indexOf("delete from storage.buckets where id in ('minutes');")
    expect(lines[del - 1]).toBe("set storage.allow_delete_query = 'true';")
    expect(lines[del + 1]).toBe('reset storage.allow_delete_query;')
  })
  it('버킷이 없으면 차단 해제도 하지 않는다', () => {
    const { rollback } = buildStorageRealtimeSql({ ...CAT, buckets: [] })
    expect(rollback).not.toContain('allow_delete_query')
    expect(rollback).not.toContain('delete from storage.buckets')
  })
  it('supabase_realtime 발행 테이블을 add, 롤백은 drop', () => {
    expect(forward).toContain('alter publication supabase_realtime add table public.weekly_report_rows;')
    expect(rollback).toContain('alter publication supabase_realtime drop table public.weekly_report_rows;')
  })
  it('발행 목록 키가 없으면 "발행 없음"으로 넘기지 않고 throw', () => {
    const old: Partial<typeof CAT> = structuredClone(CAT)
    delete old.publication_tables
    expect(() => buildStorageRealtimeSql(old)).toThrow(/publication_tables/)
  })
  it('빈 allowed_mime_types 는 타입이 붙은 빈 배열로 — array[] 는 타입을 못 정해 실패한다', () => {
    const cat = { ...CAT, buckets: [
      { id: 'a', name: 'a', public: true, file_size_limit: null, allowed_mime_types: [] },
      { id: 'b', name: 'b', public: false, file_size_limit: null, allowed_mime_types: ['image/png'] },
    ] }
    const { forward } = buildStorageRealtimeSql(cat)
    expect(forward).toContain("values ('a', 'a', true, null, '{}'::text[])")
    expect(forward).toContain("values ('b', 'b', false, null, array['image/png'])")
    expect(forward).not.toContain('array[]')
  })
})

describe('diffCatalog', () => {
  it('같으면 문제 0', () => { expect(diffCatalog(CAT, structuredClone(CAT)).problems).toEqual([]) })
  it('정책 누락·본문 차이·RLS 차이를 잡는다', () => {
    const local = structuredClone(CAT)
    local.policies = local.policies.filter((p) => p.name !== 'minutes_insert')
    local.policies[0].qual = 'true'
    local.rls_tables = []
    const { problems, counts } = diffCatalog(CAT, local)
    expect(problems.some((p) => p.includes('누락') && p.includes('minutes_insert'))).toBe(true)
    expect(problems.some((p) => p.includes('다름') && p.includes('minutes_read'))).toBe(true)
    expect(problems.some((p) => p.includes('RLS') && p.includes('projects'))).toBe(true)
    expect(counts.policies).toEqual({ expected: 4, actual: 3 })
  })
  it('realtime 발행 테이블 누락·초과를 잡는다', () => {
    const local = structuredClone(CAT)
    local.publication_tables = [{ schema: 'public', table: 'other' }]
    const { problems, counts } = diffCatalog(CAT, local)
    expect(problems).toContain('publication_tables 누락: public.weekly_report_rows')
    expect(problems).toContain('publication_tables 초과: public.other')
    expect(counts.publication_tables).toEqual({ expected: 1, actual: 1 })
  })
  it('로컬에만 있는 확장은 문제가 아니다(Supabase 기본 확장)', () => {
    const local = structuredClone(CAT)
    local.extensions = [{ name: 'pg_graphql', schema: 'graphql' }]
    expect(diffCatalog(CAT, local).problems).toEqual([])
  })
  it('운영에만 있는 확장도 보지 않는다 — 확장은 diffExtensions 규칙(기준선이 만들거나 쓰는 것만)', () => {
    const prod = { ...structuredClone(CAT), extensions: [{ name: 'supabase_vault', schema: 'vault' }, { name: 'pg_stat_statements', schema: 'extensions' }] }
    expect(diffCatalog(prod, structuredClone(CAT)).problems).toEqual([])
  })
})

describe('CATALOG_SQL', () => {
  it('확장 소속 함수를 제외한다(vector 가 public 에 있다)', () => { expect(CATALOG_SQL).toMatch(/deptype\s*=\s*'e'/) })
  it('supabase_realtime 발행 테이블을 마지막 키로 뜬다(pg_dump --schema=public 은 발행을 담지 않는다)', () => {
    expect(CATALOG_SQL).toMatch(/'publication_tables',[\s\S]*from pg_publication_tables where pubname\s*=\s*'supabase_realtime'/)
    expect(CATALOG_SQL.indexOf("'extensions'")).toBeLessThan(CATALOG_SQL.indexOf("'publication_tables'"))
  })
})

// 로컬 재생을 pg_dump 로 다시 떠서 운영 원본 dump.sql 과 맞대 보는 왕복 검사의 순수 부분.
const RAW_DUMP = [
  '\\restrict AbC',
  '-- Dumped by pg_dump version 17.11',
  'SET statement_timeout = 0;',
  "SELECT pg_catalog.set_config('search_path', '', false);",
  '',
  '--',
  '-- Name: purge(integer); Type: FUNCTION; Schema: public; Owner: -',
  '--',
  '',
  'CREATE FUNCTION public.apply_item_atomic(p integer) RETURNS void',
  '    LANGUAGE sql',
  '    AS $$ select 1 $$;',
  '',
  '--',
  '-- Name: FUNCTION purge(integer); Type: ACL; Schema: public; Owner: -',
  '--',
  '',
  'REVOKE ALL ON FUNCTION public.purge(integer) FROM PUBLIC;',
  'GRANT ALL ON FUNCTION public.purge(integer) TO service_role;',
  '',
  '--',
  '-- Name: TABLE t; Type: ACL; Schema: public; Owner: -',
  '--',
  '',
  'GRANT SELECT ON TABLE public.t TO authenticated;',
  '\\unrestrict AbC',
].join('\n')

describe('normalizeDumpForCompare', () => {
  it('\\restrict·주석·빈 줄·세션 SET·search_path 를 지우고 객체 머리(-- Name: …, Owner 제외)로 묶는다', () => {
    const blocks = normalizeDumpForCompare(RAW_DUMP)
    expect([...blocks.keys()]).toEqual([
      'purge(integer); Type: FUNCTION; Schema: public',
      'FUNCTION purge(integer); Type: ACL; Schema: public',
      'TABLE t; Type: ACL; Schema: public',
    ])
    expect(blocks.get('FUNCTION purge(integer); Type: ACL; Schema: public')).toEqual([
      'REVOKE ALL ON FUNCTION public.purge(integer) FROM PUBLIC;',
      'GRANT ALL ON FUNCTION public.purge(integer) TO service_role;',
    ])
  })
  it('기준선 가공이 붙인 …atomic 식별자 따옴표를 되돌린다(0000 과 덤프를 맞대도 같게)', () => {
    const quoted = RAW_DUMP.replace('public.apply_item_atomic(', 'public."apply_item_atomic"(')
    expect(normalizeDumpForCompare(quoted)).toEqual(normalizeDumpForCompare(RAW_DUMP))
  })
  it('CRLF 도 같게 본다', () => {
    expect(normalizeDumpForCompare(RAW_DUMP.replace(/\n/g, '\r\n'))).toEqual(normalizeDumpForCompare(RAW_DUMP))
  })
})

describe('diffDumps', () => {
  it('잡음만 다르면 차이 0 — 머리·SET·pg_dump 버전·객체 순서', () => {
    const blocks = RAW_DUMP.split('\n\n--\n')
    const reordered = [blocks[0], blocks[2], blocks[1], blocks[3]].join('\n\n--\n')
      .replace('17.11', '17.6').replace('\\restrict AbC', '\\restrict Zz9').replace('\\unrestrict AbC', '\\unrestrict Zz9')
    expect(diffDumps(RAW_DUMP, reordered)).toEqual([])
  })
  it('같은 객체 블록 안의 권한 차이를 객체 머리와 함께 보고한다', () => {
    const local = RAW_DUMP.replace('TO service_role;', 'TO service_role;\nGRANT ALL ON FUNCTION public.purge(integer) TO anon;')
    expect(diffDumps(RAW_DUMP, local)).toEqual([{
      key: 'FUNCTION purge(integer); Type: ACL; Schema: public',
      onlyA: [],
      onlyB: ['GRANT ALL ON FUNCTION public.purge(integer) TO anon;'],
    }])
  })
  it('한쪽에만 있는 객체 블록(운영엔 ACL 이 기본값이라 블록이 없는 경우)을 잡는다', () => {
    const local = `${RAW_DUMP}\n\n--\n-- Name: TABLE u; Type: ACL; Schema: public; Owner: -\n--\n\nGRANT ALL ON TABLE public.u TO anon;`
    expect(diffDumps(RAW_DUMP, local)).toEqual([{ key: 'TABLE u; Type: ACL; Schema: public', onlyA: [], onlyB: ['GRANT ALL ON TABLE public.u TO anon;'] }])
  })
  it('같은 줄이 한쪽에 더 많으면 그 개수만큼 보고한다(줄 집합이 아니라 다중집합)', () => {
    const local = RAW_DUMP.replace('GRANT SELECT ON TABLE public.t TO authenticated;', 'GRANT SELECT ON TABLE public.t TO authenticated;\nGRANT SELECT ON TABLE public.t TO authenticated;')
    expect(diffDumps(RAW_DUMP, local)).toEqual([{ key: 'TABLE t; Type: ACL; Schema: public', onlyA: [], onlyB: ['GRANT SELECT ON TABLE public.t TO authenticated;'] }])
  })
  it('ACL 블록 안의 줄 순서는 차이가 아니다(aclitem 순서는 흔들린다)', () => {
    const local = RAW_DUMP.replace(
      'REVOKE ALL ON FUNCTION public.purge(integer) FROM PUBLIC;\nGRANT ALL ON FUNCTION public.purge(integer) TO service_role;',
      'GRANT ALL ON FUNCTION public.purge(integer) TO service_role;\nREVOKE ALL ON FUNCTION public.purge(integer) FROM PUBLIC;')
    expect(local).not.toBe(RAW_DUMP)
    expect(diffDumps(RAW_DUMP, local)).toEqual([])
  })
  it('ACL 밖 블록은 줄 순서까지 본다 — 함수 본문의 줄이 자리를 바꾸면 그 줄을 양쪽에 보고한다', () => {
    const local = RAW_DUMP.replace('    LANGUAGE sql\n    AS $$ select 1 $$;', () => '    AS $$ select 1 $$;\n    LANGUAGE sql')
    expect(local).toContain('    AS $$ select 1 $$;\n    LANGUAGE sql')
    const diffs = diffDumps(RAW_DUMP, local)
    expect(diffs.map((d: { key: string }) => d.key)).toEqual(['purge(integer); Type: FUNCTION; Schema: public'])
    expect(diffs[0].onlyA).toHaveLength(1)
    expect(diffs[0].onlyB).toEqual(diffs[0].onlyA)
  })
  it('여러 줄 정책 식의 줄 순서가 바뀌어도 잡는다', () => {
    const policy = [
      '--', '-- Name: f p_del; Type: POLICY; Schema: public; Owner: -', '--', '',
      'CREATE POLICY p_del ON public.f FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1',
      '   FROM public.m mi',
      '  WHERE (mi.id = f.m))));',
    ]
    const a = `${RAW_DUMP}\n\n${policy.join('\n')}`
    const b = `${RAW_DUMP}\n\n${[...policy.slice(0, 5), policy[6], policy[5]].join('\n')}`
    const diffs = diffDumps(a, b)
    expect(diffs.map((d: { key: string }) => d.key)).toEqual(['f p_del; Type: POLICY; Schema: public'])
    expect([...diffs[0].onlyA, ...diffs[0].onlyB].length).toBeGreaterThan(0)
  })
  it('순서를 보는 블록도 한쪽에만 있는 줄은 그 줄만 보고한다(공통 앞뒤는 차이가 아니다)', () => {
    const local = RAW_DUMP.replace('    LANGUAGE sql', '    LANGUAGE sql\n    SECURITY DEFINER')
    expect(diffDumps(RAW_DUMP, local)).toEqual([{ key: 'purge(integer); Type: FUNCTION; Schema: public', onlyA: [], onlyB: ['    SECURITY DEFINER'] }])
  })
})

// ── 기준선 대조(scripts/baseline-diff.mjs) ─────────────────────────────────────────────
// 로컬 재생본 pg_dump 의 모양 — 운영 원본 dump.sql 과도 같다(Task 6 에서 머리 주석 한 줄 말고 전부 일치).
const GRANTEES = ['postgres', 'anon', 'authenticated', 'service_role']
const block = (head: string, lines: string[]) => ['', '--', `-- Name: ${head}; Owner: -`, '--', '', ...lines]
const defaultAcl = (owner: string) => ['FUNCTIONS', 'SEQUENCES', 'TABLES'].flatMap((kind) =>
  block(`DEFAULT PRIVILEGES FOR ${kind}; Type: DEFAULT ACL; Schema: public`,
    GRANTEES.map((r) => `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON ${kind} TO ${r};`)))
const LOCAL_DUMP = [
  '--', '-- PostgreSQL database dump', '--', '', '\\restrict Tok', '',
  '-- Dumped from database version 17.6', '-- Dumped by pg_dump version 17.6', '',
  'SET statement_timeout = 0;', "SELECT pg_catalog.set_config('search_path', '', false);",
  ...block('public; Type: SCHEMA; Schema: -', ['CREATE SCHEMA public;']),
  ...block('apply_item_atomic(p integer); Type: FUNCTION; Schema: public', [
    'CREATE FUNCTION public.apply_item_atomic(p integer) RETURNS void', '    LANGUAGE sql', '    AS $$ select 1 $$;']),
  ...block('projects read_all_projects; Type: POLICY; Schema: public', [
    'CREATE POLICY read_all_projects ON public.projects FOR SELECT TO authenticated USING (true);']),
  ...block('FUNCTION apply_item_atomic(p integer); Type: ACL; Schema: public', [
    'REVOKE ALL ON FUNCTION public.apply_item_atomic(p integer) FROM PUBLIC;',
    'GRANT ALL ON FUNCTION public.apply_item_atomic(p integer) TO service_role;']),
  ...defaultAcl('postgres'),
  ...defaultAcl('supabase_admin'),
  '', '--', '-- PostgreSQL database dump complete', '--', '', '\\unrestrict Tok', '',
].join('\n')
const EXT = [{ name: 'pg_trgm', schema: 'public' }, { name: 'pgcrypto', schema: 'extensions' }]
// 운영 원본이 로컬 재생본과 같다는 전제에서, 커밋되는 0000 은 그 원본을 가공한 것이다.
const BASELINE = postprocessDump(LOCAL_DUMP, EXT).sql
const roundTrip = (baseline: string, local: string) =>
  checkRoundTrip(diffDumps(baseline, local), roundTripResidue(baselineExtensions(baseline)))

describe('baselineExtensions — 0000 머리의 create extension 줄 = 기준선이 스스로 만드는 확장', () => {
  it('가공 결과의 머리에서 확장을 이름·스키마 그대로 읽는다', () => {
    expect(baselineExtensions(BASELINE)).toEqual(EXT)
  })
  it('머리 밖(객체 블록 안)의 create extension 줄은 기준선 선언이 아니다', () => {
    const later = `${BASELINE}\n--\n-- Name: x; Type: TABLE; Schema: public; Owner: -\n--\ncreate extension if not exists "pg_net" with schema extensions;`
    expect(baselineExtensions(later)).toEqual(EXT)
  })
})

describe('roundTripResidue·checkRoundTrip — 커밋된 0000 ↔ 로컬 재생본 pg_dump, 허용 잔차는 줄 단위로 정확히', () => {
  it('허용 잔차는 가공 규칙이 만든 차이 그대로다 — 머리(확장·기본 권한 초기화)·CREATE SCHEMA public·FOR ROLE supabase_admin 12줄', () => {
    const residue = roundTripResidue(EXT)
    expect(residue.map((r: { side: string, key: string, lines: string[] }) => [r.side, r.key, r.lines.length])).toEqual([
      ['baseline', '(머리)', 5],
      ['local', 'public; Type: SCHEMA; Schema: -', 1],
      ['local', 'DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public', 4],
      ['local', 'DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public', 4],
      ['local', 'DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public', 4],
    ])
    expect(residue[0].lines).toEqual([
      'create extension if not exists "pg_trgm" with schema public;',
      'create extension if not exists "pgcrypto" with schema extensions;',
      ...['tables', 'sequences', 'functions'].map((k) =>
        `alter default privileges for role postgres in schema public revoke all on ${k} from anon, authenticated, service_role;`),
    ])
    expect(residue[4].lines).toEqual(GRANTEES.map((r) => `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO ${r};`))
    expect(residue.every((r: { why: string }) => r.why.length > 0)).toBe(true)
  })
  it('postprocessDump 가 만든 0000 과 로컬 덤프를 맞대면 차이가 허용 잔차와 정확히 같다 → 문제 0', () => {
    expect(diffDumps(BASELINE, LOCAL_DUMP).length).toBe(5)
    expect(roundTrip(BASELINE, LOCAL_DUMP)).toEqual([])
  })
  it('ACL 회귀(로컬에만 생긴 GRANT)는 객체 머리와 줄을 그대로 보고한다', () => {
    const local = LOCAL_DUMP.replace('TO service_role;', 'TO service_role;\nGRANT ALL ON FUNCTION public.apply_item_atomic(p integer) TO anon;')
    expect(roundTrip(BASELINE, local)).toEqual([
      '덤프 [FUNCTION apply_item_atomic(p integer); Type: ACL; Schema: public] 로컬만: GRANT ALL ON FUNCTION public.apply_item_atomic(p integer) TO anon;',
    ])
  })
  it('로컬에서 사라진 정책은 기준선만 줄로 보고한다', () => {
    const local = LOCAL_DUMP.replace('CREATE POLICY read_all_projects ON public.projects FOR SELECT TO authenticated USING (true);', '')
    expect(roundTrip(BASELINE, local)).toEqual([
      '덤프 [projects read_all_projects; Type: POLICY; Schema: public] 기준선만: CREATE POLICY read_all_projects ON public.projects FOR SELECT TO authenticated USING (true);',
    ])
  })
  it('허용 잔차 블록 안이라도 목록 밖 줄은 걸린다 — 블록·패턴 단위로 넓게 봐주지 않는다', () => {
    const extra = 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO supabase_read_only_user;'
    const local = LOCAL_DUMP.replace('GRANT ALL ON FUNCTIONS TO service_role;', `GRANT ALL ON FUNCTIONS TO service_role;\n${extra}`)
    expect(roundTrip(BASELINE, local)).toContain(`덤프 [DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public] 로컬만: ${extra}`)
    // 같은 줄이 두 번이어도(다중집합) 한 번만 허용한다.
    const dup = 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;'
    expect(roundTrip(BASELINE, LOCAL_DUMP.replace(dup, `${dup}\n${dup}`)))
      .toEqual([`덤프 [DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public] 로컬만: ${dup}`])
  })
  it('허용 잔차가 덤프에 없어도 문제다 — 지운 근거(이미지가 같은 기본 권한을 건다)가 무너졌다는 뜻', () => {
    const gone = 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;'
    const problems = roundTrip(BASELINE, LOCAL_DUMP.replace(`${gone}\n`, ''))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^덤프 \[DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public\] 허용 잔차 없음\(로컬만이어야\): /)
    expect(problems[0]).toContain(gone)
  })
  it('기본 권한 초기화 줄이 빠진 0000 도 걸린다(재생 때 권한이 되살아난다)', () => {
    const reset = 'alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;'
    const problems = roundTrip(BASELINE.replace(`${reset}\n`, ''), LOCAL_DUMP)
    expect(problems).toEqual([expect.stringMatching(/^덤프 \[\(머리\)\] 허용 잔차 없음\(기준선만이어야\): alter default privileges .* on functions /)])
  })
  it('0000 머리에 끼운 다른 문장(예: 일괄 GRANT)은 걸린다', () => {
    const sneaky = BASELINE.replace('create extension if not exists "pg_trgm" with schema public;',
      'create extension if not exists "pg_trgm" with schema public;\ngrant all on all tables in schema public to anon;')
    expect(roundTrip(sneaky, LOCAL_DUMP)).toEqual(['덤프 [(머리)] 기준선만: grant all on all tables in schema public to anon;'])
  })
  it('기본 권한 블록(두 소유자가 같은 머리로 합쳐진다)의 순서와 0000 머리 줄 순서는 차이가 아니다', () => {
    const [pg, sa] = [defaultAcl('postgres').join('\n'), defaultAcl('supabase_admin').join('\n')]
    const swapped = LOCAL_DUMP.replace(`${pg}\n${sa}`, `${sa}\n${pg}`)
    expect(swapped).not.toBe(LOCAL_DUMP)
    expect(roundTrip(BASELINE, swapped)).toEqual([])
    const heads = BASELINE.replace(
      'create extension if not exists "pg_trgm" with schema public;\ncreate extension if not exists "pgcrypto" with schema extensions;',
      'create extension if not exists "pgcrypto" with schema extensions;\ncreate extension if not exists "pg_trgm" with schema public;')
    expect(heads).not.toBe(BASELINE)
    expect(diffDumps(BASELINE, heads)).toEqual([])
  })
  it('따옴표 규칙(…atomic)·머리 주석·\\restrict·pg_dump 버전은 차이가 아니다', () => {
    expect(BASELINE).toContain('public."apply_item_atomic"(')
    const noisy = LOCAL_DUMP.replace(/Tok/g, 'Other').replace('pg_dump version 17.6', 'pg_dump version 17.11 (Debian)')
    expect(roundTrip(BASELINE, noisy)).toEqual([])
  })
  it('잔차 없는 비교(--raw: 운영 원본 ↔ 로컬)는 이름표를 바꿔 쓴다', () => {
    const local = LOCAL_DUMP.replace('TO service_role;', 'TO service_role;\nGRANT ALL ON FUNCTION public.apply_item_atomic(p integer) TO anon;')
    expect(checkRoundTrip(diffDumps(LOCAL_DUMP, LOCAL_DUMP), [], ['운영 원본', '로컬'])).toEqual([])
    expect(checkRoundTrip(diffDumps(LOCAL_DUMP, local), [], ['운영 원본', '로컬'])).toEqual([
      '덤프 [FUNCTION apply_item_atomic(p integer); Type: ACL; Schema: public] 로컬만: GRANT ALL ON FUNCTION public.apply_item_atomic(p integer) TO anon;',
    ])
    expect(checkRoundTrip(diffDumps(local, LOCAL_DUMP), [], ['운영 원본', '로컬'])[0]).toContain('] 운영 원본만: GRANT ALL')
  })
})

describe('baselineMigrationProblem — 게이트는 기준선(0000·0001)만 대조한다', () => {
  it('정확히 0000·0001 이면 문제 없음(순서 무관)', () => {
    expect(baselineMigrationProblem(['0000', '0001'])).toBeNull()
    expect(baselineMigrationProblem(['0001', '0000'])).toBeNull()
  })
  it('기준선 뒤 마이그레이션이 있으면 한 줄로 이유와 되돌리는 명령을 준다', () => {
    const msg = baselineMigrationProblem(['0000', '0001', '0002', '0003'])
    expect(msg).toContain('0002, 0003')
    expect(msg).toContain('기준선')
    expect(msg).toContain('supabase db reset --version 0001')
    expect(msg).not.toContain('\n')
  })
  it('기준선이 덜 적용됐거나 비어 있어도 멈춘다(통과로 보지 않는다)', () => {
    expect(baselineMigrationProblem(['0000'])).toMatch(/0001/)
    expect(baselineMigrationProblem([])).toMatch(/0000, 0001/)
    expect(baselineMigrationProblem(['0000', '0002'])).toContain('supabase db reset --version 0001')
  })
  it('사전 조회는 서버 버전과 적용된 마이그레이션 버전을 함께 읽는다', () => {
    expect(LOCAL_PREFLIGHT_SQL).toMatch(/version\(\)/)
    expect(LOCAL_PREFLIGHT_SQL).toMatch(/from supabase_migrations\.schema_migrations/)
  })
})

describe('diffExtensions — 기준선이 만드는 확장(0000 머리) + 기준선 객체가 기대는 확장(pg_depend)만 맞댄다', () => {
  const PROD = [
    { name: 'pg_stat_statements', schema: 'extensions' }, { name: 'pg_trgm', schema: 'public' },
    { name: 'pgcrypto', schema: 'extensions' }, { name: 'supabase_vault', schema: 'vault' },
    { name: 'uuid-ossp', schema: 'extensions' }, { name: 'vector', schema: 'public' },
  ]
  const DECLARED = PROD.filter((x) => ['pg_trgm', 'pgcrypto', 'uuid-ossp', 'vector'].includes(x.name))
  const DEPENDS = PROD.filter((x) => ['pg_trgm', 'vector'].includes(x.name))
  const LOCAL = [...DECLARED, { name: 'pg_graphql', schema: 'graphql' }, { name: 'pg_net', schema: 'extensions' }]
  const run = (over: Record<string, unknown> = {}) => diffExtensions({ declared: DECLARED, depends: DEPENDS, expected: PROD, actual: LOCAL, ...over })
  it('운영의 관리형 확장(기준선이 만들지도 쓰지도 않음)은 로컬에 없어도 문제가 아니고 skipped 로 보고한다', () => {
    const r = run()
    expect(r.problems).toEqual([])
    expect(r.compared).toEqual(['pg_trgm@public', 'pgcrypto@extensions', 'uuid-ossp@extensions', 'vector@public'])
    expect(r.skipped).toEqual(['pg_stat_statements', 'supabase_vault'])
  })
  it('기준선이 만드는 확장이 로컬에 없거나 다른 스키마면 문제', () => {
    expect(run({ actual: LOCAL.filter((x) => x.name !== 'vector') }).problems).toEqual(['확장 누락: vector@public'])
    expect(run({ actual: LOCAL.map((x) => (x.name === 'pg_trgm' ? { ...x, schema: 'extensions' } : x)) }).problems)
      .toEqual(['확장 스키마 다름: pg_trgm 로컬 extensions · 기준선 public'])
  })
  it('기준선이 만드는 확장이 운영에 없거나 운영과 스키마가 다르면 문제(기준선이 확장을 지어내거나 옮기지 않는다)', () => {
    expect(run({ declared: [...DECLARED, { name: 'citext', schema: 'public' }], actual: [...LOCAL, { name: 'citext', schema: 'public' }] }).problems)
      .toEqual(['확장 운영에 없음: citext@public'])
    expect(run({ expected: PROD.map((x) => (x.name === 'vector' ? { ...x, schema: 'extensions' } : x)) }).problems)
      .toEqual(['확장 스키마 다름: vector 운영 extensions · 기준선 public'])
  })
  it('기준선이 만들지 않아도 기대는 확장은 맞댄다 — 운영과 같으면 통과, 운영에 없으면 문제', () => {
    const vault = { name: 'supabase_vault', schema: 'vault' }
    const withVault = run({ depends: [...DEPENDS, vault], actual: [...LOCAL, vault] })
    expect(withVault.problems).toEqual([])
    expect(withVault.compared).toContain('supabase_vault@vault')
    expect(withVault.skipped).toEqual(['pg_stat_statements'])
    const net = { name: 'pg_net', schema: 'extensions' }
    expect(run({ depends: [...DEPENDS, net] }).problems).toEqual(['확장 운영에 없음: pg_net@extensions'])
  })
  it('선언과 의존이 같은 확장을 다른 스키마로 말하면 모순으로 보고한다', () => {
    expect(run({ depends: [{ name: 'vector', schema: 'extensions' }] }).problems).toContain('확장 스키마 모순: vector (public · extensions)')
  })
})

describe('EXTENSION_DEPS_SQL — 기준선 객체가 pg_depend 로 기대는 확장', () => {
  it('확장 소속 객체는 빼고(확장 내부), public 객체만, plpgsql 은 빼고 본다', () => {
    expect(EXTENSION_DEPS_SQL).toMatch(/not exists \(select 1 from pg_depend x where[^)]*x\.deptype = 'e'\)/)
    expect(EXTENSION_DEPS_SQL).toMatch(/object_names\[1\] = 'public'/)
    expect(EXTENSION_DEPS_SQL).toMatch(/extname <> 'plpgsql'/)
  })
})

describe('renderLiveCatalogSnapshot — SP2 입력용 라이브 정책 목록', () => {
  const cat = {
    ...structuredClone(CAT), capturedAt: '2026-09-23T14:43:43.824Z', cutoff: 'wbs-web@77cf6785',
    policies: [
      ...CAT.policies,
      { schema: 'public', table: 'items', name: 'items_all', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'ALL', qual: 'true', with_check: 'true' },
      { schema: 'public', table: 'items', name: 'items_ins', permissive: 'PERMISSIVE', roles: ['authenticated', 'anon'], cmd: 'INSERT', qual: null, with_check: 'true' },
      { schema: 'public', table: 'items', name: 'items_sub', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'DELETE', qual: '(EXISTS ( SELECT 1\n   FROM p\n  WHERE (p.id = items.p)))', with_check: null },
      { schema: 'public', table: 'items', name: 'items_tick', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'UPDATE', qual: "(note <> '`x`'::text)", with_check: null },
    ],
  }
  const md = renderLiveCatalogSnapshot(cat)
  const rows = md.split('\n').filter((l: string) => l.startsWith('| ') && !l.startsWith('| 테이블'))
  it('머리에 덤프 시각·컷오프, 종류별 개수, using (true) 읽기 정책 수(SELECT·ALL 만)', () => {
    expect(md.startsWith('# 운영 라이브 카탈로그 스냅샷 (2026-09-23T14:43:43.824Z, wbs-web@77cf6785)\n')).toBe(true)
    expect(md).toContain('node scripts/baseline-diff.mjs --snapshot')
    for (const line of ['- policies: 8', '- functions: 0', '- triggers: 0', '- buckets: 1', '- rls_tables: 1', '- publication_tables: 1']) expect(md).toContain(line)
    expect(md).toContain('- `using (true)` 읽기 정책: 2')
  })
  it('정책마다 한 행, 카탈로그 순서 그대로', () => {
    expect(rows).toHaveLength(8)
    expect(rows[3]).toBe('| public.projects | p_read | SELECT | authenticated | `true` | — |')
    expect(rows[5]).toBe('| public.items | items_ins | INSERT | authenticated,anon | — | `true` |')
  })
  it('| 는 \\| 로, 여러 줄 식은 한 줄로, 백틱이 든 식은 더 긴 울타리로 — 표가 깨지지 않게', () => {
    expect(rows[2]).toContain("`(realtime.topic() = ('user-'::text \\|\\| (auth.uid())::text))`")
    expect(rows[6]).toContain('`(EXISTS ( SELECT 1 FROM p WHERE (p.id = items.p)))`')
    expect(rows[7]).toContain("``(note <> '`x`'::text)``")
    expect(rows.every((r: string) => r.split(/(?<!\\)\|/).length === 8)).toBe(true)
  })
  it('커밋된 스냅샷은 커밋된 prod-catalog.json 에서 다시 만든 것과 같고 금지 ref·자격증명이 없다', () => {
    const prod = JSON.parse(readFileSync('docs/baseline/prod-catalog.json', 'utf8'))
    const committed = readFileSync('docs/baseline/2026-09-23-live-catalog.md', 'utf8')
    expect(committed).toBe(renderLiveCatalogSnapshot(prod))
    expect(auditOutputs({ snapshot: committed }).problems).toEqual([])
  })
})
