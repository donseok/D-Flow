import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  DEFAULT_SIZES, DIFF_THRESHOLD, SAME_RATIO, deterministicId, fillPath, fontVerdict, kstToday, laneTarget, maskStyle,
  parseArgs, pixelDiffRatio, plusDays, shotFileName, validateRoutes,
} from '../../scripts/ui-capture.mjs'

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
  it('가림 선택자 → visibility:hidden 한 규칙, 중복 제거, 빈 목록은 빈 문자열', () => {
    expect(maskStyle(['[title^="함께 보는 중"]', '.x', '.x'])).toBe('[title^="함께 보는 중"], .x { visibility: hidden !important; }')
    expect(maskStyle([])).toBe('')
  })
  it.each(['a{b', 'a}', '</style>'])('CSS 주입 모양 %s 은 거부', (s) => { expect(() => maskStyle([s])).toThrow(/금지/) })
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
})
