import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

// 배포 스킬(dflow-wbs-nlevel)의 규범 산문에 원본 프로젝트의 제조·SI 축이 남지 않게 한다(DC-06).
// 원본 설계 기록으로 남기는 예시는 <!-- example:start --> … <!-- example:end --> 안에만 둔다 — 그 구간은 검사하지 않는다.
// '공정' 은 축 어휘(공정명·공정별·공정 축·공정 WP)만 본다 — "선행·후행 공정"은 Water-Scrum-Fall 방법론 용어다(동결 dflow-wbs 와 같은 말).
const ROOT = join(process.cwd(), '.claude/skills/dflow-wbs-nlevel')
const RESIDUE = /\b(?:ERP|MES|L2)(?:IF)?\b|LINE-|생산운영|생산계획|물류|공정(?:명|별|\s?축|\s?WP)/
const EXAMPLE_BLOCK = /<!-- example:start -->[\s\S]*?<!-- example:end -->/g
const SKIP_DIRS = new Set(['__pycache__', '.pytest_cache'])

describe('배포 스킬 dflow-wbs-nlevel — 도메인 중립', () => {
  const files = walk(ROOT, SKIP_DIRS, /\.(md|py)$/)

  it('스킬 산문·스크립트를 모두 걷는다(빈 목록으로 통과하지 않는다)', () => {
    const rel = files.map(f => relative(ROOT, f))
    expect(rel).toEqual(expect.arrayContaining([
      'SKILL.md', 'references/wbs-nlevel-md-contract.md', 'references/skeleton-sample.md',
      'scripts/wbs-nlevel-parse.py', 'scripts/test_wbs_nlevel_parse.py',
    ]))
  })

  it('예시 블록 밖에 제조·SI 축 어휘가 없다', () => {
    // 예시 블록을 지울 때 줄바꿈은 남겨 줄 번호가 원문과 맞게 한다.
    const hits = files.flatMap(f => readFileSync(f, 'utf8').replace(EXAMPLE_BLOCK, m => m.replace(/[^\n]/g, ''))
      .split('\n').map((line, i) => [line, i] as const)
      .filter(([line]) => RESIDUE.test(line))
      .map(([line, i]) => `${relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`))
    expect(hits, hits.join('\n')).toEqual([])
  })

  it('RESIDUE 는 방법론 용어를 잡지 않고 축 어휘만 잡는다', () => {
    expect(RESIDUE.test('선행·후행 공정 없음 — 백로그형')).toBe(false)
    expect(RESIDUE.test('공정명(`LINE-A`)→L2IF 공정 WP')).toBe(true)
    expect(RESIDUE.test('SUB-ERPIF: ERP I/F')).toBe(true)
    expect(RESIDUE.test('공정별 실통신 검증')).toBe(true)
  })
})
