// 팀 이름 규칙(SP4 D37·계획 P5) — 순수. code 는 불변이고 이름(teams.name)만 바꾼다. 비교는 NFKC·trim·소문자 — 봇 라우터가 대소문자를
// 무시해 code·name 을 찾으므로(§4.2.2) 'ops' 와 'OPS' 를 두 팀 이름으로 두면 둘 다 모호해져 사람이 팀을 부를 수 없다. DB 제약은 없다 —
// 동시 개명 경합과 범위가 다른 팀끼리의 겹침은 봇의 모호 거부가 맡는다(스펙 §10 K14).
import { josa } from '@/lib/i18n/particle'
import { isHeaderWordMatch } from '@/lib/excel/headerWords'
import { normalizeNewTeamCode, TEAM_CODE_MAX } from './teams'

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
    return { ok: false, error: `${josa(`'${name}'`, '은/는')} 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.` }
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
export const teamCodeClashError = (code: string, clash: string) => `${josa(`'${code}'`, '은/는')} 같은 범위의 다른 팀(${clash})의 코드·이름과 겹칩니다.`
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

/** 이름에서 만든 기본 code — 코드 칸을 비웠을 때 저장되는 값이자 화면이 미리 보여 주는 값(같은 함수라 어긋나지 않는다).
 *  이름 그대로(앞뒤 공백만 걷는다)이고 code 상한(20자 — normalizeNewTeamCode 와 같은 UTF-16 길이)을 넘으면 글자 단위로 자른다.
 *  code 는 엑셀·가져오기가 쓰는 식별자라 나중에 바꾸면 옛 파일과 어긋난다 — 그래서 화면이 이 값을 보이고 고치게 한다 */
export function defaultTeamCode(name: string): string {
  let out = ''
  for (const ch of name.trim()) {
    if (out.length + ch.length > TEAM_CODE_MAX) break
    out += ch
  }
  return out.trim()
}

/** 새 팀의 이름·코드 검증(관리 화면의 팀 추가) — 이름은 개명과 같은 규칙(NFKC·40자·예약어), 코드는 normalizeNewTeamCode(trim·20자·예약어).
 *  코드를 비우면 이름에서 만든 기본값(defaultTeamCode). 이름을 먼저 본다 — 둘이 같은 값일 때 문구가 "팀 이름" 이다.
 *  겹침(DB 대조)은 액션이 한다 — code 는 newTeamCodeClash, 이름은 newTeamNameClash */
export function checkNewTeam(input: { name: unknown; code?: unknown; reserved: readonly string[] }):
  { ok: true; name: string; code: string } | { ok: false; error: string } {
  if (typeof input.name !== 'string') return { ok: false, error: '팀 이름을 입력하세요.' }
  if (input.code !== undefined && input.code !== null && typeof input.code !== 'string') return { ok: false, error: '팀 코드가 올바르지 않습니다.' }
  const name = normalizeTeamName(input.name)
  if (!name) return { ok: false, error: '팀 이름을 입력하세요.' }
  if ([...name].length > TEAM_NAME_MAX) return { ok: false, error: `팀 이름은 ${TEAM_NAME_MAX}자 이하여야 합니다.` }
  if (input.reserved.some((w) => isHeaderWordMatch(w, name))) {
    return { ok: false, error: `${josa(`'${name}'`, '은/는')} 엑셀 양식 예약어라 팀 이름으로 쓸 수 없습니다.` }
  }
  const given = typeof input.code === 'string' ? input.code.trim() : ''
  // 기본값은 입력한 이름 그대로에서 만든다(NFKC 로 바꾼 이름이 아니라) — 코드를 따로 적지 않던 때와 같은 값이 저장된다
  const norm = normalizeNewTeamCode(given || defaultTeamCode(input.name), input.reserved, '팀 코드')
  if (!norm.ok) return norm
  return { ok: true, name, code: norm.code }
}

/** 새 팀의 이름이 같은 범위 다른 팀의 code·이름과 겹치는가 — 개명 규칙(checkTeamRename)과 같은 판정. 이름이 자기 code 와 같은 낱말이면
 *  code 쪽 판정(newTeamCodeClash·"이미 있음")이 이미 봤으므로 보지 않는다. 겹치면 그 팀의 code, 아니면 null */
export function newTeamNameClash(name: string, code: string, siblings: readonly { code: string; name: string }[]): string | null {
  const key = teamNameKey(name)
  if (key === teamNameKey(code)) return null
  const hit = siblings.find((s) => teamNameKey(s.code) === key || teamNameKey(s.name) === key)
  return hit ? hit.code : null
}

