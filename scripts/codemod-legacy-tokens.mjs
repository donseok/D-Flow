#!/usr/bin/env node
// 옛 색 토큰 별칭 → 의미 토큰 일괄 개명(SP3b UI-6, 개정 스펙 §5.5.5·§5.12.5 SP9 ③). 이름만 바꾼다 — 색 값은 그대로다.
// 별칭은 `@theme inline { --color-<옛>: var(--color-<새>) }` 의 1:1 다른 이름이었으므로 유틸·var() 모두 같은 변수를 가리킨다.
//
//   node scripts/codemod-legacy-tokens.mjs            # src/**/*.{ts,tsx,css} 를 고친다
//   node scripts/codemod-legacy-tokens.mjs --check    # 고치지 않고 건수만(남은 것이 있으면 exit 1)
//   node scripts/codemod-legacy-tokens.mjs <경로…>    # 파일·폴더를 지정(테스트의 클래스 단언을 옮길 때)
//
// 멱등이다 — 새 이름은 옛 이름 집합과 겹치지 않아 두 번 돌려도 결과가 같다.
// 판정 정규식(LEGACY_UTIL·LEGACY_VAR)은 tests/css/no-legacy-tokens.test.ts 가 그대로 가져다 쓴다.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 옛 이름 → 의미 토큰(globals.css 의 `@theme inline` 별칭 25개, 2026-10-09 삭제) */
export const LEGACY_ALIASES = {
  'surface-2': 'surface-subtle', line: 'border', 'line-strong': 'border-input', ink: 'fg', 'ink-muted': 'fg-secondary', 'ink-subtle': 'fg-muted',
  brand: 'action', 'brand-hover': 'action-hover', 'brand-weak': 'action-soft', 'brand-fg': 'action-fg', 'brand-ring': 'border-focus',
  'accent-secondary': 'warning', 'accent-ink': 'action', 'accent-warning': 'warning', done: 'success', 'done-weak': 'success-weak',
  delayed: 'danger', 'delayed-weak': 'danger-weak', grid: 'border', 'grid-strong': 'border-input', 'sheet-head': 'surface-subtle', zebra: 'surface-zebra',
  'hero-ink': 'fg', 'hero-ink-muted': 'fg-secondary', 'hero-line': 'border',
}

// 긴 이름부터 — `ink` 가 `ink-muted` 의 앞부분을 먹지 않게 한다(뒤 경계가 한 번 더 막는다)
const ALT = Object.keys(LEGACY_ALIASES).sort((a, b) => b.length - a.length).join('|')
/** 색을 받는 유틸 접두. `accent` 는 accent-color 유틸이다 — `accent-ink` 는 (accent)+(ink), `text-accent-ink` 는 (text)+(accent-ink) */
export const COLOR_UTIL_PREFIX = '(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|inset-ring|outline|from|via|to|fill|stroke|divide|decoration|placeholder|shadow|inset-shadow|drop-shadow|text-shadow|accent|caret)'
/** 유틸의 색 자리 — 앞은 단어·하이픈이 아니고(변형 `hover:`·`!` 는 통과), 뒤는 단어·하이픈·보간(`${`)이 아니다(`/50`·따옴표·공백은 통과) */
export const LEGACY_UTIL = new RegExp(`(?<![\\w-])(${COLOR_UTIL_PREFIX})-(${ALT})(?![\\w$\\{-])`, 'g')
/** 변수 참조 — `var(--color-ink)`·`text-(--color-ink)`·주석 속 이름. 선언(`--color-ink:`)은 고치지 않고 보고한다 */
export const LEGACY_VAR = new RegExp(`--color-(${ALT})(?![\\w-])`, 'g')
const DECL_AFTER = /^['"]?\s*:(?!:)/
// 확신 못 하는 출현(고치지 않고 출력): ① 보간이 뒤따르는 유틸 ② 모르는 접두 뒤의 별칭 이름
const INTERPOLATED = new RegExp(`(?<![\\w-])${COLOR_UTIL_PREFIX}-(?:${ALT})(?=\\$\\{|\\{)`, 'g')
const UNKNOWN_PREFIX = new RegExp(`(?<![\\w-])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-(?:${ALT})(?![\\w$\\{-])`, 'g')
/** 색 유틸이 아닌 것으로 확인한 하이픈 낱말(display·data 속성·eslint 지시문·새 이름 `surface-zebra`) — 불확실 목록에서 뺀다 */
const NOT_COLOR = /^(?:inline-grid|ag-grid|eslint-disable(?:-next)?-line|(?:data|aria)-[a-z-]+|[a-z-]+-surface-zebra)$/

export function rewrite(text) {
  const counts = {}
  const unsure = []
  const bump = (k) => { counts[k] = (counts[k] ?? 0) + 1 }
  for (const m of text.matchAll(INTERPOLATED)) unsure.push(`보간: ${m[0]}`)
  let out = text.replace(LEGACY_UTIL, (_, prefix, old) => { bump(old); return `${prefix}-${LEGACY_ALIASES[old]}` })
  out = out.replace(LEGACY_VAR, (whole, old, offset, src) => {
    if (DECL_AFTER.test(src.slice(offset + whole.length, offset + whole.length + 8))) { unsure.push(`선언: ${whole}`); return whole }
    bump(old)
    return `--color-${LEGACY_ALIASES[old]}`
  })
  for (const m of out.matchAll(UNKNOWN_PREFIX)) if (!NOT_COLOR.test(m[0])) unsure.push(`접두 미상: ${m[0]}`)
  return { out, counts, unsure }
}

function walk(p, acc = []) {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p)) walk(join(p, e), acc)
  else if (/\.(tsx?|css)$/.test(p)) acc.push(p)
  return acc
}

function main(argv) {
  const check = argv.includes('--check')
  const roots = argv.filter((a) => !a.startsWith('--'))
  const files = (roots.length ? roots : ['src']).flatMap((r) => walk(r)).sort()
  const total = {}
  const unsure = new Map()
  let changed = 0
  for (const f of files) {
    const text = readFileSync(f, 'utf8')
    const r = rewrite(text)
    for (const [k, n] of Object.entries(r.counts)) total[k] = (total[k] ?? 0) + n
    for (const u of r.unsure) unsure.set(`${relative(process.cwd(), f)} — ${u}`, (unsure.get(`${relative(process.cwd(), f)} — ${u}`) ?? 0) + 1)
    if (r.out !== text) { changed++; if (!check) writeFileSync(f, r.out) }
  }
  const sum = Object.values(total).reduce((a, b) => a + b, 0)
  console.log(`${check ? '[check] 남은' : '치환'} ${sum}건 · 파일 ${changed}/${files.length}`)
  for (const old of Object.keys(LEGACY_ALIASES)) console.log(`  ${old} → ${LEGACY_ALIASES[old]}: ${total[old] ?? 0}`)
  if (unsure.size) {
    console.log(`\n고치지 않은 출현(${unsure.size}종) — 사람이 본다:`)
    for (const [k, n] of unsure) console.log(`  ${k} ×${n}`)
  }
  if (check && sum > 0) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
