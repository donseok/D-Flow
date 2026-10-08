// 잡 레지스트리가 cron 의 정본이다(정본 §5.5.2 ①) — 레지스트리 ↔ 스크립트 사본 ↔ vercel.json ↔ 라우트 파일이 한 목록인지 본다.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JOBS, jobDef, type JobDef } from '@/lib/jobs/registry'
import { MODULE_IDS } from '@/lib/modules/defaults'
import { JOB_SCHEDULES, vercelCrons, withCrons } from '../../scripts/lib/jobs-consts.mjs'

const jobs: readonly JobDef[] = JOBS
const routeFile = (path: string) => `src/app${path}/route.ts`

/** 라우트 파일이 export 하는 HTTP 메서드(function 선언) */
function exportedMethods(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  return sf.statements.flatMap((s) =>
    ts.isFunctionDeclaration(s) && s.name && s.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? [s.name.text] : [])
    .filter((n) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(n)).sort()
}

function routesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? routesUnder(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : [])
}

afterEach(() => { vi.unstubAllEnvs() })

describe('잡 레지스트리', () => {
  it('항목은 다섯 필드를 갖추고 id·path 가 유일하다', () => {
    expect(jobs.map((j) => j.id)).toEqual(['inbox-retention', 'form-templates-gc', 'ai-index', 'wiki-worker'])
    expect(new Set(jobs.map((j) => j.path)).size).toBe(jobs.length)
    for (const j of jobs) {
      expect(j.path, j.id).toMatch(/^\/api\/[a-z0-9/-]+$/)
      // UTC 5필드 cron — 숫자·*·,·-·/ 만
      expect(j.schedule, j.id).toMatch(/^(?:[\d*,/-]+ ){4}[\d*,/-]+$/)
      expect(j.module === null || (MODULE_IDS as readonly string[]).includes(j.module), j.id).toBe(true)
      expect(typeof j.envAvailable(), j.id).toBe('boolean')
      expect(new Set(j.manualModes).size, j.id).toBe(j.manualModes.length)
    }
    expect(() => jobDef('nope' as never)).toThrow()
  })

  it('수동 모드는 스펙 표와 같다 — ai-index 넷, wiki-worker 하나, core 잡은 없음', () => {
    expect(Object.fromEntries(jobs.map((j) => [j.id, [...j.manualModes]]))).toEqual({
      'inbox-retention': [], 'form-templates-gc': [],
      'ai-index': ['worker', 'consistency', 'backfill', 'repair'], 'wiki-worker': ['worker'],
    })
  })

  it('envAvailable — core 잡은 항상 참, 워커 잡은 자기 플래그(색인은 배포의 챗봇 가용까지)를 따른다', () => {
    for (const name of ['CHAT_V2_INDEX_WORKER_ENABLED', 'CHAT_V2_ENABLED', 'WIKI_WORKER_ENABLED', 'WIKI_SERVICE_ENABLED']) vi.stubEnv(name, '')
    expect(jobDef('inbox-retention').envAvailable()).toBe(true)
    expect(jobDef('form-templates-gc').envAvailable()).toBe(true)
    expect(jobDef('ai-index').envAvailable()).toBe(false)
    expect(jobDef('wiki-worker').envAvailable()).toBe(false)

    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
    expect(jobDef('ai-index').envAvailable()).toBe(false) // 워커 플래그만으로는 열리지 않는다
    vi.stubEnv('CHAT_V2_ENABLED', 'true')
    expect(jobDef('ai-index').envAvailable()).toBe(true)
    vi.stubEnv('WIKI_WORKER_ENABLED', 'true')
    expect(jobDef('wiki-worker').envAvailable()).toBe(true)
  })

  it('스크립트 사본(scripts/lib/jobs-consts.mjs)이 레지스트리와 같다', () => {
    expect(JOB_SCHEDULES).toEqual(jobs.map(({ id, path, schedule }) => ({ id, path, schedule })))
  })

  it('vercel.json 의 crons = 레지스트리(순서까지) — npm run jobs:write 로 만든 그대로다', () => {
    const text = readFileSync('vercel.json', 'utf8')
    expect(JSON.parse(text).crons).toEqual(jobs.map(({ path, schedule }) => ({ path, schedule })))
    expect(vercelCrons()).toEqual(JSON.parse(text).crons)
    expect(withCrons(text)).toBe(text)
  })

  it('withCrons 는 crons 만 갈아 끼우고 다른 키는 둔다', () => {
    const out = JSON.parse(withCrons('{"regions":["icn1"],"crons":[{"path":"/api/old","schedule":"* * * * *"}]}', [{ id: 'a', path: '/api/a', schedule: '0 0 * * *' }]))
    expect(out).toEqual({ regions: ['icn1'], crons: [{ path: '/api/a', schedule: '0 0 * * *' }] })
  })

  it('레지스트리의 path 마다 라우트가 있고 GET(수동 모드가 있으면 POST 도)만 export 한다', () => {
    for (const j of jobs) {
      const file = routeFile(j.path)
      expect(existsSync(file), file).toBe(true)
      expect(exportedMethods(file), file).toEqual(j.manualModes.length > 0 ? ['GET', 'POST'] : ['GET'])
    }
  })

  it('잡 라우트는 전부 authorizeJob(자기 id)로 인증한다 — 메서드마다 한 번', () => {
    for (const j of jobs) {
      const text = readFileSync(routeFile(j.path), 'utf8')
      const calls = [...text.matchAll(/authorizeJob\(\s*\w+\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1])
      expect(calls, j.path).toEqual(Array(j.manualModes.length > 0 ? 2 : 1).fill(j.id))
      expect(text, j.path).toContain("from '@/lib/jobs/auth'")
    }
  })

  it('src/app/api/cron/** 의 라우트는 전부 레지스트리에 있다(레지스트리 밖 0)', () => {
    const registered = new Set(jobs.map((j) => routeFile(j.path)))
    expect(routesUnder('src/app/api/cron').filter((f) => !registered.has(f))).toEqual([])
  })

  it('흡수된 옛 워커 라우트는 없다', () => {
    expect(existsSync('src/app/api/chat/index/worker/route.ts')).toBe(false)
  })
})
