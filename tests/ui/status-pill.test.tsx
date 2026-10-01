// @vitest-environment jsdom
// 상태 칩(SP3b 스펙 §4.5, 개정 §5.5.4 — 색만으로 전달하지 않는다): 상태 넷이 각자 weak 배경 + 본색 글자 + 장식 아이콘을 그린다.
// 소비처는 보고서 모달(ReportModal 의 Phase 표 상태 칸)이다 — 과제 15 보고의 "소비처 0" 은 틀렸다(U1b 리뷰 R3 P2).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))

import { STATUS_TONE, StatusPill } from '@/components/ui/StatusPill'

const TONE = { not_started: 'pending', in_progress: 'progress', delayed: 'danger', done: 'success' } as const

describe('StatusPill', () => {
  it.each(Object.entries(TONE))('%s → bg-%s-weak + 본색 글자 + aria-hidden 아이콘 + 라벨', (status, tone) => {
    const host = document.createElement('div')
    host.innerHTML = renderToString(<StatusPill status={status as keyof typeof TONE} />)
    const pill = host.firstElementChild as HTMLElement
    expect(pill.classList.contains(`bg-${tone}-weak`)).toBe(true)
    expect(pill.classList.contains(`text-${tone}`)).toBe(true)
    expect(pill.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(pill.textContent).toBe(`status.${status}`)
  })
  it('상태마다 아이콘이 다르다(모양으로도 구별)', () => {
    const icons = Object.values(STATUS_TONE).map((v) => v.Icon)
    expect(new Set(icons).size).toBe(4)
    expect(Object.keys(STATUS_TONE).sort()).toEqual(Object.keys(TONE).sort())
  })
  it('보고서 모달이 쓴다 — 지우거나 쇼케이스 전용으로 바꾸면 그 상태 칸이 깨진다', () => {
    const modal = readFileSync(join(process.cwd(), 'src/components/report/ReportModal.tsx'), 'utf8')
    expect(modal).toMatch(/import \{ StatusPill \} from '@\/components\/ui\/StatusPill'/)
    expect(modal).toContain('<StatusPill status=')
  })
})
