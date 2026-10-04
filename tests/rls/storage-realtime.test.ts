// 0007 Storage·Realtime 정책 — pg 직결이라 storage.objects·realtime.messages 행을 직접 넣고 authenticated 세션으로 정책을 평가한다.
// realtime.messages 는 일 단위 파티션이다 — realtime 컨테이너가 떠 있어야 오늘 파티션이 있다(npm run db:start 로 전체 스택).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { makeBrandingPath, parseBrandingPath } from '@/lib/settings/brandingPath'
import { PRESENCE_TOPIC_RE, pagePresenceTopic, weeklyPresenceTopic } from '@/lib/domain/presenceTopics'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const put = (c: PoolClient, bucket: string, name: string, owner: string | null) =>
  c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{"size": 1, "mimetype": "text/plain"}'::jsonb)`,
    [bucket, name, owner])
const visible = async (c: PoolClient, bucket: string, name: string) =>
  (await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount
const minuteA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: F.rows.minute, fileName: 'm.md' })
const minuteNull = makeStoragePath({ workspaceId: F.ws, projectId: null, entity: 'minutes', entityId: F.rows.nullMinute, fileName: 'm.md' })
const issueA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'issue-attachments', entityId: F.rows.issue, fileName: 'a.pdf' })
const delivA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'deliverables', entityId: F.leaf.aErp, fileName: 'd.pdf' })
/** 세션이 보는 A 의 회의록 객체 수 — 프로젝트 경로(minuteA)와 프로젝트 없는('_') 경로(minuteNull) 따로 */
const bSeesMinuteObjects = async (c: PoolClient) =>
  ({ project: await visible(c, 'minutes', minuteA), noProject: await visible(c, 'minutes', minuteNull) })

describe('Storage 3버킷(0007)', () => {
  it('① minutes: A 멤버는 프로젝트·무프로젝트 객체를 보고 쓰며, B 는 두 경로 모두 0행·쓰기·삭제 거부, 교차 프로젝트·옛 형식 경로 거부', async () => {
    // 픽스처 행은 트랜잭션마다 service 로 넣는다(롤백으로 사라진다)
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, 'minutes', minuteA, F.users.member); await put(c, 'minutes', minuteNull, F.users.member)
      await c.query('set local role authenticated')
      expect(await visible(c, 'minutes', minuteA)).toBe(1)
      expect(await visible(c, 'minutes', minuteNull)).toBe(1)
      const fresh = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: F.rows.minute, fileName: 'n.md' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', fresh, F.users.member])).toBeNull()
      const crossProject = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.bWs, entity: 'minutes', entityId: F.rows.minute, fileName: 'x.md' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', crossProject, F.users.member]))
        .toMatchObject({ code: '42501' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', `${F.rows.minute}/old.md`, F.users.member]))
        .toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role'); await put(c, 'minutes', minuteA, F.users.member); await put(c, 'minutes', minuteNull, F.users.member)
      await c.query('set local role authenticated')
      expect(await bSeesMinuteObjects(c)).toEqual({ project: 0, noProject: 0 })
      // 프로젝트 없는('_') 경로는 is_ws_member 가 유일한 워크스페이스 경계다 — 프로젝트 경로만 보면 can_read_project 가 대신 막아 준다
      for (const name of [minuteA.replace('m.md', 'b.md'), minuteNull.replace('m.md', 'b.md')]) {
        expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', name, F.users.bAdmin]), name)
          .toMatchObject({ code: '42501' })
      }
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      expect((await c.query('delete from storage.objects where bucket_id = $1 and name = any($2::text[])', ['minutes', [minuteA, minuteNull]])).rowCount).toBe(0)
    })
  })
  it('①′ 민감도 — minutes bucket read 에서 is_ws_member 를 빼면 B 가 A 의 무프로젝트 객체를 본다(① 이 빨개진다)', async () => {
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role'); await put(c, 'minutes', minuteA, F.users.member); await put(c, 'minutes', minuteNull, F.users.member)
      await c.query('drop policy "minutes bucket read" on storage.objects')
      await c.query(`create policy "minutes bucket read" on storage.objects for select to authenticated using (
        bucket_id = 'minutes' and public.storage_ws(name) is not null
        and (public.storage_project(name) is null or public.can_read_project(public.storage_project(name))))`)
      await c.query('set local role authenticated')
      expect(await bSeesMinuteObjects(c)).toEqual({ project: 0, noProject: 1 })
    })
  })
  const insertObj = 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)'
  it.each([
    ['② issue-attachments', 'issue-attachments', issueA],
    ['③ deliverables', 'deliverables', delivA],
  ])('%s: A 관리자(alice)는 읽고 쓰며, B 는 0행·쓰기 거부, 이웃 경로(다른 엔터티 id)도 거부', async (_label, bucket, name) => {
    const second = name.replace(/\/[^/]+$/, '/second.bin')
    const foreignEntity = name.replace(/\/([0-9a-f-]{36})\/([^/]+)$/, `/${F.rows.meeting}/$2`)   // 존재하지만 다른 종류의 id
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, bucket, name, F.users.member); await c.query('set local role authenticated')
      expect(await visible(c, bucket, name)).toBe(1)
      expect(await pgError(c, insertObj, [bucket, second, F.users.member])).toBeNull()
      expect(await pgError(c, insertObj, [bucket, foreignEntity, F.users.member])).toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role'); await put(c, bucket, name, F.users.member); await c.query('set local role authenticated')
      expect(await visible(c, bucket, name)).toBe(0)
      expect(await pgError(c, insertObj, [bucket, second, F.users.bAdmin])).toMatchObject({ code: '42501' })
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      expect((await c.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount).toBe(0)
    })
  })
  it('④ 형식이 틀린 객체 이름이 섞여도 목록 조회가 22P02 로 깨지지 않고, 그 이름은 A 멤버에게도 안 보인다(Review Focus 1)', async () => {
    // 마지막 둘은 ws/<A>/… 로 시작하지만 프로젝트 세그먼트가 '_'·uuid 가 아니다 — '_' 로 읽혀 워크스페이스 전원에게 열리면 안 된다
    const malformed = ['garbage', `ws/not-a-uuid/p/_/minutes/${F.rows.minute}/f`, `${F.rows.issue}/legacy.pdf`,
      `ws/${F.ws}/p/zz/minutes/x/f`, `ws/${F.ws}/p/zz/minutes/${F.rows.minute}/f`]
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      for (const b of ['minutes', 'issue-attachments', 'deliverables']) {
        for (const n of malformed) await put(c, b, n, null)
      }
      await c.query('set local role authenticated')
      for (const b of ['minutes', 'issue-attachments', 'deliverables']) {
        const err = await pgError(c, 'select name from storage.objects where bucket_id = $1', [b])
        expect(err, `${b} 목록 조회`).toBeNull()
        const { rows } = await c.query<{ name: string }>('select name from storage.objects where bucket_id = $1', [b])
        expect(rows.map((r) => r.name).filter((n) => malformed.includes(n)), `${b} 에서 보인 형식 틀린 이름`).toEqual([])
      }
    })
  })
})

