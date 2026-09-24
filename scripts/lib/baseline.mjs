// scripts/lib/baseline.mjs — 운영 스키마 덤프를 D-Flow 기준선으로 가공하는 순수 함수(SP0 스펙 3절).
import { FORBIDDEN_REFS } from './targets.mjs'

export const STANDARD_ROLES = Object.freeze([
  'postgres', 'anon', 'authenticated', 'service_role', 'supabase_admin', 'supabase_auth_admin',
  'supabase_storage_admin', 'authenticator', 'dashboard_user', 'pgbouncer', 'supabase_realtime_admin',
  'supabase_replication_admin', 'supabase_read_only_user', 'PUBLIC',
])

export const CATALOG_SQL = `select json_build_object(
  'policies', (select coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename,'name',policyname,
      'permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'with_check',with_check)
      order by schemaname,tablename,policyname),'[]') from pg_policies where schemaname in ('public','storage','realtime')),
  'functions', (select coalesce(json_agg(json_build_object('name',p.proname,'args',pg_get_function_identity_arguments(p.oid),
      'secdef',p.prosecdef) order by p.proname, pg_get_function_identity_arguments(p.oid)),'[]')
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype = 'e')),
  'triggers', (select coalesce(json_agg(json_build_object('table',c.relname,'name',t.tgname,'def',pg_get_triggerdef(t.oid))
      order by c.relname,t.tgname),'[]') from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public'),
  'rls_tables', (select coalesce(json_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public' and rowsecurity),
  'buckets', (select coalesce(json_agg(json_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,
      'allowed_mime_types',allowed_mime_types) order by id),'[]') from storage.buckets),
  'extensions', (select coalesce(json_agg(json_build_object('name',e.extname,'schema',n.nspname) order by e.extname),'[]')
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname <> 'plpgsql'),
  'publication_tables', (select coalesce(json_agg(json_build_object('schema',schemaname,'table',tablename)
      order by schemaname,tablename),'[]') from pg_publication_tables where pubname = 'supabase_realtime')
)::text`

// 마이그레이션을 돌리는 postgres 는 이 롤의 구성원이 아니라 FOR ROLE 로 그 기본 권한을 바꿀 수 없다(db reset 이 42501).
// 지워도 안전하다: 같은 내용(public 스키마에서 이 롤이 만드는 객체를 postgres·anon·authenticated·service_role 에 ALL)을
// Supabase 이미지가 초기화 때 이미 건다 — 로컬 db reset 뒤 pg_default_acl 에서 세 종류(r·S·f) 모두 확인했다.
const DEFAULT_ACL_NOT_OURS = Object.freeze(['supabase_admin'])
const GRANT_RE = /^(GRANT|REVOKE)\b.*\b(TO|FROM)\s+(.+?);\s*$/
const ALTER_DEFAULT_RE = /^ALTER DEFAULT PRIVILEGES\s+(?:FOR ROLE\s+(\S+)\s+)?(.+?)(TO|FROM)\s+(.+?);\s*$/

function extractRoles(roleStr) {
  const roles = []
  // Extract all GRANTED BY roles (may appear multiple times)
  const grantedByMatches = roleStr.match(/GRANTED\s+BY\s+(\S+)/gi)
  if (grantedByMatches) {
    grantedByMatches.forEach((match) => {
      const roleMatch = match.match(/GRANTED\s+BY\s+(\S+)/i)
      if (roleMatch) {
        roles.push(roleMatch[1].replace(/^"|"$/g, ''))
      }
    })
  }
  // Strip trailing clauses repeatedly until none remain
  let normalized = roleStr
  let prev
  do {
    prev = normalized
    normalized = normalized.replace(/\s+(WITH\s+(?:GRANT|ADMIN)\s+OPTION|GRANTED\s+BY\s+\S+|CASCADE|RESTRICT)(\s|;|$)/i, '$2').trim()
  } while (normalized !== prev)

  const mainRoles = normalized.split(',').map((r) => {
    r = r.trim()
    return r.replace(/^"|"$/g, '')
  }).filter(Boolean)
  return [...mainRoles, ...roles]
}

/**
 * 금지 ref 를 담은 모든 행 — 첫 행에서 멈추지 않는다(한 번에 다 보여야 운영 재접속 없이 한 번에 고친다).
 * 행 본문은 돌려주지 않는다: 같은 줄에 키가 있으면 오류 메시지로 터미널에 샌다. 본문은 로컬 원본(0600)에서 본다.
 */
export function findForbiddenLines(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    const ref = FORBIDDEN_REFS.find((r) => line.includes(r))
    if (ref) hits.push({ line: i + 1, ref })
  })
  return hits
}

