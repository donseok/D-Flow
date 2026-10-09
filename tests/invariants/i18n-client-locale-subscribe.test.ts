// 클라이언트 컴포넌트가 사전의 t/translate 를 직접 부르면 useLocale() 도 구독한다 — 영어 사전이 늦게 실려도 다시 그린다.
// 클라이언트의 영어 사전(EN)은 LocaleProvider 가 지연 로드한다(src/lib/i18n/dict.ts). 로드 전에는 en 조회가 ko 로 폴백되는데,
// `locale` prop 으로 t(locale, key) 만 부르고 useLocale() 을 구독하지 않는 컴포넌트는 EN 이 실려도 다시 그려지지 않아
// 한국어가 그대로 굳는다(하이드레이션 불일치도 난다). 구독만 하면 된다 — 글자는 넘겨받은 locale 을 그대로 따른다
// (선례: CustomFieldsSettings·IssuePolicyEditor·ProjectAreasManager).
// 규칙: 'use client' 모듈이 '@/lib/i18n/dict' 에서 t(또는 translate 별칭)를 값으로 가져오면, 같은 모듈이 useLocale 도 가져와 부른다.
// 타입만 가져오는 것(import type · `type DictKey`)은 해당이 없다. 의도해서 남긴 것은 EXEMPT 에 파일 → 사유로 닫아 둔다.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse, prologue } from './_ast'
import { walk } from './_walk'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** 의도해서 남긴 예외(닫힌 목록) — 파일 → 사유. 죽은 예외(규칙에 걸리지 않게 된 파일)는 실패한다 */
const EXEMPT: Readonly<Record<string, string>> = {
  'src/app/global-error.tsx': '루트 레이아웃을 대신하는 오류 화면 — LocaleProvider 밖이라 useLocale 이 기본 컨텍스트(ko)만 준다. 자기 locale 을 쿠키에서 직접 읽고 EN 을 직접 로드한다',
  'src/components/providers/LocaleProvider.tsx': '공급자 자신 — useLocale 을 정의하는 파일이며 EN 로드·재렌더를 스스로 맡는다',
}

const DICT_MODULE = /(^|\/)i18n\/dict$/
const PROVIDER_MODULE = /(^|\/)providers\/LocaleProvider$/

interface Finding { directImport: boolean; subscribes: boolean }

/** 파일의 판정 — 클라이언트 모듈이 사전 t 를 값으로 가져오는가(directImport), useLocale 을 가져와 부르는가(subscribes) */
function inspect(file: string, source: string): Finding & { client: boolean } {
  const sf = parse(file, source)
  const client = prologue(sf.statements).includes('use client')
  let directImport = false
  let hookImported = false
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue
    const from = s.moduleSpecifier.text
    const clause = s.importClause
    if (!clause || clause.isTypeOnly) continue
    const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : []
    if (DICT_MODULE.test(from) && named.some(e => !e.isTypeOnly && ['t', 'translate'].includes((e.propertyName ?? e.name).text))) directImport = true
    if (PROVIDER_MODULE.test(from) && named.some(e => !e.isTypeOnly && (e.propertyName ?? e.name).text === 'useLocale')) hookImported = true
  }
  let called = false
  const visit = (n: ts.Node): void => {
    if (called) return
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useLocale') { called = true; return }
    ts.forEachChild(n, visit)
  }
  if (hookImported) visit(sf)
  return { client, directImport, subscribes: hookImported && called }
}

const FILES = walk(SRC)
const RESULT = new Map<string, ReturnType<typeof inspect>>()
for (const f of FILES) {
  const source = readFileSync(f, 'utf8')
  if (!source.includes('i18n/dict')) continue   // 사전을 가져오지 않는 파일은 파싱하지 않는다
  RESULT.set(relative(ROOT, f), inspect(f, source))
}
const violates = (r: ReturnType<typeof inspect>) => r.client && r.directImport && !r.subscribes

describe("'use client' 모듈의 사전 직접 호출 — useLocale 구독", () => {
  it('파일을 실제로 본다(빈 목록으로 통과하지 않는다)', () => {
    expect(FILES.length).toBeGreaterThan(500)
    const direct = [...RESULT.values()].filter(r => r.client && r.directImport)
    expect(direct.length).toBeGreaterThan(15)
    // 이 불변식이 만들어진 계기인 컴포넌트가 규칙의 대상으로 잡힌다
    expect(RESULT.get('src/components/wiki/WikiSearch.tsx')).toMatchObject({ client: true, directImport: true })
    expect(RESULT.get('src/components/settings/CustomFieldsSettings.tsx')).toMatchObject({ client: true, directImport: true, subscribes: true })
  })

  it("'use client' 이면서 사전 t/translate 를 가져오는 모듈은 useLocale() 도 구독한다(예외 목록 제외)", () => {
    const bad = [...RESULT].filter(([f, r]) => violates(r) && !(f in EXEMPT)).map(([f]) => f)
    expect(bad, `useLocale() 구독을 더한다(영어 사전이 늦게 실리면 다시 그리게):\n${bad.join('\n')}`).toEqual([])
  })

  it('예외 목록의 파일은 실제로 규칙에 걸린다(죽은 예외를 남기지 않는다)', () => {
    const dead = Object.keys(EXEMPT).filter(f => !(RESULT.has(f) && violates(RESULT.get(f)!)))
    expect(dead, dead.join('\n')).toEqual([])
  })

  it('예외마다 사유가 있다', () => {
    for (const [file, why] of Object.entries(EXEMPT)) expect(why.trim().length, file).toBeGreaterThan(10)
  })

  it('검사식 — 값 import 만 잡고, 타입만 가져오거나 구독하거나 서버 모듈이면 잡지 않는다', () => {
    const PROVIDER = "import { useLocale } from '@/components/providers/LocaleProvider'\n"
    const hit = (src: string) => violates(inspect('x.tsx', src))
    // 잡는다
    expect(hit("'use client'\nimport { t } from '@/lib/i18n/dict'\nexport const A = () => t('ko', 'a')")).toBe(true)
    expect(hit("'use client'\nimport { t as translate, type Locale } from '@/lib/i18n/dict'\nexport const A = () => translate('ko', 'a')")).toBe(true)
    expect(hit("'use client'\nimport { t } from '../../lib/i18n/dict'\nexport const A = () => t('ko', 'a')")).toBe(true)
    // 훅을 가져오기만 하고 부르지 않는 것도 구독이 아니다
    expect(hit(`'use client'\n${PROVIDER}import { t } from '@/lib/i18n/dict'\nexport const A = () => t('ko', 'a')`)).toBe(true)
    // 잡지 않는다
    expect(hit(`'use client'\n${PROVIDER}import { t } from '@/lib/i18n/dict'\nexport function A() { useLocale(); return t('ko', 'a') }`)).toBe(false)
    expect(hit("'use client'\nimport type { DictKey } from '@/lib/i18n/dict'\nexport const A = (k: DictKey) => k")).toBe(false)
    expect(hit("'use client'\nimport { type DictKey, type Locale } from '@/lib/i18n/dict'\nexport const A = (k: DictKey, l: Locale) => k + l")).toBe(false)
    expect(hit("import { t } from '@/lib/i18n/dict'\nexport const A = () => t('ko', 'a')")).toBe(false)   // 서버 모듈(지시문 없음)
  })
})
