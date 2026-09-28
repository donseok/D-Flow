import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import {
  INVITEE, LEVEL_LABELS, SP1_TEAMS, TEMPLATE_HEADER, TRACE_WORDS, actionResult, cookieHeader, dispositionFilename,
  e2eBaseUrl, e2eRows, encodeActionArgs, findActionId, findTraces, inviteInput, inviteTokenFromUrl, leafCodes, localAppUrl,
  localClientEnv, meetingInput, notFoundRendered, pageProblems, rosterPlan, rosterView, signupInput, teamIdsByCode, toCell,
  ERR_DENIED, PAGE_MARKERS, redactInviteTokens, streamedErrorDigests,
  A_ADMIN, B_ADMIN, OUTSIDER, WS_TEAM, OTHER_WORKSPACE, inWorkspaceStorage, leakedIds, minuteBodyPath, minuteInput, minuteSource,
  presentTexts, workspaceAdminAccountInput,
} from '../../scripts/lib/e2e.mjs'
import { makeStoragePath, parseStoragePath } from '@/lib/domain/storagePath'
import { isMinuteFilePathValid, validateMinuteFields } from '@/lib/domain/minutes'
import { isValidEmail } from '@/lib/domain/validate'
import { ERR_DENIED as APP_ERR_DENIED } from '@/lib/authz/errors'
import { FORBIDDEN_REFS } from '../../scripts/lib/targets.mjs'
import { TEMPLATE_HEADER as APP_TEMPLATE_HEADER } from '@/lib/excel/template'
import { MEETING_CATEGORIES, RECURRENCE_ORDER } from '@/lib/domain/meetings'
import { isInviteToken, validateSignupInput } from '@/lib/domain/invites'
import { normalizeNewTeamCode } from '@/lib/domain/teams'

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
    for (const code of [...SP1_TEAMS.A, ...SP1_TEAMS.B]) expect(normalizeNewTeamCode(code)).toEqual({ ok: true, code })
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

describe('PAGE_MARKERS·ERR_DENIED — 앱 원본과의 드리프트', () => {
  it('문구 표식이 원본 컴포넌트에 그대로 있다', () => {
    const src = {
      degraded: 'src/components/app/DegradedNotice.tsx',
      'error-boundary': 'src/app/(app)/error.tsx',
    } as Record<string, string>
    for (const [name, marker] of PAGE_MARKERS) {
      if (name === 'next-error') continue
      expect(readFileSync(src[name], 'utf8')).toContain(marker)
    }
  })
  it('쓰기 거부 문구가 앱의 ERR_DENIED 와 같다', () => {
    expect(ERR_DENIED).toBe(APP_ERR_DENIED)
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
    expect(normalizeNewTeamCode(WS_TEAM)).toEqual({ ok: true, code: WS_TEAM })
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
