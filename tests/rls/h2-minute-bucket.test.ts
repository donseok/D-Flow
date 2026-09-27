// H2-g(P8-H2-2) — minutes 버킷의 첨부(minute-files) 정책을 회의록 관리 권한과 맞춘다. 삽입 = 관리 권한 ∧ 경로가 회의록 행과 일치.
// 삭제 = (관리 권한 ∧ 워크스페이스 일치) ∨ ws 관리자 ∨ (소유자 ∧ 소속 ∧ 미참조). 본문(minutes) entity 는 0007 그대로.
// 존재 확인 RPC(H1 이월)는 '없음'과 '읽을 수 없음'을 가르고, 권한 없는 호출자에게는 답하지 않는다.
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeStoragePath } from '@/lib/domain/storagePath'
import { F, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const DANA_MIN = '00000000-0000-0000-7e57-000000001250'   // 프로젝트 a, 작성자 dana(a 멤버)
const ALICE_MIN = '00000000-0000-0000-7e57-000000001251'  // 프로젝트 a, 작성자 alice — 이동 케이스용
const ROW = '00000000-0000-0000-7e57-000000001252'
const DELIV_ROW = '00000000-0000-0000-7e57-000000001253'   // 프로젝트 a 리프 aErp 의 산출물 첨부(규약 경로)
const ISSUE_ROW = '00000000-0000-0000-7e57-000000001254'   // 픽스처 이슈의 첨부(읽기 정책이 가리는 규약 경로)
const NO_PROJECT = '00000000-0000-0000-7e57-0000000012fe'  // 어느 프로젝트도 아닌 id
const ISSUE_ATT = '00000000-0000-0000-7e57-000000001112'  // fixture-ws.sql:121-122 (경로 'rls/a.txt' — 옛 형식, 범위 밖)
const DELIV_ATT = '00000000-0000-0000-7e57-000000001116'  // fixture-ws.sql:129-130 (경로 'rls/d.txt' — 옛 형식, 범위 밖)
const filePath = (minuteId: string, projectId: string | null, name = 'f.pdf') =>
  makeStoragePath({ workspaceId: F.ws, projectId, entity: 'minute-files', entityId: minuteId, fileName: name })
const put = (c: PoolClient, bucket: string, name: string, owner: string | null) =>
  c.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, '{"size": 10, "mimetype": "application/pdf"}'::jsonb)`,
    [bucket, name, owner])
async function delObject(c: PoolClient, name: string, bucket = 'minutes') {
  await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
  return (await c.query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, name])).rowCount
}
/** postgres 로 회의록(작성자 author)·객체(owner)·(참조 행)을 만들고 authenticated 로 돌아온다 */
async function arrange(c: PoolClient, o: { minuteId: string; author: string; owner: string; path: string; row?: boolean }) {
  await c.query('reset role')
  await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
    values ($1, $2, '2026-09-27', 'ERP', 'H2 버킷', '# h2', $3) on conflict (id) do nothing`, [o.minuteId, F.projects.a, o.author])
  await put(c, 'minutes', o.path, o.owner)
  if (o.row) {
    // 참조 행은 준비물이다 — claims 가 남은 세션이라 0011 ⑧ 의 첨부 가드(객체 소유자 = 세션)가 돌지 않게 트리거를 끄고 넣는다
    await c.query('set local session_replication_role = replica')
    await c.query(`insert into public.minute_files (id, minute_id, role, file_name, file_path, size, mime, uploaded_by)
      values ($1, $2, 'attachment', 'f.pdf', $3, 10, 'application/pdf', $4)`, [ROW, o.minuteId, o.path, o.owner])
    await c.query('set local session_replication_role = origin')
  }
  await c.query('set local role authenticated')
}

