// 스킬 API 경로 동결(SP5b P0 — 스펙 done_when #4·E18). 개정 §3.8 #4 의 명령(`grep -rhoE 'api/v1/[a-zA-Z_/-]+' .claude/skills | sort -u`)
// 결과와, heartbeat(`$_id` 꼴)까지 잡는 넓힌 정규식 결과를 둘 다 고정한다. 넓힌 결과는 실제 라우트 파일 11개와도 같아야 한다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import frozen from '../fixtures/agent-api-paths.json'

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : [p]
  })
}
const skillText = filesUnder('.claude/skills').map((f) => readFileSync(f, 'utf8')).join('\n')
const uniqSorted = (xs: string[]) => [...new Set(xs)].sort()

describe('스킬 API 경로 동결(SP5b P0)', () => {
  it('개정 §3.8 #4 의 정규식 결과 = 동결 목록(upstream)', () => {
    expect(uniqSorted(skillText.match(/api\/v1\/[a-zA-Z_/-]+/g) ?? [])).toEqual(frozen.upstream)
  })
  it('넓힌 정규식({id}·$_id 포함)을 [id] 로 맞춘 결과 = 동결 목록(normalized)', () => {
    const wide = (skillText.match(/api\/v1\/[a-zA-Z_/{}$-]+/g) ?? []).map((p) => p.replace(/\{id\}|\$_id/g, '[id]'))
    expect(uniqSorted(wide)).toEqual(frozen.normalized)
  })
  it('동결 목록(normalized) = src/app/api/v1 의 에이전트·WBS 라우트(회의록 API 제외)', () => {
    const routes = filesUnder('src/app/api/v1').filter((f) => f.endsWith('route.ts'))
      .map((f) => f.replace(/^src\/app\//, '').replace(/\/route\.ts$/, ''))
      .filter((p) => !p.startsWith('api/v1/minutes'))
    expect(uniqSorted(routes)).toEqual(frozen.normalized)
  })
})
