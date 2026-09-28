/** 브라우저·서버 공용 v4 UUID. http 로 LAN IP 에 접속하면(보안 컨텍스트 아님) crypto.randomUUID 가 없다 — getRandomValues 로 만든다. */
export interface UuidCrypto {
  randomUUID?: () => string
  getRandomValues<T extends ArrayBufferView | null>(array: T): T
}

export function newUuid(c: UuidCrypto = globalThis.crypto): string {
  if (typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40   // 버전 4
  b[8] = (b[8] & 0x3f) | 0x80   // 변형 10xx
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
