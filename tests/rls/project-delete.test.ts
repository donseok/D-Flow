// 프로젝트 삭제(*_project_delete — 0058).
// delete_project — service_role 전용, 워크스페이스 관리자(또는 플랫폼 관리자) 재판정(프로젝트 관리자는 못 지운다), 사람이 적은 이름 대조,
// 회의록이 하나라도 있으면(보관된 것 포함) 아무것도 지우지 않고 blocked. 지우는 순서는 함수가 정한다 — 픽스처의 프로젝트 A(c1)는
// projects 를 따라가는 표 거의 전부에 행이 있고(fixture-ws.sql), 여기서 비-CASCADE 참조 21개와 삭제 트리거 6개가 전부 걸리게 행을 더 잇는다.
// 케이스는 begin…rollback 이라 픽스처 밖에는 아무것도 남기지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const U = F.users
const A = F.projects.a
const B = F.projects.b
const ID = (nn: string) => `00000000-0000-4000-8000-0000000058${nn}`
const DELETE = 'select public.delete_project($1, $2, $3) as r'
const SUMMARY = 'select public.project_delete_summary($1) as r'
const UNKNOWN = 'select public.project_delete_unknown_references() as r'
const FNS = ['public.delete_project(uuid, uuid, text)', 'public.project_delete_summary(uuid)', 'public.project_delete_unknown_references()']
const PREFIX_A = `ws/${F.ws}/p/${A}/`

type Result = {
  status: string; reason?: string; minutes?: number; name?: string; removed?: Record<string, number>; credentials?: number
  storage_prefix?: string; referenced?: Record<string, number>; project_id?: string; workspace_id?: string
}
const del = async (c: PoolClient, actor: string, project: string, name: string) =>
  (await c.query<{ r: Result }>(DELETE, [actor, project, name])).rows[0].r
const one = async <T>(c: PoolClient, sql: string, params: unknown[] = []) => (await c.query<{ v: T }>(sql, params)).rows[0]?.v
const count = (c: PoolClient, table: string, where: string, params: unknown[]) =>
  one<number>(c, `select count(*)::int as v from public.${table} where ${where}`, params)

/** projects 를 캐스케이드로 따라가는 표 가운데 project_id 열이 있는 것 — 카탈로그에서 읽는다(손으로 적은 목록이 아니다) */
async function projectTables(c: PoolClient): Promise<string[]> {
  const { rows } = await c.query<{ t: string }>(
    `with recursive reach(rel) as (
       select 'public.projects'::regclass::oid
       union
       select k.conrelid from pg_constraint k join reach r on k.confrelid = r.rel where k.contype = 'f' and k.confdeltype = 'c')
     select cl.relname as t from reach join pg_class cl on cl.oid = reach.rel
      where cl.relname <> 'projects'
        and exists (select 1 from pg_attribute a where a.attrelid = cl.oid and a.attname = 'project_id' and not a.attisdropped)
      order by 1`)
  return rows.map((r) => r.t)
}
/** 표별 그 프로젝트의 행 수 */
async function tallyProject(c: PoolClient, project: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of await projectTables(c)) out[t] = (await count(c, t, 'project_id = $1', [project]))!
  return out
}
/** project_id 열이 없는 딸린 표 — 픽스처의 고정 행으로 본다 */
const CHILD_ROWS: readonly [string, string, unknown[]][] = [
  ['area_teams', 'area_id = $1', ['00000000-0000-0000-7e57-00000000110c']],
  ['project_member_teams', 'member_id = any($1)', [[F.members.aliceA, F.members.bobA, F.members.danaA]]],
  ['item_owners', 'wbs_item_id = $1', [F.leaf.aErp]],
  ['change_logs', 'wbs_item_id = $1', [F.leaf.aErp]],
  ['deliverable_attachments', 'wbs_item_id = $1', [F.leaf.aErp]],
  ['agent_work_reports', 'work_order_id = $1', ['00000000-0000-0000-7e57-00000000110b']],
  ['meeting_exceptions', 'meeting_id = $1', [F.rows.meeting]],
  ['wiki_item_relations', 'from_item_id = $1', [F.rows.wikiItem]],
  ['wiki_item_sources', 'wiki_item_id = $1', [F.rows.wikiItem]],
  ['teams', 'project_id = $1', [A]],
]

