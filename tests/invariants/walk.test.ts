// 공용 walker(CARRY 2) — 리터럴 안의 '//'·'/*' 는 주석이 아니다. 진짜 주석은 계속 걷어 낸다. 기본 건너뛰기는 뿌리 바로 아래에서만.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { codeLines, codeLinesExact, walk } from './_walk'

const src = (...lines: string[]) => lines.join('\n')

describe('codeLines — 리터럴 속 표지', () => {
  it('문자열 속 // 뒤의 같은 줄 코드를 남긴다', () => {
    expect(codeLines(src("const u = 'https://x'; requireModule(a)"), 'x.ts')).toEqual(["const u = 'https://x'; requireModule(a)"])
    expect(codeLines(src('fetch("http://h/p"); hasLLM()'), 'x.ts')).toEqual(['fetch("http://h/p"); hasLLM()'])
  })
  it("문자열 속 /* 가 다음 줄들을 지우지 않는다('image/*' — gate-attack GA-7)", () => {
    expect(codeLines(src("const a = 'image/*'", 'hasLLM()', 'b()'), 'x.ts')).toEqual(["const a = 'image/*'", 'hasLLM()', 'b()'])
  })
  it('정규식 리터럴 속 // 를 건너뛴다', () => {
    expect(codeLines(src('if (/^https?:\\/\\//.test(u)) hasLLM()'), 'x.ts')).toEqual(['if (/^https?:\\/\\//.test(u)) hasLLM()'])
  })
  it('여러 줄 템플릿 안의 // 와 템플릿 뒤 코드를 남긴다. 템플릿 속 ${} 안의 진짜 주석은 걷는다', () => {
    expect(codeLines(src('const t = `', 'http://a', '${x /* c */}`; hasLLM()'), 'x.ts'))
      .toEqual(['const t = `', 'http://a', '${x }`; hasLLM()'])
  })
  it('JSX 텍스트의 URL 줄을 남긴다(표지 앞이 글자·콜론)', () => {
    expect(codeLines(src('const e = (', '  <a href={u}>', '    https://example.com', '  </a>', ')'), 'x.tsx'))
      .toEqual(['const e = (', '  <a href={u}>', '    https://example.com', '  </a>', ')'])
  })
  it('진짜 주석은 계속 걷는다 — 한 줄·줄 끝·블록·여러 줄 블록', () => {
    expect(codeLines(src('// hasLLM()', 'a() // hasLLM()', '/* hasLLM() */ b()', '/*', ' hasLLM()', '*/ c()'), 'x.ts'))
      .toEqual(['', 'a() ', ' b()', '', '', ' c()'])
  })
  it('파일명 없는 스니펫도 같은 규칙(기존 불변식의 스니펫 호출 — platform-guards·project-page-gates·teams-scope)', () => {
    expect(codeLines("x('//'); requireSuperuser()")).toEqual(["x('//'); requireSuperuser()"])
    expect(codeLines('<V canManage={canManage} /> // 주석')).toEqual(['<V canManage={canManage} /> '])
  })
})

describe('codeLines — 선필터 완전성(전수 대조)', () => {
  it('src·scripts 의 모든 ts/tsx/mjs 에서 선필터 결과 = 늘 파싱한 결과', () => {
    const files = [...walk('src'), ...walk('scripts', undefined, /\.(ts|tsx|mjs|js)$/)]
    expect(files.length).toBeGreaterThan(600)
    const diff = files.filter((f) => {
      const text = readFileSync(f, 'utf8')
      return JSON.stringify(codeLines(text, f)) !== JSON.stringify(codeLinesExact(text, f))
    })
    expect(diff, '선필터가 놓친 파일 — needsParse 의 규칙에 그 모양을 더한다').toEqual([])
  }, 60_000)
})

describe('walk — 기본 건너뛰기는 뿌리에서만', () => {
  const root = mkdtempSync(join(tmpdir(), 'walk-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules'), { recursive: true }); writeFileSync(join(root, 'node_modules', 'a.ts'), '')
  mkdirSync(join(root, 'lib', 'node_modules'), { recursive: true }); writeFileSync(join(root, 'lib', 'node_modules', 'b.ts'), '')
  mkdirSync(join(root, 'lib', '__pycache__'), { recursive: true }); writeFileSync(join(root, 'lib', '__pycache__', 'c.ts'), '')
  writeFileSync(join(root, 'lib', 'd.ts'), '')
  it('뿌리의 node_modules 는 건너뛰고 안쪽의 같은 이름은 걷는다', () => {
    expect(walk(root).map((f) => relative(root, f)).sort()).toEqual(['lib/__pycache__/c.ts', 'lib/d.ts', 'lib/node_modules/b.ts'])
  })
  it('skipDirs 를 주면 그 이름은 어느 깊이에서든 건너뛴다(기존 skill-domain-neutral 의 뜻)', () => {
    expect(walk(root, new Set(['__pycache__'])).map((f) => relative(root, f)).sort()).toEqual(['lib/d.ts', 'lib/node_modules/b.ts', 'node_modules/a.ts'])
  })
})
