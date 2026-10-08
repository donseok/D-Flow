import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 좁은 화면(390)의 달력 칸 — main 좌우 여백이 16px 로 늘어 칸 안쪽이 약 39px 인데 날짜 숫자(24px)와 같은 줄에서 말줄임이라
 * 공휴일 라벨이 한 글자('개'→'ㄱ')만 남았다(UI-2b 눈확인, 판정 R-390). 좁을 때는 라벨이 날짜 아래 한 줄을 통째로 쓰고 줄바꿈하며,
 * 넓을 때(sm 이상)는 종전처럼 날짜 옆에서 말줄임(title 로 전체 이름).
 * SP5(merge 뒤): 라벨은 한국 특일 오버레이(isRestDay·specialName) 대신 프로젝트·워크스페이스 달력의 이름(calendarDayInfo 의 info.name)이고
 * 쉬는 날 표시는 RestDayMark 가 따로 진다 — 라벨 className 은 정적 문자열이다. 줄바꿈 계약(이 파일의 판정)은 그대로다.
 */
const FILES = ['src/components/meetings/MeetingCalendar.tsx', 'src/components/attendance/AttendanceView.tsx']

describe.each(FILES)('공휴일 라벨 — %s', (f) => {
  const src = readFileSync(f, 'utf8')
  it('날짜 줄이 감싸지고(flex-wrap) sm 이상에서는 종전처럼 한 줄', () => {
    expect(src).toMatch(/<div className="flex flex-wrap items-center justify-between gap-x-1 px-0\.5 sm:flex-nowrap">/)
  })
  it('좁을 때 한 줄을 다 쓰고 글자 단위로 줄바꿈, 넓을 때만 말줄임', () => {
    const cls = src.match(/<span className="([^"]*\btext-meta\b[^"]*)" title=\{info\.name\}>/)?.[1] ?? ''
    expect(cls).not.toBe('')
    expect(cls).toMatch(/\bbasis-full\b/)
    expect(cls).toMatch(/\bbreak-all\b/)
    expect(cls).toMatch(/\bsm:basis-auto\b/)
    expect(cls).toMatch(/\bsm:truncate\b/)
    expect(cls).not.toMatch(/(^|\s)truncate\b/)
  })
  it('전체 이름은 title 로 남는다', () => {
    expect(src).toMatch(/title=\{info\.name\}/)
  })
})
