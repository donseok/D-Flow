// 보안 제한 키(개정 §2.8.1·§5.8.5) — 워크스페이스 전역 키라 프로젝트 화면의 편집 표면도 이 값을 따른다(§2.9 화면별 해석 규칙 '보안 제한').
// 개인 설정으로 완화하지 않는다. 소비는 src/lib/drafts/storage.ts(판정)·src/lib/drafts/policy.ts(서버 읽기) 한 길이다.
import { defineSetting, type Parsed } from '../def'

export type LocalDraftsSetting = {
  allowed: boolean
  retention_days: number
}

export const LOCAL_DRAFTS_RETENTION_MIN = 1
export const LOCAL_DRAFTS_RETENTION_MAX = 30
export const DEFAULT_LOCAL_DRAFTS: LocalDraftsSetting = { allowed: true, retention_days: 7 }

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

export function parseLocalDraftsSetting(raw: unknown): Parsed<LocalDraftsSetting> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return fail('로컬 초안 설정은 객체여야 합니다.')
  }
  const r = raw as Record<string, unknown>

  if (typeof r.allowed !== 'boolean') {
    return fail('allowed 는 불리언이어야 합니다.')
  }

  if (typeof r.retention_days !== 'number' || !Number.isInteger(r.retention_days)) {
    return fail('retention_days 는 정수여야 합니다.')
  }

  if (r.retention_days < LOCAL_DRAFTS_RETENTION_MIN || r.retention_days > LOCAL_DRAFTS_RETENTION_MAX) {
    return fail('retention_days 는 1~30일 사이여야 합니다.')
  }

  return {
    ok: true,
    value: {
      allowed: r.allowed,
      retention_days: r.retention_days,
    },
  }
}

export const SECURITY_LOCAL_DRAFTS_DEF = defineSetting<'security.local_drafts', LocalDraftsSetting>({
  key: 'security.local_drafts',
  scope: 'workspace',
  module: 'settings',
  default: { ...DEFAULT_LOCAL_DRAFTS },
  parse: parseLocalDraftsSetting,
  widget: { kind: 'custom', component: 'LocalDraftsEditor' },
  editor: 'workspace_admin',
  apply: 'immediate',
  impact: ['none'],
  sql: null,
})
