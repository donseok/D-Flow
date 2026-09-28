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

describe('toAsciiHostname — 라벨 길이(DNS·GoTrue checkmail 과 같이 63자 이하)', () => {
  it('64자 라벨은 null, 63자는 통과', () => {
    expect(toAsciiHostname(`${'a'.repeat(64)}.test`)).toBeNull()
    expect(toAsciiHostname(`${'a'.repeat(63)}.test`)).toBe(`${'a'.repeat(63)}.test`)
  })
})

describe('toAsciiHostname — 전체 길이 253자·IPv4 (L-1·L-2)', () => {
  it('호스트 전체가 253자를 넘으면 null', () => {
    const h253 = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`
    expect(h253).toHaveLength(253)
    expect(toAsciiHostname(h253)).toBe(h253)
    expect(toAsciiHostname(`${h253}e`)).toBeNull()
  })
  it('마지막 라벨이 숫자만이면(IPv4 등) null — 숫자 라벨 자체는 된다', () => {
    expect(toAsciiHostname('127.0.0.1')).toBeNull()
    expect(toAsciiHostname('10.0.0.5')).toBeNull()
    expect(toAsciiHostname('acme.123')).toBeNull()
    expect(toAsciiHostname('123.test')).toBe('123.test')
    expect(toAsciiHostname('3m.test')).toBe('3m.test')
  })
})
