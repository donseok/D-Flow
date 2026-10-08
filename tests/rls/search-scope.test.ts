// 0042 search_scope_required — AI 색인 검색 RPC 둘(match_ai_documents·match_ai_documents_lexical)의 워크스페이스 범위 강제(SP8 §5.4.2).
//  ① p_workspace_id 가 null(또는 빠짐)이면 AI_SEARCH_WORKSPACE_REQUIRED  ② A 로 검색하면 B 의 문서는 0건(프로젝트 문서·전역 문서 모두)
//  ③ p_include_global 참/거짓에 따른 전역 문서 포함/제외  ④ p_project_ids null·빈 배열 + include_global 거짓 → 0행
//  ⑤ 다른 워크스페이스의 프로젝트 id 를 A 의 워크스페이스 id 와 함께 주면 0행  ⑥ 실행 권한은 0036 과 같다  ⑦ 롤백 → 재적용 왕복
// service 경로(postgres — RLS 없음, 앱의 검색이 도는 길)와 두 워크스페이스에 다 속한 세션(RLS 가 둘 다 보여 준다)에서 같은 결과여야 한다 —
// 그래야 격리가 RLS 가 아니라 함수 본문에서 온 것이다. 마이그레이션 파일은 접미로 찾는다(번호는 재배정될 수 있다 — CLAUDE.md "데이터").
import { readFileSync, readdirSync } from 'node:fs'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const raw = (dir: string, suffix: string) => {
  const hits = readdirSync(dir).filter((f) => f.endsWith(suffix))
  if (hits.length !== 1) throw new Error(`${dir}/*${suffix} 가 ${hits.length}개다`)
  return readFileSync(`${dir}/${hits[0]}`, 'utf8')
}
/** 파일의 최상위 begin;/commit; 두 줄만 걷는다(do 블록·함수 본문의 begin 은 세미콜론이 없다) — 바깥 트랜잭션을 커밋하지 않게 */
const inTx = (sql: string) => sql.replace(/^begin;[ \t]*$/m, '').replace(/^commit;[ \t]*$/m, '')
const MIGRATION_RAW = raw('supabase/migrations', '_search_scope_required.sql')
const ROLLBACK_RAW = raw('supabase/rollbacks', '_search_scope_required_rollback.sql')
const migration = inTx(MIGRATION_RAW)
const rollback = inTx(ROLLBACK_RAW)

const DIM = 768
const vec = (...head: number[]) => `[${[...head, ...Array(DIM - head.length).fill(0)].join(',')}]`
const Q = vec(1)
const DOC = {
  // id 순서 = 단언에 적는 순서(ids() 가 id 로 정렬한다)
  aGlobal: '00000000-0000-0000-7e57-00000042a101', aProject: '00000000-0000-0000-7e57-00000042a102',
  bGlobal: '00000000-0000-0000-7e57-00000042b101', bProject: '00000000-0000-0000-7e57-00000042b102',
} as const
const WORD = '범위검색어'

/** 두 워크스페이스에 프로젝트 문서 하나·전역(project_id null) 문서 하나씩. B 쪽 벡터가 질의에 더 가깝다 — 범위가 새면 B 가 먼저 나온다 */
async function seed(c: PoolClient) {
  const role = (await c.query<{ r: string }>('select current_user::text as r')).rows[0].r
  await c.query('reset role')
  await c.query('set local session_replication_role = replica')
  await c.query('delete from public.ai_documents')
  const rows: Array<[string, string, string | null, string, string]> = [
    [DOC.aProject, F.ws, F.projects.a, 'a-project', vec(0.7, 0.3)],
    [DOC.aGlobal, F.ws, null, 'a-global', vec(0.6, 0.4)],
    [DOC.bProject, F.wsB, F.projects.bWs, 'b-project', vec(0.99, 0.01)],
    [DOC.bGlobal, F.wsB, null, 'b-global', vec(0.98, 0.02)],
  ]
  for (const [id, ws, project, entity, embedding] of rows) {
    await c.query(`insert into public.ai_documents (id, workspace_id, project_id, domain, entity_type, entity_id, chunk_no,
        title, content, content_hash, href, embedding_model, chunker_version, embedding)
      values ($1::uuid, $2::uuid, $3::uuid, 'minutes', 'minute', $4, 0, $4, $5, 'hash-' || $4, '/m/' || $4, 'model-1', 'v1', $6::public.vector)`,
    [id, ws, project, entity, `${entity} ${WORD}`, embedding])
  }
  await c.query('set local session_replication_role = origin')
  if (role !== 'postgres') await c.query(`set local role ${role}`)
}

