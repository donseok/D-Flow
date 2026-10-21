import { describe, expect, it } from 'vitest'
import type { MinuteBlock } from '@/lib/minutes/blocks'
import {
  activeLinkedWbsItems,
  fallbackWbsName,
  pickableParents,
  recommendableParents,
  scoreParentCandidates,
  type MinuteLinkedWbsItem,
  type MinuteWbsParentOption,
  type MinuteWbsTreeRow,
} from '@/lib/domain/minuteWbs'

function treeRow(id: string, parentId: string | null, depth: number, over: Partial<MinuteWbsTreeRow> = {}): MinuteWbsTreeRow {
  return { id, parentId, name: id, isOwnerSplit: false, actualPct: null, assigneeMemberId: null, devWorkflow: false, depth, ...over }
}

// A(묶음) > A1(말단, 실적 40) · B(SUB-ACT 부모) > B1(SUB-ACT) · C(흐름 켜진 말단) · D(활성 주문 말단) — 트리 순서(부모 → 자식)
const TREE: MinuteWbsTreeRow[] = [
  treeRow('A', null, 0),
  treeRow('A1', 'A', 1, { actualPct: 40, assigneeMemberId: 'member-1' }),
  treeRow('B', null, 0),
  treeRow('B1', 'B', 1, { isOwnerSplit: true }),
  treeRow('C', null, 0, { devWorkflow: true }),
  treeRow('D', null, 0),
]
const OPTS = {
  maxDepth: 3,
  numbers: new Map([['A', '1'], ['A1', '1.1'], ['B', '2'], ['B1', '2.1'], ['C', '3'], ['D', '4']]),
  activeOrderItemIds: new Set(['D']),
  dependencyCounts: new Map([['A1', 2]]),
}

describe('pickableParents', () => {
  it('SUB-ACT·SUB-ACT 가 섞인 부모·흐름 켜진 작업·활성 주문 작업을 빼고 트리 순서로 돌려준다', () => {
    expect(pickableParents(TREE, OPTS)).toEqual([
      { id: 'A', path: '1 A', depth: 0, leaf: false, actualPct: null, assigneeMemberId: null, dependencyCount: 0, childNames: ['A1'] },
      { id: 'A1', path: '1 A › 1.1 A1', depth: 1, leaf: true, actualPct: 40, assigneeMemberId: 'member-1', dependencyCount: 2, childNames: [] },
    ])
  })

  it.each([
    ['활성 주문이 끝나면 D', { ...OPTS, activeOrderItemIds: new Set<string>() }, TREE, ['A', 'A1', 'D']],
    ['흐름이 꺼지면 C', OPTS, TREE.map(r => (r.id === 'C' ? { ...r, devWorkflow: false } : r)), ['A', 'A1', 'C']],
    ['B1 이 SUB-ACT 가 아니면 B·B1', OPTS, TREE.map(r => (r.id === 'B1' ? { ...r, isOwnerSplit: false } : r)), ['A', 'A1', 'B', 'B1']],
  ])('제외 조건을 하나 풀면 그 행만 돌아온다 — %s', (_name, opts, rows, ids) => {
    expect(pickableParents(rows, opts).map(o => o.id)).toEqual(ids)
  })

  it('깊이 상한 — maxDepth 1 이면 어디에도 하위를 둘 수 없고, 2 면 최상위만, null 이면 제한이 없다', () => {
    expect(pickableParents(TREE, { ...OPTS, maxDepth: 1 })).toEqual([])
    expect(pickableParents(TREE, { ...OPTS, maxDepth: 2 }).map(o => o.id)).toEqual(['A'])
    expect(pickableParents(TREE, { ...OPTS, maxDepth: null }).map(o => o.id)).toEqual(['A', 'A1'])
  })

  it('번호가 없는 항목은 경로에 이름만 쓴다', () => {
    expect(pickableParents(TREE, { ...OPTS, numbers: new Map([['A', '1']]) }).map(o => o.path)).toEqual(['1 A', '1 A › A1'])
  })
})

describe('recommendableParents', () => {
  it('하위가 이미 있는 묶음 항목(leaf=false)만 남긴다', () => {
    expect(recommendableParents(pickableParents(TREE, OPTS)).map(o => o.id)).toEqual(['A'])
  })
})

function option(id: string, path: string, childNames: string[] = []): MinuteWbsParentOption {
  return { id, path, depth: 0, leaf: childNames.length === 0, actualPct: null, assigneeMemberId: null, dependencyCount: 0, childNames }
}

