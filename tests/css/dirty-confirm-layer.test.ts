// 저장 안 한 변경 확인 상자는 모달 위에 떠야 한다. 예전엔 선언 없는 `--z-modal-alert` 의 폴백 100 이라 --z-modal(150) 아래에 깔려,
// dirty 모달(WBS 붙여넣기·대량 수정)에서 닫기를 누르면 확인 상자가 보이지 않고 '변경사항 버리기'에 클릭이 닿지 않았다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokenMaps } from './lib/cssTokens'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const zToken = (n: string) => Number(tokenMaps().rootOther.find((d) => d.name === `--z-${n}`)?.value)

/** `fixed inset-0 z-…` 컨테이너의 z — `z-(--z-x)` 또는 `z-[calc(var(--z-x)_+_N)]` 꼴만 받는다(선언 없는 변수의 폴백은 받지 않는다) */
function containerZ(file: string): number {
  const cls = /fixed inset-0 (z-\S+) flex items-center justify-center/.exec(read(file))?.[1]
  if (!cls) throw new Error(`${file}: 컨테이너 층 클래스를 찾지 못했다`)
  const plain = /^z-\(--z-([\w-]+)\)$/.exec(cls)
  if (plain) return zToken(plain[1])
  const calc = /^z-\[calc\(var\(--z-([\w-]+)\)_\+_(\d+)\)\]$/.exec(cls)
  if (calc) return zToken(calc[1]) + Number(calc[2])
  throw new Error(`${file}: 알 수 없는 층 표기 ${cls}`)
}

describe('저장 안 한 변경 확인 상자의 층', () => {
  it('모달 위·토스트 아래다', () => {
    const confirm = containerZ('src/components/ui/DirtyConfirmDialog.tsx')
    expect(confirm).toBeGreaterThan(containerZ('src/components/ui/Modal.tsx'))
    expect(confirm).toBeGreaterThan(zToken('modal'))
    expect(confirm).toBeLessThan(zToken('toast'))
  })
})
