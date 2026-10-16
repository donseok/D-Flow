/* ── 사용자 매뉴얼 화면의 문구 표 — 등급·부 → 사전 키. 문자열로 키를 조립하지 않고 표로 둔다(DictKey 타입이 지킨다). ── */
import { t, type DictKey } from '@/lib/i18n/dict'
import type { ManualAudience, ManualPart } from '@/lib/manual/parse'

export const AUDIENCE_KEY: Readonly<Record<ManualAudience, DictKey>> = {
  member: 'manual.audience.member',
  projectAdmin: 'manual.audience.projectAdmin',
  workspaceAdmin: 'manual.audience.workspaceAdmin',
  platformAdmin: 'manual.audience.platformAdmin',
}

export const PART_KEY: Readonly<Record<ManualPart, DictKey>> = {
  start: 'manual.part.start',
  daily: 'manual.part.daily',
  projectAdmin: 'manual.part.projectAdmin',
  workspaceAdmin: 'manual.part.workspaceAdmin',
  platformAdmin: 'manual.part.platformAdmin',
  help: 'manual.part.help',
}

/** `{audience}` 자리에 등급 이름을 넣은 문구 — 함수 치환이라 이름에 `$` 가 있어도 그대로 들어간다 */
export function withAudience(key: DictKey, audience: ManualAudience): string {
  return t(key).replace('{audience}', () => t(AUDIENCE_KEY[audience]))
}
