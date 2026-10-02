import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PENDING_STEPS, SYNTHETIC_C, SYNTHETIC_R, SYNTHETIC_WORKSPACE_B, areaView, expectedAreas, expectedTeams, renderedProof, teamView, wbsRows, weekRowsHaveContent, outlineExpandUnsupported,
} from '../../scripts/lib/synthetic.mjs'
import { TEMPLATE_HEADER } from '../../scripts/lib/e2e.mjs'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'

// 합성 게이트 러너(scripts/e2e-synthetic.mjs)의 구성값은 .mjs 라 TS 픽스처를 import 하지 못해 한 번 더 적는다 — 같은 값인지 대조한다.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v))
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

describe('scripts/lib/synthetic.mjs ↔ tests/fixtures/synthetic/configs.ts', () => {
  const [, research, construction] = SYNTHETIC_CONFIGS
  it('R·C 의 프로젝트·워크스페이스 설정이 픽스처와 같다', () => {
    expect(plain(SYNTHETIC_R.config.project)).toEqual(plain(research.project))
    expect(plain(SYNTHETIC_R.config.workspace)).toEqual(plain(research.workspace))
    expect(plain(SYNTHETIC_C.config.project)).toEqual(plain(construction.project))
    expect(plain(SYNTHETIC_C.config.workspace)).toEqual(plain(construction.workspace))
    expect(SYNTHETIC_R.config.id).toBe(research.id)
    expect(SYNTHETIC_C.config.id).toBe(construction.id)
  })
  it('C 는 프로젝트 modules.enabled 와 워크스페이스 modules.allowed 둘 다에 weekly 가 있다(스펙 D40·E10 — 한쪽만이면 허용 밖 모듈로 저장이 거부된다)', () => {
    expect(construction.project['modules.enabled']).toContain('weekly')
    expect(construction.workspace['modules.allowed']).toContain('weekly')
  })
  it('세 워크스페이스 슬러그가 서로 다르고 이름이 합성임을 밝힌다', () => {
    const slugs = [SYNTHETIC_R.slug, SYNTHETIC_C.slug, SYNTHETIC_WORKSPACE_B.slug]
    expect(new Set(slugs).size).toBe(3)
    for (const ws of [SYNTHETIC_R, SYNTHETIC_C, SYNTHETIC_WORKSPACE_B]) expect(String(ws.name)).toMatch(/^합성 /)
  })
  it('아직 켜지지 않은 단계는 S1·S2·S9 와 S4 의 월요일 키를 뺀 전부이고 담당 SP 가 적혀 있다(D25 — 건너뜀으로 세지 않는다)', () => {
    expect(Object.keys(PENDING_STEPS)).toEqual(['S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S10'])
    expect(PENDING_STEPS.S4).toBe('SP5(일)')
    expect(PENDING_STEPS.S10).toBe('SP5~SP8(나머지 부분 집합)')
    for (const owner of Object.values(PENDING_STEPS)) expect(String(owner)).toMatch(/^SP/)
  })
  it('C 만 월요일 주 시작 규칙(SP5 D28) — S1 의 설정 액션으로 주차 문서보다 먼저 쓴다', () => {
    expect(SYNTHETIC_C.weekStart).toBe('monday')
    expect('weekStart' in SYNTHETIC_R).toBe(false)
    const src = readFileSync('scripts/e2e-synthetic.mjs', 'utf8')
    const call = 'config(SYNTHETIC_C.config, wsC, SYNTHETIC_C.weekStart)'
    expect(src).toContain(call)
    expect(src.indexOf(call)).toBeLessThan(src.indexOf("'createWeeklyReport', [C.id"))
    expect(src).toContain("'calendar.week_start': [{ day: weekStart, from: null }]")
  })
})

