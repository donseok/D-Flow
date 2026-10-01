// WBS 전체 화면 층(D56)은 AI 버튼(FAB) 위다. 과제 8 이 125 → --z-fullscreen(120)로 바꿔 FAB 의 z-[120] 과 같아졌고,
// 같은 z 는 문서 순서로 정해져 (app) 레이아웃 본문 뒤에 그려지는 FAB 가 전체 화면(aria-modal) 위로 떠올랐다(U1a 리뷰 R2 P2).
// D56 표에는 FAB 자리가 없다 — 대응은 과제 24(z 대응표) 몫이고, 그때까지 전체 화면을 FAB 보다 한 칸 높게 둔다.
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

/** FAB(닫힌 상태의 52px 원형 버튼)의 z */
function fabZ(): number {
  const src = read('src/components/chat/AssistantChat.tsx')
  const m = /className="fixed bottom-16 right-5 z-\[(\d+)\][^"]*h-\[52px\]/.exec(src)
  if (!m) throw new Error('FAB 클래스를 찾지 못했다')
  return Number(m[1])
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
