import { LoginEnvProvider } from '@/components/login/LoginEnv'
import { passwordResetMailAvailable } from '@/lib/auth/passwordResetMail'
import { isLocalDevEnv } from '@/lib/domain/appEnv'

// 로그인 계열 화면(/login·/login/forgot·/login/reset)은 클라이언트 컴포넌트라 서버 env 를 읽지 못한다 — 여기서 읽어 내린다.
// 요청 때마다 읽는다: 자체호스트는 APP_ENV·SMTP_* 를 런타임 env 로 주므로 빌드 때 굳히면 안 된다.
export const dynamic = 'force-dynamic'

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  // 이름을 적어 읽는다 — next.config.ts 가 APP_ENV 를 빌드 때 이 식에 박는다(process.env 객체째 넘기면 박히지 않는다)
  const env = { APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV }
  return (
    <LoginEnvProvider value={{ mailReset: passwordResetMailAvailable(env), localDev: isLocalDevEnv(env) }}>
      {children}
    </LoginEnvProvider>
  )
}
