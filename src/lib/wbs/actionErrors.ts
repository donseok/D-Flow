// WBS 실적·가중치·Phase 추가 액션이 돌려주는 고정 문구와 그 사전 키(SP4 D21·D52 — H2 src/lib/attachments/removeErrors.ts 꼴).
// 서버 전용 코드가 없는 모듈이라 클라이언트가 import 한다. 액션은 한국어 문구를 돌려주고(계약 { ok, error } 유지), 화면은 그리는 자리에서
// 사전 문구를 고른다 — 받은 문구를 그대로 그리면 영어 화면에 한국어가 뜬다. 표에 없는 문구는 null — 화면의 일반 키로 떨어진다.
import type { DictKey } from '@/lib/i18n/dict'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'

export const WBS_ACTION_ERRORS = {
  range: '0~100 범위',
  itemMissing: '항목 없음',
  hasChildren: '하위 항목이 있어 롤업으로 계산됩니다',
  notOwner: '담당 작업이 아님',
  conflict: '다른 사용자가 먼저 수정했습니다. 최신 값으로 새로고침합니다.',
  noWritePermission: '저장 권한이 없습니다(담당 팀·관리자만 입력 가능)',
  weightMin: '가중치는 0 이상이어야 함',
  nameRequired: '이름을 입력하세요',
  subActSibling: 'SUB-ACT 형제로는 일반 항목을 추가할 수 없습니다',
  itemLookup: '항목을 불러오지 못했습니다 — 잠시 후 다시 시도하세요.',
  childLookup: '하위 항목을 확인하지 못했습니다 — 잠시 후 다시 시도하세요.',
  ownerLookup: '담당을 확인하지 못했습니다 — 잠시 후 다시 시도하세요.',
  orderLookup: '에이전트 주문을 확인하지 못했습니다 — 잠시 후 다시 시도하세요.',
  siblingLookup: '형제 항목을 불러오지 못했습니다 — 잠시 후 다시 시도하세요.',
  save: '저장하지 못했습니다 — 잠시 후 다시 시도하세요.',
  add: '추가하지 못했습니다 — 잠시 후 다시 시도하세요.',
} as const

const KEY: Readonly<Record<string, DictKey>> = {
  ...Object.fromEntries(Object.entries(WBS_ACTION_ERRORS).map(([k, msg]) => [msg, `wbs.err.${k}` as DictKey])),
  [ERR_ANON]: 'wbs.err.anon', [ERR_DENIED]: 'wbs.err.denied', [ERR_LOOKUP]: 'wbs.err.lookup',
  [ERR_MISSING]: 'wbs.err.missing', [ERR_MODULE_DISABLED]: 'wbs.err.moduleOff',
}

/** 액션 문구 → 사전 키. 표 밖(동적 문구·원문·프로토타입 이름)이면 null */
export function wbsErrorKey(error: string | undefined): DictKey | null {
  return error && Object.hasOwn(KEY, error) ? KEY[error] : null
}

/** 토스트 문구 — 표에 있으면 그 사전 문구, 없으면 그 화면의 일반 키 */
export function wbsToastText(t: (k: DictKey) => string, error: string | undefined, fallback: DictKey): string {
  return t(wbsErrorKey(error) ?? fallback)
}
