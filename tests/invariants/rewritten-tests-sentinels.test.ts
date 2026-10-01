// SP4 가 다시 쓴 주간 테스트의 옛 구분명·팀 코드 0건(스펙 §4.8 D47·마무리 판정 T3, 계획 P13·과제 25). 목록은 닫혀 있다 — 이 목록에서만
// 본다. 목록 밖 적중은 범위 밖이다: 센티널 장치·SP5 의 회의록 테스트·이관 RLS 테스트, 주간 몫만 다시 쓴 혼합 파일(봇 도구·골든·저장소)의
// WBS·명단·라우터 몫(팀 코드 리터럴 — SP8). 뒤 과제는 테스트를 합성 이름으로 다시 쓰면 그 커밋에서 덧붙인다 — 빼지 않는다.
// 합성 구성이 실제로 등록하는 이름과 같은 센티널(C 의 영역 이름 하나)은 뺀다(스펙 D8 — sentinelsFor, 포함 관계로는 빼지 않는다).
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LEGACY_SENTINELS, SENTINELS_BY_SP, findSentinels, sentinelsFor } from '../fixtures/legacy-sentinels'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

const REWRITTEN_TESTS = [
  'tests/actions/project-areas.test.ts',
  'tests/actions/weekly-ai-rewrite.test.ts',
  'tests/actions/weekly-cells-batch.test.ts',
  'tests/actions/weekly-create.test.ts',
  'tests/ai/index-weekly-areas.test.ts',
  'tests/ai/tools-weekly-team.test.ts',
  'tests/api/report-route.test.ts',
  'tests/components/weekly-presence.test.tsx',
  'tests/data/weeklySheet-carryover.test.ts',
  'tests/data/weeklySheet.test.ts',
  'tests/domain/areas.test.ts',
  'tests/domain/sheetPresence.test.ts',
  'tests/domain/sheetSelection.test.ts',
  'tests/domain/weekly-carry.test.ts',
  'tests/domain/weekly-merge.test.ts',
  'tests/domain/weekly-rewrite.test.ts',
  'tests/domain/weeklyLint.test.ts',
  'tests/domain/weeklySheet.test.ts',
  'tests/fixtures/synthetic/areas.ts',
  'tests/fixtures/synthetic/teams.ts',
  'tests/helpers/legacySectionRows.ts',
  'tests/invariants/rewritten-tests-sentinels.test.ts',
  'tests/invariants/weekly-row-columns.test.ts',
  'tests/negative/weekly-outputs.test.ts',
  'tests/report/sheet-sections.test.ts',
  'tests/report/sheetNarrative.test.ts',
  'tests/report/templateFill.test.ts',
  'tests/ui/carry-mapping-modal.test.tsx',
  'tests/ui/weekly-ai-rewrite-modal.test.tsx',
  'tests/ui/weekly-lint-panel-jump.test.tsx',
  'tests/ui/weekly-lint-panel-sections.test.tsx',
  'tests/ui/weekly-sheet-colgroup.test.tsx',
  'tests/ui/weekly-sheet-no-areas.test.tsx',
  'tests/ui/weekly-sheet-realtime.test.tsx',
] as const

/** 합성 구성 셋이 등록하는 팀·영역의 code·name — 이것과 같은 센티널만 뺀다 */
const REGISTERED = [
  ...Object.values(SYNTHETIC_TEAMS).flat().flatMap((t) => [t.code, t.name]),
  ...Object.values(SYNTHETIC_WEEKLY_AREAS).flat().flatMap((a) => [a.code, a.name]),
]
const WATCHED = sentinelsFor('SP4', REGISTERED)
const listed: readonly string[] = REWRITTEN_TESTS

describe('다시 쓴 주간 테스트 — SP4 센티널 0건(P13)', () => {
  it('목록은 중복 없이 있는 파일만 든다 — 없는 파일은 목록이 낡은 것이다', () => {
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed.filter((f) => !existsSync(f))).toEqual([])
  })

  it('목록의 파일에 옛 구분명·팀 코드가 없다', () => {
    const offenders = listed.flatMap((f) => {
      const hits = findSentinels(readFileSync(f, 'utf8'), WATCHED)
      return hits.length ? [`${f}: ${hits.join(', ')}`] : []
    })
    expect(offenders).toEqual([])
  })

  it('센티널 장치·SP5 소유 파일은 목록 밖이다(마무리 판정 T3)', () => {
    for (const f of ['tests/fixtures/legacy-sentinels.ts', 'tests/negative/sentinels.test.ts', 'tests/minutes/team-subgroups.test.ts']) {
      expect(listed, f).not.toContain(f)
    }
  })

  it('빼는 센티널은 합성 구성이 등록한 이름과 같은 것 하나뿐이고, 가드는 평범한 테스트 문장 속 옛 이름을 잡는다', () => {
    const [, sales, , , quality] = LEGACY_SENTINELS.weeklySections
    expect(SENTINELS_BY_SP.SP4.filter((w) => !WATCHED.includes(w))).toEqual([quality])
    expect(findSentinels(`row({ section: '${sales}', module: '' })`, WATCHED)).toEqual([sales])
  })
})