/**
 * 프로젝트 A 를 "가득 찬" 상태로 — 픽스처에 없는 연결을 더해 비-CASCADE 참조가 전부 실제 행으로 걸리게 한다.
 * 회의록은 프로젝트 B 로 옮긴다(트리거를 끄고 — 준비일 뿐이다. 회의록 차단 케이스는 옮기지 않은 상태로 본다).
 */
async function fillProjectA(c: PoolClient): Promise<void> {
  await c.query(`set local session_replication_role = replica`)
  await c.query(`update public.minutes set project_id = $2, folder_id = null, meeting_id = null, team_id = null where project_id = $1`, [A, B])
  await c.query(`update public.minute_versions set project_id = $2 where project_id = $1`, [A, B])
  // 옮긴 회의록의 첨부 경로는 옛 프로젝트 접두에 남는다(앱은 회의록을 옮겨도 파일을 옮기지 않는다)
  await c.query(`update public.minute_files set file_path = $2 where id = $1`, [F.rows.minuteFile, `${PREFIX_A}minute-files/${F.rows.minute}/f.txt`])
  await c.query(`set local session_replication_role = origin`)
  // 담당(명단) — 작업·이슈·위키 항목
  await c.query(`update public.wbs_items set assignee_member_id = $2 where id = $1`, [F.leaf.aErp, F.members.aliceA])
  await c.query(
    `update public.issues set assignee_member_id = $2, area_id = $3, area_kind = 'issue_area', major_id = $4,
            sub_process = '세부', owner_department = '부서', source_type = 'other' where id = $1`,
    [F.rows.issue, F.members.aliceA, '00000000-0000-0000-7e57-000000001bf0', '00000000-0000-0000-7e57-00000000110e'])
  await c.query(`update public.wiki_items set owner_member_id = $2 where id = $1`, [F.rows.wikiItem, F.members.aliceA])
  // 주제의 자기 참조·질문의 주제
  await c.query(`insert into public.wiki_topics (id, project_id, title, normalized_title, parent_id) values ($1, $2, '하위 토픽', '하위 토픽', $3)`,
    [ID('a1'), A, F.rows.wikiTopic])
  await c.query(`update public.wiki_questions set topic_id = $2 where project_id = $1`, [A, F.rows.wikiTopic])
  await c.query(`update public.wiki_change_events set source_id = null where project_id = $1`, [A])
  // 에이전트 주문 → 작업, 승인 → 주문·보고
  await c.query(`update public.agent_work_orders set wbs_item_id = $2 where project_id = $1`, [A, F.leaf.aErp])
  await c.query(`update public.wbs_stage_approvals set order_id = $2, report_id = $3 where project_id = $1`,
    [A, '00000000-0000-0000-7e57-00000000110b', '00000000-0000-0000-7e57-000000001128'])
  // 전용 팀의 회의록 팀 루트(→ teams NO ACTION), 공용 팀을 가리키는 명단-팀·영역-팀
  await c.query(`insert into public.minute_folders (id, project_id, workspace_id, name, kind, team_id) values ($1, $2, $3, 'MES', 'team_root', $4)`,
    [ID('a2'), A, F.ws, F.teams.mes])
  await c.query(`insert into public.project_member_teams (member_id, team_id, is_primary) values ($1, $2, false)`, [F.members.bobA, F.teams.aShared])
  await c.query(`insert into public.area_teams (area_id, team_id, kind) values ($1, $2, 'support') on conflict do nothing`,
    ['00000000-0000-0000-7e57-00000000110c', F.teams.mes])
  // 저장소 경로 — 접두 아래를 가리키는 첨부(프로젝트와 함께 지워진다)
  await c.query(`update public.issue_attachments set file_path = $2 where project_id = $1`, [A, `${PREFIX_A}issue-attachments/${F.rows.issue}/a.txt`])
  // 연동 토큰 — 이 프로젝트만 허용한 열린 토큰(소유자 alice), 전용 팀을 가리키는 워크스페이스 토큰, 소유자가 떠난 닫힌 토큰
  await c.query(
    `insert into public.integration_credentials (id, workspace_id, kind, name, token_prefix, token_hash, expires_at, project_ids, default_project_id, owner_user_id)
     values ($1, $2, 'agent_runner', 'pat-open', 'RlsPatOpen01', repeat('b', 64), '2099-01-01T00:00:00Z', array[$3::uuid, $4::uuid], $3, $5)`,
    [ID('c1'), F.ws, A, B, U.member])
  await c.query(
    `update public.integration_credentials set default_team_id = $2, team_map = $3::jsonb where id = $1`,
    ['00000000-0000-0000-7e57-00000000f701', F.teams.erp, JSON.stringify({ ERP: F.teams.erp, SHR: F.teams.aShared })])
  await c.query(
    `insert into public.integration_credentials (id, workspace_id, kind, name, token_prefix, token_hash, expires_at, project_ids, default_project_id, owner_user_id)
     values ($1, $2, 'agent_runner', 'pat-closed', 'RlsPatShut01', repeat('c', 64), '2099-01-01T00:00:00Z', array[$3::uuid], $3, $4)`,
    [ID('c2'), F.ws, A, U.aLoose])
  await c.query(`update public.integration_credentials set enabled = false, revoked_at = now() where id = $1`, [ID('c2')])
  await c.query(`delete from public.workspace_members where workspace_id = $1 and user_id = $2`, [F.ws, U.aLoose])
}

