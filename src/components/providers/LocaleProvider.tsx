'use client'

import { createContext, useContext } from 'react'
import { t as translate, type DictKey, type Locale } from '@/lib/i18n/dict'

// 제품은 한국어 전용이다(2026-10-10 결정) — 이 공급자는 화면에 사전 조회 함수(t)를 내려 주는 일만 한다.
// 값이 바뀌지 않으므로 상태도 구독 재렌더도 없다. `locale` 은 날짜 형식 등에 넘기던 호출부를 건드리지 않으려고 남긴 고정값이다.
// 공급자 밖의 기본 t 는 키를 그대로 돌려준다(공급자 없이 그리는 단위 테스트가 키를 단언한다).
type LocaleValue = { locale: Locale; t: (k: DictKey) => string }

const LocaleCtx = createContext<LocaleValue>({ locale: 'ko', t: (k) => k })

const VALUE: LocaleValue = { locale: 'ko', t: (key) => translate('ko', key) }

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  return <LocaleCtx.Provider value={VALUE}>{children}</LocaleCtx.Provider>
}

export const useLocale = () => useContext(LocaleCtx)
