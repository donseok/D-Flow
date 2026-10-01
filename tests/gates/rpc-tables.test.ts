// RPC → 표 대응(tests/gates/_rpc-tables.ts, SP4 스펙 D25·Q9)의 정합성과 tablesInNode 의 .rpc 규칙. 대응이 맞아야 열거 게이트의 null 축
// (deny.test.ts)·무관문 갈래 축(deny.routes.test.ts)이 DEFINER RPC 안의 쓰기를 본다 — 키는 마이그레이션의 public 함수이고 src 가 리터럴로
// 부른다, 값은 SQL 이 쓰는 표 안에 있고 그중 토글 모듈 표는 빠짐없다(스펙 §4.1.9 — 대응은 쓰기 표다. 읽기만 하는 표는 넣지 않는다 — RPC 의
// 모듈 표 읽기는 이 게이트가 보지 않는 한계). SQL 판독은 정규식이다: 함수 본문의 insert into·update·delete from·merge into·truncate 뒤
// 이름과 본문이 부르는 public 함수(재귀). 트리거·동적 SQL(execute)·오버로드 구분은 보지 않는다(한계 — 오버로드는 이름 단위 마지막 정의).
// 본문은 달러 인용(`as $tag$`)만 읽는다 — `begin atomic` 이나 `as '…'` 본문의 함수는 그 뒤 함수의 달러 본문을 제 것으로 읽는다(한계, A1-1 리뷰
// 이월 — 지금 마이그레이션에 그런 본문은 없고, CLAUDE.md 가 atomic 꼴을 피하게 한다).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse, tablesIn, tablesInNode } from '../invariants/_ast'
import { walk } from '../invariants/_walk'
import { DYNAMIC_RPC, DYNAMIC_RPC_ALLOW, RPC_TABLES, UNKNOWN_RPC_PREFIX } from './_rpc-tables'
import { MODULE_TABLE_OWNER } from './_tables'

interface Catalog { tables: Set<string>; fns: Map<string, string> }

/** 마이그레이션 원문(파일 순)의 public 표·함수 최종 상태 — create 가 더하고 drop 이 뺀다. 함수는 이름마다 마지막 정의의 본문($tag$ 사이) */
function catalogOf(texts: readonly string[]): Catalog {
  const tables = new Set<string>()
  const fns = new Map<string, string>()
  const re = /\b(create|drop)\s+(?:or\s+replace\s+)?(table|function)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:"?([a-z_0-9]+)"?\.)?"?([a-z_0-9]+)"?/gi
  for (const raw of texts) {
    const t = raw.replace(/--[^\n]*/g, '')
    for (const m of t.matchAll(re)) {
      const verb = m[1].toLowerCase()
      const schema = m[3]
      const name = m[4].toLowerCase()
      if (schema && schema.toLowerCase() !== 'public') continue
      if (m[2].toLowerCase() === 'table') {
        if (verb === 'create') tables.add(name)
        else tables.delete(name)
        continue
      }
      if (verb === 'drop') { fns.delete(name); continue }
      const tag = /\bas\s+(\$[a-z_0-9]*\$)/i.exec(t.slice(m.index!))
      if (!tag) continue
      const start = m.index! + tag.index + tag[0].length
      const end = t.indexOf(tag[1], start)
      fns.set(name, t.slice(start, end < 0 ? undefined : end))
    }
  }
  return { tables, fns }
}

const WRITE = /\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?)\s+(?:only\s+)?(?:"?([a-z_0-9]+)"?\.)?"?([a-z_0-9]+)"?/gi
const CALL = /\b(?:"?public"?\.)?"?([a-z_0-9]+)"?\s*\(/gi
/** 함수 본문(+ 본문이 부르는 public 함수, 재귀)이 쓰는 public 표 — 정렬. `on conflict … do update set`·`for update` 의 낱말은 표가 아니라 걸러진다 */
function sqlWritesOf(cat: Catalog, fn: string): string[] {
  const out = new Set<string>()
  const seen = new Set<string>()
  const queue = [fn]
  while (queue.length) {
    const name = queue.shift()!
    if (seen.has(name)) continue
    seen.add(name)
    const body = cat.fns.get(name)
    if (body === undefined) continue
    for (const m of body.matchAll(WRITE)) {
      if ((!m[1] || m[1].toLowerCase() === 'public') && cat.tables.has(m[2].toLowerCase())) out.add(m[2].toLowerCase())
    }
    for (const m of body.matchAll(CALL)) if (cat.fns.has(m[1].toLowerCase())) queue.push(m[1].toLowerCase())
  }
  return [...out].sort()
}

const MIG = 'supabase/migrations'
const CAT = catalogOf(readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(MIG, f), 'utf8')))

