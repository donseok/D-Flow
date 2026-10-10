/* ── DB 오류의 응답 통로(SP4 스펙 D21·D45, 계획 P4) — 순수. 원문(메시지·세부·SQLSTATE)은 서버 로그로만 남기고 응답·토스트에는
 *    고정 문구만 싣는다. 토큰은 기존 dbToken·mapDbError(src/lib/settings/errors.ts)를 그대로 쓰고 그 표는 늘리지 않는다 — SP3a 규칙:
 *    정상 경로에서 나올 수 없는 토큰(입력 토큰·COMMAND_ID_REQUIRED·*_ISOLATION)은 어느 표에도 없어 null 이고, 호출부가 failWith 로
 *    로그 + 고정 문구(500)를 낸다. SP4 의 새 정상 경로 토큰(PROJECT_NOT_FOUND 404·*_FORBIDDEN 403 등)은 호출부 자기 표다. ── */
import { ERR_CONFIG_BUSY, configText, dbToken, kindOfCode, mapDbError, type DbErrorLike } from '@/lib/settings/errors'
import type { ServerDictKey, ServerTranslate } from '@/lib/i18n/serverDict'   // 타입만 — 서버 사전을 값으로 끌어오지 않는다

/** 호출부 자기 토큰 표 — 키는 토큰(메시지의 ':' 앞 첫 낱말). SQLSTATE 로만 알 수 있는 정상 경로는 호출부가 rpcFailure 앞에서 err.code 로 거른다 */
export type OwnTokenTable = Readonly<Record<string, { status: number; code: string; message: string }>>
/** 화면 코드. token 은 로그용 첫 낱말(55P03·40P01 은 SQLSTATE) — 응답에 싣지 않는다 */
export interface RpcFailure { status: number; code: string; message: string; retryable: boolean; token: string }

/** advisory 잠금을 잡는 RPC 의 `set lock_timeout to '15s'`(스펙 §3.1)를 넘겼다 — 쥔 쪽이 끝나면 풀리므로 재시도할 만하다(D45) */
const LOCK_TIMEOUT = '55P03'

/** 원문 err 를 `[tag] message` 머리로 로그에 남기고 고정 문구 message 를 돌려준다 — 응답의 error 칸에 원문 대신 넣는 통로(D21) */
export function failWith(tag: string, err: unknown, message: string): string {
  console.error(`[${tag}] ${message}`, err)
  return message
}

/**
 * RPC 오류 → 화면 코드. 순서(P4): ① 호출부 자기 표(토큰) ② SQLSTATE 55P03 → 503 재시도 가능 ③ mapDbError(40P01 503·
 * WEEKLY_AREAS_REQUIRED 409·COMMAND_REUSED 422 …, 재시도 여부는 SP3a kindOfCode). 셋 다 아니면 null — 호출부가 failWith 로
 * 로그 + 고정 문구. 결과에 원문을 싣지 않는다.
 */
/** 사전 키로 적는 호출부 표 — 화면에 내보내는 문구는 key, 가드 문구(ERR_DENIED 등)는 message 에 상수로 적는다(그대로 나간다) */
export type OwnTokenKeys = Readonly<Record<string, { status: number; code: string } & ({ key: ServerDictKey } | { message: string })>>
/** 키 표를 요청의 화면 언어로 푼 문구 표 — rpcFailure 에 넘긴다 */
export function tokenTable(own: OwnTokenKeys, t: ServerTranslate): OwnTokenTable {
  return Object.fromEntries(Object.entries(own).map(([token, row]) => [token, { status: row.status, code: row.code, message: 'key' in row ? t(row.key) : row.message }]))
}

export function rpcFailure(err: DbErrorLike, own: OwnTokenTable, t?: ServerTranslate): RpcFailure | null {
  const token = dbToken(err.message)
  if (Object.hasOwn(own, token)) {
    const row = own[token]
    return { status: row.status, code: row.code, message: row.message, retryable: row.status === 503, token }
  }
  if (err.code === LOCK_TIMEOUT) return { status: 503, code: 'CONFIG_BUSY', message: t ? configText(t, ERR_CONFIG_BUSY) : ERR_CONFIG_BUSY, retryable: true, token: LOCK_TIMEOUT }
  const mapped = mapDbError(err, t)
  // mapDbError 가 프로토타입 이름을 걸러낸다(SP4 A2) — 아래 typeof 는 상태 없는 값에 대한 두 번째 방어다
  if (!mapped || typeof mapped.status !== 'number') return null
  return { status: mapped.status, code: mapped.code, message: mapped.message, retryable: kindOfCode(mapped.code).retryable, token: mapped.token }
}
