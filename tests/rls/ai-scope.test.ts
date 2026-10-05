// SP8: AI·위키·챗봇·사용현황 워크스페이스 스코프 RLS 검증
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, asUser, loadFixture, openPool, pgError } from './harness'

let pool: Pool
beforeAll(async () => {
  pool = openPool()
  await loadFixture(pool)
})
afterAll(async () => {
  await pool?.end()
})

const DIM = 768
const vec = (...head: number[]) => `[${[...head, ...Array(DIM - head.length).fill(0)].join(',')}]`
const Q = vec(1)
const V_A = vec(0.9, 0.1)
const V_B = vec(0.95, 0.05)

describe('ai_documents 워크스페이스 스코프 격리 (SP8)', () => {
  async function seedAiDocs(c: PoolClient) {
    await c.query('reset role')
    await c.query('set local session_replication_role = replica')
    await c.query('delete from public.ai_documents')

    // 워크스페이스 A 문서
    await c.query(`
      insert into public.ai_documents (
        id, workspace_id, project_id, domain, entity_type, entity_id, chunk_no,
        title, content, content_hash, href, embedding_model, chunker_version, embedding
      ) values (
        '00000000-0000-0000-7e57-00000000a101'::uuid, $1::uuid, $2::uuid, 'wbs', 'wbs_item', 'wbs-1', 0,
        'A 문서 WBS', 'A 워크스페이스 내용 검색어', 'hash-a', '/p/a/wbs', 'model-1', 'v1', $3::public.vector
      )
    `, [F.ws, F.projects.a, V_A])

    // 워크스페이스 B 문서 (더 높은 유사도)
    await c.query(`
      insert into public.ai_documents (
        id, workspace_id, project_id, domain, entity_type, entity_id, chunk_no,
        title, content, content_hash, href, embedding_model, chunker_version, embedding
      ) values (
        '00000000-0000-0000-7e57-00000000b101'::uuid, $1::uuid, $2::uuid, 'wbs', 'wbs_item', 'wbs-2', 0,
        'B 문서 WBS', 'B 워크스페이스 내용 검색어', 'hash-b', '/p/b/wbs', 'model-1', 'v1', $3::public.vector
      )
    `, [F.wsB, F.projects.bWs, V_B])

    await c.query('set local session_replication_role = origin')
    await c.query('set local role authenticated')
  }

  it('RLS: A 계정은 A 워크스페이스 문서만 읽을 수 있고 B 문서는 보이지 않는다', async () => {
    await asUser(pool, F.users.aLoose, async (c) => {
      await seedAiDocs(c)
      const res = await c.query('select id, title from public.ai_documents')
      expect(res.rows.map((r) => r.id)).toEqual(['00000000-0000-0000-7e57-00000000a101'])
    })
  })

  it('match_ai_documents: p_workspace_id로 특정 워크스페이스만 검색된다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      await seedAiDocs(c)
      // dual 사용자는 둘 다 볼 수 있으나, p_workspace_id = ws 면 A 문서만 반환
      const resA = await c.query(`
        select id from public.match_ai_documents($1::public.vector, 10, p_workspace_id => $2)
      `, [Q, F.ws])
      expect(resA.rows.map((r) => r.id)).toEqual(['00000000-0000-0000-7e57-00000000a101'])

      // p_workspace_id = wsB 면 B 문서만 반환
      const resB = await c.query(`
        select id from public.match_ai_documents($1::public.vector, 10, p_workspace_id => $2)
      `, [Q, F.wsB])
      expect(resB.rows.map((r) => r.id)).toEqual(['00000000-0000-0000-7e57-00000000b101'])
    })
  })

  it('match_ai_documents: 타 워크스페이스 p_workspace_id를 넘겨도 RLS에 의해 0건', async () => {
    // aLoose는 A에만 속함 — wsB를 넘겨도 0건
    await asUser(pool, F.users.aLoose, async (c) => {
      await seedAiDocs(c)
      const res = await c.query(`
        select id from public.match_ai_documents($1::public.vector, 10, p_workspace_id => $2)
      `, [Q, F.wsB])
      expect(res.rows).toEqual([])
    })
  })

  it('match_ai_documents_lexical: p_workspace_id로 텍스트 검색 범위가 한정된다', async () => {
    await asUser(pool, F.users.dual, async (c) => {
      await seedAiDocs(c)
      const res = await c.query(`
        select id from public.match_ai_documents_lexical(array['검색어'], 10, p_workspace_id => $1)
      `, [F.ws])
      expect(res.rows.map((r) => r.id)).toEqual(['00000000-0000-0000-7e57-00000000a101'])
    })
  })

  it('replace_ai_document_chunks: workspace_id가 기록되고 project_scope가 자동 생성된다', async () => {
    await asService(pool, async (c) => {
      const chunks = [
        {
          chunk_no: 0,
          title: '새 청크',
          content: '내용입니다',
          content_hash: 'hash-new',
          href: '/p/a/wbs',
          team: null,
          occurred_on: null,
          source_updated_at: new Date().toISOString(),
          embedding_model: 'model-1',
          embedding_dimensions: 768,
          chunker_version: 'v1',
          embedding: null,
        },
      ]
      const res = await c.query(`
        select public.replace_ai_document_chunks(
          p_project_id => $1,
          p_domain => 'wbs',
          p_entity_type => 'wbs_item',
          p_entity_id => 'test-item-1',
          p_index_version => 1,
          p_source_updated_at => now(),
          p_indexed_at => now(),
          p_documents => $2::jsonb,
          p_workspace_id => $3
        ) as count
      `, [F.projects.a, JSON.stringify(chunks), F.ws])
      expect(res.rows[0].count).toBe(1)

      const doc = (await c.query(`
        select workspace_id, project_scope from public.ai_documents where entity_id = 'test-item-1'
      `)).rows[0]
      expect(doc.workspace_id).toBe(F.ws)
      expect(doc.project_scope).toBe(F.projects.a)
    })
  })
})

describe('usage_events 워크스페이스 스코프 격리 (SP8)', () => {
  it('사용현황 RPC가 p_workspace_id로 특정 워크스페이스 이벤트만 집계한다', async () => {
    await asService(pool, async (c) => {
      await c.query('delete from public.usage_events')
      await c.query(`
        insert into public.usage_events (id, workspace_id, user_id, menu_key, path, occurred_at) values
          (8001, $1, $3, 'wbs', '/w/a/wbs', '2026-10-05T10:00:00Z'),
          (8002, $2, $3, 'wbs', '/w/b/wbs', '2026-10-05T10:00:00Z')
      `, [F.ws, F.wsB, F.users.platform])

      // 워크스페이스 A 집계
      const sumA = await c.query(`
        select total_events from public.usage_summary('2026-10-05', '2026-10-05', '2026-10-05', 'UTC', p_workspace_id => $1)
      `, [F.ws])
      expect(Number(sumA.rows[0].total_events)).toBe(1)

      // 워크스페이스 B 집계
      const sumB = await c.query(`
        select total_events from public.usage_summary('2026-10-05', '2026-10-05', '2026-10-05', 'UTC', p_workspace_id => $1)
      `, [F.wsB])
      expect(Number(sumB.rows[0].total_events)).toBe(1)

      // 전체 집계 (p_workspace_id = null)
      const sumAll = await c.query(`
        select total_events from public.usage_summary('2026-10-05', '2026-10-05', '2026-10-05', 'UTC', p_workspace_id => null)
      `)
      expect(Number(sumAll.rows[0].total_events)).toBe(2)
    })
  })
})
