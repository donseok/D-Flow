// 챗 회의록 답변의 한 줄 머리(`일자 · 팀 · 제목`) — 팀 없는 회의록(team_code 빈 값, 0052)은 팀 칸을 뺀다.
// 빈 칸을 그대로 두면 출처 목록·프롬프트에 `2026-10-09 ·  · 제목` 이 남는다.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { minuteHead } from '@/lib/ai/minutes-answer'

describe('minuteHead', () => {
  it('팀이 있으면 일자 · 팀 · 제목', () => {
    expect(minuteHead({ minuteDate: '2026-10-09', teamCode: 'QA', title: '주간 회의' })).toBe('2026-10-09 · QA · 주간 회의')
  })
  it('팀 없는 회의록은 팀 칸 없이 일자 · 제목 — 구분점이 겹치지 않는다', () => {
    const head = minuteHead({ minuteDate: '2026-10-09', teamCode: '', title: '전체 타운홀' })
    expect(head).toBe('2026-10-09 · 전체 타운홀')
    expect(head).not.toContain('·  ·')
  })
  it('팀 행이 지워진 옛 회의록은 원문 code 가 그대로 보인다(팀 없음과 구분)', () => {
    expect(minuteHead({ minuteDate: '2026-10-09', teamCode: 'OLD', title: '옛 조직 회의' })).toBe('2026-10-09 · OLD · 옛 조직 회의')
  })
})
