import { DatabaseError, type Pool, type PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { attachmentRejection, DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy, type AttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { ATTACHMENT_POLICY_CASES } from '../fixtures/attachment-policy-cases'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })
const M = '00000000-0000-0000-7e57-000000003100'
const M2 = '00000000-0000-0000-7e57-000000003101'
const NM = '00000000-0000-0000-7e57-000000003102'
const MR = '00000000-0000-0000-7e57-00000000310f'
const SMALL: AttachmentPolicy = { ...DEFAULT_ATTACHMENT_POLICY, maxFileBytes: 100, maxCount: 2, maxTotalBytes: 150, allowedExtensions: ['pdf'] }
const INSERT = `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by)
  values ($1, 'attachment', $2, $3, 1, 'text/plain', $4) returning id, size, mime`
const path = (id = M, project: string | null = F.projects.a, name = 'a.pdf') => makeStoragePath({ workspaceId: F.ws, projectId: project, entity: 'minute-files', entityId: id, fileName: name })
const setPolicy = (c: PoolClient, policy: unknown, project: string | null = F.projects.a) => c.query(
  project === null ? `update public.workspace_settings set values = values || jsonb_build_object('minutes.attachments', $2::jsonb) where workspace_id = $1`
    : `update public.project_settings set values = values || jsonb_build_object('minutes.attachments', $2::jsonb) where project_id = $1`,
  [project ?? F.ws, JSON.stringify(policy)])
