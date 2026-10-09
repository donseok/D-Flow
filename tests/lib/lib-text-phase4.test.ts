// lib 의 동적·검증 문구가 응답 자리에서 화면 언어로 풀린다(i18n 4차 2번) — lib 는 한국어 그대로 만들고(ko 불변), 액션·라우트가 libText·libMessages·failureText 로 옮긴다.
// 진짜 lib 함수가 만든 문구로 본다(사전의 틀이 lib 원문과 어긋나면 여기서 한국어가 샌다).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ guard: vi.fn(), translator: vi.fn(), admin: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.guard, getActor: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.admin }))
vi.mock('@/lib/i18n/server', () => ({ serverTranslator: () => h.translator() }))

import { addTeam } from '@/app/actions/teams'
import { checkNewTeam } from '@/lib/domain/teamName'
import { parseCreditPolicy } from '@/lib/domain/stageCredits'
import { normalizeIssueAnalysisInput } from '@/lib/domain/issueAnalysis'
import { checkCustomRows } from '@/lib/excel/customColumns'
import { EXCEL_HEADER_WORDS } from '@/lib/excel/headerWords'
import { serverKoTranslate, serverTranslatorFor } from '@/lib/i18n/serverDict'
import { failureText, failureTextIn, libMessages, libText } from '@/lib/i18n/serverText'
import { settingDef } from '@/lib/settings/registry'
import { vocabCodeError } from '@/lib/settings/vocabGuard'
import { parseApprovalSteps } from '@/lib/domain/approvalSteps'
import { parseWbsMarkdown, validateWbsDoc } from '@/lib/wbsmd/parse'
import { SERVER_EN, SERVER_KO } from '@/lib/i18n/serverDict'
import type { FieldDef } from '@/lib/domain/customFields'

const en = serverTranslatorFor('en')
const HANGUL = /[가-힣]/
const parseError = (scope: 'workspace' | 'project', key: string, raw: unknown): string => {
  const r = (settingDef as unknown as (s: string, k: string) => { parse: (raw: unknown) => { ok: boolean; error: string } })(scope, key).parse(raw)
  if (r.ok) throw new Error(`${key}: 거부될 값이 통과했다`)
  return r.error
}

beforeEach(() => { vi.clearAllMocks(); h.translator.mockResolvedValue(serverKoTranslate) })

describe('설정 값 검증 문구(src/lib/settings/defs — fieldErrors[].message)', () => {
  const cases: [string, 'workspace' | 'project', string, unknown][] = [
    ['고정 문구', 'workspace', 'branding.product_name', 7],
    ['값이 낀 문구(길이)', 'workspace', 'branding.product_name', 'a'.repeat(41)],
    ['모듈 목록', 'workspace', 'modules.allowed', ['nope']],
    ['도메인', 'workspace', 'invites.allowed_domains', ['a*b.com']],
    ['단계 이름', 'project', 'core.level_labels', []],
    ['로컬 초안', 'workspace', 'security.local_drafts', { allowed: true, retention_days: 99 }],
    ['알림 정책', 'workspace', 'notify.policy', { nope: { enabled: true } }],
    ['보기 기본값', 'project', 'views.default', { wbs: 'grid' }],
  ]
  it.each(cases)('%s — 한국어는 그대로, 영어에는 한글이 없고 낀 값은 그대로 옮겨진다', (_name, scope, key, raw) => {
    const message = parseError(scope, key, raw)
    expect(message).toMatch(HANGUL)
    expect(libText(serverKoTranslate, message)).toBe(message)
    expect(libText(en, message), message).not.toMatch(HANGUL)
  })

  it('낀 값은 글자 그대로 — 길이 한도·모르는 값', () => {
    expect(libText(en, parseError('workspace', 'branding.product_name', 'a'.repeat(41)))).toBe('Must be 1–40 characters.')
    expect(libText(en, parseError('workspace', 'modules.allowed', ['nope']))).toBe('Unknown module: nope')
  })

  it('libMessages — fieldErrors 의 문구만 바꾸고 key 등 다른 칸은 그대로', () => {
    const message = parseError('workspace', 'branding.product_name', 'a'.repeat(41))
    expect(libMessages(en, [{ key: 'branding.product_name', message, refCount: 2 }])).toEqual([{ key: 'branding.product_name', message: 'Must be 1–40 characters.', refCount: 2 }])
    expect(libMessages(serverKoTranslate, [{ key: 'k', message }])).toEqual([{ key: 'k', message }])
  })
})