describe('RPC_TABLES — 관리 목록의 정합성', () => {
  it('키는 코드 포인트 순이고 값에 중복이 없다', () => {
    const keys = Object.keys(RPC_TABLES)
    expect(keys).toEqual([...keys].sort())
    expect(Object.entries(RPC_TABLES).filter(([, ts]) => new Set(ts).size !== ts.length).map(([k]) => k)).toEqual([])
  })

  it('키는 마이그레이션이 정의한(지우지 않은) public 함수, 값의 표는 마이그레이션이 만든(지우지 않은) public 표다', () => {
    expect(Object.keys(RPC_TABLES).filter((k) => !CAT.fns.has(k))).toEqual([])
    expect(Object.entries(RPC_TABLES).flatMap(([k, ts]) => ts.filter((t) => !CAT.tables.has(t)).map((t) => `${k}: ${t}`))).toEqual([])
  })

  it('SQL 이 쓰는 토글 모듈 표 ⊆ 값 ⊆ SQL 이 쓰는 표 — 모듈 표를 빠뜨리거나 본문이 쓰지 않는 표를 적으면 실패', () => {
    const bad = Object.entries(RPC_TABLES).flatMap(([k, listed]) => {
      const sql = sqlWritesOf(CAT, k)
      const extra = listed.filter((t) => !sql.includes(t))
      const missing = sql.filter((t) => MODULE_TABLE_OWNER[t] && !listed.includes(t))
      return [
        ...(extra.length ? [`${k}: 본문이 쓰지 않는 표 ${extra.join(', ')}`] : []),
        ...(missing.length ? [`${k}: 본문이 쓰는 토글 모듈 표 ${missing.join(', ')} 가 빠졌다`] : []),
      ]
    })
    expect(bad).toEqual([])
  })

  it('키마다 src 가 리터럴로 부른다 — 부르지 않는 RPC 는 죽은 항목(호출을 지운 커밋이 줄도 지운다)', () => {
    const called = new Set<string>()
    for (const f of walk('src')) {
      const text = readFileSync(f, 'utf8')
      if (!/\.rpc\s*\(/.test(text)) continue
      const sf = parse(f, text)
      for (const t of tablesInNode(sf, sf, {})) if (t.startsWith(UNKNOWN_RPC_PREFIX)) called.add(t.slice(UNKNOWN_RPC_PREFIX.length))
    }
    expect(Object.keys(RPC_TABLES).filter((k) => !called.has(k))).toEqual([])
  }, 30_000)
})

describe('tablesInNode — .rpc 를 표로 바꾼다(합성 소스·합성 대응)', () => {
  const MAP = { known_rpc: ['b_table', 'a_table'], empty_rpc: [] }

  it('리터럴 .rpc 는 대응 표로, 대응 없는 이름은 rpc?: 표지로 — .from 과 합쳐 정렬한다', () => {
    const sf = parse('s.ts', "export async function f(sb) { await sb.from('z_table').select(); await sb.rpc('known_rpc', {}); await sb.rpc('mystery') }")
    expect(tablesInNode(sf, sf, MAP)).toEqual(['a_table', 'b_table', 'rpc?:mystery', 'z_table'])
  })

  it('대응이 빈 RPC 는 표를 더하지 않는다 — 아는 RPC 라 표지도 없다', () => {
    const sf = parse('s.ts', "export async function f(sb) { await sb.rpc('empty_rpc') }")
    expect(tablesInNode(sf, sf, MAP)).toEqual([])
  })

  it('[K8] 리터럴이 아닌 이름(변수·보간 템플릿·요소 접근)은 rpc?:<dynamic> 표지 — DEFINER RPC 는 RLS 2차 방어선이 없어 .from 보다 엄하다', () => {
    for (const call of ['sb.rpc(name)', 'sb.rpc(`x_${name}`)', 'a.rpc(sb, {})', "sb['rpc'](name)", 'sb.rpc()', "sb['rpc'](`known_${name}`)"]) {
      const sf = parse('s.ts', `export async function f(sb, name, a) { await ${call} }`)
      expect(tablesInNode(sf, sf, MAP), call).toEqual([`${UNKNOWN_RPC_PREFIX}${DYNAMIC_RPC}`])
    }
    const lit = parse('s.ts', "export async function f(sb) { await sb['rpc']('known_rpc'); await sb.call('mystery') }")
    expect(tablesInNode(lit, lit, MAP), '요소 접근이라도 리터럴 이름은 대응으로, .rpc 가 아닌 메서드는 세지 않는다').toEqual(['a_table', 'b_table'])
  })

  it('[K8] 비리터럴 허용은 파일 + 호출 식 그대로의 닫힌 목록 — 같은 파일의 다른 식은 표지다', () => {
    const sf = parse('src/app/actions/settings.ts', 'export async function f(a, b, admin) { await a.rpc(admin, {}); await b.rpc(admin, {}) }')
    expect(tablesInNode(sf, sf, MAP)).toEqual([`${UNKNOWN_RPC_PREFIX}${DYNAMIC_RPC}`])
    const only = parse('src/app/actions/settings.ts', 'export async function f(a, admin) { await a.rpc(admin, {}) }')
    expect(tablesInNode(only, only, MAP)).toEqual([])
  })

  it('[K8] 비리터럴 허용 항목은 src 에 선언한 개수만큼 있다(죽은 항목·새 자리 모두 실패)', () => {
    const bad: string[] = []
    for (const [key, { count }] of Object.entries(DYNAMIC_RPC_ALLOW)) {
      const [file, callee] = key.split('#')
      const sf = parse(file, readFileSync(file, 'utf8'))
      let n = 0
      const look = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && x.expression.getText(sf) === callee) n++
        ts.forEachChild(x, look)
      }
      look(sf)
      if (n !== count) bad.push(`${key}: 선언 ${count} · 실측 ${n}`)
    }
    expect(bad).toEqual([])
  })

  it('프로토타입 이름(constructor·toString)은 대응이 아니다 — 표지로 낸다', () => {
    const sf = parse('s.ts', "export async function f(sb) { await sb.rpc('constructor'); await sb.rpc('toString') }")
    expect(tablesInNode(sf, sf, MAP)).toEqual(['rpc?:constructor', 'rpc?:toString'])
  })

  it('기본 대응은 RPC_TABLES — 같은 파일 헬퍼를 따라가는 tablesIn 도 같은 대응을 쓴다', () => {
    const sf = parse('s.ts', [
      "const save = async (sb) => sb.rpc('import_wbs_cmd', {})",
      'export async function f(sb) { await save(sb) }',
    ].join('\n'))
    expect(tablesIn(sf, 'f')).toEqual([...RPC_TABLES.import_wbs_cmd].sort())
  })
})

