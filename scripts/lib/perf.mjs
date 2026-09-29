// scripts/lib/perf.mjs — perf-baseline.mjs 의 순수 조각(부작용 없음). vitest 로 고정한다.
import { localAppUrl } from './e2e.mjs'

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

/** 각 실행의 p95 중앙값으로 기준선 대비 회귀를 판정한다. */
export function judgeRegression(baseRuns, candidateRuns, limit = 0.2) {
  const base = median(baseRuns)
  const cand = median(candidateRuns)
  const ratio = Math.round((cand / base) * 100) / 100
  return { base, cand, ratio, ok: cand <= base * (1 + limit) }
}