// 스키마 본문에 박힌 자격증명. 대시보드에서 만든 Database Webhook 은 Authorization 헤더를 트리거 정의에
// 그대로 담고, JWT 의 ref 는 base64 라 findForbiddenLines 의 평문 검사를 빠져나간다. 휴리스틱이다 — 오탐은 쓰기를
// 막을 뿐(원본은 남는다) 규칙을 고쳐 --from-raw 로 다시 만들면 된다.
const SECRET_PATTERNS = [
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
  ['bearer', /Bearer\s+[A-Za-z0-9._-]{16,}/i],
  ['basic-auth', /\bBasic\s+[A-Za-z0-9+/=]{16,}/],
  ['sb-secret', /\bsb_secret_[A-Za-z0-9_-]{8,}/],
  ['supabase-pat', /\bsbp_[A-Za-z0-9]{20,}/],
  ['stripe-key', /\b(sk|rk)_(live|test)_/],
  ['stripe-webhook-secret', /\bwhsec_/],
  ['openai-key', /\bsk-(proj-)?[A-Za-z0-9_-]{20,}/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{36}|\bgithub_pat_/],
  ['slack-token', /\bxox[abpors]-/],
  ['slack-webhook', /hooks\.slack\.com\/services\//],
  ['discord-webhook', /discord(app)?\.com\/api\/webhooks\//],
  // userinfo 는 비밀번호가 없어도(scheme://<token>@host) 자격증명으로 본다 — 토큰을 사용자 자리에 싣는 URL 이 흔하다.
  ['url-credentials', /[a-z][a-z0-9+.-]*:\/\/(?:[^/\s:@'"]+:[^@\s'"]+|[^/?#\s:@'"]+:?)@/i],
  ['url-query-secret', /[?&](api_?key|key|token|secret|access_token|sig|signature)=[^&\s'"]{8,}/i],
  ['assigned-secret', /(api[_-]?key|secret|password|token)["']?\s*(?::=|=>|[:=])\s*['"][^'"\s]{12,}['"]/i],
]
const HEADER_NAMES = 'authorization|apikey|api[-_]key|x-api-key'
// "Authorization":"…" (카탈로그 JSON 안에서는 \"…\" 로 이스케이프된다)와 jsonb_build_object('apikey', '…') 쉼표 형식.
const HEADER_JSON = new RegExp(`\\\\?"(${HEADER_NAMES})\\\\?"\\s*:\\s*\\\\?"([^"\\\\]{12,})`, 'gi')
const HEADER_PAIR = new RegExp(`'(${HEADER_NAMES})'\\s*,\\s*'([^']{12,})'`, 'gi')
const isPlaceholder = (v) => /[<>{}$]|\b(your|example|placeholder|changeme|dummy|redacted|todo)\b|x{4,}|\*{3,}|\.\.\./i.test(v)
const literals = (line) => line.match(/'(?:[^']|'')*'/g) ?? []
const LINE_CHECKS = [
  ['auth-header-json', (line) => [...line.matchAll(HEADER_JSON)].some((m) => !isPlaceholder(m[2]))],
  ['auth-header-pair', (line) => [...line.matchAll(HEADER_PAIR)].some((m) => !isPlaceholder(m[2]))],
  // libpq 연결 문자열 안의 password= — 리터럴 안에 host/dbname/user/port= 가 함께 있을 때만(평범한 비교식 제외).
  ['conninfo-password', (line) => literals(line).some((lit) =>
    /\b(host|hostaddr|dbname|user|port)\s*=/i.test(lit) && /\bpassword\s*=\s*[^\s'"]{6,}/i.test(lit))],
  // 'service_role' 이 든 리터럴에 키 모양 토큰(32자 이상, 영문+숫자)이 함께 있을 때만 — auth.role() = 'service_role' 은 통과.
  ['service-role-literal', (line) => literals(line).some((lit) => lit.includes('service_role') &&
    (lit.match(/[A-Za-z0-9_\-.+/=]{32,}/g) ?? []).some((t) => /\d/.test(t) && /[A-Za-z]/.test(t)))],
]

/** 자격증명처럼 보이는 행 — 값은 돌려주지 않는다(줄 번호와 패턴 이름만). */
export function findSecretLikeLines(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    for (const [pattern, re] of SECRET_PATTERNS) if (re.test(line)) hits.push({ line: i + 1, pattern })
    for (const [pattern, check] of LINE_CHECKS) if (check(line)) hits.push({ line: i + 1, pattern })
  })
  return hits
}

// URL 의 userinfo(scheme://user:pass@ · scheme://token@) — 이메일로 읽으면 비밀번호·토큰 첫 글자와 호스트가 보고에 실린다.
// 스킴 앞 룩비하인드: 긴 영숫자 줄에서 모든 위치를 스킴 시작으로 다시 훑지 않게(선형).
const URL_USERINFO = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s'"]*@/g

/** 이메일 주소 — 쓰기를 막지 않는 보고용. 로컬 부분은 첫 글자만 남기고 가린다. URL userinfo 는 이메일이 아니다(자격증명 검사 몫). */
export function findEmails(text) {
  const hits = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.replace(URL_USERINFO, '').matchAll(/([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g)) {
      hits.push({ line: i + 1, masked: `${m[1][0]}***@${m[2]}` })
    }
  })
  return hits
}

/**
 * 기준선 출력 검사 — 막는 검사(금지 ref·자격증명)가 먼저다. 하나라도 걸리면 이메일 보고는 아예 하지 않는다:
 * 이메일 정규식이 비밀 조각(가린 첫 글자)과 호스트를 끌어낼 수 있는 줄이 바로 그 걸린 줄이다.
 * 어느 쪽도 행 본문·값을 싣지 않는다(같은 줄의 비밀이 터미널로 새지 않게) — 본문은 보관 위치의 원본에서 직접 본다.
 */
export function auditOutputs(outputs) {
  const entries = Object.entries(outputs)
  const problems = entries.flatMap(([path, text]) => [
    ...findForbiddenLines(text).map((h) => `금지 ref  ${path}:${h.line} (${h.ref}) — 본문은 가림`),
    ...findSecretLikeLines(text).map((h) => `자격증명? ${path}:${h.line} (${h.pattern}) — 값은 가림`),
  ])
  if (problems.length) return { problems, emails: [] }
  return { problems, emails: entries.flatMap(([path, text]) => findEmails(text).map((h) => `${path}:${h.line}  ${h.masked}`)) }
}

export function postprocessDump(dump, extensions) {
  const lines = dump.split('\n')
  const hits = findForbiddenLines(dump)
  if (hits.length) {
    throw new Error(`금지 ref ${hits.length}건(덤프 ${hits.map((h) => h.line).join(', ')}행) — 기준선에 원본 좌표를 들일 수 없다` +
      ` (행 본문은 싣지 않는다 — 원본 dump.sql 의 해당 행을 직접 본다):\n` + hits.map((h) => `  덤프 ${h.line}행(${h.ref})`).join('\n'))
  }
  const droppedGrants = []
  const kept = lines.filter((line) => {
    if (/^\\(un)?restrict\b/.test(line)) return false
    if (/^CREATE SCHEMA public;/.test(line) || /^COMMENT ON SCHEMA public\b/.test(line)) return false

    // Handle GRANT/REVOKE
    const grantMatch = line.match(GRANT_RE)
    if (grantMatch) {
      const roleList = extractRoles(grantMatch[3])
      if (roleList.some((r) => !STANDARD_ROLES.includes(r))) { droppedGrants.push(line); return false }
      return true
    }

    // Handle ALTER DEFAULT PRIVILEGES
    const alterMatch = line.match(ALTER_DEFAULT_RE)
    if (alterMatch) {
      const forRoleStr = alterMatch[1]
      const toFromList = extractRoles(alterMatch[4])
      // Normalize FOR ROLE: strip quotes, split by commas if any
      const forRoles = forRoleStr
        ? forRoleStr.split(',').map((r) => r.trim().replace(/^"|"$/g, ''))
        : []
      const rolesToCheck = [...toFromList, ...forRoles].filter(Boolean)
      if (rolesToCheck.some((r) => !STANDARD_ROLES.includes(r))) { droppedGrants.push(line); return false }
      if (forRoles.some((r) => DEFAULT_ACL_NOT_OURS.includes(r))) { droppedGrants.push(line); return false }
      return true
    }

    return true
  })
  return { sql: [...extensions.map(extensionHeadLine), '', ...PLATFORM_DEFAULT_ACL_RESET, '', ...kept.map(quoteAtomicIdents)].join('\n'), droppedGrants }
}

const extensionHeadLine = (e) => `create extension if not exists "${e.name}" with schema ${e.schema};`
const EXTENSION_HEAD = /^create extension if not exists "([^"]+)" with schema ([a-z_][a-z0-9_]*);$/

// pg_dump 는 객체 ACL 을 acldefault() 와의 차이(GRANT/REVOKE)로만 적고, 기본 권한(ALTER DEFAULT PRIVILEGES)은 파일 맨 끝에 둔다
// — 객체가 내장 기본값으로 만들어진다고 가정한다. Supabase 는 초기화 때 이미 FOR ROLE postgres IN SCHEMA public 으로 anon·
// authenticated·service_role 에 테이블·시퀀스·함수 ALL 을 걸어 두어(로컬 pg_default_acl, storage 스키마에도 같은 항목 — 이미지
// 초기화의 흔적), 그대로 재생하면 운영이 걷어 낸 권한이 되살아난다(anon 이 SECURITY DEFINER 삭제 RPC 를 부르는 등 88개 객체).
// 본문 앞에서 이 항목을 걷어 객체가 acldefault 에서 출발하게 하고, 덤프 끝의 FOR ROLE postgres … GRANT 줄이 플랫폼 기본값을
// 되살린다. postgres 가 public 에 만드는 객체에 걸리는 기본 권한은 이 세 줄이 전부다(로컬 확인: 전역·PUBLIC 대상 항목 없음).
// 확장 생성 뒤에 둔다 — 확장 객체는 운영에서도 플랫폼 기본값 아래 만들어졌다.
const PLATFORM_DEFAULT_ACL_RESET = Object.freeze(['tables', 'sequences', 'functions'].map((kind) =>
  `alter default privileges for role postgres in schema public revoke all on ${kind} from anon, authenticated, service_role;`))

// Supabase CLI(2.75) 의 마이그레이션 분할기는 BEGIN ATOMIC 본문을 "ATOMIC 으로 끝나는 단어"만 보고 알아챈다
// (pkg/parser/state.go — 앞의 BEGIN 도, 단어 경계도 보지 않는다). 그래서 최상위 문장에 apply_wiki_extracted_item_atomic
// 같은 이름이 나오면 다음 "END" 까지 ; 에서 끊지 않고 여러 문장을 한 prepared statement 로 보내, db reset 이
// "cannot insert multiple commands into a prepared statement"(42601)로 실패한다.
// 따옴표 안은 분할기가 들여다보지 않는다. pg_dump 는 소문자 정규 식별자만 따옴표 없이 쓰므로 "x" 와 x 는 같은 이름이다
// (함수·권한·RPC 이름이 바뀌지 않는다). 분할기가 실제로 훑는 최상위 DDL 줄(0열의 대문자 동사)만 고친다 —
// 달러 인용 본문·주석·문자열 리터럴·이미 따옴표인 식별자는 운영 원문 그대로 둔다. 키워드 ATOMIC 은 대문자라 걸리지 않는다.
const TOP_LEVEL_DDL = /^(CREATE|ALTER|GRANT|REVOKE|COMMENT ON)\b/
const QUOTED_SEGMENT = /('(?:[^']|'')*'|"(?:[^"]|"")*")/
const ATOMIC_IDENT = /(?<![A-Za-z0-9_$"])([a-z_][a-z0-9_$]*atomic)(?![A-Za-z0-9_$"])/g
function quoteAtomicIdents(line) {
  if (!TOP_LEVEL_DDL.test(line)) return line
  return line.split(QUOTED_SEGMENT).map((part, i) => (i % 2 ? part : part.replace(ATOMIC_IDENT, '"$1"'))).join('')
}

const lit = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`)
// 빈 배열은 array[] 로 쓰면 타입을 정하지 못해 실패한다.
const arr = (a) => (a === null ? 'null' : a.length === 0 ? "'{}'::text[]" : `array[${a.map(lit).join(', ')}]`)
const ident = (name) => (/^[a-z_][a-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`)

export function buildStorageRealtimeSql(catalog) {
  // 키가 없는 카탈로그(구 형식)를 "발행 없음"으로 읽지 않는다 — 로컬 realtime 구독이 소리 없이 죽는다.
  if (!Array.isArray(catalog.publication_tables)) throw new Error('카탈로그에 publication_tables 가 없다 — 구 형식 카탈로그')
  const pubs = catalog.publication_tables.map((t) => `${ident(t.schema)}.${ident(t.table)}`)
  const pols = catalog.policies.filter((p) => (p.schema === 'storage' && p.table === 'objects') || (p.schema === 'realtime' && p.table === 'messages'))
  const fwd = ['-- 0001_storage_realtime — 운영 카탈로그에서 생성(scripts/baseline-dump.mjs). pg_dump --schema=public 이 담지 않는 두 스키마.', '']
  for (const b of catalog.buckets) {
    fwd.push(`insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (${lit(b.id)}, ${lit(b.name)}, ${b.public}, ${lit(b.file_size_limit)}, ${arr(b.allowed_mime_types)}) on conflict (id) do nothing;`)
  }
  fwd.push('', 'alter table realtime.messages enable row level security;', '')
  for (const p of pols) {
    let s = `create policy "${p.name}" on ${p.schema}.${p.table} as ${p.permissive.toLowerCase()} for ${p.cmd.toLowerCase()} to ${p.roles.join(', ')}`
    if (p.qual !== null) s += ` using (${p.qual})`
    if (p.with_check !== null) s += ` with check (${p.with_check})`
    fwd.push(s + ';')
  }
  // pg_dump --schema=public 은 발행 소속을 담지 않는다(전체 덤프일 때만) — 여기서 되살린다.
  if (pubs.length) fwd.push('', ...pubs.map((t) => `alter publication supabase_realtime add table ${t};`))
  const rb = ['-- 0001_storage_realtime 롤백', '']
  for (const t of pubs) rb.push(`alter publication supabase_realtime drop table ${t};`)
  for (const p of pols) rb.push(`drop policy if exists "${p.name}" on ${p.schema}.${p.table};`)
  // Storage(로컬 v1.35.3)는 storage.buckets 직접 DELETE 를 트리거(storage.protect_delete)로 막고, 이 설정일 때만 통과시킨다.
  // 막는 이유는 파일만 남는 고아 객체인데, 객체 행이 남은 버킷은 storage.objects 의 FK 가 어차피 삭제를 거절한다(로컬에서
  // 확인) — 풀어도 지워지는 것은 빈 버킷뿐이다. 트랜잭션 밖에서도 돌도록 set local 이 아니라 set/reset 으로 감싼다.
  if (catalog.buckets.length) {
    rb.push("set storage.allow_delete_query = 'true';",
      `delete from storage.buckets where id in (${catalog.buckets.map((b) => lit(b.id)).join(', ')});`,
      'reset storage.allow_delete_query;')
  }
  return { forward: fwd.join('\n') + '\n', rollback: rb.join('\n') + '\n' }
}

const keyOf = {
  policies: (p) => `${p.schema}.${p.table}.${p.name}`,
  functions: (f) => `${f.name}(${f.args})`,
  triggers: (t) => `${t.table}.${t.name}`,
  buckets: (b) => b.id,
}

/**
 * @returns {{
 *   counts: Record<'policies'|'functions'|'triggers'|'buckets'|'rls_tables'|'publication_tables', { expected: number, actual: number }>,
 *   problems: string[],
 * }}
 */
export function diffCatalog(expected, actual) {
  const problems = []
  const counts = {}
  for (const kind of ['policies', 'functions', 'triggers', 'buckets']) {
    const e = new Map(expected[kind].map((x) => [keyOf[kind](x), x]))
    const a = new Map(actual[kind].map((x) => [keyOf[kind](x), x]))
    counts[kind] = { expected: e.size, actual: a.size }
    for (const [k, v] of e) {
      if (!a.has(k)) problems.push(`${kind} 누락: ${k}`)
      else if (JSON.stringify(v) !== JSON.stringify(a.get(k))) problems.push(`${kind} 다름: ${k}`)
    }
    for (const k of a.keys()) if (!e.has(k)) problems.push(`${kind} 초과: ${k}`)
  }
  const ea = new Set(actual.rls_tables)
  counts.rls_tables = { expected: expected.rls_tables.length, actual: actual.rls_tables.length }
  for (const t of expected.rls_tables) if (!ea.has(t)) problems.push(`RLS 꺼짐: ${t}`)
  for (const t of actual.rls_tables) if (!expected.rls_tables.includes(t)) problems.push(`RLS 초과: ${t}`)
  const pubKey = (t) => `${t.schema}.${t.table}`
  const ep = new Set(expected.publication_tables.map(pubKey))
  const ap = new Set(actual.publication_tables.map(pubKey))
  counts.publication_tables = { expected: ep.size, actual: ap.size }
  for (const t of ep) if (!ap.has(t)) problems.push(`publication_tables 누락: ${t}`)
  for (const t of ap) if (!ep.has(t)) problems.push(`publication_tables 초과: ${t}`)
  // 확장은 여기서 보지 않는다 — 운영의 관리형 확장(pg_stat_statements 등)은 기준선이 만들지 않는다. diffExtensions 몫.
  return { counts, problems }
}

// ── 왕복 검사: 로컬 재생을 같은 인자(DUMP_ARGS)로 pg_dump 해 운영 원본 dump.sql 과 맞댄다 ─────────────
// diffCatalog 는 정책·함수·트리거 이름만 본다 — 권한(ACL)·컬럼·본문 차이는 이 비교가 잡는다.
const DUMP_OBJECT_HEAD = /^-- Name: (.*); Owner: .*$/
const ATOMIC_QUOTED = /"([a-z_][a-z0-9_$]*atomic)"/g

/**
 * pg_dump 출력을 객체 머리(`-- Name: …; Type: …; Schema: …`, Owner 제외)별 줄 목록(Map)으로 정규화한다.
 * 지우는 것: \restrict/\unrestrict(실행마다 다른 토큰), 주석·빈 줄(머리의 pg_dump 버전 등), 세션 SET·search_path.
 * 되돌리는 것: quoteAtomicIdents 가 붙인 따옴표 — 0000_baseline.sql 을 덤프와 맞대도 같게 본다.
 * 첫 머리 앞의 줄은 '(머리)' 로 묶는다(0000 의 create extension·기본 권한 초기화).
 */
export function normalizeDumpForCompare(text) {
  const blocks = new Map()
  let key = '(머리)'
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const head = raw.match(DUMP_OBJECT_HEAD)
    if (head) { key = head[1]; continue }
    if (raw.trim() === '' || raw.startsWith('--') || /^\\(un)?restrict\b/.test(raw)) continue
    if (/^SET [a-z_]+ = .*;$/.test(raw) || /^SELECT pg_catalog\.set_config\('search_path'/.test(raw)) continue
    if (!blocks.has(key)) blocks.set(key, [])
    blocks.get(key).push(raw.replace(ATOMIC_QUOTED, '$1'))
  }
  return blocks
}

const minus = (a, b) => {
  const left = new Map()
  for (const l of b) left.set(l, (left.get(l) ?? 0) + 1)
  return a.filter((l) => (left.get(l) ?? 0) > 0 ? (left.set(l, left.get(l) - 1), false) : true)
}

// 줄 순서까지 보는 차이: 공통 앞뒤를 걷고 가운데만 LCS 로 맞춘다. 자리를 바꾼 줄은 양쪽 목록에 모두 나온다.
function orderedDiff(a, b) {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const x = a.slice(head, a.length - tail)
  const y = b.slice(head, b.length - tail)
  const lcs = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  }
  const onlyA = []
  const onlyB = []
  let i = 0
  let j = 0
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { i++; j++ } else if (lcs[i + 1][j] >= lcs[i][j + 1]) onlyA.push(x[i++])
    else onlyB.push(y[j++])
  }
  return { onlyA: [...onlyA, ...x.slice(i)], onlyB: [...onlyB, ...y.slice(j)] }
}

