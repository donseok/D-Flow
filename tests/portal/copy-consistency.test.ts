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

describe('C3 — 내 업무 화면의 첫 탭 이름', () => {
  it('메뉴 이름(nav.myWork)과 같다', () => {
    expect(t('portalUi.tabs.work')).toBe(t('nav.myWork'))
  })
})

describe('C5 — 공개 범위 카드 문구는 비공개의 실제 동작(직접 링크 404)을 말한다', () => {
  it('"링크 직접 접근은 막지 않는다"는 낡은 문구가 없다', () => {
    const text = t('settings.privacyDesc1') + t('settings.privacyDescStrong') + t('settings.privacyDesc2')
    expect(text).not.toContain('막는 잠금은 아닙니다')
    expect(text).toContain('404')
    expect(text).toContain('워크스페이스 관리자')
  })
})

describe('C7 — 팀 코드 바꾸기 경고는 저장해 둔 엑셀 양식을 서버가 맞춘다는 사실과 어긋나지 않는다', () => {
  it('양식의 팀 열을 "바뀌지 않는다"고 하지 않고 함께 맞춘다고 말한다', () => {
    const warn = t('settings.teams.codeDialogWarn')
    const unchanged = warn.slice(0, warn.indexOf('바뀌지 않습니다.') + 8)
    expect(unchanged).not.toContain('저장해 둔 엑셀 양식')
    expect(warn).toContain('저장해 둔 엑셀 양식의 팀 열은 새 코드로 함께 맞추며')
  })
})

describe('C8 — 간트 범례 안내는 실제 보기 스위치의 이름을 가리킨다', () => {
  it('"시트 편집" 단추는 없다 — 안내가 보기 스위치의 표 이름을 쓴다', () => {
    expect(t('wbs.legendHintTimeline')).toContain(`‘${t('wbs.view.sheet')}’`)
    expect(t('wbs.legendHintTimeline')).not.toContain('시트 편집')
  })
})
