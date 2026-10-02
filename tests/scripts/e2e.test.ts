import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  INVITEE, LEVEL_LABELS, SP1_TEAMS, TEMPLATE_HEADER, TRACE_WORDS, actionResult, cookieHeader, dispositionFilename,
  COPY_LEVEL_LABELS, e2eBaseUrl, e2eRows, encodeActionArgs, findActionId, findTraces, inviteInput, inviteTokenFromUrl, leafCodes, localAppUrl,
  localClientEnv, meetingInput, notFoundRendered, pageProblems, rosterPlan, rosterView, signupInput, teamIdsByCode, toCell,
  ERR_DENIED, ERR_MODULE_DISABLED, PAGE_MARKERS, redactInviteTokens, streamedErrorDigests,
  A_ADMIN, B_ADMIN, OUTSIDER, WS_TEAM, OTHER_WORKSPACE, inWorkspaceStorage, leakedIds, minuteBodyPath, minuteInput, minuteSource,
  presentTexts, workspaceAdminAccountInput,
} from '../../scripts/lib/e2e.mjs'
import { makeStoragePath, parseStoragePath } from '@/lib/domain/storagePath'
import { isMinuteFilePathValid, validateMinuteFields } from '@/lib/domain/minutes'
import { isValidEmail } from '@/lib/domain/validate'
import { ERR_DENIED as APP_ERR_DENIED, ERR_MODULE_DISABLED as APP_ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { FORBIDDEN_REFS } from '../../scripts/lib/targets.mjs'
import { TEMPLATE_HEADER as APP_TEMPLATE_HEADER } from '@/lib/excel/template'
import { MEETING_CATEGORIES, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { isInviteToken, validateSignupInput } from '@/lib/domain/invites'
import { normalizeNewTeamCode } from '@/lib/domain/teams'
import { EXCEL_HEADER_WORDS } from '@/lib/excel/headerWords'
import { settingDef } from '@/lib/settings/registry'
import ExcelJS from 'exceljs'
import { buildWbsTemplateWorkbook } from '@/lib/excel/template'
import { weekKeyOf, weekLabelOf } from '@/lib/domain/calendar'
import { validateArea, type AreaInput } from '@/lib/domain/areas'
import {
  XLSX_MIME, areaInput, fillWbsWorkbook, importForm, importResultView, inspectForm, shiftDays,
  dowOfIso, nextDowOnOrAfter, plainWeekLabel, plannedPctByName, rangeText, storedTimezone, todayInTz,
} from '../../scripts/lib/e2e.mjs'
import { carryOverRows } from '@/lib/domain/weeklyCarry'
import { LEGACY_SENTINELS, SENTINELS_BY_SP } from '../fixtures/legacy-sentinels'
import { excludeRegistered, findSentinels, sp4Sentinels } from '../../scripts/lib/sentinels.mjs'
import {
  A2_TEAM, E2E_AREAS, REGISTERED_AREA, UNREGISTERED_TEAM, carriedText, nextServerMode, pptText, sentinelReport, slideCount, teamRefs,
} from '../../scripts/lib/e2e.mjs'
import {
  DUO, SP3B_B_TEAM, SWITCHER_MARK, expectLocation, hiddenVerdict, issuesLinkVerdict, legacyCases, shellBadgeVerdict, switcherVerdict,
} from '../../scripts/lib/e2e.mjs'

const LOCAL_ENV = 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=anon\n'

describe('양식 행', () => {
  it('헤더는 앱 양식과 같다(드리프트 감지)', () => {
    expect(TEMPLATE_HEADER).toEqual([...APP_TEMPLATE_HEADER])
  })
  it('아웃라인 깊이 = 단계 라벨 수, 담당은 말단에만, 형제 가중치 합 1', () => {
    const rows = e2eRows('팀A')
    const codes = rows.map((r) => r[0] as string)
    const isLeaf = (c: string) => !codes.some((o) => o.startsWith(`${c}.`))
    expect(Math.max(...codes.map((c) => c.split('.').length))).toBe(LEVEL_LABELS.length)
    for (const r of rows) expect(r[8]).toBe(isLeaf(r[0] as string) ? '팀A' : '')
    const parentOf = (c: string) => c.split('.').slice(0, -1).join('.')
    const sums = new Map<string, number>()
    for (const r of rows) sums.set(parentOf(r[0] as string), (sums.get(parentOf(r[0] as string)) ?? 0) + (r[6] as number))
    for (const s of sums.values()) expect(s).toBeCloseTo(1)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.length).toBeLessThanOrEqual(5)
  })
})

describe('toCell', () => {
  it("'' → null, 날짜 → UTC 정오, 나머지는 그대로", () => {
    expect(toCell('')).toBeNull()
    expect((toCell('2026-09-21') as Date).toISOString()).toBe('2026-09-21T12:00:00.000Z')
    expect(toCell('1.1')).toBe('1.1')
    expect(toCell(0.5)).toBe(0.5)
    expect(toCell('2026-9-21')).toBe('2026-9-21')
  })
})

describe('localClientEnv — 로컬 .env.local 만', () => {
  it('로컬이면 URL·anon 키', () => {
    expect(localClientEnv(LOCAL_ENV)).toEqual({ url: 'http://127.0.0.1:54321', anonKey: 'anon' })
  })
  it('로컬이 아니거나 금지 좌표·중복·누락이면 throw', () => {
    expect(() => localClientEnv('NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\n')).toThrow(/로컬/)
    expect(() => localClientEnv(`NEXT_PUBLIC_SUPABASE_URL=https://${FORBIDDEN_REFS[0]}.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=a\n`)).toThrow(/forbidden/)
    expect(() => localClientEnv(`${LOCAL_ENV}NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\n`)).toThrow(/두 번/)
    expect(() => localClientEnv('NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\n')).toThrow(/ANON_KEY/)
    expect(() => localClientEnv('')).toThrow(/로컬/)
  })
})

describe('localAppUrl', () => {
  it('로컬 주소만, 끝 슬래시 제거', () => {
    expect(localAppUrl('http://localhost:3001/')).toBe('http://localhost:3001')
    expect(localAppUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(() => localAppUrl('https://example.vercel.app')).toThrow(/로컬/)
    expect(() => localAppUrl('')).toThrow(/로컬/)
  })
})

describe('e2eBaseUrl', () => {
  it('기본 3101 을 받고 3000 은 거부한다(스크래치 워크트리 규칙)', () => {
    expect(e2eBaseUrl('http://localhost:3101')).toBe('http://localhost:3101')
    expect(() => e2eBaseUrl('http://localhost:3000')).toThrow(/3101/)
    expect(() => e2eBaseUrl('https://example.vercel.app')).toThrow(/로컬/)
  })
})

describe('cookieHeader', () => {
  it('이름=값 을 ; 로 잇고 빈 값은 뺀다', () => {
    expect(cookieHeader([{ name: 'a', value: '1' }, { name: 'b', value: '' }, { name: 'c', value: 'x-y' }])).toBe('a=1; c=x-y')
  })
})

describe('findActionId — 정확히 하나만', () => {
  const entry = (filename: string, exportedName: string, worker = 'app/(app)/projects/page') =>
    ({ workers: { [worker]: { moduleId: '', async: true } }, layer: { [worker]: 'rsc' }, filename, exportedName })
  it('src/ 접두 유무와 무관하게 찾고 worker 목록을 준다', () => {
    const manifest = { node: { aa: entry('app/actions/project.ts', 'listProjects'), bb: entry('app/actions/project.ts', 'createProject') }, edge: {} }
    expect(findActionId(manifest, { filename: 'src/app/actions/project.ts', exportedName: 'createProject' }))
      .toEqual({ id: 'bb', workers: ['app/(app)/projects/page'] })
  })
  it('0건·2건·매니페스트 없음은 throw', () => {
    const one = { node: { aa: entry('app/actions/project.ts', 'createProject') } }
    const two = { node: { aa: entry('app/actions/project.ts', 'createProject') }, edge: { bb: entry('app/actions/project.ts', 'createProject') } }
    expect(() => findActionId(one, { filename: 'src/app/actions/teams.ts', exportedName: 'createProject' })).toThrow(/0건/)
    expect(() => findActionId(two, { filename: 'src/app/actions/project.ts', exportedName: 'createProject' })).toThrow(/2건/)
    expect(() => findActionId(undefined, { filename: 'x', exportedName: 'y' })).toThrow(/0건/)
  })
})

describe('dispositionFilename', () => {
  it('filename* 우선·디코드, 없으면 filename, 둘 다 없으면 대체값', () => {
    const star = `attachment; filename="report.pptx"; filename*=UTF-8''${encodeURIComponent('샘플_9월4주차.pptx')}`
    expect(dispositionFilename(star, 'x')).toBe('샘플_9월4주차.pptx')
    expect(dispositionFilename('attachment; filename="report.xlsx"', 'x')).toBe('report.xlsx')
    expect(dispositionFilename(null, 'fallback.bin')).toBe('fallback.bin')
    expect(dispositionFilename("attachment; filename=\"a.pptx\"; filename*=UTF-8''%E0%A4%A", 'x')).toBe('a.pptx')
  })
  it('경로 구분자는 무해화', () => {
    expect(dispositionFilename(`attachment; filename*=UTF-8''${encodeURIComponent('../a/b\\c.xlsx')}`, 'x')).toBe('.._a_b_c.xlsx')
  })
})

describe('findTraces', () => {
  it('목록의 모든 낱말을 대소문자 무시로 잡는다', () => {
    expect(TRACE_WORDS).toHaveLength(28)
    for (const w of TRACE_WORDS) {
      expect(findTraces([{ name: 'x.xml', text: `앞 ${w.toUpperCase()} 뒤` }]), w).toEqual([{ name: 'x.xml', matches: [w.toUpperCase()] }])
      expect(findTraces([{ name: 'x.xml', text: `<a>${w}</a>` }]), w).toHaveLength(1)
    }
  })
  it('제품명·중립 문구는 적중하지 않는다', () => {
    expect(findTraces([{ name: 'a.xml', text: 'D-Flow 주간보고 · 운영 팀 · Acme Project · example.com' }])).toEqual([])
  })
  it('이 검사기 자신(러너·순수 조각·이 테스트)의 원문에 흔적이 없다', () => {
    const files = ['scripts/lib/e2e.mjs', 'scripts/e2e-local.mjs', 'tests/scripts/e2e.test.ts']
    expect(findTraces(files.map((name) => ({ name, text: readFileSync(name, 'utf8') })))).toEqual([])
  })
})

// ── SP1 흐름(다중 팀·외부 인력·초대 수락·존재 은닉)의 입력 조립·응답 해석 ─────────────────────────

describe('encodeActionArgs — React encodeReply 의 평문 규칙', () => {
  it('JSON 배열로 싣고 $ 로 시작하는 문자열은 $$ 로 한 번 더 감싼다', () => {
    expect(encodeActionArgs(['p1', { name: 'bob', email: null, teamIds: [] }]))
      .toBe('["p1",{"name":"bob","email":null,"teamIds":[]}]')
    expect(encodeActionArgs(['$x', { a: '$$', b: 'a$' }, [true, 1.5]])).toBe('["$$x",{"a":"$$$","b":"a$"},[true,1.5]]')
  })
  it('undefined·Date·함수·NaN 처럼 서버가 다르게 읽을 값은 거절한다', () => {
    expect(() => encodeActionArgs([{ a: undefined }])).toThrow(/직렬화/)
    expect(() => encodeActionArgs([undefined])).toThrow(/직렬화/)
    expect(() => encodeActionArgs([new Date(0)])).toThrow(/직렬화/)
    expect(() => encodeActionArgs([() => 1])).toThrow(/직렬화/)
    expect(() => encodeActionArgs([Number.NaN])).toThrow(/직렬화/)
    expect(() => encodeActionArgs('x' as unknown as unknown[])).toThrow(/배열/)
  })
})

describe('actionResult — 서버 액션 Flight 응답에서 결과 값', () => {
  const root = (ref = '$@1') => `0:{"a":"${ref}","f":"","b":"development"}\n`
  it('루트 a 가 가리키는 행을 JSON 으로 돌려준다', () => {
    expect(actionResult(`${root()}1:{"ok":true,"memberId":"m1"}\n`)).toEqual({ ok: true, memberId: 'm1' })
    expect(actionResult(Buffer.from(`${root()}1:{"ok":false,"error":"권한 없음"}\n`))).toEqual({ ok: false, error: '권한 없음' })
  })
  it('반환 없음($undefined)·$$·$D·중첩 참조를 풀고 모르는 표기는 거절한다', () => {
    expect(actionResult(`${root()}1:"$undefined"\n`)).toBeUndefined()
    expect(actionResult(`${root()}1:{"a":"$$5","b":"$undefined","c":"$D2026-09-25T00:00:00.000Z","d":"$2"}\n2:[1,"x"]\n`))
      .toEqual({ a: '$5', b: undefined, c: '2026-09-25T00:00:00.000Z', d: [1, 'x'] })
    expect(() => actionResult(`${root()}1:{"a":"$Q2"}\n`)).toThrow(/Flight/)
    expect(() => actionResult(`${root()}1:{"a":"$9"}\n`)).toThrow(/행 9/)
  })
  it('T 행은 바이트 길이로 건너뛴다 — 본문 안의 줄바꿈·가짜 행에 속지 않는다', () => {
    const text = '한글\n1:{"ok":false}'
    const len = Buffer.byteLength(text).toString(16)
    const body = `0:{"a":"$@1","f":"$3","b":"x"}\n3:T${len},${text}:HL["/a.css","style"]\n2:I["x",[],"y"]\n1:{"ok":true}\n`
    expect(actionResult(body)).toEqual({ ok: true })
  })
  it('액션이 던진 오류(E 행)는 그 메시지로 throw', () => {
    expect(() => actionResult(`${root()}1:E{"digest":"1","message":"단계 입력이 올바르지 않습니다."}\n`)).toThrow(/단계 입력/)
  })
  it('서버 액션 응답이 아니면 throw', () => {
    expect(() => actionResult('')).toThrow(/서버 액션 응답/)
    expect(() => actionResult('0:{"b":"x","f":""}\n')).toThrow(/서버 액션 응답/)
    expect(() => actionResult('<!DOCTYPE html><html></html>')).toThrow(/Flight/)
    expect(() => actionResult(`${root()}`)).toThrow(/행 1/)
  })
})

describe('inviteTokenFromUrl — 초대 링크(발급 응답이 유일한 출처)에서 토큰', () => {
  const token = '0f8fad5b-d9cb-469f-a165-70867728950e'
  it('앱 주소와 같은 origin 의 /invite/<uuid> 만', () => {
    expect(inviteTokenFromUrl(`http://localhost:3000/invite/${token}`, 'http://localhost:3000')).toBe(token)
    expect(isInviteToken(inviteTokenFromUrl(`http://localhost:3000/invite/${token}`, 'http://localhost:3000'))).toBe(true)
  })
  it('다른 origin·다른 경로·토큰 모양이 아니면 throw', () => {
    expect(() => inviteTokenFromUrl(`https://example.com/invite/${token}`, 'http://localhost:3000')).toThrow(/origin/)
    expect(() => inviteTokenFromUrl(`http://localhost:3000/p/${token}`, 'http://localhost:3000')).toThrow(/초대 링크/)
    expect(() => inviteTokenFromUrl('http://localhost:3000/invite/abc', 'http://localhost:3000')).toThrow(/초대 링크/)
    expect(() => inviteTokenFromUrl(null, 'http://localhost:3000')).toThrow(/초대 링크/)
  })
})

describe('SP1 팀', () => {
  it('A 는 두 팀(다중 팀 명단), B 는 한 팀이고 전부 새 팀 코드 규칙을 통과한다', () => {
    expect(SP1_TEAMS.A).toHaveLength(2)
    expect(SP1_TEAMS.B).toHaveLength(1)
    for (const code of [...SP1_TEAMS.A, ...SP1_TEAMS.B]) expect(normalizeNewTeamCode(code, EXCEL_HEADER_WORDS)).toEqual({ ok: true, code })
  })
  it('teamIdsByCode — 그 프로젝트 행에서 코드 순서대로 id, 없거나 겹치면 throw', () => {
    const rows = [
      { id: 't1', code: 'ERP', project_id: 'A' }, { id: 't2', code: 'MES', project_id: 'A' },
      { id: 't3', code: 'ERP', project_id: 'B' }, { id: 't4', code: 'QA', project_id: 'B' },
    ]
    expect(teamIdsByCode(rows, 'A', ['MES', 'ERP'])).toEqual(['t2', 't1'])
    expect(teamIdsByCode(rows, 'B', ['QA'])).toEqual(['t4'])
    expect(() => teamIdsByCode(rows, 'A', ['QA'])).toThrow(/QA/)
    expect(() => teamIdsByCode([...rows, { id: 't5', code: 'ERP', project_id: 'A' }], 'A', ['ERP'])).toThrow(/2건/)
  })
})

describe('rosterPlan — upsertRosterMember 입력 셋', () => {
  const plan = rosterPlan({ selfName: 'admin', selfEmail: ' Admin@Example.com ', teamIds: { A: ['erp', 'mes'], B: ['qa'] } })
  it('본인@A 는 관리자·[ERP, MES](첫 팀이 대표), 본인@B 는 멤버·[QA]', () => {
    expect(plan.selfA).toMatchObject({ name: 'admin', email: 'admin@example.com', accessRole: 'admin', teamIds: ['erp', 'mes'] })
    expect(plan.selfB).toMatchObject({ name: 'admin', email: 'admin@example.com', accessRole: 'member', teamIds: ['qa'] })
  })
  it('외부 인력 bob 은 이메일·권한·팀 없이 명단에만 오른다', () => {
    expect(plan.bob).toEqual({ name: 'bob', email: null, accessRole: null, roleLabel: '외부 개발', title: null, teamIds: [] })
  })
  it('서버 액션 인자로 그대로 실린다(undefined 없음)', () => {
    for (const input of Object.values(plan)) expect(() => encodeActionArgs(['pid', input])).not.toThrow()
  })
})

describe('rosterView — 명단 조회 행 정규화', () => {
  it('인물·팀 임베드를 펴고 대표 팀을 앞에, 이름순으로', () => {
    const rows = [
      {
        id: 'm2', access_role: 'admin', people: { display_name: 'admin', email: 'admin@example.com', user_id: 'u1' },
        project_member_teams: [{ is_primary: false, teams: { code: 'MES' } }, { is_primary: true, teams: [{ code: 'ERP' }] }],
      },
      { id: 'm1', access_role: null, people: [{ display_name: 'bob', email: null, user_id: null }], project_member_teams: [] },
    ]
    expect(rosterView(rows)).toEqual([
      { memberId: 'm2', name: 'admin', email: 'admin@example.com', accessRole: 'admin', linked: true, teams: ['ERP', 'MES'] },
      { memberId: 'm1', name: 'bob', email: null, accessRole: null, linked: false, teams: [] },
    ])
  })
  it('인물 임베드가 없으면 throw — 명단 행이 인물 없이 보이면 조회가 틀렸다', () => {
    expect(() => rosterView([{ id: 'm1', access_role: null, people: null, project_member_teams: [] }])).toThrow(/m1/)
  })
})

describe('leafCodes', () => {
  it('자식이 없는 코드만 — 담당은 리프에', () => {
    expect(leafCodes(e2eRows('ERP'))).toEqual(['1.1.1', '1.2.1'])
  })
})

describe('meetingInput·inviteInput·signupInput — 앱 검증 규칙과 드리프트 감지', () => {
  it('회의: 단발 킥오프, 참석자 그대로, 카테고리·반복은 앱 목록 안', () => {
    const m = meetingInput({ date: '2026-09-28', attendeeIds: ['bob'] })
    expect(m).toMatchObject({ meetingDate: '2026-09-28', recurrence: 'none', recurrenceUntil: null, attendeeIds: ['bob'] })
    expect(MEETING_CATEGORIES).toContain(m.category)
    expect(RECURRENCE_ORDER).toContain(m.recurrence)
    expect(m.startTime! < m.endTime!).toBe(true)
    expect(() => meetingInput({ date: '2026-9-28', attendeeIds: [] })).toThrow(/날짜/)
  })
  it('초대: carol@example.com 멤버, 팀은 받은 순서(첫 팀이 대표 후보)', () => {
    expect(inviteInput(['erp'])).toEqual({ email: INVITEE.email, accessRole: 'member', teamIds: ['erp'] })
    expect(INVITEE.email.endsWith('@example.com')).toBe(true)
  })
  it('초대: 받는 사람을 바꿀 수 있고 팀 없음(빈 배열)도 그대로 싣는다', () => {
    expect(inviteInput([], OUTSIDER.email)).toEqual({ email: OUTSIDER.email, accessRole: 'member', teamIds: [] })
  })
  it('가입: 이름·비밀번호·확인이 앱 가입 검증을 통과한다', () => {
    const s = signupInput(INVITEE.name, 'Carol-E2E-9f3a')
    expect(s).toEqual({ name: 'carol', password: 'Carol-E2E-9f3a', passwordConfirmation: 'Carol-E2E-9f3a' })
    expect(validateSignupInput(s)).toEqual({ ok: true })
  })
})

describe('pageProblems — 렌더된 HTML 의 오류 표식', () => {
  it('정상 화면은 빈 목록', () => {
    expect(pageProblems('<html><body><main id="main-content"><h1>WBS</h1></main></body></html>')).toEqual([])
  })
  it('열화 표시·오류 경계 문구·Next 오류 문서를 잡는다', () => {
    expect(pageProblems('<h1>화면을 불러오지 못했습니다</h1>')).toEqual(['error-boundary'])
    expect(pageProblems('<p>일부 정보를 불러오지 못했습니다</p>')).toEqual(['degraded'])
    expect(pageProblems('<html id="__next_error__"><body></body></html>')).toEqual(['next-error'])
  })
  it('있어야 할 데이터가 없으면 missing — 조회 실패를 빈 목록으로 삼키는 화면을 잡는다', () => {
    const html = '<main>E2E 킥오프 · bob</main>'
    expect(pageProblems(html, ['E2E 킥오프', 'bob'])).toEqual([])
    expect(pageProblems(html, ['carol', 'bob', '요구사항 정리'])).toEqual(['missing:carol', 'missing:요구사항 정리'])
    expect(pageProblems('<h1>화면을 불러오지 못했습니다</h1>', ['x'])).toEqual(['error-boundary', 'missing:x'])
  })
  it('열려야 하는 화면의 notFound 는 문제다', () => {
    expect(pageProblems('<script>self.__next_f.push([1,"e:{\\"digest\\":\\"NEXT_HTTP_ERROR_FALLBACK;404\\"}"])</script>')).toEqual(['not-found'])
  })
  it('스트리밍된 Flight 오류 행·data-dgst 를 digest 로 잡는다(문구 표식 없이도)', () => {
    expect(pageProblems('<script>self.__next_f.push([1,"31:E{\\"digest\\":\\"123\\",\\"name\\":\\"Error\\"}"])</script>')).toEqual(['error-digest:123'])
    expect(pageProblems('<div hidden id="S:0"><!--$!--><template data-dgst="456"></template></div>')).toEqual(['error-digest:456'])
  })
})

describe('streamedErrorDigests — 실측 화면(2026-09-26 로컬 캡처)', () => {
  // 로컬 dev 서버에서 PostgREST 컨테이너만 멈추고 관리자로 /p/<A>/wbs 를 받은 HTML(page-streamed-error)과, 되살린 뒤 같은 화면
  // (page-healthy). getComputedWbs 가 던져도 HTTP 는 200 이고 error.tsx 문구는 HTML 에 없다 — digest 만 남는다.
  // 캡처 뒤 세션 쿠키 값(base64-…)과 로컬 절대 경로를 가렸다.
  const fixture = (name: string) => gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString('utf8')
  it('서버 컴포넌트가 던진 화면: Flight 오류 행과 data-dgst 가 같은 digest, 오류 경계 문구는 없다', () => {
    const html = fixture('page-streamed-error.html.gz')
    expect(html).not.toContain('화면을 불러오지 못했습니다')
    expect(html).toContain('<template data-dgst="2570364813"')
    expect(streamedErrorDigests(html)).toEqual(['2570364813'])
    expect(pageProblems(html)).toContain('error-digest:2570364813')
  })
  it('정상 화면: 메타데이터 경계의 "digest":"$undefined" 는 오류가 아니다', () => {
    const html = fixture('page-healthy.html.gz')
    expect(html).toContain('digest\\":\\"$undefined')
    expect(streamedErrorDigests(html)).toEqual([])
    expect(pageProblems(html, ['요구사항 정리'])).toEqual([])
  })
  it('notFound digest 는 오류 digest 가 아니다(은닉 판정은 notFoundRendered 몫)', () => {
    expect(streamedErrorDigests('"digest\\":\\"NEXT_HTTP_ERROR_FALLBACK;404\\"')).toEqual([])
  })
})

describe('PAGE_MARKERS·거부 문구 — 앱 원본과의 드리프트', () => {
  it('문구 표식이 원본 컴포넌트에 그대로 있다', () => {
    const src = {
      degraded: 'src/components/app/DegradedNotice.tsx',
      'error-boundary': 'src/components/app/ScopeError.tsx',
    } as Record<string, string>
    for (const [name, marker] of PAGE_MARKERS) {
      if (name === 'next-error') continue
      expect(readFileSync(src[name], 'utf8')).toContain(marker)
    }
    // 오류 경계 넷(셸 없는 전체 + 범위 셋 — 과제 31)이 모두 그 표지를 그리는 ScopeError 를 쓴다
    for (const f of ['src/app/(app)/error.tsx', 'src/app/(app)/w/[slug]/error.tsx', 'src/app/(app)/p/[projectId]/error.tsx', 'src/app/(app)/(global)/error.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toContain('<ScopeError reset={reset} />')
    }
  })
  it('쓰기 거부 문구가 앱의 ERR_DENIED 와 같다', () => {
    expect(ERR_DENIED).toBe(APP_ERR_DENIED)
  })
  it('모듈 거부 문구가 앱의 ERR_MODULE_DISABLED 와 같다', () => {
    expect(ERR_MODULE_DISABLED).toBe(APP_ERR_MODULE_DISABLED)
  })
})

describe('redactInviteTokens — 실패 메시지에서 초대 토큰 가리기', () => {
  it('/invite/<uuid> 를 가린다', () => {
    const t = '0f8b2c1e-1a2b-4c3d-8e9f-001122334455'
    expect(redactInviteTokens(`[carol] GET /invite/${t} → 500`)).toBe('[carol] GET /invite/<token> → 500')
    expect(redactInviteTokens('/p/x/wbs')).toBe('/p/x/wbs')
  })
})

describe('notFoundRendered — 스트리밍 뒤 notFound() 판정', () => {
  // (app)/loading.tsx 가 셸을 먼저 흘려보내 상태 코드는 이미 200 이다 — 레이아웃의 notFound() 는 RSC 페이로드의
  // digest 로만 남고 클라이언트가 not-found 화면을 그린다(2026-09-25 로컬 실측).
  it('404 폴백 digest 가 있으면 true', () => {
    expect(notFoundRendered('<script>self.__next_f.push([1,"e:{\\"digest\\":\\"NEXT_HTTP_ERROR_FALLBACK;404\\"}"])</script>')).toBe(true)
    expect(notFoundRendered('<html><main>WBS</main></html>')).toBe(false)
  })
  it('403·다른 폴백은 404 가 아니다', () => {
    expect(notFoundRendered('NEXT_HTTP_ERROR_FALLBACK;403')).toBe(false)
  })
})

// ── SP2 흐름(2-워크스페이스 격리)의 입력 조립·경로 판정 ─────────────────────────────────────────────

describe('SP2 계정·팀 픽스처', () => {
  it('세 계정은 서로 다르고 carol 과도 다르며, 예시 도메인(INVITE_ALLOWED_DOMAINS=example.com)의 올바른 이메일이다', () => {
    const emails = [A_ADMIN.email, B_ADMIN.email, OUTSIDER.email, INVITEE.email]
    expect(new Set(emails).size).toBe(emails.length)
    for (const e of emails) {
      expect(isValidEmail(e)).toBe(true)
      expect(e.endsWith('@example.com')).toBe(true)
    }
  })
  it('워크스페이스 공용 팀은 새 팀 코드 규칙을 통과하고 프로젝트 팀과 겹치지 않는다(담당 판정이 범위로만 갈린다)', () => {
    expect(normalizeNewTeamCode(WS_TEAM, EXCEL_HEADER_WORDS)).toEqual({ ok: true, code: WS_TEAM })
    expect([...SP1_TEAMS.A, ...SP1_TEAMS.B]).not.toContain(WS_TEAM)
  })
  it('워크스페이스 B 는 부트스트랩 기본 슬러그가 아니다', () => {
    expect(OTHER_WORKSPACE.slug).not.toBe('default')
  })
})

describe('workspaceAdminAccountInput — createAccount 입력', () => {
  const input = workspaceAdminAccountInput({ workspaceId: 'w1', email: B_ADMIN.email, name: B_ADMIN.name, password: 'pw-12345678' })
  it('그 워크스페이스의 관리자, 프로젝트 권한 없음(명단 행 없음)', () => {
    expect(input).toEqual({
      workspaceId: 'w1', email: B_ADMIN.email, password: 'pw-12345678', name: 'bea',
      workspaceRole: 'admin', projectId: null, accessRole: null,
    })
  })
  it('서버 액션 인자로 그대로 실린다(undefined 없음)', () => {
    expect(() => encodeActionArgs([input])).not.toThrow()
  })
})

describe('minuteBodyPath — 앱의 makeStoragePath 와 같은 규약(드리프트 감지)', () => {
  const ws = '11111111-1111-4111-8111-111111111111'
  const pid = '22222222-2222-4222-8222-222222222222'
  const mid = '33333333-3333-4333-8333-333333333333'
  it('프로젝트 지정·미지정 모두 makeStoragePath(entity minutes)와 같은 문자열', () => {
    for (const projectId of [pid, null]) {
      const ours = minuteBodyPath({ workspaceId: ws, projectId, minuteId: mid, fileName: 'e2e-project.md' })
      expect(ours).toBe(makeStoragePath({ workspaceId: ws, projectId, entity: 'minutes', entityId: mid, fileName: 'e2e-project.md' }))
      expect(ours.startsWith(`ws/${ws}/p/${projectId ?? '_'}/minutes/${mid}/`)).toBe(true)
    }
  })
  it('createMinute 가 쓰는 경로 판정(isMinuteFilePathValid)을 통과한다 — 다른 범위로는 통과하지 않는다', () => {
    const path = minuteBodyPath({ workspaceId: ws, projectId: null, minuteId: mid, fileName: 'e2e-noproject.md' })
    expect(isMinuteFilePathValid({ workspaceId: ws, projectId: null }, mid, path, 'minutes')).toBe(true)
    expect(isMinuteFilePathValid({ workspaceId: ws, projectId: pid }, mid, path, 'minutes')).toBe(false)
    expect(isMinuteFilePathValid({ workspaceId: pid, projectId: null }, mid, path, 'minutes')).toBe(false)
  })
  it('앱이 거부하는 입력은 똑같이 거부한다', () => {
    const bad = [
      { workspaceId: 'not-a-uuid', projectId: null, minuteId: mid, fileName: 'a.md' },
      { workspaceId: ws, projectId: 'zz', minuteId: mid, fileName: 'a.md' },
      { workspaceId: ws, projectId: null, minuteId: 'x', fileName: 'a.md' },
      { workspaceId: ws, projectId: null, minuteId: mid, fileName: 'a/b.md' },
      { workspaceId: ws, projectId: null, minuteId: mid, fileName: '' },
      { workspaceId: ws, projectId: null, minuteId: mid, fileName: '..' },
      { workspaceId: ws, projectId: null, minuteId: mid, fileName: `${'a'.repeat(198)}.md` },
    ]
    for (const p of bad) {
      expect(() => minuteBodyPath(p), JSON.stringify(p)).toThrow(/저장 경로/)
      expect(() => makeStoragePath({ ...p, entity: 'minutes', entityId: p.minuteId }), JSON.stringify(p)).toThrow()
    }
  })
})

describe('inWorkspaceStorage — 객체 이름이 그 워크스페이스의 규약 경로인가(앱 parseStoragePath 와 대조)', () => {
  const ws = '11111111-1111-4111-8111-111111111111'
  const other = '44444444-4444-4444-8444-444444444444'
  const mid = '33333333-3333-4333-8333-333333333333'
  const ok = `ws/${ws}/p/_/minutes/${mid}/e2e.md`
  it('규약 경로면 그 워크스페이스에서만 참', () => {
    expect(inWorkspaceStorage(ok, ws)).toBe(true)
    expect(inWorkspaceStorage(ok, ws.toUpperCase())).toBe(true)
    expect(inWorkspaceStorage(ok, other)).toBe(false)
    expect(parseStoragePath(ok)?.workspaceId).toBe(ws)
  })
  it('접두만 맞는 이름·옛 형식은 거짓 — 앱 파서도 null', () => {
    const names = [
      `ws/${ws}/p/_/minutes/${mid}`, `ws/${ws}/p/../minutes/${mid}/e2e.md`, `ws/${ws}/p/_/wiki/${mid}/e2e.md`,
      `ws/${ws}/x/_/minutes/${mid}/e2e.md`, `${mid}/e2e.md`, `ws/${ws}/p/_/minutes/not-uuid/e2e.md`, '',
    ]
    for (const n of names) {
      expect(inWorkspaceStorage(n, ws), n).toBe(false)
      expect(parseStoragePath(n), n).toBeNull()
    }
  })
})

describe('minuteInput·minuteSource — createMinute 인자', () => {
  it('회의 미연결, 프로젝트 지정·미지정 그대로, 앱 필드 검증 통과', () => {
    for (const projectId of ['p1', null]) {
      const input = minuteInput({ date: '2026-09-26', teamCode: WS_TEAM, title: 'E2E-MIN', bodyMd: '# E2E', projectId })
      expect(input).toEqual({
        minuteDate: '2026-09-26', teamCode: WS_TEAM, title: 'E2E-MIN', bodyMd: '# E2E', meetingId: null, projectId, meetingOccurrenceDate: null,
      })
      expect(validateMinuteFields(input)).toBeNull()
      expect(() => encodeActionArgs([input, null, minuteSource({ minuteId: 'm', fileName: 'a.md', filePath: 'x', size: 3 })])).not.toThrow()
    }
    expect(() => minuteInput({ date: '2026-9-26', teamCode: WS_TEAM, title: 't', bodyMd: '', projectId: null })).toThrow(/날짜/)
  })
  it('source 는 선발급 id 와 본문 파일 메타(.md, text/markdown)', () => {
    expect(minuteSource({ minuteId: 'm1', fileName: 'e2e.md', filePath: 'ws/…/e2e.md', size: 12 }))
      .toEqual({ minuteId: 'm1', file: { fileName: 'e2e.md', filePath: 'ws/…/e2e.md', size: 12, mime: 'text/markdown' } })
  })
})

describe('leakedIds·presentTexts — 교차 워크스페이스 누설 판정', () => {
  it('leakedIds: 보인 것 중 금지된 것만, 첫 등장 순·중복 제거', () => {
    expect(leakedIds(['a', 'c', 'b', 'c'], ['c', 'b', 'z'])).toEqual(['c', 'b'])
    expect(leakedIds([], ['a'])).toEqual([])
    expect(leakedIds(['a'], [])).toEqual([])
  })
  it('presentTexts: HTML 에 들어 있는 문구만(pageProblems 의 missing 과 반대)', () => {
    const html = '<main>E2E-MIN-PROJECT · E2E A 202609261700</main>'
    expect(presentTexts(html, ['E2E-MIN-PROJECT', 'E2E-MIN-NOPROJECT', 'E2E A 202609261700'])).toEqual(['E2E-MIN-PROJECT', 'E2E A 202609261700'])
    expect(presentTexts(html, [])).toEqual([])
  })
})

describe('복사 생성 라벨(E2E 2b)', () => {
  it('원본 A 의 라벨과 달라 "입력값을 썼다" 를 가를 수 있고, 레지스트리 parse 를 그대로 통과한다(저장값 = 입력값)', () => {
    expect(COPY_LEVEL_LABELS).not.toEqual(LEVEL_LABELS)
    expect(COPY_LEVEL_LABELS).toHaveLength(LEVEL_LABELS.length)
    expect(settingDef('project', 'core.level_labels')!.parse([...COPY_LEVEL_LABELS])).toEqual({ ok: true, value: [...COPY_LEVEL_LABELS] })
  })
})

describe('SP4 A1 — 두 러너의 날짜 도우미(주 키는 만들지 않는다 — W30)', () => {
  it('shiftDays — 달·해·윤일 경계와 음수, 형식·정수가 아니면 throw', () => {
    expect(shiftDays('2026-09-28', 7)).toBe('2026-10-05')
    expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(() => shiftDays('2026-9-1', 1)).toThrow()
    expect(() => shiftDays('2026-09-01', 1.5)).toThrow()
  })
  it('plainWeekLabel — 전환 없는 키의 라벨(기준일 = 키 + 3일, 주차 = ⌊(일 − 1)/7⌋ + 1 — 개정 §4.2.5 표)', () => {
    expect(plainWeekLabel('2026-06-28')).toEqual({ year: 2026, month: 7, ordinal: 1, label: '7월 1주차' })
    expect(plainWeekLabel('2026-06-21')).toEqual({ year: 2026, month: 6, ordinal: 4, label: '6월 4주차' })
    expect(plainWeekLabel('2026-06-29')).toEqual({ year: 2026, month: 7, ordinal: 1, label: '7월 1주차' })
    expect(plainWeekLabel('2026-09-21')).toEqual({ year: 2026, month: 9, ordinal: 4, label: '9월 4주차' })
    expect(plainWeekLabel('2026-12-27')).toEqual({ year: 2026, month: 12, ordinal: 5, label: '12월 5주차' })
    expect(() => plainWeekLabel('2026/06/28')).toThrow()
  })
  it('plainWeekLabel 은 전환 없는 규칙에서 앱의 weekLabelOf 와 같다(러너 사본의 드리프트 0 — 일요일·월요일, 한 해의 모든 키)', () => {
    for (const day of ['sunday', 'monday'] as const) {
      const rules = [{ day, from: null }]
      for (let key = weekKeyOf(rules, '2026-01-01'); key < '2027-01-01'; key = shiftDays(key, 7)) {
        const { year, month, ordinal } = plainWeekLabel(key)
        expect({ year, month, ordinal }, `${day} ${key}`).toEqual(weekLabelOf(rules, key))
      }
    }
  })
  it('rangeText — M/D~M/D(앞 0 없음)', () => {
    expect(rangeText('2026-06-29', '2026-07-03')).toBe('6/29~7/3')
    expect(rangeText('2026-09-21', '2026-09-26')).toBe('9/21~9/26')
  })
  it('nextDowOnOrAfter — 그날 포함 다음 그 요일', () => {
    expect(nextDowOnOrAfter('2026-10-02', 6)).toBe('2026-10-03')
    expect(nextDowOnOrAfter('2026-10-03', 6)).toBe('2026-10-03')
    expect(nextDowOnOrAfter('2026-10-04', 6)).toBe('2026-10-10')
    expect(() => nextDowOnOrAfter('2026-10-02', 7)).toThrow()
  })
})

describe('SP4 A1 — 가져오기 파일·폼·영역 입력(스펙 §4.4 #1·§6.4 S2)', () => {
  it('fillWbsWorkbook — 양식 없이: WBS 머리 + 행(4단 코드), 날짜는 UTC 정오, Holiday 머리', async () => {
    const rows = [['1', '단계', '', '', '2026-10-05', '2026-10-30', 1, '', ''], ['1.1.1.1', '세부', '', '산출물', '2026-10-05', '2026-10-09', 1, '', 'RES']]
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(await fillWbsWorkbook(rows)).buffer)
    const ws = wb.getWorksheet('WBS')!
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual([...TEMPLATE_HEADER])
    expect(ws.actualRowCount).toBe(3)
    expect(ws.getRow(3).getCell(1).value).toBe('1.1.1.1')
    expect(ws.getRow(3).getCell(9).value).toBe('RES')
    expect((ws.getRow(2).getCell(5).value as Date).toISOString()).toBe('2026-10-05T12:00:00.000Z')
    expect((wb.getWorksheet('Holiday')!.getRow(1).values as unknown[]).slice(1)).toEqual(['날짜', '이름'])
  })
  it('fillWbsWorkbook — 앱 양식 위: 예시 행 자리에 덮어쓰고 남는 예시 행은 비운다(E2E 단계 5 와 같은 방식)', async () => {
    const rows = e2eRows('QA')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(new Uint8Array(await fillWbsWorkbook(rows, Buffer.from(buildWbsTemplateWorkbook('Acme')))).buffer)
    const ws = wb.getWorksheet('WBS')!
    expect(ws.actualRowCount).toBe(rows.length + 1)
    expect(ws.getRow(2).getCell(1).value).toBe('1')
    expect(ws.getRow(rows.length + 1).getCell(9).value).toBe('QA')
  })
  it('importForm — 마법사와 같은 필드에 commandId 를 싣는다. uuid 가 아니거나 모드가 아니면 throw(명령 id 없는 실행을 만들지 않는다)', () => {
    const cmd = '11111111-2222-4333-8444-555555555555'
    const f = importForm({ file: Buffer.from('x'), fileName: 'a.xlsx', projectId: 'p1', profile: { k: 1 }, mode: 'append', commandId: cmd })
    expect([...f.keys()]).toEqual(['file', 'projectId', 'profile', 'mode', 'saveProfile', 'registerTeams', 'commandId'])
    expect(['projectId', 'profile', 'mode', 'saveProfile', 'registerTeams', 'commandId'].map((k) => f.get(k)))
      .toEqual(['p1', '{"k":1}', 'append', 'true', 'false', cmd])
    const file = f.get('file') as File
    expect([file.name, file.type]).toEqual(['a.xlsx', XLSX_MIME])
    expect(importForm({ file: Buffer.from('x'), fileName: 'a.xlsx', projectId: 'p1', profile: {}, mode: 'replace', commandId: cmd,
      saveProfile: false, registerTeams: true }).get('registerTeams')).toBe('true')
    expect(() => importForm({ file: Buffer.from('x'), fileName: 'a.xlsx', projectId: 'p1', profile: {}, mode: 'append', commandId: 'k' })).toThrow(/uuid/)
    expect(() => importForm({ file: Buffer.from('x'), fileName: 'a.xlsx', projectId: 'p1', profile: {}, mode: 'merge' as 'append', commandId: cmd }))
      .toThrow(/모드/)
  })
  it('importForm — 전환 동의 토큰(A1-5 R3)은 주어졌을 때만 마지막 필드로 싣는다 — 409 가 준 값을 그대로 돌려보내는 용도', () => {
    const cmd = '11111111-2222-4333-8444-555555555555'
    const base = { file: Buffer.from('x'), fileName: 'a.xlsx', projectId: 'p1', profile: {}, mode: 'append' as const, commandId: cmd, registerTeams: true }
    expect(importForm(base).get('convertToken')).toBeNull()
    const f = importForm({ ...base, convertToken: 'tok-1' })
    expect([...f.keys()].at(-1)).toBe('convertToken')
    expect(f.get('convertToken')).toBe('tok-1')
  })
  it('importForm 의 필드 이름은 실행 라우트가 읽는 이름이다 — commandId 포함(과제 29)', () => {
    const route = readFileSync('src/app/api/import/execute/route.ts', 'utf8')
    for (const k of ['file', 'projectId', 'profile', 'mode', 'saveProfile', 'registerTeams', 'commandId', 'convertToken']) expect(route, k).toContain(`get('${k}')`)
  })
  it('inspectForm — 파일·프로젝트 둘', () => {
    expect([...inspectForm({ file: Buffer.from('x'), fileName: 'a.xlsx', projectId: 'p1' }).keys()]).toEqual(['file', 'projectId'])
  })
  it('importResultView — 성공은 종류·명령 id·건수·모드·양식 저장, 실패는 code 만', () => {
    expect(importResultView({ ok: true, kind: 'duplicate', commandId: 'k', count: 5, mode: 'append', profileSaved: true, backup: { rows: [] } }))
      .toEqual({ ok: true, kind: 'duplicate', commandId: 'k', count: 5, mode: 'append', profileSaved: true })
    expect(importResultView({ ok: false, code: 'COMMAND_REUSED', error: '같은 실행 ID 로 다른 내용' })).toEqual({ ok: false, code: 'COMMAND_REUSED' })
  })
  it('areaInput — 편집기와 같은 AreaInput(weekly_section, 담당 팀 code → 그 프로젝트 팀 id), 앱 검증 통과, 모르는 팀은 throw', () => {
    const ids = new Map([['RES', 't-res'], ['OPS', 't-ops']])
    const def = { code: 'DATA', name: '데이터', sortOrder: 2, teams: [['RES', 'primary'], ['OPS', 'support']] }
    const input = areaInput(def, ids)
    expect(input).toEqual({ kind: 'weekly_section', code: 'DATA', name: '데이터', sortOrder: 2, active: true,
      teams: [{ teamId: 't-res', kind: 'primary' }, { teamId: 't-ops', kind: 'support' }] })
    expect(validateArea(input as AreaInput, [])).toEqual({ ok: true, value: input })
    expect(areaInput(def, ids, { id: 'a1', name: '데이터 정리', active: false })).toMatchObject({ id: 'a1', code: 'DATA', name: '데이터 정리', active: false })
    expect(() => areaInput(def, new Map([['RES', 't-res']]))).toThrow(/OPS/)
    expect(() => encodeActionArgs(['p1', input])).not.toThrow()
  })
})

describe('SP4 A1 — E2E 의 주간·가져오기 픽스처(스펙 §6.3)', () => {
  it('B 의 영역은 사용자 정의 이름만 — 센티널 0, code 는 이름과 다르고 서로 다르며 앱 영역 검증을 통과한다', () => {
    const all = Object.values(E2E_AREAS)
    const words = all.flatMap((a) => [a.code, a.name, 'renamed' in a ? a.renamed : ''])
    expect(findSentinels(words.join(' '), SENTINELS_BY_SP.SP4)).toEqual([])
    expect(new Set(all.map((a) => a.code)).size).toBe(all.length)
    for (const a of all) {
      expect(a.code).not.toBe(a.name)
      expect(validateArea({ kind: 'weekly_section', code: a.code, name: a.name, sortOrder: 1, active: true, teams: [] }, []).ok).toBe(true)
    }
  })
  it('A 의 등록 영역 이름은 옛 11구분명의 둘째와 같은 낱말이다 — 평문은 센티널 픽스처 하나(계획 P6), code 는 센티널이 아니다', () => {
    expect(REGISTERED_AREA.name).toBe(LEGACY_SENTINELS.weeklySections[1])
    expect(SENTINELS_BY_SP.SP4).toContain(REGISTERED_AREA.name)
    expect(findSentinels(REGISTERED_AREA.code, SENTINELS_BY_SP.SP4)).toEqual([])
  })
  it('미등록 팀 code — 새 팀 코드 규칙 통과, SP1 팀·공용 팀과 다르고 센티널이 아니다', () => {
    expect(normalizeNewTeamCode(UNREGISTERED_TEAM, EXCEL_HEADER_WORDS)).toEqual({ ok: true, code: UNREGISTERED_TEAM })
    expect([...SP1_TEAMS.A, ...SP1_TEAMS.B, WS_TEAM]).not.toContain(UNREGISTERED_TEAM)
    expect(findSentinels(UNREGISTERED_TEAM, SENTINELS_BY_SP.SP4)).toEqual([])
  })
  it('e2eRows 의 둘째 잎 팀 — 첫 잎만 첫 팀, 둘째 잎만 둘째 팀, 나머지 칸은 한 팀 꼴과 같다', () => {
    const one = e2eRows(WS_TEAM)
    const two = e2eRows(WS_TEAM, UNREGISTERED_TEAM)
    expect(two.map((r) => r[8])).toEqual(['', '', WS_TEAM, '', UNREGISTERED_TEAM])
    expect(two.map((r) => r.slice(0, 8))).toEqual(one.map((r) => r.slice(0, 8)))
  })
})

describe('SP4 A1 — E2E 의 판정 도우미', () => {
  it('carriedText 는 앱 이월(carryOverRows)의 덧붙임과 같다 — 자기 이월분 → 매핑된 영역, 앞뒤 공백은 걷는다', () => {
    const areas = [
      { id: 'a-exp', code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] },
      { id: 'a-run', code: 'RUN', name: '운영', sortOrder: 2, active: false, teams: [] },
    ]
    const prev = [
      { areaId: 'a-exp', thisContent: '', thisIssue: '', nextContent: ' carry-own-1 \n', nextIssue: '' },
      { areaId: 'a-run', thisContent: '', thisIssue: '', nextContent: '\ncarry-mapped-1', nextIssue: 'carry-mapped-issue ' },
    ]
    const r = carryOverRows(prev, areas, { 'a-run': 'a-exp' })
    if (!r.ok) throw new Error(`이월 거부: ${JSON.stringify(r)}`)
    expect(r.rows[0].thisContent).toBe(carriedText(' carry-own-1 \n', '\ncarry-mapped-1'))
    expect(r.rows[0].thisIssue).toBe(carriedText('', 'carry-mapped-issue '))
    expect(carriedText('a', '', '  ', 'b')).toBe('a\nb')
  })
  it('slideCount·pptText — 슬라이드 파트만, 번호 순, 런으로 나뉜 낱말을 잇고 XML 엔티티를 푼다', () => {
    const entries = [
      { name: 'ppt/slides/slide10.xml', text: '<a:t>열</a:t>' },
      { name: 'ppt/slides/slide2.xml', text: '<p:sp><a:t>실험</a:t><a:t xml:space="preserve"> 설계</a:t></p:sp><a:t>R&amp;D</a:t>' },
      { name: 'ppt/slideLayouts/slideLayout1.xml', text: '<a:t>레이아웃</a:t>' },
      { name: 'ppt/slides/_rels/slide2.xml.rels', text: '<Relationships/>' },
    ]
    expect(slideCount(entries.map((e) => e.name))).toBe(2)
    expect(pptText(entries)).toBe('실험 설계R&D\n열')
  })
  it('sentinelReport — 적중이 있는 항목만, 일치 규칙은 findSentinels(마스크 복합어·영문 경계), 등록 이름은 같은 문자열만 뺀다', () => {
    const [, sales] = LEGACY_SENTINELS.weeklySections
    const [, code] = LEGACY_SENTINELS.teamCodes
    const entries = [
      { name: 'a.xml', text: `<a:t>${sales}일 기준</a:t>` },
      { name: 'b.xml', text: `<a:t>Times New Roman · ${code}</a:t>` },
      { name: 'c.xml', text: '<a:t>합성</a:t>' },
    ]
    expect(sentinelReport(entries, SENTINELS_BY_SP.SP4)).toEqual([{ name: 'b.xml', hits: [code] }])
    expect(sentinelReport(entries, excludeRegistered(SENTINELS_BY_SP.SP4, [code]))).toEqual([])
  })
  it('teamRefs — 네 곳(항목 담당·명단 팀·영역 팀·수락 전 초대의 team_ids)에서 주어진 팀 id 를 센다', () => {
    const wiring = {
      items: [{ item_owners: [{ team_id: 'c1' }, { team_id: 'o1' }] }, { item_owners: [] }, {}],
      members: [{ project_member_teams: [{ team_id: 'c1' }] }],
      areas: [{ area_teams: [{ team_id: 'o1' }] }, { area_teams: [{ team_id: 'c1' }, { team_id: 'c2' }] }],
      invites: [{ team_ids: ['c2', 'o1'] }, { team_ids: null }],
    }
    expect(teamRefs(wiring, ['c1', 'c2'])).toEqual({ item_owners: 1, project_member_teams: 1, area_teams: 2, invites: 1 })
    expect(teamRefs(wiring, ['o1'])).toEqual({ item_owners: 1, project_member_teams: 0, area_teams: 1, invites: 1 })
  })
})

describe('e2e-local.mjs — SP4 A1 단계(이름으로 부른다 — 스펙 §6.3·Q7)', () => {
  const src = readFileSync('scripts/e2e-local.mjs', 'utf8')
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  it('새 단계 여섯과 기존 가져오기·렌더 단계가 이름으로 있고, 새 단계는 minutes-api-scope 뒤·render-pages 앞이다', () => {
    const at = (n: string) => src.indexOf(`step('${n}'`)
    const added = ['weekly-areas-required', 'weekly-carry-mapping', 'weekly-outputs', 'weekly-registered-names', 'import-idempotent', 'import-unregistered-teams']
    for (const n of [...added, 'import-append', 'import-replace', 'render-pages', 'minutes-api-scope']) expect(at(n), n).toBeGreaterThan(-1)
    for (const n of added) {
      expect(at(n), n).toBeLessThan(at('render-pages'))
      expect(at(n), n).toBeGreaterThan(at('minutes-api-scope'))
    }
  })
  it('가져오기 실행 폼은 importForm 한 곳 — 명령 id 없이 보내는 길이 없다(스펙 §4.4 #1)', () => {
    expect(src).not.toMatch(/append\('mode'/)
    expect(src.match(/importForm\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })
  it('새 액션 넷은 그 액션을 쓰는 페이지(worker)에 묶고, A1 화면에 호출부가 없는 getImportReceipt 는 싣지 않는다', () => {
    for (const [name, file, worker] of [
      ['createWeeklyReport', 'weekly.ts', '/p/[projectId]/weekly/page'], ['saveWeeklyCells', 'weekly.ts', '/p/[projectId]/weekly/page'],
      ['upsertArea', 'projectAreas.ts', '/p/[projectId]/settings/page'], ['getWbsBackup', 'importBackup.ts', '/p/[projectId]/import/page'],
    ] as const) {
      expect(src, name).toMatch(new RegExp(`${name}: \\{ filename: 'src/app/actions/${esc(file)}', exportedName: '${name}', worker: '${esc(worker)}' \\}`))
    }
    expect(src).not.toContain("exportedName: 'getImportReceipt'")
  })
  it('render-pages 가 B 의 주간·설정 화면을 렌더하고 B 주간 HTML 의 센티널을 기록한다(실패로 세지 않는다 — 스펙 §6.3·K12)', () => {
    expect(src).toMatch(/\[`\/p\/\$\{B\.id\}\/weekly`, \[/)
    expect(src).toMatch(/\[`\/p\/\$\{B\.id\}\/settings`, \[/)
    expect(src).toMatch(/sentinels: findSentinels\(html, bSentinels\)/)
  })
  it('지역 seoulToday 가 없다 — 공용 도우미 하나(과제 34)', () => {
    expect(src).not.toMatch(/const seoulToday\s*=/)
  })
})

describe('e2e-local.mjs — SP5 A 달력 단계(스펙 §6.3)', () => {
  const src = readFileSync('scripts/e2e-local.mjs', 'utf8')
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const at = (n: string) => src.indexOf(`step('${n}'`)
  it('단계 넷이 이름으로 있고 import-unregistered-teams 뒤(SP4 A2 의 export-standard 뒤)·render-pages 앞, 이 순서다', () => {
    const cal = ['calendar-week-sunday', 'calendar-week-transition', 'calendar-tz', 'calendar-workday']
    for (const n of cal) {
      expect(at(n), n).toBeGreaterThan(at('import-unregistered-teams'))
      expect(at(n), n).toBeGreaterThan(at('export-standard'))
      expect(at(n), n).toBeLessThan(at('render-pages'))
    }
    for (let i = 1; i < cal.length; i++) expect(at(cal[i - 1])).toBeLessThan(at(cal[i]))
  })
  it('달력 단계는 UI-2 의 경로·셸 계약을 쓴다 — 워크스페이스 화면은 /w/<slug>(wsPath), 공지 게시 판정은 셸 배지(?ws=&project=)', () => {
    const block = src.slice(src.indexOf('const newCalProject'), at('calendar-workday'))
    expect(block).toContain("admin.action(wsPath(wsA, 'projects'), 'createProject'")
    expect(block).toContain("admin.http('GET', wsPath(wsA, 'usage'))")
    expect(block).toContain('/api/shell?ws=${wsA}&project=${calL.id}')
    expect(block).toContain('badge: unreadBadge === 1')
    expect(block).not.toMatch(/http\('GET', '\/(projects|usage|meetings|minutes|portfolio|agents)'\)|action\('\/projects'|\?route=|headerAnnouncements/)
  })
  it('달력 쓰기는 화면과 같은 서버 액션 — worker 는 그 액션을 쓰는 페이지', () => {
    for (const [name, file, worker] of [
      ['updateWorkspaceSettings', 'settings.ts', '/w/[slug]/settings/page'], ['previewWeekStartChange', 'settingsPreview.ts', '/p/[projectId]/settings/page'],
      ['addHoliday', 'project.ts', '/p/[projectId]/settings/page'], ['setBaseDate', 'project.ts', '/p/[projectId]/settings/page'],
      ['createAnnouncement', 'announcements.ts', '/p/[projectId]/announcements/page'],
      ['addWbsItem', 'wbs.ts', '/p/[projectId]/wbs/page'], ['updateWbsFields', 'wbs.ts', '/p/[projectId]/wbs/page'], ['addTaskDependency', 'wbs.ts', '/p/[projectId]/wbs/page'],
    ] as const) {
      expect(src, name).toMatch(new RegExp(`${name}: \\{ filename: 'src/app/actions/${esc(file)}', exportedName: '${name}', worker: '${esc(worker)}' \\}`))
    }
    expect(src).not.toMatch(/svc\.from\('(?:holidays|project_settings|workspace_settings|task_dependencies|wbs_items)'\)\.(?:insert|update|upsert)/)
  })
  it('서울 관용구·러너의 주 키 계산이 없다 — 오늘은 저장된 tz, 요일은 dowOfIso(검증 전용)', () => {
    expect(src).not.toMatch(/seoulToday|isMondayIso|mondayKeys|\(dow \+ 6\) % 7|mondayOf/)
    expect(src).toMatch(/sundayKeys: dowOfIso\(weeks\.w0\) === 0/)
    expect(src).toMatch(/todayInTz\(/)
  })
  it('render-pages 가 달력 화면 셋을 렌더한다', () => {
    expect(src).toMatch(/\[`\/p\/\$\{calS\.id\}\/weekly\?week=\$\{/)
    expect(src).toMatch(/\[`\/p\/\$\{calT\.id\}\/weekly\?week=\$\{/)
    expect(src).toMatch(/\[`\/p\/\$\{calL\.id\}\/settings`, \[/)
  })
  it('calendar-tz 는 워크스페이스 tz 를 finally 에서 되돌리고, 사용 이벤트 픽스처도 finally 에서 지운다', () => {
    const block = src.slice(at('calendar-week-transition'), at('calendar-tz'))
    expect(block).toMatch(/finally \{\s*await setWorkspaceTz\(wsTzBefore\)/)
    expect(block).toMatch(/finally \{\s*await svc\.from\('usage_events'\)\.delete\(\)\.eq\('id', ev\.id\)/)
  })
  // 체크포인트 A 첫 실행(2026-10-03)의 빨강 둘 — 러너 결함이다(단언은 그대로).
  it('calendar-tz 의 사용현황 일자 판독은 /usage GET 보다 먼저다 — 그 화면의 after()(purgeOldUsageEvents)가 보존 기간(90일) 밖인 픽스처를 지운다', () => {
    const block = src.slice(at('calendar-week-transition'), at('calendar-tz'))
    const read = block.indexOf("const utc = await day('UTC')")
    expect(read).toBeGreaterThan(0)
    expect(block.indexOf("admin.http('GET', wsPath(wsA, 'usage'))")).toBeGreaterThan(read)
    expect(readFileSync('src/app/(app)/w/[slug]/usage/page.tsx', 'utf8')).toContain('purgeOldUsageEvents')
  })
  it('calendar-tz 의 안읽음 배지는 작성자 읽음 표시를 걷은 뒤 센다 — createAnnouncement 가 작성자 워터마크를 방금 만든 공지로 올린다', () => {
    const block = src.slice(at('calendar-week-transition'), at('calendar-tz'))
    const reset = block.search(/svc\.from\('announcement_seen'\)\.delete\(\)\.eq\('user_id', me\.id\)\.eq\('project_id', calL\.id\)/)
    expect(reset).toBeGreaterThan(0)
    expect(block.indexOf('/api/shell?ws=${wsA}&project=${calL.id}')).toBeGreaterThan(reset)
    expect(readFileSync('src/app/actions/announcements.ts', 'utf8')).toMatch(/advanceSeenWatermark\(projectId, g\.actor\.userId, data\.created_at/)
  })
  it('calendar-tz 는 포털 홈 공지 카드도 본다 — 프로젝트 tz 의 오늘 게시만, 내일 게시는 없다(과제 32 — 셸 배지와 같은 판정)', () => {
    const block = src.slice(at('calendar-week-transition'), at('calendar-tz'))
    expect(block).toContain("admin.http('GET', wsPath(wsA, ''))")
    expect(block).toContain('portal: homeHtml.includes(annNow) && !homeHtml.includes(annLater)')
  })
  it("'UTC 기준' 판정은 SSR 의 텍스트 노드 구분(<!-- -->)을 걷어 낸 HTML 로 한다 — 화면은 '{timezone} 기준' 보간이다", () => {
    expect(src).toContain("usageHtml.replace(/<!-- -->/g, '').includes('UTC 기준')")
    expect(readFileSync('src/app/(app)/w/[slug]/usage/page.tsx', 'utf8')).toContain('{timezone} 기준')
  })
})

describe('SP4 A2 — E2E 새 단계(스펙 §6.3)', () => {
  const src = readFileSync('scripts/e2e-local.mjs', 'utf8')
  it('두 단계가 A1 새 단계 묶음 뒤·render-pages 앞에 이 순서로 있다', () => {
    const at = (n: string) => src.indexOf(`step('${n}'`)
    expect(at('teams-source-next-start')).toBeGreaterThan(at('import-unregistered-teams'))
    expect(at('export-standard')).toBeGreaterThan(at('teams-source-next-start'))
    expect(at('render-pages')).toBeGreaterThan(at('export-standard'))
  })
  it('A2_TEAM 은 옛 이름이 아니고 팀 이름 규칙을 지난다', () => {
    expect(findSentinels(A2_TEAM, sp4Sentinels())).toEqual([])
    expect(normalizeNewTeamCode(A2_TEAM, EXCEL_HEADER_WORDS)).toEqual({ ok: true, code: A2_TEAM })
  })
  it('새 단계는 표준 내보내기의 레이아웃 머리를 본다', () => {
    expect(src).toMatch(/headers\.get\('x-excel-layout'\)/)
  })
  it('teams-source-next-start 는 서버가 next start(프로덕션 빌드)일 때만 통과하고 그 판정을 기록한다(A2-4 리뷰 P3-1 · W3)', () => {
    expect(src).toMatch(/const serverMode = nextServerMode\(/)
    expect(src).toMatch(/nextStart: serverMode === 'production'/)
    expect(src).toMatch(/step\('teams-source-next-start', \{ projectId: N\.id, serverMode,/)
  })
})

describe('nextServerMode — HTML 로 next start 와 next dev 를 가른다(W3)', () => {
  it('해시 붙은 main-app 청크만 있으면 production', () => {
    expect(nextServerMode('<script src="/_next/static/chunks/main-app-ba5b57b221901741.js" async></script>')).toBe('production')
  })
  it('dev 흔적(해시 없는 main-app·react-refresh·webpack-hmr·development 폴더)이 하나라도 있으면 development', () => {
    expect(nextServerMode('<script src="/_next/static/chunks/main-app.js?v=1727" async></script>')).toBe('development')
    expect(nextServerMode('<script src="/_next/static/chunks/main-app-ba5b57b221901741.js"></script><script src="/_next/static/chunks/react-refresh.js"></script>')).toBe('development')
    expect(nextServerMode('/_next/webpack-hmr')).toBe('development')
    expect(nextServerMode('/_next/static/development/_buildManifest.js')).toBe('development')
  })
  it('어느 쪽 흔적도 없으면 unknown(통과로 세지 않는다)', () => {
    expect(nextServerMode('<html><body>권한 없음</body></html>')).toBe('unknown')
  })
})

describe('러너 날짜·시간대 도우미(SP5 A — 러너는 주 키를 만들지 않는다, W30)', () => {
  it('todayInTz — 같은 순간이 LA·베를린·UTC 에서 다른 날짜(경계 2026-10-02T03:30Z)', () => {
    const at = new Date('2026-10-02T03:30:00Z')
    expect(todayInTz('UTC', at)).toBe('2026-10-02')
    expect(todayInTz('America/Los_Angeles', at)).toBe('2026-10-01')
    expect(todayInTz('Europe/Berlin', at)).toBe('2026-10-02')
    expect(() => todayInTz('', at)).toThrow()
  })
  it('dowOfIso — 0=일 … 6=토, 형식이 아니면 throw', () => {
    expect(dowOfIso('2026-10-04')).toBe(0)
    expect(dowOfIso('2026-10-05')).toBe(1)
    expect(dowOfIso('2026-10-10')).toBe(6)
    expect(() => dowOfIso('2026/10/04')).toThrow()
  })
  it('storedTimezone — 키가 없으면 제품 기본값 UTC(H2 규칙 ⑤), 문자열이 아니면 UTC', () => {
    expect(storedTimezone({ 'calendar.timezone': 'Europe/Berlin' })).toBe('Europe/Berlin')
    expect(storedTimezone({})).toBe('UTC')
    expect(storedTimezone(null)).toBe('UTC')
    expect(storedTimezone({ 'calendar.timezone': 9 })).toBe('UTC')
  })
  it("plannedPctByName — 머리 '계획%' 열에서 업무명(앞뒤 공백 무시)의 값, 머리가 없으면 throw", async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('WBS')
    ws.addRow(['코드', '업무명', '시작', '종료', '실적%', '계획%'])
    ws.addRow(['1.1', '  합성 1.1', '2026-10-05', '2026-10-16', 0, 60])
    ws.addRow(['1.2', '합성 1.2', '2026-10-19', '2026-10-30', 0, { formula: 'A1', result: 67 }])
    const buf = await wb.xlsx.writeBuffer()
    expect(await plannedPctByName(buf, ['합성 1.1', '합성 1.2'])).toEqual({ '합성 1.1': 60, '합성 1.2': 67 })
    const none = new ExcelJS.Workbook()
    none.addWorksheet('X').addRow(['a'])
    await expect(plannedPctByName(await none.xlsx.writeBuffer(), ['합성 1.1'])).rejects.toThrow('계획%')
  })
})

const O = 'http://127.0.0.1:3201'
const res = (status: number, location: string) => ({ status, headers: new Headers({ location }) })

describe('SP3b E2E 순수 함수(e2e-local 의 sp3b- 단계 — 과제 39 가 브랜치 전용 e2e-sp3b 에서 옮김)', () => {
  it('legacyCases — 옛 여덟 × 쿼리(없음·하나·여럿·인코딩)', () => {
    const cs = legacyCases('acme', { minuteId: 'm1', projectId: 'p1' })
    expect(cs).toContainEqual({ from: '/minutes?view=calendar', to: '/w/acme/minutes?view=calendar' })
    expect(cs).toContainEqual({ from: '/usage?days=7&menu=a&menu=b', to: '/w/acme/usage?days=7&menu=a&menu=b' })
    expect(cs).toContainEqual({ from: '/admin/accounts?project=p1', to: '/w/acme/admin/accounts?project=p1' })
    expect(cs).toContainEqual({ from: '/minutes/m1?block=2&version=v', to: '/w/acme/minutes/m1?block=2&version=v' })
    expect(cs.length).toBeGreaterThanOrEqual(16)
  })
  it('expectLocation — 307·요청 원점·경로·쿼리(상대 Location 도 원점에 풀어 본다)', () => {
    expect(expectLocation(res(307, `${O}/w/acme/minutes?view=x`), O, '/w/acme/minutes?view=x')).toEqual([])
    expect(expectLocation(res(307, '/w/acme/minutes?view=x'), O, '/w/acme/minutes?view=x')).toEqual([])
    expect(expectLocation(res(308, '/w/acme/minutes?view=x'), O, '/w/acme/minutes?view=x')).toEqual(['상태 308 ≠ 307'])
  })
  it('expectLocation — 인코딩 차이(%20 ↔ +)는 같은 값, 다른 호스트·경로·중복 키 순서는 다른 값', () => {
    expect(expectLocation(res(307, '/w/acme/minutes?q=a%20b'), O, '/w/acme/minutes?q=a+b')).toEqual([])
    expect(expectLocation(res(307, 'http://localhost:3201/w/acme/minutes'), O, '/w/acme/minutes')[0]).toMatch(/원점/)
    expect(expectLocation(res(307, '/w/other/minutes'), O, '/w/acme/minutes')[0]).toMatch(/경로/)
    expect(expectLocation(res(307, '/w/acme/usage?menu=b&menu=a'), O, '/w/acme/usage?menu=a&menu=b')[0]).toMatch(/쿼리/)
  })
  it('hiddenVerdict — 404 또는 notFound digest, 센티널이 본문에 있으면 문제', () => {
    expect(hiddenVerdict({ status: 404, html: '' })).toEqual([])
    expect(hiddenVerdict({ status: 200, html: 'x NEXT_HTTP_ERROR_FALLBACK;404 y' }, ['SECRET'])).toEqual([])
    expect(hiddenVerdict({ status: 200, html: 'ok' })[0]).toMatch(/404 가 아니다/)
    expect(hiddenVerdict({ status: 404, html: 'a SECRET b' }, ['SECRET'])[0]).toMatch(/SECRET/)
  })
})

describe('SP3b E2E UI-2b 순수 판정(E5·E7·E10)', () => {
  const MARK = '<button type="button" data-ws-switcher="list" aria-haspopup="menu">A</button>'
  it('switcherVerdict — 소속 둘 이상이면 표지 있음, 하나면 없음, 표지가 둘(768~1023 드로어 이중 마운트)이어도 있음으로 본다', () => {
    expect(switcherVerdict(`<header>${MARK}</header>`, true)).toEqual([])
    expect(switcherVerdict(`${MARK}${MARK}`, true)).toEqual([])
    expect(switcherVerdict('<header><span>A</span></header>', false)).toEqual([])
    expect(switcherVerdict('<header><span>A</span></header>', true)[0]).toMatch(/트리거.*없다/)
    expect(switcherVerdict(`<header>${MARK}</header>`, false)[0]).toMatch(/트리거.*있다/)
  })
  it('issuesLinkVerdict — 켜짐은 링크 있음, 꺼짐은 없음, 내비가 안 그려진 화면은 대조 실패', () => {
    const wbs = '<a href="/p/p1/wbs">WBS</a>'
    const issues = '<a href="/p/p1/issues">이슈</a>'
    expect(issuesLinkVerdict(`${wbs}${issues}`, 'p1', true)).toEqual([])
    expect(issuesLinkVerdict(wbs, 'p1', false)).toEqual([])
    expect(issuesLinkVerdict(wbs, 'p1', true)).toEqual(['이슈 링크가 없다(모듈을 켰는데)'])
    expect(issuesLinkVerdict(`${wbs}${issues}`, 'p1', false)).toEqual(['이슈 링크가 있다(모듈을 껐는데)'])
    expect(issuesLinkVerdict('<p>오류</p>', 'p1', false)[0]).toMatch(/대조 실패/)
    expect(issuesLinkVerdict(`${wbs}<a href="/p/p1/issues/3">x</a>`, 'p1', false)).toEqual([])   // 접두가 같은 다른 경로는 이슈 내비가 아니다
    expect(issuesLinkVerdict(`${wbs}<a href="/p/p2/issues">x</a>`, 'p1', false)).toEqual([])   // 다른 프로젝트의 링크
  })
  it('shellBadgeVerdict — hidden 은 세 배지 모두 null, own 은 검토 대기 수가 숫자', () => {
    const ok = (badges: object) => ({ status: 200, body: { badges } })
    const nulls = { myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null }
    expect(shellBadgeVerdict(ok(nulls), 'hidden')).toEqual([])
    expect(shellBadgeVerdict(ok({ ...nulls, myWorkReview: 0 }), 'hidden')).toEqual(['myWorkReview = 0 (null 이어야 한다)'])
    expect(shellBadgeVerdict(ok({ ...nulls, projectApprovals: 2, projectUnreadAnnouncements: 1 }), 'hidden')).toHaveLength(2)
    expect(shellBadgeVerdict(ok({ ...nulls, myWorkReview: 0 }), 'own')).toEqual([])
    expect(shellBadgeVerdict(ok(nulls), 'own')[0]).toMatch(/숫자/)
    expect(shellBadgeVerdict({ status: 404, body: null }, 'hidden')).toEqual(['상태 404 ≠ 200'])
    expect(shellBadgeVerdict({ status: 200, body: {} }, 'hidden')).toEqual(['응답에 badges 가 없다'])
  })
})

describe('SP3b E2E 픽스처 상수', () => {
  it('duo·B 공용 팀은 SP2 흐름의 계정·A 공용 팀과 겹치지 않는다(단계 18 의 bea meta 팀 단언과 섞이지 않게)', () => {
    expect([A_ADMIN.email, B_ADMIN.email, OUTSIDER.email, INVITEE.email]).not.toContain(DUO.email)
    expect(SP3B_B_TEAM).not.toBe(WS_TEAM)
    expect(normalizeNewTeamCode(SP3B_B_TEAM, EXCEL_HEADER_WORDS)).toEqual({ ok: true, code: SP3B_B_TEAM })
  })
  it('전환기 표지는 앱의 전환기 트리거 원문에 있다(드리프트 감지)', () => {
    expect(readFileSync('src/components/app/WorkspaceSwitcher.tsx', 'utf8')).toContain(SWITCHER_MARK)
  })
})

describe('teamSlotVerdict(SP4 B — teams-color-render)', () => {
  it('category 슬롯(중복 없이)·옛 team 클래스·중립 수를 가른다 — category-fg·-weak 는 슬롯으로 세지 않는다', async () => {
    const { teamSlotVerdict } = await import('../../scripts/lib/e2e.mjs')
    const html = '<i class="h-2 w-2 bg-category-3"></i><b class="text-category-3 text-category-fg bg-category-3-weak"></b><s class="text-team-2 bg-team-4-weak bg-neutral"></s><u class="text-category-3"></u>'
    expect(teamSlotVerdict(html)).toEqual({ slots: ['bg-category-3', 'text-category-3'], legacy: ['bg-team-4-weak', 'text-team-2'], neutral: 1 })
  })
})

describe('SP4 B — E2E teams-color-render 단계(스펙 §6.3)', () => {
  const src = readFileSync('scripts/e2e-local.mjs', 'utf8')
  const at = (n: string) => src.indexOf(`step('${n}'`)
  it('teams-color-render 는 render-pages 뒤·모듈을 끄는 단계 앞이고, 보고서 모달을 Playwright 로 연다', () => {
    expect(at('teams-color-render')).toBeGreaterThan(at('render-pages'))
    expect(at('teams-color-render')).toBeLessThan(at('module-issues-off'))
    expect(src).toContain('[data-wbs-weekly-report]')
    expect(src).toMatch(/step\('teams-color-render', \{ pages: seen \}/)
  })
})
