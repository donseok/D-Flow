// 서버가 만들어 화면에 그대로 보이는 문구(서버 액션·내부 API 의 error·message·warning·notice)에 한국어 리터럴이 되돌아오지 못하게 한다(i18n 3차).
// 문구는 사전(src/lib/i18n/dict/serverUi*.ts)에 두고 `const t = await serverTranslator()` 로 읽는다 — 요청의 로캘 쿠키를 따르고,
// 요청 범위 밖(워커·단위 테스트)에서는 한국어다. TS 파서로 본다(주석은 보지 않는다):
//   ① `error`·`message`·`warning`·`notice` 속성의 값에 한국어 문자열 리터럴(템플릿 포함)이 직접 온다 — `a ? '…' : '…'`·`x ?? '…'`·`'…' + y` 도 따라가 본다.
//      호출 인자는 보지 않는다(`failWith('로그 머리', err, t(…))` 의 머리는 로그다).
//   ② 내부 API 라우트의 응답 도우미(`jsonError`·`apiFail`·`apiBadRequest`·`apiInternalError`)에 한국어 리터럴을 직접 넘긴다.
// 대상은 `src/app/actions/**` 전부와 화면이 세션으로 부르는 내부 API 라우트다. 외부 계약 API(`/api/v1/**` — 토큰 인증, 응답 문구가 계약 문서에 실려 있고
// 호출자가 사람이 아니다)·크론·워커는 한국어 그대로라 대상이 아니다. 남긴 자리는 ALLOW 에 파일 → 사유 → 상한으로 닫아 둔다(죽은 예외는 실패).
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'
import { KO } from '@/lib/i18n/dict/ko'
import { EN } from '@/lib/i18n/dict/en'
import { SERVER_EN, SERVER_KO, serverKoTranslate, serverTranslatorFor } from '@/lib/i18n/serverDict'
import { libText } from '@/lib/i18n/serverText'
import { CONFIG_MESSAGES, CONFIG_TEXT_KEY, IN_USE_KO, configText, inUseFieldErrors, mapDbError } from '@/lib/settings/errors'
import { REASON_TEXT, SKIPPED_WARN, ERR_TRANSITION_RPC } from '@/lib/agent/workflowEvent'
import * as teamOps from '@/lib/teams/teamOps'
import { ERR_DENIED } from '@/lib/authz/errors'

const ROOT = process.cwd()
const HANGUL = /[가-힣]/
const PROPS: ReadonlySet<string> = new Set(['error', 'message', 'warning', 'notice'])
const SINKS = /^(jsonError|apiFail|apiBadRequest|apiInternalError)$/

/** 화면이 세션으로 부르는 내부 API — 여기 없는 라우트(`v1/**`·`cron/**`·`wiki/worker`·`track`·`health` 등)는 한국어 그대로다 */
const INTERNAL_API = ['chat', 'export', 'import', 'issue-analysis', 'minutes', 'prefs', 'report', 'shell', 'wiki/ask', 'wiki/reindex', 'wiki/summarize', 'brand', 'nav']

/** 의도해서 남긴 자리(닫힌 목록) — max 는 그 파일의 지금 개수. 줄이는 것은 자유, 늘리려면 사유를 고친다 */
const ALLOW: Readonly<Record<string, { why: string; max: number }>> = {
}

interface Hit { line: number; text: string }

/** 값 식에서 직접 닿는 한국어 리터럴 — 호출·함수 안으로는 들어가지 않는다 */
function directKorean(e: ts.Expression, sf: ts.SourceFile, out: Hit[]): void {
  const hit = (n: ts.Node) => out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: n.getText(sf).replace(/\s+/g, ' ').slice(0, 90) })
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) { if (HANGUL.test(e.text)) hit(e); return }
  if (ts.isTemplateExpression(e)) {
    if (HANGUL.test(e.head.text) || e.templateSpans.some(s => HANGUL.test(s.literal.text))) hit(e)
    else for (const s of e.templateSpans) directKorean(s.expression, sf, out)
    return
  }
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isSatisfiesExpression(e)) return directKorean(e.expression, sf, out)
  if (ts.isConditionalExpression(e)) { directKorean(e.whenTrue, sf, out); directKorean(e.whenFalse, sf, out); return }
  if (ts.isBinaryExpression(e)) { directKorean(e.left, sf, out); directKorean(e.right, sf, out) }
}

