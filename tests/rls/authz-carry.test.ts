// NNNN_authz_carry(스펙 §3.4·§3.5) — 레인 A 이월 셋: ① people.email 열 권한, ② CR-1 비활성 전환의 권한 이력(명단 행 {access_role, active}·
// 인물 {person_active}), ②′ 명단 행 person_id 불변, ③ CR-6 apply_project_settings 의 명시 키 거부. 케이스는 begin…rollback 이고, 이력은
// 시작할 때의 마지막 id(mark) 뒤에 생긴 project_access 행만 본다 — 픽스처 A 행(7057001)은 overriding system value 로 넣어 시퀀스보다 크다
// (authz-events.test.ts 와 같은 규칙). 부트스트랩 계정·표 전체 행 수에 기대지 않는다.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const ID = (nn: string) => `00000000-0000-0000-7e57-0000000018${nn}`
const COLUMN_DENIED = { code: '42501', message: expect.stringMatching(/^permission denied for table people/) }
const P_RPC = 'select public.apply_project_settings($1, $2, $3, $4::jsonb, $5::text[], $6, 1, $7) as r'
type Ev = { cause: string; workspace_id: string; project_id: string; target_user_id: string | null; target_person_id: string
  before: unknown; after: unknown; actor_user_id: string | null; command_id: string | null }
const mark = async (c: PoolClient) =>
  (await c.query<{ m: string }>('select coalesce(max(id), 0)::text as m from public.authz_events where id <> 7057001')).rows[0].m
/** mark 뒤에 생긴 project_access 기록(생긴 순) */
const since = async (c: PoolClient, m: string) =>
  (await c.query<Ev>(`select cause, workspace_id, project_id, target_user_id, target_person_id, before, after, actor_user_id, command_id::text
     from public.authz_events where id > $1::bigint and id <> 7057001 and kind = 'project_access' order by id`, [m])).rows
/** 권한 RPC 가 하는 것처럼 서버 경로의 행위자·명령 id 를 트랜잭션 설정으로 켠다 */
const commandSettings = (c: PoolClient, cmd: string) =>
  c.query(`select set_config('app.authz_actor', $1, true), set_config('app.command_id', $2, true), set_config('app.command_digest', 'd', true)`,
    [F.users.platform, cmd])
/** alice(인물 …b3)의 권한 있는 명단 행 셋 — A(admin)·B(member)·A 비공개(member), project_id 순 */
const ALICE_PROJECTS = [F.projects.a, F.projects.b, F.projects.aPrivate]

describe('① people.email — 세션은 쓰지 못한다(다른 열은 그대로)', () => {
  it('워크스페이스 관리자 세션도 email 을 넣거나 고치지 못하고(42501 열 권한), email 없는 insert·display_name update 는 통과한다', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      expect(await pgError(c, `insert into public.people (workspace_id, display_name, email) values ($1, 'RLS 이월', 'rls-sp4-carry@example.com')`,
        [F.ws])).toMatchObject(COLUMN_DENIED)
      expect(await pgError(c, `update public.people set email = 'rls-sp4-carry@example.com' where id = $1`, [F.people.external]))
        .toMatchObject(COLUMN_DENIED)
      expect((await c.query(`insert into public.people (workspace_id, display_name) values ($1, 'RLS 이월') returning id`, [F.ws])).rowCount)
        .toBe(1)
      expect((await c.query(`update public.people set display_name = 'bob carry' where id = $1`, [F.people.external])).rowCount).toBe(1)
    })
  })
})

describe('② CR-1 — 비활성 전환도 권한 이력에 남는다', () => {
  it('권한 있는 명단 행의 active 전환 — 전·후 {access_role, active}, 권한과 함께 바뀌면 한 행에 둘 다. 권한 없는 행·같은 값은 0행', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      await c.query('update public.project_members set active = false where id = $1', [F.members.aliceA])
      await c.query('update public.project_members set active = true where id = $1', [F.members.aliceA])
      await c.query(`update public.project_members set access_role = 'member', active = false where id = $1`, [F.members.aliceA])
      await c.query('update public.project_members set active = false where id = $1', [F.members.bobA])   // access_role null — 기록 없음
      await c.query('update public.project_members set active = active where id = $1', [F.members.danaA])  // 같은 값 — 기록 없음
      const row = (b: object, a: object) => ['direct', F.ws, F.projects.a, F.users.member, F.people.member, b, a]
      expect((await since(c, m)).map((e) => [e.cause, e.workspace_id, e.project_id, e.target_user_id, e.target_person_id, e.before, e.after]))
        .toEqual([
          row({ access_role: 'admin', active: true }, { access_role: 'admin', active: false }),
          row({ access_role: 'admin', active: false }, { access_role: 'admin', active: true }),
          row({ access_role: 'admin', active: true }, { access_role: 'member', active: false }),
        ])
    })
  })

  it('인물의 active 전환 — 그 인물의 권한 있는 명단 행마다 1행({person_active}), 서버 경로의 명령 설정이 켜져 있어도 명령 id 는 비운다', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      await commandSettings(c, ID('80'))
      await c.query('update public.people set active = false where id = $1', [F.people.member])
      await c.query('update public.people set active = true where id = $1', [F.people.member])
      await c.query('update public.people set active = false where id = $1', [F.people.external])   // 권한 있는 명단 행이 없다 — 기록 없음
      const of = (b: boolean, a: boolean) => ALICE_PROJECTS.map((p) =>
        ['direct', p, F.users.member, F.people.member, { person_active: b }, { person_active: a }, F.users.platform, null])
      expect((await since(c, m)).map((e) => [e.cause, e.project_id, e.target_user_id, e.target_person_id, e.before, e.after, e.actor_user_id,
        e.command_id])).toEqual([...of(true, false), ...of(false, true)])
    })
  })

  it('한 명령이 인물과 같은 프로젝트의 명단 행을 함께 바꿔도 명령 원장 유일 인덱스(authz_events_command_uq)에 걸리지 않는다', async () => {
    await asService(pool, async (c) => {
      const m = await mark(c)
      await commandSettings(c, ID('81'))
      await c.query('update public.project_members set active = false where id = $1', [F.members.aliceA])
      expect(await pgError(c, 'update public.people set active = false where id = $1', [F.people.member])).toBeNull()
      expect((await since(c, m)).map((e) => [e.project_id, e.before, e.command_id])).toEqual([
        [F.projects.a, { access_role: 'admin', active: true }, ID('81')],
        ...ALICE_PROJECTS.map((p) => [p, { person_active: true }, null]),
      ])
    })
  })
})

