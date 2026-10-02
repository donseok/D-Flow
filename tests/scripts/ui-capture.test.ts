import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  DEFAULT_SIZES, DIFF_THRESHOLD, SAME_RATIO, deterministicId, fillPath, fontVerdict, hideStyle, kstToday, laneTarget, maskStyle,
  parseArgs, pixelDiffRatio, plusDays, shotFileName, validateRoutes,
} from '../../scripts/ui-capture.mjs'
import { LEVEL_LABELS_4, SEED_ACCOUNTS, seedProjectValues, compareMeta, contextOptions, diffVerdict, fnv1a64, resetTargets, seedIds, seedPlan, selectRoutes } from '../../scripts/ui-capture.mjs'
import { SEED_INVITE_DOMAIN, inviteDomainPatch, resetRunStart, seenResetTargets } from '../../scripts/ui-capture.mjs'
import { LANE_APP_PORTS, laneAppUrl, redactTokens, resolveBase } from '../../scripts/ui-capture.mjs'
import { WARMUP_GRADE, WARMUP_LIMIT_MS, fixedPrefs, passStart, pollUntil, runGrades, warmupFailure } from '../../scripts/ui-capture.mjs'
import { KNOWN_NOISE, buildIdOf, diffRows, envPremise, finalProblem, maskReport, pixelDiffStats, rowVerdict, serverCommitOf, shotSelectors, shotStyle,
  summarizeDiff } from '../../scripts/ui-capture.mjs'
import { axeTable, blend, checksSummary, contrastRgb, escapeHtml, flickerVerdict, focusVerdict, parseRgb, ringsOf, sheetRows, sheetSummary, tabCoverage } from '../../scripts/ui-capture.mjs'
import { computePrefsSync } from '../../src/lib/prefs/sync'
import { findTraces } from '../../scripts/lib/e2e.mjs'
import { deriveSeatState } from '../../src/lib/domain/seatState'
import { computeTree } from '../../src/lib/domain/rollup'
import { milestoneTimeline } from '../../src/lib/domain/dashboard'
import { DEFAULT_MILESTONE_KEYWORDS } from '../../src/lib/settings/defs/project'
import type { ComputedItem } from '../../src/lib/domain/types'
import { weekKeyOf } from '../../src/lib/domain/calendar'

const root = process.cwd()
const pageFiles = (() => {
  const out: string[] = []
  const walk = (d: string) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else if (e === 'page.tsx') out.push(relative(join(root, 'src/app'), f)) } }
  walk(join(root, 'src/app'))
  return out.sort()
})()
const routesDoc = JSON.parse(readFileSync(join(root, 'scripts/ui-capture.routes.json'), 'utf8'))
const LANE = { localDbUrl: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres', supabaseUrl: 'http://127.0.0.1:54421', appUrl: 'http://127.0.0.1:3201' }
const img = (w: number, h: number, fill: number[]) => ({ width: w, height: h, data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => fill[i % 4]) })

describe('laneTarget — 레인 B 스택만(스펙 §3.2·§3.4, Review Focus 3)', () => {
  it('레인 B 좌표는 통과하고 끝 슬래시를 뗀다', () => {
    expect(laneTarget({ ...LANE, supabaseUrl: 'http://127.0.0.1:54421/' })).toEqual({ dbUrl: LANE.localDbUrl, supabaseUrl: 'http://127.0.0.1:54421', appUrl: 'http://127.0.0.1:3201' })
  })
  it.each([
    ['LOCAL_DB_URL 없음', { ...LANE, localDbUrl: undefined }, /LOCAL_DB_URL 이 없다/],
    ['레인 A DB(54322)', { ...LANE, localDbUrl: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }, /54422/],
    ['원격 DB', { ...LANE, localDbUrl: 'postgresql://u:p@db.example.com:54422/postgres' }, /로컬이 아니다/],
    ['api·db 짝 불일치(레인 A api)', { ...LANE, supabaseUrl: 'http://127.0.0.1:54321' }, /54421/],
    ['원격 Supabase', { ...LANE, supabaseUrl: 'https://abc.supabase.co' }, /로컬이 아니다/],
    ['앱 3000', { ...LANE, appUrl: 'http://127.0.0.1:3000' }, /3000/],
    ['원격 앱', { ...LANE, appUrl: 'https://app.example.com' }, /로컬이 아니다/],
  ])('%s → 멈춘다', (_n, input, re) => {
    expect(() => laneTarget(input as typeof LANE)).toThrow(re)
  })
  it('금지 ref 가 끼면 멈춘다', () => {
    expect(() => laneTarget({ ...LANE, appUrl: 'http://rglfgrwwwwdqejohdnty.local:3201' })).toThrow(/금지/)
  })
})