type Scope = { ws: string | null; projects?: string[] | null; global?: boolean }
const KINDS = ['match_ai_documents', 'match_ai_documents_lexical'] as const
type Kind = typeof KINDS[number]

/** 앱처럼 이름 인자로 부른다. global 이 undefined 면 인자를 아예 넘기지 않는다(기본값 확인). */
function statement(kind: Kind, scope: Scope): { sql: string; params: unknown[] } {
  const head = kind === 'match_ai_documents' ? '$1::public.vector' : '$1::text[]'
  const first = kind === 'match_ai_documents' ? Q : [WORD]
  const tail = scope.global === undefined ? '' : ', p_include_global => $4::boolean'
  return {
    sql: `select id::text as id from public.${kind}(${head}, 50, p_workspace_id => $2::uuid, p_project_ids => $3::uuid[]${tail})`,
    params: [first, scope.ws, scope.projects ?? null, ...(scope.global === undefined ? [] : [scope.global])],
  }
}
async function ids(c: PoolClient, kind: Kind, scope: Scope): Promise<string[]> {
  const { sql, params } = statement(kind, scope)
  return (await c.query<{ id: string }>(sql, params)).rows.map((r) => r.id).sort()
}

/** service 경로와 두 워크스페이스 소속 세션(dana) — 두 경로에서 같은 단언을 돌린다 */
const PATHS: Array<[string, <T>(fn: (c: PoolClient) => Promise<T>) => Promise<T>]> = [
  ['service(RLS 없음)', (fn) => asService(pool, fn)],
  ['세션 — A·B 둘 다 소속(dana)', (fn) => asUser(pool, F.users.dual, fn)],
]
const REQUIRED = { code: '22023', message: 'AI_SEARCH_WORKSPACE_REQUIRED' }

for (const kind of KINDS) {
  describe(`0042 ${kind} — 워크스페이스 범위 강제`, () => {
    for (const [label, run] of PATHS) {
      describe(label, () => {
        it('① p_workspace_id 가 null 이거나 빠지면 AI_SEARCH_WORKSPACE_REQUIRED(22023) — 문서를 돌려주지 않는다', async () => {
          await run(async (c) => {
            await seed(c)
            for (const projects of [null, [], [F.projects.a], [F.projects.a, F.projects.bWs]]) {
              for (const global of [undefined, false, true]) {
                const { sql, params } = statement(kind, { ws: null, projects, global })
                expect(await pgError(c, sql, params), JSON.stringify({ projects, global })).toMatchObject(REQUIRED)
              }
            }
            // 인자를 아예 빼도(옛 호출 모양) 같은 오류다
            const head = kind === 'match_ai_documents' ? '$1::public.vector' : '$1::text[]'
            const first = kind === 'match_ai_documents' ? Q : [WORD]
            expect(await pgError(c, `select id from public.${kind}(${head}, 50)`, [first])).toMatchObject(REQUIRED)
            expect(await pgError(c, `select id from public.${kind}(${head}, 50, p_project_ids => $2::uuid[])`, [first, [F.projects.a]])).toMatchObject(REQUIRED)
          })
        })

        it('② A 로 검색하면 B 의 문서는 0건 — 프로젝트 문서도 전역 문서도(반대 방향도 같다)', async () => {
          await run(async (c) => {
            await seed(c)
            const both = [F.projects.a, F.projects.bWs]
            expect(await ids(c, kind, { ws: F.ws, projects: both, global: true })).toEqual([DOC.aGlobal, DOC.aProject])
            expect(await ids(c, kind, { ws: F.wsB, projects: both, global: true })).toEqual([DOC.bGlobal, DOC.bProject])
          })
        })

        it('③ p_include_global — 참이면 그 워크스페이스의 전역 문서를 더하고, 거짓·생략이면 뺀다', async () => {
          await run(async (c) => {
            await seed(c)
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.a], global: true })).toEqual([DOC.aGlobal, DOC.aProject])
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.a], global: false })).toEqual([DOC.aProject])
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.a] })).toEqual([DOC.aProject])
            // 프로젝트 없이 전역만 — 그 워크스페이스의 전역 문서 하나
            expect(await ids(c, kind, { ws: F.ws, projects: [], global: true })).toEqual([DOC.aGlobal])
            expect(await ids(c, kind, { ws: F.ws, projects: null, global: true })).toEqual([DOC.aGlobal])
            expect(await ids(c, kind, { ws: F.wsB, projects: null, global: true })).toEqual([DOC.bGlobal])
          })
        })

        it('④ p_project_ids 가 null·빈 배열이고 include_global 이 거짓·생략이면 0행 — 전 프로젝트로 넓히지 않는다', async () => {
          await run(async (c) => {
            await seed(c)
            for (const projects of [null, []]) {
              for (const global of [undefined, false]) {
                expect(await ids(c, kind, { ws: F.ws, projects, global }), JSON.stringify({ projects, global })).toEqual([])
              }
            }
            // 대조 — 같은 워크스페이스에 프로젝트를 주면 나온다(위 0행이 시드 누락이 아니다)
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.a] })).toEqual([DOC.aProject])
          })
        })

        it('⑤ 다른 워크스페이스의 프로젝트 id 를 A 의 워크스페이스 id 와 함께 주면 0행 — 전역을 켜도 A 의 전역뿐이다', async () => {
          await run(async (c) => {
            await seed(c)
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.bWs] })).toEqual([])
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.bWs], global: false })).toEqual([])
            expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.bWs], global: true })).toEqual([DOC.aGlobal])
            expect(await ids(c, kind, { ws: F.wsB, projects: [F.projects.a], global: false })).toEqual([])
          })
        })
      })
    }

    it('세션 RLS 는 그대로 먼저 적용된다 — A 에만 속한 계정이 B 의 워크스페이스·프로젝트를 넘겨도 0행', async () => {
      await asUser(pool, F.users.aLoose, async (c) => {
        await seed(c)
        expect(await ids(c, kind, { ws: F.wsB, projects: [F.projects.bWs], global: true })).toEqual([])
        expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.a], global: true })).toEqual([DOC.aGlobal, DOC.aProject])
      })
    })
  })
}

