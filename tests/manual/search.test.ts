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
  it('자른 끝의 공백은 다시 떼고, 서로게이트 쌍 가운데를 자르지 않는다', () => {
    const cut = normalizeQuery('가'.repeat(MANUAL_QUERY_MAX - 1) + ' 나다라')
    expect(cut).toBe('가'.repeat(MANUAL_QUERY_MAX - 1))
    const emoji = normalizeQuery('😀'.repeat(150))
    expect([...emoji]).toHaveLength(MANUAL_QUERY_MAX)
    expect(() => encodeURIComponent(emoji)).not.toThrow()
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
  it('limit 가 0 이하이거나 숫자가 아니면 결과가 없다(음수가 slice 끝 인덱스로 새지 않는다)', () => {
    expect(searchManual(CH, '다', 0)).toEqual([])
    expect(searchManual(CH, '다', -1)).toEqual([])
    expect(searchManual(CH, '다', Number.NaN)).toEqual([])
    expect(searchManual(CH, '다', 2).length).toBeGreaterThan(1)
  })
  it('낱말은 어떤 공백(탭·개행·여러 칸)으로 나눠도 같다', () => {
    expect(searchManual(CH, '붙여넣기\t한\n칸')).toEqual(searchManual(CH, '붙여넣기 한 칸'))
    expect(searchManual(CH, '붙여넣기   한 칸')).toHaveLength(1)
  })
  it('본문 없는 부모 절도 제목으로 찾는다', () => {
    const chs = [mk('08-parent.md', '장', '## 부모\n\n### 자식\n\n내용입니다.\n')]
    const hits = searchManual(chs, '부모')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ slug: 'parent', sectionId: '부모', sectionTitle: '부모' })
    expect(searchManual(chs, '자식')[0]).toMatchObject({ sectionId: '자식' })
  })
})

describe('searchManual — 순위', () => {
  it('제목에 낱말이 든 절이 순서가 뒤여도 본문에만 든 절보다 앞선다', () => {
    const chs = [
      mk('01-a.md', '첫째 장', '## 개요\n\n여기서도 복사를 말합니다.\n'),
      mk('02-b.md', '둘째 장', '## 복사하기\n\n방법을 설명합니다. 복사 버튼을 누르세요.\n'),
    ]
    const hits = searchManual(chs, '복사')
    expect(hits.map((h) => h.slug)).toEqual(['b', 'a'])
    expect(hits[0].sectionTitle).toBe('복사하기')
  })
  it('장 제목에 든 경우도 본문에만 든 절보다 앞선다', () => {
    const chs = [
      mk('01-a.md', '첫째 장', '## 개요\n\n여기서도 복사를 말합니다.\n'),
      mk('02-b.md', '복사 안내', '## 개요\n\n내용입니다. 복사.\n'),
    ]
    expect(searchManual(chs, '복사').map((h) => h.slug)).toEqual(['b', 'a'])
  })
  it('점수가 같으면 장 순서·절 순서를 따른다', () => {
    const chs = [
      mk('01-a.md', '첫째 장', '## 가\n\n복사 하나.\n\n## 나\n\n복사 둘.\n'),
      mk('02-b.md', '둘째 장', '## 다\n\n복사 셋.\n'),
    ]
    expect(searchManual(chs, '복사').map((h) => h.sectionId)).toEqual(['가', '나', '다'])
  })
  it('낱말이 둘 다 제목에 든 절이 하나만 든 절보다 앞선다', () => {
    const chs = [
      mk('01-a.md', '장', '## 복사\n\n붙여넣기도 합니다.\n'),
      mk('02-b.md', '장', '## 복사 붙여넣기\n\n설명.\n'),
    ]
    expect(searchManual(chs, '복사 붙여넣기').map((h) => h.sectionTitle)).toEqual(['복사 붙여넣기', '복사'])
  })
})
