import 'server-only'
import { BRAND } from '@/lib/branding'

/**
 * 메일 발신 표시명 — 서버 전용.
 * MAIL_FROM_NAME 은 NEXT_PUBLIC_ 이 아니라 클라이언트 번들에서는 늘 undefined 다. 클라이언트도 import 하는
 * BRAND 에 두면 서버·브라우저 값이 갈라지므로 여기로 떼어 낸다. 호출 시점에 읽어 재시작 없이 env 를 따른다.
 */
export function mailFromName(): string {
  return process.env.MAIL_FROM_NAME?.trim() || `${BRAND.productName} 알림`
}
