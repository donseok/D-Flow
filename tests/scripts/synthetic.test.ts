import { describe, expect, it } from 'vitest'
import { PENDING_STEPS, SYNTHETIC_C, SYNTHETIC_R, SYNTHETIC_WORKSPACE_B } from '../../scripts/lib/synthetic.mjs'
import { SYNTHETIC_CONFIGS } from '../fixtures/synthetic/configs'

// 합성 게이트 러너(scripts/e2e-synthetic.mjs)의 구성값은 .mjs 라 TS 픽스처를 import 하지 못해 한 번 더 적는다 — 같은 값인지 대조한다.
const plain = (v: unknown) => JSON.parse(JSON.stringify(v))

describe('scripts/lib/synthetic.mjs ↔ tests/fixtures/synthetic/configs.ts', () => {
  const [, research, construction] = SYNTHETIC_CONFIGS
  it('R·C 의 프로젝트·워크스페이스 설정이 픽스처와 같다', () => {
    expect(plain(SYNTHETIC_R.config.project)).toEqual(plain(research.project))
    expect(plain(SYNTHETIC_R.config.workspace)).toEqual(plain(research.workspace))
    expect(plain(SYNTHETIC_C.config.project)).toEqual(plain(construction.project))
    expect(plain(SYNTHETIC_C.config.workspace)).toEqual(plain(construction.workspace))
    expect(SYNTHETIC_R.config.id).toBe(research.id)
    expect(SYNTHETIC_C.config.id).toBe(construction.id)
  })
  it('세 워크스페이스 슬러그가 서로 다르고 이름이 합성임을 밝힌다', () => {
    const slugs = [SYNTHETIC_R.slug, SYNTHETIC_C.slug, SYNTHETIC_WORKSPACE_B.slug]
    expect(new Set(slugs).size).toBe(3)
    for (const ws of [SYNTHETIC_R, SYNTHETIC_C, SYNTHETIC_WORKSPACE_B]) expect(String(ws.name)).toMatch(/^합성 /)
  })
  it('아직 켜지지 않은 단계는 S1·S9 를 뺀 전부이고 담당 SP 가 적혀 있다(D25 — 건너뜀으로 세지 않는다)', () => {
    expect(Object.keys(PENDING_STEPS)).toEqual(['S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S10'])
    for (const owner of Object.values(PENDING_STEPS)) expect(String(owner)).toMatch(/^SP/)
  })
})
