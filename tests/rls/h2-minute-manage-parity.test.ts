// H2-f(P8-H2-3) — SQL can_manage_minute 와 TS canEditMinute 의 패리티 표. 사용자 7명 + 떠난 작성자 1 상태 × 회의록 10건(프로젝트·무프로젝트,
// 작성자 여러 명, 두 워크스페이스). 어긋나는 칸은 AUTH-11(무프로젝트 × 그 워크스페이스 관리자, 슈퍼유저 아님, SQL 만 참) 넷뿐이어야 한다
// (스펙 §8.2 ③). 보관된 회의록은 SQL 이 거부하고 앱은 checkOwner 가 따로 거부하므로 표에 넣지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canEditMinute, hasProjectRoleInWorkspace } from '@/lib/domain/authz'
import { actorFromDb } from './h2-actor'
import { F, asUser, loadFixture, openPool } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const id = (n: number) => `00000000-0000-0000-7e57-00000000124${n}`
type M = { id: string; project: string | null; ws: string; author: string; label: string }
const MINUTES: M[] = [
  { id: F.rows.minute, project: F.projects.a, ws: F.ws, author: F.users.member, label: 'a·alice' },
  { id: F.rows.nullMinute, project: null, ws: F.ws, author: F.users.member, label: 'A_·alice' },
  { id: id(1), project: F.projects.a, ws: F.ws, author: F.users.dual, label: 'a·dana' },
  { id: id(2), project: F.projects.a, ws: F.ws, author: F.users.aLoose, label: 'a·cy' },
  { id: id(3), project: null, ws: F.ws, author: F.users.aLoose, label: 'A_·cy' },
  { id: id(4), project: null, ws: F.ws, author: F.users.dual, label: 'A_·dana' },
  { id: id(5), project: null, ws: F.ws, author: F.users.wsAdmin, label: 'A_·wsadmin' },
  { id: id(6), project: F.projects.b, ws: F.ws, author: F.users.member, label: 'b·alice' },
  { id: id(7), project: null, ws: F.wsB, author: F.users.bMember, label: 'B_·ben' },
  { id: id(8), project: F.projects.bWs, ws: F.wsB, author: F.users.dual, label: 'bWs·dana' },
]
/** [표의 이름, 계정, 그 계정이 떠난 워크스페이스(케이스 안에서 소속을 지운다 — ④ 트리거가 그 워크스페이스 명단 권한도 null 로)] */
const USERS: Array<[string, string, string?]> = [
  ['platform', F.users.platform], ['wsadmin', F.users.wsAdmin], ['alice', F.users.member], ['cy', F.users.aLoose],
  ['dana', F.users.dual], ['bea', F.users.bAdmin], ['ben', F.users.bMember],
  ['dana(left A)', F.users.dual, F.ws],   // AUTH-02 — 워크스페이스를 떠난 작성자
]

async function seedMinutes(c: PoolClient) {
  for (const m of MINUTES.slice(2)) {
    await c.query(`insert into public.minutes (id, project_id, workspace_id, minute_date, team_code, title, body_md, created_by)
      values ($1, $2, $3, '2026-09-27', 'ERP', $4, '# h2', $5)`, [m.id, m.project, m.ws, `H2 ${m.label}`, m.author])
  }
}

describe('H2-f can_manage_minute ↔ canEditMinute 패리티', () => {
  it('어긋나는 칸은 AUTH-11 넷뿐(무프로젝트 × 그 워크스페이스 관리자, SQL 만 참)', async () => {
    const cells: Array<{ user: string; minute: string; ts: boolean; sql: boolean }> = []
    for (const [label, uid, leftWs] of USERS) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        await seedMinutes(c)
        if (leftWs) await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [leftWs, uid])
        const actor = await actorFromDb(c, uid)
        await c.query('set local role authenticated')
        for (const m of MINUTES) {
          const sql = (await c.query<{ ok: boolean }>('select public.can_manage_minute($1) as ok', [m.id])).rows[0].ok
          const ts = canEditMinute(actor, { created_by: m.author, project_id: m.project, workspace_id: m.ws })
          cells.push({ user: label, minute: m.label, ts, sql })
        }
      })
    }
    const mismatches = cells.filter((x) => x.ts !== x.sql).map((x) => `${x.user}×${x.minute}: ts=${x.ts} sql=${x.sql}`).sort()
    expect(mismatches).toEqual([
      'bea×B_·ben: ts=false sql=true',
      'wsadmin×A_·alice: ts=false sql=true',
      'wsadmin×A_·cy: ts=false sql=true',
      'wsadmin×A_·dana: ts=false sql=true',
    ])
    // 떠난 작성자는 A 의 자기 회의록(프로젝트·무프로젝트)을 양쪽 모두 관리하지 못하고, 남은 B 의 자기 회의록은 그대로 관리한다
    expect(cells.filter((x) => x.user === 'dana(left A)' && x.minute.endsWith('·dana')).map((x) => `${x.minute}: ts=${x.ts} sql=${x.sql}`))
      .toEqual(['a·dana: ts=false sql=false', 'A_·dana: ts=false sql=false', 'bWs·dana: ts=true sql=true'])
    // 표가 비어 통과하지 않게 — 양성·음성이 모두 있어야 한다
    expect(cells.filter((x) => x.sql).length).toBeGreaterThan(10)
    expect(cells.filter((x) => !x.sql).length).toBeGreaterThan(10)
  })

  it('작성자라도 범위 멤버가 아니면 거짓 — 명단 없는 작성자(cy)는 자기 회의록(프로젝트·무프로젝트)을 관리하지 못한다', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await c.query('reset role'); await seedMinutes(c); await c.query('set local role authenticated')
      const { rows } = await c.query<{ p: boolean; n: boolean }>('select public.can_manage_minute($1) as p, public.can_manage_minute($2) as n',
        [id(2), id(3)])
      expect(rows[0]).toEqual({ p: false, n: false })
    })
  })

  it('has_project_role_in_ws = hasProjectRoleInWorkspace — ws 관리자·명단 역할 있음 참, 명단 없는 멤버·다른 워크스페이스 거짓', async () => {
    const cases: Array<[string, string, boolean]> = [
      [F.users.wsAdmin, F.ws, true], [F.users.member, F.ws, true], [F.users.dual, F.ws, true],
      [F.users.aLoose, F.ws, false], [F.users.bAdmin, F.ws, false], [F.users.bAdmin, F.wsB, true], [F.users.platform, F.wsB, true],
    ]
    for (const [uid, wid, expected] of cases) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        const ts = hasProjectRoleInWorkspace(await actorFromDb(c, uid), wid)   // 같은 DB 상태로 만든 Actor(postgres 로 읽는다)
        await c.query('set local role authenticated')
        const sql = (await c.query<{ ok: boolean }>('select public.has_project_role_in_ws($1) as ok', [wid])).rows[0].ok
        expect({ sql, ts }, `${uid} ${wid}`).toEqual({ sql: expected, ts: expected })
      })
    }
  })

  it('보관된 회의록은 누구에게도 관리 대상이 아니다(SQL)', async () => {
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await c.query('reset role')
      await c.query('update public.minutes set archived_at = now() where id = $1', [F.rows.minute])
      await c.query('set local role authenticated')
      expect((await c.query<{ ok: boolean }>('select public.can_manage_minute($1) as ok', [F.rows.minute])).rows[0].ok).toBe(false)
    })
  })
})
