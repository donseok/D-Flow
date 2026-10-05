import { describe, it, expect } from 'vitest'
import * as signedUrl from '@/lib/domain/signedUrl'
import { MINUTE_FILE_URL_TTL_SEC } from '@/lib/domain/minutes'

// 서명 URL 의 유효 시간은 한 곳에서 정한다 — 발급한 URL 은 권한을 회수해도 TTL 까지 산다(회수 창).
describe('서명 URL TTL 공용 상수', () => {
  it('클릭 때 발급하는 서명은 60초 — 회의록 파일 상수가 같은 값을 쓴다', () => {
    expect(signedUrl.SIGNED_URL_TTL_SEC).toBe(60)
    expect(MINUTE_FILE_URL_TTL_SEC).toBe(signedUrl.SIGNED_URL_TTL_SEC)
  })

  it('목록 서명용 1시간 상수는 없다 — 산출물·이슈 첨부도 클릭 때 발급한다(SP5 B3 과제7)', () => {
    expect(Object.keys(signedUrl)).toEqual(['SIGNED_URL_TTL_SEC'])
  })
})
