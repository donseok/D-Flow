// 업무 화면 사전 모음 — 화면군별 모듈(weeklyUi·agentsUi·portalUi·usageUi·pagesUi·reportUi·searchUi)을 한 덩이로 묶어
// ko.ts 에는 한 줄만 등록한다. 문구는 각 화면군 모듈에 둔다(여기에 직접 키를 적지 않는다).
import { weeklyUiKo } from './weeklyUi'
import { agentsUiKo } from './agentsUi'
import { portalUiKo } from './portalUi'
import { usageUiKo } from './usageUi'
import { pagesUiKo } from './pagesUi'
import { reportUiKo } from './reportUi'
import { searchUiKo } from './searchUi'

export const workUiKo = {
  ...weeklyUiKo,
  ...agentsUiKo,
  ...portalUiKo,
  ...usageUiKo,
  ...pagesUiKo,
  ...reportUiKo,
  ...searchUiKo,
} as const