describe('도메인 검증 문구', () => {
  it('크레딧 정책(stageCredits)', () => {
    const r = parseCreditPolicy({ step: 3, min_gap: 5 })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(libText(serverKoTranslate, r.error)).toBe(r.error)
    expect(libText(en, r.error)).not.toMatch(HANGUL)
  })

  it('이슈 분석(issueAnalysis)', () => {
    const r = normalizeIssueAnalysisInput({} as never)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(libText(serverKoTranslate, r.error)).toBe(r.error)
    expect(libText(en, r.error)).not.toMatch(HANGUL)
  })

  it('어휘(vocabGuard) — 낀 어휘 이름(lib 의 고정 이름)도 영어로', () => {
    const message = vocabCodeError('issues.severities', [], 'gone')!
    expect(message).toContain('심각도')
    expect(libText(serverKoTranslate, message)).toBe(message)
    expect(libText(en, message)).toBe('The selected severity is not used in this project. Refresh and choose another value.')
  })

  it('팀 이름(teamName) — 사용자가 적은 이름은 번역하지 않고 그대로 옮긴다', () => {
    const word = EXCEL_HEADER_WORDS[0]
    const r = checkNewTeam({ name: word, reserved: EXCEL_HEADER_WORDS })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(libText(serverKoTranslate, r.error)).toBe(r.error)
    expect(libText(en, r.error)).toBe(`'${word}' is a reserved word of the Excel template and cannot be used as a team name.`)
  })
})

describe('wbs.md 올리기의 검증 문구(src/lib/wbsmd/parse.ts) — 진짜 파서가 만든 문구로', () => {
  const LEVELS = `levels:
  - { name: Phase, prefix: PH, progress: rollup, owner: pmo, upload: false }
  - { name: System, prefix: SYS, progress: rollup, owner: pmo, upload: false }
  - { name: Pack, prefix: WP, progress: rollup }
  - { name: Task, prefix: TSK, progress: input }
  - { name: Check, prefix: CHK, progress: checklist, optional: true }
`
  // 한 파일에 규칙 위반을 모았다 — 미선언 접두어(헤딩·항목), ID 없는 항목·마일스톤, 골격 층·attach 지점 위, 순번 역행, 필수층 건너뜀,
  // [x]·제목의 %, checklist 의 자식·부모, rollup 잎, 없는 depends·credit, ID 중복
  const BAD = `---
attach: PH-1/SYS-A
${LEVELS}---
## XX-1: undeclared heading
## SYS-B: skeleton level in body
## WP-A: empty pack
## WP-B: pack
- [ ] CHK-9: checklist under a pack
- [ ] no id here
- [M] milestone without id
- [ ] YY-1: undeclared item
- [x] TSK-1: done 50%   credit:nope
  - depends: TSK-404
  - [ ] TSK-2: nested task
  - [ ] CHK-1: check
    - [ ] CHK-2: child of a check
- [ ] TSK-1: duplicate
## SYS-C: another
- [ ] TSK-3: skips the pack level
`
  const messages = (): string[] => {
    const bad = validateWbsDoc(parseWbsMarkdown(BAD), 'pl', 'Planner')
    const noLevels = validateWbsDoc(parseWbsMarkdown('# title\n'), 'skeleton', 'Planner')
    const noAttach = validateWbsDoc(parseWbsMarkdown(`---\n${LEVELS}---\n`), 'pl', 'Planner')
    return [...bad.errors, ...bad.warnings, ...noLevels.errors, ...noAttach.errors]
  }

  it('한국어 로캘은 한 글자도 바뀌지 않고, 영어 로캘에는 한글이 없다 — ID·제품 이름 같은 낀 값은 그대로', () => {
    const all = messages()
    expect(all.length).toBeGreaterThan(15)
    for (const m of all) {
      expect(m).toMatch(HANGUL)
      expect(libText(serverKoTranslate, m)).toBe(m)
      expect(libText(en, m), m).not.toMatch(HANGUL)
    }
    const out = all.map((m) => libText(en, m))
    expect(out).toContain('Duplicate ID: TSK-1')
    expect(out).toContain('TSK-1: the title must not contain an actual % — progress is recorded in Planner.')
    expect(out).toContain('TSK-1: depends target not found (in this file): TSK-404')
    expect(out).toContain('A checklist item needs an ID: "no id here"')
  })

  it('파서의 문구 틀을 빠짐없이 지난다 — 사전에 실린 틀마다 실제로 만들어진 문구가 있다(틀이 lib 와 어긋나면 여기서 빠진다)', () => {
    const out = messages().map((m) => libText(en, m))
    const keys = (Object.keys(SERVER_KO) as (keyof typeof SERVER_KO)[]).filter((k) => k.startsWith('srv.lib.parse.') || k.startsWith('srv.libt.parse.'))
    expect(keys.length).toBe(18)
    const shape = (template: string) => new RegExp(`^${template.split(/\{\w+\}/).map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]+')}$`)
    const unused = keys.filter((k) => !out.some((m) => shape(SERVER_EN[k]).test(m)))
    expect(unused, unused.join('\n')).toEqual([])
  })
})

