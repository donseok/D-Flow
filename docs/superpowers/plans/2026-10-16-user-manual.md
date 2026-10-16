# 사용자 매뉴얼 메뉴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인한 누구나 어느 화면에서든 여는 사용자 매뉴얼(`/help`)을 만들고, 등급별로 걸러 보이는 쉬운 한국어 본문을 채운다.

**Architecture:** 본문은 `src/content/manual/NN-slug.md`(머리말 + 마크다운). 생성 스크립트가 이를 `chapters.generated.ts`(문자열 배열)로 묶어 커밋하고, 순수 모듈 `src/lib/manual/*` 가 해석·검색한다. `(global)` 아래 서버 컴포넌트 두 화면이 `react-markdown` 으로 그리고, 보는 사람의 등급은 `src/lib/authz/manualAccess.ts` 가 actor 로 판정한다. 진입점은 내비 `ws.help` 와 계정 메뉴 링크.

**Tech Stack:** Next.js 15 App Router(서버 컴포넌트), react-markdown 10 + remark-gfm 4(기존 의존성), Vitest(jsdom), TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-16-user-manual-design.md`

## Global Constraints

- 제품은 한국어·라이트 전용. 화면 글자(제목·안내·버튼)는 사전 `src/lib/i18n/dict/*` 에 두고 `t(…)` 로 읽는다 — `src/components`·`src/app` 의 `.tsx` 에 한국어 리터럴 금지(`tests/invariants/i18n-no-korean-literals.test.ts`). 매뉴얼 본문은 `src/content/manual/*.md`(검사 대상 밖).
- `src/app/globals.css` 를 고치지 않는다. 본문 모양은 기존 `.minutes-md` 클래스(+ `--minutes-fs` 변수)를 재사용한다.
- `src/components/app/*` 는 UI 위험 파일 — 이 계획에서는 `AccountMenu.tsx` 한 파일만, Task 3 에서만 고친다. `navIcons.ts` 는 고치지 않는다(아이콘 `BookOpenText` 는 이미 표에 있다).
- 판정은 `src/lib/domain/authz.ts`·`src/lib/authz/**` 에서만. 액션·페이지에 `role === '…'` 을 적지 않는다.
- 조회 실패를 "데이터 없음"으로 위장하지 않는다 — 등급 판독 실패는 화면 안내 + `console.error`.
- 본문에 고객명·실명 금지. 화면에 없는 기능을 쓰지 않는다.
- `git add -A` 금지 — 파일명을 적어 stage. 커밋 메시지는 한국어, "왜". 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- push 금지(사람 확인 뒤 컨트롤러가 한다). 서브에이전트는 커밋만, 원격 명령 금지.
- 이 작업은 마이그레이션이 없다.

## Review Focus

1. 등급 판독이 실패(degraded·actor 없음)한 사람 — 일반 사용자 장만 보이고 안내 문구가 나와야 한다(빈 목차 금지). → Task 2 화면 테스트.
2. 주소로 상위 등급 장을 연 일반 사용자 — 404 가 아니라 본문 + "○○용" 안내. → Task 2.
3. 한글 제목의 앵커 — 목차 링크(`#…`)와 본문 제목의 `id` 가 같아야 하고, 같은 제목이 두 번이면 `-2` 가 붙어야 한다. → Task 1(파서)·Task 2(렌더 대조).
4. 검색어 경계 — 빈 칸만, 100자 넘음, 배열(`?q=a&q=b`), 정규식 특수문자(`(`·`*`). → Task 1.
5. 본문 링크가 없는 장·없는 앵커를 가리키는 경우 — 테스트가 잡아야 한다. → Task 1 내용 검사.

---

### Task 1: 내용 형식·생성기·해석·검색·등급 판정

**Files:**
- Create: `src/lib/manual/parse.ts`, `src/lib/manual/chapters.ts`, `src/lib/manual/search.ts`, `src/lib/authz/manualAccess.ts`, `scripts/manual-build.mjs`, `src/content/manual/01-getting-started.md`(맛보기), `src/content/manual/90-faq.md`(맛보기), `src/content/manual/chapters.generated.ts`(생성물)
- Modify: `package.json`(scripts 에 `"manual:build": "node scripts/manual-build.mjs"`)
- Test: `tests/manual/parse.test.ts`, `tests/manual/search.test.ts`, `tests/manual/content.test.ts`, `tests/authz/manual-access.test.ts`

**Interfaces:**
- Produces:
  - `parse.ts`: `MANUAL_AUDIENCES`, `type ManualAudience = 'member'|'projectAdmin'|'workspaceAdmin'|'platformAdmin'`, `MANUAL_PARTS`, `type ManualPart = 'start'|'daily'|'projectAdmin'|'workspaceAdmin'|'platformAdmin'|'help'`, `interface ManualSection { id: string; title: string; depth: 2 | 3 }`, `interface ManualBlock { sectionId: string | null; sectionTitle: string | null; text: string }`, `interface ManualChapter { file: string; slug: string; order: number; title: string; part: ManualPart; audience: ManualAudience; summary: string; body: string; sections: ManualSection[]; blocks: ManualBlock[] }`, `parseChapter(file: string, raw: string): ManualChapter`, `headingSlug(text: string): string`, `createSlugger(): (text: string) => string`(같은 제목 두 번째부터 `-2`, `-3`), `audienceRank(a: ManualAudience): number`
  - `chapters.ts`: `manualChapters(): readonly ManualChapter[]`(order 순), `manualChapter(slug: string): ManualChapter | undefined`, `visibleChapters(viewer: ManualAudience): ManualChapter[]`, `canSee(viewer: ManualAudience, chapter: ManualAudience): boolean`
  - `search.ts`: `MANUAL_QUERY_MAX = 100`, `normalizeQuery(q: string | string[] | undefined): string`, `interface ManualHit { slug: string; chapterTitle: string; sectionId: string | null; sectionTitle: string | null; excerpt: string }`, `searchManual(chapters: readonly ManualChapter[], query: string, limit?: number): ManualHit[]`
  - `manualAccess.ts`: `manualAudienceOf(actor: Actor | null): ManualAudience`, `manualViewer(state: { actor: Actor | null; degraded: boolean }): { audience: ManualAudience; uncertain: boolean }`
  - `scripts/manual-build.mjs`: `export function renderGenerated(root?: string): string`, 직접 실행하면 생성 파일을 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/manual/parse.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseChapter, headingSlug, createSlugger, audienceRank } from '@/lib/manual/parse'

const RAW = `---
title: 주간보고
part: daily
audience: member
summary: 업무영역별 주간 실적을 씁니다.
---

# 무시되는 제목

들어가는 말.

## 시트 열기

1. **주간보고** 메뉴를 누릅니다.

### 칸에 쓰기

\`\`\`
## 코드 안 제목은 절이 아니다
\`\`\`

## 시트 열기

> **팁** 같은 제목은 번호가 붙는다.
`

describe('parseChapter', () => {
  const ch = parseChapter('06-weekly.md', RAW)
  it('파일 이름에서 순서·slug, 머리말에서 메타를 읽는다', () => {
    expect(ch).toMatchObject({ file: '06-weekly.md', slug: 'weekly', order: 6, title: '주간보고', part: 'daily', audience: 'member', summary: '업무영역별 주간 실적을 씁니다.' })
    expect(ch.body.startsWith('---')).toBe(false)
  })
  it('## ·### 만 절이고 코드 블록 안은 건너뛰며, 같은 제목은 -2 가 붙는다', () => {
    expect(ch.sections).toEqual([
      { id: '시트-열기', title: '시트 열기', depth: 2 },
      { id: '칸에-쓰기', title: '칸에 쓰기', depth: 3 },
      { id: '시트-열기-2', title: '시트 열기', depth: 2 },
    ])
  })
  it('검색 블록은 절마다 평문(표기 기호 제거)', () => {
    expect(ch.blocks[0]).toMatchObject({ sectionId: null, sectionTitle: null })
    expect(ch.blocks[0].text).toContain('들어가는 말.')
    const open = ch.blocks.find((b) => b.sectionId === '시트-열기')!
    expect(open.text).toContain('주간보고 메뉴를 누릅니다.')
    expect(open.text).not.toContain('**')
    expect(ch.blocks.find((b) => b.sectionId === '시트-열기-2')!.text).toContain('팁 같은 제목은 번호가 붙는다.')
  })
  it('형식이 틀리면 파일 이름을 넣어 throw', () => {
    expect(() => parseChapter('weekly.md', RAW)).toThrow(/weekly\.md/)
    expect(() => parseChapter('06-weekly.md', RAW.replace('audience: member', 'audience: boss'))).toThrow(/audience/)
    expect(() => parseChapter('06-weekly.md', RAW.replace('part: daily', 'part: x'))).toThrow(/part/)
    expect(() => parseChapter('06-weekly.md', RAW.replace(/^---[\s\S]*?---\n/, ''))).toThrow(/머리말/)
    expect(() => parseChapter('06-weekly.md', RAW.replace('title: 주간보고\n', ''))).toThrow(/title/)
  })
})

describe('headingSlug·createSlugger', () => {
  it('한글 보존, 공백 → -, 문장부호 제거, 소문자', () => {
    expect(headingSlug('AI로 다시 작성')).toBe('ai로-다시-작성')
    expect(headingSlug('  복사·붙여넣기 (Ctrl+V)  ')).toBe('복사붙여넣기-ctrlv')
    expect(headingSlug('!!!')).toBe('section')
  })
  it('같은 slug 는 -2, -3', () => {
    const s = createSlugger()
    expect([s('가'), s('가'), s('가'), s('나')]).toEqual(['가', '가-2', '가-3', '나'])
  })
})

describe('audienceRank', () => {
  it('member < projectAdmin < workspaceAdmin < platformAdmin', () => {
    expect(['member', 'projectAdmin', 'workspaceAdmin', 'platformAdmin'].map((a) => audienceRank(a as never))).toEqual([0, 1, 2, 3])
  })
})
```

- [ ] **Step 2: `tests/manual/search.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseChapter } from '@/lib/manual/parse'
import { searchManual, normalizeQuery, MANUAL_QUERY_MAX } from '@/lib/manual/search'

const mk = (file: string, title: string, body: string) =>
  parseChapter(file, `---\ntitle: ${title}\npart: daily\naudience: member\nsummary: 요약\n---\n\n${body}\n`)
const CH = [
  mk('04-wbs.md', 'WBS', '## 진척 입력\n\n실적 칸에 숫자를 넣습니다.\n'),
  mk('06-weekly.md', '주간보고', '들어가는 말.\n\n## 붙여넣기\n\n여러 줄을 붙여넣으면 한 칸에 들어갑니다. (Ctrl+V)\n\n## AI로 다시 작성\n\n문장을 다듬습니다.\n'),
]

describe('normalizeQuery', () => {
  it('공백 정리·상한·배열은 첫 값·없으면 빈 문자열', () => {
    expect(normalizeQuery('  붙여넣기   한 칸 ')).toBe('붙여넣기 한 칸')
    expect(normalizeQuery(['a', 'b'])).toBe('a')
    expect(normalizeQuery(undefined)).toBe('')
    expect(normalizeQuery('   ')).toBe('')
    expect(normalizeQuery('가'.repeat(150))).toHaveLength(MANUAL_QUERY_MAX)
  })
})

describe('searchManual', () => {
  it('낱말이 모두 들어간 절을 찾고, 장·절·발췌를 준다', () => {
    const hits = searchManual(CH, '붙여넣기 한 칸')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ slug: 'weekly', chapterTitle: '주간보고', sectionId: '붙여넣기', sectionTitle: '붙여넣기' })
    expect(hits[0].excerpt).toContain('한 칸에 들어갑니다')
  })
  it('대소문자 무시, 정규식 특수문자도 글자로', () => {
    expect(searchManual(CH, 'ctrl+v')[0]?.sectionId).toBe('붙여넣기')
    expect(searchManual(CH, '(Ctrl')).toHaveLength(1)
  })
  it('장 제목·절 제목에 맞으면 앞에 둔다', () => {
    const hits = searchManual(CH, '다시 작성')
    expect(hits[0].sectionId).toBe('ai로-다시-작성')
  })
  it('빈 검색어·없는 낱말은 빈 배열, limit 를 지킨다', () => {
    expect(searchManual(CH, '')).toEqual([])
    expect(searchManual(CH, '없는낱말')).toEqual([])
    expect(searchManual(CH, '다', 1)).toHaveLength(1)
  })
})
```

- [ ] **Step 3: `tests/authz/manual-access.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import type { Actor } from '@/lib/domain/authz'
import { manualAudienceOf, manualViewer } from '@/lib/authz/manualAccess'

const actor = (p: Partial<Actor> = {}): Actor => ({
  userId: 'u1', isSuperuser: false, workspaceRoles: new Map(), projectWorkspace: new Map(),
  projectRoles: new Map(), memberIds: new Map(), rosterTeams: new Map(), ...p,
} as Actor)

describe('manualAudienceOf', () => {
  it.each([
    ['플랫폼 관리자', actor({ isSuperuser: true }), 'platformAdmin'],
    ['워크스페이스 관리자', actor({ workspaceRoles: new Map([['w1', 'member'], ['w2', 'admin']]) as Actor['workspaceRoles'] }), 'workspaceAdmin'],
    ['프로젝트 관리자', actor({ workspaceRoles: new Map([['w1', 'member']]) as Actor['workspaceRoles'], projectRoles: new Map([['p1', 'member'], ['p2', 'admin']]) as Actor['projectRoles'] }), 'projectAdmin'],
    ['멤버', actor({ workspaceRoles: new Map([['w1', 'member']]) as Actor['workspaceRoles'], projectRoles: new Map([['p1', 'member']]) as Actor['projectRoles'] }), 'member'],
    ['actor 없음', null, 'member'],
  ])('%s', (_n, a, want) => { expect(manualAudienceOf(a)).toBe(want) })
})

describe('manualViewer', () => {
  it('열화·actor 없음은 member + uncertain, 로그를 남긴다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(manualViewer({ actor: actor({ isSuperuser: true }), degraded: true })).toEqual({ audience: 'member', uncertain: true })
    expect(manualViewer({ actor: null, degraded: false })).toEqual({ audience: 'member', uncertain: true })
    expect(err).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
  it('정상이면 판정 그대로', () => {
    expect(manualViewer({ actor: actor({ isSuperuser: true }), degraded: false })).toEqual({ audience: 'platformAdmin', uncertain: false })
  })
})
```
(실제 `WorkspaceRole`·`ProjectRole` 값 이름은 `src/lib/domain/authz.ts` 에서 확인해 맞춘다 — 'admin'·'member' 가 아니면 그 값으로.)

- [ ] **Step 4: `tests/manual/content.test.ts`** — 실제 본문 전체 검사

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderGenerated } from '../../scripts/manual-build.mjs'
import { manualChapters } from '@/lib/manual/chapters'

const ROOT = process.cwd()
const chapters = manualChapters()

/** 사용자에게 보이면 안 되는 개발 용어(본문 검사) */
const BANNED = [/\bRPC\b/, /\bRLS\b/, /service_role/, /\bSupabase\b/i, /\bsupabase\b/, /\bAPI\b/, /\btoken\b/i, /\bJSON\b/, /\bmigration\b/i, /마이그레이션/, /\bDB\b/, /모듈/]