describe('scoreParentCandidates', () => {
  // 하위 이름에만 '로그인' 이 든 후보를 경로에 든 후보보다 앞에 둔다 — 점수가 입력 순서를 뒤집는지 본다
  const OPTIONS = [
    option('child-only', '2 회원', ['로그인 화면']), // 하위 이름 '로그인' 1점
    option('none', '3 결제', ['카드 등록']), // 0점
    option('path', '1 인증 › 1.2 로그인', ['비밀번호 찾기']), // 경로 '로그인' 2점
    option('schedule', '4 운영', ['배포 일정']), // 하위 이름 '일정' 1점
  ]

  it('경로 겹침(2점)이 하위 이름 겹침(1점)보다 앞서고, 동점은 입력 순서, 0점은 빼고 limit 개만', () => {
    expect(scoreParentCandidates('로그인 API 개발 일정', OPTIONS, 2)).toEqual(['path', 'child-only'])
    expect(scoreParentCandidates('로그인 API 개발 일정', OPTIONS, 10)).toEqual(['path', 'child-only', 'schedule'])
  })

  it('limit 을 주지 않으면 상위 3개', () => {
    const options = [0, 1, 2, 3].map(i => option(`o${i}`, `${i + 1} 배포`))
    expect(scoreParentCandidates('배포 준비', options)).toEqual(['o0', 'o1', 'o2'])
  })

  it('한 낱말이 경로와 하위 이름에 함께 있으면 두 점수를 더한다(3점)', () => {
    const options = [option('path-only', '2 개발'), option('both', '1 로그인', ['로그인 화면'])]
    expect(scoreParentCandidates('로그인 개발', options)).toEqual(['both', 'path-only'])
  })

  it('낱말은 소문자로 맞추고 한 글자 낱말은 세지 않는다', () => {
    const options = [option('one-char', '1 앱'), option('api', '2 Api 연동')]
    expect(scoreParentCandidates('앱 API 점검', options)).toEqual(['api'])
  })

  it('겹치는 낱말이 없으면 빈 목록', () => {
    expect(scoreParentCandidates('회의 메모', OPTIONS)).toEqual([])
  })

  describe('경로의 개요 번호는 낱말로 세지 않는다 — 회의 날짜가 x.10 번 위치를 추천하지 않는다', () => {
    const options = [
      option('d10', '1 설계 › 1.10 알림 설계', ['푸시 알림 발송']),
      option('login', '2 개발 › 2.1 로그인', ['소셜 로그인 연동']),
    ]

    it.each(['10/21', '10.21', '2026-10-21'])('날짜 %s', date => {
      expect(scoreParentCandidates(`로그인 오류 수정 ${date}까지`, options)).toEqual(['login'])
      expect(scoreParentCandidates(`${date} 회의 결과 공유`, options)).toEqual([])
    })

    it('번호만 걷고 이름 속 숫자는 낱말로 남긴다', () => {
      const named = [option('closing', '4 2026 결산'), option('v2', '3 연동 › 3.2 API v2 전환')]
      expect(scoreParentCandidates('2026 회계 마감', named)).toEqual(['closing'])
      expect(scoreParentCandidates('v2 응답 형식 확인', named)).toEqual(['v2'])
    })
  })

  describe('조사가 붙은 낱말 — 글 낱말이 후보 낱말로 시작하면 겹침이다', () => {
    it('"로그인을" 이 경로의 "로그인" 을 잡는다', () => {
      const options = [option('design', '1 설계', ['화면 설계']), option('login', '2 개발 › 2.1 로그인', ['소셜 로그인 연동'])]
      expect(scoreParentCandidates('로그인을 다음 주까지 고친다', options)).toEqual(['login'])
    })

    it('"API를" 이 하위 이름의 "API" 를 잡는다(1점)', () => {
      expect(scoreParentCandidates('API를 정리', [option('none', '1 운영'), option('api', '3 연동', ['API 개발'])])).toEqual(['api'])
    })

    it('후보 낱말은 줄이지 않는다 — 글 낱말 "로그" 는 "로그인" 을 잡지 못하고, 한 글자 후보 낱말은 끝내 겹치지 않는다', () => {
      expect(scoreParentCandidates('로그 수집', [option('login', '2 개발 › 2.1 로그인')])).toEqual([])
      expect(scoreParentCandidates('앱을 고친다', [option('one-char', '1 앱', ['웹 앱'])])).toEqual([])
      // 글자는 UTF-16 단위가 아니라 코드 포인트로 센다 — 서로게이트 쌍 한 글자('𠀀')도 한 글자다
      expect(scoreParentCandidates('𠀀를 고친다', [option('astral', '1 𠀀')])).toEqual([])
    })

    it('끊김 없는 10만 자 낱말이 든 글도 그 낱말이 없을 때와 결과가 같다 — 앞부분을 모두 만들어 두지 않는다(메모리가 낱말 길이의 제곱으로 늘지 않는다)', () => {
      const options = Array.from({ length: 50 }, (_, i) =>
        option(`o${i}`, `${i + 1} 개발 › ${i + 1}.1 ${i % 5 === 0 ? '로그인' : `기능${i}`}`, [`하위 작업 ${i}`, i % 7 === 0 ? '배포 일정' : '문서 정리']))
      const sentence = '로그인 오류를 다음 주 배포 일정까지 고친다'
      const long = 'a'.repeat(100_000)
      const expected = scoreParentCandidates(sentence, options, 50)

      expect(expected.slice(0, 3)).toEqual(['o0', 'o35', 'o5'])
      expect(scoreParentCandidates(`${sentence}\n${long}`, options, 50)).toEqual(expected)
      expect(scoreParentCandidates(`${long} ${sentence}`, options, 50)).toEqual(expected)
      // 긴 낱말도 겹침 판정에 그대로 든다 — 그 낱말은 후보 낱말 'aaa' 로 시작한다
      expect(scoreParentCandidates(long, [...options, option('a-word', '99 aaa 처리')])).toEqual(['a-word'])
    })
  })
})

