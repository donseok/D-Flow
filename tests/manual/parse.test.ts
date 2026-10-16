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
