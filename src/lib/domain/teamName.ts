// 팀 이름 규칙(SP4 D37·계획 P5) — 순수. code 는 불변이고 이름(teams.name)만 바꾼다. 비교는 NFKC·trim·소문자 — 봇 라우터가 대소문자를
// 무시해 code·name 을 찾으므로(§4.2.2) 'ops' 와 'OPS' 를 두 팀 이름으로 두면 둘 다 모호해져 사람이 팀을 부를 수 없다. DB 제약은 없다 —
// 동시 개명 경합과 범위가 다른 팀끼리의 겹침은 봇의 모호 거부가 맡는다(스펙 §10 K14).
import { isHeaderWordMatch } from '@/lib/excel/headerWords'

export const TEAM_NAME_MAX = 40

export const normalizeTeamName = (s: string) => s.normalize('NFKC').trim()
export const teamNameKey = (s: string) => normalizeTeamName(s).toLowerCase()

export function checkTeamRename(input: {
  name: unknown; selfId: string; selfCode: string
  siblings: readonly { id: string; code: string; name: string }[]
  reserved: readonly string[]
}): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof input.name !== 'string') return { ok: false, error: '팀 이름을 입력하세요.' }
  const name = normalizeTeamName(input.name)
  if (!name) return { ok: false, error: '팀 이름을 입력하세요.' }
  if ([...name].length > TEAM_NAME_MAX) return { ok: false, error: `팀 이름은 ${TEAM_NAME_MAX}자 이하여야 합니다.` }
  const key = teamNameKey(name)
  const backToOwnCode = key === teamNameKey(input.selfCode)
  if (!backToOwnCode && input.reserved.some((w) => isHeaderWordMatch(w, name))) {
    return { ok: false, error: `'${name}'는 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.` }
  }
  const clash = input.siblings.find((s) => s.id !== input.selfId && (teamNameKey(s.code) === key || teamNameKey(s.name) === key))
  if (clash) return { ok: false, error: `같은 범위의 다른 팀(${clash.code})의 코드·이름과 겹칩니다.` }
  return { ok: true, name }
}

/** 새 팀 code 가 같은 범위 다른 팀의 code·이름과 겹치는가 — 개명 규칙(checkTeamRename)의 대칭(A2-1 리뷰 정확성 P3). 개명이 생기면서 반대 방향
 *  (기존 팀을 '운영' 으로 개명한 뒤 code '운영' 인 새 팀 추가)도 봇이 두 팀을 같은 낱말로 보게 된다. 정확히 같은 code 는 호출부의 "이미 있음"
 *  (등록의 existing·추가의 중복 거부)이 맡으므로 여기서는 보지 않는다. 겹치면 그 팀의 code, 아니면 null */
export function newTeamCodeClash(code: string, siblings: readonly { code: string; name: string }[]): string | null {
  const key = teamNameKey(code)
  const hit = siblings.find((s) => s.code !== code && (teamNameKey(s.code) === key || teamNameKey(s.name) === key))
  return hit ? hit.code : null
}
export const teamCodeClashError = (code: string, clash: string) => `'${code}'는 같은 범위의 다른 팀(${clash})의 코드·이름과 겹칩니다.`
/** 새 code 목록의 첫 겹침 — 기존 팀(siblings)과, 그리고 앞서 통과한 새 code 끼리(A2-2 리뷰 보안 P3 — 한 번의 가져오기에 ab·AB 가 함께
 *  등록되던 길. 액션은 두 번째 추가에서 막혔다). 정확히 같은 code 는 겹침이 아니다(호출부의 "이미 있음"). 겹치면 { code, clash }, 아니면 null */
export function firstNewCodeClash(codes: readonly string[], siblings: readonly { code: string; name: string }[]): { code: string; clash: string } | null {
  const seen = [...siblings]
  for (const code of codes) {
    const clash = newTeamCodeClash(code, seen)
    if (clash) return { code, clash }
    if (!seen.some((s) => s.code === code)) seen.push({ code, name: code })
  }
  return null
}
