// 관리·계정·초대·명단·필드·공개 페이지 화면의 화면 문구 — 컴포넌트에 박혀 있던 한국어 리터럴을 옮긴 것이다(ko 글자는 옮기기 전 그대로).
// 키 접두는 화면 단위다. en 은 Record<keyof ko, string> 타입으로 키 패리티를 컴파일 타임에 강제한다.
import { settingsUiKo } from './settingsUi'

export const adminUiKo = {
  ...settingsUiKo,   // 설정 화면 문구는 settingsUi 모듈 — 모음 파일(ko.ts)에는 이 모듈 한 줄만 등록한다
} as const
