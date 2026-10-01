import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { walk } from '../invariants/_walk'

// 설정 화면 컴포넌트가 정의돼 있지 않은 클래스·토큰을 쓰면 빌드·린트·타입체크·단위 테스트가 모두 초록인데
// 화면만 깨진다(2026-10-01 눈확인: `className="input"` 에는 CSS 가 없어 입력칸이 테두리 없는 평문으로 보였고,
// `bg-surface-1` 토큰이 없어 저장 바·목차 배경이 투명했다). 정의된 것은 globals.css 에 있다.
const CSS = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const FILES = walk(join(process.cwd(), 'src/components/settings')).filter(f => f.endsWith('.tsx'))

describe('설정 컴포넌트가 쓰는 클래스·토큰은 globals.css 에 정의돼 있다', () => {
  it('입력 클래스는 app-input·app-textarea 만 쓴다(`input` 은 정의가 없다)', () => {
    expect(CSS).toContain('.app-input')
    expect(CSS).toContain('.app-textarea')
    const offenders = FILES.filter(f => /className="input[\s"]|className=\{`input[\s`]/.test(readFileSync(f, 'utf8')))
    expect(offenders.map(f => f.replace(process.cwd() + '/', ''))).toEqual([])
  })
  it('surface 토큰은 정의된 것만 쓴다', () => {
    const defined = new Set([...CSS.matchAll(/--color-(surface[\w-]*):/g)].map(m => m[1]))
    const used = new Map<string, string[]>()
    for (const f of FILES) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:bg|text|border|ring|from|to)-(surface[\w-]*?)(?:\/\d+)?(?=[\s"'`])/g)) {
        if (!defined.has(m[1])) used.set(m[1], [...(used.get(m[1]) ?? []), f.replace(process.cwd() + '/', '')])
      }
    }
    expect([...used.entries()]).toEqual([])
  })
})