const SIG = {
  match_ai_documents: 'public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer, boolean)',
  match_ai_documents_lexical: 'public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer, boolean)',
} as const
const OLD_SIG = {
  match_ai_documents: 'public.match_ai_documents(public.vector, integer, uuid, uuid[], text[], text[], text, date, date, integer)',
  match_ai_documents_lexical: 'public.match_ai_documents_lexical(text[], integer, uuid, uuid[], text[], text[], integer)',
} as const

/** 그 이름의 public 함수 전부 — 인자·실행 권한(롤별)·definer·언어 */
async function catalog(c: PoolClient | Pool, kind: Kind) {
  return (await c.query<{ args: string; anon: boolean; authenticated: boolean; service: boolean; pub: boolean; definer: boolean; lang: string; volatile: string }>(
    `select pg_get_function_identity_arguments(p.oid) as args,
            has_function_privilege('anon', p.oid, 'execute') as anon,
            has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
            has_function_privilege('service_role', p.oid, 'execute') as service,
            exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub,
            p.prosecdef as definer, l.lanname as lang, p.provolatile::text as volatile
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
      where n.nspname = 'public' and p.proname = $1 order by 1`, [kind])).rows
}
const GRANTS = { anon: false, authenticated: true, service: true, pub: false, definer: false, volatile: 's' }

describe('0042 ⑥ 실행 권한 — 0036 과 같다(authenticated·service_role, anon·public 없음)', () => {
  for (const kind of KINDS) {
    it(`${kind}: 정의는 하나뿐이고 새 시그니처다`, async () => {
      const rows = await catalog(pool, kind)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ ...GRANTS, lang: 'plpgsql' })
      expect(rows[0].args).toMatch(/p_workspace_id uuid/)
      expect(rows[0].args).toMatch(/p_include_global boolean$/)
      expect((await pool.query<{ t: string | null }>('select to_regprocedure($1)::text as t', [SIG[kind]])).rows[0].t).not.toBeNull()
      expect((await pool.query<{ t: string | null }>('select to_regprocedure($1)::text as t', [OLD_SIG[kind]])).rows[0].t).toBeNull()
    })
    it(`${kind}: anon 은 실행하지 못한다(42501), authenticated 는 실행한다`, async () => {
      await asService(pool, async (c) => {
        await seed(c)
        const { sql, params } = statement(kind, { ws: F.ws, projects: [F.projects.a], global: true })
        await c.query('set local role anon')
        expect(await pgError(c, sql, params)).toMatchObject({ code: '42501' })
        await c.query('reset role')
        await c.query('set local role authenticated')
        expect(await pgError(c, sql, params)).toBeNull()
      })
    })
  }
})

