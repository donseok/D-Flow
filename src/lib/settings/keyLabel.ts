// 설정 키(예 calendar.timezone)의 사람이 읽는 이름 — 사전의 `settings.<키>.label` 이 정본이다(catalogDoc 도 같은 규칙으로 읽는다).
// 이름이 없는 키(은퇴한 키·알 수 없는 키)는 키를 그대로 돌려준다 — 이름을 지어내지 않는다.
import { KO } from '@/lib/i18n/dict/ko'

export function settingKeyLabel(key: string): string {
  return (KO as Record<string, string>)[`settings.${key}.label`] ?? key
}
