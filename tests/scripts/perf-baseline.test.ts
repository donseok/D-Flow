import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { IA_KINDS, iaRoutes, judgeRegression, median, percentile, perfBaseUrl, perfDsn } from '../../scripts/lib/perf.mjs'
import { distinctSeedNames, distinctWbsCodes, parseNameList, perfProjectName, perfRoutes, PERF_ROUTE_NAMES, PERF_WEEK, wbsSeedCodes } from '../../scripts/lib/perf.mjs'

describe('percentile — 최근접 순위(표본 밖 보간 없음)', () => {
  it('p50 은 정렬된 가운데 관측값', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
  })
  it('p95 는 1..20 중 19(20 이 아니다 — 최근접 순위는 올림한 인덱스)', () => {
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19)
  })
  it('빈 배열은 throw', () => {
    expect(() => percentile([], 50)).toThrow('표본 없음')
  })
})

describe('median — 표준 중앙값(짝수 개는 가운데 둘의 평균, percentile 과 다르게 보간한다)', () => {
  it('홀수 개는 가운데 관측값', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('짝수 개(정확히 2회 반복 측정)는 산술평균', () => {
    expect(median([4, 6])).toBe(5)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('빈 배열은 throw', () => {
    expect(() => median([])).toThrow('표본 없음')
  })
})

describe('perfBaseUrl — 격리된 로컬 앱만 측정', () => {
  it('3101·3102 는 통과하고 사용자 dev 서버 3000 과 원격은 거부한다', () => {
    expect(perfBaseUrl('http://localhost:3101/')).toBe('http://localhost:3101')
    expect(perfBaseUrl('http://127.0.0.1:3102')).toBe('http://127.0.0.1:3102')
    expect(() => perfBaseUrl('http://localhost:3000')).toThrow('3000')
    expect(() => perfBaseUrl('https://example.vercel.app')).toThrow()
  })
})

describe('judgeRegression — 반복 측정의 p95 중앙값 비교', () => {
  it('중앙값 비율로 +20% 이내를 판정한다', () => {
    expect(judgeRegression([100, 110, 90], [115, 119, 130], 0.2)).toEqual({ base: 100, cand: 119, ratio: 1.19, ok: true })
    expect(judgeRegression([100, 100, 100], [121, 125, 119], 0.2)).toMatchObject({ ratio: 1.21, ok: false })
  })
  it('빈 표본은 거부한다', () => { expect(() => judgeRegression([], [1])).toThrow('표본 없음') })
})


describe('perf-baseline — 좌표는 resolveTarget 한 길(SP3b 알림 11)', () => {
  const src = readFileSync('scripts/perf-baseline.mjs', 'utf8')
  it('LOCAL_DSN 상수를 쓰지 않고 perfDsn(→ resolveTarget(\'local\')) 로 DSN 을 얻는다 — .env.local 의 API 좌표와 대조', () => {
    expect(src).not.toMatch(/\bLOCAL_DSN\b/)
    expect(src).not.toMatch(/resolveTarget\(/)
    expect(src).toMatch(/perfDsn\(process\.env, target\.url\)/)
  })
})

describe('perfDsn — LOCAL_DB_URL 이 없으면 메인 스택(54322)으로 떨어지지 않는다(A2-4 리뷰 P3-3 · W2)', () => {
  const sp4 = 'postgresql://postgres:postgres@127.0.0.1:54522/postgres'
  it('LOCAL_DB_URL 이 API 포트 + 1 이면 그 DSN', () => {
    expect(perfDsn({ LOCAL_DB_URL: sp4 }, 'http://127.0.0.1:54521')).toBe(sp4)
  })
  it('LOCAL_DB_URL 이 없거나 비면 throw — resolveTarget 의 기본 DSN 으로 가지 않는다', () => {
    expect(() => perfDsn({}, 'http://127.0.0.1:54521')).toThrow(/LOCAL_DB_URL/)
    expect(() => perfDsn({ LOCAL_DB_URL: '  ' }, 'http://127.0.0.1:54321')).toThrow(/LOCAL_DB_URL/)
  })
  it('DSN 과 .env.local 의 API 가 다른 스택이면 throw', () => {
    expect(() => perfDsn({ LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }, 'http://127.0.0.1:54521')).toThrow(/같은 스택/)
  })
  it('금지 ref 는 resolveTarget 이 그대로 막는다', () => {
    expect(() => perfDsn({ LOCAL_DB_URL: 'postgresql://x@db.rglfgrwwwwdqejohdnty.supabase.co:5432/postgres' }, 'http://127.0.0.1:5431')).toThrow(/금지/)
  })
})

describe('perf 도우미 — 시드·경로(SP4 §6.5)', () => {
  it('프로젝트 이름 — 800 은 지금 PERF, 그 밖은 PERF-<n>', () => {
    expect(perfProjectName(800)).toBe('PERF')
    expect(perfProjectName(1500)).toBe('PERF-1500')
    expect(() => perfProjectName(0)).toThrow()
    expect(() => perfProjectName(1.5)).toThrow()
  })
  it('시드 코드 — 800 은 지금 시드와 같다(10 단계 × 80, P.i.j, sort_order 연속)', () => {
    const c = wbsSeedCodes(800)
    expect(c).toHaveLength(800)
    expect(c[0]).toEqual({ code: 'P.1.1', stage: 1, index: 1, sortOrder: 1 })
    expect(c[799]).toEqual({ code: 'P.10.80', stage: 10, index: 80, sortOrder: 800 })
  })
  it('시드 코드 — 1,500 은 19 단계(마지막 단계 60개), 코드가 모두 다르다', () => {
    const c = wbsSeedCodes(1500)
    expect(c).toHaveLength(1500)
    expect(c.at(-1)).toEqual({ code: 'P.19.60', stage: 19, index: 60, sortOrder: 1500 })
    expect(new Set(c.map((x) => x.code)).size).toBe(1500)
  })
  it('경로 — 이름 순서대로, export 는 라우트·weekly 는 고정 주', () => {
    expect(perfRoutes('pid', ['wbs', 'export', 'weekly'])).toEqual(['/p/pid/wbs', '/api/export?projectId=pid', `/p/pid/weekly?week=${PERF_WEEK}`])
    expect(perfRoutes('pid', ['dashboard', 'issues'])).toEqual(['/p/pid/dashboard', '/p/pid/issues'])
    expect(PERF_WEEK).toBe('2026-01-05')
  })
  it('이름 목록 — 쉼표, 모르는 이름·빈 값·중복은 거부', () => {
    expect(parseNameList('wbs,dashboard', PERF_ROUTE_NAMES)).toEqual(['wbs', 'dashboard'])
    expect(() => parseNameList('', PERF_ROUTE_NAMES)).toThrow()
    expect(() => parseNameList('wbs,gantt', PERF_ROUTE_NAMES)).toThrow('gantt')
    expect(() => parseNameList('wbs,wbs', PERF_ROUTE_NAMES)).toThrow('중복')
  })
  it('항목 수 — 서로 다른 P.<n>.<n> 의 개수(같은 코드가 여러 번 나와도 하나, 더 긴 숫자 열의 앞부분을 세지 않는다)', () => {
    expect(distinctWbsCodes('P.1.1 P.1.1 P.1.2 P.10.80')).toBe(3)
    expect(distinctWbsCodes('P.1.1 P.1.12')).toBe(2)
    expect(distinctWbsCodes('xP.1.1 1P.2.2')).toBe(0)
    expect(distinctWbsCodes('')).toBe(0)
  })
  it('항목 이름 — 서로 다른 \'<n>단계 업무 <n>\' 의 개수(표준 내보내기는 코드 열이 없다), 더 긴 숫자의 앞부분을 세지 않는다', () => {
    expect(distinctSeedNames('<t>1단계 업무 1</t><t>1단계 업무 1</t><t>1단계 업무 12</t><t>10단계 업무 80</t>')).toBe(3)
    expect(distinctSeedNames('21단계 업무 1 · 21단계 업무 10')).toBe(2)
    expect(distinctSeedNames('')).toBe(0)
  })
  it('측정의 항목 수 확인은 이름으로 센다 — 코드로 세면 표준 내보내기가 늘 0 이다', () => {
    const src = readFileSync('scripts/perf-baseline.mjs', 'utf8')
    expect(src).toMatch(/counts\[path\] = distinctSeedNames\(text\)/)
  })
})

describe('iaRoutes — IA 별로 경로 셋에 더할 경로(SP3b 과제 37, D32)', () => {
  const ids = { slug: 'acme', wid: 'w-1', pid: 'p-1' }
  it('legacy = 옛 목록 화면과 옛 셸 계약(route·menu)', () => {
    expect(iaRoutes('legacy', ids)).toEqual(['/projects', '/api/shell?route=p-1&menu=p-1'])
  })
  it('ws = 새 홈·프로젝트 목록·새 셸 계약(ws·project)', () => {
    expect(iaRoutes('ws', ids)).toEqual(['/w/acme', '/w/acme/projects', '/api/shell?ws=w-1&project=p-1'])
  })
  it('없으면 더할 것이 없다(경로 이름 셋만 — 레인 A 의 쓰임 그대로), 모르는 값은 throw', () => {
    expect(iaRoutes(null, ids)).toEqual([])
    expect(iaRoutes(undefined, ids)).toEqual([])
    expect(() => iaRoutes('both', ids)).toThrow(/legacy\|ws/)
    expect(IA_KINDS).toEqual(['legacy', 'ws'])
  })
  it('perf-baseline.mjs 배선 — measure 가 --ia 를 받아 perfRoutes 뒤에 iaRoutes 를 더한다(원문 확인 — 스크립트는 import 하면 바로 돈다)', () => {
    const src = readFileSync('scripts/perf-baseline.mjs', 'utf8')
    expect(src).toMatch(/a === '--ia'/)
    expect(src).toMatch(/\[\.\.\.perfRoutes\(project\.id, routeNames\), \.\.\.iaRoutes\(ia,/)
  })
})
