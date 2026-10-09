// adminUi 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { adminUiKo } from './adminUi'
import { settingsUiEn } from './settingsUi.en'

export const adminUiEn: Record<keyof typeof adminUiKo, string> = {
  ...settingsUiEn,
}
