import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTACHMENT_POLICY, parseAttachmentPolicy } from '@/lib/minutes/attachmentPolicy'
import { settingDef } from '@/lib/settings/registry'
import { PLANNED_KEYS } from '@/lib/settings/catalog-meta'
describe('minutes.attachments W/P 정의', () => {
  it.each(['workspace', 'project'] as const)('%s는 동일 정책 parser/제품 기본값/SQL reader를 쓴다', scope => {
    const d = (scope === 'workspace' ? settingDef('workspace', 'minutes.attachments') : settingDef('project', 'minutes.attachments'))!
    expect(d.parse).toBe(parseAttachmentPolicy)
    expect(d.default).toEqual(DEFAULT_ATTACHMENT_POLICY)
    expect(d).toMatchObject({ module: 'minutes', editor: scope + '_admin', apply: 'immediate', impact: ['future_only'], sql: { readers: ['minute_files_attachment_guard'] } })
    expect(PLANNED_KEYS.some(x => x.key === d.key && x.scope === scope)).toBe(false)
  })
  it('프로젝트 생성 seed만 두며 런타임 상속은 하지 않는다', () => {
    expect(settingDef('project', 'minutes.attachments')!.seedFrom).toEqual({ key: 'minutes.attachments' })
    expect(settingDef('workspace', 'minutes.attachments')!.seedFrom).toBeUndefined()
  })
})