describe('②′ 명단 행의 person_id 는 바꿀 수 없다', () => {
  it('service_role 의 person_id update 는 23514 PROJECT_MEMBER_PERSON_IMMUTABLE — 같은 값으로의 update 는 통과', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, 'update public.project_members set person_id = $1 where id = $2', [F.people.aLoose, F.members.danaA]))
        .toMatchObject({ code: '23514', message: 'PROJECT_MEMBER_PERSON_IMMUTABLE' })
      expect(await pgError(c, 'update public.project_members set person_id = person_id where id = $1', [F.members.danaA])).toBeNull()
    })
  })
})

describe('③ CR-6 — apply_project_settings 는 명시 키의 unset 과 JSON null 을 거부한다(입력 확인 — 잠금·CAS 앞)', () => {
  it('core.level_labels·modules.enabled 의 unset·p_set null 은 CONFIG_INVALID:<키>(낡은 revision 이어도 같은 답), 다른 키의 unset 은 통과', async () => {
    await asService(pool, async (c) => {
      for (const key of ['core.level_labels', 'modules.enabled']) {
        const INVALID = { code: '22023', message: `CONFIG_INVALID:${key}` }
        expect(await pgError(c, P_RPC, [F.projects.a, 0, ID('82'), '{}', [key], F.users.member, 'edit']), `${key} unset`).toMatchObject(INVALID)
        expect(await pgError(c, P_RPC, [F.projects.a, 0, ID('83'), JSON.stringify({ [key]: null }), null, F.users.member, 'edit']), `${key} null`)
          .toMatchObject(INVALID)
      }
      const { rows: [doc] } = await c.query<{ revision: string }>('select revision::text from public.project_settings where project_id = $1',
        [F.projects.a])
      expect((await c.query(P_RPC, [F.projects.a, doc.revision, ID('84'), '{}', ['core.milestone_keywords'], F.users.member, 'edit'])).rows[0].r)
        .toMatchObject({ status: 'applied' })
    })
  })
})

describe('④ 사후검사 — 마이그레이션의 블록을 그대로 돌린다(민감도)', () => {
  // 번호를 쓰지 않는다 — 접미로 찾는다. 블록은 읽기만 하므로 적용 뒤에 다시 돌려도 된다(선례 h2-postchecks.test.ts)
  const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url))
  const files = readdirSync(dir).filter((f) => f.endsWith('_authz_carry.sql'))
  const blocks = () => (readFileSync(dir + files[0], 'utf8').match(/^do \$\$\n[\s\S]*?^end \$\$;$/gm) ?? [])
    .filter((b) => b.includes('AUTHZ_CARRY_POSTCHECK'))
  const POSTCHECK = { message: expect.stringContaining('AUTHZ_CARRY_POSTCHECK') }
  /** 롤백하는 트랜잭션에서 mutate 뒤 블록을 돌려 오류를 돌려준다(통과하면 null) */
  const runAfter = (mutate: string[]) => asService(pool, async (c) => {
    for (const m of mutate) await c.query(m)
    return pgError(c, blocks()[0])
  })

  it('파일 하나·블록 하나 — 지금 카탈로그에서는 통과한다', async () => {
    expect(files).toHaveLength(1)
    expect(blocks()).toHaveLength(1)
    expect(await runAfter([])).toBeNull()
  })

  it('email 열 권한을 되돌리거나, display_name 권한까지 걷거나, 인물 트리거를 끄거나, 명단 트리거를 옛 열 목록으로 되돌리면 멈춘다', async () => {
    expect(await runAfter(['grant update (email) on public.people to authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['revoke update (display_name) on public.people from authenticated'])).toMatchObject(POSTCHECK)
    expect(await runAfter(['alter table public.people disable trigger authz_events_record_people'])).toMatchObject(POSTCHECK)
    expect(await runAfter([
      'drop trigger authz_events_record on public.project_members',
      'create trigger authz_events_record after insert or delete or update of access_role on public.project_members '
        + 'for each row execute function public.record_authz_event()',
    ])).toMatchObject(POSTCHECK)
  })
})
