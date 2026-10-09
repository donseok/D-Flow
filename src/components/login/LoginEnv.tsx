'use client'

import { createContext, useContext } from 'react'

/**
 * 로그인 계열 화면(/login·/login/forgot·/login/reset)이 서버에서 받아야 하는 배포 사실 둘. 화면들이 클라이언트 컴포넌트라 서버 env 를 읽지 못해
 * src/app/login/layout.tsx 가 읽어 내린다. 공급자 없는 기본값은 둘 다 false — 모르면 "메일 재설정 없음·배포 화면"으로 그린다(닫힌 쪽).
 */
export interface LoginEnv {
  /** 메일로 비밀번호를 재설정할 수 있는 배포인가 — 거짓이면 링크를 숨기고 "관리자에게 문의" 안내를 유지한다 */
  mailReset: boolean
  /** 로컬 개발인가 — 개발자용 안내(로컬 DB 확인)를 보일지 */
  localDev: boolean
}

const Ctx = createContext<LoginEnv>({ mailReset: false, localDev: false })

export function LoginEnvProvider({ value, children }: { value: LoginEnv; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const useLoginEnv = (): LoginEnv => useContext(Ctx)
