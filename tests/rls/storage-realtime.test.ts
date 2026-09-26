// 0007 Storage·Realtime 정책 — pg 직결이라 storage.objects·realtime.messages 행을 직접 넣고 authenticated 세션으로 정책을 평가한다.
// realtime.messages 는 일 단위 파티션이다 — realtime 컨테이너가 떠 있어야 오늘 파티션이 있다(npm run db:start 로 전체 스택).
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { PRESENCE_TOPIC_RE, pagePresenceTopic, weeklyPresenceTopic } from '@/lib/domain/presenceTopics'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const put = (c: PoolClient, bucket: string, name: string, owner: string | null) =>
  c.query('insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', [bucket, name, owner])
const visible = async (c: PoolClient, bucket: string, name: string) =>
  (await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount
const minuteA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: F.rows.minute, fileName: 'm.md' })
const minuteNull = makeStoragePath({ workspaceId: F.ws, projectId: null, entity: 'minutes', entityId: F.rows.nullMinute, fileName: 'm.md' })
const issueA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'issue-attachments', entityId: F.rows.issue, fileName: 'a.pdf' })
const delivA = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'deliverables', entityId: F.leaf.aErp, fileName: 'd.pdf' })

describe('Storage 3버킷(0007)', () => {
  it('① minutes: A 멤버는 프로젝트·무프로젝트 객체를 보고 쓰며, B 는 0행·쓰기 거부, 교차 프로젝트·옛 형식 경로 거부', async () => {
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
      await c.query('reset role'); await put(c, 'minutes', minuteA, F.users.member)
      await c.query('set local role authenticated')
      expect(await visible(c, 'minutes', minuteA)).toBe(0)
      expect(await pgError(c, 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)', ['minutes', minuteA.replace('m.md', 'b.md'), F.users.bAdmin]))
        .toMatchObject({ code: '42501' })
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      expect((await c.query('delete from storage.objects where bucket_id = $1 and name = $2', ['minutes', minuteA])).rowCount).toBe(0)
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

describe('minute_files 첨부 정책(0007 — can_manage_minute 한 곳)', () => {
  const insertAttachment = `insert into public.minute_files (minute_id, role, file_name, file_path, size, mime, uploaded_by)
    values ($1, 'attachment', 'x.txt', 'rls/x.txt', 1, 'text/plain', $2)`
  it('⑪ 작성자·A 워크스페이스 관리자는 첨부를 넣고 지우며, 명단 없는 A 멤버·B 관리자·보관된 회의록은 거부(0006 판정 그대로)', async () => {
    for (const [uid, allowed] of [[F.users.member, true], [F.users.wsAdmin, true], [F.users.aLoose, false], [F.users.bAdmin, false]] as const) {
      await asUser(pool, uid, async (c) => {
        for (const minuteId of [F.rows.minute, F.rows.nullMinute]) {
          const err = await pgError(c, insertAttachment, [minuteId, uid])
          if (allowed) expect(err, `${uid} ${minuteId}`).toBeNull()
          else expect(err, `${uid} ${minuteId}`).toMatchObject({ code: '42501' })
        }
        const del = await c.query(`delete from public.minute_files where minute_id = $1 and role = 'attachment'`, [F.rows.minute])
        expect(del.rowCount, `${uid} 삭제`).toBe(allowed ? 2 : 0)   // 픽스처 첨부 1 + 방금 넣은 1(허용된 경우)
      })
    }
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await c.query('update public.minutes set archived_at = now() where id = $1', [F.rows.minute])
      await c.query('set local role authenticated')
      expect(await pgError(c, insertAttachment, [F.rows.minute, F.users.member])).toMatchObject({ code: '42501' })
    })
  })
})
