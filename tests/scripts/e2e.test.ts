import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  LEVEL_LABELS, TEMPLATE_HEADER, TRACE_WORDS, cookieHeader, dispositionFilename, e2eRows, findActionId, findTraces,
  localAppUrl, localClientEnv, toCell,
} from '../../scripts/lib/e2e.mjs'
import { FORBIDDEN_REFS } from '../../scripts/lib/targets.mjs'
import { TEMPLATE_HEADER as APP_TEMPLATE_HEADER } from '@/lib/excel/template'

const LOCAL_ENV = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\n'

describe('양식 행', () => {
  it('헤더는 앱 양식과 같다(드리프트 감지)', () => {
    expect(TEMPLATE_HEADER).toEqual([...APP_TEMPLATE_HEADER])
  })
  it('아웃라인 깊이 = 단계 라벨 수, 담당은 말단에만, 형제 가중치 합 1', () => {
    const rows = e2eRows('팀A')
    const codes = rows.map((r) => r[0] as string)
    const isLeaf = (c: string) => !codes.some((o) => o.startsWith(`${c}.`))
    expect(Math.max(...codes.map((c) => c.split('.').length))).toBe(LEVEL_LABELS.length)
    for (const r of rows) expect(r[8]).toBe(isLeaf(r[0] as string) ? '팀A' : '')
    const parentOf = (c: string) => c.split('.').slice(0, -1).join('.')
    const sums = new Map<string, number>()
    for (const r of rows) sums.set(parentOf(r[0] as string), (sums.get(parentOf(r[0] as string)) ?? 0) + (r[6] as number))
    for (const s of sums.values()) expect(s).toBeCloseTo(1)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.length).toBeLessThanOrEqual(5)
  })
})

describe('toCell', () => {
  it("'' → null, 날짜 → UTC 정오, 나머지는 그대로", () => {
    expect(toCell('')).toBeNull()
    expect((toCell('2026-09-21') as Date).toISOString()).toBe('2026-09-21T12:00:00.000Z')
    expect(toCell('1.1')).toBe('1.1')
    expect(toCell(0.5)).toBe(0.5)
    expect(toCell('2026-9-21')).toBe('2026-9-21')
  })
})

describe('localClientEnv — 로컬 .env.local 만', () => {
  it('로컬이면 URL·anon 키', () => {
    expect(localClientEnv(LOCAL_ENV)).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'anon' })
  })
  it('로컬이 아니거나 금지 좌표·중복·누락이면 throw', () => {
    expect(() => localClientEnv('NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\n')).toThrow(/로컬/)
    expect(() => localClientEnv(`NEXT_PUBLIC_SUPABASE_URL=https://${FORBIDDEN_REFS[0]}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\n`)).toThrow(/forbidden/)
    expect(() => localClientEnv(`${LOCAL_ENV}NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\n`)).toThrow(/두 번/)
    expect(() => localClientEnv('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n')).toThrow(/ANON_KEY/)
    expect(() => localClientEnv('')).toThrow(/로컬/)
  })
})

describe('localAppUrl', () => {
  it('로컬 주소만, 끝 슬래시 제거', () => {
    expect(localAppUrl('http://localhost:3001/')).toBe('http://localhost:3001')
    expect(localAppUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(() => localAppUrl('https://example.vercel.app')).toThrow(/로컬/)
    expect(() => localAppUrl('')).toThrow(/로컬/)
  })
})

describe('cookieHeader', () => {
  it('이름=값 을 ; 로 잇고 빈 값은 뺀다', () => {
    expect(cookieHeader([{ name: 'a', value: '1' }, { name: 'b', value: '' }, { name: 'c', value: 'x-y' }])).toBe('a=1; c=x-y')
  })
})

describe('findActionId — 정확히 하나만', () => {
  const entry = (filename: string, exportedName: string, worker = 'app/(app)/projects/page') =>
    ({ workers: { [worker]: { moduleId: '', async: true } }, layer: { [worker]: 'rsc' }, filename, exportedName })
  it('src/ 접두 유무와 무관하게 찾고 worker 목록을 준다', () => {
    const manifest = { node: { aa: entry('app/actions/project.ts', 'listProjects'), bb: entry('app/actions/project.ts', 'createProject') }, edge: {} }
    expect(findActionId(manifest, { filename: 'src/app/actions/project.ts', exportedName: 'createProject' }))
      .toEqual({ id: 'bb', workers: ['app/(app)/projects/page'] })
  })
  it('0건·2건·매니페스트 없음은 throw', () => {
    const one = { node: { aa: entry('app/actions/project.ts', 'createProject') } }
    const two = { node: { aa: entry('app/actions/project.ts', 'createProject') }, edge: { bb: entry('app/actions/project.ts', 'createProject') } }
    expect(() => findActionId(one, { filename: 'src/app/actions/teams.ts', exportedName: 'createProject' })).toThrow(/0건/)
    expect(() => findActionId(two, { filename: 'src/app/actions/project.ts', exportedName: 'createProject' })).toThrow(/2건/)
    expect(() => findActionId(undefined, { filename: 'x', exportedName: 'y' })).toThrow(/0건/)
  })
})

describe('dispositionFilename', () => {
  it('filename* 우선·디코드, 없으면 filename, 둘 다 없으면 대체값', () => {
    const star = `attachment; filename="report.pptx"; filename*=UTF-8''${encodeURIComponent('샘플_9월4주차.pptx')}`
    expect(dispositionFilename(star, 'x')).toBe('샘플_9월4주차.pptx')
    expect(dispositionFilename('attachment; filename="report.xlsx"', 'x')).toBe('report.xlsx')
    expect(dispositionFilename(null, 'fallback.bin')).toBe('fallback.bin')
    expect(dispositionFilename("attachment; filename=\"a.pptx\"; filename*=UTF-8''%E0%A4%A", 'x')).toBe('a.pptx')
  })
  it('경로 구분자는 무해화', () => {
    expect(dispositionFilename(`attachment; filename*=UTF-8''${encodeURIComponent('../a/b\\c.xlsx')}`, 'x')).toBe('.._a_b_c.xlsx')
  })
})

describe('findTraces', () => {
  it('목록의 모든 낱말을 대소문자 무시로 잡는다', () => {
    expect(TRACE_WORDS).toHaveLength(28)
    for (const w of TRACE_WORDS) {
      expect(findTraces([{ name: 'x.xml', text: `앞 ${w.toUpperCase()} 뒤` }]), w).toEqual([{ name: 'x.xml', matches: [w.toUpperCase()] }])
      expect(findTraces([{ name: 'x.xml', text: `<a>${w}</a>` }]), w).toHaveLength(1)
    }
  })
  it('제품명·중립 문구는 적중하지 않는다', () => {
    expect(findTraces([{ name: 'a.xml', text: 'D-Flow 주간보고 · 운영 팀 · Acme Project · example.com' }])).toEqual([])
  })
  it('이 검사기 자신(러너·순수 조각·이 테스트)의 원문에 흔적이 없다', () => {
    const files = ['scripts/lib/e2e.mjs', 'scripts/e2e-local.mjs', 'tests/scripts/e2e.test.ts']
    expect(findTraces(files.map((name) => ({ name, text: readFileSync(name, 'utf8') })))).toEqual([])
  })
})