describe('앱 주소 — 레인 B 앱 포트 허용 목록(C-port, UI-0 안전 리뷰 P2-1)', () => {
  it('허용 목록은 3201(머리)·3202·3203(기준 서버)뿐이다', () => {
    expect(LANE_APP_PORTS).toEqual(['3201', '3202', '3203'])
  })
  it.each(['http://127.0.0.1:3201', 'http://localhost:3202', 'http://127.0.0.1:3203'])('%s 는 통과', (u) => {
    expect(laneAppUrl(u)).toBe(u)
    expect(laneAppUrl(`${u}/`)).toBe(u)
  })
  it.each([
    ['3000(사용자·Codex)', 'http://127.0.0.1:3000'], ['3001(Next 가 자동으로 고르는 포트)', 'http://127.0.0.1:3001'],
    ['3101(레인 A)', 'http://127.0.0.1:3101'], ['3102(레인 A)', 'http://localhost:3102'], ['포트 없음(80)', 'http://127.0.0.1'],
  ])('%s 는 멈춘다', (_n, u) => {
    expect(() => laneAppUrl(u)).toThrow(/앱 포트/)
  })
  it('호스트는 127.0.0.1·localhost 만 — 사설·와일드카드·원격 주소는 멈춘다', () => {
    for (const u of ['http://10.0.0.5:3201', 'http://0.0.0.0:3201', 'https://app.example.com', '']) expect(() => laneAppUrl(u)).toThrow(/로컬이 아니다/)
  })
  it('경로·검색어가 붙은 주소는 앱 주소가 아니다', () => {
    for (const u of ['http://127.0.0.1:3201/p', 'http://127.0.0.1:3202/?x=1']) expect(() => laneAppUrl(u)).toThrow(/경로/)
  })
  it('laneTarget 의 앱 주소도 같은 판정 — 3001·3101·3102 를 거부한다', () => {
    for (const port of ['3001', '3101', '3102']) expect(() => laneTarget({ ...LANE, appUrl: `http://127.0.0.1:${port}` })).toThrow(new RegExp(port))
  })
  it('--base 판정 — 없으면 그 실행의 앱 주소(머리), 있으면 같은 허용 목록을 거친다', () => {
    const t = laneTarget(LANE)
    expect(resolveBase(null, t)).toBe('http://127.0.0.1:3201')
    expect(resolveBase(undefined, t)).toBe('http://127.0.0.1:3201')
    expect(resolveBase('http://127.0.0.1:3202', t)).toBe('http://127.0.0.1:3202')
    expect(resolveBase('http://localhost:3203/', t)).toBe('http://localhost:3203')
    for (const bad of ['http://127.0.0.1:3102', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', '']) expect(() => resolveBase(bad, t)).toThrow()
  })
})

describe('배선 — DB·세션 클라이언트와 앱 주소는 laneEnv 한 곳(UI-0 안전 리뷰 P2-2)', () => {
  const read = (f: string) => readFileSync(join(root, f), 'utf8')
  const UC = read('scripts/ui-capture.mjs')
  const PG = read('scripts/perf-grid.mjs')
  /** `export function NAME(` 의 본문 [시작, 끝) — 매개변수 괄호를 건너 첫 { 부터 짝 } 까지. 문자열·템플릿·주석 안은 센다지 않는다 */
  const bodyOf = (text: string, name: string): [number, number] => {
    const at = text.indexOf(`export function ${name}(`)
    if (at < 0) throw new Error(`${name} 정의가 없다`)
    let i = at + `export function ${name}`.length
    let depth = 0
    let open = -1
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue }
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue }
      if (c === '\'' || c === '"' || c === '`') { const q = c; for (i++; i < text.length && text[i] !== q; i++) if (text[i] === '\\') i++; continue }
      if (open < 0) {
        if (c === '(') depth++
        else if (c === ')') depth--
        else if (c === '{' && depth === 0) { open = i; depth = 1 }
        continue
      }
      if (c === '{') depth++
      else if (c === '}' && --depth === 0) return [open, i + 1]
    }
    throw new Error(`${name} 본문의 끝을 못 찾았다`)
  }
  const at = (text: string, re: RegExp) => [...text.matchAll(re)].map((m) => m.index ?? -1)
  const inside = (i: number, [s, e]: [number, number]) => i > s && i < e
  it('createClient(·createServerClient( 는 ui-capture 의 laneEnv 본문 안에서만 — perf-grid 는 그 결과만 쓴다', () => {
    const env = bodyOf(UC, 'laneEnv')
    const hits = at(UC, /\bcreate(?:Server)?Client\s*\(/g)
    expect(hits.length).toBe(2)
    for (const i of hits) expect(inside(i, env)).toBe(true)
    expect(at(PG, /\bcreate(?:Server)?Client\b/g)).toEqual([])
  })
  it('대상 해석을 우회하는 이름이 없다 — resolveTarget·LOCAL_DSN·process.env.NEXT_PUBLIC_SUPABASE·process.env.SUPABASE_(옛 3000 판정 e2eBaseUrl 도)', () => {
    for (const text of [UC, PG]) {
      for (const re of [/resolveTarget/, /LOCAL_DSN/, /process\.env\.NEXT_PUBLIC_SUPABASE/, /process\.env\.SUPABASE_/, /\be2eBaseUrl\b/]) expect(text).not.toMatch(re)
    }
  })
  it('좌표 env(LOCAL_DB_URL·NEXT_PUBLIC_APP_URL)는 laneEnv 본문 안에서만 읽는다', () => {
    const env = bodyOf(UC, 'laneEnv')
    for (const i of at(UC, /process\.env\.(?:LOCAL_DB_URL|NEXT_PUBLIC_APP_URL)\b/g)) expect(inside(i, env)).toBe(true)
    expect(at(PG, /process\.env\.(?:LOCAL_DB_URL|NEXT_PUBLIC_APP_URL)\b/g)).toEqual([])
  })
  it('--base 값은 인자 파서가 옵션으로 옮긴 뒤 laneEnv({ base: … }) → resolveBase 로만 쓰인다', () => {
    for (const [text, parser] of [[UC, 'parseArgs'], [PG, 'measureArgs']] as const) {
      const range = bodyOf(text, parser)
      for (const m of text.matchAll(/\b\w+\.base\b/g)) {
        const i = m.index ?? 0
        const viaLaneEnv = text.slice(i - 'laneEnv({ base: '.length, i) === 'laneEnv({ base: '
        expect(inside(i, range) || viaLaneEnv, `${m[0]} @${i}`).toBe(true)
      }
    }
    const env = bodyOf(UC, 'laneEnv')
    expect(UC.slice(...env)).toMatch(/resolveBase\(base, target\)/)
    for (const i of at(UC, /(?<!function )\bresolveBase\(/g)) expect(inside(i, env)).toBe(true)
    expect(PG).not.toMatch(/\b(?:resolveBase|laneAppUrl)\b/)
  })
  it('시드 순서 — 주간 영역(project_areas)을 주간 문서·행보다 먼저 넣고, 주간 행 리터럴에 지운 열이 없다(SP4 D53)', () => {
    const posOf = (s: string) => UC.indexOf(s)
    const areas = posOf("insertOnce('project_areas', plan.weeklyAreas")
    const reports = posOf("insertOnce('weekly_reports', [plan.weeklyReport]")
    const rows = posOf("insertOnce('weekly_report_rows', plan.weeklyRows")
    expect(areas).toBeGreaterThan(-1)
    expect(areas).toBeLessThan(reports)
    expect(reports).toBeLessThan(rows)
    expect(UC).not.toMatch(/\b(?:section|module):\s*'/)
  })
})

describe('산출물 가림 — 값 기준(UI-0 안전 리뷰 P3-1)', () => {
  const v = { inviteToken: '00000000-0000-4000-8000-0000000015a1', shareToken: '00000000-0000-4000-8000-0000000015a2' }
  it('초대·공유 토큰 원값을 자리표시로 — 경로 모양이 바뀌어도(쿼리·문제 문구 안) 새지 않는다', () => {
    expect(redactTokens(`/invite/${v.inviteToken}`, v)).toBe('/invite/{inviteToken}')
    expect(redactTokens(`final:/share/minutes/${v.shareToken}?next=/invite/${v.inviteToken}`, v)).toBe('final:/share/minutes/{shareToken}?next=/invite/{inviteToken}')
  })
  it('토큰이 없는 문자열은 그대로, 빈 값은 건너뛴다(빈 문자열로 전부를 갈지 않는다)', () => {
    expect(redactTokens('/p/x/dashboard', v)).toBe('/p/x/dashboard')
    expect(redactTokens('/p/x', { inviteToken: '', shareToken: undefined })).toBe('/p/x')
  })
})

describe('pixelDiffRatio — 채널 차 > 16 인 픽셀 비율', () => {
  it('같으면 0, 크기가 다르면 null', () => {
    expect(pixelDiffRatio(img(4, 2, [10, 20, 30, 255]), img(4, 2, [10, 20, 30, 255]))).toBe(0)
    expect(pixelDiffRatio(img(4, 2, [0, 0, 0, 255]), img(2, 4, [0, 0, 0, 255]))).toBeNull()
  })
  it('16 은 같음, 17 은 다름(경계) — 한 픽셀만', () => {
    const a = img(10, 10, [100, 100, 100, 255])
    const b16 = img(10, 10, [100, 100, 100, 255]); b16.data[0] = 116
    const b17 = img(10, 10, [100, 100, 100, 255]); b17.data[0] = 117
    expect(pixelDiffRatio(a, b16)).toBe(0)
    expect(pixelDiffRatio(a, b17)).toBe(0.01)
  })
  it('200×100 에서 500 픽셀이 다르면 0.025(사본 실험과 같은 값)', () => {
    const a = img(200, 100, [255, 255, 255, 255]); const b = img(200, 100, [255, 255, 255, 255])
    for (let p = 0; p < 500; p++) b.data[p * 4 + 1] = 0
    expect(pixelDiffRatio(a, b)).toBe(0.025)
  })
  it('기본 문턱은 상수와 같다(브라우저로 보낼 함수 원문에 리터럴 16)', () => {
    expect(DIFF_THRESHOLD).toBe(16)
    expect(pixelDiffRatio.toString()).toContain('threshold = 16')
    expect(SAME_RATIO).toBe(0.002)
  })
})

describe('maskStyle·fontVerdict·shotFileName·parseArgs·fillPath', () => {
  it('가림 선택자 → 선택자마다 visibility:hidden 규칙 하나(무효 선택자 하나가 다른 가림을 끄지 않는다 — D8), 중복 제거, 빈 목록은 빈 문자열', () => {
    expect(maskStyle(['[title^="함께 보는 중"]', '.x', '.x'])).toBe('[title^="함께 보는 중"] { visibility: hidden !important; }\n.x { visibility: hidden !important; }')
    expect(maskStyle([])).toBe('')
  })
  it.each(['a{b', 'a}', '</style>'])('CSS 주입 모양 %s 은 거부', (s) => { expect(() => maskStyle([s])).toThrow(/금지/) })
  it('숨김 선택자 → 선택자마다 display:none 규칙 하나(폭이 실행마다 바뀌어 이웃을 미는 표시), 중복 제거, 빈 목록은 빈 문자열, 주입 모양 거부', () => {
    expect(hideStyle(['[data-hub-stamp]', '.x', '.x'])).toBe('[data-hub-stamp] { display: none !important; }\n.x { display: none !important; }')
    expect(hideStyle([])).toBe('')
    expect(() => hideStyle(['a{b'])).toThrow(/금지/)
  })
  it('장의 스크린샷 style(조립 — D15) — 공통 가림 + 행 가림은 visibility, 행 숨김은 display, 규칙은 선택자마다', () => {
    const doc = { commonMask: ['.common'] }
    expect(shotStyle(doc, { mask: ['.m1', '.common'], hide: ['.h1'] })).toBe([
      '.common { visibility: hidden !important; }', '.m1 { visibility: hidden !important; }', '.h1 { display: none !important; }',
    ].join('\n'))
    expect(shotStyle({ commonMask: [] }, {})).toBe('')
    expect(shotSelectors(doc, { mask: ['.m1', '.common'], hide: ['.h1'] })).toEqual([
      { sel: '.common', kind: 'common' }, { sel: '.m1', kind: 'mask' }, { sel: '.h1', kind: 'hide' },
    ])
  })
  it('가림 선택자 일치 수(D8) — 행 가림·숨김이 0 이면 경고, 무효(-1)면 문제, 공통 가림 0 은 기록만(화면마다 없을 수 있다)', () => {
    const sels = [{ sel: '.common', kind: 'common' }, { sel: '.m1', kind: 'mask' }, { sel: '.h1', kind: 'hide' }, { sel: 'a:bad(', kind: 'mask' }]
    expect(maskReport(sels, [0, 0, 2, -1])).toEqual({ counts: { '.common': 0, '.m1': 0, '.h1': 2, 'a:bad(': -1 }, zero: ['.m1'], invalid: ['a:bad('] })
    expect(() => maskReport(sels, [1])).toThrow(/수/)
  })
  it('글꼴 — 등록·로드 ≥1 ∧ 로딩 0 만 ok(판정 Q3)', () => {
    expect(fontVerdict({ registered: 92, loaded: 2, loading: 0 })).toBe('ok')
    expect(fontVerdict({ registered: 0, loaded: 0, loading: 0 })).toBe('fallback')
    expect(fontVerdict({ registered: 92, loaded: 0, loading: 0 })).toBe('fallback')
    expect(fontVerdict({ registered: 92, loaded: 2, loading: 1 })).toBe('fallback')
  })
  it('파일명 — 키·크기·테마, 경로 문자는 거부', () => {
    expect(shotFileName({ key: 'p-wbs', width: 1440, height: 900, theme: 'light' })).toBe('p-wbs-1440x900-light.png')
    expect(() => shotFileName({ key: '/p/[id]', width: 1, height: 1, theme: 'light' })).toThrow(/키 형식/)
    expect(() => shotFileName({ key: 'x', width: 1, height: 1, theme: 'sepia' })).toThrow(/테마/)
  })
  it('인자 — 기본값과 파싱, 모르는 인자·값 밖은 throw', () => {
    expect(parseArgs([])).toMatchObject({ theme: ['light'], since: ['b4283c0'], routes: null, sizes: DEFAULT_SIZES.map((s) => [...s]) })
    expect(parseArgs(['--label', 'ui0', '--theme', 'light,dark', '--sizes', '1440x900', '--routes', 'root,p-wbs'])).toMatchObject({
      label: 'ui0', theme: ['light', 'dark'], sizes: [[1440, 900]], routes: ['root', 'p-wbs'],
    })
    expect(() => parseArgs(['--nope'])).toThrow(/알 수 없는/)
    expect(() => parseArgs(['--theme', 'sepia'])).toThrow(/light\|dark/)
    expect(() => parseArgs(['--since', 'UI-9'])).toThrow(/since/)
    expect(() => parseArgs(['--label', '../x'])).toThrow(/label/)
  })
  it('--server-commit(서버 커밋)·--allow-cross(시드·판이 다른 참고 대조) — 기본값은 없음·거짓', () => {
    expect(parseArgs([])).toMatchObject({ serverCommit: null, allowCross: false })
    expect(parseArgs(['ui0', 'ui0b', '--allow-cross'])).toMatchObject({ allowCross: true, positional: ['ui0', 'ui0b'] })
    expect(parseArgs(['--server-commit', 'b4283c0', '--base', 'http://127.0.0.1:3202'])).toMatchObject({ serverCommit: 'b4283c0', base: 'http://127.0.0.1:3202' })
  })
  it('위치 인자(diff 의 두 라벨)도 라벨 형식만 — 경로 문자로 산출 폴더 밖을 읽거나 쓰지 않는다(UI-0 안전 리뷰 P3-2)', () => {
    expect(parseArgs(['ui0', 'ui0b']).positional).toEqual(['ui0', 'ui0b'])
    for (const bad of ['../../../../scripts', 'a/b', 'UI0']) expect(() => parseArgs(['ui0', bad])).toThrow(/라벨/)
  })
  it('경로 템플릿 — 알려진 변수만, 값은 인코딩', () => {
    expect(fillPath('/p/{pid}/wiki/topics/{topicId}', { pid: 'a b', topicId: 't' })).toBe('/p/a%20b/wiki/topics/t')
    expect(() => fillPath('/x/{nope}', {})).toThrow(/알 수 없는/)
    expect(() => fillPath('/p/{pid}', {})).toThrow(/값이 없다/)
  })
  it('결정적 id·날짜', () => {
    expect(deterministicId('a')).toBe(deterministicId('a'))
    expect(deterministicId('a')).not.toBe(deterministicId('b'))
    expect(deterministicId('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(plusDays('2026-09-29', 3)).toBe('2026-10-02')
    expect(plusDays('2026-09-29', -29)).toBe('2026-08-31')
    expect(kstToday(new Date('2026-09-29T15:30:00Z'))).toBe('2026-09-30')   // KST 00:30
  })
})

describe('ui-capture.routes.json', () => {
  it('형식 문제 0 — src/app 의 page.tsx 는 모두 목록에 있고, 기준선(b4283c0) 행은 31', () => {
    expect(validateRoutes(routesDoc, pageFiles)).toEqual([])
    expect(routesDoc.routes.filter((r: { since: string; supplement?: boolean }) => r.since === 'b4283c0' && !r.supplement)).toHaveLength(31)
  })
  it('validateRoutes 가 살아 있다 — 빠진 페이지·키 중복·값 밖을 잡는다', () => {
    const bad = { version: 1, commonMask: [], routes: [
      { key: 'a', path: '/a', file: 'a/page.tsx', grade: 'member', since: 'b4283c0' },
      { key: 'a', path: 'b', grade: 'boss', since: 'UI-9', click: '</x' },
      { key: 'c', path: '/c', grade: 'member', since: 'UI-1', pair: 'zz', expect: ['a{b'], focusStart: 3, focusTargets: [] },
      { key: 'd', path: '/d', grade: 'member', since: 'UI-1', pair: 'c', expect: ['[data-state="BLOCKED"]'], focusStart: 'header', focusTargets: ['aside a'] },
    ] }
    const p = validateRoutes(bad, ['a/page.tsx', 'b/page.tsx'])
    expect(p).toEqual(expect.arrayContaining(['a: 키 중복', 'a: path 는 / 로 시작', 'a: grade 값 밖(boss)', 'a: since 값 밖(UI-9)', 'a: click 선택자', '라우트 목록에 없는 페이지: b/page.tsx',
      'c: pair 대상 없음(zz)', 'c: expect 선택자', 'c: focusStart 선택자', 'c: focusTargets 선택자']))
    expect(p.filter((x) => x.startsWith('d:'))).toEqual([])   // 맞는 선택 필드는 통과(판정 Q35)
  })
  it('설정 표 이름을 담지 않는다(settings-writes 가 scripts 의 json 을 단어로 센다 — 판정 Q7)', () => {
    expect(JSON.stringify(routesDoc)).not.toMatch(/project_settings|workspace_settings|authz_events/)
  })
  it('좌석 확인 — 기본 보기(에이전트)는 좌석 버튼, 막힘 좌석 표지는 레인 보기 보충 행이 본다(판정 Q34 전제 정정)', () => {
    type Row = { key: string; path: string; grade: string; since: string; supplement?: boolean; click?: string; expect?: string[]; init?: Record<string, string> }
    const byKey = (k: string) => (routesDoc.routes as Row[]).find((r) => r.key === k)
    expect(byKey('agents')?.expect).toEqual(['[data-roster-desk]'])
    expect(byKey('p-office')?.expect).toEqual(['[data-roster-desk]'])
    const lane = byKey('p-office-lane')
    expect(lane).toMatchObject({ path: '/p/{pid}/agents/office', grade: 'member', since: 'b4283c0', supplement: true, click: '[data-view="lane"]' })
    expect(lane?.expect).toEqual(['[data-state="BLOCKED"]'])
    expect(lane?.init).toMatchObject({ 'dflow.office.chatter': '0' })
  })
  it('validateRoutes — hide 는 비지 않은 선택자 배열이고 주입 모양을 거부한다', () => {
    const doc = { version: 1, commonMask: [], routes: [
      { key: 'a', path: '/a', file: 'a/page.tsx', grade: 'member', since: 'b4283c0', hide: ['x{y'] },
      { key: 'b', path: '/b', grade: 'member', since: 'UI-1', hide: [] },
      { key: 'c', path: '/c', grade: 'member', since: 'UI-1', hide: '[data-hub-stamp]' },
      { key: 'd', path: '/d', grade: 'member', since: 'UI-1', hide: ['[data-hub-stamp]'] },
    ] }
    expect(validateRoutes(doc, ['a/page.tsx'])).toEqual(['a: hide 선택자', 'b: hide 선택자', 'c: hide 선택자'])
  })
  it('좌석 화면의 시각 표시 — 갱신 시각은 레이아웃에서 빼고(hide) 상대 시각·신호 표식은 가린다(mask) — 과제 5 자기 차이', () => {
    type Row = { key: string; mask?: string[]; hide?: string[] }
    const byKey = (k: string) => (routesDoc.routes as Row[]).find((r) => r.key === k)
    for (const k of ['agents', 'p-office', 'p-office-lane']) expect(byKey(k)?.hide).toEqual(['[aria-label="표시 범위"] + div'])
    expect(byKey('p-agents')?.hide).toEqual(['[data-hub-stamp]'])
    for (const k of ['agents', 'p-office']) {
      expect(byKey(k)?.mask).toEqual(['[data-roster-desk] .tabular-nums', '[data-roster-profile] > section:last-of-type > h3', '[data-roster-profile] > section:last-of-type i'])
    }
  })
})

describe('fixedPrefs — 실행 시작 선호값은 병합이 아니라 고정 객체로 덮는다(UI-0 결정성 리뷰 P2 — D4)', () => {
  it('PrefsSync 가 맞추는 키(새 컨텍스트의 로컬값) + 테마 + pin, 그 밖의 UiPrefs 키는 없다(= 제품 기본값)', () => {
    expect(fixedPrefs('light', { lastProjectId: 'p' })).toEqual({ heroCollapsed: true, sidebarCollapsed: false, locale: 'ko', theme: 'light', lastProjectId: 'p' })
    expect(Object.keys(fixedPrefs('dark'))).toEqual(['heroCollapsed', 'sidebarCollapsed', 'locale', 'theme'])
  })
  it('새 컨텍스트에서 앱의 PrefsSync 가 적용·백필할 것이 없다 — 키 목록은 앱의 동기화 키(computePrefsSync)가 정한다', () => {
    for (const theme of ['light', 'dark'] as const) {
      // 새 컨텍스트의 로컬값 — PrefsSync.readLocal: 히어로 접힘 상수 true · 사이드바 localStorage 없음 → false · 테마 = dflow-theme 쿠키 · 언어 쿠키 없음 → ko
      expect(computePrefsSync(fixedPrefs(theme, { lastProjectId: 'p' }), { heroCollapsed: true, sidebarCollapsed: false, theme, locale: 'ko' }))
        .toEqual({ apply: {}, backfill: {} })
    }
  })
  it('지난 실행·수동 확인이 남긴 키(간트 일 폭·개요 번호·완료 숨김·대시보드 펼침 등)를 이어받지 않는다 — 입력에 지금 값이 없다', () => {
    expect(fixedPrefs.length).toBe(1)   // (theme, pin = {}) — 지금 값을 받지 않는다
    for (const k of ['wbsGanttScale', 'wbsOutline', 'wbsHideDone', 'dashSections', 'minutesView', 'notifRead', 'notif']) expect(fixedPrefs('light')).not.toHaveProperty(k)
  })
  it('테마는 light|dark|system(checks flicker 의 system 패스 — ui1-addendum §5), pin 은 입력을 바꾸지 않는다', () => {
    expect(() => fixedPrefs('sepia')).toThrow(/테마/)
    expect(fixedPrefs('system')).toEqual({ heroCollapsed: true, sidebarCollapsed: false, locale: 'ko', theme: 'system' })
    // system 선호 + 쿠키 system 이면 새 컨텍스트에서 PrefsSync 가 적용·백필할 것이 없다(로컬값 theme = 쿠키 system)
    expect(computePrefsSync(fixedPrefs('system'), { heroCollapsed: true, sidebarCollapsed: false, theme: 'system', locale: 'ko' })).toEqual({ apply: {}, backfill: {} })
    const pin = { lastProjectId: 'p' }
    fixedPrefs('light', pin)
    expect(pin).toEqual({ lastProjectId: 'p' })
  })
})

describe('seenResetTargets — 공지 읽음 워터마크를 지울 계정(과제 5 권고 1, 과제 5b)', () => {
  it('캡처 계정 넷 — 등급 순서 고정(플랫폼 관리자·워크스페이스 관리자·멤버·두 워크스페이스 멤버)', () => {
    expect(seenResetTargets('admin@example.com')).toEqual([
      { grade: 'platformAdmin', email: SEED_ACCOUNTS.platformAdmin }, { grade: 'wsAdmin', email: SEED_ACCOUNTS.wsAdmin },
      { grade: 'member', email: SEED_ACCOUNTS.member }, { grade: 'duo', email: SEED_ACCOUNTS.duo },
    ])
  })
  it('실행에 쓰는 등급과 무관하게 늘 넷이다 — 공개 화면만 찍는 실행도 다음 실행의 시작 상태를 같게 둔다', () => {
    expect(seenResetTargets(undefined).map((t) => t.grade)).toEqual(['platformAdmin', 'wsAdmin', 'member', 'duo'])
  })
  it('부트스트랩 관리자는 넣지 않는다 — 시드 계정과 겹치면 throw(판정 Q4, Review Focus 3)', () => {
    expect(seenResetTargets('admin@example.com').map((t) => t.email)).not.toContain('admin@example.com')
    expect(() => seenResetTargets(` ${SEED_ACCOUNTS.duo.toUpperCase()} `)).toThrow(/부트스트랩/)
  })
})

/** 호출을 적는 가짜 클라이언트 — from(표) 의 delete().in|eq · update(값).in · select(열).eq · upsert(행, 선택) 만 흉내 낸다.
 *  fail 에 표 이름을 주면 그 표의 호출이 오류다. memberships = user_id → 소속 워크스페이스 id */
const fakeDb = (fail?: string, memberships: Record<string, string[]> = {}) => {
  const calls: string[] = []
  const res = (t: string, data: unknown = null) => ({ data, error: t === fail ? { message: 'boom' } : null })
  const db = { from: (t: string) => ({
    delete: () => ({
      in: async (c: string, v: string[]) => { calls.push(`${t} delete ${c} in ${v.join(',')}`); return res(t) },
      eq: async (c: string, v: string) => { calls.push(`${t} delete ${c} = ${v}`); return res(t) },
    }),
    update: (v: Record<string, unknown>) => ({ in: async (c: string, ids: string[]) => { calls.push(`${t} update ${JSON.stringify(v)} ${c} in ${ids.join(',')}`); return res(t) } }),
    select: (cols: string) => ({ eq: async (c: string, v: string) => {
      calls.push(`${t} select ${cols} ${c} = ${v}`)
      return res(t, (memberships[v] ?? []).map((workspace_id) => ({ workspace_id })))
    } }),
    upsert: async (row: { user_id: string; workspace_id: string; prefs: unknown }, o: { onConflict: string }) => {
      calls.push(`${t} upsert ${row.user_id}/${row.workspace_id} ${JSON.stringify(row.prefs)} on ${o.onConflict}`)
      return res(t)
    },
  }) }
  return { db, calls }
}

describe('resetRunStart — 테마 패스 시작 상태 = db:reset 뒤 첫 실행(첫 방문·클릭이 쓰는 상태 셋 — 과제 5b, D4)', () => {
  it('캡처 계정의 공지 읽음 워터마크 → 알림 열람·읽음 되돌리기 → 시드 프로젝트의 진척 스냅샷 순서(그 밖의 표·행은 건드리지 않는다)', async () => {
    const { db, calls } = fakeDb()
    await resetRunStart(db, { userIds: ['u1', 'u2'], projectId: 'p1' })
    expect(calls).toEqual([
      'announcement_seen delete user_id in u1,u2',
      'notification_recipients update {"seen_at":null,"read_at":null} user_id in u1,u2',
      'wbs_progress_snapshots delete project_id = p1',
    ])
  })
  it('오류는 숨기지 않는다 — 그 단계 이름으로 멈춘다', async () => {
    await expect(resetRunStart(fakeDb('announcement_seen').db, { userIds: ['u1'], projectId: 'p1' })).rejects.toThrow(/워터마크.*boom/)
    await expect(resetRunStart(fakeDb('notification_recipients').db, { userIds: ['u1'], projectId: 'p1' })).rejects.toThrow(/알림.*boom/)
    await expect(resetRunStart(fakeDb('wbs_progress_snapshots').db, { userIds: ['u1'], projectId: 'p1' })).rejects.toThrow(/스냅샷.*boom/)
  })
  it('거르는 값이 비면 아무것도 지우거나 고치지 않고 멈춘다 — 조건 없는 삭제·갱신을 만들지 않는다(fail-closed)', async () => {
    for (const bad of [{ userIds: [], projectId: 'p1' }, { userIds: ['u1', ''], projectId: 'p1' }, { userIds: ['u1'], projectId: '' }]) {
      const { db, calls } = fakeDb()
      await expect(resetRunStart(db, bad)).rejects.toThrow(/실행 시작 상태/)
      expect(calls).toEqual([])
    }
  })
})

describe('passStart — 테마 패스의 시작(조립 — UI-0 결정성 리뷰 P3, D15)', () => {
  it('캡처 계정의 선호값을 모든 소속에서 고정 객체로 덮은 뒤 워터마크·알림·스냅샷을 되돌린다 — 순서 고정', async () => {
    const { db, calls } = fakeDb(undefined, { u1: ['wA'], u2: ['wA', 'wB'] })
    await passStart(db, { theme: 'dark', userIds: ['u1', 'u2'], projectId: 'p1' })
    const prefs = JSON.stringify(fixedPrefs('dark', { lastProjectId: 'p1' }))
    expect(calls).toEqual([
      'workspace_members select workspace_id user_id = u1',
      `user_preferences upsert u1/wA ${prefs} on user_id,workspace_id`,
      'workspace_members select workspace_id user_id = u2',
      `user_preferences upsert u2/wA ${prefs} on user_id,workspace_id`,
      `user_preferences upsert u2/wB ${prefs} on user_id,workspace_id`,
      'announcement_seen delete user_id in u1,u2',
      'notification_recipients update {"seen_at":null,"read_at":null} user_id in u1,u2',
      'wbs_progress_snapshots delete project_id = p1',
    ])
  })
  it('선호 쓰기가 실패하면 되돌리기로 넘어가지 않는다', async () => {
    const { db, calls } = fakeDb('user_preferences', { u1: ['wA'] })
    await expect(passStart(db, { theme: 'light', userIds: ['u1'], projectId: 'p1' })).rejects.toThrow(/선호.*boom/)
    expect(calls.some((c) => c.startsWith('announcement_seen'))).toBe(false)
  })
})

describe('속도 계기 사전 방문(T6-R1) — 세션 등급·대기 판정·상한·실패 문구', () => {
  const clock = () => { let t = 0; return { now: () => t, sleep: async (ms: number) => { t += ms } } }
  it('세션 등급 = 라우트의 등급 + 사전 방문 계정(member) — 공개 화면만 찍는 실행도 member 세션을 연다(부트스트랩 관리자로 대신하지 않는다)', () => {
    expect(WARMUP_GRADE).toBe('member')
    expect(runGrades([{ grade: 'public' }])).toEqual(['member'])
    expect(runGrades([{ grade: 'wsAdmin' }, { grade: 'public' }, { grade: 'wsAdmin' }])).toEqual(['wsAdmin', 'member'])
    expect(runGrades([{ grade: 'member' }, { grade: 'platformAdmin' }])).toEqual(['member', 'platformAdmin'])
  })
  it('상한은 30초', () => { expect(WARMUP_LIMIT_MS).toBe(30_000) })
  it('조건이 참이 되면 그때까지의 시도·경과를 낸다', async () => {
    let n = 0
    await expect(pollUntil(async () => ++n >= 3, { limitMs: 30_000, intervalMs: 500, ...clock() })).resolves.toEqual({ ok: true, tries: 3, elapsedMs: 1000 })
  })
  it('상한까지 거짓이면 ok 거짓 — 상한을 넘겨 기다리지 않는다(fail-closed 는 호출자가 throw)', async () => {
    await expect(pollUntil(async () => false, { limitMs: 30_000, intervalMs: 500, ...clock() })).resolves.toEqual({ ok: false, tries: 61, elapsedMs: 30_000 })
    await expect(pollUntil(async () => false, { limitMs: 1200, intervalMs: 500, ...clock() })).resolves.toEqual({ ok: false, tries: 4, elapsedMs: 1200 })
  })
  it('확인 중 조회 오류는 숨기지 않는다 — "아직 없음"으로 위장하지 않는다', async () => {
    await expect(pollUntil(async () => { throw new Error('boom') }, { limitMs: 1000, ...clock() })).rejects.toThrow(/boom/)
  })
  it('상한·간격은 양의 정수', async () => {
    await expect(pollUntil(async () => true, { limitMs: 0, ...clock() })).rejects.toThrow(/상한/)
    await expect(pollUntil(async () => true, { limitMs: 1000, intervalMs: 0, ...clock() })).rejects.toThrow(/간격/)
  })
  it('실패 문구 — 계정·날짜(KST)·서버와 레인 B 스택(54421) 확인 안내, RLS 거부 가능성', () => {
    const m = warmupFailure({ email: 'ui-member@example.com', date: '2026-10-01', baseUrl: 'http://127.0.0.1:3202', limitMs: 30_000 })
    for (const s of ['ui-member@example.com', '2026-10-01', 'KST', 'http://127.0.0.1:3202', '레인 B 스택(54421)', 'RLS', '30초']) expect(m).toContain(s)
  })
})

const CTX = {
  today: '2026-09-29', projectId: '00000000-0000-0000-7e57-000000001501', wsA: '00000000-0000-0000-7e57-000000001502',
  memberIds: { member: '00000000-0000-0000-7e57-000000001503', duo: '00000000-0000-0000-7e57-000000001504', wsAdmin: '00000000-0000-0000-7e57-000000001505' },
  users: { wsAdmin: '00000000-0000-0000-7e57-000000001506' },
}

type SeedRow = { id: string; parent_id: string | null; code: string; sort_order: number; name: string; deliverable: string | null; planned_start: string | null
  planned_end: string | null; weight: number | null; actual_pct: number | null; is_owner_split: boolean; assignee_member_id: string | null; tags: string[] | null; milestone: boolean }
/** 시드 행 → 앱의 계산 트리(src/lib/data/wbs.ts 의 행 사상과 같은 필드, 상태·계획%는 앱의 computeTree 가 낸다 — 공휴일 없음) */
const computedOf = (rows: SeedRow[], today: string): ComputedItem[] => computeTree(rows.map((r) => ({
  id: r.id, parentId: r.parent_id, code: r.code, sortOrder: r.sort_order, name: r.name, biz: null, deliverable: r.deliverable,
  plannedStart: r.planned_start, plannedEnd: r.planned_end, weight: r.weight, actualPct: r.actual_pct, owners: [], isOwnerSplit: r.is_owner_split,
  assigneeMemberId: r.assignee_member_id, agentDelegated: (r.tags ?? []).includes('agent'),
})), today, new Set(), { subActTeamOrder: new Map() })
/** 간트 첫 화면의 행 순서 — 트리 전위 순회, 분리 부모(isOwnerSplit 자식을 가진 노드)는 기본 접힘(WbsGanttSheet 의 splitParentIds 와 같은 규칙) */
const displayRows = (items: ComputedItem[]): ComputedItem[] => {
  const out: ComputedItem[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach((n) => { out.push(n); if (!n.children.some((c) => c.isOwnerSplit)) walk(n.children) })
  walk(items)
  return out
}

describe('seedPlan — 결정적 표본(스펙 §3.4 시드 행)', () => {
  const plan = seedPlan(CTX)
  const wbsRows = plan.wbs as unknown as SeedRow[]
  it('같은 입력이면 같은 행', () => { expect(seedPlan(CTX)).toEqual(plan) })
  it('WBS 61행(3단계 × 3작업 × 5활동 + 1.3 의 이정표 잎 하나 + 1.1.1 아래 세부 3), 깊이 4(level_idx 0..3), 부모가 자식보다 먼저, id 유일', () => {
    expect(plan.wbs).toHaveLength(61)
    expect(new Set(plan.wbs.map((r) => r.level_idx))).toEqual(new Set([0, 1, 2, 3]))
    const seen = new Set<string>()
    for (const r of plan.wbs) { if (r.parent_id) expect(seen.has(r.parent_id)).toBe(true); seen.add(r.id) }
    expect(seen.size).toBe(61)
    expect(LEVEL_LABELS_4).toHaveLength(4)
  })
  it('완료·지연·진행·오늘 마감·예정·이정표·분리 부모가 모두 있다', () => {
    const leaves = plan.wbs.filter((r) => r.weight === 1)
    expect(leaves.some((r) => r.actual_pct === 100 && r.planned_end < CTX.today)).toBe(true)              // 완료
    expect(leaves.some((r) => (r.actual_pct ?? 0) < 100 && r.planned_end < CTX.today)).toBe(true)          // 지연
    expect(leaves.some((r) => r.planned_start <= CTX.today && CTX.today < r.planned_end)).toBe(true)      // 진행
    expect(leaves.some((r) => r.planned_end === CTX.today)).toBe(true)                                     // 오늘 마감
    expect(leaves.some((r) => r.planned_start > CTX.today)).toBe(true)                                     // 예정
    expect(plan.wbs.filter((r) => r.milestone).map((r) => r.code)).toEqual(['1.1.5', '1.3.6', '2.3.5'])
    expect(plan.wbs.filter((r) => r.is_owner_split)).toHaveLength(1)
  })
  // 화면은 wbs_items.milestone 이 아니라 앱의 감지(이름 키워드 ∨ 단일일 + 산출물)로 이정표를 그린다 — 대시보드 '다음 마일스톤'·타임라인과
  // 간트의 이정표 칩·선이 같은 함수(milestoneTimeline)다. 플래그만 보던 옛 단언은 감지 0건인 채 초록이었다(UI-0 충실도 리뷰 P2-1)
  it('이정표 — 앱의 감지(milestoneTimeline, 기본 키워드)로 완료·기한 지남·예정 셋이 하나씩 잡힌다', () => {
    for (const today of [CTX.today, '2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05']) {   // 화·목·토·일·월 — 요일과 무관
      const rows = seedPlan({ ...CTX, today }).wbs as unknown as SeedRow[]
      const codeOf = new Map(rows.map((r) => [r.id, r.code]))
      expect(milestoneTimeline(computedOf(rows, today), today, DEFAULT_MILESTONE_KEYWORDS).map((m) => [codeOf.get(m.id), m.status]))
        .toEqual([['1.1.5', 'done'], ['1.3.6', 'overdue'], ['2.3.5', 'upcoming']])
    }
  })
  it('이정표 잎의 이름은 키워드가 아니다 — 산출물로만 감지되고 다른 화면 글자는 그대로다', () => {
    for (const code of ['1.1.5', '1.3.6', '2.3.5']) {
      const r = wbsRows.find((x) => x.code === code)!
      expect(r.name).toBe(`활동 ${code}`)
      expect(r.planned_start).toBe(r.planned_end)
      expect(r.deliverable?.trim()).toBeTruthy()
    }
  })
  // 간트 첫 화면 = 1~14행(1280 은 15행이 잘린다) · 날짜 창은 1440 오늘 ±15일, 1280 −12~+11, 768 −7~+6, 390 −3~+3(ui0 PNG 실측).
  // 1단계가 오늘보다 17일 넘게 앞서 있어 세 크기의 첫 화면에 막대가 하나도 없었다(UI-0 충실도 리뷰 P2-2) — 가장 좁은 390 창에 넷이 함께 든다
  it('간트 첫 화면(1~14행 · 오늘 ±3일)에 완료·지연·진행·오늘 마감 막대가 함께 든다 — 요일과 무관', () => {
    for (const today of [CTX.today, '2026-10-01', '2026-10-03', '2026-10-04', '2026-10-05']) {
      const shown = displayRows(computedOf(seedPlan({ ...CTX, today }).wbs as unknown as SeedRow[], today)).slice(0, 14)
      const lo = plusDays(today, -3)
      const hi = plusDays(today, 3)
      const bars = shown.filter((n) => n.children.length === 0 && n.plannedStart && n.plannedEnd && n.plannedStart <= hi && n.plannedEnd >= lo)
      const has = (f: (n: ComputedItem) => boolean) => bars.some(f)
      expect(has((n) => n.status === 'done'), `완료 ${today}`).toBe(true)
      expect(has((n) => n.status === 'delayed' && n.plannedEnd! < today), `지연 ${today}`).toBe(true)
      expect(has((n) => n.status === 'in_progress'), `진행 ${today}`).toBe(true)
      expect(has((n) => n.plannedEnd === today && n.status !== 'done'), `오늘 마감 ${today}`).toBe(true)
    }
  })
  it('1단계 끝에 더한 잎(1.3.6)은 다른 잎의 담당 팀을 밀지 않는다 — 원래 47잎은 순서대로 팀 5개를 돈다', () => {
    const leaves = plan.wbs.filter((r) => r.weight === 1 && r.code !== '1.3.6')
    expect(leaves).toHaveLength(47)
    leaves.forEach((l, i) => expect(plan.owners.find((o) => o.wbs_item_id === l.id && o.kind === 'primary')?.team_id).toBe(plan.teams[i % 5].id))
  })
  it('팀 5색, 모든 잎에 primary 담당, 의존은 존재하는 행끼리', () => {
    expect(plan.teams).toHaveLength(5)
    const ids = new Set(plan.wbs.map((r) => r.id))
    const leaves = plan.wbs.filter((r) => r.weight === 1)
    for (const l of leaves) expect(plan.owners.some((o) => o.wbs_item_id === l.id && o.kind === 'primary')).toBe(true)
    for (const d of plan.deps) { expect(ids.has(d.predecessor_id)).toBe(true); expect(ids.has(d.successor_id)).toBe(true) }
    expect(plan.deps.length).toBeGreaterThanOrEqual(3)
  })
  it('날짜는 today 상대값 — 하루 뒤 시드는 모든 날짜가 하루 밀린다', () => {
    const next = seedPlan({ ...CTX, today: '2026-09-30' })
    expect(next.wbs.map((r) => r.planned_end)).toEqual(plan.wbs.map((r) => r.planned_end && (() => { const d = new Date(`${r.planned_end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()))
  })
  it('문구에 고객 흔적이 없다', () => {
    expect(findTraces([{ name: 'seed', text: JSON.stringify(plan) }, { name: 'accounts', text: JSON.stringify(SEED_ACCOUNTS) }])).toEqual([])
  })
  it('seedIds 는 결정적이고 토큰은 plan 의 해시와 짝이다', () => {
    const ids = seedIds(CTX.projectId)
    expect(seedIds(CTX.projectId)).toEqual(ids)
    expect(plan.minutes[0].id).toBe(ids.minuteId)
    expect(plan.wikiTopic.id).toBe(ids.topicId)
    expect(plan.invite.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(plan.invite.token_hash).not.toContain(ids.inviteToken)
  })
  it('에이전트 좌석 1 — agent 태그 잎 하나의 점유·막힘 주문, 시각과 무관하게 BLOCKED(판정 Q34)', () => {
    const o = plan.agentOrder as unknown as { project_id: string; wbs_item_id: string; status: 'claimed'; heartbeat_phase: string; last_heartbeat_at: string; claimed_at: string }
    const wbs = plan.wbs as unknown as { id: string; weight: number | null; actual_pct: number | null; tags: string[] | null }[]
    const tagged = wbs.filter((r) => (r.tags ?? []).includes('agent'))
    expect(tagged.map((r) => r.id)).toEqual([o.wbs_item_id])
    expect(tagged[0].weight).toBe(1)
    expect([o.project_id, o.status, o.heartbeat_phase]).toEqual([CTX.projectId, 'claimed', 'blocked'])
    for (const hours of [0, 2, 48]) {
      const now = Date.parse(`${CTX.today}T00:00:00+09:00`) + hours * 3_600_000
      expect(deriveSeatState({ status: o.status, lastHeartbeatAt: o.last_heartbeat_at, heartbeatPhase: o.heartbeat_phase, updatedAt: o.claimed_at, lastReview: null, actualPct: tagged[0].actual_pct }, now)).toBe('BLOCKED')
    }
  })
  // 아래 기댓값은 전부 레인 B DB 의 public.wiki_fnv1a64 로 확인한 값이다(2026-09-30 실측). 회의록 생성 RPC 가
  // sha256 이 아니라 이 해시를 요구하므로 — FNV-1a 64 와 어긋나면 seed 가 MINUTE_CREATE_INPUT_INVALID 로 죽는다.
  it('fnv1a64 은 SQL 쪽과 같은 값이다 — 회의록 본문 해시 계약(빈 문자열·ASCII·한글 BMP)', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
    expect(fnv1a64('foobar')).toBe('85944171f73967e8')
    expect(fnv1a64('한')).toBe('b037114c8768cf9b')
    expect(fnv1a64('a한')).toBe('07e92607b4153c70')
    expect(fnv1a64('설계 검토 회의')).toBe('1ce8bc02eb78a6e9')
  })
  it('fnv1a64 은 시드의 회의록 본문에서 SQL 실측값과 같다(본문 전체를 해시로 고정)', () => {
    expect(plan.minutes.map((m) => fnv1a64(m.body))).toEqual(['b78d8307b9571ce9', '88019ce70f34c6bc'])
  })
  // SP4 A1(스펙 D53·§3.2) — 주간 행은 구분 문자열이 아니라 영역(project_areas kind='weekly_section') id 로 묶인다. 시드는 영역을 먼저 두고
  // 행에 area_id·project_id 를 싣는다 — 지운 열(section·module·sort_order)을 실으면 PostgREST 가 PGRST204 로 거부한다.
  it('주간 영역 둘 — weekly_section·code 유일·이 프로젝트·순서 1·2·활성, id 는 pid 에서 결정적', () => {
    const areas = plan.weeklyAreas
    expect(areas.map((a) => [a.kind, a.code, a.name, a.sort_order, a.active])).toEqual([
      ['weekly_section', '구축', '구축', 1, true],
      ['weekly_section', '전환', '전환', 2, true],
    ])
    expect(new Set(areas.map((a) => a.code)).size).toBe(areas.length)
    for (const a of areas) expect(a.project_id).toBe(CTX.projectId)
    expect(areas.map((a) => a.id)).toEqual([1, 2].map((n) => deterministicId(`ui-capture:${CTX.projectId}:weekly-area:${n}`)))
    const other = seedPlan({ ...CTX, projectId: '00000000-0000-0000-7e57-000000001599' })
    expect(other.weeklyAreas.map((a) => a.id)).not.toEqual(areas.map((a) => a.id))
  })
  it('주간 행 — 영역 id·프로젝트·문서를 싣고 지운 열은 없다, 네 칸은 문자열(다중 insert 의 키 합집합 — NOT NULL)', () => {
    const areaIds = plan.weeklyAreas.map((a) => a.id)
    expect(plan.weeklyRows).toHaveLength(2)
    for (const r of plan.weeklyRows) {
      expect(Object.keys(r).sort()).toEqual(['area_id', 'id', 'next_content', 'next_issue', 'project_id', 'report_id', 'this_content', 'this_issue'])
      expect(areaIds).toContain(r.area_id)
      expect(r.project_id).toBe(CTX.projectId)
      expect(r.report_id).toBe(plan.weeklyReport.id)
      for (const k of ['this_content', 'this_issue', 'next_content', 'next_issue'] as const) expect(typeof r[k]).toBe('string')
    }
    expect(plan.weeklyRows.map((r) => r.area_id)).toEqual(areaIds)   // (report_id, area_id) 유일 — 영역마다 한 행, 영역 순
  })
  it('옛 모듈 이름은 내용이 있는 칸의 첫 줄 머리표 [모듈] 로 남는다 — 빈 칸에는 붙이지 않는다(이관 규칙과 같은 꼴, 계획 P3·스펙 D29)', () => {
    expect(plan.weeklyRows.map((r) => [r.this_content, r.this_issue, r.next_content, r.next_issue])).toEqual([
      ['[화면]\n목록 화면 초안', '', '[화면]\n상세 화면', ''],
      ['[데이터]\n이관 규칙 정리', '[데이터]\n원천 누락 3건', '[데이터]\n시험 이관', ''],
    ])
  })
})

describe('inviteDomainPatch — 시드 초대가 수락 가능한 카드로 찍히게 워크스페이스 A 의 초대 허용 도메인(과제 5 권고 2, 과제 5b)', () => {
  const K = 'invites.allowed_domains'
  it('허용 도메인은 시드 초대 이메일의 도메인이다', () => {
    expect(SEED_INVITE_DOMAIN).toBe('example.com')
    expect(seedPlan(CTX).invite.email.split('@')[1]).toBe(SEED_INVITE_DOMAIN)
  })
  it('값이 없으면(제품 기본 [] = 초대 불가) 그 도메인 하나를 쓴다 — null·undefined 값도 같다', () => {
    expect(inviteDomainPatch({})).toEqual({ [K]: ['example.com'] })
    expect(inviteDomainPatch(null)).toEqual({ [K]: ['example.com'] })
    expect(inviteDomainPatch(undefined)).toEqual({ [K]: ['example.com'] })
  })
  it('이미 들어 있으면 쓰지 않는다(null — 멱등, 이력 행을 늘리지 않는다). 대소문자·앞뒤 공백은 같은 도메인', () => {
    expect(inviteDomainPatch({ [K]: ['example.com'] })).toBeNull()
    expect(inviteDomainPatch({ [K]: ['acme.test', ' Example.COM '] })).toBeNull()
  })
  it('전체 허용(* 단독)이면 이미 허용이라 쓰지 않는다 — * 와 섞으면 저장값이 무효가 된다', () => {
    expect(inviteDomainPatch({ [K]: ['*'] })).toBeNull()
  })
  it('다른 도메인이 있으면 지우지 않고 뒤에 더한다, 명시 [] 도 같다', () => {
    expect(inviteDomainPatch({ [K]: ['acme.test'] })).toEqual({ [K]: ['acme.test', 'example.com'] })
    expect(inviteDomainPatch({ [K]: [] })).toEqual({ [K]: ['example.com'] })
  })
  it('목록이 아닌 값(손상)은 덮지 않고 멈춘다', () => {
    expect(() => inviteDomainPatch({ [K]: 'example.com' })).toThrow(/손상/)
    expect(() => inviteDomainPatch({ [K]: [1] })).toThrow(/손상/)
  })
  it('patch 에는 그 키 하나만 — 다른 키는 건드리지 않고 입력 객체를 바꾸지 않는다', () => {
    const cur = { 'modules.allowed': ['wiki'], [K]: ['acme.test'] }
    const out = inviteDomainPatch(cur)
    expect(Object.keys(out ?? {})).toEqual([K])
    expect(cur).toEqual({ 'modules.allowed': ['wiki'], [K]: ['acme.test'] })
  })
})

describe('캡처 조건·계정·비교 가능성', () => {
  it('비밀번호 재설정은 시드 계정만 — 부트스트랩 관리자면 throw(판정 Q4, Review Focus 3)', () => {
    expect(resetTargets(['member', 'wsAdmin'], 'admin@example.com')).toEqual([
      { grade: 'member', email: SEED_ACCOUNTS.member }, { grade: 'wsAdmin', email: SEED_ACCOUNTS.wsAdmin },
    ])
    expect(() => resetTargets(['member'], SEED_ACCOUNTS.member.toUpperCase())).toThrow(/부트스트랩/)
    expect(() => resetTargets(['public'], 'admin@example.com')).toThrow(/시드 계정이 아닌/)
  })
  it('컨텍스트 옵션 — 배율 1·ko-KR·서울·모션 줄임·테마 = colorScheme', () => {
    expect(contextOptions({ width: 390, height: 844, theme: 'dark' })).toEqual({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', colorScheme: 'dark',
    })
  })
  it('비교 가능성(Review Focus 2·D3) — KST 날짜·시드 날짜·브라우저는 늘 거부, 스크립트 판·routes 해시·시드 프로젝트는 --allow-cross 로만(경고), 같은 빌드 id 는 경고', () => {
    const a = { kstDate: '2026-09-29', seedDate: '2026-09-29', browser: '145.0.7632.6', scriptCommit: 'aaa1111', routesSha256: 'r1', seedProjectId: 'p1', buildId: 'B1' }
    expect(compareMeta(a, { ...a, buildId: 'B2' })).toEqual({ problems: [], warnings: [] })
    expect(compareMeta(a, { ...a, kstDate: '2026-09-30', buildId: 'B2' }).problems).toEqual(['kstDate 다름: 2026-09-29 ≠ 2026-09-30'])
    expect(compareMeta(a, { ...a, browser: '146.0.0.0', seedDate: '2026-09-28', buildId: 'B2' }).problems).toHaveLength(2)
    expect(compareMeta(a, { ...a, browser: '146.0.0.0', buildId: 'B2' }, { allowCross: true }).problems).toHaveLength(1)   // 날짜·브라우저는 플래그로도 못 넘는다
    expect(compareMeta(a, { ...a, scriptCommit: 'bbb2222', buildId: 'B2' }).problems).toEqual(['scriptCommit 다름: aaa1111 ≠ bbb2222'])
    const cross = compareMeta(a, { ...a, scriptCommit: 'bbb2222', routesSha256: 'r2', seedProjectId: 'p2', buildId: 'B2' }, { allowCross: true })
    expect(cross.problems).toEqual([])
    expect(cross.warnings).toEqual(['참고 대조(--allow-cross): scriptCommit 다름: aaa1111 ≠ bbb2222', '참고 대조(--allow-cross): routesSha256 다름: r1 ≠ r2',
      '참고 대조(--allow-cross): seedProjectId 다름: p1 ≠ p2'])
    expect(compareMeta(a, { ...a }).warnings).toEqual([expect.stringMatching(/빌드 id 가 같다\(B1\)/)])
    const old = { kstDate: '2026-09-29', seedDate: '2026-09-29', browser: '145.0.7632.6', scriptCommit: 'aaa1111' }   // 이 필드들 전의 라벨(ui0)
    expect(compareMeta(old, a).problems).toEqual(['routesSha256 다름: undefined ≠ r1', 'seedProjectId 다름: undefined ≠ p1'])
  })
  it('장 판정(D1) — 0 만 same, 0 초과 0.2% 이하는 near(볼 목록), 넘으면 diff, 글꼴 무효·크기 다름은 건너뜀(판정 Q33 문턱 그대로)', () => {
    expect(diffVerdict({ ratio: 0.5, fontA: 'fallback', fontB: 'ok' })).toBe('skip-font')
    expect(diffVerdict({ ratio: null, fontA: 'ok', fontB: 'ok' })).toBe('skip-size')
    expect(diffVerdict({ ratio: 0, fontA: 'ok', fontB: 'ok' })).toBe('same')
    expect(diffVerdict({ ratio: 1 / 1_296_000, fontA: 'ok', fontB: 'ok' })).toBe('near')   // 1440×900 에서 1px
    expect(diffVerdict({ ratio: 0.002, fontA: 'ok', fontB: 'ok' })).toBe('near')
    expect(diffVerdict({ ratio: 0.0021, fontA: 'ok', fontB: 'ok' })).toBe('diff')
  })
  it('라우트 고르기 — 키 지정(모르는 키 throw), 아니면 since 집합(until 이 집합에 들면 뺀다)', () => {
    const doc = { routes: [{ key: 'a', since: 'b4283c0' }, { key: 'b', since: 'UI-1' }, { key: 'c', since: 'b4283c0', until: 'UI-2a' }] }
    expect(selectRoutes(doc, { routes: null, since: ['b4283c0'] }).map((r) => r.key)).toEqual(['a', 'c'])
    expect(selectRoutes(doc, { routes: null, since: ['b4283c0', 'UI-1', 'UI-2a'] }).map((r) => r.key)).toEqual(['a', 'b'])
    expect(selectRoutes(doc, { routes: ['b'], since: ['b4283c0'] }).map((r) => r.key)).toEqual(['b'])
    expect(() => selectRoutes(doc, { routes: ['zz'], since: [] })).toThrow(/없는 키/)
  })
})

describe('pixelDiffStats — 차이 픽셀 수·영역(UI-0 결정성 리뷰 P2 — D1)', () => {
  it('비율은 pixelDiffRatio 와 같고, 다른 픽셀 수와 차이 영역(bbox)을 낸다', () => {
    const a = img(10, 10, [100, 100, 100, 255])
    const b = img(10, 10, [100, 100, 100, 255])
    for (const [x, y] of [[2, 3], [7, 5]]) b.data[(y * 10 + x) * 4] = 200
    expect(pixelDiffStats(a, b)).toEqual({ ratio: 0.02, diffPixels: 2, bbox: { x: 2, y: 3, w: 6, h: 3 } })
    expect(pixelDiffRatio(a, b)).toBe(0.02)
    expect(pixelDiffStats(a, a)).toEqual({ ratio: 0, diffPixels: 0, bbox: null })
    expect(pixelDiffStats(img(2, 2, [0, 0, 0, 255]), img(2, 3, [0, 0, 0, 255]))).toBeNull()
  })
  it('브라우저로 보내는 원문 — 바깥 식별자 없이 기본 문턱 리터럴 16', () => {
    const src = pixelDiffStats.toString()
    expect(src).toContain('threshold = 16')
    for (const id of ['DIFF_THRESHOLD', 'SAME_RATIO', 'pixelDiffRatio']) expect(src).not.toContain(id)
  })
})

describe('diffRows·rowVerdict·summarizeDiff — diff 의 행 매칭·판정·집계(D1·D2·D11·D15)', () => {
  const row = (key: string, extra: Record<string, unknown> = {}) => ({ key, width: 1440, height: 900, theme: 'light', file: `${key}.png`, font: 'ok', idle: true,
    problems: [] as string[], finalPath: `/${key}`, ...extra })
  const zero = { ratio: 0, diffPixels: 0, bbox: null }
  it('행 매칭 — 둘 다 있는 쌍, 대상에만(new), 기준에만(missing — 부분 실행이 빠진 장을 같음처럼 숨기지 않는다)', () => {
    const r = diffRows([row('a'), row('b'), row('b', { width: 390, height: 844 })], [row('b'), row('c')])
    expect(r.pairs.map((p) => [p.a.key, p.b.width])).toEqual([['b', 1440]])
    expect(r.added.map((x) => x.key)).toEqual(['c'])
    expect(r.missing.map((x) => `${x.key}@${x.width}`)).toEqual(['a@1440', 'b@390'])
  })
  it('어느 쪽이든 문제·idle 거짓·최종 경로 다름이면 problem(사유와 함께) — 같음으로 세지 않는다', () => {
    expect(rowVerdict({ a: row('x', { problems: ['not-found'] }), b: row('x'), stats: zero })).toMatchObject({ verdict: 'problem', reasons: ['기준:not-found'] })
    expect(rowVerdict({ a: row('x'), b: row('x', { idle: false }), stats: zero })).toMatchObject({ verdict: 'problem', reasons: ['대상:idle=false'] })
    expect(rowVerdict({ a: row('x', { finalPath: '/login' }), b: row('x'), stats: zero })).toMatchObject({ verdict: 'problem', reasons: ['finalPath 다름: /login ≠ /x'] })
    expect(rowVerdict({ a: row('x'), b: row('x'), stats: zero })).toMatchObject({ verdict: 'same', ratio: 0, diffPixels: 0, bbox: null, reasons: [] })
    expect(rowVerdict({ a: row('x'), b: row('x'), stats: { ratio: 0.01, diffPixels: 12960, bbox: { x: 1, y: 2, w: 3, h: 4 } } }))
      .toMatchObject({ verdict: 'diff', ratio: 0.01, diffPixels: 12960, bbox: { x: 1, y: 2, w: 3, h: 4 } })
  })
  it('최종 경로는 모양으로 비교 — 시드가 다른 참고 대조(--allow-cross)에서 id·가림 표기만 다르면 problem 이 아니다', () => {
    const p = (fp: string) => row('p', { finalPath: fp })
    expect(rowVerdict({ a: p('/p/00000000-0000-4000-8000-000000000001/wbs'), b: p('/p/00000000-0000-4000-8000-000000000002/wbs'), stats: zero }).verdict).toBe('same')
    expect(rowVerdict({ a: p('/invite/<token>'), b: p('/invite/{inviteToken}'), stats: zero }).verdict).toBe('same')
    expect(rowVerdict({ a: p('/p/00000000-0000-4000-8000-000000000001/wbs'), b: p('/projects'), stats: zero }).verdict).toBe('problem')
  })
  it('알려진 잡음(KNOWN_NOISE — p-agents@768x1024 머리글 1px 스냅)은 near·diff 에 표시만 하고 판정은 바꾸지 않는다', () => {
    expect(KNOWN_NOISE.map((k) => `${k.key}@${k.width}x${k.height}`)).toEqual(['p-agents@768x1024'])
    const pa = (extra = {}) => row('p-agents', { width: 768, height: 1024, ...extra })
    expect(rowVerdict({ a: pa(), b: pa(), stats: { ratio: 0.00178, diffPixels: 1401, bbox: null } })).toMatchObject({ verdict: 'near', known: expect.stringMatching(/머리글/) })
    expect(rowVerdict({ a: pa(), b: pa(), stats: zero })).not.toHaveProperty('known')
    expect(rowVerdict({ a: row('x'), b: row('x'), stats: { ratio: 0.001, diffPixels: 1, bbox: null } })).not.toHaveProperty('known')
  })
  it('집계 — 판정별 수와 볼 목록(problem·diff·missing·new·near — near 도 오른다)', () => {
    const out = [
      { key: 'a', width: 1440, height: 900, theme: 'light', ratio: 0, verdict: 'same' },
      { key: 'b', width: 1440, height: 900, theme: 'light', ratio: 0.001, verdict: 'near' },
      { key: 'p-agents', width: 768, height: 1024, theme: 'light', ratio: 0.00178, verdict: 'near', known: '머리글' },
      { key: 'c', width: 390, height: 844, theme: 'light', ratio: 0.05, verdict: 'diff' },
      { key: 'd', width: 390, height: 844, theme: 'light', ratio: 0, verdict: 'problem', reasons: ['대상:idle=false'] },
      { key: 'e', width: 390, height: 844, theme: 'light', ratio: null, verdict: 'missing' },
      { key: 'f', width: 390, height: 844, theme: 'light', ratio: null, verdict: 'new' },
      { key: 'g', width: 390, height: 844, theme: 'light', ratio: null, verdict: 'skip-font' },
    ]
    const s = summarizeDiff(out)
    expect(s).toMatchObject({ compared: 8, same: 1, near: 2, diff: 1, problem: 1, missing: 1, new: 1, skipped: 1 })
    expect(s.look).toEqual(['d@390x844/light problem 0.00% 대상:idle=false', 'c@390x844/light diff 5.00%', 'e@390x844/light missing —', 'f@390x844/light new —',
      'p-agents@768x1024/light near 0.18% (알려진 잡음: 머리글)', 'b@1440x900/light near 0.10%'])
  })
})

describe('촬영 쪽 판정 — 최종 경로·서버 빌드 id·서버 커밋·env 전제(D2·D3·D9)', () => {
  const v = { pid: 'p1', minuteId: 'm1', topicId: 't1', inviteToken: 'i1', shareToken: 's1', wsSlug: 'default' }
  it('최종 경로(D2) — expectFinal 이 없으면 채운 경로의 pathname 이 기대값, 다르면 final: 문제(권한 거부 리디렉션·로그인 튕김을 잡는다)', () => {
    expect(finalProblem({ path: '/p/{pid}/wbs' }, v, new URL('http://x/p/p1/wbs'))).toBeNull()
    expect(finalProblem({ path: '/p/{pid}/agents' }, v, new URL('http://x/p/p1/dashboard'))).toBe('final:/p/p1/dashboard')
    expect(finalProblem({ path: '/agents' }, v, new URL('http://x/login?next=%2Fagents'))).toBe('final:/login?next=%2Fagents')
    expect(finalProblem({ path: '/p/{pid}/agents/office' }, v, new URL('http://x/p/p1/agents/office?view=lane'))).toBeNull()   // 검색어는 expectFinal 행만 본다
    expect(finalProblem({ path: '/p/{pid}/gantt', expectFinal: '/p/{pid}/wbs?view=timeline' }, v, new URL('http://x/p/p1/wbs?view=timeline'))).toBeNull()
    expect(finalProblem({ path: '/', expectFinal: '/projects' }, v, new URL('http://x/login'))).toBe('final:/login')
  })
  it('지금 routes.json 의 모든 행은 경로가 그대로 최종 경로다(expectFinal 둘 빼고) — ui0 실측과 같다', () => {
    for (const r of routesDoc.routes as { key: string; path: string; expectFinal?: string }[]) {
      if (r.expectFinal) continue
      const filled = fillPath(r.path, v)
      expect(finalProblem(r, v, new URL(`http://x${filled}`)), r.key).toBeNull()
    }
  })
  it('서버 빌드 id(D3) — HTML 의 /_next/static/<id>/_buildManifest.js 또는 RSC 머리의 "b"(이스케이프 포함), 없으면 null', () => {
    expect(buildIdOf('<script src="/_next/static/wrWlxVYxqYm3vMcdnS0hL/_buildManifest.js"></script>')).toBe('wrWlxVYxqYm3vMcdnS0hL')
    expect(buildIdOf('self.__next_f.push([1,"0:{\\"P\\":null,\\"b\\":\\"wrWlxVYxqYm3vMcdnS0hL\\",\\"p\\":\\"\\",\\"c\\":[\\"\\",\\"login\\"]"])')).toBe('wrWlxVYxqYm3vMcdnS0hL')
    expect(buildIdOf('0:{"P":null,"b":"Ab_c-123456","p":"","c":["",""]}')).toBe('Ab_c-123456')
    expect(buildIdOf('<link href="/_next/static/chunks/app.js"><link href="/_next/static/css/x.css">')).toBeNull()
    expect(buildIdOf('<html></html>')).toBeNull()
  })
  it('서버 커밋(D3) — --base 실행은 플래그·env 가 없으면 거부, 형식은 7~40자 16진, 출처를 함께 낸다', () => {
    expect(serverCommitOf({ explicitBase: false, head: 'abc1234' })).toEqual({ commit: 'abc1234', source: 'head' })
    expect(serverCommitOf({ explicitBase: false, envCommit: 'def5678', head: 'abc1234' })).toEqual({ commit: 'def5678', source: 'env' })
    expect(() => serverCommitOf({ explicitBase: true, head: 'abc1234' })).toThrow(/서버 커밋/)
    expect(() => serverCommitOf({ explicitBase: true, envCommit: '  ', head: 'abc1234' })).toThrow(/서버 커밋/)
    expect(serverCommitOf({ explicitBase: true, flagCommit: 'b4283c0', envCommit: 'def5678', head: 'abc1234' })).toEqual({ commit: 'b4283c0', source: 'flag' })
    expect(() => serverCommitOf({ explicitBase: true, flagCommit: 'not-a-sha', head: 'abc1234' })).toThrow(/형식/)
  })
  it('env 전제(D9) — USAGE_TRACKING=on·VERCEL_ENV=production 이면 거부(프로세스 env 가 .env.local 보다 앞선다), LLM 키는 이름만', () => {
    expect(envPremise('A=1\n', {})).toEqual({ problems: [], llmKeys: [] })
    expect(envPremise('USAGE_TRACKING=on\n', {}).problems).toEqual([expect.stringMatching(/USAGE_TRACKING=on/)])
    expect(envPremise('', { VERCEL_ENV: 'production' }).problems).toEqual([expect.stringMatching(/VERCEL_ENV=production/)])
    expect(envPremise('USAGE_TRACKING=on\n', { USAGE_TRACKING: 'off' }).problems).toEqual([])
    const r = envPremise('GEMINI_API_KEY=secret-value\nOPENAI_API_KEY=\n', { LLM_API_KEY: 'x' })
    expect(r.llmKeys).toEqual(['GEMINI_API_KEY', 'LLM_API_KEY'])
    expect(JSON.stringify(r)).not.toContain('secret-value')
  })
  it('위임 표의 신호 시각 칸을 미리 가린다(D10 — 멤버 기본 필터라 지금은 안 보일 뿐, 분 단위 글자)', () => {
    const pa = (routesDoc.routes as { key: string; mask?: string[]; hide?: string[] }[]).find((r) => r.key === 'p-agents')
    expect(pa?.mask).toEqual(['[data-hub-row] td span.tabular-nums'])
    expect(pa?.hide).toEqual(['[data-hub-stamp]'])
  })
})

describe('checks·sheet 의 순수 조각(UI-1 — 계획 판정 Q28)', () => {
  it('parseRgb — rgb·rgba·공백 문법, 못 읽으면 null', () => {
    expect(parseRgb('rgb(49, 92, 219)')).toEqual([49, 92, 219, 1])
    expect(parseRgb('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5])
    expect(parseRgb('rgb(1 2 3 / 50%)')).toEqual([1, 2, 3, 0.5])
    expect(parseRgb('color(srgb 1 0 0)')).toBeNull()
  })
  it('contrastRgb 는 accent.ts 의 식과 같은 값(흰·검정 21, 코발트 on 흰 5.70)', () => {
    expect(contrastRgb([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 5)
    expect(contrastRgb([49, 92, 219, 1], [255, 255, 255, 1])).toBeCloseTo(5.7, 1)
    expect(blend([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1])
  })
  it('focusVerdict — 외곽선 없음·얇음·대비 부족은 실패, 코발트 2px 는 통과', () => {
    expect(focusVerdict({ outlineStyle: 'none', outlineWidth: '0px', outlineColor: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' }).ok).toBe(false)
    expect(focusVerdict({ outlineStyle: 'solid', outlineWidth: '0.5px', outlineColor: 'rgb(49, 92, 219)', background: 'rgb(255, 255, 255)' }).ok).toBe(false)
    expect(focusVerdict({ outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'rgb(220, 226, 234)', background: 'rgb(255, 255, 255)' }).ok).toBe(false)
    expect(focusVerdict({ outlineStyle: 'solid', outlineWidth: '2px', outlineColor: 'rgb(49, 92, 219)', background: 'rgb(255, 255, 255)' }).ok).toBe(true)
  })
  it('ringsOf — 계산된 box-shadow 에서 번짐 고리(x·y·흐림 0, 퍼짐 ≥ 1px)만, 괄호 안 쉼표로 쪼개지 않는다(포커스 ring 유틸)', () => {
    expect(ringsOf('none')).toEqual([])
    expect(ringsOf('rgb(255, 255, 255) 0px 0px 0px 2px, rgb(49, 92, 219) 0px 0px 0px 4px')).toEqual([
      { color: 'rgb(255, 255, 255)', width: 2 }, { color: 'rgb(49, 92, 219)', width: 4 }])
    expect(ringsOf('rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, oklab(0.5 0.01 -0.1 / 0.25) 0px 0px 0px 2px')).toEqual([{ color: 'oklab(0.5 0.01 -0.1 / 0.25)', width: 2 }])
    expect(ringsOf('rgb(49, 92, 219) 0px 0px 0px 2px inset')).toEqual([{ color: 'rgb(49, 92, 219)', width: 2 }])
  })
  it('focusVerdict — 외곽선이 없어도 대비 3:1 고리(ring)가 있으면 통과, 고리가 옅으면 실패(D50 — outline-none + ring 유틸)', () => {
    const none = { outlineStyle: 'none', outlineWidth: '0px', outlineColor: 'rgb(0, 0, 0)', background: 'rgb(255, 255, 255)' }
    expect(focusVerdict({ ...none, rings: [{ color: 'rgb(255, 255, 255)', width: 2 }, { color: 'rgb(49, 92, 219)', width: 4 }] })).toMatchObject({ ok: true, via: 'ring' })
    expect(focusVerdict({ ...none, rings: [{ color: 'rgba(49, 92, 219, 0.25)', width: 2 }] }).ok).toBe(false)
    expect(focusVerdict({ ...none, rings: [] }).why).toMatch(/외곽선 없음/)
  })
  it('flickerVerdict — 첫 페인트와 하이드레이션 뒤가 같고 기대와 같아야', () => {
    expect(flickerVerdict({ atDcl: 'dark', afterHydrate: 'dark', expected: 'dark' }).ok).toBe(true)
    expect(flickerVerdict({ atDcl: 'light', afterHydrate: 'dark', expected: 'dark' }).why).toMatch(/첫 페인트/)
    expect(flickerVerdict({ atDcl: 'light', afterHydrate: 'light', expected: 'dark' }).why).toMatch(/기대/)
  })
  it('escapeHtml·sheetRows — 차이율 큰 순, 차이·axe 가 없으면 new·null', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
    const head = { rows: [
      { key: 'a', width: 1440, height: 900, theme: 'light', file: 'a.png', h1Count: 1, problems: [] },
      { key: 'b', width: 1440, height: 900, theme: 'light', file: 'b.png', h1Count: 0, problems: ['not-found'] },
      { key: 'c', width: 390, height: 844, theme: 'dark', file: 'c.png', h1Count: 1, problems: [] },
    ] }
    const rows = sheetRows(head, [{ key: 'a', width: 1440, height: 900, theme: 'light', ratio: 0, verdict: 'same' }, { key: 'b', width: 1440, height: 900, theme: 'light', ratio: 0.2, verdict: 'diff' }],
      [{ key: 'b', width: 1440, height: 900, theme: 'light', violations: 3 }])
    expect(rows.map((r) => [r.key, r.verdict, r.axe])).toEqual([['b', 'diff', 3], ['a', 'same', null], ['c', 'new', null]])
  })
  it('sheetRows·sheetSummary — 판정 다섯(same·near·diff·problem·missing)+new, 기준에만 있는 장도 행으로, 볼 목록 = diff·near·problem·missing(ui1-addendum §2)', () => {
    const head = { rows: [
      { key: 'a', width: 1440, height: 900, theme: 'light', file: 'a.png', h1Count: 1, problems: [] },
      { key: 'n', width: 1440, height: 900, theme: 'light', file: 'n.png', h1Count: 1, problems: [] },
      { key: 'p', width: 1440, height: 900, theme: 'dark', file: 'p.png', h1Count: 1, problems: ['click-failed'] },
      { key: 's', width: 390, height: 844, theme: 'light', file: 's.png', h1Count: 1, problems: [] },
    ] }
    const diff = [
      { key: 'a', width: 1440, height: 900, theme: 'light', ratio: 0.01, verdict: 'diff', reasons: [] },
      { key: 'n', width: 1440, height: 900, theme: 'light', ratio: 0.001, verdict: 'near', reasons: [] },
      { key: 'p', width: 1440, height: 900, theme: 'dark', ratio: 0, verdict: 'problem', reasons: ['대상:click-failed'] },
      { key: 's', width: 390, height: 844, theme: 'light', ratio: 0, verdict: 'same', reasons: [] },
      { key: 'gone', width: 1440, height: 900, theme: 'light', file: 'gone.png', ratio: null, verdict: 'missing', reasons: [] },
    ]
    const rows = sheetRows(head, diff, [])
    expect(rows.map((r) => [r.key, r.verdict])).toEqual([['a', 'diff'], ['n', 'near'], ['p', 'problem'], ['s', 'same'], ['gone', 'missing']])
    const gone = rows.find((r) => r.key === 'gone')
    expect(gone).toMatchObject({ file: 'gone.png', inHead: false, h1Count: null })
    expect(rows.find((r) => r.key === 'p')?.reasons).toEqual(['대상:click-failed'])
    const sum = sheetSummary(rows)
    expect(sum).toMatchObject({ same: 1, near: 1, diff: 1, problem: 1, missing: 1, new: 0 })
    expect(sum.look.map((r) => r.key)).toEqual(['p', 'a', 'gone', 'n'])
  })
  it('tabCoverage — 대상마다 닿은 걸음 수, 0 이면 unreached(판정 Q43)', () => {
    const steps = [{ matched: ['aside a'] }, { matched: [] }, { matched: ['aside a', 'header button'] }]
    expect(tabCoverage(steps, ['aside a', 'header button', 'tr[role="button"]'])).toEqual({ hits: { 'aside a': 2, 'header button': 1, 'tr[role="button"]': 0 }, unreached: ['tr[role="button"]'] })
    expect(tabCoverage([], [])).toEqual({ hits: {}, unreached: [] })
  })
  it('axeTable — 모든 라벨·테마 행을 싣는다(다크 axe 행 보존 — 판정 Q45)', () => {
    const rows = axeTable([
      { label: 'ui1', key: 'a', width: 1440, height: 900, theme: 'light', violations: 1 },
      { label: 'ui1', key: 'a', width: 1440, height: 900, theme: 'dark', violations: 4 },
      { label: 'ui1', key: 'b', width: 1440, height: 900, theme: 'dark', violations: 0 },
    ])
    expect(rows.map((r) => [r.theme, r.key, r.violations])).toEqual([['dark', 'a', 4], ['dark', 'b', 0], ['light', 'a', 1]])
  })
  it('sheetRows 를 추가 라벨 절에 — 기준 없이 new, axe 는 풀에서 테마로 찾는다(판정 Q45)', () => {
    const extra = { rows: [{ key: 'a', width: 1440, height: 900, theme: 'dark', file: 'a-d.png', h1Count: 1, problems: [] }] }
    const pool = [{ key: 'a', width: 1440, height: 900, theme: 'light', violations: 1 }, { key: 'a', width: 1440, height: 900, theme: 'dark', violations: 4 }]
    expect(sheetRows(extra, [], pool).map((r) => [r.verdict, r.axe])).toEqual([['new', 4]])
  })
  it('checksSummary — Tab 미도달·인쇄 글자 0·쇼케이스 불일치를 실패로(판정 Q43·Q45)', () => {
    const s = checksSummary({
      tab: { rows: [{ key: 'p-wbs', theme: 'dark', failed: 1, unreached: ['[data-row-id] button'] }, { key: 'p-dashboard', theme: 'light', failed: 0, unreached: [] }] },
      print: { rows: [{ key: 'report-modal', theme: 'dark', texts: 0, lowContrast: 0 }] },
      flicker: [{ key: 'account', pref: 'system', ok: true }],
      showcase: [{ name: 'primary', equal: true }, { name: 'notify', equal: false }],
    })
    expect(s.tab?.map((r) => r.ok)).toEqual([false, true])
    expect(s.print?.[0].ok).toBe(false)
    expect(s.flicker?.[0].ok).toBe(true)
    expect(s.showcase).toEqual({ pairs: 2, unequal: ['notify'] })
    expect(checksSummary({})).toEqual({ tab: null, print: null, flicker: null, showcase: null })
  })
})

describe('seedProjectValues — 캡처 프로젝트는 월요일 주 시작 규칙을 생성 때 기록한다(SP5 D28)', () => {
  it('생성 값에 월요일 규칙 하나 — 주간 시드의 week_start 는 그 규칙의 키다', () => {
    const v = seedProjectValues()
    expect(v['calendar.week_start']).toEqual([{ day: 'monday', from: null }])
    expect(v['core.level_labels']).toEqual([...LEVEL_LABELS_4])
    // 시드는 KST 날짜로 이번 주 키를 만든다 — 프로젝트 tz 가 없으면 제품 기본 UTC 라 월요일 00~09시 KST 캡처에서 앱의 '이번 주'가 어긋난다(K6)
    expect(v['calendar.timezone']).toBe('Asia/Seoul')
    const plan = seedPlan(CTX)
    expect(weekKeyOf(v['calendar.week_start'], plan.weeklyReport.week_start)).toBe(plan.weeklyReport.week_start)
  })
  it('cmdSeed 는 프로젝트를 seedProjectValues() 로 만들고, 그 생성이 주간 문서 insert 보다 앞이다', () => {
    const src = readFileSync('scripts/ui-capture.mjs', 'utf8')
    expect(src).toContain('p_values: seedProjectValues(),')
    expect(src.indexOf('p_values: seedProjectValues(),')).toBeLessThan(src.indexOf("insertOnce('weekly_reports', [plan.weeklyReport]"))
  })
})
