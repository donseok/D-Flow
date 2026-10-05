import { defaultVocab, type VocabByProject } from '@/lib/settings/vocab'

// SP5 B4 — 화면 테스트의 설정 어휘(기본값). 화면은 상수 대신 이 값을 prop 으로 받는다.
export const ATT_TYPES = defaultVocab('attendance.types')
export const MEET_CATS = defaultVocab('meetings.categories')
export const SEVERITIES = defaultVocab('issues.severities')
export const SOURCES = defaultVocab('issues.sources')
/** 프로젝트를 가로지르는 화면의 범주 맵 — 넘긴 프로젝트마다 기본 범주 */
export const catsFor = (...projectIds: string[]): VocabByProject<'meetings.categories'> =>
  Object.fromEntries(projectIds.map(id => [id, defaultVocab('meetings.categories')]))
/** 어느 프로젝트 id 로 물어도 기본 범주를 주는 맵 — 픽스처의 프로젝트 id 를 일일이 적지 않게(테스트 전용) */
export const ANY_CATS: VocabByProject<'meetings.categories'> = new Proxy({}, {
  get: (_t, key) => (typeof key === 'string' ? defaultVocab('meetings.categories') : undefined),
})
