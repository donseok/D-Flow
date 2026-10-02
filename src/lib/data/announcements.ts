import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { Announcement, AnnouncementCategory } from '@/lib/domain/types'

export const ERR_ANNOUNCEMENTS_LOAD = '공지를 불러오지 못했습니다.'

/** 프로젝트 공지 목록 — 고정 우선 → 최신순. 실패는 로그 후 결과로 돌려준다(members.ts 의 getProjectRoster 관례) —
 *  호출부가 '공지 없음'과 '못 읽음'을 구분해 보인다(에러 처리 3원칙 ①). */
export const getAnnouncements = cache(async (
  projectId: string,
): Promise<{ ok: true; rows: Announcement[] } | { ok: false; error: string }> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('announcements')
    .select('id, project_id, title, body, category, is_pinned, publish_from, publish_to, milestone_date, created_at, updated_at')
    .eq('project_id', projectId)
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getAnnouncements] 조회 실패:', error.message)
    return { ok: false, error: ERR_ANNOUNCEMENTS_LOAD }
  }

  return { ok: true, rows: (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    projectId: r.project_id as string,
    title: r.title as string,
    body: (r.body as string) ?? '',
    category: r.category as AnnouncementCategory,
    isPinned: (r.is_pinned as boolean) ?? false,
    publishFrom: (r.publish_from as string | null) ?? null,
    publishTo: (r.publish_to as string | null) ?? null,
    milestoneDate: (r.milestone_date as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  })) }
})

/** 현재 사용자의 읽음 워터마크(마지막으로 공지 목록을 본 시각). 없으면 null. */
export const getAnnouncementSeenAt = cache(async (projectId: string): Promise<string | null> => {
  const sb = await createServerClient()
  const { data: u } = await sb.auth.getUser()
  if (!u.user) return null
  const { data, error } = await sb
    .from('announcement_seen')
    .select('last_seen_at')
    .eq('user_id', u.user.id)
    .eq('project_id', projectId)
    .maybeSingle()

  // 조회 실패는 '워터마크 없음(=한 번도 안 봄)'과 구별되지 않아 **모든 공지가 NEW로 부풀어** 배지가 거짓말을 한다.
  // 여기서 throw 하면 공지 페이지 자체가 뜨지 않으므로(읽는 것보다 나쁨) 폴백은 유지하고 원인만 로그로 남긴다.
  if (error) console.error('[getAnnouncementSeenAt] 읽음 워터마크 조회 실패(공지가 모두 NEW로 표시됨):', error.message)

  return (data?.last_seen_at as string | undefined) ?? null
})
