// *_import_wbs_custom — WBS 가져오기가 노드의 custom 객체를 싣는다(개정 스펙 §3.6.7). 예전엔 import_wbs·replace_wbs 의 INSERT 열에
// custom 이 없어 Excel 파서가 실은 값이 조용히 버려졌다. 모양·키·값 판정은 wbs_items 의 행 트리거(enforce_custom_fields) 몫이다.
// 케이스마다 begin…rollback 이다(asService).
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { F, asService, loadFixture, openPool, pgError } from './harness'
import golden from '../fixtures/parity/custom-fields-cases.json'
import type { FieldDef } from '@/lib/domain/customFields'

let pool: Pool
beforeAll(async () => { pool = openPool(); await loadFixture(pool) })
afterAll(async () => { await pool?.end() })

const P = F.projects.a
const defs = golden.defs as Record<string, FieldDef>
/** 선택 텍스트 'note' 와 필수 불리언 'done'(기본 false) */
const FIELDS = [{ ...defs.text, key: 'note', sort: 0 }, { ...defs.boolean, key: 'done', required: true, default: false, sort: 1 }]
const define = (c: PoolClient) => c.query(
  `update public.project_settings set "values" = "values" || jsonb_build_object('fields.wbs_item', $2::jsonb) where project_id = $1`,
  [P, JSON.stringify(FIELDS)])
const node = (tempId: string, o: Record<string, unknown> = {}) =>
  ({ tempId, parentTempId: null, code: `IMP-${tempId}`, sortOrder: 0, name: `가져온 ${tempId}`, owners: [], isOwnerSplit: false, ...o })
const customOf = async (c: PoolClient, code: string) =>
  (await c.query<{ custom: unknown }>('select custom from public.wbs_items where project_id = $1 and code = $2', [P, code])).rows.map((r) => r.custom)

describe.each(['import_wbs', 'replace_wbs'] as const)('%s — 노드 custom', (fn) => {
  const call = `select public.${fn}($1, $2::jsonb, '[]'::jsonb) as n`

  it('custom 객체를 그대로 싣고, 빠진 필수 키는 트리거가 기본값으로 채운다', async () => {
    await asService(pool, async (c) => {
      await define(c)
      const items = [node('a', { custom: { note: '메모', done: true } }), node('b', { custom: { note: '둘째' } }), node('c')]
      expect((await c.query<{ n: number }>(call, [P, JSON.stringify(items)])).rows[0].n).toBe(3)
      expect(await customOf(c, 'IMP-a')).toEqual([{ note: '메모', done: true }])
      expect(await customOf(c, 'IMP-b')).toEqual([{ note: '둘째', done: false }])
      expect(await customOf(c, 'IMP-c')).toEqual([{ done: false }])
    })
  })

  it('JSON null 은 없는 것으로 본다', async () => {
    await asService(pool, async (c) => {
      await define(c)
      await c.query(call, [P, JSON.stringify([node('n', { custom: null })])])
      expect(await customOf(c, 'IMP-n')).toEqual([{ done: false }])
    })
  })

  it('모르는 키·틀린 타입·객체 아닌 값은 트리거가 거부하고 아무 행도 남기지 않는다', async () => {
    await asService(pool, async (c) => {
      await define(c)
      const before = (await c.query('select count(*)::int as n from public.wbs_items where project_id = $1', [P])).rows[0].n
      const bad: Array<[unknown, string]> = [
        [{ nope: 1 }, 'CUSTOM_FIELD_UNKNOWN:nope'], [{ done: 'yes' }, 'CUSTOM_FIELD_INVALID:done'], [['note'], 'CUSTOM_FIELD_SHAPE'],
      ]
      for (const [custom, message] of bad) {
        await c.query('savepoint s')
        const e = await pgError(c, call, [P, JSON.stringify([node('ok', { custom: { note: '앞 행' } }), node('x', { custom })])])
        expect(e, JSON.stringify(custom)).toMatchObject({ message: expect.stringContaining(message) })
        await c.query('rollback to savepoint s')
        expect((await c.query('select count(*)::int as n from public.wbs_items where project_id = $1', [P])).rows[0].n).toBe(before)
      }
    })
  })
})

describe('import_wbs_cmd — 앱 경로도 custom 을 싣는다', () => {
  it.each(['append', 'replace'] as const)('%s', async (mode) => {
    await asService(pool, async (c) => {
      await define(c)
      const { rows } = await c.query<{ r: { status: string; count: number } }>(
        `select public.import_wbs_cmd($1, $2, $3, $4::jsonb, '[]'::jsonb, $5) as r`,
        [F.users.wsAdmin, P, mode, JSON.stringify([node('cmd', { custom: { note: '명령 경로' } })]), randomUUID()])
      expect(rows[0].r).toMatchObject({ status: 'applied', count: 1 })
      expect(await customOf(c, 'IMP-cmd')).toEqual([{ note: '명령 경로', done: false }])
      if (mode === 'replace') {
        expect((await c.query('select count(*)::int as n from public.wbs_items where project_id = $1', [P])).rows[0].n).toBe(1)
      }
    })
  })
})
