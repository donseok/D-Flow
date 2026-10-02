/** 목적격 조사 '을/를' — 마지막 글자의 받침으로 고른다(한글 음절이 아니거나 빈 문자열이면 '을(를)') */
export function withObjectParticle(word: string): string {
  const last = word.trim().slice(-1)
  const code = last ? last.charCodeAt(0) - 0xac00 : -1
  if (!(code >= 0 && code <= 11171)) return `${word}을(를)`
  return `${word}${code % 28 === 0 ? '를' : '을'}`
}
