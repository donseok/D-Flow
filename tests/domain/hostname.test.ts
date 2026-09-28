// domain/hostname — 순수 Punycode 인코더(RFC 3492)와 IDN 라벨 왕복 검사(F3A-1). 기대값은 Node 의 punycode.encode 와 같다.
import { describe, expect, it } from 'vitest'
import { punycodeEncode, toAsciiHostname } from '@/lib/domain/hostname'

describe('punycodeEncode', () => {
  it.each([
    ['한글', 'bj0bj06e'],
    ['日本', 'wgv71a'],
    ['аcme', 'cme-5cd'],
    ['bücher', 'bcher-kva'],
    ['bücher', 'bucher-xyd'],
    ['faß', 'fa-hia'],
    ['ꭰcme', 'cme-f56l'],
    ['3年B組金八先生', '3B-ww4c5e180e575a65lsy2b'],   // RFC 3492 §7.1 (L)
    ['ドメイン名例', 'eckwd4c7cu47r2wf'],
    ['\u{1F600}a', 'a-iv3s'],                            // 서로게이트 쌍은 한 글자
  ])('%s → %s', (input, expected) => {
    expect(punycodeEncode(input)).toBe(expected)
  })
})

describe('toAsciiHostname — 바뀐 라벨은 xn-- + punycode(입력) 일 때만', () => {
  it('IDN 은 퓨니코드로, 매핑으로 다른 문자열이 되는 입력은 null', () => {
    expect(toAsciiHostname('한글.kr')).toBe('xn--bj0bj06e.kr')
    expect(toAsciiHostname('bücher.test')).toBe('xn--bcher-kva.test')
    expect(toAsciiHostname('bücher.test')).toBeNull()             // NFD
    expect(toAsciiHostname('аｃｍｅ.test')).toBeNull() // 전각 섞인 IDN
    expect(toAsciiHostname('аcme͏.test')).toBeNull()           // CGJ
    expect(toAsciiHostname('ꭰcme.test')).toBeNull()                 // 체로키 소문자 → 매핑이 대문자로
  })
})
