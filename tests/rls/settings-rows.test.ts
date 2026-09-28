// 0012 설정 행 — 문서 열(values·schema_version·revision), 계정 삭제를 막지 않는 FK(스펙 D2), ⑤ 이행의 값 모양.
// 부트스트랩 계정에 기대지 않는다: 계정·프로젝트는 트랜잭션 안에서 만들고 롤백한다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const INSERT_AUTH_USER = `insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  aud, role, instance_id, created_at, updated_at) values ($1, $2, '', now(), '{}', '{}', 'authenticated', 'authenticated',
  '00000000-0000-0000-0000-000000000000', now(), now())`
const U = '00000000-0000-0000-7e57-000000001301'
async function tempUser(c: PoolClient) {
  await c.query(INSERT_AUTH_USER, [U, 'rls-sp3a-editor@example.com'])
}

describe('0012 ② 문서 열과 FK', () => {
  it('두 설정 표에 values·schema_version·revision 이 있고 values 는 객체만 받는다', async () => {
    await asService(pool, async (c) => {
      for (const [table, key, id] of [
        ['project_settings', 'project_id', F.projects.a], ['workspace_settings', 'workspace_id', F.ws],
      ] as const) {
        const { rows } = await c.query<{ t: string; v: number }>(
          `select jsonb_typeof(s."values") as t, s.schema_version as v from public.${table} s where s.${key} = $1`, [id])
        expect(rows, table).toHaveLength(1)
        expect(rows[0].t, table).toBe('object')
        expect(rows[0].v, table).toBe(1)
        expect(await pgError(c, `update public.${table} set "values" = '[]'::jsonb where ${key} = $1`, [id]), table)
          .toMatchObject({ code: '23514', constraint: `${table}_values_check` })
      }
    })
  })

  it('설정을 마지막으로 고친 계정을 지울 수 있다 — updated_by 는 null 이 된다(프로젝트·워크스페이스)', async () => {
    await asService(pool, async (c) => {
      await tempUser(c)
      await c.query('update public.project_settings set updated_by = $2 where project_id = $1', [F.projects.a, U])
      await c.query('update public.workspace_settings set updated_by = $2 where workspace_id = $1', [F.ws, U])
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect((await c.query('select updated_by from public.project_settings where project_id = $1', [F.projects.a])).rows)
        .toEqual([{ updated_by: null }])
      expect((await c.query('select updated_by from public.workspace_settings where workspace_id = $1', [F.ws])).rows)
        .toEqual([{ updated_by: null }])
    })
  })

  it('에이전트를 켠 계정을 지울 수 있다 — agent_projects.created_by 는 null 이 된다', async () => {
    await asService(pool, async (c) => {
      await tempUser(c)
      await c.query('update public.agent_projects set created_by = $2 where project_id = $1', [F.projects.a, U])
      expect(await pgError(c, 'delete from auth.users where id = $1', [U])).toBeNull()
      expect((await c.query('select created_by from public.agent_projects where project_id = $1', [F.projects.a])).rows)
        .toEqual([{ created_by: null }])
    })
  })
})

describe('0012 ⑤ 넓은 열 이행 — 값은 레지스트리가 저장할 모양으로 옮긴다', () => {
  // ⑤ 는 마이그레이션 때 한 번만 돈다. 0012 파일에서 ⑤ 의 프로젝트 문장을 그대로 떼어, 넓은 열을 잠시 되살린 트랜잭션에서
  // 픽스처 프로젝트 하나에 돌리고 롤백한다(뒤 절의 트리거는 replica 로 끈다 — 보는 것은 이 문장의 값 변환뿐이다).
  const MIGRATION = readFileSync(fileURLToPath(new URL('../../supabase/migrations/0012_settings.sql', import.meta.url)), 'utf8')
  const SECTION_5 = MIGRATION.slice(MIGRATION.indexOf('\n-- ⑤ '))
  const PROJECT_MOVE = SECTION_5.slice(SECTION_5.indexOf('update public.project_settings s\n'), SECTION_5.indexOf('update public.workspace_settings s\n'))
    .trim().replace(/;$/, ' where s.project_id = $1')

  it('앞뒤 공백은 떼고(라벨·추가 축 이름), 키워드는 소문자로, 빈 키워드 목록은 명시 [] 로 옮긴다', async () => {
    expect(PROJECT_MOVE).toMatch(/^update public\.project_settings s\s+set "values"/)
    await asService(pool, async (c) => {
      await c.query('set local session_replication_role = replica')
      await c.query(`alter table public.project_settings
        add column level_labels text[], add column milestone_keywords text[], add column extra_axis_label text,
        add column excel_profile jsonb not null default '{}', add column stage_credits jsonb`)
      await c.query(`update public.project_settings set "values" = '{}', level_labels = array[' Phase', 'Task '],
        milestone_keywords = array[' Go-Live '], extra_axis_label = '  공정  ' where project_id = $1`, [F.projects.a])
      await c.query(PROJECT_MOVE, [F.projects.a])
      const { rows: [r] } = await c.query<{ v: Record<string, unknown> }>(
        'select s."values" as v from public.project_settings s where s.project_id = $1', [F.projects.a])
      expect(r.v['core.level_labels']).toEqual(['Phase', 'Task'])
      expect(r.v['core.milestone_keywords']).toEqual(['go-live'])
      expect(r.v['core.extra_axis_label']).toBe('공정')
      await c.query(`update public.project_settings set "values" = '{}', milestone_keywords = array[]::text[], extra_axis_label = null
        where project_id = $1`, [F.projects.a])
      await c.query(PROJECT_MOVE, [F.projects.a])
      const { rows: [e] } = await c.query<{ v: Record<string, unknown> }>(
        'select s."values" as v from public.project_settings s where s.project_id = $1', [F.projects.a])
      expect(e.v['core.milestone_keywords']).toEqual([])
      expect(e.v).not.toHaveProperty('core.extra_axis_label')
    })
  })

  it('앱의 trim 과 같은 공백을 뗀다 — 탭·줄바꿈·NBSP·BOM·전각 공백도(btrim 기본값은 공백 문자 하나뿐)', async () => {
    const pad = (v: string) => `\t ${v}\n　﻿`
    await asService(pool, async (c) => {
      await c.query('set local session_replication_role = replica')
      await c.query(`alter table public.project_settings
        add column level_labels text[], add column milestone_keywords text[], add column extra_axis_label text,
        add column excel_profile jsonb not null default '{}', add column stage_credits jsonb`)
      await c.query(`update public.project_settings set "values" = '{}', level_labels = $2::text[],
        milestone_keywords = $3::text[], extra_axis_label = $4 where project_id = $1`,
        [F.projects.a, [pad('Phase'), 'Task'], [pad('Go-Live')], pad('공정')])
      await c.query(PROJECT_MOVE, [F.projects.a])
      const { rows: [r] } = await c.query<{ v: Record<string, unknown> }>(
        'select s."values" as v from public.project_settings s where s.project_id = $1', [F.projects.a])
      expect(r.v['core.level_labels']).toEqual([pad('Phase').trim(), 'Task'])
      expect(r.v['core.milestone_keywords']).toEqual([pad('Go-Live').trim().toLowerCase()])
      expect(r.v['core.extra_axis_label']).toBe(pad('공정').trim())
      expect(r.v['core.extra_axis_label']).toBe('공정')
    })
  })
})

describe('0012 ⑨-1 설정 행 1:1', () => {
  const [P, W] = ['00000000-0000-0000-7e57-000000001324', '00000000-0000-0000-7e57-00000000aa31']
  const REQUIRED = { code: '23514', message: 'SETTINGS_ROW_REQUIRED' }

  it('프로젝트·워크스페이스마다 설정 행이 정확히 하나다 — 픽스처는 설정 행을 넣지 않는다(트리거가 만든다)', async () => {
    await asService(pool, async (c) => {
      const { rows } = await c.query<{ projects: number; workspaces: number }>(
        `select (select count(*)::int from public.projects p
                  where (select count(*) from public.project_settings s where s.project_id = p.id) <> 1) as projects,
                (select count(*)::int from public.workspaces w
                  where (select count(*) from public.workspace_settings s where s.workspace_id = w.id) <> 1) as workspaces`)
      expect(rows[0]).toEqual({ projects: 0, workspaces: 0 })
    })
  })

  it('어느 경로로 만들어도 빈 설정 행이 생긴다(values {} · revision 0) — 세션 없는 서버 경로', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp3a-rows', 'Acme Rows')`, [W])
      await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'Acme Rows P', W])
      expect((await c.query('select "values" as v, revision::text, schema_version from public.project_settings where project_id = $1', [P])).rows)
        .toEqual([{ v: {}, revision: '0', schema_version: 1 }])
      expect((await c.query('select "values" as v, revision::text, schema_version from public.workspace_settings where workspace_id = $1', [W])).rows)
        .toEqual([{ v: {}, revision: '0', schema_version: 1 }])
    })
  })

  it('설정 행은 직접 지울 수 없다(service_role 도) — 부모를 지우면 함께 사라진다', async () => {
    await asService(pool, async (c) => {
      await c.query(`insert into public.workspaces (id, slug, name) values ($1, 'rls-sp3a-rows', 'Acme Rows')`, [W])
      await c.query('insert into public.projects (id, name, workspace_id) values ($1, $2, $3)', [P, 'Acme Rows P', W])
      await c.query('set local role service_role')
      expect(await pgError(c, 'delete from public.project_settings where project_id = $1', [P])).toMatchObject(REQUIRED)
      expect(await pgError(c, 'delete from public.workspace_settings where workspace_id = $1', [W])).toMatchObject(REQUIRED)
      expect(await pgError(c, 'delete from public.project_settings where project_id = $1', [F.projects.a])).toMatchObject(REQUIRED)
      await c.query('reset role')
      expect(await pgError(c, 'delete from public.projects where id = $1', [P])).toBeNull()
      expect(await pgError(c, 'delete from public.workspaces where id = $1', [W])).toBeNull()
      expect((await c.query('select 1 from public.project_settings where project_id = $1', [P])).rowCount).toBe(0)
      expect((await c.query('select 1 from public.workspace_settings where workspace_id = $1', [W])).rowCount).toBe(0)
    })
  })

  it('설정 이력이 있는 프로젝트도 지울 수 있다 — 이력은 프로젝트와 함께 사라진다', async () => {
    await asService(pool, async (c) => {
      const r = (await c.query(`select public.create_project_with_settings($1, 'Acme 지울 프로젝트', null, null, null,
        '{"core.level_labels": ["A"], "modules.enabled": []}'::jsonb, null, $2, '00000000-0000-4000-8000-000000001381', 1) as r`,
        [F.ws, F.users.wsAdmin])).rows[0].r as { project_id: string }
      expect((await c.query('select 1 from public.project_settings_history where project_id = $1', [r.project_id])).rowCount).toBe(2)
      expect(await pgError(c, 'delete from public.projects where id = $1', [r.project_id])).toBeNull()
      expect((await c.query('select 1 from public.project_settings_history where project_id = $1', [r.project_id])).rowCount).toBe(0)
    })
  })
})
