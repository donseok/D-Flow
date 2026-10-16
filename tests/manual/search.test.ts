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