describe('0042 ⑦ 롤백 → 재적용 왕복', () => {
  it('두 파일은 최상위 begin;/commit; 을 한 번씩 가진다 — 걷어 낸 본문에는 commit 이 없다(테스트가 바깥 트랜잭션을 커밋하지 않는다)', () => {
    for (const [name, sql, body] of [['migration', MIGRATION_RAW, migration], ['rollback', ROLLBACK_RAW, rollback]] as const) {
      expect(sql.match(/^begin;[ \t]*$/gm), name).toHaveLength(1)
      expect(sql.match(/^commit;[ \t]*$/gm), name).toHaveLength(1)
      expect(body, name).not.toMatch(/^\s*(commit|begin)\s*;/im)
      expect(body.length, name).toBeGreaterThan(500)
    }
    expect(MIGRATION_RAW.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')).not.toMatch(/\bcascade\b/i)
  })

  it('롤백은 0036 시점 정의로 되돌린다 — 옛 시그니처·같은 권한, 워크스페이스 없이도 돈다(범위 강제가 풀린다)', async () => {
    await asService(pool, async (c) => {
      await seed(c)
      await c.query(rollback)
      for (const kind of KINDS) {
        const rows = await catalog(c, kind)
        expect(rows, kind).toHaveLength(1)
        expect(rows[0], kind).toMatchObject({ ...GRANTS, lang: 'sql' })
        expect(rows[0].args, kind).not.toMatch(/p_include_global/)
        expect((await c.query<{ t: string | null }>('select to_regprocedure($1)::text as t', [OLD_SIG[kind]])).rows[0].t, kind).not.toBeNull()
        expect((await c.query<{ t: string | null }>('select to_regprocedure($1)::text as t', [SIG[kind]])).rows[0].t, kind).toBeNull()
        // 0036 의 동작 — null 워크스페이스·null 프로젝트는 필터 없음(네 문서 전부)
        const head = kind === 'match_ai_documents' ? '$1::public.vector' : '$1::text[]'
        const first = kind === 'match_ai_documents' ? Q : [WORD]
        const all = (await c.query<{ id: string }>(`select id::text as id from public.${kind}(${head}, 50)`, [first])).rows.map((r) => r.id).sort()
        expect(all, kind).toEqual([DOC.aGlobal, DOC.aProject, DOC.bGlobal, DOC.bProject])
        // 새 인자는 없다
        expect(await pgError(c, `select id from public.${kind}(${head}, 50, p_include_global => true)`, [first]), kind).toMatchObject({ code: '42883' })
      }
    })
  })

  it('롤백 → 재적용이면 처음 적용한 상태와 같다 — 시그니처·권한·범위 강제', async () => {
    const before = Object.fromEntries(await Promise.all(KINDS.map(async (kind) => [kind, await catalog(pool, kind)] as const)))
    await asService(pool, async (c) => {
      await seed(c)
      await c.query(rollback)
      await c.query(migration)
      for (const kind of KINDS) {
        expect(await catalog(c, kind), kind).toEqual(before[kind])
        const { sql, params } = statement(kind, { ws: null, projects: [F.projects.a], global: true })
        expect(await pgError(c, sql, params), kind).toMatchObject(REQUIRED)
        expect(await ids(c, kind, { ws: F.ws, projects: [F.projects.a, F.projects.bWs], global: true }), kind).toEqual([DOC.aGlobal, DOC.aProject])
        expect(await ids(c, kind, { ws: F.ws, projects: null }), kind).toEqual([])
      }
      // 두 번 왕복해도 같다(롤백이 재적용 가능한 상태를 남긴다)
      await c.query(rollback)
      await c.query(migration)
      for (const kind of KINDS) expect(await catalog(c, kind), kind).toEqual(before[kind])
    })
  })

  it('마이그레이션을 그대로 한 번 더 돌리면 멈춘다 — 옛 시그니처가 없어 drop 이 실패한다(조용히 덮지 않는다)', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, migration)).toMatchObject({ code: '42883' })
    })
  })
})
