'use server'
/**
 * 어휘 code 이관(SP5 B4 묶음4 — 개정 §2.4.2, SP5 D58) — 참조가 있는 code 를 지우려면 그 행들을 다른 활성 code 로 먼저 옮긴다
 * (삭제 = 이관 → 삭제의 두 명령). 옮기기는 service_role DEFINER RPC migrate_setting_code 하나이고, RPC 가 행위자 등급을 다시 판정하고
 * 설정 행 FOR UPDATE 로 어휘 쓰기·다른 이관과 줄을 세운다. 이력은 남기지 않는다(뒤따르는 삭제 명령이 남긴다) — 건수는 반환값으로 보인다.
 * 원인 분류는 분석 실행 JSON 이 참조라 이관하지 않는다(삭제 금지·비활성만).
 */
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import type { ModuleId } from '@/lib/modules/defaults'
import { adminFor } from '@/lib/supabase/adminFor'
import { failWith, rpcFailure, type OwnTokenTable } from '@/lib/errors/dbFail'
import { ERR_VOCAB_RETRY, vocabInactiveMessage } from '@/lib/settings/vocabGuard'
import { VOCAB_CODE_RE, type VocabKey } from '@/lib/settings/vocab'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

/** 이관할 수 있는 키와 그 모듈 — 꺼진 모듈의 어휘는 옮기지 않는다(설정 화면도 그 편집기를 그리지 않는다) */
const MIGRATABLE: Readonly<Partial<Record<VocabKey, ModuleId>>> = {
  'attendance.types': 'attendance',
  'meetings.categories': 'meetings',
  'issues.severities': 'issues',
  'issues.sources': 'issue_analysis',
  'workflow.issue_statuses': 'issues',          // SP5b D3 — 같은 범주 안으로만(RPC 가 판정)
}
const ERR_MIGRATE = 'srv.vocab.couldNotMoveRecords'
const ERR_INPUT = 'srv.vocab.chooseItemMoveTargetItem'

export type MigrateVocabResult = { ok: true; moved: number } | { ok: false; error: string; retryable?: boolean }

/** 그 프로젝트에서 code 를 쓰는 행을 다른 활성 code 로 옮긴다. 행 수를 돌려준다(0 도 성공) */
export async function migrateVocabCode(projectId: string, key: string, from: string, to: string): Promise<MigrateVocabResult> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const moduleId = typeof key === 'string' ? MIGRATABLE[key as VocabKey] : undefined
  if (!moduleId) return { ok: false, error: t(ERR_INPUT) }
  const mod = await requireModule({ projectId }, moduleId)                     // 가드 뒤·입력 검증 앞(P17)
  if (!mod.ok) return { ok: false, error: mod.error }
  if (typeof from !== 'string' || typeof to !== 'string' || !VOCAB_CODE_RE.test(from) || !VOCAB_CODE_RE.test(to) || from === to) {
    return { ok: false, error: t(ERR_INPUT) }
  }
  const tokens: OwnTokenTable = {
    VOCAB_MIGRATE_FORBIDDEN: { status: 403, code: 'FORBIDDEN', message: t('srv.vocab.onlyAdminProjectCanMove') },
    VOCAB_MIGRATE_INPUT: { status: 400, code: 'INVALID', message: t(ERR_INPUT) },
    VOCAB_MIGRATE_ISOLATION: { status: 503, code: 'RETRY', message: libText(t, ERR_VOCAB_RETRY) },
    SETTINGS_ROW_MISSING: { status: 500, code: 'CONFIG_UNAVAILABLE', message: t(ERR_MIGRATE) },
    PROJECT_VOCAB_INACTIVE: { status: 400, code: 'TARGET_INACTIVE', message: vocabInactiveMessage(key as VocabKey) },
    SETTINGS_CODE_CATEGORY_MISMATCH: { status: 400, code: 'CATEGORY_MISMATCH', message: t('srv.vocab.recordsCanMovedOnlyStatus') },
  }
  const { admin } = adminFor({ projectId })
  const { data, error } = await admin.rpc('migrate_setting_code', {
    p_actor: g.actor.userId, p_project_id: projectId, p_key: key, p_from: from, p_to: to,
  })
  if (error) {
    if (error.code === '40P01') return { ok: false, error: libText(t, ERR_VOCAB_RETRY), retryable: true }
    const f = rpcFailure(error, tokens, t)
    if (!f) return { ok: false, error: failWith('vocab.migrate', error, t(ERR_MIGRATE)) }
    console.error('[vocab.migrate] 이관 거부:', f.token)
    return { ok: false, error: f.message, retryable: f.retryable || undefined }
  }
  const moved = Number(data)
  if (!Number.isSafeInteger(moved) || moved < 0) {
    return { ok: false, error: failWith('vocab.migrate', new Error(`이관 결과의 모양이 기대와 다릅니다: ${JSON.stringify(data)}`), t(ERR_MIGRATE)) }
  }
  revalidatePath(`/p/${projectId}`, 'layout')
  return { ok: true, moved }
}
