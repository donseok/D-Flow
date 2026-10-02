// 옛 프로세스 전역 팀 캐시(src/lib/teams/master.ts)의 소비처 — 닫힌 목록(SP4 A2 계획 P2, 스펙 §7 A2 첫 줄).
// A2 의 과제가 소비처를 요청 범위 원천(src/lib/teams/source.ts)으로 옮길 때마다 같은 커밋에서 이 목록에서 지운다 — 목록이 줄어드는 것이 진척이다.
// A2 끝의 목록 = B 의 화면 넷(레이아웃 둘·명단 페이지·DashboardView) + refreshTeams 를 쓰는 액션 셋(project·teams·projectTeams). B 가 master.ts 를
// 지우며 이 파일을 tests/invariants/teams-source.test.ts 로 바꾼다(스펙 §6.1).
// SP3b UI-2(V16)가 (app)/layout 의 팀 주입을 범위 레이아웃 셋((global)·w/[slug]·p/[projectId])으로 내렸다 — 화면은 다섯(범위 레이아웃 셋·명단
// 페이지·DashboardView)이 되고, 셋 다 SP4 B 가 요청 범위 원천으로 옮긴다(이월 — 셸 레이아웃이라 원천 교체는 성능 R25 재측정과 함께).
// SP4 B 과제 4 가 화면 다섯을 옮겼다 — 과제 5 가 이 파일을 지운다.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const CWD = process.cwd()
const IMPORT = /from\s+['"]@\/lib\/teams\/master['"]/

export const MASTER_CONSUMERS: readonly string[] = [
  'src/app/actions/project.ts',
  'src/app/actions/projectTeams.ts',
  'src/app/actions/teams.ts',
]
/** 옛 캐시에서 refreshTeams 만 가져오는 파일 — 화면 팀 목록(레이아웃)의 갱신 신호라 B 까지 남는다(계획 P20) */
export const REFRESH_ONLY: readonly string[] = ['src/app/actions/project.ts', 'src/app/actions/projectTeams.ts', 'src/app/actions/teams.ts']

const consumers = () => walk(join(CWD, 'src'))
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .filter((f) => codeLines(readFileSync(f, 'utf8'), f).some((l) => IMPORT.test(l)))
  .map((f) => relative(CWD, f))
  .sort()

describe('옛 팀 캐시 소비처 — 닫힌 목록(SP4 A2 P2)', () => {
  it('src 에서 @/lib/teams/master 를 import 하는 파일 = MASTER_CONSUMERS(양방향)', () => {
    expect(consumers()).toEqual([...MASTER_CONSUMERS].sort())
  }, 20_000)
  it('REFRESH_ONLY 파일은 refreshTeams 하나만 import 한다', () => {
    for (const f of REFRESH_ONLY) {
      const line = codeLines(readFileSync(join(CWD, f), 'utf8'), f).find((l) => IMPORT.test(l)) ?? ''
      const names = (/\{([^}]*)\}/.exec(line)?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
      expect(names, f).toEqual(['refreshTeams'])
    }
  })
  it('B 과제 4 뒤 — 남은 소비처는 refreshTeams 액션 셋뿐', () => {
    expect([...MASTER_CONSUMERS].sort()).toEqual([
      'src/app/actions/project.ts', 'src/app/actions/projectTeams.ts', 'src/app/actions/teams.ts',
    ].sort())
    expect([...REFRESH_ONLY].sort()).toEqual(['src/app/actions/project.ts', 'src/app/actions/projectTeams.ts', 'src/app/actions/teams.ts'])
  })
  it('목록은 정렬돼 있고 중복이 없다 — 지울 때 자리를 찾기 쉽게', () => {
    expect([...MASTER_CONSUMERS]).toEqual([...new Set(MASTER_CONSUMERS)].sort())
  })
})
