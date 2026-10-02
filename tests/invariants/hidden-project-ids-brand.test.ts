// HH2(UI-2b GG 재리뷰 P3-2) — 프로젝트 화면 숨김의 한 판정자 isHiddenProject 는 셋째 인자를 빠뜨리면 컴파일되지 않지만, 아무 집합이나
// 넘겨도 컴파일됐다. 병합 때 main 의 두 인자 호출이 typecheck 에 걸리면 가장 싼 수정이 `new Set()` 이고, 그러면 명단 밖 비공개가 조용히 열린다.
// 그래서 셋째 인자는 브랜드 타입 HiddenProjectIds 이고, 그 값을 만드는 곳은 getHiddenProjectIds(src/lib/authz/visibility.ts) 하나다.
//  ① 타입: 빈 집합·임의 집합을 넘기면 typecheck 가 실패한다 — 아래 @ts-expect-error 가 '쓰이지 않음'(TS2578)이 되면 브랜드가 풀린 것이다.
//  ② 원문: src 에서 HiddenProjectIds 로 단언(as)하는 곳은 visibility.ts 뿐이다(테스트는 fixtures 도우미로 만든다).
//  ③ 원문(HH 재리뷰 P3 — 과제 39): isHiddenProject 호출 안의 이름 없는 단언(as never·as any·as unknown as …)도 src 에 없다 — 브랜드 이름을
//     쓰지 않고 셋째 인자를 메우는 꼴이라 ②가 못 잡는다.
// 의도적 우회(이 목록·파일 편집, 다른 이름의 단언)는 잡지 않는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isHiddenProject } from '@/lib/domain/authz'
import { makeActor } from '../fixtures/actor'
import { codeLines, walk } from './_walk'

const MAKER = 'src/lib/authz/visibility.ts'
const CAST = /\bas\s+(?:unknown\s+as\s+|ReadonlySet<string>\s+as\s+)?HiddenProjectIds\b|<HiddenProjectIds>/
/** 주석 밖 코드에 HiddenProjectIds 단언이 있는가 */
const casts = (f: string) => CAST.test(codeLines(readFileSync(f, 'utf8'), f).join('\n'))
/** isHiddenProject( … ) 호출 인자 안의 이름 없는 단언 — 괄호 한 겹까지(호출은 한 줄 꼴) */
const LOOSE_CALL = /\bisHiddenProject\s*\((?:[^()]|\([^()]*\))*\bas\s+(?:never|any|unknown)\b/

describe('HiddenProjectIds 브랜드 — 숨김 집합의 출처는 getHiddenProjectIds 하나', () => {
  it('① 빈 집합·임의 집합은 셋째 인자로 컴파일되지 않는다(typecheck 단언)', () => {
    const typeOnly = () => {
      const actor = makeActor()
      // @ts-expect-error — 빈 집합은 HiddenProjectIds 가 아니다(병합 때 두 인자 호출을 이것으로 메우면 명단 밖 비공개가 열린다)
      isHiddenProject(actor, 'p', new Set())
      const loose: ReadonlySet<string> = new Set(['p'])
      // @ts-expect-error — getHiddenProjectIds 가 만들지 않은 ReadonlySet 도 받지 않는다
      isHiddenProject(actor, 'p', loose)
    }
    expect(typeof typeOnly).toBe('function')   // 실행하지 않는다 — 단언은 위 두 줄의 typecheck 다
  })
  it('② src 에서 HiddenProjectIds 로 단언하는 파일은 visibility.ts 하나다', () => {
    const files = walk('src')
    expect(files).toContain(MAKER)
    expect(files.filter((f) => f !== MAKER && casts(f))).toEqual([])
    expect(casts(MAKER), '만드는 곳이 단언을 잃었다 — 이 검사의 기준이 바뀌었는지 본다').toBe(true)
  })
  it('③ src 의 isHiddenProject 호출에 이름 없는 단언(as never·as any·as unknown as)이 없다', () => {
    expect(LOOSE_CALL.test("isHiddenProject(actor, pid, new Set() as never)")).toBe(true)
    expect(LOOSE_CALL.test("isHiddenProject(actor, pid, new Set() as unknown as X)")).toBe(true)
    expect(LOOSE_CALL.test("isHiddenProject(actor, pid, hidden)")).toBe(false)
    const hits = walk('src').filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => LOOSE_CALL.test(codeLines(readFileSync(f, 'utf8'), f).join('\n')))
    expect(hits).toEqual([])
  })
})
