import { defineSetting, type Parsed } from '../def'

export type LocalDraftsSetting = {
  allowed: boolean
  retention_days: number
}

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

  if (r.retention_days < 1 || r.retention_days > 30) {
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

export const SECURITY_LOCAL_DRAFTS_DEF = defineSetting({
  key: 'security.local_drafts',
  scope: 'workspace',
  module: 'settings',
  default: {
    allowed: true,
    retention_days: 7,
  },
  parse: parseLocalDraftsSetting,
  widget: { kind: 'custom', component: 'SecurityLocalDraftsSetting' },
  editor: 'workspace_admin',
  apply: 'immediate',
  impact: ['none'],
  sql: null,
})
