import { describe, expect, it, vi } from 'vitest'
import { BRAND } from '@/lib/branding'
import { displayBranding, workspaceIconHref } from '@/lib/settings/displayBranding'
import { WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'
import type { WorkspaceConfig } from '@/lib/settings/workspaceConfig'

function config(values: Record<string, unknown>): WorkspaceConfig {
  const { keys } = resolveKeys({ scope: 'workspace', id: 'ws-1', values, defs: WORKSPACE_SETTINGS, env: { NODE_ENV: 'test' } })
  return { workspaceId: 'ws-1', revision: 1, schemaVersion: 1, schemaAhead: false,
    keys: keys as WorkspaceConfig['keys'], unknownKeys: [] }
}

describe('displayBranding', () => {
  it('메일 표시명이 비어 있으면 워크스페이스 제품명을 쓴다', () => {
    expect(displayBranding(config({ 'branding.product_name': '한빛 플로우' }))).toEqual({
      productName: '한빛 플로우', mailFromName: '한빛 플로우',
    })
  })
  it('손상된 값은 로그를 남기고 표시 기본값으로 돌아간다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(displayBranding(config({ 'branding.product_name': 42, 'branding.mail_from_name': '발신팀' }))).toEqual({
      productName: BRAND.productName, mailFromName: '발신팀',
    })
    expect(error).toHaveBeenCalledWith('[settings] invalid', expect.objectContaining({ key: 'branding.product_name' }))
    error.mockRestore()
  })
})

describe('workspaceIconHref', () => {
  const WS = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
  const path = (slot: string) => `ws/${WS}/branding/${slot}-0123456789abcdef.png`
  const icons = (values: Record<string, unknown>): WorkspaceConfig => ({ ...config(values), workspaceId: WS })
  it('마크가 저장돼 있으면 세션 읽기 라우트 주소를 돌려준다', () => {
    expect(workspaceIconHref(icons({ 'branding.logo': { full: null, full_dark: null, mark: path('mark') } }))).toBe(`/api/brand/${WS}/mark`)
  })
  it('마크가 없으면 null — 루트 파일 아이콘을 그대로 둔다', () => {
    expect(workspaceIconHref(icons({}))).toBeNull()
    expect(workspaceIconHref(icons({ 'branding.logo': { full: path('full'), full_dark: null, mark: null } }))).toBeNull()
  })
  it('손상된 로고 값은 null 로 돌아가고 해석기가 로그를 남긴다', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(workspaceIconHref(icons({ 'branding.logo': 42 }))).toBeNull()
    expect(error).toHaveBeenCalledWith('[settings] invalid', expect.objectContaining({ key: 'branding.logo' }))
    error.mockRestore()
  })
})
