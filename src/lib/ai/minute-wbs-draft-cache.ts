import 'server-only'
// 회의록 → WBS 초안의 AI 응답 캐시(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §7) — 이슈 초안(app/actions/issues.ts 의
// summarizeVerifiedMinuteBlock)과 같은 인스턴스 캐시다. 같은 프롬프트(줄 원문·위치 후보·명단·회의 날짜가 모두 든다)로 창을 다시 열 때 모델 비용·
// 대기를 만들지 않고, 동시에 온 같은 요청은 진행 중인 호출 하나를 함께 기다린다.
// 서버리스 인스턴스 로컬이라 정합성 경계가 아니다 — 원문 앵커·후보·명단은 매 요청 다시 읽고 검증한다. 담는 값은 별칭(후보 c1…·멤버 m1…) 단위의
// 파싱 결과이고, 실제 id 는 매번 그 요청의 대응표로 푼다(같은 프롬프트면 별칭이 가리키는 경로·이름도 같다).
// 'use server' 파일(액션)에 두면 모듈 상태를 비우는 시험용 함수를 내보낼 수 없어(내보낸 함수가 서버 액션이 된다) 서버 라이브러리에 둔다.
import type { MinuteWbsAiRow } from './minute-wbs-draft'

/** 담아 두는 프롬프트 수 — 넘치면 가장 먼저 담은 것부터 버린다(이슈 초안 캐시와 같은 꼴) */
const CACHE_MAX = 150

const cache = new Map<string, MinuteWbsAiRow[]>()
const inFlight = new Map<string, Promise<MinuteWbsAiRow[] | null>>()

function remember(key: string, rows: MinuteWbsAiRow[]): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, rows)
}

/**
 * key 의 AI 줄 — 담아 둔 값이 있으면 그것, 같은 key 로 진행 중인 호출이 있으면 그 결과, 아니면 run 을 한 번 부른다.
 * 못 쓴 응답(null)과 빈 응답([])은 담지 않는다 — 일시 장애·빈 답 뒤 다음 열기에서 다시 시도한다(이슈 초안이 폴백을 담지 않는 것과 같다).
 * AI 를 쓸 수 없을 때는 부르지 않는다(호출자가 판정한다 — 끈 뒤에 옛 AI 초안이 나오지 않게).
 */
export async function cachedMinuteWbsDraft(key: string, run: () => Promise<MinuteWbsAiRow[] | null>): Promise<MinuteWbsAiRow[] | null> {
  const hit = cache.get(key)
  if (hit) return hit
  const existing = inFlight.get(key)
  if (existing) return existing
  const pending = (async () => {
    const rows = await run()
    if (rows !== null && rows.length > 0) remember(key, rows)
    return rows
  })()
  inFlight.set(key, pending)
  try {
    return await pending
  } finally {
    if (inFlight.get(key) === pending) inFlight.delete(key)
  }
}

/** 시험용 — 담아 둔 값과 진행 중 표를 비운다(케이스 사이에 앞 케이스의 응답이 새지 않게) */
export function clearMinuteWbsDraftCache(): void {
  cache.clear()
  inFlight.clear()
}
