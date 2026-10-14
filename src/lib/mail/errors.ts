// SMTP 발송 오류 → 사용자 문구(설계 §2.5). 회의 안내·프로젝트 초대·테스트 발송(워크스페이스 메일 설정) 셋이 같은 변환을 쓴다.
// 순수 — env·DB 를 읽지 않는다. 서버 사전은 타입만 가져온다(값 import 는 server.ts·serverDict.ts 만 — i18n-server-messages 불변식).
import type { ServerTranslate } from '@/lib/i18n/serverDict'

/**
 * SMTP 원문 오류(message·response)에는 계정·호스트가 섞인다. 사용자에게는 nodemailer 의 사유 코드만 보고 고른 문구를 전한다.
 * test 면(설정 화면의 테스트 발송) 인증 실패에 "Gmail 이면 앱 비밀번호인지" 안내를 더한다.
 */
export function smtpErrorMessage(tr: ServerTranslate, e: unknown, opts: { test?: boolean } = {}): string {
  const code = (e as { code?: unknown } | null | undefined)?.code
  if (code === 'EAUTH') return tr(opts.test ? 'srv.mailSettings.testAuthFailed' : 'err.mailAccountAuthenticationFailed')
  if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') return tr('err.couldNotConnectMailServer')
  return tr('err.errorOccurredWhileSendingMail')
}