describe('사용자 매뉴얼 본문', () => {
  it('생성 파일이 원본과 같다(다르면 npm run manual:build)', () => {
    expect(readFileSync(join(ROOT, 'src/content/manual/chapters.generated.ts'), 'utf8')).toBe(renderGenerated(ROOT))
  })
  it('장이 있고 slug·순서가 유일하다', () => {
    expect(chapters.length).toBeGreaterThan(0)
    expect(new Set(chapters.map((c) => c.slug)).size).toBe(chapters.length)
    expect(new Set(chapters.map((c) => c.order)).size).toBe(chapters.length)
  })
  it.each(chapters.map((c) => [c.file, c] as const))('%s — 본문·절이 비지 않았고 제목에 표기 기호가 없다', (_f, c) => {
    expect(c.body.trim().length).toBeGreaterThan(200)
    expect(c.sections.length).toBeGreaterThan(0)
    for (const s of c.sections) expect(s.title).not.toMatch(/[`*_[\]]/)
  })
  it.each(chapters.map((c) => [c.file, c] as const))('%s — /help 링크와 앵커가 실제로 있다', (_f, c) => {
    const bySlug = new Map(chapters.map((x) => [x.slug, x]))
    const links = [...c.body.matchAll(/\]\((\/help[^)\s]*|#[^)\s]+)\)/g)].map((m) => m[1])
    for (const href of links) {
      const [path, hash] = href.split('#')
      const target = path === '' ? c : path === '/help' ? null : bySlug.get(path.replace(/^\/help\//, ''))
      if (path !== '' && path !== '/help') expect(target, `${c.file}: ${href}`).toBeDefined()
      if (hash) expect(target?.sections.some((s) => s.id === decodeURIComponent(hash)), `${c.file}: ${href}`).toBe(true)
    }
  })
  it.each(chapters.map((c) => [c.file, c] as const))('%s — 개발 용어를 쓰지 않는다', (_f, c) => {
    for (const re of BANNED) expect(c.body, `${c.file}: ${re}`).not.toMatch(re)
  })
})
```

- [ ] **Step 5: 테스트가 실패하는지 확인** — `npx vitest run tests/manual tests/authz/manual-access.test.ts` → 모듈 없음으로 FAIL.

- [ ] **Step 6: `src/lib/manual/parse.ts`**

```ts
/* ── 사용자 매뉴얼 장 해석(순수) — 머리말·절·검색 평문. I/O 없음. 원본은 src/content/manual/NN-slug.md(스펙 2026-10-16 §4.1). ── */

export const MANUAL_AUDIENCES = ['member', 'projectAdmin', 'workspaceAdmin', 'platformAdmin'] as const
export type ManualAudience = (typeof MANUAL_AUDIENCES)[number]
export const MANUAL_PARTS = ['start', 'daily', 'projectAdmin', 'workspaceAdmin', 'platformAdmin', 'help'] as const
export type ManualPart = (typeof MANUAL_PARTS)[number]

export interface ManualSection { id: string; title: string; depth: 2 | 3 }
/** 검색 단위 — 절 하나의 평문(첫 절 앞의 들어가는 말은 sectionId null) */
export interface ManualBlock { sectionId: string | null; sectionTitle: string | null; text: string }
export interface ManualChapter {
  file: string; slug: string; order: number
  title: string; part: ManualPart; audience: ManualAudience; summary: string
  /** 머리말을 뺀 마크다운 */
  body: string
  sections: ManualSection[]
  blocks: ManualBlock[]
}

export function audienceRank(a: ManualAudience): number {
  return MANUAL_AUDIENCES.indexOf(a)
}

/** 제목 → 앵커. 한글·영숫자만 남기고 공백은 -. 화면(ManualArticle)과 같은 함수를 써야 목차 링크가 맞는다 */
export function headingSlug(text: string): string {
  const s = text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return s || 'section'
}

/** 한 장 안에서 유일한 앵커 — 같은 제목 두 번째부터 -2, -3 */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const base = headingSlug(text)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}-${n}`
  }
}

const FILE_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
const HEADING_RE = /^(#{2,3})\s+(.+?)\s*#*\s*$/

function fail(file: string, msg: string): never {
  throw new Error(`[manual] ${file}: ${msg}`)
}

/** 마크다운 한 줄 → 검색용 평문(표기 기호 제거) */
function plainLine(line: string): string {
  return line
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\|/g, ' ')
    .replace(/^\s*:?-{3,}:?\s*$/, '')
    .trim()
}

export function parseChapter(file: string, raw: string): ManualChapter {
  const m = FILE_RE.exec(file)
  if (!m) fail(file, '파일 이름은 NN-slug.md 꼴이어야 한다')
  const text = raw.replace(/\r\n?/g, '\n')
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!fm) fail(file, '머리말(--- … ---)이 없다')
  const meta: Record<string, string> = {}
  for (const line of fm[1].split('\n')) {
    const kv = /^([a-z]+):\s*(.*?)\s*$/.exec(line)
    if (kv) meta[kv[1]] = kv[2]
  }
  for (const key of ['title', 'part', 'audience', 'summary']) if (!meta[key]) fail(file, `머리말에 ${key} 가 없다`)
  if (!(MANUAL_PARTS as readonly string[]).includes(meta.part)) fail(file, `part 값이 틀렸다: ${meta.part}`)
  if (!(MANUAL_AUDIENCES as readonly string[]).includes(meta.audience)) fail(file, `audience 값이 틀렸다: ${meta.audience}`)

  const body = text.slice(fm[0].length).replace(/^\n+/, '')
  const slugger = createSlugger()
  const sections: ManualSection[] = []
  const blocks: ManualBlock[] = []
  let cur: ManualBlock = { sectionId: null, sectionTitle: null, text: '' }
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue }
    const h = inFence ? null : HEADING_RE.exec(line)
    if (h) {
      const title = h[2]
      const id = slugger(title)
      sections.push({ id, title, depth: h[1].length as 2 | 3 })
      if (cur.text.trim() || cur.sectionId === null) blocks.push({ ...cur, text: cur.text.trim() })
      cur = { sectionId: id, sectionTitle: title, text: '' }
      continue
    }
    if (/^#\s/.test(line) && !inFence) continue          // 장 제목(#)은 머리말 title 이 대신한다
    const p = plainLine(line)
    if (p) cur.text += (cur.text ? ' ' : '') + p
  }
  blocks.push({ ...cur, text: cur.text.trim() })

  return {
    file, slug: m[2], order: Number(m[1]),
    title: meta.title, part: meta.part as ManualPart, audience: meta.audience as ManualAudience, summary: meta.summary,
    body, sections, blocks: blocks.filter((b) => b.text || b.sectionId !== null),
  }
}
```

(테스트의 `blocks[0]` 이 들어가는 말 블록이어야 하므로 첫 블록이 비어도 섹션 null 블록은 남는다 — 위 필터는 텍스트가 비고 sectionId 도 null 인 블록만 버린다. 테스트 RAW 는 들어가는 말이 있다.)

- [ ] **Step 7: `scripts/manual-build.mjs`**

```js
// 사용자 매뉴얼 원본(src/content/manual/NN-slug.md)을 문자열 배열 모듈로 묶는다 — 배포 번들이 런타임 파일 읽기·파일 추적에 기대지 않게(스펙 2026-10-16 §4.1).
// 생성물은 커밋한다. tests/manual/content.test.ts 가 원본과 어긋나면 실패한다 → `npm run manual:build`.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MANUAL_DIR = 'src/content/manual'
export const GENERATED_FILE = 'src/content/manual/chapters.generated.ts'

/** @param {string} [root] */
export function renderGenerated(root = process.cwd()) {
  const dir = join(root, MANUAL_DIR)
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
  const items = files.map((f) => `  { file: ${JSON.stringify(f)}, raw: ${JSON.stringify(readFileSync(join(dir, f), 'utf8'))} },`)
  return [
    '// 자동 생성 — 직접 고치지 말 것. src/content/manual/*.md 를 고친 뒤 `npm run manual:build`(tests/manual/content.test.ts 가 어긋남을 잡는다).',
    'export const MANUAL_SOURCES: readonly { file: string; raw: string }[] = [',
    ...items,
    ']',
    '',
  ].join('\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(process.cwd(), GENERATED_FILE), renderGenerated())
  console.log(`[manual:build] ${GENERATED_FILE} 를 다시 만들었습니다.`)
}
```
`package.json` scripts 에 `"manual:build": "node scripts/manual-build.mjs"` 를 더한다(알파벳·묶음 위치는 주변 관례대로).

- [ ] **Step 8: `src/lib/manual/chapters.ts`**

```ts
/* ── 사용자 매뉴얼 장 목록 — 생성 모듈을 한 번 해석해 순서대로 둔다. 해석 오류는 throw(빈 매뉴얼로 위장하지 않는다 — 테스트가 먼저 잡는다). ── */
import { MANUAL_SOURCES } from '@/content/manual/chapters.generated'
import { audienceRank, parseChapter, type ManualAudience, type ManualChapter } from './parse'

let cache: readonly ManualChapter[] | null = null

export function manualChapters(): readonly ManualChapter[] {
  if (!cache) cache = MANUAL_SOURCES.map((s) => parseChapter(s.file, s.raw)).sort((a, b) => a.order - b.order)
  return cache
}

export function manualChapter(slug: string): ManualChapter | undefined {
  return manualChapters().find((c) => c.slug === slug)
}

export function canSee(viewer: ManualAudience, chapter: ManualAudience): boolean {
  return audienceRank(chapter) <= audienceRank(viewer)
}

export function visibleChapters(viewer: ManualAudience): ManualChapter[] {
  return manualChapters().filter((c) => canSee(viewer, c.audience))
}
```

- [ ] **Step 9: `src/lib/manual/search.ts`**

```ts
/* ── 사용자 매뉴얼 낱말 찾기(순수) — 서버에서 보이는 장만 뒤진다. 공백으로 나눈 낱말이 모두 들어간 절을 찾는다. ── */
import type { ManualChapter } from './parse'

export const MANUAL_QUERY_MAX = 100
const EXCERPT_RADIUS = 50

export interface ManualHit { slug: string; chapterTitle: string; sectionId: string | null; sectionTitle: string | null; excerpt: string }

export function normalizeQuery(q: string | string[] | undefined): string {
  const v = Array.isArray(q) ? q[0] : q
  return (v ?? '').replace(/\s+/g, ' ').trim().slice(0, MANUAL_QUERY_MAX)
}

function excerptOf(text: string, term: string): string {
  const i = text.toLowerCase().indexOf(term)
  if (i < 0) return text.slice(0, EXCERPT_RADIUS * 2) + (text.length > EXCERPT_RADIUS * 2 ? '…' : '')
  const start = Math.max(0, i - EXCERPT_RADIUS)
  const end = Math.min(text.length, i + term.length + EXCERPT_RADIUS)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

export function searchManual(chapters: readonly ManualChapter[], query: string, limit = 30): ManualHit[] {
  const terms = query.toLowerCase().split(' ').filter(Boolean)
  if (terms.length === 0) return []
  const scored: { hit: ManualHit; score: number; rank: number }[] = []
  let rank = 0
  for (const c of chapters) {
    for (const b of c.blocks) {
      rank++
      const title = `${c.title} ${b.sectionTitle ?? ''}`.toLowerCase()
      const hay = `${title} ${b.text.toLowerCase()}`
      if (!terms.every((t) => hay.includes(t))) continue
      const score = terms.filter((t) => title.includes(t)).length
      const firstInText = terms.find((t) => b.text.toLowerCase().includes(t)) ?? terms[0]
      scored.push({ hit: { slug: c.slug, chapterTitle: c.title, sectionId: b.sectionId, sectionTitle: b.sectionTitle, excerpt: excerptOf(b.text, firstInText) }, score, rank })
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.rank - b.rank).slice(0, limit).map((s) => s.hit)
}
```

- [ ] **Step 10: `src/lib/authz/manualAccess.ts`**

```ts
/**
 * 사용자 매뉴얼의 보는 사람 등급(스펙 2026-10-16 §2.4) — 가드가 아니라 목차 거르기의 판정이다(매뉴얼은 로그인만 요구한다).
 * 가진 것 중 가장 높은 등급: 플랫폼 관리자 > 어느 워크스페이스든 관리자 > 어느 프로젝트든 명단 관리자 > 멤버.
 */
import type { Actor } from '@/lib/domain/authz'
import type { ManualAudience } from '@/lib/manual/parse'

export function manualAudienceOf(actor: Actor | null): ManualAudience {
  if (!actor) return 'member'
  if (actor.isSuperuser) return 'platformAdmin'
  for (const role of actor.workspaceRoles.values()) if (role === 'admin') return 'workspaceAdmin'
  for (const role of actor.projectRoles.values()) if (role === 'admin') return 'projectAdmin'
  return 'member'
}

/** 화면용 — 판독이 열화됐거나 actor 가 없으면 멤버로 좁히고 그 사실을 알린다(조회 실패를 숨기지 않는다: 화면 안내 + 로그) */
export function manualViewer(state: { actor: Actor | null; degraded: boolean }): { audience: ManualAudience; uncertain: boolean } {
  if (state.degraded || !state.actor) {
    console.error('[manual] 권한 정보를 읽지 못해 일반 사용자용 장만 보입니다', { degraded: state.degraded, actor: state.actor ? 'present' : 'none' })
    return { audience: 'member', uncertain: true }
  }
  return { audience: manualAudienceOf(state.actor), uncertain: false }
}
```
(역할 값 이름은 `WorkspaceRole`·`ProjectRole` 정의를 따른다. 판정 위치 규칙상 `src/lib/authz/**` 는 허용 위치다. `role === 'admin'` 비교가 다른 불변식(액션에 역할 비교 금지)에 걸리면 `src/lib/domain/authz.ts` 의 기존 판정 함수(예: `isWorkspaceAdminRole`)가 있으면 그것을 쓴다.)

- [ ] **Step 11: 맛보기 원본 2개** — 생성기·검사가 돌 수 있게. 실제 본문은 Task 4 이후가 덮어쓴다.

`src/content/manual/01-getting-started.md`:
```md
---
title: 시작하기
part: start
audience: member
summary: 로그인부터 화면 구성까지, D-Flow 를 처음 쓸 때 알아야 할 것을 설명합니다.
---

이 장은 D-Flow 를 처음 쓰는 분을 위한 안내입니다. 자세한 내용은 곧 채워집니다. 궁금한 점이 있으면 [자주 묻는 질문](/help/faq)을 먼저 보세요.

## 로그인하기

1. 받은 초대 메일의 링크를 누르거나, 관리자에게 받은 주소로 들어갑니다.
2. 이메일과 비밀번호를 넣고 로그인합니다.
```

`src/content/manual/90-faq.md`:
```md
---
title: 자주 묻는 질문
part: help
audience: member
summary: 자주 겪는 문제와 해결 방법을 모았습니다.
---

쓰다가 막히면 이 장을 먼저 보세요. 처음이라면 [시작하기](/help/getting-started#로그인하기)부터 읽어도 좋습니다.

## 화면이 이상하게 보여요

브라우저를 새로 고쳐 보세요. 그래도 같으면 관리자에게 알려 주세요. 어떤 화면에서 무엇을 눌렀는지 함께 알려 주면 빨리 해결할 수 있습니다.
```
(본문 200자 하한을 넘기도록 실제로는 한두 문단 더 쓴다.)

- [ ] **Step 12: 생성하고 테스트 통과 확인** — `npm run manual:build` → `npx vitest run tests/manual tests/authz/manual-access.test.ts` PASS. `npx eslint src/lib/manual src/lib/authz/manualAccess.ts scripts/manual-build.mjs tests/manual tests/authz/manual-access.test.ts`.

- [ ] **Step 13: 커밋**

```bash
git add src/lib/manual/parse.ts src/lib/manual/chapters.ts src/lib/manual/search.ts src/lib/authz/manualAccess.ts scripts/manual-build.mjs package.json src/content/manual/01-getting-started.md src/content/manual/90-faq.md src/content/manual/chapters.generated.ts tests/manual/parse.test.ts tests/manual/search.test.ts tests/manual/content.test.ts tests/authz/manual-access.test.ts
git commit -m "사용자 매뉴얼의 본문 형식·해석·검색·등급 판정을 더한다 …"
```

---

### Task 2: 매뉴얼 화면·메뉴 항목·사전

**Files:**
- Create: `src/app/(app)/(global)/help/page.tsx`, `src/app/(app)/(global)/help/[chapter]/page.tsx`, `src/components/manual/ManualArticle.tsx`, `src/components/manual/ManualChapterNav.tsx`, `src/components/manual/ManualSearch.tsx`, `src/lib/i18n/dict/manual.ts`
- Modify: `src/lib/i18n/dict/ko.ts`(manualKo 등록), `src/lib/nav/ids.ts`, `src/lib/nav/registry.ts`, `src/lib/domain/usageMenu.ts`, `scripts/ui-capture.routes.json`, `tests/invariants/module-page-gates.test.ts`, `tests/nav/active.test.ts`, `tests/nav/nav-for.test.ts`, `tests/nav/nav-ids.test.ts`(그 밖에 개수 26 을 고정한 테스트가 있으면 함께)
- Test: `tests/ui/manual-pages.test.tsx`

**Interfaces:**
- Consumes: Task 1 의 `manualChapters`·`manualChapter`·`visibleChapters`·`canSee`·`searchManual`·`normalizeQuery`·`manualViewer`·`createSlugger`·`MANUAL_PARTS`·`ManualAudience`.
- Produces: 내비 id `ws.help`, 사전 키 `nav.help`·`manual.*`.

- [ ] **Step 1: 사전 `src/lib/i18n/dict/manual.ts`** — 다른 사전 파일과 같은 꼴(`export const manualKo = { … }`)로 만들고 `ko.ts` 의 KO 에 펼친다.

```ts
// 사용자 매뉴얼 화면(/help) 사전 — 본문은 src/content/manual/*.md 다(사전이 아니다).
export const manualKo = {
  'nav.help': '사용자 매뉴얼',
  'manual.title': '사용자 매뉴얼',
  'manual.desc': 'D-Flow 의 화면과 기능을 처음부터 차근차근 설명합니다. 목차에서 장을 고르거나 낱말로 찾아보세요.',
  'manual.viewer': '{audience} 기준으로 볼 수 있는 장을 보여 줍니다.',
  'manual.viewerUncertain': '권한 정보를 불러오지 못해 일반 사용자용 장만 보여 줍니다. 잠시 뒤 새로 고쳐 보세요.',
  'manual.audience.member': '일반 사용자',
  'manual.audience.projectAdmin': '프로젝트 관리자',
  'manual.audience.workspaceAdmin': '워크스페이스 관리자',
  'manual.audience.platformAdmin': '플랫폼 관리자',
  'manual.badge': '{audience}용',
  'manual.part.start': '시작하기',
  'manual.part.daily': '매일 쓰는 기능',
  'manual.part.projectAdmin': '프로젝트 관리자',
  'manual.part.workspaceAdmin': '워크스페이스 관리자',
  'manual.part.platformAdmin': '플랫폼 관리자',
  'manual.part.help': '도움말',
  'manual.chapters': '매뉴얼 목차',
  'manual.toc': '이 장의 내용',
  'manual.prev': '이전 장',
  'manual.next': '다음 장',
  'manual.home': '매뉴얼 처음으로',
  'manual.aboveAudience': '이 장은 {audience}용입니다. 지금 등급에서는 여기 나오는 화면이나 버튼이 보이지 않을 수 있습니다.',
  'manual.search.label': '매뉴얼에서 찾기',
  'manual.search.placeholder': '예: 주간보고 붙여넣기',
  'manual.search.submit': '찾기',
  'manual.search.results': "'{q}' 검색 결과 {n}건",
  'manual.search.empty': "'{q}'에 맞는 내용을 찾지 못했습니다.",
  'manual.search.tip': '낱말을 줄이거나 다른 말로 찾아보세요. 예: 비밀번호, 초대, AI',
  'manual.search.clear': '검색 지우기',
} as const
```

- [ ] **Step 2: 실패하는 화면 테스트 `tests/ui/manual-pages.test.tsx`** — 서버 컴포넌트를 함수로 불러 결과 요소를 jsdom 에 그린다(`await Page({ … })` → `createRoot().render`). 모킹: `@/lib/authz` 의 `getActorViewState`, `next/navigation` 의 `notFound`(throw 하는 vi.fn), `next/link`(a 로), `@/content/manual/chapters.generated`(합성 장 4개: start/member, daily/member, projectAdmin/projectAdmin, platformAdmin/platformAdmin — 서로 링크·같은 제목 두 번 포함).

  단언:
  1. member → 목차에 member 장 두 개만, 관리자 장 제목 없음. 등급 안내 "일반 사용자 기준…".
  2. platformAdmin → 네 장 모두, 관리자 장에 "플랫폼 관리자용" 표지.
  3. `degraded: true` → member 장만 + "권한 정보를 불러오지 못해…" 문구.
  4. `searchParams: { q: '붙여넣기' }` → 결과 목록, 링크 `href="/help/<slug>#<앵커>"`; 없는 낱말 → "찾지 못했습니다" + 팁. member 가 관리자 장에만 있는 낱말로 찾으면 0건.
  5. 장 화면 `params: { chapter: 'weekly' }` → 본문 h2 의 `id` 들이 "이 장의 내용" 링크의 `#…` 와 같다(같은 제목 두 번이면 `-2`). 이전/다음 장 링크가 보이는 장 기준.
  6. member 가 `params: { chapter: 'platform-admin' }` → 본문이 그려지고 "이 장은 플랫폼 관리자용입니다…" 안내.
  7. 없는 장 → `notFound` 호출.
  8. 본문의 `/help/…` 링크는 next/link(모킹한 a)로, 외부 링크는 `target="_blank" rel="noreferrer"`.

- [ ] **Step 3: 테스트 FAIL 확인.**

- [ ] **Step 4: `src/components/manual/ManualArticle.tsx`** — 서버 컴포넌트(‘use client’ 없음).

```tsx
import Link from 'next/link'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Children, isValidElement, type CSSProperties, type ReactNode } from 'react'
import { createSlugger } from '@/lib/manual/parse'

/** 자식 → 평문(제목 앵커용). 본문 검사가 제목에 표기 기호를 막으므로 글자만 모으면 parse.ts 의 절 id 와 같아진다 */
function textOf(node: ReactNode): string {
  return Children.toArray(node).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : '')).join('')
}

export function ManualArticle({ body }: { body: string }) {
  const slug = createSlugger()                 // 렌더마다 새로 — parse.ts 와 같은 순서·같은 규칙
  const components: Components = {
    h1: () => null,                            // 장 제목은 머리말 title 로 화면이 그린다
    h2: ({ children }) => <h2 id={slug(textOf(children))} className="scroll-mt-20">{children}</h2>,
    h3: ({ children }) => <h3 id={slug(textOf(children))} className="scroll-mt-20">{children}</h3>,
    a: ({ href, children }) => {
      if (href?.startsWith('/')) return <Link href={href}>{children}</Link>
      if (href?.startsWith('#')) return <a href={href}>{children}</a>
      return <a href={href} target="_blank" rel="noreferrer">{children}</a>
    },
  }
  return (
    <div className="minutes-md" style={{ '--minutes-fs': '15px' } as CSSProperties}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{body}</ReactMarkdown>
    </div>
  )
}
```
(react-markdown 이 h1 을 무시해도 parse.ts 는 `#` 줄을 절로 세지 않으므로 순서가 어긋나지 않는다.)

- [ ] **Step 5: `src/components/manual/ManualChapterNav.tsx`** — 서버 컴포넌트. props `{ chapters: ManualChapter[]; current?: string }`. `MANUAL_PARTS` 순서로 묶고 부 제목 `t('manual.part.<part>')`, 항목은 `Link href={`/help/${slug}`}`, 현재 장은 `aria-current="page"` 와 강조 클래스. 넓은 화면용 목록과 좁은 화면용 `<details><summary>{t('manual.chapters')}</summary>…</details>` 를 같은 컴포넌트가 낸다(`lg:hidden`·`hidden lg:block` — 상태 변형 display 유틸 금지 규칙에 걸리지 않는 단순 반응형 display 만 쓴다).

- [ ] **Step 6: `src/components/manual/ManualSearch.tsx`** — 서버 컴포넌트. `<form action="/help" method="get" role="search">` + `<label>`(sr-only 아님 — 보이는 라벨) + `<input name="q" defaultValue={q} maxLength={100}>` + 제출 버튼(`btn btn-primary` 등 기존 버튼 클래스). 결과 props `{ q: string; hits: ManualHit[] | null }`: `hits === null` 이면 결과 없음 영역을 그리지 않는다. 결과는 `<ol>` — 항목마다 `Link href={`/help/${slug}${sectionId ? `#${encodeURIComponent(sectionId)}` : ''}`}` 에 "장 제목 › 절 제목", 아래에 발췌. 0건이면 `manual.search.empty`+`manual.search.tip`. 검색 지우기 링크 `/help`.

- [ ] **Step 7: `src/app/(app)/(global)/help/page.tsx`**

```tsx
import { getActorViewState } from '@/lib/authz'
import { manualViewer } from '@/lib/authz/manualAccess'
import { visibleChapters } from '@/lib/manual/chapters'
import { MANUAL_PARTS } from '@/lib/manual/parse'
import { normalizeQuery, searchManual } from '@/lib/manual/search'
import { t } from '@/lib/i18n/dict'
import { PageHeader } from '@/components/app/PageHeader'
import { ManualSearch } from '@/components/manual/ManualSearch'
// …카드 목록은 이 파일에서 그린다(부별 묶음, 장 제목·요약, 관리자 장이면 표지)

export const dynamic = 'force-dynamic'
export async function generateMetadata() { return { title: t('manual.title') } }

/** 사용자 매뉴얼 첫 화면·검색(스펙 2026-10-16 §2.2). 로그인만 요구한다 — 모듈 관문 밖(페이지 관문 불변식 제외 목록). */
export default async function ManualHomePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const [state, sp] = await Promise.all([getActorViewState(), searchParams])
  const viewer = manualViewer(state)
  const chapters = visibleChapters(viewer.audience)
  const q = normalizeQuery(sp.q)
  const hits = q ? searchManual(chapters, q) : null
  // …PageHeader(title·desc) → 등급 안내(uncertain 이면 StatusMessage 경고 꼴, 아니면 한 줄) → ManualSearch → (검색 중이 아니면) 부별 장 카드
}
```
등급 안내 문구는 `t('manual.viewer').replace('{audience}', () => t(`manual.audience.${viewer.audience}`))`. 사전 키를 템플릿으로 만들 때는 `DictKey` 타입을 지키도록 표(`AUDIENCE_KEY: Record<ManualAudience, DictKey>`)를 둔다.

- [ ] **Step 8: `src/app/(app)/(global)/help/[chapter]/page.tsx`**

```tsx
export const dynamic = 'force-dynamic'
export async function generateMetadata({ params }: { params: Promise<{ chapter: string }> }) {
  const c = manualChapter((await params).chapter)
  return { title: c ? c.title : t('manual.title') }
}

/** 사용자 매뉴얼 장(스펙 §2.3). 상위 등급 장도 숨기지 않고 안내를 붙인다(매뉴얼은 비밀이 아니다 — 목차 숨김은 편의). 없는 장은 404. */
export default async function ManualChapterPage({ params }: { params: Promise<{ chapter: string }> }) {
  const [state, { chapter: slug }] = await Promise.all([getActorViewState(), params])
  const chapter = manualChapter(slug)
  if (!chapter) notFound()
  const viewer = manualViewer(state)
  const visible = visibleChapters(viewer.audience)
  const i = visible.findIndex((c) => c.slug === chapter.slug)
  const prev = i > 0 ? visible[i - 1] : null
  const next = i >= 0 && i < visible.length - 1 ? visible[i + 1] : null
  // 레이아웃: lg 이상 2열(왼쪽 ManualChapterNav sticky, 오른쪽 본문). 본문 머리: 제목(h1)·관리자 장 표지·요약,
  // canSee 가 아니면 안내 상자(manual.aboveAudience), uncertain 이면 등급 안내, '이 장의 내용' 목록(sections — depth 3 은 들여쓰기),
  // <ManualArticle body={chapter.body} />, 아래 이전/다음/처음으로.
}
```

- [ ] **Step 9: 내비 항목** — `ids.ts`: `NAV_ITEM_IDS` 의 `'ws.projects'` 뒤에 `'ws.help'`, `NAV_GROUP_OF` 에 `'ws.help': 'ws.main'`, 머리 주석의 개수 26 → 27(… + 사용자 매뉴얼 ws.help). `registry.ts` SHELL_NAV 의 `ws.projects` 뒤:
```ts
  // 사용자 매뉴얼(2026-10-16) — 모든 등급, 끌 수 없다. 전역 화면(/help)이라 절대 경로. 아이콘은 표(navIcons)에 있는 이름(UI 위험 파일을 고치지 않는다)
  { id: 'ws.help', labelKey: 'nav.help', icon: 'BookOpenText', segment: '/help', group: 'ws.main', order: 90, scope: 'workspace', needs: null },
```
`NAV_DEFAULT_LABEL_KEY` 주석 개수 26 → 27. `usageMenu.ts` 의 `USAGE_KEY_OF` 에 `'ws.help': 'unknown'`(집계 키를 늘리지 않는다 — 기존 주석 관례). `ui-capture.routes.json` 에 두 줄:
```json
    { "key": "help", "path": "/help", "file": "(app)/(global)/help/page.tsx", "grade": "member", "tags": [], "since": "C" },
    { "key": "help-chapter", "path": "/help/getting-started", "file": "(app)/(global)/help/[chapter]/page.tsx", "grade": "member", "tags": [], "since": "C" },
```
`module-page-gates.test.ts` EXCLUDED 에 두 페이지(사유 "사용자 매뉴얼 — 모듈 밖, 로그인만"). 내비 테스트들의 개수·목록(`ws.main` 에 `ws.help`, 셸 11 ∪ 모듈 16 = 27, 모든 caps 에서 `ws.help` 가 보인다), `active.test.ts` 에 `activeNavItem('/help', ws)`·`('/help/weekly', ws)` → `'ws.help'`.

- [ ] **Step 10: 테스트 통과** — `npx vitest run tests/ui/manual-pages.test.tsx tests/nav tests/invariants tests/scripts/ui-capture.test.ts tests/manual` PASS. 그 다음 `npm run test` 전체(내비 개수를 고정한 다른 테스트가 있으면 같이 고친다).

- [ ] **Step 11: 커밋**
```bash
git add <위 파일들을 이름으로>
git commit -m "사용자 매뉴얼 화면(/help)과 사이드바 메뉴를 더한다 …"
```

---

### Task 3: 계정 메뉴의 매뉴얼 링크(UI 위험 파일)

**Files:**
- Modify: `src/components/app/AccountMenu.tsx`, `src/lib/i18n/dict/shellUi.ts`(`'shell.account.manual': '사용자 매뉴얼'`)
- Test: 계정 메뉴를 그리는 기존 테스트가 있으면 거기에, 없으면 `tests/ui/account-menu-manual.test.tsx`

- [ ] **Step 1: 실패 테스트** — 계정 메뉴를 열면 `href="/help"` 링크가 "내 계정" 링크 다음에 있고, 누르면 메뉴가 닫힌다.
- [ ] **Step 2: 구현** — `/account` 링크 바로 아래에 같은 꼴로:
```tsx
          <Link href="/help" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-3 text-control text-fg-secondary hover:bg-surface-hover hover:text-fg">
            <BookOpenText size={16} aria-hidden />{t('shell.account.manual')}
          </Link>
```
(`BookOpenText` 를 lucide-react import 에 더한다.)
- [ ] **Step 3: 테스트 통과, 커밋** — 메시지에 아직 트레일러를 넣지 않는다(컨트롤러가 로컬 눈확인 뒤 빈 커밋 또는 머지 커밋에 `Preview-checked: local …` 를 단다).

---

### Task 4~9: 본문 작성(장별 — 서로 다른 파일이라 나눠 쓴다)

각 작성자에게 같은 규칙(스펙 §3.2)을 준다. 공통 절차:
1. 맡은 장이 다루는 화면의 페이지(`src/app/**/page.tsx`)·컴포넌트(`src/components/<영역>/**`)·사전(`src/lib/i18n/dict/*`)·서버 액션의 가드(누가 할 수 있는지)를 읽는다.
2. 화면에 실제로 있는 버튼·메뉴·탭·칸 이름을 사전 값 그대로 **굵게** 쓴다. 등급·설정에 따라 보이는 조건을 적는다.
3. 장 머리: 머리말(title·part·audience·summary) → 들어가는 말(이 장에서 할 수 있는 일 목록, 누가 쓸 수 있는지, 기능이 꺼져 있으면 안 보인다는 안내) → `##` 절(작업 단위) → `###` 소절.
4. 절차는 번호 목록, 결과까지. 팁·주의는 `> **팁**`·`> **주의**`. 표는 비교·키보드 단축키 등에만.
5. 다른 장은 `/help/<slug>` 또는 `/help/<slug>#<앵커>` 로 링크(앵커 = 제목을 소문자·문장부호 제거·공백→- 한 것).
6. 개발 용어·고객명·실명 금지. 확인하지 못한 것은 쓰지 않는다 — 대신 보고서에 "확인 못함" 으로 남긴다.
7. 파일만 쓴다. 생성(`manual:build`)·커밋은 컨트롤러가 한다.

| Task | 파일(slug) | 범위 |
|---|---|---|
| 4 | `01-getting-started`, `02-home-my-work`, `03-projects-dashboard` | 로그인·비밀번호 찾기·초대 수락, 화면 구성(사이드바·상단 바·워크스페이스/프로젝트 전환·알림·계정 메뉴·사용자 매뉴얼 여는 곳), 내 계정; 홈·내 작업; 전체 프로젝트·즐겨찾기·대시보드 |
| 5 | `04-wbs`, `05-issues` | WBS·간트·칸반·진척·단계/검토 흐름·내려받기; 이슈·이슈 분석서 |
| 6 | `06-weekly`, `07-meetings-minutes` | 주간보고 시트 전부(입력·키보드·복사/붙여넣기·함께 편집·충돌 비교·점검·AI로 다시 작성·보고서 내려받기); 회의·회의록(폴더·공유 링크) |
| 7 | `08-wiki`, `09-announcements`, `10-members-attendance`, `11-agents`, `12-ai-assistant` | 위키, 공지, 멤버 명단 보기·근태, 에이전트, AI 도우미 |
| 8 | `20-project-admin` | 프로젝트 관리자 전용: 프로젝트 설정 전 항목, 멤버 권한(관리자/멤버/조회 전용), WBS 가져오기, 주간 문서·업무영역 관리, 승인 |
| 9 | `30-workspace-admin`, `40-platform-admin` | 워크스페이스 관리자: 멤버·초대·일괄 추가·비밀번호 재설정, 팀, 워크스페이스 설정(브랜딩·기능 켜고 끄기·메뉴·메일 발송·연동), 프로젝트 만들기·지우기, 포트폴리오, 사용 현황 / 플랫폼 관리자: 워크스페이스 관리, 플랫폼 관리자 지정, LLM 설정, UI 상태 |
| 10 | `90-faq`, `91-glossary` | Task 4~9 가 끝난 뒤. 자주 묻는 질문(각 장으로 링크) — "AI 를 사용할 수 없습니다", 저장 충돌, 메일이 안 옴, 권한이 없다는 화면, 연결이 끊김 등 실제 오류 문구 기준; 용어집 |

각 작성 Task 의 끝: 컨트롤러가 `npm run manual:build` → `npx vitest run tests/manual` → 고친 뒤 장 파일과 생성물을 커밋.

### Task 11: 정확성 검토

- 장마다(또는 묶음마다) 다른 검토자가 본문의 버튼 이름·절차·등급 조건·결과 문구를 코드·사전과 대조한다. 출력: 틀린 곳(인용·실제 값·근거 파일:줄), 빠진 중요한 기능, 너무 어려운 문장. 
- 컨트롤러가 고치거나(작은 것) 작성자에게 되돌린다. 다시 생성·테스트·커밋.

### Task 12: 마무리

- [ ] `npm run manual:build` 결과가 깨끗한지, `npm run test`·`npm run lint`·`npm run build`.
- [ ] 로컬 눈확인(사람): `/help`·장 화면·사이드바 항목·계정 메뉴 링크 — 결과를 `Preview-checked: local <YYYY-MM-DD HH:MM> — /help·계정 메뉴` 트레일러로 남긴다.
- [ ] 브랜치를 main 에 머지(사람 확인 뒤 push = 운영 배포).
