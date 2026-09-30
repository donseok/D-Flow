import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  DEFAULT_SIZES, DIFF_THRESHOLD, SAME_RATIO, deterministicId, fillPath, fontVerdict, kstToday, laneTarget, maskStyle,
  parseArgs, pixelDiffRatio, plusDays, shotFileName, validateRoutes,
} from '../../scripts/ui-capture.mjs'
import { LEVEL_LABELS_4, SEED_ACCOUNTS, compareMeta, contextOptions, diffVerdict, fnv1a64, resetTargets, seedIds, seedPlan, selectRoutes } from '../../scripts/ui-capture.mjs'
import { findTraces } from '../../scripts/lib/e2e.mjs'
import { deriveSeatState } from '../../src/lib/domain/seatState'

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

const CTX = {
  today: '2026-09-29', projectId: '00000000-0000-0000-7e57-000000001501', wsA: '00000000-0000-0000-7e57-000000001502',
  memberIds: { member: '00000000-0000-0000-7e57-000000001503', duo: '00000000-0000-0000-7e57-000000001504', wsAdmin: '00000000-0000-0000-7e57-000000001505' },
  users: { wsAdmin: '00000000-0000-0000-7e57-000000001506' },
}

describe('seedPlan — 결정적 표본(스펙 §3.4 시드 행)', () => {
  const plan = seedPlan(CTX)
  it('같은 입력이면 같은 행', () => { expect(seedPlan(CTX)).toEqual(plan) })
  it('WBS 60행, 깊이 4(level_idx 0..3), 부모가 자식보다 먼저, id 유일', () => {
    expect(plan.wbs).toHaveLength(60)
    expect(new Set(plan.wbs.map((r) => r.level_idx))).toEqual(new Set([0, 1, 2, 3]))
    const seen = new Set<string>()
    for (const r of plan.wbs) { if (r.parent_id) expect(seen.has(r.parent_id)).toBe(true); seen.add(r.id) }
    expect(seen.size).toBe(60)
    expect(LEVEL_LABELS_4).toHaveLength(4)
  })
  it('완료·지연·진행·오늘 마감·예정·이정표·분리 부모가 모두 있다', () => {
    const leaves = plan.wbs.filter((r) => r.weight === 1)
    expect(leaves.some((r) => r.actual_pct === 100 && r.planned_end < CTX.today)).toBe(true)              // 완료
    expect(leaves.some((r) => (r.actual_pct ?? 0) < 100 && r.planned_end < CTX.today)).toBe(true)          // 지연
    expect(leaves.some((r) => r.planned_start <= CTX.today && CTX.today < r.planned_end)).toBe(true)      // 진행
    expect(leaves.some((r) => r.planned_end === CTX.today)).toBe(true)                                     // 오늘 마감
    expect(leaves.some((r) => r.planned_start > CTX.today)).toBe(true)                                     // 예정
    expect(plan.wbs.filter((r) => r.milestone)).toHaveLength(2)
    expect(plan.wbs.filter((r) => r.is_owner_split)).toHaveLength(1)
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
  it('KST 날짜·시드 날짜·브라우저가 다르면 비교하지 않는다(Review Focus 2)', () => {
    const a = { kstDate: '2026-09-29', seedDate: '2026-09-29', browser: '145.0.7632.6' }
    expect(compareMeta(a, { ...a })).toEqual([])
    expect(compareMeta(a, { ...a, kstDate: '2026-09-30' })).toEqual(['kstDate 다름: 2026-09-29 ≠ 2026-09-30'])
    expect(compareMeta(a, { ...a, browser: '146.0.0.0', seedDate: '2026-09-28' })).toHaveLength(2)
  })
  it('장 판정 — 글꼴 무효는 비교 제외, 크기 다름, 0.2% 문턱(판정 Q33)', () => {
    expect(diffVerdict({ ratio: 0.5, fontA: 'fallback', fontB: 'ok' })).toBe('skip-font')
    expect(diffVerdict({ ratio: null, fontA: 'ok', fontB: 'ok' })).toBe('skip-size')
    expect(diffVerdict({ ratio: 0.002, fontA: 'ok', fontB: 'ok' })).toBe('same')
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