describe('실행권 — 세 함수는 service_role 전용', () => {
  it('anon·authenticated 에 EXECUTE 가 없고 service_role 에만 있다', async () => {
    for (const fn of FNS) {
      const { rows } = await pool.query<{ anon: boolean; auth: boolean; svc: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon, has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as svc`, [fn])
      expect(rows, fn).toEqual([{ anon: false, auth: false, svc: true }])
    }
  })

  it('JWT 세션은 실행하지 못한다(42501) — 플랫폼 관리자·워크스페이스 관리자여도. 익명도', async () => {
    for (const user of [U.platform, U.wsAdmin]) {
      await asUser(pool, user, async (c) => {
        expect(await pgError(c, DELETE, [user, A, 'RLS A']))
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for function delete_project') })
        expect(await pgError(c, SUMMARY, [A])).toMatchObject({ code: '42501' })
      })
    }
    await asService(pool, async (c) => {
      await c.query('set local role anon')
      expect(await pgError(c, DELETE, [U.wsAdmin, A, 'RLS A'])).toMatchObject({ code: '42501' })
    })
  })

  it('세션은 projects 를 직접 지우지 못한다 — 길은 RPC 뿐이다', async () => {
    // 0003 의 정책 wsadmin_delete_projects 와 DELETE 권한은 0058 이 거뒀다 — 워크스페이스 관리자·플랫폼 관리자의 세션도 42501
    for (const user of [U.wsAdmin, U.platform, U.member]) {
      await asUser(pool, user, async (c) => {
        expect(await pgError(c, 'delete from public.projects where id = $1', [B]), user)
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied for table projects') })
        expect(await count(c, 'projects', 'id = $1', [B])).toBe(1)
      })
    }
    const { rows } = await pool.query(`select polname from pg_policy where polrelid = 'public.projects'::regclass and polcmd in ('d', '*')`)
    expect(rows).toEqual([])
  })
})

describe('등급 재판정 — 워크스페이스 관리자만', () => {
  it('프로젝트 관리자(워크스페이스 관리자 아님)·평멤버·다른 워크스페이스의 관리자는 AUTHZ_FORBIDDEN, 없는 프로젝트도 같은 거부다', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      const before = await tallyProject(c, A)
      // alice 는 프로젝트 A 의 관리자지만 워크스페이스에서는 멤버다
      for (const actor of [U.member, U.dual, U.bAdmin, U.bMember]) {
        expect(await pgError(c, DELETE, [actor, A, 'RLS A']), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect(await pgError(c, DELETE, [U.wsAdmin, ID('ff'), 'RLS A'])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      expect(await pgError(c, DELETE, [U.platform, ID('ff'), 'RLS A'])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      expect(await tallyProject(c, A)).toEqual(before)
      expect(await count(c, 'projects', 'id = $1', [A])).toBe(1)
    })
  })

  it('보관된 워크스페이스의 프로젝트는 그 관리자도, 플랫폼 관리자도 지우지 못한다(0056 — 없는 것으로 판정)', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      await c.query('select public.archive_workspace($1, $2, $3, $4)', [U.platform, F.ws, 'rls-acme', null])
      for (const actor of [U.wsAdmin, U.platform]) {
        expect(await pgError(c, DELETE, [actor, A, 'RLS A']), actor).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
      }
      expect(await count(c, 'projects', 'id = $1', [A])).toBe(1)
    })
  })

  it('입력이 비면 22023 PROJECT_DELETE_INVALID, read committed 가 아니면 25001', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, DELETE, [null, A, 'RLS A'])).toMatchObject({ code: '22023', message: 'PROJECT_DELETE_INVALID' })
      expect(await pgError(c, DELETE, [U.wsAdmin, null, 'RLS A'])).toMatchObject({ code: '22023', message: 'PROJECT_DELETE_INVALID' })
      expect(await pgError(c, DELETE, [U.wsAdmin, A, null])).toMatchObject({ code: '22023', message: 'PROJECT_DELETE_INVALID' })
    })
    const c = await pool.connect()
    try {
      await c.query('begin isolation level repeatable read')
      await expect(c.query(DELETE, [U.wsAdmin, A, 'RLS A'])).rejects.toMatchObject({ code: '25001', message: 'PROJECT_DELETE_ISOLATION' })
    } finally {
      await c.query('rollback')
      c.release()
    }
  })
})

describe('이름 대조', () => {
  it('적은 이름이 다르면 22023 PROJECT_NAME_MISMATCH — 아무것도 지워지지 않는다. 양끝 공백만 뗀다(대소문자·안쪽 공백은 그대로 본다)', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      const before = await tallyProject(c, A)
      for (const name of ['RLS B', 'rls a', 'RLS  A', '']) {
        expect(await pgError(c, DELETE, [U.wsAdmin, A, name]), name).toMatchObject({ code: '22023', message: 'PROJECT_NAME_MISMATCH' })
      }
      expect(await tallyProject(c, A)).toEqual(before)
    })
  })
})

describe('회의록이 있으면 거부', () => {
  it('회의록이 있으면 blocked 와 건수 — 아무것도 지워지지 않고 회의록의 연결도 그대로다', async () => {
    await asService(pool, async (c) => {
      const before = await tallyProject(c, A)
      const minutes = await count(c, 'minutes', 'project_id = $1', [A])
      expect(minutes).toBeGreaterThan(0)
      await c.query('set local role service_role')
      expect(await del(c, U.wsAdmin, A, 'RLS A')).toEqual({ status: 'blocked', reason: 'minutes', minutes, minutes_archived: 0, name: 'RLS A' })
      await c.query('reset role')
      expect(await tallyProject(c, A)).toEqual(before)
      expect(await count(c, 'minutes', 'project_id = $1', [A])).toBe(minutes)
      expect(await count(c, 'authz_events', `kind = 'project_deleted'`, [])).toBe(0)
    })
  })

  it('보관된 회의록만 남아도 거부한다', async () => {
    await asService(pool, async (c) => {
      await c.query('set local session_replication_role = replica')
      await c.query('update public.minutes set archived_at = now() where project_id = $1', [A])
      await c.query('set local session_replication_role = origin')
      expect(await count(c, 'minutes', 'project_id = $1 and archived_at is null', [A])).toBe(0)
      const r = await del(c, U.wsAdmin, A, 'RLS A')
      expect(r).toMatchObject({ status: 'blocked', minutes: 1 })
      expect((r as { minutes_archived?: number }).minutes_archived).toBe(1)
      expect(await count(c, 'projects', 'id = $1', [A])).toBe(1)
    })
  })

  it('project_id 가 아니어도 그 프로젝트의 회의·폴더·전용 팀을 가리키는 회의록은 센다(삭제가 그 연결을 풀게 된다)', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      expect((await one<{ minutes: number }>(c, SUMMARY.replace(' as r', ' as v'), [A]))!.minutes).toBe(0)
      await c.query('set local session_replication_role = replica')
      for (const [col, value] of [['meeting_id', F.rows.meeting], ['folder_id', F.rows.folder], ['team_id', F.teams.erp], ['folder_id', ID('a2')]] as const) {
        await c.query('savepoint link')
        await c.query(`update public.minutes set ${col} = $2 where id = $1`, [F.rows.minute, value])
        expect((await one<{ minutes: number }>(c, SUMMARY.replace(' as r', ' as v'), [A]))!.minutes, `${col}`).toBe(1)
        await c.query('rollback to savepoint link')
      }
    })
  })
})

describe('가득 찬 프로젝트의 삭제', () => {
  it('딸린 행이 한 번에 지워진다 — 비-CASCADE 참조 21개·삭제 트리거 6개가 걸린 상태에서', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      const before = await tallyProject(c, A)
      // 전제 — 표마다 실제로 행이 있다(빈 표를 지운 것으로 통과하지 않게)
      // (알림 수신자의 project_id 는 픽스처 행에서 비어 있다 — 그 행은 알림 사건을 따라 지워진다)
      const empty = Object.entries(before).filter(([, n]) => n === 0).map(([t]) => t)
      expect(empty, '픽스처에 행이 없는 표').toEqual(['notification_recipients'])
      expect(await count(c, 'notification_recipients', 'event_id = $1', [F.rows.globalEvent])).toBe(1)
      for (const [t, where, params] of CHILD_ROWS) expect(await count(c, t, where, params), t).toBeGreaterThan(0)
      const otherBefore = await tallyProject(c, B)
      const summary = (await one<{ minutes: number; removed: Record<string, number> }>(c, SUMMARY.replace(' as r', ' as v'), [A]))!

      await c.query('set local role service_role')
      const r = await del(c, U.wsAdmin, A, '  RLS A ')
      await c.query('reset role')

      expect(r).toMatchObject({ status: 'deleted', project_id: A, workspace_id: F.ws, name: 'RLS A', storage_prefix: PREFIX_A, credentials: 3 })
      expect(r.removed).toEqual(summary.removed)
      expect(r.removed).toMatchObject({ wbs_items: 3, issues: 1, weekly_reports: 1, meetings: 1, wiki_items: 2, wiki_topics: 2, project_members: 3, teams: 2, attachments: 2 })
      // 옮긴 회의록의 첨부가 아직 옛 접두를 가리킨다 — 앱은 그 버킷을 정리하지 않는다
      expect(r.referenced).toEqual({ deliverables: 0, 'issue-attachments': 0, minutes: 1, 'form-templates': 0 })

      expect(await count(c, 'projects', 'id = $1', [A])).toBe(0)
      const after = await tallyProject(c, A)
      expect(Object.entries(after).filter(([, n]) => n !== 0), '남은 행').toEqual([])
      expect(await count(c, 'notification_recipients', 'event_id = $1', [F.rows.globalEvent])).toBe(0)
      for (const [t, where, params] of CHILD_ROWS) expect(await count(c, t, where, params), t).toBe(0)
      // 다른 프로젝트·공용 팀·옮긴 회의록은 그대로
      expect(await tallyProject(c, B)).toEqual(otherBefore)
      expect(await count(c, 'teams', 'id = $1', [F.teams.aShared])).toBe(1)
      expect(await one(c, 'select project_id as v from public.minutes where id = $1', [F.rows.minute])).toBe(B)
      expect(await count(c, 'minute_versions', 'minute_id = $1', [F.rows.minute])).toBe(1)
      expect(await count(c, 'minute_files', 'id = $1', [F.rows.minuteFile])).toBe(1)
      // 사용 기록은 남고 프로젝트 칸만 빈다
      expect(await one(c, 'select project_id as v from public.usage_events where id = 7057001')).toBeNull()
      // 파기 스위치·행위자 설정이 구간 밖으로 새지 않는다
      expect(await one(c, `select current_setting('app.wiki_purge', true) as v`)).toBe('')
      expect(await one(c, `select current_setting('app.authz_actor', true) as v`)).toBe('')
      expect(await pgError(c, 'delete from public.wiki_topic_revisions where project_id = $1', [B])).toBeNull()   // 0행 — 트리거는 행이 있어야 돈다
    })
  })

  it('연동 토큰 — 지운 프로젝트·전용 팀의 참조만 뗀다. project_ids 는 빈 배열로 남고(null 로 넓어지지 않는다) 닫힌 토큰도 정리된다', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      await del(c, U.wsAdmin, A, 'RLS A')
      const row = async (id: string) => (await c.query(
        'select project_ids, default_project_id, default_team_id, team_map, enabled from public.integration_credentials where id = $1', [id])).rows[0]
      expect(await row(ID('c1'))).toEqual({ project_ids: [B], default_project_id: null, default_team_id: null, team_map: {}, enabled: true })
      expect(await row('00000000-0000-0000-7e57-00000000f701'))
        .toEqual({ project_ids: null, default_project_id: null, default_team_id: null, team_map: { SHR: F.teams.aShared }, enabled: true })
      expect(await row(ID('c2'))).toEqual({ project_ids: [], default_project_id: null, default_team_id: null, team_map: {}, enabled: false })
    })
  })

  it('감사 기록 — 삭제 1행(누가·어느 프로젝트·건수)과 명단 권한의 회수 기록(parent_deleted)이 남고, 그 프로젝트의 옛 기록도 남는다', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      // 픽스처가 큰 id 를 직접 넣어 둬서 max(id) 로는 새 행을 가르지 못한다 — 미리 있던 id 목록으로 가른다
      const oldIds = (await c.query<{ id: string }>('select id::text as id from public.authz_events')).rows.map((r) => r.id)
      await del(c, U.wsAdmin, A, 'RLS A')
      const { rows } = await c.query(
        `select kind, workspace_id, project_id, target_person_id, before, after, cause, actor_user_id
           from public.authz_events where not (id::text = any($1)) order by kind, target_person_id`, [oldIds])
      expect(rows.filter((r) => r.kind === 'project_deleted')).toEqual([expect.objectContaining({
        workspace_id: F.ws, project_id: A, cause: 'direct', actor_user_id: U.wsAdmin, after: null,
        before: expect.objectContaining({ name: 'RLS A', removed: expect.objectContaining({ wbs_items: 3, issues: 1 }) }),
      })])
      // 권한이 있던 명단 행 둘(alice 관리자·dana 멤버) — 권한 없는 외부 인력 행은 기록하지 않는다
      const access = rows.filter((r) => r.kind === 'project_access')
      expect(access.map((r) => [r.target_person_id, r.cause, r.actor_user_id, r.project_id]).sort()).toEqual([
        [F.people.member, 'parent_deleted', U.wsAdmin, A], [F.people.dualA, 'parent_deleted', U.wsAdmin, A]].sort())
      expect(await count(c, 'authz_events', 'id::text = any($1)', [oldIds])).toBe(oldIds.length)
      // 기록은 여전히 고칠 수 없다
      expect(await pgError(c, `delete from public.authz_events where kind = 'project_deleted'`)).toMatchObject({ code: '55000' })
    })
  })

  it('플랫폼 관리자도 지운다(워크스페이스 관리자 승계). 빈 프로젝트도 지워진다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.projects (id, name, workspace_id) values ($1, '빈 프로젝트', $2)`, [ID('b1'), F.ws])
      const r = await del(c, U.platform, ID('b1'), '빈 프로젝트')
      expect(r).toMatchObject({ status: 'deleted', name: '빈 프로젝트', credentials: 0 })
      expect(Object.values(r.removed!).every((n) => n === 0)).toBe(true)
      expect(await count(c, 'projects', 'id = $1', [ID('b1')])).toBe(0)
      expect(await count(c, 'project_settings', 'project_id = $1', [ID('b1')])).toBe(0)
      // 두 번째 호출 — 이미 없다(존재를 알려 주지 않는 같은 거부)
      expect(await pgError(c, DELETE, [U.platform, ID('b1'), '빈 프로젝트'])).toMatchObject({ code: '42501', message: 'AUTHZ_FORBIDDEN' })
    })
  })
})

