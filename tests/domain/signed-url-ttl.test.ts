import { describe, it, expect } from 'vitest'
import { LIST_SIGNED_URL_TTL_SEC, SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'
import { MINUTE_FILE_URL_TTL_SEC } from '@/lib/domain/minutes'

// 서명 URL 의 유효 시간은 한 곳에서 정한다 — 발급한 URL 은 권한을 회수해도 TTL 까지 산다(회수 창).
describe('서명 URL TTL 공용 상수', () => {
  it('클릭 때 발급하는 서명은 60초 — 회의록 파일 상수가 같은 값을 쓴다', () => {
    expect(SIGNED_URL_TTL_SEC).toBe(60)
    expect(MINUTE_FILE_URL_TTL_SEC).toBe(SIGNED_URL_TTL_SEC)
  })

  it('목록을 그릴 때 서명하는 링크(산출물·이슈 첨부)는 클릭 발급으로 옮기기 전까지 1시간 — 60초면 열어 둔 패널의 링크가 죽는다', () => {
    expect(LIST_SIGNED_URL_TTL_SEC).toBe(3600)
  })
})
