// 스크립트 상수(.mjs 는 TS 를 import 하지 못한다)와 레지스트리의 비core 목록이 같다 — 모듈을 더하거나 빼면 둘을 같이 고친다.
import { describe, expect, it } from 'vitest'
import { NON_CORE_MODULES } from '@/lib/modules/defaults'
import { BOOTSTRAP_MODULE_IDS } from '../../scripts/lib/bootstrap-modules.mjs'

describe('bootstrap-modules 상수', () => {
  it('NON_CORE_MODULES 와 같은 순서·내용', () => {
    expect([...BOOTSTRAP_MODULE_IDS]).toEqual([...NON_CORE_MODULES])
  })
})
