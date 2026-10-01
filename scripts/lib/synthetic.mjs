// scripts/lib/synthetic.mjs — 합성 게이트(e2e-synthetic.mjs)의 구성값과 순수 도우미. .mjs 는 tests/fixtures/synthetic/{configs,teams,areas}.ts 를
// import 하지 못해 한 번 더 적고, tests/scripts/synthetic.test.ts 가 같은 값인지 대조한다(드리프트 방지). 고객 이름·실명 없음.
import { sp4Sentinels } from './sentinels.mjs'

/** C 의 셋째 영역(QUAL) 이름 — 옛 11구분명의 다섯째와 같은 낱말이다(스펙 D8·E9 — S10 이 등록 이름으로 센티널에서 뺀다). 평문은 센티널
 *  픽스처 하나에 두므로(계획 P6) base64 사본의 다섯째 값을 쓴다 — tests/scripts/synthetic.test.ts 가 픽스처(areas.ts)의 이름과 대조한다 */
const QUALITY = sp4Sentinels()[4]

/** 주간 영역 정의 — code·이름·순서·담당 팀 [팀 code, 'primary'|'support'] @param {string} code @param {string} name @param {number} sortOrder @param {string[][]} teams */
const area = (code, name, sortOrder, teams) =>
  Object.freeze({ code, name, sortOrder, teams: Object.freeze(teams.map((t) => Object.freeze([...t]))) })

export const SYNTHETIC_R = Object.freeze({
  slug: 'syn-r', name: '합성 연구 과제',
  config: Object.freeze({
    id: 'research',
    project: Object.freeze({
      'core.level_labels': Object.freeze(['과제', '세부과제', '연구항목', '실험']),
      'modules.enabled': Object.freeze(['meetings', 'weekly', 'issues', 'wiki']),
      'core.milestone_keywords': Object.freeze(['중간보고', '최종보고', 'milestone']),
      'workflow.stage_credits': Object.freeze({ default: Object.freeze({ as: 0, ip: 20, rw: 30, im: 90, xx: 100 }) }),
    }),
    workspace: Object.freeze({ 'modules.allowed': Object.freeze(['meetings', 'weekly', 'issues', 'wiki', 'minutes', 'portfolio']) }),
  }),
  // SP4 A1(스펙 §6.4 S1·D40) — 팀(addProjectTeam)과 주간 영역·담당 팀(upsertArea). tests/fixtures/synthetic/{teams,areas}.ts 와 같은 값
  teams: Object.freeze(['RES', 'OPS']),
  weeklyAreas: Object.freeze([
    area('EXP', '실험', 1, [['RES', 'primary']]),
    area('DATA', '데이터', 2, [['RES', 'primary'], ['OPS', 'support']]),
    area('RUN', '운영', 3, [['OPS', 'primary']]),
  ]),
})

export const SYNTHETIC_C = Object.freeze({
  slug: 'syn-c', name: '합성 건설 현장',
  config: Object.freeze({
    id: 'construction',
    project: Object.freeze({
      'core.level_labels': Object.freeze(['공구', '공종', '작업']),
      'modules.enabled': Object.freeze(['kanban', 'weekly', 'announcements', 'attendance', 'issues', 'wiki']),
      'core.milestone_keywords': Object.freeze([]),
      'workflow.stage_credits': Object.freeze({ default: Object.freeze({ as: 0, ip: 10, rw: 20, im: 80, xx: 100 }) }),
    }),
    workspace: Object.freeze({ 'modules.allowed': Object.freeze(['kanban', 'weekly', 'announcements', 'attendance', 'issues', 'wiki', 'minutes', 'usage']), 'ai.enabled': false }),
  }),
  teams: Object.freeze(['CIV', 'MEP', 'SAF']),
  weeklyAreas: Object.freeze([
    area('WORK', '공정', 1, [['CIV', 'primary']]),
    area('SAFE', '안전', 2, [['SAF', 'primary']]),
    area('QUAL', QUALITY, 3, [['MEP', 'primary']]),
    area('MATL', '자재', 4, [['MEP', 'support']]),
  ]),
})

/** 격리 시험의 '다른 워크스페이스' — R·C 의 설정을 읽을 수 없어야 한다 */
export const SYNTHETIC_WORKSPACE_B = Object.freeze({ slug: 'syn-b', name: '합성 타 워크스페이스' })

/** 아직 켜지지 않은 단계 → 켜는 SP(개정 §6.5.8, 스펙 D25·SP4 §6.4). 건너뜀으로 세지 않고 '미활성'으로 기록한다.
 *  SP4 A1 이 S2 와 S4 의 월요일 키를 켰다 — S4 에 남은 것은 R 의 일요일 키(SP5)다. S10 은 SP4 A2 가 SP4 부분(11구분명·5팀 코드)을 켰다 — 나머지 부분 집합은 SP5~SP8 */
export const PENDING_STEPS = Object.freeze({
  S3: 'SP5b·SP5c', S4: 'SP5(일)', S5: 'SP5', S6: 'SP5·SP5b', S7: 'SP8(봇)·SPU1(개인 알림)', S8: 'SP6', S10: 'SP5~SP8(나머지 부분 집합)',
})