/** 코드 바꾸기 검증(팀 유연화 2단계 — change_team_code RPC 의 앞단). 형식·예약어는 새 팀의 코드와 같은 규칙(normalizeNewTeamCode)이고,
 *  겹침은 같은 범위의 **다른** 팀과만 본다 — 자기 이름과 같은 낱말은 겹침이 아니다(코드를 이름에 맞추는 것이 흔한 쓰임이다).
 *  유일성의 최종 판정은 DB 다(TEAM_CODE_TAKEN) — 여기서는 사람이 읽을 문구를 먼저 낸다. siblings 는 그 범위의 팀 전부(자기 포함, 비활성 포함) */
export function checkTeamCodeChange(input: {
  code: unknown; selfId: string
  siblings: readonly { id: string; code: string; name: string }[]
  reserved: readonly string[]
}): { ok: true; code: string; unchanged: boolean } | { ok: false; error: string } {
  if (typeof input.code !== 'string') return { ok: false, error: '팀 코드를 입력하세요.' }
  const norm = normalizeNewTeamCode(input.code, input.reserved, '팀 코드')
  if (!norm.ok) return norm
  const self = input.siblings.find((s) => s.id === input.selfId)
  if (self && self.code === norm.code) return { ok: true, code: norm.code, unchanged: true }
  const others = input.siblings.filter((s) => s.id !== input.selfId)
  if (others.some((s) => s.code === norm.code)) return { ok: false, error: `'${norm.code}' 코드를 쓰는 팀이 이미 있습니다.` }
  const clash = newTeamCodeClash(norm.code, others)
  if (clash) return { ok: false, error: teamCodeClashError(norm.code, clash) }
  return { ok: true, code: norm.code, unchanged: false }
}

/** 파일(엑셀)의 팀 글자 → 이 프로젝트가 쓰는 팀의 code(BUG-10). 못 찾으면 null — 그때만 새 팀 후보다.
 *  teams 는 그 프로젝트가 쓰는 팀(projectTeams — 전용 팀이 하나라도 있으면 전용 팀만, 없으면 상속하는 워크스페이스 공용 팀)이라
 *  "프로젝트 전용 → 워크스페이스 공용(상속) → 없을 때만 신규" 순서가 된다. 대조는 ① code 가 정확히 같다 ② code 가 같은 낱말
 *  (teamNameKey — 앞뒤 공백·대소문자·전각 무시) ③ 이름이 같은 낱말. 예전에는 ①만 봐서 팀 **이름**을 적은 파일('플랫폼개발팀', code 는 DEV)이
 *  새 팀으로 넘어갔다가 자기 자신과의 겹침 오류로 통째로 실패했다. ②·③ 에서 서로 다른 팀 둘 이상이 맞으면(같은 낱말의 두 팀) 고르지 않는다
 *  (null — 뒤의 겹침 판정이 사유를 말한다). 활성 팀을 먼저 본다 */
export function resolveTeamRef(raw: string, teams: readonly { code: string; name: string; active?: boolean }[]): string | null {
  const exact = teams.find((t) => t.code === raw)
  if (exact) return exact.code
  const key = teamNameKey(raw)
  if (!key) return null
  const pick = (hits: readonly { code: string; active?: boolean }[]): string | null => {
    const active = hits.filter((t) => t.active !== false)
    const pool = active.length > 0 ? active : hits
    const codes = [...new Set(pool.map((t) => t.code))]
    return codes.length === 1 ? codes[0] : null
  }
  const byCode = teams.filter((t) => teamNameKey(t.code) === key)
  if (byCode.length > 0) return pick(byCode)
  const byName = teams.filter((t) => teamNameKey(t.name) === key)
  return byName.length > 0 ? pick(byName) : null
}

/** 행의 담당 팀 글자를 프로젝트 팀의 code 로 맞춘다 — 같은 팀을 두 번 가리키게 되면 하나로 합친다(주관이 이긴다: 복수 담당 분리가 같은 팀의
 *  sub-act 를 둘 만들지 않게). 못 찾은 글자는 그대로 둔다(새 팀 후보) */
export function resolveOwnerTeams<O extends { team: string; kind: 'primary' | 'support' }>(
  owners: readonly O[], teams: readonly { code: string; name: string; active?: boolean }[],
): O[] {
  const out: O[] = []
  for (const o of owners) {
    const team = resolveTeamRef(o.team, teams) ?? o.team
    const dup = out.findIndex((x) => x.team === team)
    if (dup < 0) out.push({ ...o, team })
    else if (o.kind === 'primary' && out[dup].kind !== 'primary') out[dup] = { ...out[dup], kind: 'primary' }
  }
  return out
}
