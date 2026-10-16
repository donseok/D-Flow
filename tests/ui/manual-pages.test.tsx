// @vitest-environment jsdom
// 사용자 매뉴얼 화면(/help, /help/[chapter]) — 서버 컴포넌트를 함수로 불러 결과 요소를 jsdom 에 그린다(스펙 2026-10-16 §2).
// 장 원문은 합성 4장으로 갈아 끼운다(실제 장은 따로 쓴다) — 목차 거르기·검색·앵커·이웃 장·본문 링크를 본다.
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '../shell/_dom'
import { makeActor, makeAdminActor, makeSuperuser } from '../fixtures/actor'

const mocks = vi.hoisted(() => ({
  getActorViewState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_HTTP_ERROR_FALLBACK;404') }),
  sources: [
    { file: '01-getting-started.md', raw: [
      '---', 'title: 시작하기', 'part: start', 'audience: member', 'summary: 처음 쓰는 분을 위한 안내입니다.', '---', '',
      '처음이라면 [주간보고](/help/weekly)를 보고, 막히면 [외부 안내](https://example.com/guide)를 참고하세요. 절 바로가기는 [마무리](#마무리)입니다. [위험한 주소](javascript:alert(1))는 링크가 아니다.', '',
      '## 로그인', '', '로그인 방법입니다.', '',
      '## 마무리', '', '끝까지 읽으셨습니다.', '',
      '## 도움 받기', '',
      '### 문의하기', '', '관리자에게 문의합니다.', '',
    ].join('\n') },
    { file: '02-weekly.md', raw: [
      '---', 'title: 주간보고', 'part: daily', 'audience: member', 'summary: 주간보고를 쓰고 붙여넣는 법입니다.', '---', '',
      '# 본문 안의 장 제목', '',
      '주간보고 개요입니다. [시작하기](/help/getting-started)로 돌아갈 수 있습니다.', '',
      '## 붙여넣기', '', '엑셀에서 복사한 내용을 붙여넣기 하면 칸에 들어갑니다.', '',
      '### 여러 줄', '', '여러 줄도 한 칸에 넣을 수 있습니다.', '',
      '## 붙여넣기', '', '두 번째 같은 제목의 절입니다.', '',
    ].join('\n') },
    { file: '03-project-admin.md', raw: [
      '---', 'title: 승인 규칙 설정', 'part: projectAdmin', 'audience: projectAdmin', 'summary: 승인규칙을 정하는 방법입니다.', '---', '',
      '승인규칙을 정하는 방법입니다.', '',
      '## 규칙 만들기', '', '규칙을 만듭니다.', '',
    ].join('\n') },
    { file: '04-platform-admin.md', raw: [
      '---', 'title: 플랫폼 운영 점검', 'part: platformAdmin', 'audience: platformAdmin', 'summary: 플랫폼 관리자만 쓰는 화면입니다.', '---', '',
      '플랫폼 관리자만 쓰는 화면입니다. [승인 규칙](/help/project-admin)을 먼저 보세요.', '',
      '## 점검하기', '', '운영 점검 방법입니다.', '',
    ].join('\n') },
  ],
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a data-next-link="" href={href} {...rest}>{children}</a>,
}))
vi.mock('@/content/manual/chapters.generated', () => ({ MANUAL_SOURCES: mocks.sources }))

import ManualHomePage from '@/app/(app)/(global)/help/page'
import ManualChapterPage from '@/app/(app)/(global)/help/[chapter]/page'
import { manualChapter } from '@/lib/manual/chapters'

const MEMBER = { actor: makeActor(), degraded: false }
const PROJECT_ADMIN = { actor: makeAdminActor('p1'), degraded: false }
const PLATFORM_ADMIN = { actor: makeSuperuser(), degraded: false }
const DEGRADED = { actor: null, degraded: true }

async function home(state: unknown, q?: string | string[]) {
  mocks.getActorViewState.mockResolvedValue(state)
  const el = (await ManualHomePage({ searchParams: Promise.resolve(q === undefined ? {} : { q }) })) as ReactElement
  return render(el).container
}
async function chapterPage(state: unknown, chapter: string) {
  mocks.getActorViewState.mockResolvedValue(state)
  const el = (await ManualChapterPage({ params: Promise.resolve({ chapter }) })) as ReactElement
  return render(el).container
}
const hrefs = (root: ParentNode, selector: string) => Array.from(root.querySelectorAll<HTMLAnchorElement>(selector)).map((a) => a.getAttribute('href'))
const chapterLinks = (root: ParentNode) => hrefs(root, 'a[href^="/help/"]')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})   // 열화 판독은 서버 로그를 남긴다(조회 실패를 숨기지 않는다)
})