/**
 * S2 가져오기 행(양식 머리 TEMPLATE_HEADER 순서) — depth 단 경로 하나 + 마지막 단의 잎 둘. 담당은 잎에만 팀 code(첫 팀·둘째 팀), 부모 기간은
 * 자식을 덮고 형제 가중치 합 1. 깊이 = 그 프로젝트의 단계 이름 수여야 양식 저장의 교차 검증을 지난다(R 4·C 3).
 * @param {number} depth @param {readonly string[]} teams @returns {Array<Array<string | number>>}
 */
export function wbsRows(depth, teams) {
  if (!Number.isInteger(depth) || depth < 2) throw new Error(`계층 깊이가 올바르지 않다: ${depth}`)
  if (!teams.length) throw new Error('담당 팀이 없다')
  const rows = []
  let code = ''
  for (let d = 1; d < depth; d++) {
    code = code ? `${code}.1` : '1'
    rows.push([code, `합성 ${code}`, '', '', '2026-10-05', '2026-10-30', 1, '', ''])
  }
  rows.push([`${code}.1`, `합성 ${code}.1`, '', '산출물 A', '2026-10-05', '2026-10-16', 0.5, '', teams[0]])
  rows.push([`${code}.2`, `합성 ${code}.2`, '', '산출물 B', '2026-10-19', '2026-10-30', 0.5, '', teams[1 % teams.length]])
  return rows
}

/**
 * S10 ⑤ 화면 HTML 이 실제로 그 프로젝트의 내용을 그렸는지 — 기대 이름(주간 = 활성 영역 이름, WBS = 루트 항목 이름)이 모두 본문에 있어야 ok.
 * 권한 없음·모듈 꺼짐·빈 화면이 200 으로 와도 센티널 0 이면 초록이던 틈을 닫는다(A2-4 리뷰 P3-2). 기대 이름이 없으면 판정할 수 없어 실패다.
 * @param {string} text @param {readonly string[]} names @returns {{ ok: boolean, found: string[], missing: string[] }}
 */
export function renderedProof(text, names) {
  const want = names.map((n) => String(n ?? '').trim()).filter(Boolean)
  const found = want.filter((n) => text.includes(n))
  const missing = want.filter((n) => !text.includes(n))
  return { ok: want.length > 0 && missing.length === 0, found, missing }
}

/**
 * 주간 문서 행(weekly_report_rows 네 칸, snake) 가운데 내용이 있는가 — 앱 hasContent(row, ALL_CELLS)(src/lib/domain/weeklySheet.ts)와 같은 술어.
 * 시트 PPT 는 내용 없는 주차에 400 '해당 주차에 작성된 내용이 없습니다' 를 돌려준다(SP0 부터의 동작) — S10 ② 가 그 주차를 가른다.
 * @param {ReadonlyArray<Record<string, string | null>>} rows @returns {boolean}
 */
export function weekRowsHaveContent(rows) {
  return rows.some((r) => ['this_content', 'this_issue', 'next_content', 'next_issue'].some((c) => String(r[c] ?? '').trim() !== ''))
}

/** addProjectTeam 이 만든 팀의 기대 모양 — 이름은 code 와 같고(개명은 A2·B — D37) 순서는 0부터 만든 순 @param {readonly string[]} codes */
export function expectedTeams(codes) {
  return codes.map((code, i) => ({ code, name: code, sortOrder: i, active: true }))
}

/** teams 조회 행 → expectedTeams 와 같은 모양(sort_order 순) @param {ReadonlyArray<Record<string, any>>} rows */
export function teamView(rows) {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order).map((t) => ({ code: t.code, name: t.name, sortOrder: t.sort_order, active: t.active }))
}

const byFirst = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

/** 주간 영역 정의 → 다시 읽기 비교 모양(활성, 담당 팀 [code, 종류] 를 code 순) @param {ReadonlyArray<{ code: string, name: string, sortOrder: number, teams: ReadonlyArray<ReadonlyArray<string>> }>} defs */
export function expectedAreas(defs) {
  return defs.map((a) => ({ code: a.code, name: a.name, sortOrder: a.sortOrder, active: true, teams: a.teams.map(([c, k]) => [c, k]).sort(byFirst) }))
}

/**
 * project_areas(+ area_teams(team_id, kind)) 조회 행 → expectedAreas 와 같은 모양(sort_order·code 순). 모르는 팀 id 는 '?<id>' 로 남겨 비교가
 * 실패하게 한다 @param {ReadonlyArray<Record<string, any>>} rows @param {ReadonlyMap<string, string>} teamCodeById
 */
export function areaView(rows, teamCodeById) {
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((a) => ({
      code: a.code, name: a.name, sortOrder: a.sort_order, active: a.active,
      teams: (a.area_teams ?? []).map((t) => [teamCodeById.get(t.team_id) ?? `?${t.team_id}`, t.kind]).sort(byFirst),
    }))
}
