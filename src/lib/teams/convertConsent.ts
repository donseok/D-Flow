// 공용 팀 전환 동의 토큰(SP4 A1-5 R3) — 가져오기 409(NEEDS_TEAMS)가 보여 주는 전환 대상의 지문. 전환은 되돌릴 수 없으므로 동의가 "등록해도 되나"
// 한 비트가 아니라 "이 목록을 전환해도 되나"에 묶여야 한다: 409 가 토큰을 싣고, 상속 프로젝트의 등록 재요청은 그 토큰을 함께 보내며, 서버는
// 지금 상태로 다시 계산한 값과 같을 때만 전환한다(409 와 확인 사이에 공용 팀이 늘거나 활성이 바뀌었거나 등록할 팀이 달라졌으면 다시 409).
// 대상 = 그 프로젝트가 상속하는 공용 팀 전부(비활성 포함 — 전환은 활성 팀과 이 프로젝트가 참조 중인 비활성 팀을 옮기므로 비활성의 변화도 대상이다)
// + 등록할 팀. 보안 경계가 아니라(행위자는 이미 프로젝트 관리자다) 동의 화면의 정확성 장치라 해시는 위조 방지가 아니라 동일성 확인이다.
import { createHash } from 'node:crypto'

export type ConsentTeam = { id: string; code: string; name: string; active: boolean }

/** 전환 동의 토큰 — 입력 순서와 무관(id·code 순 정렬), 앞 128비트(hex 32자) @param common 상속 중인 공용 팀 전부 @param needsTeams 등록할 팀 code */
export function convertConsentToken(common: readonly ConsentTeam[], needsTeams: readonly string[]): string {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  const teams = [...common].sort((a, b) => cmp(a.id, b.id)).map((t) => [t.id, t.code, t.name, t.active])
  const needs = [...new Set(needsTeams)].sort(cmp)
  // JSON 배열이라 필드 경계가 섞이지 않는다('AB'+'C' ≠ 'A'+'BC')
  return createHash('sha256').update(JSON.stringify({ teams, needs })).digest('hex').slice(0, 32)
}
