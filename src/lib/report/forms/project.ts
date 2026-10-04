import { createServerClient } from '@/lib/supabase/server'

export interface ReportProjectRow {
  name: string
  description: string | null
  start_date: string | null
  end_date: string | null
}

export async function loadReportProject(projectId: string): Promise<ReportProjectRow | null> {
  const sb = await createServerClient()
  const { data, error } = await sb.from('projects').select('name, description, start_date, end_date').eq('id', projectId).maybeSingle()
  if (error) throw new Error(`[report] projects 조회 실패: ${error.message}`)
  if (!data || typeof data.name !== 'string') return null
  return {
    name: data.name,
    description: (data.description as string | null) ?? null,
    start_date: (data.start_date as string | null) ?? null,
    end_date: (data.end_date as string | null) ?? null,
  }
}