describe('Realtime presence(0007)', () => {
  const pageA = pagePresenceTopic(F.projects.a, 'wbs')
  const weeklyA = weeklyPresenceTopic(F.projects.a, F.rows.weeklyReport)
  const asTopic = (c: PoolClient, topic: string) => c.query(`select set_config('realtime.topic', $1, true)`, [topic])
  const join = async (c: PoolClient, topic: string) => {
    await asTopic(c, topic)
    return (await c.query(`select 1 from realtime.messages where topic = $1 and extension = 'presence'`, [topic])).rowCount
  }
  const track = async (c: PoolClient, topic: string) => {
    await asTopic(c, topic)
    return pgError(c, `insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [topic])
  }
  it('⑤ A 멤버·두 워크스페이스 사용자는 A presence 를 보고 track 한다', async () => {
    for (const uid of [F.users.member, F.users.aLoose, F.users.dual]) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        for (const t of [pageA, weeklyA]) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [t])
        await c.query('set local role authenticated')
        for (const t of [pageA, weeklyA]) { expect(await join(c, t)).toBe(1); expect(await track(c, t)).toBeNull() }
      })
    }
  })
  it('⑥ B 계정은 A pid 토픽을 0행·42501, 형식이 틀린 토픽도 오류 없이 거부(Review Focus 2)', async () => {
    const bad = [`project-not-a-uuid-presence-wbs`, `project-${F.projects.a}-presence-WBS`, `project-${F.projects.a}-presence-`]
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role')
      for (const t of [pageA, weeklyA, ...bad]) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [t])
      await c.query('set local role authenticated')
      for (const t of [pageA, weeklyA, ...bad]) {
        expect(await join(c, t), t).toBe(0)
        expect(await track(c, t), t).toMatchObject({ code: '42501' })
      }
    })
    // 형식이 틀린 토픽은 A 멤버에게도 0행·42501(정규식 불일치 → pid null)이지 오류가 아니다
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      for (const t of bad) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'presence', 'presence', '{}', true)`, [t])
      await c.query('set local role authenticated')
      for (const t of bad) {
        expect(await join(c, t), t).toBe(0)
        expect(await track(c, t), t).toMatchObject({ code: '42501' })
      }
    })
  })
  it('⑦ broadcast(WBS 변경, SP1 정책)도 B 계정에 0행 — done_when 의 broadcast 토픽', async () => {
    const wbsA = `project-${F.projects.a}-wbs`
    for (const [uid, expected] of [[F.users.member, 1], [F.users.bAdmin, 0]] as const) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'wbs_changed', '{}', true)`, [wbsA])
        await c.query('set local role authenticated')
        await asTopic(c, wbsA)
        expect((await c.query(`select 1 from realtime.messages where topic = $1 and extension = 'broadcast'`, [wbsA])).rowCount).toBe(expected)
      })
    }
  })
  it('⑦b presence 토픽 join(broadcast read, join_project_presence): A 멤버 허용·B 계정 0행·형식 틀린 토픽은 오류 없이 0행', async () => {
    // Realtime 은 private join 을 extension='broadcast' read 로 판정한다 — presence read 만으로는 멤버도 CHANNEL_ERROR 였다
    const bad = [`project-not-a-uuid-presence-wbs`, `project-${F.projects.a}-presence-WBS`, `project-${F.projects.a}-presence-`]
    const joinB = async (c: PoolClient, topic: string) => {
      await asTopic(c, topic)
      return (await c.query(`select 1 from realtime.messages where topic = $1 and extension = 'broadcast'`, [topic])).rowCount
    }
    for (const [uid, expected] of [[F.users.member, 1], [F.users.dual, 1], [F.users.bAdmin, 0]] as const) {
      await asUser(pool, uid, async (c) => {
        await c.query('reset role')
        for (const t of [pageA, weeklyA, ...bad]) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'presence', '{}', true)`, [t])
        await c.query('set local role authenticated')
        for (const t of [pageA, weeklyA]) expect(await joinB(c, t), `${uid} ${t}`).toBe(expected)
        for (const t of bad) expect(await joinB(c, t), `${uid} ${t}`).toBe(0)
      })
    }
  })
  it('⑦c join_project_presence 는 presence 토픽에만 — WBS·알림 broadcast 토픽을 넓히지 않고 broadcast 송신(insert)도 주지 않는다', async () => {
    const wbsB = `project-${F.projects.bWs}-wbs`
    const notifB = `user-${F.users.bAdmin}-notifications`
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      for (const t of [wbsB, notifB]) await c.query(`insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'x', '{}', true)`, [t])
      await c.query('set local role authenticated')
      for (const t of [wbsB, notifB]) {
        await asTopic(c, t)
        expect((await c.query(`select 1 from realtime.messages where topic = $1 and extension = 'broadcast'`, [t])).rowCount, t).toBe(0)
      }
      await asTopic(c, pageA)
      expect(await pgError(c, `insert into realtime.messages (topic, extension, event, payload, private) values ($1, 'broadcast', 'x', '{}', true)`, [pageA]))
        .toMatchObject({ code: '42501' })
    })
  })
  it('⑧ SQL presence_topic_project 와 TS PRESENCE_TOPIC_RE 가 같은 정규식이고 같은 토픽에 같은 pid 를 낸다', async () => {
    const samples = [
      pageA, weeklyA, pagePresenceTopic(F.projects.bWs, 'a-b-9'), `project-${F.projects.a}-presence-${'x'.repeat(40)}`,
      `project-${F.projects.a}-presence-${'x'.repeat(41)}`, `project-${F.projects.a}-presence-`, `project-${F.projects.a}-presence-WBS`,
      `project-${F.projects.a.toUpperCase()}-presence-wbs`, `project-not-a-uuid-presence-wbs`, `project-${F.projects.a}-wbs`,
      `project-${F.projects.a}-weekly-${F.rows.weeklyReport}-presence`, `project-${F.projects.a}-weekly-nope-presence`,
      `xproject-${F.projects.a}-presence-wbs`, `${pageA}\n`, `user-${F.users.member}-notifications`, '',
    ]
    const { src, got } = await asService(pool, async (c) => ({
      src: (await c.query<{ src: string }>(`select prosrc as src from pg_proc where oid = 'public.presence_topic_project(text)'::regprocedure`)).rows[0].src,
      got: (await c.query<{ pid: string | null }>(`select public.presence_topic_project(t)::text as pid from unnest($1::text[]) with ordinality as s(t, i) order by i`, [samples])).rows.map((r) => r.pid),
    }))
    expect(src.match(/from '([^']+)'/)?.[1], 'SQL 정규식 원문').toBe(PRESENCE_TOPIC_RE.source)
    expect(got).toEqual(samples.map((t) => PRESENCE_TOPIC_RE.exec(t)?.[1] ?? null))
    expect(got.filter((p) => p !== null).length, '양성 표본이 있어야 비교가 의미 있다').toBeGreaterThanOrEqual(4)
  })
})

