// 프로젝트 생애 상태의 표시 글자 — 행·카드(home.status_*)·포트폴리오(pf.status.*)·필터 칩(portalUi.projects.status*)이 같은 상태를 같은 글자로 부른다.
import { describe, expect, it } from 'vitest'
import { t } from '@/lib/i18n/dict'

const SETS = [
  ['ready', 'home.status_ready', 'pf.status.ready', 'portalUi.projects.statusReady'],
  ['active', 'home.status_active', 'pf.status.active', 'portalUi.projects.statusActive'],
  ['overdue', 'home.status_overdue', 'pf.status.overdue', 'portalUi.projects.statusOverdue'],
  ['done', 'home.status_done', 'pf.status.done', 'portalUi.projects.statusDone'],
  ['unknown', 'home.status_unknown', 'pf.status.unknown', 'portalUi.projects.statusUnknown'],
] as const

describe('C2 — 프로젝트 상태 이름 통일', () => {
  for (const [status, ...keys] of SETS) {
    it(`${status}: 세 사전의 글자가 같다`, () => {
      const words = keys.map(k => t(k as never))
      expect(new Set(words).size, words.join(' / ')).toBe(1)
    })
  }
  it('진행중·지연 종료·시작 전', () => {
    expect([t('portalUi.projects.statusActive'), t('portalUi.projects.statusOverdue'), t('portalUi.projects.statusReady')]).toEqual(['진행중', '지연 종료', '시작 전'])
  })
})
