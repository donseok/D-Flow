// 도메인 한 개를 ASCII(퓨니코드) 호스트명으로 — 초대 판정의 메일 호스트(domain/invites normalizeEmailHost)와
// 허용 도메인 저장값(settings/defs/workspace normalizeDomain)이 같은 규칙을 쓴다. 한쪽만 느슨하면 정확 일치가 뚫린다.

/** 최소한의 호스트명 형태 — 라벨은 영숫자·하이픈(양끝 하이픈 금지)·63자 이하(DNS, GoTrue checkmail 과 같다), 점으로 구분된 라벨이 2개 이상. */
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
const HOSTNAME_RE = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})+$`)
/** 파싱 전 문자 집합 — 문자·숫자·결합표시·점·하이픈. URL 파서는 / ? # \ : 에서 자르고 %xx·soft hyphen 을 풀어
 *  다른 호스트를 만든다('acme.test/evil.example' → 'acme.test') — 그런 입력은 여기서 막는다. */
const HOST_CHARS_RE = /^[\p{L}\p{N}\p{M}.-]+$/u

// RFC 3492 Punycode 인코더 — 이 파일은 클라이언트 번들에도 들어가(ProjectInviteManager → domain/invites) node:punycode 를 쓰지 않는다.
const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 0x80
function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1
  delta += Math.floor(delta / numPoints)
  let k = 0
  while (delta > ((BASE - TMIN) * TMAX) >> 1) { delta = Math.floor(delta / (BASE - TMIN)); k += BASE }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW))
}
/** 0~25 → a~z, 26~35 → 0~9 */
const digit = (d: number) => String.fromCharCode(d < 26 ? d + 97 : d + 22)

/** 라벨 하나를 매핑 없이 Punycode 로(접두 'xn--' 제외). 코드 포인트 단위로 센다(서로게이트 쌍 = 한 글자). */
export function punycodeEncode(label: string): string {
  const cps = Array.from(label, (c) => c.codePointAt(0)!)
  let out = cps.filter((c) => c < INITIAL_N).map((c) => String.fromCharCode(c)).join('')
  const basic = out.length
  if (basic > 0) out += '-'
  let n = INITIAL_N, delta = 0, bias = INITIAL_BIAS, h = basic
  while (h < cps.length) {
    let m = Infinity
    for (const c of cps) if (c >= n && c < m) m = c
    delta += (m - n) * (h + 1)
    n = m
    for (const c of cps) {
      if (c < n) delta++
      if (c !== n) continue
      let q = delta
      for (let k = BASE; ; k += BASE) {
        const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias
        if (q < t) break
        out += digit(t + ((q - t) % (BASE - t)))
        q = Math.floor((q - t) / (BASE - t))
      }
      out += digit(q)
      bias = adapt(delta, h + 1, h === basic)
      delta = 0
      h++
    }
    delta++
    n++
  }
  return out
}

/**
 * 소문자·끝 점 처리가 끝난 값을 받아 ASCII 호스트명을 돌려준다. 형태가 아니면 null(호출부가 거부로 판정한다 — 잘라 쓰지 않는다).
 * URL 파서는 IDN → 퓨니코드 변환에만 쓴다: ASCII 라벨은 그대로여야 하고, 바뀐 라벨은 'xn--' + punycode(입력 라벨) 과 같아야 한다.
 * UTS46 매핑(전각 'ａcme' → 'acme', NFD → NFC, CGJ 삭제, 체로키 소문자 → 대문자)이 입력과 다른 문자열을 같은 호스트로
 * 만들면 판정 호스트와 메일이 실제로 가는 호스트가 갈린다 — 그런 입력은 거부한다.
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
  return inLabels.every((l, i) => l === outLabels[i] || outLabels[i] === `xn--${punycodeEncode(l)}`) ? h : null
}
