import 'server-only'
/**
 * 어휘 쓰기 관문(SP5 B4 §3.6) — 서버 액션이 저장 전에 code 를 그 프로젝트의 활성 어휘로 거르고, DB 트리거(enforce_project_vocab)가
 * 경합으로 남은 틈을 닫는다. 두 관문의 오류를 같은 사용자 문구로 옮긴다(트리거 원문·SQLSTATE 를 화면에 흘리지 않는다).
 * 규칙은 트리거와 같다 — 값이 그대로인 수정(prev === code)은 비활성이어도 통과한다.
 */
import { getProjectConfig, type ConfigReadClient } from './projectConfig'
import { pick } from './pick'
import { activeVocab, VOCAB_KEYS, type VocabEntry, type VocabKey, type VocabValues } from './vocab'

const WHAT: Readonly<Record<VocabKey, string>> = {
  'attendance.types': '근태 유형',
  'meetings.categories': '회의 범주',
  'issues.severities': '심각도',
  'issues.sources': '이슈 원천',
  'issues.cause_categories': '원인 분류',
}
export const vocabInactiveMessage = (key: VocabKey) =>
  `선택한 ${WHAT[key]}은(는) 이 프로젝트에서 쓰지 않습니다. 새로고침 후 다른 값을 고르세요.`
export const ERR_VOCAB_RETRY = '다른 설정 변경과 겹쳤습니다. 잠시 후 다시 시도하세요.'
export const ERR_VOCAB_CONFIG = '프로젝트 설정을 읽지 못했습니다. 잠시 후 다시 시도하세요.'

/** 순수 판정 — code 가 목록의 활성 항목인가(값 그대로인 수정은 통과) */
export function vocabCodeError(key: VocabKey, list: readonly VocabEntry[], code: unknown, prev?: string | null): string | null {
  if (typeof code !== 'string' || !code) return vocabInactiveMessage(key)
  if (prev != null && prev === code) return null
  return activeVocab(list).some(e => e.code === code) ? null : vocabInactiveMessage(key)
}

/** 그 프로젝트의 어휘 하나 — 조회 실패·키 손상은 로그를 남기고 ok:false(호출부가 쓰기를 멈춘다) */
export async function loadProjectVocab<K extends VocabKey>(
  projectId: string, key: K, opts?: { client?: ConfigReadClient },
): Promise<{ ok: true; value: VocabValues[K] } | { ok: false }> {
  try {
    const v = pick(await getProjectConfig(projectId, opts), key)
    if (v.ok) return { ok: true, value: v.value as VocabValues[K] }
    console.error('[vocab] 어휘 설정 손상 — 저장하지 않는다', { projectId, key, error: v.error })
  } catch (e) {
    console.error('[vocab] 프로젝트 설정 조회 실패 — 저장하지 않는다', { projectId, key }, e)
  }
  return { ok: false }
}

/** 프로젝트 설정을 읽어 판정한다. 설정을 못 읽으면 저장하지 않는다(3원칙 ② — 선행 조회 실패는 중단) */
export async function checkProjectVocab(
  projectId: string, key: VocabKey, code: unknown, prev?: string | null, opts?: { client?: ConfigReadClient },
): Promise<string | null> {
  const v = await loadProjectVocab(projectId, key, opts)
  return v.ok ? vocabCodeError(key, v.value, code, prev) : ERR_VOCAB_CONFIG
}

/** DB 쓰기 오류 → 어휘 문구. 어휘와 무관한 오류면 null(호출부의 기존 매핑으로) */
export function vocabWriteFailure(error: { code?: string; message?: string } | null | undefined): string | null {
  if (!error) return null
  const m = error.message ?? ''
  const hit = /^PROJECT_VOCAB_INACTIVE:([a-z_.]+):/.exec(m)
  if (hit && (VOCAB_KEYS as readonly string[]).includes(hit[1])) return vocabInactiveMessage(hit[1] as VocabKey)
  if (error.code === '40P01' || m.startsWith('PROJECT_VOCAB_ISOLATION')) return ERR_VOCAB_RETRY
  if (m.startsWith('SETTINGS_ROW_MISSING')) return ERR_VOCAB_CONFIG
  return null
}
