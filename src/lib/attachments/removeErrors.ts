import type { DictKey } from '@/lib/i18n/dict'

// 첨부 삭제 실패 문구와 그 사전 키 — 서버 도우미(removeStoredAttachment)와 화면이 함께 쓴다. 서버 전용 코드가 없는 모듈이라
// 클라이언트 컴포넌트가 import 해도 된다. 액션은 한국어 문구를 돌려주고(계약 유지), 화면은 그리는 자리에서 사전 문구를 고른다 —
// 액션 문구를 그대로 그리면 영어 화면에 한국어 한 줄이 뜬다.

export const ERR_OBJECT_REMOVE = '첨부 파일을 지우지 못했습니다 — 권한이나 저장소 상태를 확인한 뒤 다시 시도하세요.'
export const ERR_ROW_REMOVE = '첨부 기록을 지우지 못했습니다 — 새로고침한 뒤 확인하세요.'

const KEY: Record<string, DictKey> = {
  [ERR_OBJECT_REMOVE]: 'common.attach.objectRemoveFailed',
  [ERR_ROW_REMOVE]: 'common.attach.rowRemoveFailed',
}

/** 삭제 액션이 돌려준 문구의 사전 키. 도우미의 두 문구가 아니면 null — 호출부가 받은 문구나 자기 화면의 일반 문구를 쓴다. */
export function removeErrorKey(error: string | undefined): DictKey | null {
  return error && Object.hasOwn(KEY, error) ? KEY[error] : null
}