function serverMessageLiterals(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const out: Hit[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && PROPS.has(n.name.getText(sf))) directKorean(n.initializer, sf, out)
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && SINKS.test(n.expression.text)) for (const a of n.arguments) directKorean(a, sf, out)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const FILES = [
  ...walk(join(ROOT, 'src/app/actions'), undefined, /\.ts$/),
  ...INTERNAL_API.flatMap(d => walk(join(ROOT, 'src/app/api', d), undefined, /route\.ts$/)),
]
const HITS = new Map<string, Hit[]>()
for (const f of FILES) {
  const source = readFileSync(f, 'utf8')
  if (!HANGUL.test(source)) continue
  const hits = serverMessageLiterals(f, source)
  if (hits.length) HITS.set(relative(ROOT, f), hits)
}

describe('서버 문구 — 액션·내부 API 의 error·message·warning·notice 에 한국어 리터럴이 직접 오지 않는다', () => {
  it('대상 파일을 실제로 본다(빈 목록으로 통과하지 않는다)', () => {
    expect(FILES.filter(f => f.includes('/app/actions/')).length).toBeGreaterThan(40)
    expect(FILES.filter(f => f.includes('/app/api/')).length).toBeGreaterThan(15)
  })

  it('예외 목록 밖의 파일에 한국어 문구 리터럴이 없다 — 사전 키로 옮기고 serverTranslator 로 읽는다', () => {
    const found: string[] = []
    for (const [file, hits] of HITS) {
      if (file in ALLOW) continue
      for (const h of hits) found.push(`${file}:${h.line}: ${h.text}`)
    }
    expect(found, found.join('\n')).toEqual([])
  })

  it('예외 파일의 개수는 상한을 넘지 않고, 예외 파일에는 실제로 한국어 문구가 있다(죽은 예외 금지)', () => {
    const over = Object.entries(ALLOW).filter(([f, { max }]) => (HITS.get(f)?.length ?? 0) > max).map(([f, { max }]) => `${f}: ${HITS.get(f)!.length} > ${max}`)
    const dead = Object.keys(ALLOW).filter(f => !HITS.has(f))
    expect(over, over.join('\n')).toEqual([])
    expect(dead, dead.join('\n')).toEqual([])
    for (const [file, { why, max }] of Object.entries(ALLOW)) { expect(why.trim().length, file).toBeGreaterThan(5); expect(max, file).toBeGreaterThan(0) }
  })

  it('검사식 — 속성 값·삼항·?? ·템플릿·응답 도우미 인자는 잡고, 주석·로그·호출 인자·사전 키·상수는 잡지 않는다', () => {
    const sample = `
      // error: '주석의 한국어'
      const a = { ok: false, error: '저장하지 못했습니다.' }
      const b = { error: cond ? '하나' : t('err.x'), warning: x ?? \`\${n}건 실패\`, detail: '저장되는 글자' }
      const c = { error: failWith('로그 머리', err, t('err.y')), message: ERR_DENIED, notice: t('srv.z') }
      console.error('[x] 조회 실패')
      return jsonError('프로젝트 누락', 400)`
    expect(serverMessageLiterals('sample.ts', sample).map(h => h.text)).toEqual(["'저장하지 못했습니다.'", "'하나'", '`${n}건 실패`', "'프로젝트 누락'"])
  })
})

/** 문구 자리에 감싸지 않고 와도 되는 lib 상수의 출처 — 코드 겸용 문구(가드 결과: denyStatus·화면이 문구로 비교)와 화면이 문구 → 키 표로 직접 고르는 문구 */
const RAW_CONST_SOURCES: ReadonlySet<string> = new Set(['@/lib/authz/errors', '@/lib/wbs/actionErrors', '@/lib/attachments/removeErrors'])
/** 표에 상수를 그대로 실어 두고 쓰는 자리에서 푸는 곳(닫힌 목록) */
const RAW_CONST_ALLOW: Readonly<Record<string, { why: string; names: readonly string[] }>> = {
  'src/app/actions/projectAreas.ts': { why: 'AREA_TOKENS 표의 message — 응답에 실을 때 libText(tr, f.message) 로 푼다', names: ['ERR_AREA_CODE_IMMUTABLE', 'ERR_ISSUE_AREA_CODE'] },
  'src/app/api/import/execute/route.ts': { why: 'RPC_TOKENS 표의 message — rpcFail 이 configText 로 풀어 넘긴다', names: ['ERR_COMMAND_REUSED'] },
}