// 권한 블록(ACL·DEFAULT ACL)은 aclitem 순서가 GRANT 순서·재생 경로에 따라 흔들리고, 두 소유자의 DEFAULT ACL 은 같은 머리로
// 합쳐진다. 머리 블록은 두 파일에서 성격이 다른 줄 묶음이다. 이 둘만 줄 다중집합으로 보고, 나머지는 순서까지 본다.
const UNORDERED_BLOCK = /; Type: (?:DEFAULT )?ACL; Schema: /
const isUnordered = (key) => key === '(머리)' || UNORDERED_BLOCK.test(key)

/**
 * 두 덤프의 객체별 차이 — [{ key, onlyA, onlyB }] (key 순). 객체 순서는 보지 않는다(pg_dump 버전·OID 에 따라 흔들린다).
 * 한 객체 안은 권한 블록·머리면 줄 다중집합(같은 GRANT 가 두 번이면 한 번 남는다), 그 밖(함수 본문·정책·테이블)이면
 * 줄 순서까지 비교한다 — 줄 순서가 바뀐 본문은 다른 본문이다. 차이가 없으면 [].
 */
export function diffDumps(a, b) {
  const A = normalizeDumpForCompare(a)
  const B = normalizeDumpForCompare(b)
  const out = []
  for (const key of [...new Set([...A.keys(), ...B.keys()])].sort()) {
    const la = A.get(key) ?? []
    const lb = B.get(key) ?? []
    const { onlyA, onlyB } = isUnordered(key) ? { onlyA: minus(la, lb), onlyB: minus(lb, la) } : orderedDiff(la, lb)
    if (onlyA.length || onlyB.length) out.push({ key, onlyA, onlyB })
  }
  return out
}