describe('승인 단계의 승인자 문구(approvalSteps) — 값 사이의 접속어까지 옮긴다', () => {
  it("'A 또는 B' → 'A or B'. 승인자 값(코드)은 그대로", () => {
    const r = parseApprovalSteps([{ code: 'review', label: null, approver: 'nobody' }])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toBe('1번째 단계 승인자는 subtree_or_admin 또는 admin 여야 합니다.')
    expect(libText(serverKoTranslate, r.error)).toBe(r.error)
    expect(libText(en, r.error)).toBe('The approver of step 1 must be subtree_or_admin or admin.')
  })
})

describe('가져오기 행 오류(src/lib/excel)', () => {
  const defs: FieldDef[] = [
    { key: 'budget', label: '예산', type: 'number', required: false, active: true, showInList: false, editor: 'member', sort: 0, limits: { min: 0, max: 10 } } as unknown as FieldDef,
    { key: 'old', label: '옛 필드', type: 'text', required: false, active: false, showInList: false, editor: 'member', sort: 1 } as unknown as FieldDef,
  ]
  it('행 오류의 사유·필드 유형 이름은 영어로, 필드 이름·셀 값(사용자 자료)은 그대로', () => {
    const { errors } = checkCustomRows([{ excelRow: 7, custom: { budget: '많이', old: 'x', nope: 1 } }], defs)
    expect(errors.length).toBe(3)
    const ko = errors.map((e) => e.message)
    expect(libMessages(serverKoTranslate, errors).map((e) => e.message)).toEqual(ko)
    const out = libMessages(en, errors)
    expect(out.map((e) => e.excelRow)).toEqual([7, 7, 7])
    const text = out.map((e) => e.message).join('\n')
    expect(text).toContain("'예산' — Not in number format: 많이")          // 필드 이름·셀 값은 사용자 자료
    expect(text).toContain("'옛 필드' is an inactive field")
    expect(text).toContain("'nope' is not a custom field of this project")
    expect(text.replace(/'예산'|'옛 필드'|많이/g, '')).not.toMatch(HANGUL)
  })
})

describe('failureText — lib 결과를 통째로 돌려주는 자리', () => {
  it('실패 결과의 error·fieldErrors[].message 만 바꾸고 나머지(code·자료)는 그대로', () => {
    const message = parseError('workspace', 'branding.product_name', 7)
    const r = { ok: false as const, code: 'CONFIG_INVALID', error: '권한 없음', fieldErrors: [{ key: 'k', message }], rows: [1] }
    expect(failureText(en, r)).toEqual({ ok: false, code: 'CONFIG_INVALID', error: 'No permission', fieldErrors: [{ key: 'k', message: 'Must be a string.' }], rows: [1] })
    expect(failureText(serverKoTranslate, r)).toEqual(r)
    expect(failureTextIn('en', { ok: false, error: '프로젝트를 불러오지 못했습니다.' })).toEqual({ ok: false, error: 'Could not load the projects.' })
  })

  it('성공 결과·실패 꼴이 아닌 값은 받은 그대로(같은 객체)', () => {
    const ok = { ok: true, rows: [] as unknown[] }
    expect(failureText(en, ok)).toBe(ok)
    expect(failureText(en, null)).toBeNull()
    expect(failureText(en, '권한 없음')).toBe('권한 없음')
  })

  it('액션 — lib 검증 결과를 통째로 돌려주는 경로(addTeam → checkNewTeam)가 영어 로캘에서 영어다', async () => {
    h.guard.mockResolvedValue({ ok: true, actor: { userId: 'u1', isSuperuser: false } })
    h.translator.mockResolvedValue(en)
    const res = await addTeam('ws-1', '   ')
    expect(res).toEqual({ ok: false, error: 'Enter a team name.' })
    expect(h.admin).not.toHaveBeenCalled()
  })

  it('액션 — 한국어 로캘에서는 lib 문구 그대로', async () => {
    h.guard.mockResolvedValue({ ok: true, actor: { userId: 'u1', isSuperuser: false } })
    expect(await addTeam('ws-1', '   ')).toEqual({ ok: false, error: '팀 이름을 입력하세요.' })
  })
})
