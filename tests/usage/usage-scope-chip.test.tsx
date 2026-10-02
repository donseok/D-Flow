import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { UsageScopeChip } from '@/components/usage/UsageScopeChip'

describe('사용 현황 범위 칩(D21)', () => {
  it('플랫폼 전체 수치임을 밝힌다', () => {
    expect(renderToString(<UsageScopeChip />)).toContain('플랫폼 전체(워크스페이스 구분은 SP8)')
  })
})