describe('/help — 첫 화면의 목차', () => {
  it('일반 사용자는 member 장 둘만 보고, 관리자 장은 제목도 부 이름도 없다', async () => {
    const c = await home(MEMBER)
    expect(chapterLinks(c)).toEqual(['/help/getting-started', '/help/weekly'])
    expect(c.textContent).toContain('시작하기')
    expect(c.textContent).toContain('매일 쓰는 기능')
    expect(c.textContent).not.toContain('승인 규칙 설정')
    expect(c.textContent).not.toContain('플랫폼 운영 점검')
    expect(c.textContent).not.toContain('프로젝트 관리자')   // 부 제목도 없다
    expect(c.querySelectorAll('[data-manual-badge]')).toHaveLength(0)
    expect(c.textContent).toContain('일반 사용자 기준으로 볼 수 있는 장을 보여 줍니다.')
    expect(c.querySelector('h1')?.textContent).toBe('사용자 매뉴얼')
  })

  it('플랫폼 관리자는 네 장 모두, 관리자 장에는 "…용" 표지가 붙는다', async () => {
    const c = await home(PLATFORM_ADMIN)
    expect(chapterLinks(c)).toEqual(['/help/getting-started', '/help/weekly', '/help/project-admin', '/help/platform-admin'])
    expect(Array.from(c.querySelectorAll('[data-manual-badge]')).map((b) => b.textContent)).toEqual(['프로젝트 관리자용', '플랫폼 관리자용'])
    expect(c.textContent).toContain('플랫폼 관리자 기준으로 볼 수 있는 장을 보여 줍니다.')
    expect(c.textContent).toContain('주간보고를 쓰고 붙여넣는 법입니다.')   // 장 요약
  })

  it('프로젝트 관리자는 플랫폼 관리자 장을 보지 못한다', async () => {
    const c = await home(PROJECT_ADMIN)
    expect(chapterLinks(c)).toEqual(['/help/getting-started', '/help/weekly', '/help/project-admin'])
  })

  it('권한 판독이 열화되면 member 장만 보이고 그 사실을 알린다', async () => {
    const c = await home(DEGRADED)
    expect(chapterLinks(c)).toEqual(['/help/getting-started', '/help/weekly'])
    expect(c.textContent).toContain('권한 정보를 불러오지 못해 일반 사용자용 장만 보여 줍니다.')
    expect(c.textContent).not.toContain('기준으로 볼 수 있는 장을 보여 줍니다.')
  })
})

