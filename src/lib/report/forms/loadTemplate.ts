/**
 * 활성 양식 바이트 또는 제품 기본 파일 (정본 §4.6.4·§4.8).
 * template_id 가 있는데 행·객체를 못 읽으면 기본 파일로 바꾸지 않는다(§4.7.4).
 */
import { readFile } from 'fs/promises'
import path from 'path'
import { adminFor } from '@/lib/supabase/adminFor'
import { FORM_FORMAT, type FormKind } from '../engine/types'

const BUCKET = 'form-templates'

export class FormTemplateLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FormTemplateLoadError'
  }
}

export function defaultFormAssetPath(kind: FormKind): string {
  return path.join(process.cwd(), 'src/lib/report/assets/default', `${kind}.${FORM_FORMAT[kind]}`)
}

async function asBytes(data: unknown): Promise<Uint8Array | null> {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (typeof Blob !== 'undefined' && data instanceof Blob) return new Uint8Array(await data.arrayBuffer())
  return null
}

export async function loadFormTemplate(
  projectId: string,
  kind: FormKind,
  templateId: string | null,
): Promise<{ bytes: Uint8Array; source: 'default' | 'custom' }> {
  if (!templateId) {
    try {
      const bytes = new Uint8Array(await readFile(defaultFormAssetPath(kind)))
      if (bytes.length < 1) throw new FormTemplateLoadError('기본 양식을 읽지 못했습니다.')
      return { bytes, source: 'default' }
    } catch (error) {
      if (error instanceof FormTemplateLoadError) throw error
      throw new FormTemplateLoadError('기본 양식을 읽지 못했습니다.')
    }
  }
  const { admin } = adminFor({ projectId })
  const row = await admin.from('form_templates').select('id, storage_path, active, form_kind')
    .eq('id', templateId).eq('project_id', projectId).eq('form_kind', kind).maybeSingle()
  if (row.error || !row.data || row.data.active !== true || typeof row.data.storage_path !== 'string' || !row.data.storage_path) {
    throw new FormTemplateLoadError('양식 파일을 읽지 못했습니다.')
  }
  const downloaded = await admin.storage.from(BUCKET).download(row.data.storage_path)
  const bytes = !downloaded.error && downloaded.data != null ? await asBytes(downloaded.data) : null
  if (!bytes || bytes.length < 1) throw new FormTemplateLoadError('양식 파일을 읽지 못했습니다.')
  return { bytes, source: 'custom' }
}