describe('보호 트리거는 그대로다 — 삭제 RPC 밖에서는 여전히 막는다', () => {
  it('영수증·설정 이력·설정 행·위키 주제 개정은 프로젝트가 살아 있는 동안 지울 수 없다', async () => {
    await asService(pool, async (c) => {
      expect(await pgError(c, 'delete from public.command_receipts where project_id = $1', [A])).toMatchObject({ code: '55000', message: 'HISTORY_IMMUTABLE' })
      expect(await pgError(c, 'delete from public.project_settings_history where project_id = $1', [A])).toMatchObject({ code: '55000', message: 'HISTORY_IMMUTABLE' })
      expect(await pgError(c, 'delete from public.project_settings where project_id = $1', [A])).toMatchObject({ code: '23514', message: 'SETTINGS_ROW_REQUIRED' })
      expect(await pgError(c, 'delete from public.wiki_topic_revisions where project_id = $1', [A])).toMatchObject({ code: '55000' })
    })
  })

  it('연동 토큰 가드 — 닫힌 토큰은 참조를 떼는 갱신만 통과한다. 넓히기·다른 열·열린 토큰은 종전대로 막힌다', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      const closed = ID('c2')
      const upd = (set: string, params: unknown[] = []) => pgError(c, `update public.integration_credentials set ${set} where id = $1`, [closed, ...params])
      // 소유자(cy)가 워크스페이스를 떠난 닫힌 토큰 — 넓히는 변경은 소속 검사에 걸린다
      expect(await upd('project_ids = null')).toMatchObject({ code: '23514', message: 'INTEGRATION_CREDENTIALS_OWNER_NOT_MEMBER' })
      expect(await upd('project_ids = array[$2::uuid, $3::uuid]', [A, B])).toMatchObject({ code: '23514' })
      expect(await upd('default_project_id = $2', [B])).toMatchObject({ code: '23514' })
      expect(await upd(`name = 'x', project_ids = '{}'`)).toMatchObject({ code: '23514' })
      expect(await upd(`enabled = true, project_ids = '{}'`)).toMatchObject({ code: '23514' })
      expect(await upd(`team_map = $2::jsonb`, [JSON.stringify({ X: F.teams.aShared })])).toMatchObject({ code: '23514' })
      // 좁히기는 통과
      expect(await upd(`project_ids = '{}', default_project_id = null`)).toBeNull()
      // 열린 토큰은 이 갈래를 지나지 못한다 — 없는 프로젝트를 남기는 갱신은 종전의 검사에 걸린다
      expect(await pgError(c, `update public.integration_credentials set project_ids = array[$2::uuid] where id = $1`, [ID('c1'), ID('ff')]))
        .toMatchObject({ code: '23514', message: 'INTEGRATION_CREDENTIALS_PROJECT_NOT_IN_WORKSPACE' })
    })
  })
})

