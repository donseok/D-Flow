import { describe, expect, it } from 'vitest'
import { readableIndexText } from '@/lib/wiki/readableIndexText'
import { t } from '@/lib/i18n/dict'

describe('readableIndexText — 검색 결과에 영문 코드가 드러나지 않게', () => {
  it('상태·심각도 줄의 제품 기본 코드를 이름으로 바꾼다', () => {
    expect(readableIndexText('# 이슈 A-1 로그인 오류\n상태: in_progress\n심각도: high\n기한: 2026-10-20'))
      .toBe('# 이슈 A-1 로그인 오류\n상태: 진행중\n심각도: 높음\n기한: 2026-10-20')
  })
  it('모르는 코드(프로젝트가 만든 값)와 본문 속 같은 낱말은 그대로 둔다', () => {
    expect(readableIndexText('상태: custom_state\n본문에 상태: in_progress 라고 적혀 있다')).toBe('상태: custom_state\n본문에 상태: in_progress 라고 적혀 있다')
  })
  it('이름표는 이슈 화면의 문구와 같다', () => {
    expect(readableIndexText('상태: open\n상태: resolved\n상태: on_hold\n심각도: medium\n심각도: low'))
      .toBe([`상태: ${t('issue.status.open')}`, `상태: ${t('issue.status.resolved')}`, `상태: ${t('issue.status.on_hold')}`, `심각도: ${t('issue.severity.medium')}`, `심각도: ${t('issue.severity.low')}`].join('\n'))
  })
})
