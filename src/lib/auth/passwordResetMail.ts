import 'server-only'
import { isLocalDevEnv } from '@/lib/domain/appEnv'
import { mailConfigured } from '@/lib/mail/transport'

/**
 * 메일로 비밀번호를 재설정하는 길을 이 배포가 여는가 — 로그인 화면의 링크와 요청 액션이 같은 판정을 쓴다(링크만 숨기고 액션을 열어 두지 않는다).
 * 재설정 메일은 Supabase Auth 가 자기 메일 설정으로 보낸다(앱의 SMTP 를 거치지 않는다). 앱은 그 설정을 읽을 수 없어 "이 배포가 메일을 보내도록
 * 구성됐는가"를 앱의 메일 발송 설정(SMTP_* — 초대·회의 알림과 같은 판정)으로 갈음한다: 메일을 보내지 않는 배포는 링크를 숨기고 지금의
 * "관리자에게 문의" 안내를 유지한다. 로컬 개발은 연다 — 로컬 Supabase 는 Auth 메일을 늘 자기 메일함(inbucket)으로 받는다.
 * 운영에서 켜려면 Supabase Auth 쪽 SMTP 도 구성돼 있어야 한다(docs/runbook-selfhost.md).
 */
export function passwordResetMailAvailable(env: { APP_ENV?: string; NODE_ENV?: string }): boolean {
  return mailConfigured() || isLocalDevEnv(env)
}