describe('회의록 RPC 파일 경로(0007 — ws/ 규약)', () => {
  const MINUTE_BODY_RPC = `select * from public.commit_minute_body_version($1, $2, public.wiki_fnv1a64($2), $3, $4, 10, 'text/markdown', $5, 'alice')`
  const CREATE_RPC = `select * from public.create_minute_with_version($1, '2026-09-03', 'ERP', 'T', '# t', public.wiki_fnv1a64('# t'),
    null, $2, null, null, null, $3, 'alice', 'b.md', $4, 10, 'text/markdown', $5)`
  const newId = '00000000-0000-0000-7e57-00000000113a'
  const fileInvalid = { code: '22023', message: 'MINUTE_FILE_INPUT_INVALID' }
  it('⑨ commit_minute_body_version(본문 교체): 회의록의 ws·프로젝트(또는 _) 경로만 받고 옛 <id>/ 형식·다른 스코프는 거부', async () => {
    await asService(pool, async (c) => {
      const pathA = (projectId: string | null, minuteId: string, ws: string = F.ws) =>
        makeStoragePath({ workspaceId: ws, projectId, entity: 'minutes', entityId: minuteId, fileName: 'v2.md' })
      for (const [minuteId, bad] of [
        [F.rows.minute, `${F.rows.minute}/v2.md`], [F.rows.minute, pathA(null, F.rows.minute)],
        [F.rows.minute, pathA(F.projects.a, F.rows.minute, F.wsB)], [F.rows.minute, pathA(F.projects.a, F.rows.nullMinute)],
        [F.rows.nullMinute, pathA(F.projects.a, F.rows.nullMinute)],
        [F.rows.minute, pathA(F.projects.a, F.rows.minute).replace('/minutes/', '/minute-files/')],
      ] as const) {
        expect(await pgError(c, MINUTE_BODY_RPC, [minuteId, '# v2', 'v2.md', bad, F.users.member]), bad).toMatchObject(fileInvalid)
      }
      expect(await pgError(c, MINUTE_BODY_RPC, [F.rows.minute, '# v2', 'v2.md', pathA(F.projects.a, F.rows.minute), F.users.member])).toBeNull()
      expect(await pgError(c, MINUTE_BODY_RPC, [F.rows.nullMinute, '# v2', 'v2.md', pathA(null, F.rows.nullMinute), F.users.member])).toBeNull()
      const { rows } = await c.query<{ file_path: string }>(`select file_path from public.minute_files where minute_id = $1 and role = 'body'`, [F.rows.minute])
      expect(rows.map((r) => r.file_path)).toEqual([pathA(F.projects.a, F.rows.minute)])
    })
  })
  it('⑩ create_minute_with_version(생성): 확정된 워크스페이스·프로젝트의 경로만 받는다', async () => {
    await asService(pool, async (c) => {
      const path = (ws: string, projectId: string | null) =>
        makeStoragePath({ workspaceId: ws, projectId, entity: 'minutes', entityId: newId, fileName: 'b.md' })
      for (const [projectId, bad, ws] of [
        [F.projects.a, `${newId}/b.md`, null], [F.projects.a, path(F.wsB, F.projects.a), null], [F.projects.a, path(F.ws, null), null],
        [null, path(F.ws, F.projects.a), F.ws], [null, path(F.wsB, null), F.ws],
      ] as const) {
        expect(await pgError(c, CREATE_RPC, [newId, projectId, F.users.member, bad, ws]), bad).toMatchObject(fileInvalid)
      }
      expect(await pgError(c, CREATE_RPC, [newId, F.projects.a, F.users.member, path(F.ws, F.projects.a), null])).toBeNull()
      const other = '00000000-0000-0000-7e57-00000000113b'
      expect(await pgError(c, CREATE_RPC, [other, null, F.users.member,
        makeStoragePath({ workspaceId: F.ws, projectId: null, entity: 'minutes', entityId: other, fileName: 'b.md' }), F.ws])).toBeNull()
    })
  })
})

