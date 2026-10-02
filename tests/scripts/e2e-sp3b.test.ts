import { describe, expect, it } from 'vitest'
import { expectLocation, hiddenVerdict, issuesLinkVerdict, legacyCases, shellBadgeVerdict, switcherVerdict } from '../../scripts/e2e-sp3b.mjs'

const O = 'http://127.0.0.1:3201'
const res = (status: number, location: string) => ({ status, headers: new Headers({ location }) })

describe('e2e-sp3b 순수 함수', () => {
  it('legacyCases — 옛 여덟 × 쿼리(없음·하나·여럿·인코딩)', () => {
    const cs = legacyCases('acme', { minuteId: 'm1', projectId: 'p1' })
    expect(cs).toContainEqual({ from: '/minutes?view=calendar', to: '/w/acme/minutes?view=calendar' })
    expect(cs).toContainEqual({ from: '/usage?days=7&menu=a&menu=b', to: '/w/acme/usage?days=7&menu=a&menu=b' })
    expect(cs).toContainEqual({ from: '/admin/accounts?project=p1', to: '/w/acme/admin/accounts?project=p1' })
    expect(cs).toContainEqual({ from: '/minutes/m1?block=2&version=v', to: '/w/acme/minutes/m1?block=2&version=v' })
    expect(cs.length).toBeGreaterThanOrEqual(16)
  })
  it('expectLocation — 307·요청 원점·경로·쿼리(상대 Location 도 원점에 풀어 본다)', () => {
    expect(expectLocation(res(307, `${O}/w/acme/minutes?view=x`), O, '/w/acme/minutes?view=x')).toEqual([])
    expect(expectLocation(res(307, '/w/acme/minutes?view=x'), O, '/w/acme/minutes?view=x')).toEqual([])
    expect(expectLocation(res(308, '/w/acme/minutes?view=x'), O, '/w/acme/minutes?view=x')).toEqual(['상태 308 ≠ 307'])
  })
  it('expectLocation — 인코딩 차이(%20 ↔ +)는 같은 값, 다른 호스트·경로·중복 키 순서는 다른 값', () => {
    expect(expectLocation(res(307, '/w/acme/minutes?q=a%20b'), O, '/w/acme/minutes?q=a+b')).toEqual([])
    expect(expectLocation(res(307, 'http://localhost:3201/w/acme/minutes'), O, '/w/acme/minutes')[0]).toMatch(/원점/)
    expect(expectLocation(res(307, '/w/other/minutes'), O, '/w/acme/minutes')[0]).toMatch(/경로/)
    expect(expectLocation(res(307, '/w/acme/usage?menu=b&menu=a'), O, '/w/acme/usage?menu=a&menu=b')[0]).toMatch(/쿼리/)
  })
  it('hiddenVerdict — 404 또는 notFound digest, 센티널이 본문에 있으면 문제', () => {
    expect(hiddenVerdict({ status: 404, html: '' })).toEqual([])
    expect(hiddenVerdict({ status: 200, html: 'x NEXT_HTTP_ERROR_FALLBACK;404 y' }, ['SECRET'])).toEqual([])
    expect(hiddenVerdict({ status: 200, html: 'ok' })[0]).toMatch(/404 가 아니다/)
    expect(hiddenVerdict({ status: 404, html: 'a SECRET b' }, ['SECRET'])[0]).toMatch(/SECRET/)
  })
})

describe('e2e-sp3b UI-2b 순수 판정(E5·E7·E10)', () => {
  const MARK = '<button type="button" data-ws-switcher="list" aria-haspopup="menu">A</button>'
  it('switcherVerdict — 소속 둘 이상이면 표지 있음, 하나면 없음, 표지가 둘(768~1023 드로어 이중 마운트)이어도 있음으로 본다', () => {
    expect(switcherVerdict(`<header>${MARK}</header>`, true)).toEqual([])
    expect(switcherVerdict(`${MARK}${MARK}`, true)).toEqual([])
    expect(switcherVerdict('<header><span>A</span></header>', false)).toEqual([])
    expect(switcherVerdict('<header><span>A</span></header>', true)[0]).toMatch(/트리거.*없다/)
    expect(switcherVerdict(`<header>${MARK}</header>`, false)[0]).toMatch(/트리거.*있다/)
  })
  it('issuesLinkVerdict — 켜짐은 링크 있음, 꺼짐은 없음, 내비가 안 그려진 화면은 대조 실패', () => {
    const wbs = '<a href="/p/p1/wbs">WBS</a>'
    const issues = '<a href="/p/p1/issues">이슈</a>'
    expect(issuesLinkVerdict(`${wbs}${issues}`, 'p1', true)).toEqual([])
    expect(issuesLinkVerdict(wbs, 'p1', false)).toEqual([])
    expect(issuesLinkVerdict(wbs, 'p1', true)).toEqual(['이슈 링크가 없다(모듈을 켰는데)'])
    expect(issuesLinkVerdict(`${wbs}${issues}`, 'p1', false)).toEqual(['이슈 링크가 있다(모듈을 껐는데)'])
    expect(issuesLinkVerdict('<p>오류</p>', 'p1', false)[0]).toMatch(/대조 실패/)
    expect(issuesLinkVerdict(`${wbs}<a href="/p/p1/issues/3">x</a>`, 'p1', false)).toEqual([])   // 접두가 같은 다른 경로는 이슈 내비가 아니다
    expect(issuesLinkVerdict(`${wbs}<a href="/p/p2/issues">x</a>`, 'p1', false)).toEqual([])   // 다른 프로젝트의 링크
  })
  it('shellBadgeVerdict — hidden 은 세 배지 모두 null, own 은 검토 대기 수가 숫자', () => {
    const ok = (badges: object) => ({ status: 200, body: { badges } })
    const nulls = { myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null }
    expect(shellBadgeVerdict(ok(nulls), 'hidden')).toEqual([])
    expect(shellBadgeVerdict(ok({ ...nulls, myWorkReview: 0 }), 'hidden')).toEqual(['myWorkReview = 0 (null 이어야 한다)'])
    expect(shellBadgeVerdict(ok({ ...nulls, projectApprovals: 2, projectUnreadAnnouncements: 1 }), 'hidden')).toHaveLength(2)
    expect(shellBadgeVerdict(ok({ ...nulls, myWorkReview: 0 }), 'own')).toEqual([])
    expect(shellBadgeVerdict(ok(nulls), 'own')[0]).toMatch(/숫자/)
    expect(shellBadgeVerdict({ status: 404, body: null }, 'hidden')).toEqual(['상태 404 ≠ 200'])
    expect(shellBadgeVerdict({ status: 200, body: {} }, 'hidden')).toEqual(['응답에 badges 가 없다'])
  })
})
