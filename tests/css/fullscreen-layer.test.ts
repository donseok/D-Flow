// WBS 전체 화면 층(D56)은 AI 버튼(FAB) 위다. 과제 8 이 125 → --z-fullscreen(120)로 바꿔 FAB 의 z-[120] 과 같아졌고,
// 같은 z 는 문서 순서로 정해져 (app) 레이아웃 본문 뒤에 그려지는 FAB 가 전체 화면(aria-modal) 위로 떠올랐다(U1a 리뷰 R2 P2).
// UI-2b 과제 30 이 FAB 를 --z-rail(90, z 대응표 §1)로 내려 전체 화면은 임시 +1 없이 --z-fullscreen 그대로다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokenMaps } from './lib/cssTokens'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const zToken = (n: string) => Number(tokenMaps().rootOther.find((d) => d.name === `--z-${n}`)?.value)

/** 전체 화면 컨테이너의 z — `z-(--z-x)` 또는 `z-[calc(var(--z-x)_+_N)]` 꼴만 받는다 */
function fullscreenZ(): number {
  const src = read('src/components/wbs/WbsGanttSheet.tsx')
  const cls = /'fixed inset-0 (z-\S+) [^']*bg-canvas[^']*'/.exec(src)?.[1]
  if (!cls) throw new Error('전체 화면 컨테이너 클래스를 찾지 못했다')
  const plain = /^z-\(--z-([\w-]+)\)$/.exec(cls)
  if (plain) return zToken(plain[1])
  const calc = /^z-\[calc\(var\(--z-([\w-]+)\)_\+_(\d+)\)\]$/.exec(cls)
  if (calc) return zToken(calc[1]) + Number(calc[2])
  throw new Error(`알 수 없는 층 표기: ${cls}`)
}

/** FAB(닫힌 상태의 52px 원형 버튼)의 z — 토큰 `z-(--z-x)` 또는 옛 임의값 `z-[N]` */
function fabZ(): number {
  const src = read('src/components/chat/AssistantChat.tsx')
  const m = /className="fixed bottom-16 right-5 z-(?:\(--z-([\w-]+)\)|\[(\d+)\])[^"]*h-\[52px\]/.exec(src)
  if (!m) throw new Error('FAB 클래스를 찾지 못했다')
  return m[1] ? zToken(m[1]) : Number(m[2])
}

describe('WBS 전체 화면 층(D56)', () => {
  it('AI 버튼(FAB)보다 높다', () => {
    expect(fullscreenZ()).toBeGreaterThan(fabZ())
  })
  it('overlay 위·modal 아래다', () => {
    expect(fullscreenZ()).toBeGreaterThan(zToken('overlay'))
    expect(fullscreenZ()).toBeLessThan(zToken('modal'))
  })
})

describe('AI 패널 층(z 대응표 §1 — UI-2b)', () => {
  it('FAB·접힌 바·떠 있는 패널은 모두 --z-rail — 임의 z 없음', () => {
    const src = read('src/components/chat/AssistantChat.tsx')
    expect(src).not.toMatch(/z-\[\d+\]/)
    expect((src.match(/fixed bottom-16 right-5 z-\(--z-rail\)/g) ?? []).length).toBe(3)
  })
  it('레일 층은 팝오버·오버레이·전체 화면 아래', () => {
    expect(zToken('rail')).toBeLessThan(zToken('popover'))
    expect(zToken('rail')).toBeLessThan(zToken('overlay'))
    expect(zToken('rail')).toBeLessThan(zToken('fullscreen'))
  })
  it('전체 화면 컨테이너는 토큰 그대로(임시 +1 없음)·레일 자리를 갖는다', () => {
    const src = read('src/components/wbs/WbsGanttSheet.tsx')
    expect(src).toContain("'fixed inset-0 z-(--z-fullscreen) overflow-auto")
    expect(src).toContain('data-rail-host="fullscreen"')
    expect(src).toContain("data-wbs-fullscreen={fullscreen ? 'open' : undefined}")
  })
})
