import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsageScopeChip } from '@/components/usage/UsageScopeChip'

describe('사용 현황 범위 칩(D21, SP8)', () => {
  it('워크스페이스 수치임을 밝힌다', () => {
    expect(renderToString(<UsageScopeChip />)).toContain('이 워크스페이스')
    expect(renderToString(<UsageScopeChip workspaceName="Acme" />)).toContain('Acme 워크스페이스')
  })
})
