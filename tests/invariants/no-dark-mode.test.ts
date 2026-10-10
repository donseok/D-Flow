// 제품은 라이트 테마 전용이다(2026-10-10 결정) — 다크 모드를 다시 넣지 않는다.
// 다크의 흔적은 빌드·타입체크로 잡히지 않는다: `.dark` 블록 하나, `dark:` 유틸 하나, <html> 에 클래스를 다는 스크립트 하나가 따로따로 돌아오면
// "토큰은 없는데 전환만 남은" 반쪽 화면이 된다. src 원문에서 그 입구들을 0건으로 고정한다.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { srcFiles } from '../css/lib/cssTokens'

/** 입구마다 정규식 — 주석 속 낱말('다크', "dark 갈래" 같은 설명)은 잡지 않게 문법 꼴로 좁힌다 */
const PATTERNS: [name: string, re: RegExp][] = [
  ['다크 변형 선언(@custom-variant dark)', /@custom-variant\s+dark\b/],
  ['dark: 유틸', /(?<![\w-])dark:(?=[a-z[!-])/],
  ['.dark 선택자(CSS·:global)', /(?:^|[\s,{(>+~])\.dark(?![\w-])/m],
  ['data-theme 속성·선택자', /data-theme\s*[=\]"']|\[data-theme|dataset\.theme\b/],
  ['OS 색 체계 판독(prefers-color-scheme)', /prefers-color-scheme/],
  ['color-scheme: dark', /(?<!prefers-)color-scheme\s*:\s*[^;}\n]*\bdark\b|colorScheme\s*[:=]\s*['"][^'"]*dark/],
  ["<html> 에 dark 클래스", /classList\.(?:add|toggle|remove)\(\s*['"]dark['"]/],
  ['테마 저장 키(dflow-theme)', /dflow-theme/],
  ['테마 공급자·훅·정책 import', /lib\/theme\/|providers\/ThemeProvider|\buseTheme\b|\bnoFlashScript\b/],
  ['theme-color·color-scheme 메타', /name=["'](?:theme-color|color-scheme)["']/],
]

/** 닫힌 예외 — [파일, 패턴 이름]: 사유. 지금은 없다. 더할 때는 "왜 다크 모드가 아닌가"를 적는다 */
const ALLOW: Record<string, string> = {}

describe('다크 모드 0(라이트 전용 — 2026-10-10)', () => {
  const files = srcFiles(/\.(tsx?|css|mjs)$/)
  it.each(PATTERNS)('%s — src 에 0건', (name, re) => {
    const hits = files.filter(([f, text]) => re.test(text) && !(`${f}::${name}` in ALLOW)).map(([f]) => f)
    expect(hits).toEqual([])
  })
  it('예외 목록에 죽은 항목이 없다', () => {
    const live = new Set(files.flatMap(([f, text]) => PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => `${f}::${name}`)))
    expect(Object.keys(ALLOW).filter((k) => !live.has(k))).toEqual([])
  })
  it('테마 코드 파일이 없다', () => {
    for (const f of ['src/lib/theme', 'src/components/providers/ThemeProvider.tsx', 'src/components/account/ThemeRadioGroup.tsx']) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(false)
    }
  })
  it('검사가 살아 있다 — 대표 꼴을 잡고, 설명 글·다른 뜻의 dark 는 잡지 않는다', () => {
    const hit = (s: string) => PATTERNS.filter(([, re]) => re.test(s)).map(([n]) => n)
    expect(hit('<div className="bg-surface dark:bg-black">')).toEqual(['dark: 유틸'])
    expect(hit('.dark {\n  --color-surface: #000;\n}')).toEqual(['.dark 선택자(CSS·:global)'])
    expect(hit(':global(.dark) .root { color: red }')).toEqual(['.dark 선택자(CSS·:global)'])
    expect(hit("document.documentElement.classList.add('dark')")).toEqual(['<html> 에 dark 클래스'])
    expect(hit('<html data-theme="dark">')).toEqual(['data-theme 속성·선택자'])
    expect(hit("window.matchMedia('(prefers-color-scheme: dark)')")).toEqual(['OS 색 체계 판독(prefers-color-scheme)'])
    expect(hit('// 톤은 light 하나다 — dark 갈래는 지웠다')).toEqual([])
    expect(hit("const s = { light: a, dark: b }")).toEqual([])          // 객체 키(뒤가 공백)는 유틸이 아니다
    expect(hit('color-scheme: light;')).toEqual([])
  })
})
