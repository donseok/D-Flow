// 첨부 삭제 실패 문구 → 사전 키. 액션은 한국어 문구를 돌려주고(계약 유지) 화면이 그리는 자리에서 사전 문구를 고른다.
import { describe, expect, it } from 'vitest'
import { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE } from '@/lib/attachments/removeStoredAttachment'
import { removeErrorKey } from '@/lib/attachments/removeErrors'
import { t } from '@/lib/i18n/dict'

describe('removeErrorKey', () => {
  it.each([
    [ERR_OBJECT_REMOVE, 'common.attach.objectRemoveFailed'],
    [ERR_ROW_REMOVE, 'common.attach.rowRemoveFailed'],
  ] as const)('도우미의 문구는 사전 키로 — 사전 문구는 그 문구와 같다', (text, key) => {
    expect(removeErrorKey(text)).toBe(key)
    expect(t('ko', key)).toBe(text)
  })

  it.each([undefined, '', '권한 없음', 'toString', 'constructor'])('그 밖의 문구(%s)는 null — 호출부가 받은 문구나 자기 화면의 일반 문구를 쓴다', (text) => {
    expect(removeErrorKey(text)).toBeNull()
  })
})
