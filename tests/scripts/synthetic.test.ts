import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  PENDING_STEPS, SYNTHETIC_C, SYNTHETIC_R, SYNTHETIC_WORKSPACE_B, areaView, expectedAreas, expectedTeams, renderedProof, teamView, wbsRows, weekRowsHaveContent, outlineExpandUnsupported,
  expectedStoredCalendar, leafNamesOf,
} from '../../scripts/lib/synthetic.mjs'
import { TEMPLATE_HEADER } from '../../scripts/lib/e2e.mjs'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'
import { SYNTHETIC_TEAMS } from '../fixtures/synthetic/teams'
import { SYNTHETIC_WEEKLY_AREAS } from '../fixtures/synthetic/areas'
import { findSentinels, LEGACY_SENTINELS } from '../fixtures/legacy-sentinels'
import { sp4Sentinels, sp5b1Sentinels } from '../../scripts/lib/sentinels.mjs'
import { parseIdPolicy } from '@/lib/issues/idPolicy'

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
    expect(plain(SYNTHETIC_R.calendar)).toEqual(plain(research.calendar))
    expect(plain(SYNTHETIC_C.calendar)).toEqual(plain(construction.calendar))
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
  it('아직 켜지지 않은 단계는 S3·S6·S7·S8·S10(나머지)이고 담당 SP 가 적혀 있다 — SP5 A 가 S4(일)·S5 를 켰다(D43)', () => {
    expect(Object.keys(PENDING_STEPS)).toEqual(['S3', 'S6', 'S7', 'S8', 'S10'])
    expect(PENDING_STEPS.S6).toBe('SP5b(표시 상태)')
    expect(PENDING_STEPS.S10).toBe('SP6~SP8(나머지 부분 집합)')
    for (const owner of Object.values(PENDING_STEPS)) expect(String(owner)).toMatch(/^SP/)
  })
  it('C 만 월요일 주 시작 규칙(SP5 D28) — S1-calendar 가 설정 액션으로 주차 문서(S4(월))보다 먼저 쓴다(과제 30 이 calendar 블록으로 옮겼다)', () => {
    expect('weekStart' in SYNTHETIC_C).toBe(false)
    expect(SYNTHETIC_C.calendar.project['calendar.week_start']).toBe('monday')
    expect(SYNTHETIC_R.calendar.project['calendar.week_start']).toBe('sunday')
    const src = readFileSync('scripts/e2e-synthetic.mjs', 'utf8')
    expect(src).not.toContain('SYNTHETIC_C.weekStart')
    expect(src.indexOf("step('S1-calendar'")).toBeLessThan(src.indexOf("'createWeeklyReport', [C.id"))
  })
})

