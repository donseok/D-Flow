import 'server-only'
// 회의록 → 프로그램 설계서·화면 목업의 AI 응답 캐시(minute-wbs-draft-cache.ts 와 같은 인스턴스 로컬 LRU + 진행 중 호출 합치기).
// 같은 원문·피드백 프롬프트로 창이나 탭을 다시 열 때 중복 LLM 호출·대기를 없애고, 동시에 온 같은 요청은 진행 중인 호출 하나를 함께 기다린다.
// 실패(null)는 담지 않아 다음 시도에서 바로 다시 생성할 수 있게 한다.
import type { DesignSpec, MockupSpec } from '@/lib/domain/mockup'

const CACHE_MAX = 100

const designCache = new Map<string, DesignSpec>()
const designInFlight = new Map<string, Promise<DesignSpec | null>>()

const mockupCache = new Map<string, MockupSpec>()
const mockupInFlight = new Map<string, Promise<MockupSpec | null>>()

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= CACHE_MAX) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

export async function cachedMinuteDesignSpec(key: string, run: () => Promise<DesignSpec | null>): Promise<DesignSpec | null> {
  const hit = designCache.get(key)
  if (hit) return hit
  const existing = designInFlight.get(key)
  if (existing) return existing
  const pending = (async () => {
    const spec = await run()
    if (spec !== null) remember(designCache, key, spec)
    return spec
  })()
  designInFlight.set(key, pending)
  try {
    return await pending
  } finally {
    if (designInFlight.get(key) === pending) designInFlight.delete(key)
  }
}

export async function cachedMinuteMockup(key: string, run: () => Promise<MockupSpec | null>): Promise<MockupSpec | null> {
  const hit = mockupCache.get(key)
  if (hit) return hit
  const existing = mockupInFlight.get(key)
  if (existing) return existing
  const pending = (async () => {
    const spec = await run()
    if (spec !== null) remember(mockupCache, key, spec)
    return spec
  })()
  mockupInFlight.set(key, pending)
  try {
    return await pending
  } finally {
    if (mockupInFlight.get(key) === pending) mockupInFlight.delete(key)
  }
}

/** 시험용 — 담아 둔 값과 진행 중 표를 비운다 */
export function clearMinuteMockupCache(): void {
  designCache.clear()
  designInFlight.clear()
  mockupCache.clear()
  mockupInFlight.clear()
}