describe('minute_files 첨부 정책(0007 can_manage_minute · 0011 가드 — 객체를 먼저 올린다)', () => {
  const insertAttachment = `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by)
    values ($1, 'attachment', 'x.txt', $2, 1, 'text/plain', $3)`
  const pathFor = (minuteId: string, projectId: string | null, uid: string) =>
    makeStoragePath({ workspaceId: F.ws, projectId, entity: 'minute-files', entityId: minuteId, fileName: `rls-${uid.slice(-2)}.txt` })
  it('⑪ 작성자·A 워크스페이스 관리자는 첨부를 넣지만 세션 DELETE는 모두 닫히며, 명단 없는 A 멤버·B 관리자·보관된 회의록은 거부', async () => {
    for (const [uid, allowed] of [[F.users.member, true], [F.users.wsAdmin, true], [F.users.aLoose, false], [F.users.bAdmin, false]] as const) {
      await asUser(pool, uid, async (c) => {
        for (const [minuteId, projectId] of [[F.rows.minute, F.projects.a], [F.rows.nullMinute, null]] as const) {
          const path = pathFor(minuteId, projectId, uid)
          await c.query('reset role'); await put(c, 'minutes', path, uid); await c.query('set local role authenticated')
          const err = await pgError(c, insertAttachment, [minuteId, path, uid])
          if (allowed) expect(err, `${uid} ${minuteId}`).toBeNull()
          else expect(err, `${uid} ${minuteId}`).toMatchObject({ code: '42501' })
        }
        expect(await pgError(c, `delete from public.minute_files where minute_id = $1 and role = 'attachment'`, [F.rows.minute]))
          .toMatchObject({ code: '42501', message: expect.stringContaining('permission denied') }) // B3 톰스톤은 가드 뒤 service_role 한 길
      })
    }
    await asUser(pool, F.users.member, async (c) => {
      const path = pathFor(F.rows.minute, F.projects.a, 'archived')
      await c.query('reset role'); await put(c, 'minutes', path, F.users.member)
      await c.query('update public.minutes set archived_at = now() where id = $1', [F.rows.minute])
      await c.query('set local role authenticated')
      expect(await pgError(c, insertAttachment, [F.rows.minute, path, F.users.member])).toMatchObject({ code: '42501' })
    })
  })
})

