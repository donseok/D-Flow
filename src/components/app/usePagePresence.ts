'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { compareKoreanName } from '@/lib/domain/nameSort'
import { pagePresenceTopic } from '@/lib/domain/presenceTopics'

/** track 페이로드 — 신원만. 셀 좌표가 필요한 주간 시트는 weekly/usePresence를 쓴다. */
interface TrackPayload {
  userId: string
  name: string
}

export interface OnlineUser {
  userId: string
  name: string
}

/** 페이지(메뉴) 단위 프레즌스 — 같은 화면에 머무는 사용자 목록(본인 포함).
 *  주간 시트 usePresence의 축약형: 위치 추적 없이 "누가 이 메뉴를 보고 있나"만 track한다.
 *  토픽은 pagePresenceTopic(projectId, pageKey) private 채널 — 0007 정책이 pid 를 읽을 수 있는
 *  사람만 join·track 을 허용한다. userId 단위 dedupe, 이름 가나다순. */
export function usePagePresence({ projectId, pageKey, me, enabled }: {
  projectId: string
  pageKey: string
  me: { id: string; name: string } | null
  enabled: boolean
}): OnlineUser[] {
  const [online, setOnline] = useState<OnlineUser[]>([])

  // 연결(탭) 단위 키 — 컴포넌트 수명 동안 고정. 같은 사용자의 다중 탭을 구분한다.
  const connKeyRef = useRef<string | null>(null)
  if (connKeyRef.current === null) {
    connKeyRef.current = `${me?.id ?? 'anon'}:${Math.random().toString(36).slice(2, 10)}`
  }

  useEffect(() => {
    if (!enabled || !me) { setOnline([]); return }
    type Sb = ReturnType<typeof createBrowserClient>
    let sb: Sb | null = null
    let channel: ReturnType<Sb['channel']> | null = null
    let alive = true

    // 향상 계층 — 클라이언트 생성·토픽 검증·구독 어디서 던져도 화면은 산다(useWbsRealtime 과 같은 순서).
    ;(async () => {
      try {
        const topic = pagePresenceTopic(projectId, pageKey)
        sb = createBrowserClient()
        const { data } = await sb.auth.getSession()
        if (!alive || !data.session) return
        sb.realtime.setAuth() // private 채널 인가 토큰 갱신
        const ch = sb.channel(topic, {
          config: { private: true, presence: { key: connKeyRef.current! } },
        })
        channel = ch
        ch
          .on('presence', { event: 'sync' }, () => {
            if (!alive) return
            const state = ch.presenceState<TrackPayload>()
            const byId = new Map<string, string>()
            for (const metas of Object.values(state)) {
              for (const m of metas) {
                if (m.userId && !byId.has(m.userId)) byId.set(m.userId, m.name)
              }
            }
            setOnline(
              [...byId]
                .map(([userId, name]) => ({ userId, name }))
                .sort((a, b) => compareKoreanName(a.name, b.name)),
            )
          })
          .subscribe(st => {
            if (st === 'SUBSCRIBED') void ch.track({ userId: me.id, name: me.name } satisfies TrackPayload)
          })
      } catch {
        // 삼킨다 — presence 가 죽어도 화면은 산다.
      }
    })()

    return () => {
      alive = false
      if (sb && channel) void sb.removeChannel(channel) // untrack(leave) 포함 — 타 세션에서 즉시 사라짐
      setOnline([])
    }
  }, [projectId, pageKey, me?.id, me?.name, enabled]) // eslint-disable-line react-hooks/exhaustive-deps -- me는 원시값으로 구독(객체 참조는 렌더마다 새것)

  return online
}
