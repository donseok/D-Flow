import { describe, it, expect } from 'vitest'
import { parseChapter, headingSlug, createSlugger, audienceRank, findIgnoredHeadings } from '@/lib/manual/parse'

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
  it('제목이 -2 로 끝나도 id 가 겹치지 않는다(이미 쓴 id 는 건너뛴다)', () => {
    const a = createSlugger()
    expect([a('가'), a('가'), a('가-2')]).toEqual(['가', '가-2', '가-2-2'])
    const b = createSlugger()
    expect([b('가'), b('가-2'), b('가'), b('가')]).toEqual(['가', '가-2', '가-3', '가-4'])
    const c = createSlugger()
    const ids = [c('가'), c('가-2'), c('가'), c('가-2'), c('가'), c('가-3')]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('audienceRank', () => {
  it('member < projectAdmin < workspaceAdmin < platformAdmin', () => {
    expect(['member', 'projectAdmin', 'workspaceAdmin', 'platformAdmin'].map((a) => audienceRank(a as never))).toEqual([0, 1, 2, 3])
  })
})

const fm = (body: string) => `---\ntitle: 장\npart: daily\naudience: member\nsummary: 요약\n---\n\n${body}`
const FILE = '07-x.md'

describe('parseChapter — 본문 없는 절', () => {
  it('바로 아래가 소절이어도 부모 절의 블록이 남는다', () => {
    const ch = parseChapter(FILE, fm('## 부모\n\n### 자식\n\n내용입니다.\n'))
    expect(ch.blocks).toEqual([
      { sectionId: '부모', sectionTitle: '부모', text: '' },
      { sectionId: '자식', sectionTitle: '자식', text: '내용입니다.' },
    ])
  })
  it('비어 있는 들어가는 말 블록만 버린다(첫 블록이 첫 절)', () => {
    const ch = parseChapter(FILE, fm('## 첫 절\n\n내용\n'))
    expect(ch.blocks[0]).toMatchObject({ sectionId: '첫-절' })
    expect(ch.blocks).toHaveLength(1)
  })
  it('마지막 절이 비어도 남는다', () => {
    const ch = parseChapter(FILE, fm('## 가\n\n내용\n\n## 끝\n'))
    expect(ch.blocks.map((b) => b.sectionId)).toEqual(['가', '끝'])
  })
})

describe('parseChapter — 코드 펜스', () => {
  const sectionIds = (body: string) => parseChapter(FILE, fm(body)).sections.map((x) => x.id)
  it('~~~ 펜스 안의 ``` 줄은 펜스를 닫지 않는다', () => {
    expect(sectionIds('~~~\n```\n## 안\n~~~\n\n## 밖\n')).toEqual(['밖'])
  })
  it('백틱 4개 펜스 안의 ``` 줄은 펜스를 닫지 않는다', () => {
    expect(sectionIds('````\n```\n## 안\n```\n````\n\n## 밖\n')).toEqual(['밖'])
  })
  it('더 긴 표지로는 닫히고, 같은 길이로도 닫힌다', () => {
    expect(sectionIds('```\n## 안\n`````\n## 밖\n')).toEqual(['밖'])
    expect(sectionIds('~~~~\n## 안\n~~~~\n## 밖\n')).toEqual(['밖'])
  })
  it('닫는 줄에 글자가 붙으면 닫지 않고, 안내 글이 붙은 여는 줄은 펜스다', () => {
    expect(sectionIds('```\n``` 아직\n## 안\n```\n## 밖\n')).toEqual(['밖'])
    expect(sectionIds('```js\n## 안\n```\n## 밖\n')).toEqual(['밖'])
  })
  it('한 줄에 닫힌 백틱(```코드``` )은 펜스를 열지 않는다', () => {
    expect(sectionIds('```코드``` 설명\n\n## 밖\n')).toEqual(['밖'])
  })
  it('펜스 안 글은 검색 평문에 들어가지 않는다', () => {
    const ch = parseChapter(FILE, fm('## 절\n\n앞\n\n```\n비밀 코드\n```\n\n뒤\n'))
    expect(ch.blocks[0].text).toBe('앞 뒤')
  })
})

describe('parseChapter — 표', () => {
  it('구분 줄(|---|)이 검색 평문에 새지 않고, 칸 사이는 한 칸 공백이다', () => {
    const table = '| 단축키 | 설명 |\n|---|---|\n| Ctrl+V | 붙여넣기 |\n'
    const ch = parseChapter(FILE, fm(`## 표\n\n${table}`))
    expect(ch.blocks[0].text).toBe('단축키 설명 Ctrl+V 붙여넣기')
  })
  it('짧은 구분 칸(|--|·|-|·:-:)도 검색 평문에 새지 않는다', () => {
    for (const sep of ['|--|--|', '|-|-|', '| :-: | -: |']) {
      const ch = parseChapter(FILE, fm(`## 표\n\n| 가 | 나 |\n${sep}\n| 1 | 2 |\n`))
      expect(ch.blocks[0].text, sep).toBe('가 나 1 2')
    }
  })
  it('정렬 표시(:---:)·바깥 파이프 없는 구분 줄도 버린다', () => {
    const t1 = parseChapter(FILE, fm('## 표\n\n| 가 | 나 |\n| :--- | ---: |\n| 1 | 2 |\n')).blocks[0].text
    const t2 = parseChapter(FILE, fm('## 표\n\n가 | 나\n--- | ---\n1 | 2\n')).blocks[0].text
    expect(t1).toBe('가 나 1 2')
    expect(t2).toBe('가 나 1 2')
  })
  it('가로줄(---)도 평문에 넣지 않는다', () => {
    expect(parseChapter(FILE, fm('## 절\n\n앞\n\n---\n\n뒤\n')).blocks[0].text).toBe('앞 뒤')
  })
})

describe('parseChapter — 머리말 가장자리', () => {
  const HEAD = '---\ntitle: 장\npart: daily\naudience: member\nsummary: 요약\n---'
  it('맨 앞 BOM 을 떼고 읽는다', () => {
    const ch = parseChapter(FILE, `\uFEFF${HEAD}\n\n## 절\n\n내용\n`)
    expect(ch.title).toBe('장')
    expect(ch.sections).toHaveLength(1)
  })
  it('닫는 --- 가 파일 끝이고 개행이 없어도 읽는다', () => {
    const ch = parseChapter(FILE, HEAD)
    expect(ch).toMatchObject({ title: '장', body: '', sections: [], blocks: [] })
  })
  it('닫는 --- 뒤에 다른 글자가 붙으면 머리말이 닫히지 않는다', () => {
    expect(() => parseChapter(FILE, HEAD + '-\n\n본문')).toThrow(/머리말/)
  })
})

describe('parseChapter — 제목 끝의 #', () => {
  it('공백 없이 붙은 #(C#)은 제목의 일부, 공백 뒤 #은 닫는 표지', () => {
    const ch = parseChapter(FILE, fm('## C#\n\n## 닫기 ##\n'))
    expect(ch.sections.map((x) => x.title)).toEqual(['C#', '닫기'])
  })
})

describe('findIgnoredHeadings', () => {
  it('정상 본문은 비어 있다(가로줄·표·목록·코드 안은 제목이 아니다)', () => {
    const body = ['들어가는 말', '', '---', '', '## 절', '', '- 항목', '---', '', '| a | b |', '|---|---|', '', '```', '문단', '---', '  ## 코드 안', '```', '', '#### 네 단계는 앵커 없음', ''].join('\n')
    expect(findIgnoredHeadings(body)).toEqual([])
  })
  it('밑줄 제목(=== 또는 ---)을 잡는다', () => {
    expect(findIgnoredHeadings('큰 제목\n=====\n')).toEqual(['밑줄 제목: 큰 제목'])
    expect(findIgnoredHeadings('작은 제목\n---\n')).toEqual(['밑줄 제목: 작은 제목'])
  })
  it('들여쓴 ##·### 를 잡는다(1~3칸)', () => {
    expect(findIgnoredHeadings(' ## 한 칸\n   ### 세 칸\n')).toHaveLength(2)
    expect(findIgnoredHeadings('## 맨 앞은 정상\n')).toEqual([])
  })
})
