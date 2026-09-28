// 모든 설정 행을 레지스트리로 읽어 invalid·required_missing 키를 나열한다(스펙 §3.2 끝). 하나라도 있으면 실패(= 종료 코드 1).
// 해석기(projectConfig.ts)는 next/headers 를 물고 있어 여기서는 resolveKeys 를 직접 쓴다 — 같은 함수다.
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { openPool } from '../tests/rls/harness'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'

let pool: Pool
beforeAll(() => { pool = openPool() })
afterAll(async () => { await pool?.end() })

it('settings:verify — 모든 설정 행이 레지스트리 parse 를 통과하고 필수 키가 있다', async () => {
  const problems: string[] = []
  const projects = await pool.query<{ project_id: string; values: Record<string, unknown> }>('select project_id, "values" from public.project_settings')
  for (const r of projects.rows) {
    const { keys, unknownKeys } = resolveKeys({ scope: 'project', id: r.project_id, values: r.values, defs: PROJECT_SETTINGS })
    for (const [k, s] of Object.entries(keys)) if (s.status === 'invalid' || s.status === 'required_missing') problems.push(`project ${r.project_id} ${k}: ${s.status}${'error' in s ? ` — ${s.error}` : ''}`)
    if (unknownKeys.length) console.warn(`project ${r.project_id} 미등록 키(무시됨): ${unknownKeys.join(', ')}`)
  }
  const workspaces = await pool.query<{ workspace_id: string; values: Record<string, unknown> }>('select workspace_id, "values" from public.workspace_settings')
  for (const r of workspaces.rows) {
    const { keys, unknownKeys } = resolveKeys({ scope: 'workspace', id: r.workspace_id, values: r.values, defs: WORKSPACE_SETTINGS })
    for (const [k, s] of Object.entries(keys)) if (s.status === 'invalid' || s.status === 'required_missing') problems.push(`workspace ${r.workspace_id} ${k}: ${s.status}${'error' in s ? ` — ${s.error}` : ''}`)
    if (unknownKeys.length) console.warn(`workspace ${r.workspace_id} 미등록 키(무시됨): ${unknownKeys.join(', ')}`)
  }
  console.log(`settings:verify — 프로젝트 ${projects.rowCount}행, 워크스페이스 ${workspaces.rowCount}행, 문제 ${problems.length}건`)
  expect(problems).toEqual([])
})
