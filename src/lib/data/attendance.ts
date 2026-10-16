import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import type { AttendanceRecord, AttendanceType } from '@/lib/domain/types'

export const ERR_ATTENDANCE_LOAD = '근태 기록을 불러오지 못했습니다.'

/**
 * 프로젝트 근태 기록 — 근태 화면과 주간보고(api/report)가 이 한 조회를 공유한다.
 * 실패는 빈 목록이 아니라 오류 결과다(3원칙 ①) — 빈 목록으로 돌려주면 화면은 "아직 등록된 근태가 없습니다",
 * 보고서는 근태 칸이 빈 채로 조용히 만들어져 원인을 추적할 수 없다. 호출부가 실패를 화면·응답에 드러낸다(getProjectRoster 와 같은 꼴).
 */
export const getAttendanceRecords = cache(async (
  projectId: string,
): Promise<{ ok: true; records: AttendanceRecord[] } | { ok: false; error: string }> => {
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('attendance_records')
    .select('id, project_id, member_id, date, type, note')
    .eq('project_id', projectId)
    .order('date', { ascending: true })

  if (error || !data) {
    console.error('[getAttendanceRecords] 조회 실패:', error?.message ?? 'unknown')
    return { ok: false, error: ERR_ATTENDANCE_LOAD }
  }

  return {
    ok: true,
    records: data.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      projectId: r.project_id as string,
      memberId: r.member_id as string,
      date: r.date as string,
      type: r.type as AttendanceType,
      note: (r.note as string) ?? null,
    })),
  }
})
