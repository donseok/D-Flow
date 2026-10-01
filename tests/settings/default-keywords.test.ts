// 마일스톤 기본 키워드의 한 출처(DEFAULT_MILESTONE_KEYWORDS) — 포트폴리오(§9 #16 기본값)와 0012 롤백(FN-9)이 같은 값을 쓴다.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: vi.fn() }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: vi.fn() }))
import { portfolioMilestoneKeywords } from '@/lib/data/portfolio'
import { DEFAULT_MILESTONE_KEYWORDS } from '@/lib/settings/defs/project'

describe('마일스톤 기본 키워드', () => {
  it('포트폴리오는 프로젝트별 설정을 읽지 않고 제품 기본 키워드로 판정한다(§9 #16 — FM-8)', () => {
    expect(portfolioMilestoneKeywords()).toEqual(DEFAULT_MILESTONE_KEYWORDS)
    // 워크스페이스 화면은 프로젝트 해석기를 부르지 않는다(개정 §2.1) — 정적 확인
    expect(readFileSync('src/lib/data/portfolio.ts', 'utf8')).not.toMatch(/@\/lib\/settings\/projectConfig/)
  })
  it('0012 롤백이 미설정 키워드를 채우는 값은 레지스트리 기본값과 같다(FN-9)', () => {
    const sql = readFileSync('supabase/rollbacks/0012_settings_rollback.sql', 'utf8')
    const m = /when not \(k\.v \? 'core\.milestone_keywords'\)\s+then array\[([^\]]*)\]/.exec(sql)
    expect(m, '롤백의 미설정 키워드 분기').not.toBeNull()
    expect([...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1])).toEqual([...DEFAULT_MILESTONE_KEYWORDS])
  })
})
