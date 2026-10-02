// scripts/lib/perf.mjs — perf-baseline.mjs 의 순수 조각(부작용 없음). vitest 로 고정한다.
import { localAppUrl } from './e2e.mjs'
import { resolveTarget } from './targets.mjs'

/** 최근접 순위 백분위(p ∈ (0,100]) — 표본이 작아도 실제 관측값을 돌려준다. */
export function percentile(values, p) {
  if (!values.length) throw new Error('표본 없음')
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

/**
 * 표준 중앙값(짝수 개면 가운데 둘의 산술평균) — percentile 과 다르게 보간한다. 반복 측정(run)들을 하나로
 * 합칠 때 쓴다: 한 run 의 p50/p95 는 이미 그 run 안의 실측 관측값(percentile)이고, 그 run 들을 다시
 * 요약할 때는(리뷰 라운드 1 — 최소 2 회, 그 중앙값으로 게이트) 통계적으로 흔한 중앙값 정의를 쓰는 것이 맞다.
 */
export function median(values) {
  if (!values.length) throw new Error('표본 없음')
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 성능 측정 앱 주소 — 로컬만, main 체크아웃의 사용자 개발 서버(3000)는 거부한다. */
export function perfBaseUrl(value) {
  const url = localAppUrl(value)
  if (new URL(url).port === '3000') throw new Error('성능 측정은 스크래치 워크트리(3101·3102)에서 돈다 — 3000 은 쓰지 않는다')
  return url
}

/**
 * 성능 러너의 직접 접속 DSN — LOCAL_DB_URL 이 반드시 있어야 하고(resolveTarget 의 기본 DSN = 메인 스택 54322 로 떨어지지 않는다 — 래퍼 밖에서
 * 돌려도), .env.local 의 API 와 같은 스택(DB 포트 = API 포트 + 1 — supabase CLI 의 기본 배치)이어야 한다(A2-4 리뷰 P3-3). 금지 ref 는 resolveTarget 이 막는다.
 * @param {Record<string, string | undefined>} env @param {string} apiUrl @returns {string}
 */
export function perfDsn(env, apiUrl) {
  if (!env.LOCAL_DB_URL?.trim()) throw new Error('LOCAL_DB_URL 이 없다 — 성능 러너는 기본 DSN(메인 스택)으로 떨어지지 않는다. 전용 스택 래퍼(lane-a-run.sh 등)로 돌린다')
  const { dsn } = resolveTarget('local', env)
  const dbPort = Number(new URL(dsn).port)
  const apiPort = Number(new URL(apiUrl).port)
  if (!dbPort || !apiPort || dbPort !== apiPort + 1) {
    throw new Error(`LOCAL_DB_URL(포트 ${dbPort || '?'})과 .env.local 의 API(포트 ${apiPort || '?'})가 같은 스택이 아니다 — DB 포트는 API 포트 + 1 이어야 한다`)
  }
  return dsn
}

/** 각 실행의 p95 중앙값으로 기준선 대비 회귀를 판정한다. */
export function judgeRegression(baseRuns, candidateRuns, limit = 0.2) {
  const base = median(baseRuns)
  const cand = median(candidateRuns)
  const ratio = Math.round((cand / base) * 100) / 100
  return { base, cand, ratio, ok: cand <= base * (1 + limit) }
}

/** 측정 경로 이름 — measure --routes 가 받는 값(SP4 §6.5: 판정 경로 wbs·dashboard·export, 기록 weekly). */
export const PERF_ROUTE_NAMES = ['dashboard', 'wbs', 'issues', 'export', 'weekly']
/** 주간 시드·측정의 고정 주(월요일). */
export const PERF_WEEK = '2026-01-05'

/** 시드 프로젝트 이름 — 800 행은 SP2·SP3a 와 같은 PERF, 다른 크기는 따로 둔다(같은 스택에서 서로를 바꾸지 않게). */
export function perfProjectName(items) {
  if (!Number.isInteger(items) || items <= 0) throw new Error(`항목 수는 양의 정수: ${items}`)
  return items === 800 ? 'PERF' : `PERF-${items}`
}

/** WBS 시드 코드 — 단계마다 perStage 개, 마지막 단계는 나머지. 800 이면 지금 시드(10 × 80)와 같다. */
export function wbsSeedCodes(items, perStage = 80) {
  perfProjectName(items)
  return Array.from({ length: items }, (_, k) => {
    const stage = Math.floor(k / perStage) + 1
    const index = (k % perStage) + 1
    return { code: `P.${stage}.${index}`, stage, index, sortOrder: k + 1 }
  })
}

/** 이름 → 경로. export 는 표준 레이아웃 접기(기본), weekly 는 PERF_WEEK 주. */
export function perfRoutes(pid, names) {
  const of = {
    dashboard: `/p/${pid}/dashboard`, wbs: `/p/${pid}/wbs`, issues: `/p/${pid}/issues`,
    export: `/api/export?projectId=${pid}`, weekly: `/p/${pid}/weekly?week=${PERF_WEEK}`,
  }
  return names.map((n) => { if (!of[n]) throw new Error(`모르는 경로 이름: ${n}`); return of[n] })
}

/** 쉼표 목록 — 빈 값·모르는 이름·중복은 throw(측정 조합이 조용히 바뀌지 않게). */
export function parseNameList(value, allowed) {
  const names = String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!names.length) throw new Error('빈 목록')
  for (const n of names) if (!allowed.includes(n)) throw new Error(`모르는 이름: ${n}(허용 ${allowed.join(',')})`)
  if (new Set(names).size !== names.length) throw new Error(`중복: ${value}`)
  return names
}

/** 본문의 서로 다른 시드 코드(P.<n>.<n>) 개수 — 1,500 행 기록의 "항목 수" 확인. */
export function distinctWbsCodes(text) {
  return new Set(String(text).match(/(?<![A-Za-z0-9.])P\.\d+\.\d+(?![0-9])/g) ?? []).size
}

/** 본문의 서로 다른 시드 항목 이름('<단계>단계 업무 <번호>') 개수 — 표준 내보내기에는 코드 열이 없어(스펙 §4.3 표준 레이아웃) 코드가 아니라
 *  이름으로 센다. 화면 HTML 도 같은 규칙으로 센다(한 확인이 두 경로에 같다). */
export function distinctSeedNames(text) {
  return new Set(String(text).match(/(?<![0-9])\d+단계 업무 \d+(?![0-9])/g) ?? []).size
}

/** 측정 대상 IA(SP3b 과제 37 — 옛 경로·새 경로 비교용). null = 경로 이름 셋(perfRoutes)만 — 레인 A 의 쓰임 그대로 */
export const IA_KINDS = Object.freeze(['legacy', 'ws'])

/**
 * 경로 이름 셋에 더할 IA 별 경로(순수). legacy = 옛 IA 의 목록 화면·옛 셸 계약(route·menu), ws = 새 IA 의 홈·프로젝트 목록·새 셸 계약(ws·project).
 * @param {string | null | undefined} ia @param {{ slug: string, wid: string, pid: string }} ids @returns {string[]}
 */
export function iaRoutes(ia, { slug, wid, pid }) {
  if (ia === null || ia === undefined) return []
  if (ia === 'legacy') return ['/projects', `/api/shell?route=${pid}&menu=${pid}`]
  if (ia === 'ws') return [`/w/${encodeURIComponent(slug)}`, `/w/${encodeURIComponent(slug)}/projects`, `/api/shell?ws=${wid}&project=${pid}`]
  throw new Error(`--ia 는 ${IA_KINDS.join('|')}: ${ia}`)
}
