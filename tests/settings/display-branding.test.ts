import { describe, expect, it, vi } from 'vitest'
import { BRAND } from '@/lib/branding'
import { displayBranding } from '@/lib/settings/displayBranding'
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