describe('Storage 쓰기 — 명단 권한 분기(0007)', () => {
  it('⑫ 명단 권한 없는 A 워크스페이스 멤버(cy)는 프로젝트 a 경로에 세 버킷 모두 쓰지 못한다(42501)', async () => {
    const paths: Array<[string, string]> = [
      ['minutes', makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: F.rows.minute, fileName: 'cy.md' })],
      ['minutes', makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minute-files', entityId: F.rows.minute, fileName: 'cy.txt' })],
      ['issue-attachments', issueA.replace(/[^/]+$/, 'cy.pdf')],
      ['deliverables', delivA.replace(/[^/]+$/, 'cy.pdf')],
    ]
    await asUser(pool, F.users.aLoose, async (c) => {
      for (const [bucket, name] of paths) {
        expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, name, F.users.aLoose]), name)
          .toMatchObject({ code: '42501' })
      }
      // 양성 대조: 같은 사람이 무프로젝트('_') 경로에는 쓸 수 있다 — 거부가 워크스페이스 판정이 아니라 명단 분기에서 온다
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', minuteNull.replace(/[^/]+$/, 'cy.md'), F.users.aLoose])).toBeNull()
    })
  })
})

describe('branding 버킷(0012 ⑪)', () => {
  const HASH = '0123456789abcdef'
  const logoA = makeBrandingPath({ workspaceId: F.ws, slot: 'mark', hash: HASH, ext: 'png' })
  const logoB = makeBrandingPath({ workspaceId: F.wsB, slot: 'full', hash: HASH, ext: 'webp' })
  /** [표본, 왜] — 정상 하나와 틀린 모양 여섯. 전부 A 워크스페이스 id 를 쓰거나 아예 uuid 가 아니다 */
  const SAMPLES: Array<[string, string]> = [
    [logoA, '정상'],
    [`ws/${F.ws}/branding/extra/mark-${HASH}.png`, '조각 수 5'],
    [`ws/${F.ws}/branding/mark-${HASH}.svg`, '확장자 svg'],
    [`ws/not-a-uuid/branding/mark-${HASH}.png`, 'uuid 아님'],
    [`ws/${F.ws}/branding/logo-${HASH}.png`, 'slot 틀림'],
    [`ws/${F.ws}/branding/mark-${HASH.toUpperCase()}.png`, '요약이 대문자'],
    [`ws/${F.ws.toUpperCase()}/branding/mark-${HASH}.png`, 'uuid 가 대문자'],
    [`p/${F.ws}/branding/mark-${HASH}.png`, '첫 조각이 ws 가 아님'],
    [`ws/${F.ws}/logo/mark-${HASH}.png`, '셋째 조각이 branding 이 아님'],
  ]

  it('버킷은 비공개이고 256KB·png·jpg·webp 만 받는다', async () => {
    const { rows } = await pool.query(
      `select public, file_size_limit::int as max, allowed_mime_types as mime from storage.buckets where id = 'branding'`)
    expect(rows).toEqual([{ public: false, max: 262144, mime: ['image/png', 'image/jpeg', 'image/webp'] }])
  })

  it('⑬ A 멤버는 A 의 로고를 읽고 B 계정은 0행이다. 세션은 관리자여도 쓰지도 지우지도 못한다', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await c.query('reset role'); await put(c, 'branding', logoA, null); await put(c, 'branding', logoB, null)
      await c.query('set local role authenticated')
      expect(await visible(c, 'branding', logoA)).toBe(1)
      expect(await visible(c, 'branding', logoB)).toBe(0)
    })
    await asUser(pool, F.users.bAdmin, async (c) => {
      await c.query('reset role'); await put(c, 'branding', logoA, null); await put(c, 'branding', logoB, null)
      await c.query('set local role authenticated')
      expect(await visible(c, 'branding', logoA)).toBe(0)
      expect(await visible(c, 'branding', logoB)).toBe(1)
    })
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await c.query('reset role'); await put(c, 'branding', logoA, null); await c.query('set local role authenticated')
      const fresh = makeBrandingPath({ workspaceId: F.ws, slot: 'full', hash: 'fedcba9876543210', ext: 'jpg' })
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['branding', fresh, F.users.wsAdmin]))
        .toMatchObject({ code: '42501' })
      expect((await c.query(`update storage.objects set name = $2 where bucket_id = 'branding' and name = $1`, [logoA, fresh])).rowCount).toBe(0)
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      expect((await c.query(`delete from storage.objects where bucket_id = 'branding' and name = $1`, [logoA])).rowCount).toBe(0)
    })
  })

  it('⑭ 다른 버킷에 브랜딩 모양 이름으로 둔 객체는 이 정책으로 열리지 않는다(bucket_id 검사)', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await c.query('reset role'); await put(c, 'deliverables', logoA, null); await put(c, 'minutes', logoA, null)
      await put(c, 'branding', logoA, null)
      await c.query('set local role authenticated')
      expect(await visible(c, 'deliverables', logoA)).toBe(0)
      expect(await visible(c, 'minutes', logoA)).toBe(0)
      // 양성 대조: 같은 이름·같은 세션이 branding 버킷에서는 보인다 — 위의 0 이 이름이 아니라 버킷에서 온다(⑪ 이 없으면 여기서 FAIL)
      expect(await visible(c, 'branding', logoA)).toBe(1)
    })
  })

  it('⑮ 둘째 조각이 uuid 가 아닌 객체가 있어도 목록 조회가 22P02 로 깨지지 않는다', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await c.query('reset role')
      for (const [name] of SAMPLES) await put(c, 'branding', name, null)
      await c.query('set local role authenticated')
      expect(await pgError(c, `select name from storage.objects where bucket_id = 'branding'`)).toBeNull()
    })
  })

  it('⑯ 정책의 경로 판정 = TS parseBrandingPath — 같은 표본에 같은 답', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await c.query('reset role')
      for (const [name] of SAMPLES) await put(c, 'branding', name, null)
      await c.query('set local role authenticated')
      for (const [name, why] of SAMPLES) {
        const parsed = parseBrandingPath(name)
        const ts = parsed.ok && parsed.value.workspaceId === F.ws
        expect((await visible(c, 'branding', name)) === 1, `${why}: ${name}`).toBe(ts)
      }
      expect(SAMPLES.filter(([name]) => parseBrandingPath(name).ok).map(([, why]) => why)).toEqual(['정상'])
    })
  })
})
