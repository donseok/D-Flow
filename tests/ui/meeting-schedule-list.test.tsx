import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { MeetingOccurrence } from '@/lib/domain/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
const modal = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }))
vi.mock('@/components/meetings/MeetingDetailModal', () => ({
  MeetingDetailModal: (p: Record<string, unknown>) => { modal.props.push(p); return null },
}))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  return { useLocale: () => ({ locale: 'ko', setLocale: vi.fn(), t: (k: never) => t('ko', k) }) }
})

import { MeetingScheduleList } from '@/components/dashboard/MeetingScheduleList'

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
function occ(seriesId: string, over: Partial<MeetingOccurrence> = {}): MeetingOccurrence {
  return {
    occurrenceId: `${seriesId}:2026-08-29`, seriesId, occurrenceDate: '2026-08-29', projectId: 'p1',
    title: `회의 ${seriesId}`, startTime: '10:00', endTime: '11:00', location: null, category: 'general',
    isRecurring: false, attendeeCount: 0, ...over,
  }
}

describe('MeetingScheduleList — 참석자·메모 열', () => {
  it('참석자 3명까지 이름을 보이고 나머지는 "외 N명", 메모는 1줄 요약을 보인다', () => {
    const html = renderToStaticMarkup(
      <MeetingScheduleList rows={[occ('m1')]} today="2026-08-28"
        extras={{ m1: { attendees: ['김철수', '박영희', '이몽룡', '홍길동', '성춘향'], memo: '예산 안건 검토' } }} />,
    )
    const text = textOf(html)
    expect(text).toContain('김철수, 박영희, 이몽룡')
    expect(text).toContain('외 2명')
    expect(text).not.toContain('홍길동')
    expect(text).toContain('예산 안건 검토')
    // 전체 명단은 툴팁으로 남긴다
    expect(html).toContain('title="김철수, 박영희, 이몽룡, 홍길동, 성춘향"')
  })

  it('참석자·메모가 없으면 빈 상태 문구를 낮은 대비로 보인다', () => {
    const html = renderToStaticMarkup(
      <MeetingScheduleList rows={[occ('m2')]} today="2026-08-28" extras={{ m2: { attendees: [], memo: '' } }} />,
    )
    const text = textOf(html)
    expect(text).toContain('참석자 미지정')
    expect(text).toContain('메모 없음')
  })

  it('extras 에 없는 시리즈도 터지지 않고 빈 상태로 그린다', () => {
    const html = renderToStaticMarkup(<MeetingScheduleList rows={[occ('m3')]} today="2026-08-28" extras={{}} />)
    expect(textOf(html)).toContain('회의 m3')
  })
})

describe('MeetingScheduleList — 상세 모달 관리자 게이트', () => {
  it('canManage 가 상세 모달의 관리자 판정(isAdmin)으로 그대로 내려간다', () => {
    modal.props.length = 0
    renderToStaticMarkup(<MeetingScheduleList rows={[occ('m4')]} today="2026-08-28" extras={{}} canManage />)
    expect(modal.props.at(-1)).toMatchObject({ isAdmin: true })
  })
  it('기본값은 false — 조회 전용·멤버에게 남의 회의 수정을 열지 않는다(fail-closed)', () => {
    modal.props.length = 0
    renderToStaticMarkup(<MeetingScheduleList rows={[occ('m5')]} today="2026-08-28" extras={{}} />)
    expect(modal.props.at(-1)).toMatchObject({ isAdmin: false })
  })
})