describe('S1 추가분 — 팀·주간 영역(스펙 §6.4 S1)', () => {
  it.each([[SYNTHETIC_R, 'research'], [SYNTHETIC_C, 'construction']] as const)('%# — 팀 code 순서와 영역(code·이름·순서·담당 팀 code)이 픽스처와 같다', (def, id) => {
    const codeOf = new Map(SYNTHETIC_TEAMS[id].map((t) => [t.id, t.code]))
    expect([...def.teams]).toEqual(SYNTHETIC_TEAMS[id].map((t) => t.code))
    expect(plain(def.weeklyAreas)).toEqual(SYNTHETIC_WEEKLY_AREAS[id].map((a) => ({
      code: a.code, name: a.name, sortOrder: a.sortOrder, teams: a.teams.map((t) => [codeOf.get(t.teamId), t.kind]),
    })))
  })
  it('areaView 는 DB 행(순서 뒤섞임·area_teams 임베드)을 expectedAreas 와 같은 모양으로 — 모르는 팀 id 는 다르게 남는다', () => {
    const ids = new Map([['t-res', 'RES'], ['t-ops', 'OPS']])
    const rows = [
      { id: 'a3', code: 'RUN', name: '운영', sort_order: 3, active: true, area_teams: [{ team_id: 't-ops', kind: 'primary' }] },
      { id: 'a1', code: 'EXP', name: '실험', sort_order: 1, active: true, area_teams: [{ team_id: 't-res', kind: 'primary' }] },
      { id: 'a2', code: 'DATA', name: '데이터', sort_order: 2, active: true,
        area_teams: [{ team_id: 't-ops', kind: 'support' }, { team_id: 't-res', kind: 'primary' }] },
    ]
    expect(areaView(rows, ids)).toEqual(expectedAreas(SYNTHETIC_R.weeklyAreas))
    expect(areaView([{ ...rows[1], area_teams: [{ team_id: 't-x', kind: 'primary' }] }], ids)[0].teams).toEqual([['?t-x', 'primary']])
    expect(areaView([{ ...rows[1], active: false }], ids)[0].active).toBe(false)
  })
  it('teamView·expectedTeams — addProjectTeam 이 만든 순서(0부터)·이름 = code(개명은 A2·B — D37)', () => {
    expect(teamView([{ code: 'OPS', name: 'OPS', sort_order: 1, active: true }, { code: 'RES', name: 'RES', sort_order: 0, active: true }]))
      .toEqual(expectedTeams(SYNTHETIC_R.teams))
  })
})

describe('wbsRows — S2 가져오기 행(R 4단·C 3단, 담당 = 그 프로젝트 팀)', () => {
  it.each([[SYNTHETIC_R], [SYNTHETIC_C]] as const)('%# — 깊이 = 단계 이름 수, 담당은 잎에만 그 프로젝트 팀, 형제 가중치 합 1, 코드 유일', (def) => {
    const depth = def.config.project['core.level_labels'].length
    const rows = wbsRows(depth, def.teams)
    const codes = rows.map((r) => String(r[0]))
    expect(new Set(codes).size).toBe(codes.length)
    expect(Math.max(...codes.map((c) => c.split('.').length))).toBe(depth)
    const isLeaf = (c: string) => !codes.some((o) => o.startsWith(`${c}.`))
    for (const r of rows) {
      expect(r).toHaveLength(TEMPLATE_HEADER.length)
      if (isLeaf(String(r[0]))) expect([...def.teams]).toContain(r[8])
      else expect(r[8]).toBe('')
    }
    const parentOf = (c: string) => c.split('.').slice(0, -1).join('.')
    const sums = new Map<string, number>()
    for (const r of rows) sums.set(parentOf(String(r[0])), (sums.get(parentOf(String(r[0]))) ?? 0) + Number(r[6]))
    for (const s of sums.values()) expect(s).toBeCloseTo(1)
  })
  it('깊이가 2 미만이거나 팀이 없으면 throw', () => {
    expect(() => wbsRows(1, ['RES'])).toThrow()
    expect(() => wbsRows(3, [])).toThrow()
  })
})