describe('S1-issues 합성 — R 영역별·C 연도별 발급 구성', () => {
  it('R 은 옛 출력 센티널과 겹치지 않는 코드·이름 10개, C 는 영역 없이 두 정책 모두 파서 검증을 통과한다', () => {
    expect(SYNTHETIC_R.issues.areas).toHaveLength(10)
    expect(new Set(SYNTHETIC_R.issues.areas.map((a: { code: string }) => a.code)).size).toBe(10)
    expect(SYNTHETIC_R.issues.areas.every((a: { code: string }) => /^[A-Z0-9]{1,8}$/.test(a.code))).toBe(true)
    const outputSentinels = [...sp4Sentinels(), ...sp5b1Sentinels()]
    expect(SYNTHETIC_R.issues.areas.flatMap((a: { name: string }) => findSentinels(a.name, outputSentinels))).toEqual([])
    expect(SYNTHETIC_R.issues.areas.some((a: { name: string }) => (LEGACY_SENTINELS.issueAreas as readonly string[]).includes(a.name))).toBe(false)
    expect(SYNTHETIC_C.issues.areas).toEqual([])
    expect(parseIdPolicy(SYNTHETIC_R.issues.idPolicy)).toMatchObject({ ok: true })
    expect(parseIdPolicy(SYNTHETIC_C.issues.idPolicy)).toMatchObject({ ok: true })
  })
  it('R·C 워크스페이스가 이슈 등록을 허용하되 분석 모듈은 부트스트랩 기본값에 맡긴다', () => {
    for (const def of [SYNTHETIC_R, SYNTHETIC_C]) {
      expect(def.config.workspace['modules.allowed']).toContain('issues')
      expect(def.config.workspace['modules.allowed']).not.toContain('issue_analysis')
      expect(def.config.project['modules.enabled']).not.toContain('issue_analysis')
    }
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
  it('단계 순서 — 이슈 구성 S1 과 발급 S6 이 캘린더 이후·S10 앞에 돈다', () => {
    const at = (n: string) => src.indexOf(`step('${n}'`)
    const order = ['S1-create', 'S1-teams-areas', 'S1-calendar', 'S1-issues', 'S9-isolation', 'S2-wbs-import', 'S4-weekly-monday', 'S4-weekly-sunday',
      'S5-calendar', 'S6-issue-codes', 'S10-negative', 'boundary-sp4']
    for (const n of order) expect(at(n), n).toBeGreaterThan(-1)
    for (let i = 1; i < order.length; i++) expect(at(order[i - 1]), `${order[i - 1]} < ${order[i]}`).toBeLessThan(at(order[i]))
    expect(at('boundary-sp4')).toBeLessThan(src.indexOf('Object.entries(PENDING_STEPS)'))
  })
  it('달력 쓰기는 화면과 같은 서버 액션 — 일정 화면 둘(addHoliday·setBaseDate), 달력·설정 표를 service_role 로 쓰지 않는다, 서울 관용구 0', () => {
    for (const [name, worker] of [['addHoliday', '/p/[projectId]/settings/page'], ['setBaseDate', '/p/[projectId]/settings/page']] as const) {
      expect(src, name).toMatch(new RegExp(`${name}: \\{[^}]*exportedName: '${name}', worker: '${esc(worker)}'`))
    }
    expect(src).not.toMatch(/svc\.from\('(?:holidays|project_settings|workspace_settings|projects)'\)\.(?:insert|update|upsert)/)
    expect(src).not.toMatch(/seoulToday|isMondayIso/)
    expect(src).toMatch(/sp5aSentinels\(\)/)
  })
  it('S10 은 이슈 화면까지 포함하고 SP5 B1 센티널과 교차 프로젝트를 본다(스펙 §6.4)', () => {
    for (const needle of ["source=sheet&format=pptx", "format=xlsx", "format=pptx", "/api/export?projectId=", "&expand=1", "/api/import/inspect", "/weekly`", "/wbs`"]) {
      expect(src, needle).toContain(needle)
    }
    expect(src).toMatch(/excludeRegistered\(sp4Sentinels\(\)/)
    expect(src).toMatch(/excludeRegistered\(sp5b1Sentinels\(\)/)
    expect(src).toContain("['issues', `/p/${proj.id}/issues`]")
    expect(src).toMatch(/S10 영역 이름[\s\S]*?\.eq\('kind', 'weekly_section'\)/)
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
  it('이슈 정책·이슈 영역·등록은 설정과 이슈 화면의 서버 액션을 거친다', () => {
    for (const [name, worker] of [
      ['updateProjectSettings', '/p/[projectId]/settings/page'], ['upsertArea', '/p/[projectId]/settings/page'],
      ['createIssue', '/p/[projectId]/issues/page'],
    ] as const) expect(src, name).toMatch(new RegExp(`${name}: \\{[^}]*exportedName: '${name}', worker: '${esc(worker)}'`))
    expect(src).toContain("set: { 'issues.id_policy': def.issues.idPolicy }")
    expect(src).toContain("kind: 'issue_area'")
    expect(src).toContain('code_scope')
    expect(src).toContain('CN-${cToday.slice(0, 4)}-0001')
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
    expect(src).toMatch(/from\('project_areas'\)\.select\('name'\)\.eq\('project_id', proj\.id\)[\s\S]*?\.eq\('kind', 'weekly_section'\)\.eq\('active', true\)/)
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

describe('S1·S5 달력(SP5 A — 개정 §6.5.8 R·C 구성표)', () => {
  it('R 은 LA·월~금·일요일, C 는 베를린·월~토·월요일 + 토요일 휴무 하나·일요일 근무 하나', () => {
    expect(plain(SYNTHETIC_R.calendar.project)).toEqual({ 'calendar.timezone': 'America/Los_Angeles', 'calendar.working_days': [1, 2, 3, 4, 5], 'calendar.week_start': 'sunday' })
    expect(plain(SYNTHETIC_C.calendar.project)).toEqual({ 'calendar.timezone': 'Europe/Berlin', 'calendar.working_days': [1, 2, 3, 4, 5, 6], 'calendar.week_start': 'monday' })
    expect(SYNTHETIC_C.calendar.holidays.map((h: { date: string; kind: string }) => [h.date, h.kind])).toEqual([['2026-10-10', 'off'], ['2026-10-25', 'work']])
    expect(new Date('2026-10-10T00:00:00Z').getUTCDay()).toBe(6)
    expect(new Date('2026-10-25T00:00:00Z').getUTCDay()).toBe(0)
  })
  it('예외 날짜가 S2 잎의 기간 안에 있다 — 잎 A 10/05~10/16 에 휴무, 잎 B 10/19~10/30 에 근무', () => {
    const [off, work] = SYNTHETIC_C.calendar.holidays
    expect(off.date >= '2026-10-05' && off.date <= '2026-10-16').toBe(true)
    expect(work.date >= '2026-10-19' && work.date <= '2026-10-30').toBe(true)
    const leaves = wbsRows(3, ['CIV', 'MEP']).filter((r) => r[6] === 0.5)
    expect(leaves.map((r) => [r[4], r[5]])).toEqual([['2026-10-05', '2026-10-16'], ['2026-10-19', '2026-10-30']])
  })
  it('기대 계획% — R 60·60, C 60·67(근무일 수를 손으로 센 값)', () => {
    expect(plain(SYNTHETIC_R.calendar.plannedPct)).toEqual({ '2026-10-12': { A: 60 }, '2026-10-26': { B: 60 } })
    expect(plain(SYNTHETIC_C.calendar.plannedPct)).toEqual({ '2026-10-12': { A: 60 }, '2026-10-26': { B: 67 } })
  })
  it('expectedStoredCalendar — 프로젝트 week_start 만 규칙 목록으로(문서 0건이라 교체), 나머지는 입력 그대로', () => {
    expect(expectedStoredCalendar('project', SYNTHETIC_C.calendar.project)).toEqual({
      'calendar.timezone': 'Europe/Berlin', 'calendar.working_days': [1, 2, 3, 4, 5, 6], 'calendar.week_start': [{ day: 'monday', from: null }],
    })
    expect(expectedStoredCalendar('workspace', SYNTHETIC_C.calendar.workspace)).toEqual(plain(SYNTHETIC_C.calendar.workspace))
  })
  it('leafNamesOf — wbsRows 의 잎 둘 이름(R 4단·C 3단)', () => {
    expect(leafNamesOf(4)).toEqual(['합성 1.1.1.1', '합성 1.1.1.2'])
    expect(leafNamesOf(3)).toEqual(['합성 1.1.1', '합성 1.1.2'])
  })
})
