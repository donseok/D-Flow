/**
 * 로컬 초안 정책의 서버 읽기(SPU1, 개정 §5.8.5) — 워크스페이스 `security.local_drafts`. 워크스페이스 전역 키라 프로젝트 화면의 편집 표면도
 * 이 값을 따른다(개정 §2.9 화면별 해석 규칙 '보안 제한'). 편집 화면의 페이지가 불러 클라이언트 편집기에 내려준다 — 판정은 storage.ts 한 곳.
 * 워크스페이스를 모르거나 설정을 못 읽거나 값이 손상이면 초안을 끈다(fail-closed — 보안 제한을 기본값으로 풀지 않는다). 사유는 로그.
 */
import { unstable_rethrow } from 'next/navigation'
import { valueOf } from '@/lib/settings/registry'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { DRAFTS_OFF_POLICY, type LocalDraftPolicy } from './storage'

export async function loadLocalDraftPolicy(workspaceId: string | null): Promise<LocalDraftPolicy> {
  if (!workspaceId) {
    console.error('[drafts] 워크스페이스를 몰라 로컬 초안을 끈다')
    return DRAFTS_OFF_POLICY
  }
  try {
    const v = valueOf(await getWorkspaceConfig(workspaceId), 'security.local_drafts')
    return { allowed: v.allowed, retention_days: v.retention_days }
  } catch (e) {
    unstable_rethrow(e)
    console.error('[drafts] security.local_drafts 를 읽지 못해 로컬 초안을 끈다:', workspaceId, e instanceof Error ? e.message : e)
    return DRAFTS_OFF_POLICY
  }
}
