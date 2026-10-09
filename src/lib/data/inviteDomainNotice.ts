import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { isWorkspaceAdmin, type Actor } from '@/lib/domain/authz'
import { createServerClient } from '@/lib/supabase/server'
import { wsHref } from '@/lib/workspace/paths'
import { workspaceRefById } from '@/lib/workspace/resolve'
import { loadInviteDomains } from './inviteDomains'

/** 초대 칸의 사전 안내 — 설정으로 가는 링크는 그 워크스페이스의 관리자에게만(고칠 수 있는 사람), 아니면 null(관리자에게 요청하라고 안내) */
export interface InviteDomainNotice { settingsHref: string | null }

/**
 * 초대 허용 도메인이 비어 있어 지금 보내는 초대가 전부 거부될 상태인가(첫 사용 흐름). 정책 기본값이 빈 목록이라 새 워크스페이스의 첫 초대가
 * 그렇다 — 거부되기 전에 초대 칸에 미리 알린다. 발급 액션과 같은 로더·같은 판정(loadInviteDomains — 명시 [] 든 미설정이든 쓸 도메인이 0개)이고,
 * 세션으로 읽는다(워크스페이스 설정은 그 워크스페이스 멤버가 읽는다 — 호출부는 프로젝트 관리자에게만 부른다).
 * 도메인이 있거나('*' 포함) 읽지 못했으면 null — 모르는 것을 "비어 있다"고 말하지 않는다(발급 때 액션이 사유를 낸다).
 * 안내는 부가 정보라 여기서 난 예외가 명단 화면을 막지 않는다(로그만 남기고 null).
 */
export async function loadInviteDomainNotice(actor: Actor | null, workspaceId: string | null): Promise<InviteDomainNotice | null> {
  if (!actor || !workspaceId) return null
  try {
    const loaded = await loadInviteDomains(await createServerClient(), workspaceId)
    if (!loaded.ok || loaded.domains.length > 0) return null
    if (!isWorkspaceAdmin(actor, workspaceId)) return { settingsHref: null }
    const ref = await workspaceRefById(workspaceId)
    return { settingsHref: ref.ok ? `${wsHref(ref.ws.slug, 'settings')}#workspace-invites` : null }
  } catch (e) {
    unstable_rethrow(e)   // Next 의 제어 흐름 신호는 삼키지 않는다
    console.error('[inviteDomainNotice] 초대 허용 도메인 조회 실패 — 사전 안내 없이 그린다:', { workspaceId, cause: e instanceof Error ? e.message : String(e) })
    return null
  }
}
