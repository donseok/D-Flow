// 0011(H2-c)은 minutes 의 표 SELECT 를 걷고 share_token 을 뺀 열에만 준다. 세션이 minutes 를 '*' 로 읽거나 임베드 minutes(*) 를 쓰면
// 그 쿼리 전체가 42501 이다(목록·상세·내보내기·AI 답변이 통째로 실패). 토큰은 서버 경로 둘만 읽는다.
// 런타임 확인은 한 번뿐이라(계획 C24) 이 정적 검사가 남은 유일한 자동 방어선이다 — 읽기 꼴을 넓게 잡는다(_minutes-reads.ts).
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { codeLines, walk } from './_walk'
import { EMBED, parse, propertyValues, sessionTokenChains, starReads, type ImportLoader } from './_minutes-reads'

const ROOT = join(process.cwd(), 'src')
const rel = (f: string) => relative(process.cwd(), f)

/** import 한 상수를 풀 때 — '@/…' 와 상대 경로만 따라간다. */
const load: ImportLoader = (fromFile, specifier) => {
  const base = specifier.startsWith('@/') ? join(ROOT, specifier.slice(2))
    : specifier.startsWith('.') ? join(dirname(fromFile), specifier) : null
  if (!base) return null
  const file = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(existsSync)
  return file ? parse(file, readFileSync(file, 'utf8')) : null
}

/** 풀 수 없어도 되는 select 인자 — 값은 아래 'extra' 검사가 호출부에서 본다. */
const ALLOW_DYNAMIC: Record<string, readonly string[]> = {
  // checkOwner 의 opts.extra — 같은 왕복에 실을 열 이름 하나. 호출부는 전부 이 파일 안에 있다.
  'src/app/actions/minutes.ts': ['opts.extra'],
}

/** select 를 부르는 파일만 파싱한다 — src 전체를 파싱하면 부하 때 5초 한도를 넘는다(use-server-exports 와 같은 이유). */
const sources = () => walk(ROOT)
  .map(f => ({ f, text: readFileSync(f, 'utf8') }))
  .filter(({ text }) => text.includes('.select('))

const embedReads = (text: string) => (EMBED.test(text) ? [text.match(EMBED)![0]] : [])