describe('H2-g minute-files 삭제', () => {
  it('프로젝트 관리자(alice)는 남(dana)의 첨부 객체를 지운다(정본:861) — 명단 없는 멤버(cy)·B 관리자는 0행', async () => {
    const path = filePath(DANA_MIN, F.projects.a)
    for (const [uid, expected] of [[F.users.member, 1], [F.users.aLoose, 0], [F.users.dual, 1]] as const) {
      await asUser(pool, uid, async (c) => {
        await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
        expect(await delObject(c, path), uid).toBe(expected)
      })
    }
    // B 관리자(bea)에게는 A 객체가 읽기 정책에 가려 WHERE 가 있는 DELETE 는 삭제 정책과 무관하게 0행이다 — WHERE 없는 DELETE 로
    // 삭제 정책만 태우고(아래 '떠난 소유자' 케이스와 같은 꼴) postgres 로 객체가 남았는지 본다
    await asUser(pool, F.users.bAdmin, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      await c.query('delete from storage.objects')
      await c.query('reset role')
      expect((await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', ['minutes', path])).rowCount, '객체가 남아 있다').toBe(1)
    })
  })

  it('Review Focus 1 — 회의록을 다른 프로젝트로 옮겨도(경로의 프로젝트는 옛 값) 관리 권한자는 지우고, 옛 프로젝트만의 권한자는 못 지운다', async () => {
    const path = filePath(ALICE_MIN, F.projects.a)
    for (const [uid, expected] of [[F.users.member, 1], [F.users.dual, 0]] as const) {
      await asUser(pool, uid, async (c) => {
        await arrange(c, { minuteId: ALICE_MIN, author: F.users.member, owner: F.users.dual, path, row: true })
        await c.query('reset role')
        await c.query('update public.minutes set project_id = $2 where id = $1', [ALICE_MIN, F.projects.b])   // a → b(같은 워크스페이스)
        await c.query('set local role authenticated')
        expect(await delObject(c, path), uid).toBe(expected)   // alice = 작성자 ∧ b 멤버, dana = b 명단 없음
      })
    }
  })

  it('Review Focus 4 — 보상 삭제: 관리 권한을 잃어도(보관) 소유자는 미참조 객체를 지우고, 참조된 객체는 못 지운다', async () => {
    const path = filePath(DANA_MIN, F.projects.a, 'comp.pdf')
    for (const [withRow, expected] of [[false, 1], [true, 0]] as const) {
      await asUser(pool, F.users.dual, async (c) => {
        await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: withRow })
        await c.query('reset role')
        await c.query('update public.minutes set archived_at = now() where id = $1', [DANA_MIN])
        await c.query('set local role authenticated')
        expect(await delObject(c, path), `row=${withRow}`).toBe(expected)
      })
    }
  })

  it('Review Focus 4 — 워크스페이스를 떠난 소유자는 자기 미참조 객체도 못 지운다(소유자 절의 소속 조건 — 떠난 뒤엔 참조 행이 가려진다)', async () => {
    const path = filePath(DANA_MIN, F.projects.a, 'left.pdf')
    const exists = async (c: PoolClient) =>
      (await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', ['minutes', path])).rowCount
    await asUser(pool, F.users.dual, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path })
      await c.query('reset role')
      await c.query('delete from public.workspace_members where workspace_id = $1 and user_id = $2', [F.ws, F.users.dual])
      await c.query('set local role authenticated')
      // WHERE 가 있는 DELETE 는 행을 읽어야 해서 읽기 정책("minutes bucket read" — 소속 요구)도 거친다. 떠난 사람에게는 객체가 보이지 않아
      // 삭제 정책이 무엇이든 0행이다(delObject 로는 소유자 절의 소속 조건을 가르지 못한다). WHERE 없는 DELETE 는 삭제 정책만으로 판정한다.
      expect(await exists(c), '떠난 사람에게는 객체가 보이지 않는다').toBe(0)
      await c.query(`select set_config('storage.allow_delete_query', 'true', true)`)
      await c.query('delete from storage.objects')
      await c.query('reset role')
      expect(await exists(c), '객체가 남아 있다').toBe(1)
    })
  })

  it('본문(minutes) entity 는 0007 그대로 — 프로젝트 관리자도 남의 본문 객체는 못 지운다(소유자·ws 관리자만)', async () => {
    const body = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: DANA_MIN, fileName: 'b.md' })
    await asUser(pool, F.users.member, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path: body })
      expect(await delObject(c, body)).toBe(0)
    })
    await asUser(pool, F.users.wsAdmin, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path: body })
      expect(await delObject(c, body)).toBe(1)
    })
  })
})

describe('H2-g minute-files 삽입', () => {
  const insertObj = 'insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3)'
  it('관리 권한자는 그 회의록 범위 경로에 올리고, 프로젝트 세그먼트가 다르거나(같은 워크스페이스라도) 관리 권한이 없으면 42501', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      await c.query(`insert into public.minutes (id, project_id, minute_date, team_code, title, body_md, created_by)
        values ($1, $2, '2026-09-27', 'ERP', 'H2', '#', $3)`, [DANA_MIN, F.projects.a, F.users.dual])
      await c.query('set local role authenticated')
      expect(await pgError(c, insertObj, ['minutes', filePath(DANA_MIN, F.projects.a, 'ok.pdf'), F.users.member])).toBeNull()
      expect(await pgError(c, insertObj, ['minutes', filePath(DANA_MIN, F.projects.b, 'x.pdf'), F.users.member])).toMatchObject({ code: '42501' })
      expect(await pgError(c, insertObj, ['minutes', filePath(DANA_MIN, null, 'y.pdf'), F.users.member])).toMatchObject({ code: '42501' })
    })
    await asUser(pool, F.users.aLoose, async (c) => {
      expect(await pgError(c, insertObj, ['minutes', filePath(F.rows.nullMinute, null, 'cy.pdf'), F.users.aLoose])).toMatchObject({ code: '42501' })
    })
  })
})

