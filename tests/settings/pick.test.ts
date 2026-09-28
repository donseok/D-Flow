// pick(M-4) — valueOf 를 페이지·봇 도구의 상태로 감싼다. 페이지 전용 모듈(pageConfig)이 아니라 여기서 둘 다 가져간다.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { pick } from '@/lib/settings/pick'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

describe('pick', () => {
  it('set·default 는 값, invalid 는 키와 고정 문구', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const cfg = makeProjectConfig({ 'core.level_labels': ['P', 'T'], 'core.milestone_keywords': 42 })
    expect(pick(cfg, 'core.level_labels')).toEqual({ ok: true, value: ['P', 'T'] })
    expect(pick(cfg, 'core.extra_axis_label')).toEqual({ ok: true, value: null })
    expect(pick(cfg, 'core.milestone_keywords')).toMatchObject({ ok: false, key: 'core.milestone_keywords', error: expect.stringContaining('core.milestone_keywords') })
  })
  it('required_missing 도 ok:false', () => {
    expect(pick(makeProjectConfig({}), 'core.level_labels')).toMatchObject({ ok: false, key: 'core.level_labels' })
  })
})

describe('pick 의 출처', () => {
  it('봇 도구는 페이지 전용 모듈(pageConfig)을 끌어오지 않는다', () => {
    expect(readFileSync('src/lib/ai/tools/dashboard.ts', 'utf8')).not.toContain('settings/pageConfig')
  })
})
