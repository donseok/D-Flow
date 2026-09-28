// 모듈 플래그 8개는 flags.ts 술어로만 읽는다(스펙 §4.1). owner 는 flags.ts 와 E15 로 자리를 지키는 킬스위치 둘이다 — minutes 는
// 플래그 ∧ 시크릿(flags.ts 의 같은 이름 술어와 뜻이 다르다), agent 는 플래그 단독(뜻은 flags.ts 와 같지만 E15 로 제자리).
// 판독 모양: env.X·env?.X·env['X']·env?.['X'](한 줄의 판독을 전부 owner 대조), 그리고 식별자 토큰 X(구조분해·단축 속성 — 파서로 본다).
// Phase C 의 operational-env (가) "목록 이름은 owner 파일에서만 읽힌다"가 이 테스트를 대신하면 C 가 지운다.
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { MODULE_FLAG_NAMES } from '@/lib/modules/flags'
import { codeLines, walk } from '../invariants/_walk'

const OWNERS: Record<string, readonly string[]> = {
  'src/lib/modules/flags.ts': MODULE_FLAG_NAMES,
  'src/lib/agent/externalApi.ts': ['AGENT_API_ENABLED'],          // 킬스위치 = 플래그 단독(flags.ts 와 뜻이 같다 — E15 로 자리 유지)
  'src/lib/minutes/externalApi.ts': ['MINUTES_API_ENABLED'],      // 킬스위치 = 플래그 ∧ 시크릿(flags.ts 와 뜻이 다르다)
}
/** 플래그 이름이 식별자로 나와도 판독이 아닌 자리 — 타입 멤버 선언(판독은 flags.ts 술어가 한다) */
const TYPE_MEMBER_ALLOW: Record<string, readonly string[]> = {
  'src/lib/wiki/serviceState.ts': ['WIKI_SERVICE_ENABLED', 'WIKI_WORKER_ENABLED'],
}
const NAMES = MODULE_FLAG_NAMES.join('|')
/** env.X · env?.X · env['X'] · env?.['X'] — g 로 한 줄의 판독을 전부 본다(matchAll) */
const READ = new RegExp(`\\benv\\s*(?:\\??\\.\\s*|(?:\\?\\.)?\\s*\\[\\s*['"\`])(${NAMES})\\b`, 'g')
const FLAG_NAME = new Set<string>(MODULE_FLAG_NAMES)
const owned = (rel: string, name: string) => (OWNERS[rel] ?? []).includes(name)

/** 식별자 토큰으로 나온 플래그 이름(속성 접근·구조분해·단축 속성·타입 멤버) — 문자열·주석 속 이름은 세지 않는다 */
function identifierHits(text: string, fileName: string): { name: string; line: number; typeMember: boolean }[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: { name: string; line: number; typeMember: boolean }[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && FLAG_NAME.has(n.text)) {
      out.push({ name: n.text, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, typeMember: ts.isPropertySignature(n.parent) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

function offenders(rel: string, text: string): string[] {
  const reads = codeLines(text, rel).flatMap((line, i) =>
    [...line.matchAll(READ)].filter((m) => !owned(rel, m[1])).map((m) => `${rel}:${i + 1}: ${m[0]}`))
  const idents = !MODULE_FLAG_NAMES.some((n) => text.includes(n)) ? [] : identifierHits(text, rel)
    .filter((h) => !owned(rel, h.name) && !(h.typeMember && (TYPE_MEMBER_ALLOW[rel] ?? []).includes(h.name)))
    .map((h) => `${rel}:${h.line}: 식별자 ${h.name}`)
  return [...reads, ...idents]
}

describe('모듈 플래그 판독 위치', () => {
  it('flags.ts·두 킬스위치 밖에서 모듈 플래그 판독(속성·옵셔널·대괄호·구조분해)이 0건', () => {
    const hits = walk('src').flatMap((f) => offenders(relative(process.cwd(), f), readFileSync(f, 'utf8')))
    expect(hits, '모듈 플래그는 @/lib/modules/flags 의 술어로 읽는다').toEqual([])
  }, 20_000)
  it('민감도 — 판독 모양을 잡고, 문자열·주석 속 이름과 술어 호출은 세지 않는다', () => {
    const x = 'src/lib/x.ts'
    expect(offenders(x, "if (process.env.CHAT_V2_ENABLED !== 'true')")).toHaveLength(2)          // 판독 + 식별자
    expect(offenders(x, "process.env['WIKI_WORKER_ENABLED']")).toHaveLength(1)
    expect(offenders(x, 'env.WIKI_SERVICE_ENABLED === "true"')).toHaveLength(2)
    expect(offenders(x, "process.env?.CHAT_V2_LLM_SYNTHESIS_ENABLED === 'true'")).toHaveLength(2)   // 옵셔널 체이닝(M6j)
    expect(offenders(x, "process.env?.['CHAT_V2_PLANNER_ENABLED']")).toHaveLength(1)
    expect(offenders(x, "const { CHAT_V2_ENABLED } = process.env")).toHaveLength(1)                   // 구조분해(M6k)
    expect(offenders(x, "(({ CHAT_V2_LLM_SYNTHESIS_ENABLED: s }) => s === 'true')(process.env)")).toHaveLength(1)
    expect(offenders(x, 'chatV2Enabled()')).toEqual([])
    expect(offenders(x, "console.info('WIKI_SERVICE_ENABLED=true 를 넣는다') // CHAT_V2_ENABLED")).toEqual([])
  })
  it('민감도 — owner 파일도 한 줄의 판독을 전부 대조하고(M6i), 타입 멤버 허용은 그 파일의 선언에만 선다', () => {
    const agent = 'src/lib/agent/externalApi.ts'
    expect(offenders(agent, "return process.env.AGENT_API_ENABLED === 'true'")).toEqual([])
    expect(offenders(agent, "return process.env.AGENT_API_ENABLED === 'true' && process.env.CHAT_V2_ENABLED === 'true'")).toHaveLength(2)
    const state = 'src/lib/wiki/serviceState.ts'
    expect(offenders(state, 'export type E = { WIKI_SERVICE_ENABLED?: string; WIKI_WORKER_ENABLED?: string }')).toEqual([])
    expect(offenders(state, 'const { WIKI_WORKER_ENABLED } = process.env')).toHaveLength(1)
  })
})
