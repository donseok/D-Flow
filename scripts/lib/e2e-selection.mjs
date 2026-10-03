/** 단독 실행은 준비된 레인 B 캡처 시드를 사용한다. 전체 러너의 생성·변경 흐름과 별도다. */
export function parseE2eSelection(args) {
  if (!args.length) return null
  if (args.length === 2 && args[0] === '--only' && args[1] === 'sp3b-E3') return 'sp3b-E3'
  throw new Error('사용: e2e-local.mjs [--only sp3b-E3]')
}
export function kanbanBoardRendered(html) {
  return /<[a-z][^>]*\sdata-kanban-board(?:\s|=|>)/i.test(html)
}

export async function runSelectedE2e(name) {
  if (name !== 'sp3b-E3') throw new Error('지원하지 않는 단독 E2E 단계')
  const { laneEnv, freshSessions, must } = await import('../ui-capture.mjs')
  const { cookieHeader, expectLocation, kanbanStubCase } = await import('./e2e.mjs')
  const env = laneEnv()
  const ws = must('워크스페이스 A', await env.db.from('workspaces').select('id').eq('slug', (process.env.BOOTSTRAP_WORKSPACE_SLUG || 'default').trim()).single())
  const project = must('캡처 프로젝트', await env.db.from('projects').select('id').eq('workspace_id', ws.id).eq('name', 'UI-CAPTURE').single())
  const sessions = await freshSessions(env, ['wsAdmin'])
  const headers = { cookie: cookieHeader(sessions.wsAdmin.cookies) }
  const c = kanbanStubCase(project.id)
  const fetchLocal = path => fetch(new URL(path, env.baseUrl), { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
  const redirect = await fetchLocal(c.path)
  const problems = expectLocation(redirect, env.baseUrl, c.want)
  const page = await fetchLocal(c.want)
  const board = kanbanBoardRendered(await page.text())
  if (page.status !== 200 || !board) problems.push(`보드 상태 ${page.status}, 표지 ${board}`)
  const report = { ok: problems.length === 0, base: env.baseUrl, steps: [{ name, ok: problems.length === 0, from: c.path, to: c.want, problems }] }
  console.log(JSON.stringify(report, null, 2))
  return report.ok
}