/** 문구 속성의 값으로 감싸지 않은 채 오는 lib 의 대문자 상수(`ERR_X`·`REASON_TEXT.x`) — [이름, 출처] */
function rawLibConstants(file: string, source: string): [string, string][] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const from = new Map<string, string>()
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) from.set(el.name.text, st.moduleSpecifier.text)
    }
  }
  const out: [string, string][] = []
  const direct = (e: ts.Expression): void => {
    const id = ts.isIdentifier(e) ? e : (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) && ts.isIdentifier(e.expression) ? e.expression : null
    if (id) { const src = from.get(id.text); if (/^[A-Z][A-Z0-9_]+$/.test(id.text) && src?.startsWith('@/lib/')) out.push([id.text, src]); return }
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) return direct(e.expression)
    if (ts.isConditionalExpression(e)) { direct(e.whenTrue); direct(e.whenFalse); return }
    if (ts.isBinaryExpression(e)) { direct(e.left); direct(e.right) }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAssignment(n) && PROPS.has(n.name.getText(sf))) direct(n.initializer)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('서버 문구 — lib 의 한국어 문구 상수를 감싸지 않고 응답에 싣지 않는다', () => {
  const RAW = new Map<string, [string, string][]>()
  for (const f of FILES) {
    const hits = rawLibConstants(f, readFileSync(f, 'utf8')).filter(([, src]) => !RAW_CONST_SOURCES.has(src))
    if (hits.length) RAW.set(relative(ROOT, f), hits)
  }

  it('문구 속성에 오는 lib 상수는 libText·configText·textBy 로 감싼다(가드 결과·화면 대응 표의 문구는 예외)', () => {
    const found: string[] = []
    for (const [file, hits] of RAW) for (const [name, src] of hits) {
      if (RAW_CONST_ALLOW[file]?.names.includes(name)) continue
      found.push(`${file}: ${name} (${src})`)
    }
    expect(found, found.join('\n')).toEqual([])
  })

  it('예외는 실제로 쓰이고 있다(죽은 예외 금지)', () => {
    const dead = Object.entries(RAW_CONST_ALLOW).flatMap(([file, { names }]) => names.filter(n => !RAW.get(file)?.some(([name]) => name === n)).map(n => `${file}: ${n}`))
    expect(dead, dead.join('\n')).toEqual([])
  })

  it('검사식 — 맨 상수·표 접근은 잡고, 감싼 것·지역 상수·소문자 이름은 잡지 않는다', () => {
    const sample = `
      import { ERR_TEAM_MERGE } from '@/lib/teams/teamOps'
      import { REASON_TEXT } from '@/lib/agent/workflowEvent'
      import { ERR_DENIED } from '@/lib/authz/errors'
      const ERR_LOCAL = 'srv.x'
      const a = { error: ERR_TEAM_MERGE, warning: ok ? REASON_TEXT.conflict : libText(t, ERR_TEAM_MERGE), message: ERR_DENIED, notice: t(ERR_LOCAL) }`
    expect(rawLibConstants('sample.ts', sample)).toEqual([['ERR_TEAM_MERGE', '@/lib/teams/teamOps'], ['REASON_TEXT', '@/lib/agent/workflowEvent'], ['ERR_DENIED', '@/lib/authz/errors']])
  })
})