describe('/help?q= — 낱말 찾기', () => {
  it('찾은 절로 가는 링크는 /help/<장>#<앵커> 이고 결과 건수·발췌가 보인다', async () => {
    const c = await home(MEMBER, '붙여넣기')
    const list = c.querySelector('ol')!
    const links = hrefs(list, 'a')
    expect(links).toContain(`/help/weekly#${encodeURIComponent('붙여넣기')}`)
    expect(links).toContain(`/help/weekly#${encodeURIComponent('붙여넣기-2')}`)
    expect(c.textContent).toContain(`'붙여넣기' 검색 결과 ${links.length}건`)
    expect(c.textContent).toContain('엑셀에서 복사한 내용을')            // 발췌
    expect(c.textContent).toContain('주간보고 › 붙여넣기')                  // 장 › 절
    expect(hrefs(c, 'a[href="/help"]')).toHaveLength(1)                    // 검색 지우기
    expect(c.textContent).not.toContain('매일 쓰는 기능')                   // 검색 중에는 장 카드 목록을 그리지 않는다
    expect((c.querySelector('input[name="q"]') as HTMLInputElement).value).toBe('붙여넣기')
  })

  it('본문이 없는 절(바로 아래가 소절)이 걸려도 발췌 줄 없이 깔끔하게 그린다', async () => {
    const c = await home(MEMBER, '도움')
    const items = Array.from(c.querySelectorAll('ol > li'))
    expect(items).toHaveLength(1)
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe(`/help/getting-started#${encodeURIComponent('도움-받기')}`)
    expect(items[0].querySelector('a')?.textContent).toBe('시작하기 › 도움 받기')
    expect(items[0].querySelector('p')).toBeNull()                    // 빈 발췌 줄을 그리지 않는다
    expect(items[0].textContent).toBe('시작하기 › 도움 받기')
    const withExcerpt = await home(MEMBER, '문의합니다')
    expect(withExcerpt.querySelector('ol > li p')?.textContent).toContain('관리자에게 문의합니다.')
  })

  it('없는 낱말은 "찾지 못했습니다" 와 팁을 보인다', async () => {
    const c = await home(MEMBER, '없는낱말')
    expect(c.querySelector('ol')).toBeNull()
    expect(c.textContent).toContain("'없는낱말'에 맞는 내용을 찾지 못했습니다.")
    expect(c.textContent).toContain('낱말을 줄이거나 다른 말로 찾아보세요.')
  })

  it('일반 사용자는 관리자 장에만 있는 낱말로 0건이고, 관리자는 찾는다', async () => {
    const m = await home(MEMBER, '승인규칙')
    expect(m.textContent).toContain('찾지 못했습니다')
    expect(m.querySelector('ol')).toBeNull()
    const a = await home(PROJECT_ADMIN, '승인규칙')
    expect(hrefs(a.querySelector('ol')!, 'a')[0]).toMatch(/^\/help\/project-admin/)
  })

  it('낱말이 공백뿐이면 검색이 아니다 — 장 카드가 그대로 보인다', async () => {
    const c = await home(MEMBER, '   ')
    expect(c.querySelector('ol')).toBeNull()
    expect(c.textContent).not.toContain('검색 결과')
    expect(chapterLinks(c)).toEqual(['/help/getting-started', '/help/weekly'])
  })

  it('찾기 양식은 GET /help 이고 보이는 라벨과 100자 제한이 있다', async () => {
    const c = await home(MEMBER)
    const form = c.querySelector('form[role="search"]') as HTMLFormElement
    expect(form.getAttribute('action')).toBe('/help')
    expect(form.getAttribute('method')).toBe('get')
    const input = form.querySelector('input[name="q"]') as HTMLInputElement
    expect(input.maxLength).toBe(100)
    expect(form.querySelector(`label[for="${input.id}"]`)?.textContent).toBe('매뉴얼에서 찾기')
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('찾기')
  })
})

