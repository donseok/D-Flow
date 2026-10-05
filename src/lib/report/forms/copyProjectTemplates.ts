/** Project creation owns these paths until its creation receipt is confirmed. */
import { randomUUID } from 'node:crypto'
import type { AdminClient } from '@/lib/supabase/adminFor'
import { FORM_FORMAT, type FormKind } from '../engine/types'

const BUCKET = 'form-templates'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export interface FormCopyRow {
  id: string; form_kind: FormKind; storage_path: string; size_bytes: number; version: number
  placeholders: unknown; file_name: string
}
export interface FormCopyPlan {
  projectId: string; manifest: FormCopyRow[]; paths: string[]
}
export class FormCopyError extends Error {}

export async function planProjectFormCopy(
  admin: AdminClient, workspaceId: string, sourceId: string, values: Record<string, unknown>,
): Promise<FormCopyPlan> {
  const result = await admin.from('form_templates')
    .select('id, form_kind, storage_path, size_bytes, version, placeholders, file_name')
    .eq('project_id', sourceId).eq('active', true).order('id')
  if (result.error || !Array.isArray(result.data)) throw new FormCopyError('양식 목록을 불러오지 못했습니다.')
  const rows = (result.data as FormCopyRow[]).map(({ id, form_kind, storage_path, size_bytes, version, placeholders, file_name }) =>
    ({ id, form_kind, storage_path, size_bytes, version, placeholders, file_name }))
  const kinds = new Set<FormKind>()
  for (const row of rows) {
    const ext = FORM_FORMAT[row.form_kind]
    const prefix = `ws/${workspaceId}/p/${sourceId}/${row.form_kind}/v`
    const suffix = typeof row.storage_path === 'string' && row.storage_path.startsWith(prefix) ? row.storage_path.slice(prefix.length) : ''
    const setting = values[`forms.${row.form_kind}`] as { template_id?: unknown } | undefined
    if (!Object.hasOwn(FORM_FORMAT, row.form_kind) || !ext || !UUID.test(row.id) || kinds.has(row.form_kind)
      || !Number.isSafeInteger(row.version) || row.version < 1
      || suffix !== `${row.version}.${ext}` || !Number.isSafeInteger(row.size_bytes) || row.size_bytes < 1
      || setting?.template_id !== row.id) {
      throw new FormCopyError('원본 양식 연결이 손상되어 복사할 수 없습니다.')
    }
    kinds.add(row.form_kind)
  }
  for (const kind of Object.keys(FORM_FORMAT) as FormKind[]) {
    const setting = values[`forms.${kind}`] as { template_id?: unknown } | undefined
    if (setting?.template_id != null && !rows.some(row => row.form_kind === kind && row.id === setting.template_id)) {
      throw new FormCopyError('원본 양식 연결이 손상되어 복사할 수 없습니다.')
    }
  }
  const projectId = randomUUID()
  return { projectId, manifest: rows, paths: rows.map(row => `ws/${workspaceId}/p/${projectId}/${row.form_kind}/v1.${FORM_FORMAT[row.form_kind]}`) }
}

/** Remove only this attempt's fresh destination, including an ambiguous failed copy. */
export async function discardProjectFormCopy(admin: AdminClient, plan: FormCopyPlan): Promise<void> {
  if (!plan.paths.length) return
  const result = await admin.storage.from(BUCKET).remove(plan.paths)
  if (result.error) throw new FormCopyError('복사 파일을 정리하지 못했습니다.')
}

export async function copyProjectFormFiles(admin: AdminClient, plan: FormCopyPlan): Promise<void> {
  try {
    for (let i = 0; i < plan.manifest.length; i++) {
      const result = await admin.storage.from(BUCKET).copy(plan.manifest[i].storage_path, plan.paths[i])
      if (result.error) throw new FormCopyError('양식 파일을 복사하지 못했습니다.')
    }
  } catch (error) {
    await discardProjectFormCopy(admin, plan)
    throw error
  }
}
