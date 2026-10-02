// 전역 화면 넷의 '기준 시간대' 한 줄(SP5 A — A-5 리뷰 O2). 다중 소속 폴백(differs·unreadable)일 때만 그린다 — 소속 달력·소속 없음은 그리지 않는다.
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ViewBasisNotice, viewBasisText } from '@/components/calendar/ViewBasisNotice'

describe('viewBasisText', () => {
  it('unreadable — "기준 시간대: UTC(일부 워크스페이스 달력을 읽지 못함)"', () => {
    expect(viewBasisText('unreadable', 'UTC', 'ko')).toBe('기준 시간대: UTC(일부 워크스페이스 달력을 읽지 못함)')
    expect(viewBasisText('unreadable', 'UTC', 'en')).toContain('UTC')
  })
  it('differs — 기준 시간대와 "서로 다름"', () => {
    expect(viewBasisText('differs', 'UTC', 'ko')).toContain('기준 시간대: UTC')
    expect(viewBasisText('differs', 'UTC', 'ko')).toContain('서로 달라')
  })
  it('member·none 은 그리지 않는다', () => {
    expect(viewBasisText('member', 'Asia/Seoul', 'ko')).toBeNull()
    expect(viewBasisText('none', 'UTC', 'ko')).toBeNull()
    expect(renderToStaticMarkup(<ViewBasisNotice basis="member" timeZone="Asia/Seoul" locale="ko" />)).toBe('')
  })
  it('그릴 때는 role=note 한 줄', () => {
    const html = renderToStaticMarkup(<ViewBasisNotice basis="unreadable" timeZone="UTC" locale="ko" className="mb-3" />)
    expect(html).toContain('role="note"')
    expect(html).toContain('data-view-basis="unreadable"')
    expect(html).toContain('mb-3')
  })
})

describe('전역 화면 넷이 그 줄을 그린다(UI-2 전 경로 — 레인 B 병합 때 새 경로로 옮긴다)', () => {
  it.each([
    ['src/app/(app)/projects/page.tsx', 'basis={vz.basis} timeZone={vz.timeZone}'],
    ['src/app/(app)/portfolio/page.tsx', 'basis={vz.basis} timeZone={vz.timeZone}'],
    ['src/app/(app)/meetings/page.tsx', 'basis={vc.basis} timeZone={vc.calendar.timezone}'],
    ['src/app/(app)/minutes/page.tsx', 'basis={vc.basis} timeZone={vc.calendar.timezone}'],
  ])('%s', (file, props) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('<ViewBasisNotice')
    expect(src).toContain(props)
  })
})
