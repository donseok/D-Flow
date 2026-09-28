// 도메인 한 개를 ASCII(퓨니코드) 호스트명으로 — 초대 판정의 메일 호스트(domain/invites normalizeEmailHost)와
// 허용 도메인 저장값(settings/defs/workspace normalizeDomain)이 같은 규칙을 쓴다. 한쪽만 느슨하면 정확 일치가 뚫린다.

/** 최소한의 호스트명 형태 — 라벨은 영숫자·하이픈(양끝 하이픈 금지), 점으로 구분된 라벨이 2개 이상. */
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const HOSTNAME_RE = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})+$`)
/** 파싱 전 문자 집합 — 문자·숫자·결합표시·점·하이픈. URL 파서는 / ? # \ : 에서 자르고 %xx·soft hyphen 을 풀어
 *  다른 호스트를 만든다('acme.test/evil.example' → 'acme.test') — 그런 입력은 여기서 막는다. */
const HOST_CHARS_RE = /^[\p{L}\p{N}\p{M}.-]+$/u

/**
 * 소문자·끝 점 처리가 끝난 값을 받아 ASCII 호스트명을 돌려준다. 형태가 아니면 null(호출부가 거부로 판정한다 — 잘라 쓰지 않는다).
 * URL 파서는 IDN → 퓨니코드 변환에만 쓴다: ASCII 라벨은 그대로여야 하고, 바뀐 라벨은 xn-- 이어야 한다
 * (전각 'ａcme' → 'acme' 같은 매핑으로 다른 ASCII 호스트가 되는 것을 막는다).
 */
export function toAsciiHostname(v: string): string | null {
  if (!HOST_CHARS_RE.test(v)) return null
  let h: string
  try {
    h = new URL(`http://${v}`).hostname
  } catch {
    return null
  }
  if (!HOSTNAME_RE.test(h)) return null
  const inLabels = v.split('.')
  const outLabels = h.split('.')
  if (inLabels.length !== outLabels.length) return null
  return inLabels.every((l, i) => l === outLabels[i] || outLabels[i].startsWith('xn--')) ? h : null
}
