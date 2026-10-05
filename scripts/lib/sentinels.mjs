// scripts/lib/sentinels.mjs — 옛 기본값 센티널(SP4 스펙 D8·§6.4, 계획 P6)의 일치 규칙 — 순수. 출력(응답 본문·zip 의 텍스트 파트·
// 서버 렌더 HTML)에 원본 기본값 문자열이 0건인지 본다. 목록의 평문 사본은 tests/fixtures/legacy-sentinels.ts 하나다. 이 파일은 .mjs
// 러너(E2E·합성 게이트)가 TS 를 import 하지 못해 SP4 부분 집합을 base64 로 한 번 더 싣고(scripts/lib/e2e.mjs 의 TRACE_WORDS 선례),
// tests/negative/sentinels.test.ts 가 두 사본이 같은지 대조한다. 일치 규칙은 여기 하나다 — 픽스처가 재수출한다.
import JSZip from 'jszip'

/** 정당한 복합어 — 센티널을 품지만 옛 기본값이 아니다(2026-10-01 src 실측: 사전 wbs·settings·issues, excel/template.ts,
 *  actions/wbs.ts). 닫힌 목록이다 — 늘릴 때는 그 문자열이 정당한 사전·코드 문자열이라는 실측 근거와 존재 단언을 같은 커밋에 둔다(스펙 K12) */
export const SENTINEL_MASKS = Object.freeze(['영업일', '영업관리팀'])

const ASCII_ALNUM = /^[A-Za-z0-9]+$/
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * text 에 든 센티널 — 센티널 목록 순, 중복 없음. 마스크를 먼저 지운다. 대소문자를 구분한다. ASCII 영숫자로만 된 센티널(영문 팀
 * 코드)은 앞뒤가 영숫자가 아닐 때만 적중한다(글꼴 이름 'Times New Roman'·'GAMES' 속 글자를 세지 않는다). 나머지는 부분 문자열이다.
 * @param {string} text
 * @param {readonly string[]} sentinels
 * @returns {string[]}
 */
export function findSentinels(text, sentinels) {
  let s = String(text)
  for (const m of SENTINEL_MASKS) s = s.split(m).join(' ')
  // 원문 소스·JSON 본문에 글자 그대로 남은 이스케이프(\n·\t·\r·\b·\f·\uXXXX·\xXX)는 공백으로 — 앞 글자(n·t·숫자)가 영숫자라
  // 바로 뒤 영문 코드의 앞 경계가 막혀 적중을 놓쳤다(A1-4 리뷰 P5). 실제 제어 문자는 원래 경계 밖이다
  s = s.replace(/\\(?:[nrtbf]|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2})/g, ' ')
  const hits = []
  for (const w of sentinels) {
    if (!w || hits.includes(w)) continue
    const hit = ASCII_ALNUM.test(w) ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(w)}(?![A-Za-z0-9])`).test(s) : s.includes(w)
    if (hit) hits.push(w)
  }
  return hits
}

/** zip(xlsx·pptx) 안의 텍스트 파트인가 — *.xml·*.rels·[Content_Types].xml·docProps/*. 미디어·임베디드 이진은 보지 않는다
 *  @param {string} name @returns {boolean} */
export function isZipTextPart(name) {
  return name === '[Content_Types].xml' || name.startsWith('docProps/') || /\.(xml|rels)$/i.test(name)
}

/**
 * zip 의 텍스트 파트 — 이름 순.
 * @param {ArrayBuffer | Uint8Array} buf
 * @returns {Promise<{ name: string, text: string }[]>}
 */
export async function zipTextParts(buf) {
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && isZipTextPart(n)).sort()
  return Promise.all(names.map(async (name) => ({ name, text: await zip.files[name].async('string') })))
}

/**
 * 그 프로젝트가 스스로 등록한 영역·팀의 code·name 과 **같은** 센티널만 뺀다 — 포함 관계로는 빼지 않는다(등록 이름 하나가 센티널
 * 여럿을 지우지 않게, 스펙 D8·비평 보안 §8).
 * @param {readonly string[]} sentinels
 * @param {readonly string[]} registered
 * @returns {string[]}
 */
export function excludeRegistered(sentinels, registered) {
  const own = new Set(registered)
  return sentinels.filter((w) => !own.has(w))
}

/** SP4 부분 집합(11구분명 ∪ 5팀 코드, 픽스처 순서)의 base64 사본 — 평문은 tests/fixtures/legacy-sentinels.ts. 두 사본은 테스트가 대조한다 */
export const SP4_SENTINELS_B64 =
  'UE1PCuyYgeyXhQrqtazrp6QK6rSA66as7ZqM6rOECu2SiOyniArsg53sgrDqs4Ttmo0K7KGw7JeFCu2RnOykgO2ZlArrrLzrpZgK7ISk67mE67CPTDIK6rCA6rO1CkVSUApNRVMKTURN'

/** @returns {string[]} */
export function sp4Sentinels() {
  return Buffer.from(SP4_SENTINELS_B64, 'base64').toString('utf8').split('\n')
}

/** SP5 A 의 시간대 센티널(스펙 D43·§6.4 S10 A 몫). 평문 정본은 tests/fixtures/legacy-sentinels.ts 의 LEGACY_SENTINELS.timezone —
 *  고객 문자열이 아니라 base64 로 감추지 않는다. tests/negative/sentinels.test.ts 가 두 사본을 대조한다 */
export const SP5A_SENTINELS = Object.freeze(['Asia/Seoul', '+09:00'])
/** @returns {string[]} */
export function sp5aSentinels() {
  return [...SP5A_SENTINELS]
}

/** SP5 B1 고객 영역명·옛 이슈 코드 접두의 base64 사본 — 평문 정본은 tests/fixtures/legacy-sentinels.ts */
export const SP5B1_SENTINELS_B64 = '6riw7KSA6rSA66asCuyGkOydteq0gOumrArsmIHsl4UK7ZKI7KeIwrfshKTqs4QK7IOd7IKw6rOE7ZqNCuyhsOyXhQrstpztlZgK7JuQ6rCAClBJLUkt'
/** @returns {string[]} */
export function sp5b1Sentinels() {
  return Buffer.from(SP5B1_SENTINELS_B64, 'base64').toString('utf8').split('\n')
}
