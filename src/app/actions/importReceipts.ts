'use server'
// 가져오기 영수증 읽기(SP4 §4.4·D5) — 본인이 그 프로젝트에서 실행한 명령 id 하나의 요약(모드·건수·시각).
// 세션 클라이언트로 읽는다(RLS command_receipts_own_read — 본인 행만). 행위자·kind 도 명시해 PK 하나로 좁히고, 프로젝트로 거른다
// (Q14 — 같은 명령 id 를 다른 프로젝트에서 쓴 영수증은 receipt: null. 그렇지 않으면 P 화면이 Q 의 결과를 이 프로젝트의 실행으로 보이고
// SPU1 의 결과 불명 판정이 틀린다). 쓰는 곳 — B 의 결과 화면(#23 ?receipt=)·SPU1. 영수증은 고칠 수 없다(트리거) — 여기는 읽기만.
// 조회 실패는 고정 문구(원문은 failWith 가 로그로) — '영수증 없음'으로 위장하지 않는다(에러 3원칙 ①).
import { requireProjectAdmin } from '@/lib/authz'
import { createServerClient } from '@/lib/supabase/server'
import { isUuidLike } from '@/lib/domain/validate'
import { failWith } from '@/lib/errors/dbFail'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

export interface ImportReceiptView {
  commandId: string
  mode: 'append' | 'replace'
  count: number
  createdAt: string
}
export type ImportReceiptResult = { ok: true; receipt: ImportReceiptView | null } | { ok: false; error: string }

const ERR_INVALID = 'err.invalidRequest'
const ERR_RECEIPT = 'srv.importReceipts.couldNotLoadRunHistory'

type ReceiptRecord = { command_id: unknown; result: unknown; created_at: unknown }

/** 저장 결과(result — import_wbs_cmd 의 {status, mode, count, command_id})를 화면 요약으로. 모양이 어긋나면 null — 호출부가 읽기 실패로 올린다 */
function toView(row: ReceiptRecord): ImportReceiptView | null {
  const r = row.result
  if (typeof row.command_id !== 'string' || typeof row.created_at !== 'string' || r === null || typeof r !== 'object') return null
  const { mode, count } = r as { mode?: unknown; count?: unknown }
  if (mode !== 'append' && mode !== 'replace') return null
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return null
  return { commandId: row.command_id, mode, count, createdAt: row.created_at }
}

export async function getImportReceipt(projectId: string, commandId: string): Promise<ImportReceiptResult> {
  const t = await serverTranslator()
  // 입력은 타입을 믿지 않는다 — uuid 가 아닌 id 는 질의(22P02)까지 가지 않게 가드 앞에서 거른다
  if (typeof projectId !== 'string' || typeof commandId !== 'string' || !isUuidLike(projectId) || !isUuidLike(commandId)) {
    return { ok: false, error: t(ERR_INVALID) }
  }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: libText(t, g.error) }
  const sb = await createServerClient()
  const { data, error } = await sb.from('command_receipts')
    .select('command_id, result, created_at')
    .eq('actor', g.actor.userId)
    .eq('command_id', commandId)
    .eq('kind', 'wbs_import')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) return { ok: false, error: failWith('import-receipt', error, t(ERR_RECEIPT)) }
  if (!data) return { ok: true, receipt: null }
  const view = toView(data as ReceiptRecord)
  if (!view) return { ok: false, error: failWith('import-receipt', new Error(`영수증 요약의 모양이 기대와 다릅니다: ${commandId}`), t(ERR_RECEIPT)) }
  return { ok: true, receipt: view }
}