describe('/help/[chapter] — 장 화면', () => {
  it('본문 h2·h3 의 id 는 해석기의 절 id 와 같고, "이 장의 내용" 링크가 그 id 를 가리킨다(같은 제목은 -2)', async () => {
    const c = await chapterPage(MEMBER, 'weekly')
    const sections = manualChapter('weekly')!.sections
    expect(sections.map((s) => s.id)).toEqual(['붙여넣기', '여러-줄', '붙여넣기-2'])
    const headingIds = Array.from(c.querySelectorAll('.minutes-md h2, .minutes-md h3')).map((h) => h.id)
    expect(headingIds).toEqual(sections.map((s) => s.id))
    const toc = c.querySelector('nav[aria-label="이 장의 내용"]')!
    const tocHrefs = hrefs(toc, 'a')
    expect(tocHrefs).toEqual(sections.map((s) => `#${encodeURIComponent(s.id)}`))
    expect(tocHrefs.map((h) => decodeURIComponent(h!.slice(1)))).toEqual(headingIds)
  })

  it('h1 은 화면 머리의 장 제목 하나뿐이고, 본문의 # 은 그리지 않는다', async () => {
    const c = await chapterPage(MEMBER, 'weekly')
    expect(Array.from(c.querySelectorAll('h1')).map((h) => h.textContent)).toEqual(['주간보고'])
    expect(c.textContent).not.toContain('본문 안의 장 제목')
  })

  it('이전·다음 장은 보이는 장 기준이다', async () => {
    const m = await chapterPage(MEMBER, 'weekly')
    expect(hrefs(m.querySelector('[data-manual-pager]')!, 'a')).toEqual(['/help/getting-started', '/help'])   // 다음 장 없음(관리자 장은 숨은 장)
    const a = await chapterPage(PLATFORM_ADMIN, 'weekly')
    expect(hrefs(a.querySelector('[data-manual-pager]')!, 'a')).toEqual(['/help/getting-started', '/help', '/help/project-admin'])
  })

  it('왼쪽 목차는 보이는 장만 싣고 현재 장에 aria-current 를 단다', async () => {
    const c = await chapterPage(MEMBER, 'weekly')
    const navs = Array.from(c.querySelectorAll('nav[aria-label="매뉴얼 목차"]'))
    expect(navs.length).toBeGreaterThan(0)
    for (const nav of navs) {
      expect(hrefs(nav, 'a')).toEqual(['/help/getting-started', '/help/weekly'])
      expect(nav.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('/help/weekly')
    }
  })

  it('일반 사용자가 관리자 장 주소로 와도 본문이 그려지고 등급 안내가 붙는다(이웃 장 링크는 없다)', async () => {
    const c = await chapterPage(MEMBER, 'platform-admin')
    expect(c.querySelector('h1')?.textContent).toBe('플랫폼 운영 점검')
    expect(c.textContent).toContain('운영 점검 방법입니다.')
    expect(c.textContent).toContain('이 장은 플랫폼 관리자용입니다. 지금 등급에서는 여기 나오는 화면이나 버튼이 보이지 않을 수 있습니다.')
    expect(hrefs(c.querySelector('[data-manual-pager]')!, 'a')).toEqual(['/help'])
  })

  it('볼 수 있는 등급이면 등급 안내 상자가 없다', async () => {
    const c = await chapterPage(PLATFORM_ADMIN, 'platform-admin')
    expect(c.textContent).not.toContain('지금 등급에서는')
    expect(c.querySelector('[data-manual-badge]')?.textContent).toBe('플랫폼 관리자용')
  })

  it('열화된 판독이면 일반 사용자 기준이고 그 사실을 알린다', async () => {
    const c = await chapterPage(DEGRADED, 'weekly')
    expect(c.textContent).toContain('권한 정보를 불러오지 못해 일반 사용자용 장만 보여 줍니다.')
  })

  it('없는 장은 notFound 를 부른다', async () => {
    mocks.getActorViewState.mockResolvedValue(MEMBER)
    await expect(ManualChapterPage({ params: Promise.resolve({ chapter: 'nope' }) })).rejects.toThrow('404')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it('본문의 /help 링크는 next/link, 외부 링크는 새 창, # 링크는 그대로 둔다', async () => {
    const c = await chapterPage(MEMBER, 'getting-started')
    const body = c.querySelector('.minutes-md')!
    const inner = body.querySelector('a[href="/help/weekly"]') as HTMLAnchorElement
    expect(inner.hasAttribute('data-next-link')).toBe(true)
    expect(inner.hasAttribute('target')).toBe(false)
    const ext = body.querySelector('a[href="https://example.com/guide"]') as HTMLAnchorElement
    expect(ext.hasAttribute('data-next-link')).toBe(false)
    expect(ext.target).toBe('_blank')
    expect(ext.rel).toBe('noreferrer')
    const hash = Array.from(body.querySelectorAll<HTMLAnchorElement>('a')).find((a) => a.getAttribute('href')?.startsWith('#'))!
    expect(hash.hasAttribute('target')).toBe(false)
    expect(decodeURIComponent(hash.getAttribute('href')!.slice(1))).toBe('마무리')
    expect(body.querySelector('h2[id="마무리"]')).not.toBeNull()   // 본문 안의 # 링크가 가리키는 제목이 실제로 있다
    // 안전하지 않은 주소는 react-markdown 이 비운다 — 빈 href 링크(새 창으로 현재 화면을 여는)로 그리지 않고 글자만 남긴다
    expect(body.textContent).toContain('위험한 주소')
    expect(Array.from(body.querySelectorAll('a')).some((a) => !a.getAttribute('href'))).toBe(false)
  })
  it('장 목록 영역과 이전·다음 묶음은 이름이 있는 랜드마크다', async () => {
    const c = await chapterPage(MEMBER, 'weekly')
    expect(c.querySelector('aside')!.getAttribute('aria-label')).toBe('매뉴얼 목차')
    expect(c.querySelector('[data-manual-pager]')!.getAttribute('aria-label')).toBe('이전·다음 장')
  })
})
