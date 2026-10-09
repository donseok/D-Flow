// scripts/lib/jobs-consts.mjs — 잡 레지스트리(src/lib/jobs/registry.ts)의 id·path·schedule 사본. 순수.
// .mjs 는 src 의 TS 를 import 하지 못하므로 한 번 더 적고 tests/jobs/registry.test.ts 가 레지스트리와 대조한다 —
// 레지스트리를 바꾸면 여기를 같이 고치고 npm run jobs:write 로 vercel.json 을 다시 만든다.

/** 레지스트리와 같은 순서. schedule 은 UTC cron */
export const JOB_SCHEDULES = Object.freeze([
  Object.freeze({ id: 'inbox-retention', path: '/api/cron/inbox-retention', schedule: '0 19 * * *' }),
  Object.freeze({ id: 'form-templates-gc', path: '/api/cron/form-templates-gc', schedule: '30 19 * * *' }),
  Object.freeze({ id: 'minutes-attachments-gc', path: '/api/cron/minutes-attachments-gc', schedule: '0 20 * * *' }),
  Object.freeze({ id: 'ai-index', path: '/api/cron/ai-index', schedule: '0 18 * * *' }),
  Object.freeze({ id: 'wiki-worker', path: '/api/wiki/worker', schedule: '30 18 * * *' }),
])

/** vercel.json 의 crons 값 — 잡마다 { path, schedule }
 *  @param {readonly { id: string, path: string, schedule: string }[]} [jobs] */
export function vercelCrons(jobs = JOB_SCHEDULES) {
  return jobs.map(({ path, schedule }) => ({ path, schedule }))
}

/** vercel.json 본문(문자열)에서 crons 만 갈아 끼운 새 본문. 다른 키와 그 순서는 그대로 둔다
 *  @param {string} vercelJsonText @param {readonly { id: string, path: string, schedule: string }[]} [jobs] */
export function withCrons(vercelJsonText, jobs = JOB_SCHEDULES) {
  const config = JSON.parse(vercelJsonText)
  return `${JSON.stringify({ ...config, crons: vercelCrons(jobs) }, null, 2)}\n`
}