describe('minutes 열 단위 SELECT(H2-c) — 세션 쿼리가 * 로 읽지 않는다', () => {
  it('src 에 minutes 를 * 로 읽거나 무엇을 읽는지 풀 수 없는 곳이 없다(표 직접·임베드)', () => {
    const hits: string[] = []
    for (const { f, text } of sources()) {
      for (const h of starReads(f, text, { load, allowDynamic: ALLOW_DYNAMIC[rel(f)] })) hits.push(`${rel(f)}:${h}`)
    }
    for (const f of walk(ROOT)) {
      for (const h of embedReads(codeLines(readFileSync(f, 'utf8')).join('\n'))) hits.push(`${rel(f)}: ${h}`)
    }
    expect(hits).toEqual([])
  }, 30_000)

  it('민감도 — 검사식이 * 읽기를 잡는다', () => {
    const stars = (code: string) => starReads('x.ts', code)
    expect(stars(`sb.from('minutes').select('*').eq('id', x)`)).toHaveLength(1)
    expect(stars(`sb.from('minutes')\n  .select()`)).toHaveLength(1)
    expect(embedReads(`sb.from('files').select('id, minutes(*)')`)).toHaveLength(1)
    expect(stars(`sb.from('minutes').select('id, title')`)).toEqual([])
    expect(stars('const COLS = \'id, title\'\nsb.from(\'minutes\').select(`${COLS}, body_md`)')).toEqual([])
    expect(stars(`const COLS = ['id', 'title'].join(', ')\nsb.from('minutes').select(COLS)`)).toEqual([])
    expect(stars(`sb.from('meetings').select('*')`)).toEqual([])
    expect(stars(`sb.storage.from('minutes').remove([path])`)).toEqual([])
  })

  // 글자 검사가 지나치던 꼴(H2 최종 리뷰) — 하나라도 통과하면 0011 뒤 그 화면이 42501 로 통째로 실패한다.
  it.each([
    ['상수에 담긴 *', `const COLS = '*'\nsb.from('minutes').select(COLS)`],
    ['템플릿에 끼운 상수의 *', 'const ALL = \'*\'\nsb.from(\'minutes\').select(`${ALL}, projects(name)`)'],
    ['배열을 이어 붙인 상수의 *', `const COLS = ['id', '*'].join(', ')\nsb.from('minutes').select(COLS)`],
    ['삼항의 한쪽이 *', `sb.from('minutes').select(full ? '*' : 'id')`],
    ['update 뒤의 select()', `sb.from('minutes').update({ title }).eq('id', id).select()`],
    ['insert 뒤의 select(*)', `sb.from('minutes').insert(row).select('*')`],
    ['표 이름을 담은 상수', `const T = 'minutes'\nsb.from(T).select('*')`],
    ['from<Row>(…)', `sb.from<Row>('minutes').select('*')`],
    ['표 이름을 풀 수 없는 체인의 *', `function read(table: string) { return sb.from(table).select('*') }`],
    ['풀 수 없는 인자', `function read(cols: string) { return sb.from('minutes').select(cols) }`],
    ['풀 수 없는 끼움', 'function read(extra: string) { return sb.from(\'minutes\').select(`id, ${extra}`) }'],
  ])('민감도 — %s', (_name, code) => {
    expect(starReads('x.ts', code)).toHaveLength(1)
  })

  it.each([
    ['minutes(*, projects(name))', `sb.from('files').select('id, minutes(*, projects(name))')`],
    ['minutes!fk!inner(*)', `sb.from('files').select('id, minutes!fk!inner(*)')`],
    ['별칭 m:minutes!inner(*)', `sb.from('files').select('id, m:minutes!inner(*)')`],
  ])('민감도 — 임베드 %s', (_name, code) => {
    expect(embedReads(code)).toHaveLength(1)
    expect(embedReads(`sb.from('files').select('id, minutes!inner(title, meetings!inner(project_id))')`)).toEqual([])
  })

  it('풀 수 없어도 되는 인자는 허용 목록의 식뿐이다 — 표 이름을 풀 수 없으면 풀 수 없는 인자는 묻지 않는다', () => {
    const code = 'function read(opts: { extra: string }) { return sb.from(\'minutes\').select(`id, ${opts.extra}`) }'
    expect(starReads('x.ts', code)).toHaveLength(1)
    expect(starReads('x.ts', code, { allowDynamic: ['opts.extra'] })).toEqual([])
    expect(starReads('x.ts', `function read(t: string, cols: string) { return sb.from(t).select(cols) }`)).toEqual([])
  })

  it('checkOwner 에 넘기는 extra 는 리터럴 열 이름이고 * 나 share_token 이 아니다(허용 목록의 값 검사)', () => {
    const bad = (file: string, text: string) => propertyValues(file, text, 'extra')
      .filter(v => v.unresolved.length > 0 || v.texts.some(t => t.includes('*') || t.includes('share_token')))
      .map(v => `${file}:${v.line}`)
    for (const file of Object.keys(ALLOW_DYNAMIC)) {
      const text = readFileSync(join(process.cwd(), file), 'utf8')
      expect(propertyValues(file, text, 'extra').length).toBeGreaterThan(0)
      expect(bad(file, text)).toEqual([])
    }
    // 민감도
    expect(bad('x.ts', `checkOwner(sb, id, actor, { extra: 'share_token' })`)).toHaveLength(1)
    expect(bad('x.ts', `checkOwner(sb, id, actor, { extra: '*' })`)).toHaveLength(1)
    expect(bad('x.ts', `checkOwner(sb, id, actor, { extra: cols })`)).toHaveLength(1)
    expect(bad('x.ts', `checkOwner(sb, id, actor, { extra: 'folder_id' })`)).toEqual([])
  })

  it('share_token 을 읽는 코드는 서버 경로 둘뿐이고(readShareRow 의 service_role, 공개 페이지) 그 체인은 service_role 에서 시작한다', () => {
    const files = walk(ROOT)
      .filter((f) => codeLines(readFileSync(f, 'utf8')).some((l) => l.includes('share_token')))
    expect(files.map(rel).sort()).toEqual(['src/app/actions/minutes.ts', 'src/app/share/minutes/[token]/page.tsx'])
    // 파일 단위 허용만으로는 같은 파일 안의 세션 읽기를 못 잡는다 — share_token 을 언급하는 minutes 체인은 …admin 에서 시작해야 한다.
    const chains = files.flatMap(f => sessionTokenChains(f, readFileSync(f, 'utf8'), load).map(h => `${rel(f)}:${h}`))
    expect(chains).toEqual([])
    // 민감도
    expect(sessionTokenChains('x.ts', `sb.from('minutes').select('share_token, share_enabled').eq('id', id)`)).toHaveLength(1)
    expect(sessionTokenChains('x.ts', `sb.from('minutes').update({ share_token: t }).eq('id', id)`)).toHaveLength(1)
    expect(sessionTokenChains('x.ts', `adm.admin.from('minutes').select('share_token, share_enabled').eq('id', id)`)).toEqual([])
    expect(sessionTokenChains('x.ts', `admin.from('minutes').select('id').eq('share_token', token)`)).toEqual([])
  })
})