async function scene(c: PoolClient, policy: unknown = SMALL, project: string | null = F.projects.a, id = M) {
  await c.query('reset role')
  await c.query(`insert into public.minutes (id, workspace_id, project_id, minute_date, team_code, title, body_md, created_by)
    values ($1, $2, $3, '2026-10-04', 'ERP', 'B3 정책', '# 정책', $4)`, [id, F.ws, project, F.users.member])
  await setPolicy(c, policy, project)
  await c.query('set local role authenticated')
}
async function put(c: PoolClient, name: string, bytes: number, owner: string = F.users.member) {
  await c.query('reset role')
  await c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('minutes', $1, $2, $3::jsonb)`,
    [name, owner, JSON.stringify({ size: bytes, mimetype: 'application/pdf' })])
  await c.query('set local role authenticated')
}
async function add(c: PoolClient, name: string, bytes: number, id = M, project: string | null = F.projects.a) {
  const p = path(id, project, name)
  await put(c, p, bytes)
  return pgError(c, INSERT, [id, name, p, F.users.member])
}

describe('TS/SQL 정책 해석 패리티', () => {
  it.each(ATTACHMENT_POLICY_CASES)('$name', async ({ raw, ok }) => {
    await asService(pool, async c => {
      const err = await pgError(c, `select public.minute_attachment_policy_of(jsonb_build_object('minutes.attachments', $1::jsonb))`, [JSON.stringify(raw)])
      expect(err === null).toBe(ok)
      expect(parseAttachmentPolicy(raw).ok).toBe(ok)
      if (!ok) expect(err).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:minutes.attachments' })
    })
  })
  it('키 없음만 기본값, 설정 문서/키 손상은 거부한다', async () => {
    await asService(pool, async c => {
      expect((await c.query(`select public.minute_attachment_policy_of('{}'::jsonb) as p`)).rows[0].p).toEqual(DEFAULT_ATTACHMENT_POLICY)
      for (const v of [null, '[]', 'null']) expect(await pgError(c, `select public.minute_attachment_policy_of($1::jsonb)`, [v]))
        .toMatchObject({ code: '22023', message: 'CONFIG_INVALID:minutes.attachments' })
    })
  })
})
describe('실제 객체/정책 제한', () => {
  it.each([
    { name: '정상', policy: SMALL, bytes: 100, file: 'x.pdf', error: null },
    { name: '빈 파일', policy: SMALL, bytes: 0, file: 'empty.pdf', error: null },
    { name: '꺼짐', policy: { ...SMALL, enabled: false }, bytes: 1, file: 'x.pdf', error: 'DISABLED' },
    { name: '파일 용량', policy: SMALL, bytes: 101, file: 'x.pdf', error: 'TOO_LARGE' },
    { name: '확장자', policy: SMALL, bytes: 1, file: 'x.exe', error: 'EXTENSION' },
    { name: '대문자 이름', policy: SMALL, bytes: 1, file: 'x.PDF', error: null },
    { name: '빈 확장자 목록', policy: { ...SMALL, allowedExtensions: [] }, bytes: 1, file: 'x.pdf', error: 'EXTENSION' },
    { name: '무제한 확장자', policy: { ...SMALL, allowedExtensions: null }, bytes: 1, file: 'x.exe', error: null },
  ])('$name TS/DB가 같은 판정이다', async ({ policy, bytes, file, error }) => {
    expect(attachmentRejection(policy, { fileName: file, size: bytes }, { count: 0, bytes: 0 })).toBe(error)
    await asUser(pool, F.users.member, async c => {
      await scene(c, policy)
      const e = await add(c, file, bytes)
      if (error) expect(e).toMatchObject({ code: '23514', message: 'MINUTE_ATTACHMENT_' + error })
      else expect(e).toBeNull()
    })
  })
  it('두 프로젝트 정책과 무프로젝트 워크스페이스 정책은 섞이지 않는다', async () => {
    await asUser(pool, F.users.member, async c => {
      await scene(c, SMALL)
      await scene(c, { ...SMALL, maxFileBytes: 200, maxTotalBytes: 400 }, F.projects.b, M2)
      await scene(c, { ...SMALL, maxFileBytes: 20, maxTotalBytes: 40 }, null, NM)
      expect(await add(c, 'one.pdf', 150)).toMatchObject({ message: 'MINUTE_ATTACHMENT_TOO_LARGE' })
      expect(await add(c, 'two.pdf', 150, M2, F.projects.b)).toBeNull()
      expect(await add(c, 'none.pdf', 21, NM, null)).toMatchObject({ message: 'MINUTE_ATTACHMENT_TOO_LARGE' })
    })
  })
  it('손상된 프로젝트 정책을 워크스페이스 기본값으로 대체하지 않는다', async () => {
    await asUser(pool, F.users.member, async c => {
      await scene(c, null)
      expect(await add(c, 'bad.pdf', 1)).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:minutes.attachments' })
    })
  })
  it.each([F.projects.a, null])('설정 행이 없는 범위 %s는 확정을 닫는다', async project => {
    await asUser(pool, F.users.member, async c => {
      await scene(c, SMALL, project)
      await c.query('reset role')
      const table = project === null ? 'workspace_settings' : 'project_settings'
      const column = project === null ? 'workspace_id' : 'project_id'
      const remove = `delete from public.${table} where ${column} = $1`
      // 정상 경로는 먼저 보호 트리거가 막는지 확인한다. 아래는 실제로 일어나지 않는 손상 상태 탐침이다.
      expect(await pgError(c, remove, [project ?? F.ws])).toMatchObject({ message: 'SETTINGS_ROW_REQUIRED' })
      await c.query(`alter table public.${table} disable trigger ${table}_keep_row`)
      await c.query(remove, [project ?? F.ws])
      await c.query(`alter table public.${table} enable trigger ${table}_keep_row`)
      await c.query('set local role authenticated')
      expect(await add(c, 'missing.pdf', 1, M, project)).toMatchObject({ code: '22023', message: 'CONFIG_INVALID:minutes.attachments' })
    })
  })
  it('살아 있는 개수·총량만 판정하고 중복은 톰스톤에도 적용한다', async () => {
    await asUser(pool, F.users.member, async c => {
      await scene(c)
      expect(await add(c, 'one.pdf', 100)).toBeNull()
      expect(await add(c, 'over.pdf', 51)).toMatchObject({ message: 'MINUTE_ATTACHMENT_TOTAL_EXCEEDED' })
      expect(await add(c, 'two.pdf', 50)).toBeNull()
      expect(await add(c, 'three.pdf', 1)).toMatchObject({ message: 'MINUTE_ATTACHMENT_LIMIT' })
      await c.query('reset role')
      await c.query(`update public.minute_files set deleted_at = now(), deleted_by = $2 where minute_id = $1 and file_name = 'one.pdf'`, [M, F.users.member])
      await c.query('set local role authenticated')
      expect(await pgError(c, INSERT, [M, 'one.pdf', path(M, F.projects.a, 'one.pdf'), F.users.member])).toMatchObject({ code: '23505', message: 'MINUTE_ATTACHMENT_DUPLICATE' })
      expect(await add(c, 'new.pdf', 100)).toBeNull()
      expect((await c.query(`select count(*)::int as n from public.minute_files where minute_id = $1`, [M])).rows[0].n).toBe(2)
    })
  })
  it('숨김 목록뿐 아니라 직접 Storage 읽기/새 서명도 톰스톤을 제외한다', async () => {
    await asUser(pool, F.users.member, async c => {
      await scene(c); expect(await add(c, 'one.pdf', 1)).toBeNull()
      const p = path(M, F.projects.a, 'one.pdf')
      expect((await c.query('select count(*)::int as n from storage.objects where name = $1', [p])).rows[0].n).toBe(1)
      await c.query('reset role')
      await c.query('update public.minute_files set deleted_at = now(), deleted_by = $2 where minute_id = $1', [M, F.users.member])
      await c.query('set local role authenticated')
      expect((await c.query('select count(*)::int as n from public.minute_files where minute_id = $1', [M])).rows[0].n).toBe(0)
      expect((await c.query('select count(*)::int as n from storage.objects where name = $1', [p])).rows[0].n).toBe(0)
      expect((await c.query('select public.minute_attachment_path_active($1) as v', [p])).rows[0].v).toBe(false)
      expect(await pgError(c, 'delete from public.minute_files where minute_id = $1', [M])).toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') })
    })
  })
  it('권한 없는 직접 확정은 RLS, 권한 있어도 톰스톤을 넣어 한도를 우회하지 못한다', async () => {
    await asUser(pool, F.users.aLoose, async c => {
      await scene(c); await put(c, path(), 1, F.users.aLoose)
      expect(await pgError(c, INSERT, [M, 'a.pdf', path(), F.users.aLoose])).toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
    })
    await asUser(pool, F.users.member, async c => {
      await scene(c); await put(c, path(), 1)
      expect(await pgError(c, `insert into public.minute_files (minute_id, role, file_name, file_path, uploaded_by, deleted_at, deleted_by)
        values ($1, 'attachment', 'a.pdf', $2, $3, now(), $3)`, [M, path(), F.users.member])).toMatchObject({ code: '23514', message: 'MINUTE_FILE_IMMUTABLE' })
    })
  })
})
describe('톰스톤 전이와 실제 service_role', () => {
  it('기존 본문 버전 RPC는 본문 포인터를 교체하고 첨부를 보존한다', async () => {
    await asService(pool, async c => {
      await scene(c)
      await c.query('reset role')
      await c.query(INSERT, [M, 'keep.pdf', path(), F.users.member])
      await c.query('set local role service_role')
      const bodyPath = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: M, fileName: 'new.md' })
      const body = '# 새 원문'
      const result = await c.query(`select * from public.commit_minute_body_version($1, $2, public.wiki_fnv1a64($2), 'new.md', $3, 20, 'text/markdown', $4, '합성 등록자')`, [M, body, bodyPath, F.users.member])
      expect(result.rows).toHaveLength(1)
      expect((await c.query('select body_md from public.minutes where id = $1', [M])).rows[0].body_md).toBe(body)
      expect((await c.query("select file_path from public.minute_files where minute_id = $1 and role = 'body'", [M])).rows[0].file_path).toBe(bodyPath)
      expect((await c.query("select count(*)::int n from public.minute_files where minute_id = $1 and role = 'attachment' and deleted_at is null", [M])).rows[0].n).toBe(1)
      expect((await c.query('select body_md from public.minute_versions where id = $1', [result.rows[0].version_id])).rows[0].body_md).toBe(body)
    })
  })
  it('service_role도 경로·되살리기·다시 purge·혼합 메타 변경은 거부된다', async () => {
    await asService(pool, async c => {
      await c.query(`insert into public.minutes (id, workspace_id, project_id, minute_date, team_code, title, body_md, created_by)
        values ($1, $2, $3, '2026-10-04', 'ERP', '톰스톤', '# 삭제', $4)`, [M, F.ws, F.projects.a, F.users.member])
      const { rows } = await c.query(INSERT, [M, 'a.pdf', path(), F.users.member])
      const id = rows[0].id
      const account = '00000000-0000-0000-7e57-0000000031aa'
      await c.query("insert into auth.users (id, email) values ($1, 'b3-delete-user@example.com')", [account])
      // 현재 행은 이미 불변이다. FK 검증용 행을 새 계정으로 따로 만든다.
      const fresh = (await c.query(INSERT, [M, 'fresh.pdf', path(M, F.projects.a, 'fresh.pdf'), account])).rows[0].id
      await c.query('set local role service_role')
      expect(await pgError(c, `update public.minute_files set file_path = 'x' where id = $1`, [id])).toMatchObject({ message: 'MINUTE_FILE_IMMUTABLE' })
      expect(await pgError(c, `update public.minute_files set deleted_at = now() where id = $1`, [id])).toMatchObject({ message: 'MINUTE_FILE_IMMUTABLE' })
      await c.query(`update public.minute_files set deleted_at = now(), deleted_by = $2 where id = $1`, [id, F.users.member])
      expect(await pgError(c, `update public.minute_files set deleted_at = null, deleted_by = null where id = $1`, [id])).toMatchObject({ message: 'MINUTE_FILE_IMMUTABLE' })
      expect(await pgError(c, `update public.minute_files set purged_at = now(), mime = 'text/html' where id = $1`, [id])).toMatchObject({ message: 'MINUTE_FILE_IMMUTABLE' })
      await c.query('update public.minute_files set purged_at = now() where id = $1', [id])
      expect(await pgError(c, `update public.minute_files set purged_at = null where id = $1`, [id])).toMatchObject({ message: 'MINUTE_FILE_IMMUTABLE' })
      await c.query('reset role')
      await c.query('update public.minute_files set deleted_at = now(), deleted_by = $2 where id = $1', [fresh, account])
      await c.query('delete from auth.users where id = $1', [account])
      expect((await c.query('select uploaded_by, deleted_by, deleted_at is not null as deleted from public.minute_files where id = $1', [fresh])).rows[0])
        .toEqual({ uploaded_by: null, deleted_by: null, deleted: true })
    })
  })
})

async function clearRaceObjects(paths: string[]) {
  const c = await pool.connect()
  try {
    await c.query('begin')
    // 테스트가 만든 전용 객체만 정리한다. Storage 차단 해제는 이 트랜잭션 안에서만 유효하다.
    await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
    await c.query(`delete from storage.objects where bucket_id = 'minutes' and name = any($1::text[])`, [paths])
    await c.query('commit')
  } finally {
    await c.query('rollback'); c.release()
  }
}

describe('첨부 경로와 동시 확정', () => {
  it('올바른 산출물·이슈 경로는 저장되고 다른 프로젝트/엔티티 경로는 거부한다', async () => {
    await asUser(pool, F.users.member, async c => {
      for (const kind of ['deliverables', 'issue-attachments'] as const) {
        const id = kind === 'deliverables' ? F.leaf.aErp : F.rows.issue
        const good = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: kind, entityId: id, fileName: 'good.pdf' })
        const sql = kind === 'deliverables'
          ? `insert into public.deliverable_attachments (wbs_item_id, file_name, file_path) values ($1, 'good.pdf', $2)`
          : `insert into public.issue_attachments (issue_id, project_id, file_name, file_path) values ($1, '${F.projects.a}', 'good.pdf', $2)`
        expect(await pgError(c, sql, [id, good])).toBeNull()
        for (const bad of [good.replace(F.projects.a, F.projects.b), good.replace(kind, 'minute-files'), good.replace(id, M)]) {
          expect(await pgError(c, sql, [id, bad])).toMatchObject({ code: '42501', message: expect.stringContaining('row-level security') })
        }
      }
    })
  })
  it('두 독립 연결의 동시 확정은 최대 개수를 넘지 않는다', async () => {
    const paths = [path(MR, F.projects.a, 'race1.pdf'), path(MR, F.projects.a, 'race2.pdf')]
    const oldValues = (await pool.query('select values from public.project_settings where project_id = $1', [F.projects.a])).rows[0].values
    let c1: PoolClient | undefined, c2: PoolClient | undefined
    try {
      await clearRaceObjects(paths)
      await pool.query('delete from public.minutes where id = $1', [MR])
      await pool.query(`insert into public.minutes (id, workspace_id, project_id, minute_date, team_code, title, body_md, created_by)
        values ($1, $2, $3, '2026-10-04', 'ERP', '동시 첨부', '# 동시', $4)`, [MR, F.ws, F.projects.a, F.users.member])
      await pool.query(`update public.project_settings set values = values || jsonb_build_object('minutes.attachments', $2::jsonb) where project_id = $1`,
        [F.projects.a, JSON.stringify({ ...SMALL, maxCount: 1, maxTotalBytes: 100 })])
      for (const p of paths) await pool.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('minutes', $1, $2, '{"size":1,"mimetype":"application/pdf"}')`, [p, F.users.member])
      c1 = await pool.connect(); c2 = await pool.connect()
      for (const c of [c1, c2]) {
        await c.query('begin')
        await c.query('set local role authenticated')
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.member, role: 'authenticated' })])
      }
      await c1.query(INSERT, [MR, 'race1.pdf', paths[0], F.users.member])
      const pid = (await c2.query('select pg_backend_pid() as pid')).rows[0].pid
      const pending = c2.query(INSERT, [MR, 'race2.pdf', paths[1], F.users.member]).then(() => null, (e: unknown) => {
        if (e instanceof DatabaseError) return e
        throw e
      })
      // pg_stat_activity의 다른 연결 잠금은 인증 역할에 공개되지 않는다. 관찰만 DB 소유자로 한다.
      await c1.query('reset role')
      let blocked = false
      for (let n = 0; n < 100 && !blocked; n++) {
        blocked = (await c1.query(`select wait_event_type = 'Lock' as blocked from pg_stat_activity where pid = $1`, [pid])).rows[0]?.blocked === true
        if (!blocked) await new Promise(r => setTimeout(r, 20))
      }
      expect(blocked, '두 번째 확정이 첫 번째 회의록 잠금을 기다린다').toBe(true)
      await c1.query('commit')
      expect(await pending).toMatchObject({ code: '23514', message: 'MINUTE_ATTACHMENT_LIMIT' })
      await c2.query('rollback')
      expect((await c1.query('select count(*)::int as n from public.minute_files where minute_id = $1', [MR])).rows[0].n).toBe(1)
    } finally {
      await c1?.query('rollback').catch(() => undefined); await c2?.query('rollback').catch(() => undefined)
      c1?.release(); c2?.release()
      await pool.query('delete from public.minutes where id = $1', [MR])
      await pool.query('update public.project_settings set values = $2::jsonb where project_id = $1', [F.projects.a, JSON.stringify(oldValues)])
      await clearRaceObjects(paths)
    }
  })
  it('정책 변경의 잠금을 기다린 확정은 커밋된 최신 정책으로 판정한다', async () => {
    const id = '00000000-0000-0000-7e57-00000000310e'
    const object = path(id, F.projects.a, 'changed.pdf')
    const oldValues = (await pool.query('select values from public.project_settings where project_id = $1', [F.projects.a])).rows[0].values
    let writer: PoolClient | undefined, reader: PoolClient | undefined
    try {
      await clearRaceObjects([object])
      await pool.query('delete from public.minutes where id = $1', [id])
      await pool.query(`insert into public.minutes (id, workspace_id, project_id, minute_date, team_code, title, body_md, created_by)
        values ($1, $2, $3, '2026-10-04', 'ERP', '정책 변경 잠금', '# 정책', $4)`, [id, F.ws, F.projects.a, F.users.member])
      await pool.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('minutes', $1, $2, '{"size":1,"mimetype":"application/pdf"}')`, [object, F.users.member])
      writer = await pool.connect(); reader = await pool.connect()
      await writer.query('begin')
      await setPolicy(writer, { ...SMALL, enabled: false })
      await reader.query('begin')
      await reader.query('set local role authenticated')
      await reader.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: F.users.member, role: 'authenticated' })])
      const pid = (await reader.query('select pg_backend_pid() as pid')).rows[0].pid
      const pending = reader.query(INSERT, [id, 'changed.pdf', object, F.users.member]).then(() => null, (e: unknown) => {
        if (e instanceof DatabaseError) return e
        throw e
      })
      let blocked = false
      for (let n = 0; n < 100 && !blocked; n++) {
        blocked = (await writer.query(`select wait_event_type = 'Lock' as blocked from pg_stat_activity where pid = $1`, [pid])).rows[0]?.blocked === true
        if (!blocked) await new Promise(r => setTimeout(r, 20))
      }
      expect(blocked, '확정이 설정 행의 변경 잠금을 기다린다').toBe(true)
      await writer.query('commit')
      expect(await pending).toMatchObject({ code: '23514', message: 'MINUTE_ATTACHMENT_DISABLED' })
      await reader.query('rollback')
      expect((await writer.query('select count(*)::int as n from public.minute_files where minute_id = $1', [id])).rows[0].n).toBe(0)
    } finally {
      await writer?.query('rollback').catch(() => undefined); await reader?.query('rollback').catch(() => undefined)
      writer?.release(); reader?.release()
      await pool.query('delete from public.minutes where id = $1', [id])
      await pool.query('update public.project_settings set values = $2::jsonb where project_id = $1', [F.projects.a, JSON.stringify(oldValues)])
      await clearRaceObjects([object])
    }
  })

})
