// 스크립트 상수(.mjs 는 TS 를 import 하지 못한다)와 레지스트리의 비core 목록이 같다 — 모듈을 더하거나 빼면 둘을 같이 고친다.
import { describe, expect, it } from 'vitest'
import { NON_CORE_MODULES, PROJECT_TOGGLABLE } from '@/lib/modules/defaults'
import { SETTINGS_SCHEMA_VERSION } from '@/lib/settings/registry'
import { BOOTSTRAP_MODULE_IDS } from '../../scripts/lib/bootstrap-modules.mjs'
import { PROJECT_TOGGLE_IDS, SCRIPT_SCHEMA_VERSION } from '../../scripts/lib/settings-consts.mjs'

describe('bootstrap-modules 상수', () => {
  it('NON_CORE_MODULES 와 같은 순서·내용', () => {
    expect([...BOOTSTRAP_MODULE_IDS]).toEqual([...NON_CORE_MODULES])
  })
})

describe('settings-consts 상수(스크립트가 설정 RPC 에 넘기는 값)', () => {
  it('설정 스키마 세대 = SETTINGS_SCHEMA_VERSION', () => {
    expect(SCRIPT_SCHEMA_VERSION).toBe(SETTINGS_SCHEMA_VERSION)
  })
  it('프로젝트 토글 9 = PROJECT_TOGGLABLE(순서까지) — 성능 시드의 modules.enabled', () => {
    expect([...PROJECT_TOGGLE_IDS]).toEqual([...PROJECT_TOGGLABLE])
  })
})