describe('SQL 판독 — 합성 마이그레이션', () => {
  const BASE = [
    'create table public.alpha (id uuid);',
    'CREATE TABLE beta (id uuid);',
    'create table if not exists public.gamma (id uuid);',
    'create table storage.other (id uuid);',
    'create or replace function public.helper(p uuid) returns void language plpgsql as $$',
    'begin delete from public.gamma where id = p; end; $$;',
    'CREATE OR REPLACE FUNCTION public.rpc_one(p uuid) RETURNS integer LANGUAGE plpgsql AS $function$',
    'begin',
    '  -- 주석 속 update public.beta 는 세지 않는다',
    '  perform 1 from public.beta where id = p for update;',
    '  insert into alpha (id) values (p) on conflict (id) do update set id = excluded.id;',
    '  perform public.helper(p);',
    '  update storage.other set id = p;',
    '  return 1;',
    'end; $function$;',
  ].join('\n')

  it('본문이 쓰는 public 표 + 부르는 public 함수가 쓰는 표(재귀) — 읽기·행 잠금·주석·다른 스키마·on conflict 의 set 은 뺀다', () => {
    const cat = catalogOf([BASE])
    expect([...cat.tables].sort()).toEqual(['alpha', 'beta', 'gamma'])
    expect(sqlWritesOf(cat, 'rpc_one')).toEqual(['alpha', 'gamma'])
  })

  it('같은 이름의 뒤 정의가 이기고, drop 이 표·함수를 뺀다', () => {
    const later = [
      'create or replace function public.rpc_one(p uuid) returns void language sql as $$ update public.beta set id = p $$;',
      'drop table public.alpha;',
      'drop function if exists public.helper(uuid);',
    ].join('\n')
    const cat = catalogOf([BASE, later])
    expect(sqlWritesOf(cat, 'rpc_one')).toEqual(['beta'])
    expect([...cat.tables].sort()).toEqual(['beta', 'gamma'])
    expect(cat.fns.has('helper')).toBe(false)
  })
})
