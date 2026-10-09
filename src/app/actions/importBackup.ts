'use server'
// replace 사전 백업(SP4 D50·§4.4) — 마법사가 replace 를 보내기 전에 지금 트리를 받아 '실행 전' 백업 파일로 내려받는다.
// 응답을 잃은 replace 는 교체 전 원본을 되살릴 수 없었다(K9) — 그 원본을 실행 전에 사용자 손에 둔다.
// 세션 클라이언트로 그 프로젝트 wbs_items 를 끝까지 읽는다(한 응답은 max_rows 에서 조용히 잘린다, D18). 라우트의 교체 직전 백업과 같은
// id 키셋(fetchAllByKeyset — A1-1 K2: offset 은 쪽 사이의 삽입에서 한 행을 두 번, 다른 한 행을 0번 읽고 행 수가 같아 통과한다).
// 모양은 가져오기 라우트의 교체 직전 백업과 같다(select('*') — change_logs 는 대상 아님).
// 읽기 실패·잘림·읽는 사이의 변경은 ok:false 고정 문구(원문은 failWith 가 로그로) — 마법사는 그때 실행하지 않는다.
import { requireProjectAdmin } from '@/lib/authz'
import { createServerClient } from '@/lib/supabase/server'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { isUuidLike } from '@/lib/domain/validate'
import { failWith } from '@/lib/errors/dbFail'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

export type WbsBackupResult =
  | { ok: true; backup: { rows: unknown[]; generatedAt: string } }
  | { ok: false; code: string; error: string }

const ERR_INVALID = 'err.invalidRequest'
const ERR_BACKUP = 'srv.importBackup.couldNotBackUpWbs'

export async function getWbsBackup(projectId: string): Promise<WbsBackupResult> {
  const t = await serverTranslator()
  if (typeof projectId !== 'string' || !isUuidLike(projectId)) return { ok: false, code: 'INVALID_INPUT', error: t(ERR_INVALID) }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, code: 'DENIED', error: libText(t, g.error) }
  try {
    const sb = await createServerClient()
    const rows = await fetchAllByKeyset<Record<string, unknown>>('wbs_items 사전 백업', (r) => String(r.id), (after, limit) => {
      const q = sb.from('wbs_items').select('*', { count: 'exact' }).eq('project_id', projectId)
      return (after ? q.gt('id', String(after.id)) : q).order('id').limit(limit)
    })
    return { ok: true, backup: { rows, generatedAt: new Date().toISOString() } }
  } catch (e) {
    return { ok: false, code: 'BACKUP_UNAVAILABLE', error: failWith('import-backup', e, t(ERR_BACKUP)) }
  }
}