describe('fallbackWbsName', () => {
  it('insight 라벨이 있으면 그것을 쓴다(앞뒤 공백 제거·공백 접기)', () => {
    expect(fallbackWbsName('- [ ] 원문 첫 줄', '  로그인   API 개발  ')).toBe('로그인 API 개발')
  })

  it('라벨이 없거나 비었으면 첫 줄에서 글머리·체크 상자·강조를 걷는다', () => {
    expect(fallbackWbsName('- [ ] **로그인** API\n둘째 줄')).toBe('로그인 API')
    expect(fallbackWbsName('- [ ] **로그인** API\n둘째 줄', null)).toBe('로그인 API')
    expect(fallbackWbsName('- [ ] **로그인** API\n둘째 줄', '   ')).toBe('로그인 API')
  })

  it.each([
    ['번호', '2) 권한   설계 검토', '권한 설계 검토'],
    ["제목 '#'", '## 배포 일정 확정', '배포 일정 확정'],
    ['링크', '[결제 모듈](https://example.com/pay) 연동', '결제 모듈 연동'],
    ['회의록 초안 텍스트의 체크 표시', '[미완료] 로그인 API', '로그인 API'],
    ['빈 첫 줄', '\n\n  결제 연동  ', '결제 연동'],
    ['기간 표기의 물결표는 남긴다', '- 통합 테스트 10/21~10/25', '통합 테스트 10/21~10/25'],
  ])('%s', (_name, text, expected) => {
    expect(fallbackWbsName(text)).toBe(expected)
  })

  it('200자를 넘으면 200자로 자른다', () => {
    expect(fallbackWbsName('가'.repeat(201))).toBe('가'.repeat(200))
    expect(fallbackWbsName('원문', '나'.repeat(201))).toBe('나'.repeat(200))
  })

  it('남는 글이 없으면 빈 문자열 — 화면에서 사람이 작업명을 넣는다', () => {
    expect(fallbackWbsName('- [ ]\n\n')).toBe('')
  })
})

function block(index: number, hash: string): MinuteBlock {
  return { index, hash, text: `블록 ${index}`, rendered: true }
}

function link(over: Partial<MinuteLinkedWbsItem>): MinuteLinkedWbsItem {
  return {
    linkId: 'link-1', itemId: 'item-1', code: '로그인', name: '로그인 API 개발', projectId: 'project-1',
    minuteVersionId: 'version-1', bodyHash: 'body-1', blockIndex: 0, blockHash: 'hash-a', sourceKind: 'action', ...over,
  }
}

describe('activeLinkedWbsItems', () => {
  // 현재 본문(버전 2): 맨 앞에 문단이 하나 끼어 버전 1 의 블록이 한 칸씩 밀렸다
  const BLOCKS = [block(0, 'hash-new'), block(1, 'hash-a'), block(2, 'hash-b')]

  it('다른 버전의 연결이라도 hash 가 현재 블록에 있으면 그 index 로 옮겨 포함하고, 없는 hash 는 뺀다', () => {
    const moved = link({ linkId: 'moved', blockIndex: 1, blockHash: 'hash-b' }) // 버전 1 의 1번 → 지금 2번
    const gone = link({ linkId: 'gone', blockIndex: 2, blockHash: 'hash-edited' }) // 문단을 고쳐 hash 가 사라졌다
    const current = link({ linkId: 'current', minuteVersionId: 'version-2', bodyHash: 'body-2', blockIndex: 1, blockHash: 'hash-a' })

    expect(activeLinkedWbsItems([moved, gone, current], BLOCKS)).toEqual([{ ...moved, blockIndex: 2 }, current])
    expect(moved.blockIndex).toBe(1)
  })

  it('같은 hash 의 블록이 여럿이면 원래 index 에 가장 가까운 블록으로 옮긴다(같은 거리면 앞 블록)', () => {
    const blocks = [block(0, 'hash-dup'), block(1, 'hash-x'), block(2, 'hash-dup'), block(3, 'hash-y'), block(4, 'hash-y'), block(5, 'hash-dup')]
    const indexOf = (blockIndex: number) => activeLinkedWbsItems([link({ blockIndex, blockHash: 'hash-dup' })], blocks)[0]?.blockIndex

    expect(indexOf(4)).toBe(5)
    expect(indexOf(2)).toBe(2)
    expect(indexOf(1)).toBe(0)
  })
})