// ── 기준선 대조(scripts/baseline-diff.mjs): 운영에 접속하지 않고 커밋된 파일 + 로컬 재생본만 본다(CI 에서도 돈다) ───────

// 이 게이트가 대조하는 것은 기준선뿐이다 — 그 뒤 마이그레이션이 적용된 DB 는 운영 카탈로그·0000 과 다를 수밖에 없다.
export const BASELINE_VERSIONS = Object.freeze(['0000', '0001'])

// 대조 전에 한 번: 서버 버전(출력 머리)과 적용된 마이그레이션 버전.
export const LOCAL_PREFLIGHT_SQL = `select json_build_object('server', version(),
  'migrations', (select coalesce(json_agg(version order by version), '[]') from supabase_migrations.schema_migrations))::text`

/** 적용된 마이그레이션이 정확히 기준선(0000·0001)이 아니면 멈출 이유 한 줄, 맞으면 null. */
export function baselineMigrationProblem(versions) {
  const extra = versions.filter((v) => !BASELINE_VERSIONS.includes(v))
  const missing = BASELINE_VERSIONS.filter((v) => !versions.includes(v))
  const last = BASELINE_VERSIONS.at(-1)
  if (extra.length) {
    return `기준선 이후 마이그레이션이 적용돼 있다(${extra.join(', ')}) — 이 게이트는 기준선(${BASELINE_VERSIONS.join('·')})만 대조한다. ` +
      `supabase db reset --version ${last} 로 기준선까지만 재생한 뒤 다시 실행한다`
  }
  if (missing.length) return `기준선 마이그레이션이 적용되지 않았다(없음: ${missing.join(', ')}) — npm run db:reset 뒤 다시 실행한다`
  return null
}

