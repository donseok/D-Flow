// globals.css 파서 — 대비·별칭·층 테스트가 같이 쓴다(SP3b UI-1). 주석을 지우고 중괄호 깊이로 최상위 블록을 걷는다.
// 값은 var() 를 재귀로 풀어 hex 로 낸다. 문맥은 라이트 하나다(:root·@theme·@theme inline) — 제품이 라이트 전용이라 다크·인쇄 재정의가 없다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type Decl = { name: string; value: string }
export type Block = { prelude: string; body: string }

export const GLOBALS = join(process.cwd(), 'src/app/globals.css')
export const readGlobals = (): string => readFileSync(GLOBALS, 'utf8')
export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** 최상위 블록 { prelude, body } — 세미콜론으로 끝나는 최상위 문(@import·@source·@custom-variant)은 건너뛴다 */
export function topBlocks(css: string): Block[] {
  const out: Block[] = []
  let depth = 0
  let open = 0
  let preludeStart = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') { if (depth === 0) open = i; depth++ }
    else if (c === '}') {
      depth--
      if (depth === 0) { out.push({ prelude: css.slice(preludeStart, open).trim(), body: css.slice(open + 1, i) }); preludeStart = i + 1 }
    } else if (c === ';' && depth === 0) preludeStart = i + 1
  }
  return out
}

/** 블록 본문 바로 아래의 커스텀 프로퍼티 선언(중첩 블록 안은 뺀다) */
export function declsOf(body: string): Decl[] {
  let depth = 0
  let flat = ''
  for (const ch of body) {
    if (ch === '{') depth++
    if (depth === 0) flat += ch
    if (ch === '}') depth--
  }
  return [...flat.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => ({ name: m[1], value: m[2].trim() }))
}

export function tokenMaps(css = readGlobals()) {
  const blocks = topBlocks(stripComments(css))
  const pick = (p: string) => blocks.filter((b) => b.prelude === p).flatMap((b) => declsOf(b.body))
  const root = pick(':root')
  return {
    blocks,
    primitives: root.filter((d) => d.name.startsWith('--p-')),
    rootOther: root.filter((d) => !d.name.startsWith('--p-')),
    theme: pick('@theme'),
    inline: pick('@theme inline'),
  }
}

/** 의미 색 토큰 이름(@theme 의 --color-*, 접두 없이) */
export const semanticNames = (m = tokenMaps()): string[] => m.theme.filter((d) => d.name.startsWith('--color-')).map((d) => d.name.slice('--color-'.length))

export function resolver(css = readGlobals()) {
  const maps = tokenMaps(css)
  const entries = (ds: Decl[]) => ds.map((d) => [d.name, d.value] as [string, string])
  const light = new Map([...entries(maps.primitives), ...entries(maps.rootOther), ...entries(maps.theme), ...entries(maps.inline)])
  const resolve = (name: string, seen: string[] = []): string => {
    const key = name.startsWith('--') ? name : `--color-${name}`
    if (seen.includes(key)) throw new Error(`순환: ${[...seen, key].join(' → ')}`)
    const v = light.get(key)
    if (v === undefined) throw new Error(`토큰 없음: ${key}`)
    const ref = /^var\((--[\w-]+)\)$/.exec(v)
    if (ref) return resolve(ref[1], [...seen, key])
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`hex 가 아니다: ${key} = ${v}`)
    return v.toLowerCase()
  }
  return { maps, resolve }
}

/** src 아래 .ts·.tsx·.css 원문(삭제 이름 0건 검사용) — [상대 경로, 원문] */
export function srcFiles(exts = /\.(tsx?|css)$/): [string, string][] {
  const out: [string, string][] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e)
      if (statSync(f).isDirectory()) walk(f)
      else if (exts.test(e)) out.push([f.slice(process.cwd().length + 1), readFileSync(f, 'utf8')])
    }
  }
  walk(join(process.cwd(), 'src'))
  return out
}
