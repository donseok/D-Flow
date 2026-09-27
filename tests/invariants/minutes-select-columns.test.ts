// 0011(H2-c)은 minutes 의 표 SELECT 를 걷고 share_token 을 뺀 열에만 준다. 세션이 minutes 를 '*' 로 읽거나 임베드 minutes(*) 를 쓰면
// 그 쿼리 전체가 42501 이다(목록·상세·내보내기·AI 답변이 통째로 실패). 토큰은 서버 경로 둘만 읽는다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { codeLines, walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
/** .from('minutes') 바로 뒤 첫 .select( 의 리터럴 인자 — 인자 없음(= *)도 잡는다 */
const DIRECT = /\.from\((['"])minutes\1\)\s*\.select\(\s*(\)|(['"`])([^'"`]*)\3)/g
/** PostgREST 임베드 minutes(*)·minutes!inner(*) */
const EMBED = /\bminutes(!\w+)?\(\s*\*\s*\)/

export function starReads(text: string): string[] {
  const hits: string[] = []
  for (const m of text.matchAll(DIRECT)) if (m[2] === ')' || (m[4] ?? '').includes('*')) hits.push(m[0])
  if (EMBED.test(text)) hits.push(text.match(EMBED)![0])
  return hits
}

describe('minutes 열 단위 SELECT(H2-c) — 세션 쿼리가 * 로 읽지 않는다', () => {
  it('src 에 minutes 를 * 로 읽는 곳이 없다(표 직접·임베드)', () => {
    const hits: string[] = []
    for (const file of walk(ROOT)) {
      const text = codeLines(readFileSync(file, 'utf8')).join('\n')
      for (const h of starReads(text)) hits.push(`${relative(process.cwd(), file)}: ${h}`)
    }
    expect(hits).toEqual([])
  })

  it('민감도 — 검사식이 * 읽기를 잡는다', () => {
    expect(starReads(`sb.from('minutes').select('*').eq('id', x)`)).toHaveLength(1)
    expect(starReads(`sb.from('minutes')\n  .select()`)).toHaveLength(1)
    expect(starReads(`sb.from('files').select('id, minutes(*)')`)).toHaveLength(1)
    expect(starReads(`sb.from('minutes').select('id, title')`)).toEqual([])
    expect(starReads('sb.from(\'minutes\').select(`${COLS}, body_md`)')).toEqual([])
  })

  it('share_token 을 읽는 코드는 서버 경로 둘뿐이다(readShareRow 의 service_role, 공개 페이지)', () => {
    const files = walk(ROOT)
      .filter((f) => codeLines(readFileSync(f, 'utf8')).some((l) => l.includes('share_token')))
      .map((f) => relative(process.cwd(), f)).sort()
    expect(files).toEqual(['src/app/actions/minutes.ts', 'src/app/share/minutes/[token]/page.tsx'])
  })
})