describe('H2-g attachment_object_exists(H1 이월)', () => {
  const EXISTS = 'select public.attachment_object_exists($1, $2) as ok'
  it("'minute': 관리 권한자에게 있음/없음을 답하고, 권한 없는 사람·B 관리자·없는 행은 ATTACHMENT_FORBIDDEN(존재를 흘리지 않는다)", async () => {
    const path = filePath(DANA_MIN, F.projects.a)
    await asUser(pool, F.users.member, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
      expect((await c.query(EXISTS, ['minute', ROW])).rows[0].ok).toBe(true)
      await c.query('reset role'); await delObject(c, path); await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['minute', ROW])).rows[0].ok).toBe(false)
      expect(await pgError(c, EXISTS, ['minute', '00000000-0000-0000-7e57-0000000012ff'])).toMatchObject({ code: '42501', message: 'ATTACHMENT_FORBIDDEN' })
      expect(await pgError(c, EXISTS, ['nope', ROW])).toMatchObject({ code: '22023', message: 'ATTACHMENT_KIND_INVALID' })
    })
    for (const uid of [F.users.aLoose, F.users.bAdmin]) {
      await asUser(pool, uid, async (c) => {
        await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path, row: true })
        expect(await pgError(c, EXISTS, ['minute', ROW]), uid).toMatchObject({ code: '42501', message: 'ATTACHMENT_FORBIDDEN' })
      })
    }
  })

  it("'issue': 세션이 읽지 못하는 객체도 그 이슈 범위 경로면 있음/없음을 답한다 — '읽을 수 없음'은 '없음'이 아니다", async () => {
    // 경로의 프로젝트 세그먼트가 어느 프로젝트도 아니면 읽기 정책(can_read_project)이 가린다 — 워크스페이스·entity·이슈 id 는 행과 같다
    const hidden = makeStoragePath({ workspaceId: F.ws, projectId: NO_PROJECT, entity: 'issue-attachments', entityId: F.rows.issue, fileName: 'h.txt' })
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role')
      await c.query(`insert into public.issue_attachments (id, issue_id, project_id, file_name, file_path) values ($1, $2, $3, 'h.txt', $4)`,
        [ISSUE_ROW, F.rows.issue, F.projects.a, hidden])
      await put(c, 'issue-attachments', hidden, F.users.member)
      await c.query('set local role authenticated')
      expect((await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', ['issue-attachments', hidden])).rowCount).toBe(0)
      expect((await c.query(EXISTS, ['issue', ISSUE_ROW])).rows[0].ok).toBe(true)
      await c.query('reset role'); await delObject(c, hidden, 'issue-attachments'); await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['issue', ISSUE_ROW])).rows[0].ok).toBe(false)
    })
  })

  it("'deliverable': can_attach 인 사람에게 그 항목 범위 경로의 있음/없음을 답한다", async () => {
    const own = makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'deliverables', entityId: F.leaf.aErp, fileName: 'd.pdf' })
    await asUser(pool, F.users.member, async (c) => {
      await c.query(`insert into public.deliverable_attachments (id, wbs_item_id, file_name, file_path) values ($1, $2, 'd.pdf', $3)`,
        [DELIV_ROW, F.leaf.aErp, own])
      expect((await c.query(EXISTS, ['deliverable', DELIV_ROW])).rows[0].ok).toBe(false)
      await c.query('reset role'); await put(c, 'deliverables', own, F.users.member); await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['deliverable', DELIV_ROW])).rows[0].ok).toBe(true)
    })
  })

  it("'minute': 다른 프로젝트로 옮긴 회의록의 첨부(경로의 프로젝트는 옛 값)도 범위 안이다 — 관리 권한자에게 답한다", async () => {
    const path = filePath(ALICE_MIN, F.projects.a)
    await asUser(pool, F.users.member, async (c) => {
      await arrange(c, { minuteId: ALICE_MIN, author: F.users.member, owner: F.users.member, path, row: true })
      await c.query('reset role')
      await c.query('update public.minutes set project_id = $2 where id = $1', [ALICE_MIN, F.projects.b])
      await c.query('set local role authenticated')
      expect((await c.query(EXISTS, ['minute', ROW])).rows[0].ok).toBe(true)
    })
  })
})

