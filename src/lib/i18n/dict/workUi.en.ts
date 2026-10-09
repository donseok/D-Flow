// 업무 화면 영어 사전 모음 — workUi.ts 의 짝. 값 import 는 *.en.ts 끼리만(ko 모듈은 import type).
import type { workUiKo } from './workUi'
import { weeklyUiEn } from './weeklyUi.en'
import { agentsUiEn } from './agentsUi.en'
import { portalUiEn } from './portalUi.en'
import { usageUiEn } from './usageUi.en'
import { pagesUiEn } from './pagesUi.en'
import { reportUiEn } from './reportUi.en'
import { searchUiEn } from './searchUi.en'

export const workUiEn: Record<keyof typeof workUiKo, string> = {
  ...weeklyUiEn,
  ...agentsUiEn,
  ...portalUiEn,
  ...usageUiEn,
  ...pagesUiEn,
  ...reportUiEn,
  ...searchUiEn,
}
