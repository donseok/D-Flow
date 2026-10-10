// 한국어 조사 — 이름이 변수로 들어가는 문구에서 앞말의 받침에 맞는 조사를 고른다(BUG-27: "'플랫폼개발팀'는" → "'플랫폼개발팀'은").
// 판정은 앞말의 마지막 "소리 나는 글자" 하나로 한다 — 닫는 따옴표·괄호·공백은 건너뛴다("'운영팀'" 의 받침은 '팀' 이 정한다).
// 한글 음절은 받침 유무, 숫자는 읽는 소리(0 영·1 일·3 삼·6 육·7 칠·8 팔 = 받침 있음)로 본다. 그 밖(로마자 등)은 읽는 법을 모르므로
// 두 꼴을 함께 적는다('은(는)') — 틀린 조사 하나를 단정하지 않는다.

/** 조사 쌍 — [받침 있을 때, 받침 없을 때] */
const PAIRS = {
  '은/는': ['은', '는'],
  '이/가': ['이', '가'],
  '을/를': ['을', '를'],
  '과/와': ['과', '와'],
  '으로/로': ['으로', '로'],
} as const
export type ParticlePair = keyof typeof PAIRS

/** 받침이 있는 숫자(읽는 소리) — 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 */
const DIGIT_WITH_FINAL = new Set(['0', '1', '3', '6', '7', '8'])
/** 'ㄹ' 받침으로 읽는 숫자 — 1 일, 7 칠, 8 팔('으로/로' 는 ㄹ 받침 뒤에 '로') */
const DIGIT_WITH_RIEUL = new Set(['1', '7', '8'])
const HANGUL_BASE = 0xac00
const HANGUL_LAST = 11171
const RIEUL = 8   // 종성 번호 — ㄹ

/** 앞말의 마지막 소리 글자의 받침 — 'none' | 'rieul' | 'other', 판정할 수 없으면 null */
function finalOf(word: string): 'none' | 'rieul' | 'other' | null {
  // 닫는 따옴표·괄호·공백·마침표는 소리가 없다 — 그 앞 글자가 정한다
  const sounded = word.replace(/[\s'"’”」』)\]}>.,!?]+$/u, '')
  const last = sounded.slice(-1)
  if (!last) return null
  if (DIGIT_WITH_RIEUL.has(last)) return 'rieul'
  if (/\d/.test(last)) return DIGIT_WITH_FINAL.has(last) ? 'other' : 'none'
  const code = last.charCodeAt(0) - HANGUL_BASE
  if (!(code >= 0 && code <= HANGUL_LAST)) return null
  const jong = code % 28
  return jong === 0 ? 'none' : jong === RIEUL ? 'rieul' : 'other'
}

/** 앞말에 맞는 조사 한 꼴 — 판정할 수 없으면 두 꼴('은(는)'·'(으)로') */
export function particle(word: string, pair: ParticlePair): string {
  const [withFinal, without] = PAIRS[pair]
  const final = finalOf(word)
  if (final === null) return pair === '으로/로' ? '(으)로' : `${withFinal}(${without})`
  // '으로/로' 만 ㄹ 받침을 받침 없음처럼 다룬다(서울로·팀으로)
  if (pair === '으로/로') return final === 'other' ? withFinal : without
  return final === 'none' ? without : withFinal
}

/** 앞말 + 조사 — `josa("'운영팀'", '은/는')` → `'운영팀'은` */
export function josa(word: string, pair: ParticlePair): string {
  return `${word}${particle(word, pair)}`
}

/** 목적격 조사 '을/를' — 마지막 글자의 받침으로 고른다(판정할 수 없으면 '을(를)') */
export function withObjectParticle(word: string): string {
  return josa(word, '을/를')
}

/** 주격 조사 '이/가' — 화면 파일(.tsx)은 한국어 리터럴을 두지 않으므로 조사 쌍을 적지 않고 이 이름으로 부른다 */
export function withSubjectParticle(word: string): string {
  return josa(word, '이/가')
}