describe('H2-g attachment_object_exists — 행의 경로가 그 행의 범위일 때만 답한다(리뷰 I1)', () => {
  const EXISTS = 'select public.attachment_object_exists($1, $2) as ok'
  const FORBIDDEN = { code: '42501', message: 'ATTACHMENT_FORBIDDEN' }
  /** B 워크스페이스에 실제로 있는 객체와 없는 이름, 같은 워크스페이스의 다른 엔터티 id, 다른 entity 세그먼트 */
  const forged = (entity: 'deliverables' | 'issue-attachments', ownId: string) => {
    const foreign = makeStoragePath({ workspaceId: F.wsB, projectId: F.projects.bWs, entity, entityId: F.leaf.bWs, fileName: 'secret-plan.pdf' })
    return {
      foreign,
      paths: [
        foreign,
        foreign.replace(/[^/]+$/, 'no-such.pdf'),
        makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity, entityId: F.leaf.aDep1, fileName: 'other.pdf' }),
        makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minute-files', entityId: ownId, fileName: 'seg.pdf' }),
      ],
    }
  }

  it('산출물 — 자기 항목(can_attach)에 남의 경로를 적은 행은 객체가 있든 없든 ATTACHMENT_FORBIDDEN', async () => {
    const { foreign, paths } = forged('deliverables', F.leaf.aErp)
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, 'deliverables', foreign, F.users.bAdmin); await c.query('set local role authenticated')
      expect((await c.query('select 1 from storage.objects where bucket_id = $1 and name = $2', ['deliverables', foreign])).rowCount).toBe(0)
      for (const [i, path] of paths.entries()) {
        const rowId = `00000000-0000-0000-7e57-0000000012a${i}`
        await c.query(`insert into public.deliverable_attachments (id, wbs_item_id, file_name, file_path) values ($1, $2, 'x.pdf', $3)`,
          [rowId, F.leaf.aErp, path])   // 두 첨부 표의 insert 정책은 경로를 보지 않는다 — 경로 검사는 SP5
        expect(await pgError(c, EXISTS, ['deliverable', rowId]), path).toMatchObject(FORBIDDEN)
      }
      expect(await pgError(c, EXISTS, ['deliverable', DELIV_ATT]), '옛 형식 경로(rls/d.txt)').toMatchObject(FORBIDDEN)
    })
  })

  it('이슈 첨부 — 자기가 고칠 수 있는 이슈에 남의 경로를 적은 행은 객체가 있든 없든 ATTACHMENT_FORBIDDEN', async () => {
    const { foreign, paths } = forged('issue-attachments', F.rows.issue)
    await asUser(pool, F.users.member, async (c) => {
      await c.query('reset role'); await put(c, 'issue-attachments', foreign, F.users.bAdmin); await c.query('set local role authenticated')
      for (const [i, path] of paths.entries()) {
        const rowId = `00000000-0000-0000-7e57-0000000012b${i}`
        await c.query(`insert into public.issue_attachments (id, issue_id, project_id, file_name, file_path) values ($1, $2, $3, 'x.pdf', $4)`,
          [rowId, F.rows.issue, F.projects.a, path])
        expect(await pgError(c, EXISTS, ['issue', rowId]), path).toMatchObject(FORBIDDEN)
      }
      expect(await pgError(c, EXISTS, ['issue', ISSUE_ATT]), '옛 형식 경로(rls/a.txt)').toMatchObject(FORBIDDEN)
    })
  })

  it('회의록 첨부 — 다른 회의록·다른 워크스페이스·본문 entity 경로를 가진 행(서버 경로로 들어온 행)은 ATTACHMENT_FORBIDDEN', async () => {
    await asUser(pool, F.users.member, async (c) => {
      await arrange(c, { minuteId: DANA_MIN, author: F.users.dual, owner: F.users.dual, path: filePath(DANA_MIN, F.projects.a) })
      await c.query('reset role')
      const bad = [
        filePath(ALICE_MIN, F.projects.a, 'other-minute.pdf'),
        makeStoragePath({ workspaceId: F.wsB, projectId: null, entity: 'minute-files', entityId: DANA_MIN, fileName: 'b.pdf' }),
        makeStoragePath({ workspaceId: F.ws, projectId: F.projects.a, entity: 'minutes', entityId: DANA_MIN, fileName: 'body.pdf' }),
      ]
      // 0011 ⑧ 가드가 막는 경로라 트리거를 끄고 넣는다(service_role 이 넣은 행을 흉내 낸다)
      await c.query('set local session_replication_role = replica')
      for (const [i, path] of bad.entries()) {
        await put(c, 'minutes', path, F.users.member)
        await c.query(`insert into public.minute_files (id, minute_id, role, file_name, file_path, size, mime, uploaded_by)
          values ($1, $2, 'attachment', 'f.pdf', $3, 10, 'application/pdf', $4)`, [`00000000-0000-0000-7e57-0000000012c${i}`, DANA_MIN, path, F.users.member])
      }
      await c.query('set local session_replication_role = origin')
      await c.query('set local role authenticated')
      for (const [i, path] of bad.entries()) {
        expect(await pgError(c, EXISTS, ['minute', `00000000-0000-0000-7e57-0000000012c${i}`]), path).toMatchObject(FORBIDDEN)
      }
    })
  })
})
