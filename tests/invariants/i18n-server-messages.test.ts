// 서버가 만들어 화면에 그대로 보이는 문구(서버 액션·내부 API 의 error·message·warning·notice)에 한국어 리터럴이 되돌아오지 못하게 한다(i18n 3차).
// 제품은 한국어 전용이지만(2026-10-10 결정) 문구는 리터럴로 흩지 않고 사전(src/lib/i18n/dict/serverUi.ts) 한 곳에 둔다 —
// `const t = await serverTranslator()` 로 읽는다. TS 파서로 본다(주석은 보지 않는다):
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
import { SERVER_KO, serverKoTranslate } from '@/lib/i18n/serverDict'
import { CONFIG_MESSAGES, CONFIG_TEXT_KEY, IN_USE_KO, configText, inUseFieldErrors, mapDbError } from '@/lib/settings/errors'
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

describe('설정 계열 고정 문구 — 상수와 서버 사전(err.config.*)의 글자가 같다', () => {
  it('CONFIG_MESSAGES 의 문구는 모두 사전 키가 있고, configText·mapDbError 는 t 를 넘기든 아니든 같은 글자를 낸다', () => {
    for (const text of Object.values(CONFIG_MESSAGES)) {
      expect(Object.hasOwn(CONFIG_TEXT_KEY, text), text).toBe(true)
      expect(configText(serverKoTranslate, text)).toBe(text)
    }
    const busy = { code: '40P01', message: 'deadlock detected' }
    expect(mapDbError(busy)?.message).toBe(CONFIG_MESSAGES.CONFIG_BUSY)
    expect(mapDbError(busy, serverKoTranslate)?.message).toBe(CONFIG_MESSAGES.CONFIG_BUSY)
    expect(mapDbError({ message: 'WORKFLOW_COLUMNS_RPC_ONLY' }, serverKoTranslate)?.message).toBe(ERR_DENIED)
    expect(mapDbError({ message: 'WORKFLOW_COLUMNS_RPC_ONLY' })?.message).toBe(ERR_DENIED)
  })
})

describe('서버 사전 — 클라이언트 번들에 실리지 않는다', () => {
  const SERVER_MODULES = /from '(@\/lib\/i18n\/|\.\.?\/(dict\/)?)(serverDict|serverText|server|serverUi)'/
  /** 값 import 만 — `import type …` 은 번들에 남지 않는다 */
  const valueImports = (source: string): string[] => source.split('\n').filter(l => /^\s*import\b/.test(l) && !/^\s*import type\b/.test(l) && SERVER_MODULES.test(l))

  it('서버 키와 공용 키는 겹치지 않고, 공용 사전(ko.ts)에는 서버 문구가 없다', () => {
    const both = Object.keys(SERVER_KO).filter(k => k in KO)
    expect(both, both.join(', ')).toEqual([])
    expect(Object.keys(SERVER_KO).length).toBeGreaterThan(500)
  })

  it('서버 번역 함수는 서버 키도 공용 키도 문구로 푼다 — 키가 그대로 새지 않는다', () => {
    expect(serverKoTranslate('err.config.busy')).toBe(CONFIG_MESSAGES.CONFIG_BUSY)
    expect(serverKoTranslate('common.none')).toBe(KO['common.none'])
  })

  it('영어 사전 파일을 다시 만들지 않는다(제품은 한국어 전용 — 2026-10-10 결정)', () => {
    const en = walk(join(ROOT, 'src/lib/i18n'), undefined, /\.ts$/).filter(f => /(\.en\.ts|\/en\.ts)$/.test(f)).map(f => relative(ROOT, f))
    expect(en).toEqual([])
  })

  it('클라이언트 쪽 사전 진입점(dict.ts·dict/ko.ts·translate.ts)은 서버 사전·서버 번역 모듈을 가져오지 않는다', () => {
    for (const f of ['src/lib/i18n/dict.ts', 'src/lib/i18n/dict/ko.ts', 'src/lib/i18n/translate.ts', 'src/lib/i18n/format.ts', 'src/lib/i18n/particle.ts']) {
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
    const importers = walk(join(ROOT, 'src')).filter(f => /from '[^']*(serverDict|dict\/serverUi|\.\/serverUi)'/.test(
      readFileSync(f, 'utf8').split('\n').filter(l => !/^\s*import type\b/.test(l)).join('\n'))).map(f => relative(ROOT, f)).sort()
    expect(importers).toEqual(['src/lib/i18n/server.ts', 'src/lib/i18n/serverDict.ts'])
    expect(readFileSync(join(ROOT, 'src/lib/i18n/serverDict.ts'), 'utf8')).toMatch(/^import 'server-only'$/m)
    expect(readFileSync(join(ROOT, 'src/lib/i18n/serverText.ts'), 'utf8')).toMatch(/^import 'server-only'$/m)
  })

  it('설정의 사용 중 거부 문구 — 폴백 틀과 서버 사전의 글자가 같다', () => {
    for (const [key, text] of Object.entries(IN_USE_KO)) expect((SERVER_KO as Record<string, string>)[key], key).toBe(text)
    const detail = JSON.stringify({ key: 'attendance.types', code: 'x', count: 3, reason: 'removed' })
    expect(inUseFieldErrors(detail, serverKoTranslate)[0].message).toBe(inUseFieldErrors(detail)[0].message)
  })
})