describe('모르는 참조 — 새 표가 조용히 막거나 남지 않는다', () => {
  it('지금 카탈로그에는 모르는 참조·삭제 트리거가 없다', async () => {
    expect((await pool.query<{ r: string | null }>(UNKNOWN)).rows[0].r).toBeNull()
  })

  it('딸린 표를 비-CASCADE 로 붙드는 새 참조·새 삭제 트리거가 생기면 목록에 나오고, 삭제는 0A000 으로 멈춘다', async () => {
    await asService(pool, async (c) => {
      await fillProjectA(c)
      await c.query('create table public.rls_new_pin (id uuid primary key default gen_random_uuid(), team_id uuid references public.teams(id) on delete restrict)')
      await c.query(`create function public.rls_new_guard() returns trigger language plpgsql as $f$ begin return old; end $f$`)
      await c.query('create trigger rls_new_guard_trg before delete on public.holidays for each row execute function public.rls_new_guard()')
      const unknown = (await c.query<{ r: string }>(UNKNOWN)).rows[0].r
      expect(unknown).toBe('fk:rls_new_pin.rls_new_pin_team_id_fkey, trigger:holidays.rls_new_guard_trg')
      const before = await tallyProject(c, A)
      expect(await pgError(c, DELETE, [U.wsAdmin, A, 'RLS A']))
        .toMatchObject({ code: '0A000', message: 'PROJECT_DELETE_UNKNOWN_REFERENCE', detail: unknown })
      expect(await tallyProject(c, A)).toEqual(before)
    })
  })
})
