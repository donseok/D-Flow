// 잡 레지스트리 — 스케줄로 도는 잡의 정본(정본 §5.5.2 ①, §3.2.7). 잡은 전부 HTTP 엔드포인트 + CRON_SECRET 이다:
// 스케줄은 GET, 수동 실행은 POST(body.mode), 둘 다 Authorization: Bearer <CRON_SECRET>(@/lib/jobs/auth).
// vercel.json 의 crons 는 이 목록에서 만든다(npm run jobs:write — scripts/lib/jobs-consts.mjs 가 같은 값을 한 번 더 적고
// tests/jobs/registry.test.ts 가 셋의 일치를 본다). 자체호스트는 같은 URL 을 systemd timer·cron 이 친다(docs/runbook-selfhost.md).
//
// 스케줄은 UTC 5필드 cron 이고 워크스페이스 시간대와 무관하다(개정 §4.9). 전부 하루 1회다 — 이 리포는 Vercel Hobby 를 전제로
// 하고(scripts/vercel-ignore-build.sh) Hobby 의 cron 은 하루 1회까지다. 색인·위키 워커는 큐 소비형이라 더 자주 돌리는 편이 낫다 —
// 플랜을 올리거나 자체호스트 타이머를 쓰면 이 값만 바꾼다(잡은 멱등이라 간격을 줄여도 안전하다).
import { chatIndexWorkerEnabled, wikiWorkerEnabled } from '@/lib/modules/flags'
import { moduleDef } from '@/lib/modules/registry'
import type { ModuleId } from '@/lib/modules/defaults'

export interface JobDef {
  id: string
  /** 라우트 경로 — src/app<path>/route.ts 가 GET(와 manualModes 가 있으면 POST)을 export 한다 */
  path: `/api/${string}`
  /** UTC cron 식 */
  schedule: string
  /** 잡이 속한 모듈. null 은 core 잡(모듈 판정 없이 돈다 — 정본 §3.2.7 규칙 5). 모듈 잡은 잡 행마다 moduleState 로 판정한다(D16) */
  module: ModuleId | null
  /** 배포에서 이 잡을 쓸 수 있는가 — 거짓이면 라우트가 404 로 숨는다. flags.ts 술어만 부른다(env 를 직접 읽지 않는다) */
  envAvailable: () => boolean
  /** POST body.mode 로 받는 수동 실행 모드. 비어 있으면 POST 가 없다 */
  manualModes: readonly string[]
}

const always = () => true

export const JOBS = [
  // 읽은 알림 90일 정리 — 04:00 KST(원본 리포에서 물려받은 값)
  { id: 'inbox-retention', path: '/api/cron/inbox-retention', schedule: '0 19 * * *', module: null, envAvailable: always, manualModes: [] },
  // 양식 업로드의 고아 incoming 객체 정리(정본 §4.7.1) — 유예가 24시간이라 하루 1회면 충분하다. 04:30 KST
  { id: 'form-templates-gc', path: '/api/cron/form-templates-gc', schedule: '30 19 * * *', module: null, envAvailable: always, manualModes: [] },
  // 회의록 첨부 청소(SP5 D26) — 고아 minute-files 객체(유예 24시간)와 미정리 톰스톤. 판정은 수동 스크립트(npm run minutes:sweep)와 같은 함수다. 05:00 KST.
  // core 잡으로 둔다: 지울 대상은 어느 행도 가리키지 않는 객체와 사용자가 이미 지운 첨부뿐이라, 모듈을 끈 워크스페이스에서도 계속 치워야 한다(form-templates-gc 와 같은 꼴)
  { id: 'minutes-attachments-gc', path: '/api/cron/minutes-attachments-gc', schedule: '0 20 * * *', module: null, envAvailable: always, manualModes: [] },
  // AI 색인 큐 소비 — 03:00 KST. 배포에서 챗봇을 쓸 수 없으면 잡을 선점하지 않는다(선점하면 잡마다 off → skipped 로 소모된다, D16)
  { id: 'ai-index', path: '/api/cron/ai-index', schedule: '0 18 * * *', module: 'chatbot',
    envAvailable: () => chatIndexWorkerEnabled() && moduleDef('chatbot').envAvailable(),
    manualModes: ['worker', 'consistency', 'backfill', 'repair'] },
  // 위키 처리 큐 재시도 — 03:30 KST. WIKI_SERVICE_ENABLED 가 꺼져 있으면 워커 본체가 아무것도 하지 않고 돌아온다(runWikiWorkerOnce)
  { id: 'wiki-worker', path: '/api/wiki/worker', schedule: '30 18 * * *', module: 'wiki', envAvailable: () => wikiWorkerEnabled(), manualModes: ['worker'] },
] as const satisfies readonly JobDef[]

export type JobId = (typeof JOBS)[number]['id']

export function jobDef(id: JobId): JobDef {
  const job = JOBS.find((j) => j.id === id)
  if (!job) throw new Error(`잡 레지스트리에 없는 id: ${id}`)
  return job
}