describe('e2e-synthetic.mjs — SP4 A1 단계(S1 추가·S2·S4(월))', () => {
  const src = readFileSync('scripts/e2e-synthetic.mjs', 'utf8')
  it('새 단계가 이름으로 있고 S1 추가 → S9 → S2 → S4 순서다(S9 의 C 스냅샷은 S1 직후의 설정이다)', () => {
    const at = (n: string) => src.indexOf(`step('${n}'`)
    for (const n of ['S1-create', 'S1-teams-areas', 'S9-isolation', 'S2-wbs-import', 'S4-weekly-monday', 'S10-negative', 'boundary-sp4']) expect(at(n), n).toBeGreaterThan(-1)
    expect(at('S1-create')).toBeLessThan(at('S1-teams-areas'))
    expect(at('S1-teams-areas')).toBeLessThan(at('S9-isolation'))
    expect(at('S9-isolation')).toBeLessThan(at('S2-wbs-import'))
    expect(at('S2-wbs-import')).toBeLessThan(at('S4-weekly-monday'))
    expect(at('S4-weekly-monday')).toBeLessThan(at('S10-negative'))
    expect(at('S10-negative')).toBeLessThan(at('boundary-sp4'))
    expect(at('boundary-sp4')).toBeLessThan(src.indexOf('Object.entries(PENDING_STEPS)'))
  })
  it('S10 은 다섯 대상과 교차 프로젝트를 본다 — 일치 규칙은 sentinels.mjs 하나(스펙 §6.4)', () => {
    for (const needle of ["source=sheet&format=pptx", "format=xlsx", "format=pptx", "/api/export?projectId=", "&expand=1", "/api/import/inspect", "/weekly`", "/wbs`"]) {
      expect(src, needle).toContain(needle)
    }
    expect(src).toMatch(/excludeRegistered\(sp4Sentinels\(\)/)
    expect(src).not.toMatch(/function findSentinels|SENTINEL_MASKS\s*=/)   // 규칙을 러너에 다시 쓰지 않는다
  })
  it('팀·영역·주간 쓰기는 화면과 같은 서버 액션 넷 — worker 는 그 액션을 쓰는 페이지', () => {
    for (const [name, worker] of [
      ['addProjectTeam', '/p/[projectId]/settings/page'], ['upsertArea', '/p/[projectId]/settings/page'],
      ['createWeeklyReport', '/p/[projectId]/weekly/page'], ['saveWeeklyCells', '/p/[projectId]/weekly/page'],
    ] as const) {
      expect(src, name).toMatch(new RegExp(`${name}: \\{[^}]*exportedName: '${name}', worker: '${esc(worker)}'`))
    }
    expect(src).not.toMatch(/svc\.from\('(?:teams|project_areas|area_teams|weekly_reports|weekly_report_rows|wbs_items)'\)/)
  })
  it('가져오기 실행은 importForm 한 곳(명령 id 필수) — 같은 명령 id 를 두 번 보낸다', () => {
    expect(src).toContain('importForm(')
    expect(src).not.toMatch(/append\('mode'/)
  })
})

describe('renderedProof — S10 ⑤ 화면이 실제로 그려졌는지(A2-4 리뷰 P3-2 · W1)', () => {
  it('기대 이름이 모두 HTML 에 있으면 ok, 찾은 것과 빠진 것을 나눠 돌려준다', () => {
    expect(renderedProof('<td>실험</td><td>데이터</td>', ['실험', '데이터'])).toEqual({ ok: true, found: ['실험', '데이터'], missing: [] })
    expect(renderedProof('<td>실험</td>', ['실험', '데이터'])).toEqual({ ok: false, found: ['실험'], missing: ['데이터'] })
  })
  it('권한 없음·빈 화면(200)은 실패다 — 센티널 0 만으로 초록이 되지 않는다', () => {
    expect(renderedProof('<p>이 프로젝트를 볼 권한이 없습니다</p>', ['실험']).ok).toBe(false)
  })
  it('기대 이름이 없으면(빈 목록·공백 이름뿐) 판정할 수 없어 실패다', () => {
    expect(renderedProof('아무 내용', []).ok).toBe(false)
    expect(renderedProof('아무 내용', ['', '  ']).ok).toBe(false)
  })
})

describe('e2e-synthetic.mjs — S10 ⑤ 의 그려짐 단언(W1)', () => {
  const src = readFileSync('scripts/e2e-synthetic.mjs', 'utf8')
  it('주간 HTML 은 활성 영역 이름, WBS HTML 은 루트 항목 이름으로 확인하고 S10 판정이 그것을 요구한다', () => {
    expect(src).toMatch(/from\('project_areas'\)\.select\('name'\)\.eq\('project_id', proj\.id\)\.eq\('active', true\)/)
    expect(src).toMatch(/from\('wbs_items'\)\.select\('name'\)\.eq\('project_id', proj\.id\)\.is\('parent_id', null\)/)
    expect(src).toMatch(/renderedProof\(text, /)
    expect(src).toMatch(/s10Ok = \['R', 'C'\]\.every\(\(k\) => [^\n]*rendered\.every\(\(r\) => r\.ok\)/)
  })
})

describe('weekRowsHaveContent — S10 ② 의 빈 주차(과제 24 첫 실행에서 찾은 러너 결함)', () => {
  it('네 칸 가운데 trim 뒤 내용이 하나라도 있으면 참(앱 hasContent(ALL_CELLS) 와 같은 술어)', () => {
    const empty = { this_content: '', this_issue: ' ', next_content: '\n', next_issue: '' }
    expect(weekRowsHaveContent([empty, empty])).toBe(false)
    expect(weekRowsHaveContent([])).toBe(false)
    expect(weekRowsHaveContent([empty, { ...empty, next_issue: '이슈' }])).toBe(true)
  })
})

describe('e2e-synthetic.mjs — S10 ② 는 빈 주차를 앱의 400(내용 없음)으로 확인하고 출력 대상으로 세지 않는다', () => {
  const src = readFileSync('scripts/e2e-synthetic.mjs', 'utf8')
  it('주차 행의 네 칸을 읽어 내용 있는 주차만 PPT 200 을 기대하고, 빈 주차는 400 과 그 문구를 기록한다', () => {
    expect(src).toMatch(/from\('weekly_report_rows'\)\.select\('this_content, this_issue, next_content, next_issue'\)/)
    expect(src).toMatch(/weekRowsHaveContent\(/)
    expect(src).toContain("{ expect: 400 }")
    expect(src).toContain("'해당 주차에 작성된 내용이 없습니다'")
    expect(src).toMatch(/emptyWeeks/)
  })
})

describe('outlineExpandUnsupported — S10 ④ 펼침의 명시적 미지원(과제 24 둘째 실행에서 찾은 러너 결함)', () => {
  const MSG = '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다'
  it('저장 양식(saved)의 펼침이 400 과 그 문구일 때만 참', () => {
    expect(outlineExpandUnsupported('saved', 400, { error: MSG })).toBe(true)
  })
  it('표준 양식·다른 상태·다른 문구는 거짓 — 출력 실패로 남는다', () => {
    expect(outlineExpandUnsupported('standard', 400, { error: MSG })).toBe(false)
    expect(outlineExpandUnsupported('saved', 500, { error: MSG })).toBe(false)
    expect(outlineExpandUnsupported('saved', 400, { error: '양식보다 깊은 WBS' })).toBe(false)
    expect(outlineExpandUnsupported(null, 400, { error: MSG })).toBe(false)
  })
})

describe('e2e-synthetic.mjs — S10 ④ 펼침은 저장 아웃라인 양식이면 400 미지원을 확인해 기록한다', () => {
  const src = readFileSync('scripts/e2e-synthetic.mjs', 'utf8')
  it('접기의 X-Excel-Layout 을 읽고, 펼침은 200 또는 400 을 받아 미지원이면 unsupportedExports 에 적는다', () => {
    expect(src).toMatch(/headers\.get\('x-excel-layout'\)/)
    expect(src).toContain("{ expect: [200, 400] }")
    expect(src).toMatch(/outlineExpandUnsupported\(/)
    expect(src).toMatch(/unsupportedExports/)
  })
})
