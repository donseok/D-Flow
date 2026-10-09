// 워크스페이스 이름 변경의 거부 사유 → 사전 키. 플랫폼 관리 화면의 대화상자와 워크스페이스 설정 '일반'의 이름 편집이 같은 문구를 쓴다. 순수.
import type { DictKey } from '@/lib/i18n/dict'
import type { WorkspaceRenameCode } from '@/app/actions/platformWorkspaces'   // 타입만 — 액션을 값으로 끌어오지 않는다

/** denied 는 생성의 문구('만들 수 있습니다')와 다르다 — 이름 변경은 그 워크스페이스의 관리자도 한다 */
export const renameErrorKey = (code: WorkspaceRenameCode | 'unknown'): DictKey =>
  (code === 'denied' ? 'platform.ws.err.rename_denied' : `platform.ws.err.${code}`) as DictKey
