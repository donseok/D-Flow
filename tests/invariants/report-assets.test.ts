// 보고서 양식 자산의 불변식(SP6 정리). src/lib/report/assets 에는 제품 기본 양식 4종(default/)만 있다 — 원본 리포에서 온
// 양식 파일(샘플 문구가 든 pptx)과 그 좌표에 묶인 옛 렌더러는 지웠고 되살리지 않는다(docs/baseline/sp6-issue-analysis-decision.md).
// 기본 양식은 scripts/forms/build-defaults.mjs 가 다른 Office 파일을 읽지 않고 만든다 — 그래서 물려받은 흔적이 들어올 길이 없다.
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { FORM_FORMAT, type FormKind } from '@/lib/report/engine/types'
import { defaultFormAssetPath } from '@/lib/report/forms/loadTemplate'
import { walk } from './_walk'

const ASSETS = 'src/lib/report/assets'
const KINDS = Object.keys(FORM_FORMAT) as FormKind[]
const OFFICE = /\.(pptx|potx|ppt|xlsx|xltx|xls|docx)$/i

// 일부러 난독화한 거부 목록: 원 고객사·원 브랜드·원 샘플 ID 토큰을 유니코드 이스케이프로 적고 실행 시 조립한다.
// 평범한 리포 검색에 고객사명이 걸리지 않게 하려는 것이니 글자로 풀어 적지 않는다.
// 모든 zip 항목(XML·rels·docProps·테마)에서 utf8·utf16le 로 0건이어야 한다(대소문자 무시).
const DENY_TOKENS = [
  '\u0064\u0063\u0075\u0062\u0065', '\u0064\u002d\u0063\u0075\u0062\u0065',
  '\u0064\u006f\u006e\u0067\u006b\u0075\u006b', '\ub3d9\uad6d', '\uc528\uc5e0', '\uc81c\uac15',
  '\ud640\ub529\uc2a4', '\uc2dc\uc2a4\ud15c\uc988', '\uc804\ub7b5\ud300',
  '\u006c\u0075\u0078\u0074\u0065\u0065\u006c', '\u0061\u0070\u0070\u0073\u0074\u0065\u0065\u006c',
  '\u0073\u0074\u0065\u0065\u006c\u0073\u0068\u006f\u0070',
  '\u0065\u0062\u0069\u007a', '\u0065\u002d\u0062\u0069\u007a',
  '\u0037\u0030\uc8fc\ub144', '\ub9c8\uc2a4\ud130\ud50c\ub79c', '\u0050\u0049\u002d\u0049\u002d',
]
// 두 글자 약칭은 텍스트 항목에서만, 단어 경계·대소문자 구분으로 본다.
const DENY_WORD = 'DK'
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
const DENY_RE = new RegExp(DENY_TOKENS.map(escapeRe).join('|'), 'gi')
const DENY_WORD_RE = new RegExp(`\\b${DENY_WORD}\\b`, 'g')
const TEXT_PART = /\.(xml|rels|vml)$/
// 원 양식의 브랜드 색 둘 — 같은 값이 다시 들어오면 안 된다.
const BRAND_COLOR_RE = /\bval="(?:002452|C51F2A)"/i

