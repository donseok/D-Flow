// 모듈 표시 이름은 한 출처(src/lib/modules/labels.ts)다 — 프로젝트 설정의 모듈 토글 목록이 로컬 표를 따로 두면
// 새 모듈(SP5 B1 issue_analysis)이 영문 id 그대로 보인다(B1-1 리뷰 P1-2).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PROJECT_TOGGLABLE } from '@/lib/modules/defaults'
import { MODULE_LABEL } from '@/lib/modules/labels'

describe('모듈 표시 이름', () => {
  it('issue_analysis 는 한글 라벨 "이슈 분석" 이다', () => {
    expect(MODULE_LABEL.issue_analysis).toBe('이슈 분석')
  })
  it('프로젝트 토글 대상은 모두 영문 id 가 아닌 한글 라벨이 있다', () => {
    for (const id of PROJECT_TOGGLABLE) expect(MODULE_LABEL[id], id).toMatch(/[가-힣]/)
  })
  it('프로젝트 설정 화면은 MODULE_LABEL 을 쓰고 로컬 라벨 표를 두지 않는다', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/(app)/p/[projectId]/settings/page.tsx'), 'utf8')
    expect(src).toContain("from '@/lib/modules/labels'")
    expect(src).toContain('MODULE_LABEL[m.id]')
    expect(src).not.toMatch(/kanban:\s*'칸반'/)
  })
})
