'use client'
import { useEffect, useRef } from 'react'
import type { UiPrefs } from '@/lib/domain/types'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { dispatchSidebarToggle, SIDEBAR_STORAGE_KEY } from '@/components/app/sidebarState'

/** 현재 로컬 상태를 LocalPrefs 로 읽는다 */
function readLocal(): LocalPrefs {
  let sidebarCollapsed = false
  try { sidebarCollapsed = localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1' } catch {}
  return { sidebarCollapsed }
}

/**
 * 로그인 시 서버 설정을 읽어 로컬 캐시/UI 를 reconcile 한다(로컬 우선 + 서버 동기화).
 * 서버 값이 있으면 UI에 적용, 없으면 로컬값을 서버에 백필. 렌더 출력 없음.
 *
 * 서버 설정은 레이아웃이 이미 서버에서 읽은 값을 prop 으로 받는다 — 종전처럼 마운트 후
 * 계정 설정 서버 액션(getAccountPrefs)을 다시 쏘면 완전 중복 왕복이다(2026-08-18 성능 감사). 서버 값은 계정 키만이다(SP3b D9).
 */
export function PrefsSync({ server }: { server: UiPrefs }) {
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true
    const local = readLocal()
    const { apply, backfill } = computePrefsSync(server, local)
    // 적용: 각 설정의 기존 변경 경로 재사용(같은 값이면 computePrefsSync 가 이미 걸러냄).
    if (apply.sidebarCollapsed !== undefined) dispatchSidebarToggle(apply.sidebarCollapsed)
    // 백필: 서버에 없던 키를 현재 로컬값으로 1회 저장(debounce 병합).
    if (Object.keys(backfill).length) queueUiPref(backfill)
    // 마운트 1회만. 로컬 상태는 readLocal 이 저장소에서 직접 읽음.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