/** 0000 머리(첫 객체 머리 앞)의 create extension 줄 — 기준선이 스스로 만드는 확장. 객체 블록 안의 같은 줄은 선언이 아니다. */
export function baselineExtensions(sql) {
  return (normalizeDumpForCompare(sql).get('(머리)') ?? []).flatMap((line) => {
    const m = line.match(EXTENSION_HEAD)
    return m ? [{ name: m[1], schema: m[2] }] : []
  })
}

// 이미지 초기화가 public 의 기본 권한을 거는 대상 롤.
const PLATFORM_GRANTEES = Object.freeze(['postgres', 'anon', 'authenticated', 'service_role'])

/**
 * 커밋된 0000 과 로컬 재생본 pg_dump 의 차이 가운데 postprocessDump 가 만든 것 — 이것만, 줄 단위로 정확히 허용한다.
 * side 는 diffDumps(0000, 로컬 덤프) 기준이다(baseline = onlyA, local = onlyB). 따옴표 규칙(…atomic)·머리 주석·\restrict·
 * pg_dump 버전은 normalizeDumpForCompare 가 이미 지운다 — 어느 것도 GRANT/REVOKE 의 롤·권한을 바꾸지 않는다.
 */
export function roundTripResidue(extensions) {
  return [
    { side: 'baseline', key: '(머리)', lines: [...extensions.map(extensionHeadLine), ...PLATFORM_DEFAULT_ACL_RESET],
      why: 'postprocessDump 가 본문 앞에 둔 확장 생성·기본 권한 초기화 — pg_dump --schema=public 은 확장을 싣지 않고, 초기화는 재생 중에만 효력이 있다' },
    { side: 'local', key: 'public; Type: SCHEMA; Schema: -', lines: ['CREATE SCHEMA public;'],
      why: 'postprocessDump 가 지운 줄 — Supabase 에는 public 이 이미 있다' },
    ...['FUNCTIONS', 'SEQUENCES', 'TABLES'].map((kind) => ({
      side: 'local', key: `DEFAULT PRIVILEGES FOR ${kind}; Type: DEFAULT ACL; Schema: public`,
      lines: DEFAULT_ACL_NOT_OURS.flatMap((owner) => PLATFORM_GRANTEES.map((role) =>
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT ALL ON ${kind} TO ${role};`)),
      why: 'postprocessDump 가 지운 FOR ROLE supabase_admin 기본 권한 — 지운 근거가 "이미지 초기화가 같은 값을 건다"이므로 로컬에 있어야 한다',
    })),
  ]
}

/**
 * diffDumps(a, b) 결과에서 허용 잔차를 줄 다중집합으로 빼고 남는 것을 문제 문자열로 돌려준다. 허용 잔차가 덤프에 없어도
 * 문제다 — 그 줄을 더하거나 지운 근거(가공 규칙·이미지 초기화)가 바뀌었다는 뜻이다. names 는 a·b 의 이름표.
 */
export function checkRoundTrip(diffs, residue = [], names = ['기준선', '로컬']) {
  const label = { baseline: names[0], local: names[1] }
  const slots = new Map()
  const slot = (side, key) => {
    const id = `${side} ${key}`
    if (!slots.has(id)) slots.set(id, { side, key, got: [], allowed: [], why: '' })
    return slots.get(id)
  }
  for (const d of diffs) { slot('baseline', d.key).got.push(...d.onlyA); slot('local', d.key).got.push(...d.onlyB) }
  for (const r of residue) Object.assign(slot(r.side, r.key), { why: r.why }).allowed.push(...r.lines)
  const problems = []
  for (const { side, key, got, allowed, why } of slots.values()) {
    for (const l of minus(got, allowed)) problems.push(`덤프 [${key}] ${label[side]}만: ${l}`)
    for (const l of minus(allowed, got)) problems.push(`덤프 [${key}] 허용 잔차 없음(${label[side]}만이어야): ${l} — ${why}`)
  }
  return problems
}

// 기준선(public 의 비확장 객체)이 pg_depend 로 기대는 확장 — 컬럼 타입·기본값·인덱스 연산자 클래스·함수 시그니처 등.
// pg_identify_object_as_address 의 첫 이름이 객체(기본값·정책·트리거는 그 테이블)의 스키마다. 확장 소속 객체와
// 연산자족 멤버(첫 이름이 접근 방법)는 확장 내부라 빠진다. plpgsql·sql 함수 본문 안의 참조는 pg_depend 에 남지 않는다.
export const EXTENSION_DEPS_SQL = `select coalesce(jsonb_agg(distinct jsonb_build_object('name', e.extname, 'schema', n.nspname)), '[]')::text
  from pg_depend d
  join pg_depend m on m.classid = d.refclassid and m.objid = d.refobjid and m.deptype = 'e'
  join pg_extension e on e.oid = m.refobjid
  join pg_namespace n on n.oid = e.extnamespace
  cross join lateral pg_identify_object_as_address(d.classid, d.objid, d.objsubid) a
  where d.deptype in ('n', 'a') and e.extname <> 'plpgsql' and a.object_names[1] = 'public'
    and not exists (select 1 from pg_depend x where x.classid = d.classid and x.objid = d.objid and x.deptype = 'e')`

/**
 * 확장 규칙 — 기준선이 만드는 확장(declared: 0000 머리)과 기준선 객체가 기대는 확장(depends: EXTENSION_DEPS_SQL)만
 * 운영(expected)·로컬(actual)과 이름·스키마를 맞댄다. 운영에만 있는 관리형 확장(pg_stat_statements·supabase_vault)은
 * 기준선이 만들지도 쓰지도 않으면 보지 않고 skipped 로 알린다. 로컬에만 있는 이미지 기본 확장도 보지 않는다.
 */
export function diffExtensions({ declared, depends, expected, actual }) {
  const problems = []
  const required = new Map()
  for (const x of [...declared, ...depends]) {
    const had = required.get(x.name)
    if (had !== undefined && had !== x.schema) problems.push(`확장 스키마 모순: ${x.name} (${had} · ${x.schema})`)
    else required.set(x.name, x.schema)
  }
  const prod = new Map(expected.map((x) => [x.name, x.schema]))
  const local = new Map(actual.map((x) => [x.name, x.schema]))
  for (const [name, schema] of required) {
    if (!prod.has(name)) problems.push(`확장 운영에 없음: ${name}@${schema}`)
    else if (prod.get(name) !== schema) problems.push(`확장 스키마 다름: ${name} 운영 ${prod.get(name)} · 기준선 ${schema}`)
    if (!local.has(name)) problems.push(`확장 누락: ${name}@${schema}`)
    else if (local.get(name) !== schema) problems.push(`확장 스키마 다름: ${name} 로컬 ${local.get(name)} · 기준선 ${schema}`)
  }
  return {
    compared: [...required].map(([name, schema]) => `${name}@${schema}`),
    skipped: expected.filter((x) => !required.has(x.name)).map((x) => x.name),
    problems,
  }
}

// 표 칸의 SQL 식: 여러 줄 식은 한 줄로(줄바꿈이 표 행을 끊는다), | 는 \|(GFM 표는 코드 스팬 안의 | 로도 칸을 나눈다),
// 백틱이 든 식은 그보다 긴 백틱 울타리로. 식이 없으면(null) —.
function sqlCell(text) {
  if (text === null || text === undefined) return '—'
  const one = String(text).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
  const fence = '`'.repeat(Math.max(0, ...(one.match(/`+/g) ?? []).map((run) => run.length)) + 1)
  const pad = one.startsWith('`') || one.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${one}${pad}${fence}`
}

/** docs/baseline/2026-09-23-live-catalog.md — 운영 카탈로그(prod-catalog.json)의 라이브 정책 목록. SP2 스펙의 입력. */
export function renderLiveCatalogSnapshot(catalog) {
  const counts = ['policies', 'functions', 'triggers', 'buckets', 'rls_tables', 'publication_tables']
    .map((k) => `- ${k}: ${catalog[k].length}`)
  const openReads = catalog.policies.filter((p) => p.qual === 'true' && ['SELECT', 'ALL'].includes(p.cmd)).length
  const rows = catalog.policies.map((p) =>
    `| ${p.schema}.${p.table} | ${p.name} | ${p.cmd} | ${p.roles.join(',')} | ${sqlCell(p.qual)} | ${sqlCell(p.with_check)} |`)
  return `# 운영 라이브 카탈로그 스냅샷 (${catalog.capturedAt}, ${catalog.cutoff})\n\n` +
    'SP2 스펙의 "라이브 정책 목록" 입력(상위 스펙 6.7). 생성: `node scripts/baseline-diff.mjs --snapshot`.\n' +
    '원문은 `docs/baseline/prod-catalog.json` 이다 — 표에서는 여러 줄 식을 한 줄로 이었다.\n\n' +
    `${counts.join('\n')}\n- \`using (true)\` 읽기 정책: ${openReads}\n\n` +
    `| 테이블 | 정책 | cmd | roles | using | with check |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`
}
