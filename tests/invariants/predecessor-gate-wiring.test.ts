// SP5b W2(스펙 D21·§4.7 호환 규칙 S1, K3) — 선행 판정 소비처 전수가 프로젝트의 선행 기준(gate)을 넘긴다. 순수 함수 둘(evaluateStartReadiness·
// deriveWaitReason)은 회귀 테스트를 지키려고 gate 를 선택 인자(기본 reached)로 두었다 — 그래서 tsc 대신 이 테스트가 src 호출부를 닫는다.
// 옛 predecessorReached(p) 는 reached 래퍼로만 남는다(src 의 새 사용 0).
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { codeLines, walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
const files = walk(ROOT).map((f) => ({ rel: relative(process.cwd(), f), lines: codeLines(readFileSync(f, 'utf8'), f) }))

/** 호출 이름 → 그 호출 묶음(여는 괄호부터 닫는 괄호까지)에 반드시 있어야 하는 gate 인자 꼴 */
function calls(name: string) {
  const out: { at: string; text: string }[] = []
  for (const f of files) {
    const src = f.lines.join('\n')
    const re = new RegExp(`\\b${name}\\(`, 'g')
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index - 20), m.index))) continue   // 정의
      let depth = 0, i = m.index + name.length
      for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break }
      out.push({ at: `${f.rel}:${src.slice(0, m.index).split('\n').length}`, text: src.slice(m.index, i + 1) })
    }
  }
  return out
}

describe('선행 기준 배선(D21)', () => {
  it('옛 predecessorReached 는 src 에서 정의 파일 밖 사용 0(래퍼 — S1)', () => {
    const hits = calls('predecessorReached').filter((c) => !c.at.startsWith('src/lib/domain/agentWork.ts'))
    expect(hits.map((h) => h.at)).toEqual([])
  })
  it('predecessorReachedFor 호출은 모두 gate 를 둘째 인자로 넘긴다(tsc 가 이미 강제 — 여기서는 호출부 수를 기록)', () => {
    const at = calls('predecessorReachedFor').map((c) => c.at.split(':')[0]).sort()
    expect([...new Set(at)]).toEqual([
      'src/lib/agent/depends.ts', 'src/lib/agent/stageTransition.ts', 'src/lib/domain/agentWork.ts',
      'src/lib/domain/dependencyReadiness.ts', 'src/lib/domain/waitReason.ts',
    ])
  })
  it('deriveWaitReason 호출부(허브·좌석표)는 gate 를 넘긴다', () => {
    const hits = calls('deriveWaitReason')
    expect(hits.length).toBeGreaterThanOrEqual(2)
    for (const h of hits) expect(h.text, h.at).toMatch(/\bgate:/)
  })
  it('evaluateStartReadiness 호출부(상세 패널)는 gate 를 다섯째 인자로 넘긴다', () => {
    const hits = calls('evaluateStartReadiness')
    expect(hits.map((h) => h.at.split(':')[0])).toEqual(['src/components/wbs/RowDetailPanel.tsx'])
    for (const h of hits) expect(h.text, h.at).toMatch(/predecessorGate/)
  })
  it('RowDetailPanel 숙주 둘은 선행 기준·승인 축을 넘긴다', () => {
    for (const host of ['src/components/wbs/WbsGanttSheet.tsx', 'src/components/agent-hub/AgentHubView.tsx']) {
      const src = readFileSync(host, 'utf8')
      const panel = src.slice(src.indexOf('<RowDetailPanel'), src.indexOf('/>', src.indexOf('<RowDetailPanel')))
      expect(panel, host).toMatch(/predecessorGate=/)
      expect(panel, host).toMatch(/approvedItemIds=/)
    }
  })
})
