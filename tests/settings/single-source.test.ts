// 잠재 fail-open 두 곳(최종 리뷰 FM-11) — 같은 뜻의 값이 두 벌이면 한쪽만 바뀌었을 때 검사가 조용히 빈다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BRANDING_SLOTS } from '@/lib/settings/brandingPath'
import { validateWorkspaceConfig } from '@/lib/settings/validateConfig'

const WID = '00000000-0000-4000-8000-00000000bb01', OTHER = '00000000-0000-4000-8000-00000000bb02'

describe('한 출처', () => {
  it('초대 도메인의 전체 허용 값(ANY_DOMAIN)은 domain/invites 한 곳에만 정의한다 — 설정 parse 와 초대 판정이 갈리지 않게', () => {
    const ws = readFileSync('src/lib/settings/defs/workspace.ts', 'utf8')
    expect(ws).not.toMatch(/ANY_DOMAIN\s*=/)
    expect(ws).toMatch(/import \{[^}]*\bANY_DOMAIN\b[^}]*\} from '@\/lib\/domain\/invites'/)
  })
  it('로고 경로의 워크스페이스 검사는 BRANDING_SLOTS 를 돈다 — 슬롯 리터럴을 따로 두지 않는다', () => {
    expect(readFileSync('src/lib/settings/validateConfig.ts', 'utf8')).not.toMatch(/\['full',\s*'full_dark',\s*'mark'\]/)
    for (const slot of BRANDING_SLOTS) {
      const logo = { full: null, full_dark: null, mark: null, [slot]: `ws/${OTHER}/branding/${slot}-0123456789abcdef.png` }
      expect(validateWorkspaceConfig({ 'branding.logo': logo }, { workspaceId: WID }), slot)
        .toEqual({ ok: false, fieldErrors: [{ key: 'branding.logo', message: `${slot}: 다른 워크스페이스의 경로입니다.` }] })
    }
  })
})