describe('lib 고정 문구 — 상수는 한국어 그대로, 화면에 내보낼 때 사전에서 거꾸로 찾는다', () => {
  const en = serverTranslatorFor('en')
  const libKeys = (Object.entries(SERVER_KO) as [string, string][]).filter(([k]) => k.startsWith('srv.lib.'))

  it('사전의 srv.lib.* 문구는 lib 원문에 그대로 있다(lib 문구를 고치면 사전도 같이 고친다 — 어긋나면 영어 화면에 한국어가 샌다)', () => {
    expect(libKeys.length).toBeGreaterThan(100)
    const sources = walk(join(ROOT, 'src/lib'), undefined, /\.tsx?$/).filter(f => !f.includes('/i18n/dict/')).map(f => readFileSync(f, 'utf8')).filter(s => HANGUL.test(s))
    // 원문의 따옴표 이스케이프(\\')를 풀어 대조한다
    const flat = sources.map(s => s.replace(/\\'/g, "'")).join('\n')
    const gone = libKeys.filter(([, text]) => !flat.includes(text)).map(([k, text]) => `${k}: ${text}`)
    expect(gone, gone.join('\n')).toEqual([])
  })

  it('libText 는 표에 있는 문구를 요청의 언어로 바꾸고, 없는 문구·가드 결과·빈 값은 그대로 둔다', () => {
    expect(libText(en, ERR_TRANSITION_RPC)).not.toMatch(HANGUL)
    expect(libText(serverKoTranslate, ERR_TRANSITION_RPC)).toBe(ERR_TRANSITION_RPC)
    expect(libText(en, ERR_DENIED)).toBe(ERR_DENIED)          // 가드 결과는 코드 겸용 — 옮기지 않는다
    expect(libText(en, 'duplicate key value')).toBe('duplicate key value')
    expect(libText(en, null)).toBeNull()
    expect(libText(en, undefined)).toBeUndefined()
  })

  it('이름으로 가져다 쓰는 lib 문구 표는 빠짐없이 영어로 풀린다(워크플로 사유·경고, 팀 조작)', () => {
    const texts = [
      ...Object.entries(REASON_TEXT).filter(([code]) => code !== 'item_not_found').map(([, v]) => v),   // '항목 없음' 은 화면이 wbsErrorKey 로 고른다
      ...Object.values(SKIPPED_WARN),
      ...Object.entries(teamOps).filter(([name, v]) => /^(ERR|NOTICE)_/.test(name) && typeof v === 'string').map(([, v]) => v as string),
    ]
    expect(texts.length).toBeGreaterThan(30)
    const leaked = texts.filter(text => HANGUL.test(libText(en, text) ?? ''))
    expect(leaked, leaked.join('\n')).toEqual([])
  })

  it('설정 계열 고정 문구(CONFIG_MESSAGES·mapDbError)는 configText·t 인자로 영어가 되고, 인자를 넘기지 않으면 종전 한국어다', () => {
    for (const text of Object.values(CONFIG_MESSAGES)) {
      expect(Object.hasOwn(CONFIG_TEXT_KEY, text), text).toBe(true)
      expect(configText(en, text)).not.toMatch(HANGUL)
    }
    const busy = { code: '40P01', message: 'deadlock detected' }
    expect(mapDbError(busy)?.message).toBe(CONFIG_MESSAGES.CONFIG_BUSY)
    expect(mapDbError(busy, en)?.message).not.toMatch(HANGUL)
    expect(mapDbError({ message: 'WEEKLY_AREAS_REQUIRED: x' }, en)?.message).not.toMatch(HANGUL)
    expect(mapDbError({ message: 'WORKFLOW_COLUMNS_RPC_ONLY' }, en)?.message).toBe(ERR_DENIED)   // 가드 문구는 그대로
  })
})

describe('서버 사전 — 클라이언트 번들에 실리지 않고, ko·en 이 맞는다', () => {
  const SERVER_MODULES = /from '(@\/lib\/i18n\/|\.\.?\/(dict\/)?)(serverDict|serverText|server|serverUi|serverUi\.en)'/
  /** 값 import 만 — `import type …` 은 번들에 남지 않는다 */
  const valueImports = (source: string): string[] => source.split('\n').filter(l => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l) && SERVER_MODULES.test(l))

  it('서버 키와 공용 키는 겹치지 않고, 공용 사전(ko.ts·en.ts)에는 서버 문구가 없다', () => {
    const both = Object.keys(SERVER_KO).filter(k => k in KO || k in EN)
    expect(both, both.join(', ')).toEqual([])
    expect(Object.keys(SERVER_KO).length).toBeGreaterThan(800)
  })

  it('ko·en 의 키 집합과 치환 자리({이름})가 같다', () => {
    const ko = SERVER_KO as Record<string, string>, en = SERVER_EN as Record<string, string>
    expect(Object.keys(ko).filter(k => !(k in en))).toEqual([])
    expect(Object.keys(en).filter(k => !(k in ko))).toEqual([])
    const slots = (s: string) => [...new Set(s.match(/\{\w+\}/g) ?? [])].sort().join(',')
    const diff = Object.entries(ko).filter(([k, v]) => slots(v) !== slots(en[k])).map(([k, v]) => `${k}: ko[${slots(v)}] en[${slots(en[k])}]`)
    expect(diff, diff.join('\n')).toEqual([])
  })

  it('폴백(요청 범위 밖)도 서버 키를 한국어 문구로 푼다 — 키가 그대로 새지 않는다', () => {
    expect(serverKoTranslate('err.config.busy')).toBe(CONFIG_MESSAGES.CONFIG_BUSY)
    expect(serverTranslatorFor('en')('err.config.busy')).not.toMatch(HANGUL)
    expect(serverKoTranslate('common.none')).toBe(KO['common.none'])   // 공용 키도 같은 함수로
  })

  it('클라이언트 쪽 사전 진입점(dict.ts·dict/ko.ts·dict/en.ts·translate.ts)은 서버 사전·서버 번역 모듈을 가져오지 않는다', () => {
    for (const f of ['src/lib/i18n/dict.ts', 'src/lib/i18n/dict/ko.ts', 'src/lib/i18n/dict/en.ts', 'src/lib/i18n/translate.ts', 'src/lib/i18n/format.ts', 'src/lib/i18n/particle.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf8').split('\n').filter(l => /^\s*import\b/.test(l) && SERVER_MODULES.test(l)), f).toEqual([])
    }
  })

  it("'use client' 파일과 클라이언트가 가져오는 설정 오류 모듈은 서버 사전을 값으로 import 하지 않는다(타입 import 만)", () => {
    const client = walk(join(ROOT, 'src')).filter(f => /^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8')))
    expect(client.length).toBeGreaterThan(100)
    const bad = [...client, join(ROOT, 'src/lib/settings/errors.ts'), join(ROOT, 'src/lib/errors/dbFail.ts')]
      .flatMap(f => valueImports(readFileSync(f, 'utf8')).map(l => `${relative(ROOT, f)}: ${l.trim()}`))
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('서버 사전을 값으로 가져오는 곳은 서버 전용 모듈뿐이다(src 전체 — 닫힌 목록)', () => {
    const importers = walk(join(ROOT, 'src')).filter(f => /from '[^']*(serverDict|dict\/serverUi(\.en)?|\.\/serverUi(\.en)?)'/.test(
      readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*import type\b/.test(l)).join('\n'))).map(f => relative(ROOT, f)).sort()
    expect(importers).toEqual(['src/lib/i18n/server.ts', 'src/lib/i18n/serverDict.ts', 'src/lib/i18n/serverText.ts'])
    for (const f of ['src/lib/i18n/serverDict.ts', 'src/lib/i18n/serverText.ts']) expect(readFileSync(join(ROOT, f), 'utf8'), f).toMatch(/^import 'server-only'$/m)
  })

  it('설정의 사용 중 거부 문구 — 한국어 폴백 틀과 서버 사전의 글자가 같고, t 를 넘기면 영어다', () => {
    for (const [key, text] of Object.entries(IN_USE_KO)) expect((SERVER_KO as Record<string, string>)[key], key).toBe(text)
    const detail = JSON.stringify({ key: 'attendance.types', code: 'x', count: 3, reason: 'removed' })
    expect(inUseFieldErrors(detail)[0].message).toMatch(HANGUL)
    expect(inUseFieldErrors(detail, serverTranslatorFor('en'))[0].message).not.toMatch(HANGUL)
  })
})
