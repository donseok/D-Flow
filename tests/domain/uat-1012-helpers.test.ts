// 2026-10-12 사용자 테스트 결과서의 순수 판정들 — 로그인 뒤 돌아갈 자리(PERM-13), 위키 검색어 상한(WIKI-07), WBS 단계 이름 길이(PSET-06).
import { describe, expect, it } from 'vitest'
import { nextParamFor, safeNextPath } from '@/lib/auth/nextPath'
import { highlightSegments, snippetOf, WIKI_QUERY_MAX_CHARS } from '@/lib/domain/searchView'
import { LEVEL_LABEL_MAX_CHARS, validateLevelSettings } from '@/lib/domain/levelSettings'

describe('safeNextPath — 로그인 뒤 돌아갈 자리', () => {
  it('이 사이트 안의 경로는 쿼리째 그대로 돌려준다', () => {
    expect(safeNextPath('/p/abc/wbs?view=timeline')).toBe('/p/abc/wbs?view=timeline')
    expect(safeNextPath('/w/default/admin/accounts')).toBe('/w/default/admin/accounts')
  })

  it.each([
    [null], [undefined], [''],
    ['https://evil.example/x'], ['//evil.example/x'], ['/\\evil.example'], ['javascript:alert(1)'], ['p/abc'],
    ['/a\\b'], ['/a\nb'],
    ['/login'], ['/login/reset'], ['/login?next=/x'],
    [`/${'a'.repeat(2001)}`],
  ])('바깥 출처·로그인 화면·깨진 값(%s)은 홈으로 보낸다', (raw) => {
    expect(safeNextPath(raw)).toBe('/')
  })

  it('미들웨어가 싣는 값 — 홈은 싣지 않고, 그 밖은 경로와 쿼리를 붙여 싣는다', () => {
    expect(nextParamFor('/', '')).toBeNull()
    expect(nextParamFor('/p/abc/issues', '?focus=1')).toBe('/p/abc/issues?focus=1')
  })
})

describe('위키 검색어 상한', () => {
  it('상한을 넘는 질의는 앞 200자만 본다 — 그 뒤의 토큰은 강조·스니펫 중심에 쓰지 않는다', () => {
    const tail = '꼬리토큰'
    const query = `${'가'.repeat(WIKI_QUERY_MAX_CHARS)} ${tail}`
    const content = `앞부분 문장 ${tail} 뒷부분`
    expect(highlightSegments(content, query)).toEqual([{ text: content, hit: false }])
    expect(snippetOf(content, 200, query)).toBe(content)
  })

  it('수천 자·수백 토큰 질의도 조각 수가 본문 길이를 넘지 않는다', () => {
    const query = Array.from({ length: 800 }, (_, i) => `토큰${i}`).join(' ')
    const content = '토큰1 과 토큰2 가 든 본문 '.repeat(200)
    const segments = highlightSegments(content, query)
    expect(segments.map(s => s.text).join('')).toBe(content)
    expect(segments.length).toBeLessThanOrEqual(content.length)
  })
})

describe('WBS 단계 이름 길이', () => {
  it(`${LEVEL_LABEL_MAX_CHARS}자까지 받고, 넘으면 몇 번째 칸인지 알려 거부한다`, () => {
    expect(validateLevelSettings({ labels: ['가'.repeat(LEVEL_LABEL_MAX_CHARS)], currentTreeMaxDepth: null }).ok).toBe(true)
    expect(validateLevelSettings({ labels: ['단계', '가'.repeat(LEVEL_LABEL_MAX_CHARS + 1)], currentTreeMaxDepth: null }))
      .toEqual({ ok: false, error: `2번째 단계 이름은 ${LEVEL_LABEL_MAX_CHARS}자 이하여야 합니다.` })
  })
})