describe('보고서 양식 자산 — default/ 의 4종뿐', () => {
  it('assets 아래의 파일은 양식 종류마다 하나인 기본 양식이 전부다', () => {
    const files = walk(join(process.cwd(), ASSETS), undefined, /^[^.]/).map((f) => relative(process.cwd(), f)).sort()
    expect(files).toEqual(KINDS.map((kind) => relative(process.cwd(), defaultFormAssetPath(kind))).sort())
  })

  it('default/ 밖에는 pptx·xlsx 가 없다 — src 전체에서도 Office 파일은 기본 양식뿐이다', () => {
    const office = walk(join(process.cwd(), 'src'), undefined, OFFICE).map((f) => relative(process.cwd(), f))
    expect(office.filter((f) => !f.startsWith(`${ASSETS}/default/`))).toEqual([])
    expect(office).toHaveLength(KINDS.length)
  })

  it('지운 옛 렌더러·원본 양식·프로세스 고정 슬라이드 코드는 다시 없다', () => {
    const gone = [
      `${ASSETS}/issue-analysis-template.pptx`, `${ASSETS}/weekly-template.pptx`, `${ASSETS}/fixed`,
      'src/lib/report/templateFill.ts',
      ...['jszipRenderer', 'slideXml', 'deckPlan', 'processPages', 'processSlideRenderer', 'template'].map((n) => `src/lib/report/issues/${n}.ts`),
    ]
    expect(gone.filter((p) => existsSync(p))).toEqual([])
  })

  it('배포 번들 추적(next.config.ts)은 기본 양식만 싣는다', () => {
    const config = readFileSync('next.config.ts', 'utf8')
    expect(config).toContain('"/api/issue-analysis": ["./src/lib/report/assets/default/issue_analysis_pptx.pptx"]')
    const traced = [...config.matchAll(/["'](\.\/src\/lib\/report\/assets\/[^"']+)["']/g)].map((m) => m[1])
    expect(traced.length).toBeGreaterThan(0)
    expect(traced.filter((p) => !p.startsWith('./src/lib/report/assets/default/'))).toEqual([])
  })

  it('생성 스크립트는 다른 파일을 읽지 않는다 — 테마·슬라이드 크기까지 스크립트 안에 있다', () => {
    const script = readFileSync('scripts/forms/build-defaults.mjs', 'utf8')
    expect(script).not.toMatch(/\breadFile(Sync)?\b|loadAsync|xlsx\.readFile|\.load\(/)
    expect(script).toContain('name="D-Flow"')
  })
})

describe.each(KINDS)('기본 양식 %s 중립성', (kind) => {
  const load = async () => JSZip.loadAsync(await readFile(defaultFormAssetPath(kind)))

  it('모든 zip 항목에 거부 목록 토큰이 없다', async () => {
    const zip = await load()
    const hits: string[] = []
    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue
      const bytes = await entry.async('nodebuffer')
      for (const text of [bytes.toString('utf8'), bytes.toString('utf16le')]) {
        for (const m of text.match(DENY_RE) ?? []) hits.push(`${name}: ${m}`)
      }
      if (TEXT_PART.test(name)) for (const m of bytes.toString('utf8').match(DENY_WORD_RE) ?? []) hits.push(`${name}: ${m}`)
    }
    expect(hits).toEqual([])
  })

  it('미디어·임베디드·썸네일·외부 관계가 없다', async () => {
    const zip = await load()
    const names = Object.keys(zip.files)
    expect(names.filter((n) => /\/media\/|\/embeddings\/|thumbnail|\.(png|jpe?g|gif|emf|wmf|bin)$/i.test(n))).toEqual([])
    for (const name of names.filter((n) => n.endsWith('.rels'))) {
      expect(await zip.file(name)!.async('string'), name).not.toContain('TargetMode="External"')
    }
  })

  it('테마 이름·글꼴 묶음·문서 속성이 제품 값이고 원 브랜드 색이 없다', async () => {
    const zip = await load()
    const colored: string[] = []
    for (const [name, entry] of Object.entries(zip.files)) {
      if (!entry.dir && /\.xml$/.test(name) && BRAND_COLOR_RE.test(await entry.async('string'))) colored.push(name)
    }
    expect(colored).toEqual([])
    if (FORM_FORMAT[kind] === 'pptx') {
      const theme = await zip.file('ppt/theme/theme1.xml')!.async('string')
      expect(theme).toMatch(/<a:theme\b[^>]*\bname="D-Flow"/)
      expect(theme).toContain('<a:clrScheme name="D-Flow">')
      expect(theme).toContain('<a:fontScheme name="D-Flow">')
      expect(theme).toContain('<a:fmtScheme name="D-Flow">')
      expect(theme).not.toContain('themeFamily')                    // 물려받은 Office 테마 계보(GUID)를 싣지 않는다
      expect(Object.keys(zip.files).filter((n) => n.startsWith('docProps/'))).toEqual([])   // 작성자·편집 이력 파트 자체가 없다
      expect([...theme.matchAll(/typeface="([^"]*)"/g)].map((m) => m[1]).filter(Boolean).sort()).toEqual(['Arial', 'Arial', '맑은 고딕', '맑은 고딕'])
    } else {
      const core = await zip.file('docProps/core.xml')!.async('string')
      expect(core.match(/<dc:creator>([^<]*)<\/dc:creator>/)?.[1]).toBe('D-Flow')
    }
  })
})
