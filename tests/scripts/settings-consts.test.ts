// env:local 이 병합하는 모듈 플래그(스펙 §4.1) — 8개 전부 'true', 기존 키·주석은 보존, 같은 키(false 포함)는 덮는다.
import { describe, expect, it } from 'vitest'
import { MODULE_FLAG_NAMES_SCRIPT, localModuleFlagEnv } from '../../scripts/lib/settings-consts.mjs'
import { mergeEnv } from '../../scripts/lib/targets.mjs'

describe('localModuleFlagEnv', () => {
  it('8개 키가 전부 true', () => {
    const env = localModuleFlagEnv()
    expect(Object.keys(env)).toEqual([...MODULE_FLAG_NAMES_SCRIPT])
    expect(new Set(Object.values(env))).toEqual(new Set(['true']))
  })
  it('mergeEnv 와 합치면 기존 false 를 덮고 다른 줄은 둔다', () => {
    const out = mergeEnv('# 로컬\nWIKI_SERVICE_ENABLED=false\nGEMINI_API_KEY=g\n', localModuleFlagEnv())
    expect(out).toContain('WIKI_SERVICE_ENABLED=true')
    expect(out).toContain('# 로컬\n')
    expect(out).toContain('GEMINI_API_KEY=g')
    for (const n of MODULE_FLAG_NAMES_SCRIPT) expect(out).toMatch(new RegExp(`^${n}=true$`, 'm'))
  })
})
